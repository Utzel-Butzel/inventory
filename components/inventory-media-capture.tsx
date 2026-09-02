"use client";

import {
  Camera,
  Check,
  FileText,
  Images,
  LoaderCircle,
  ScanLine,
  SwitchCamera,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "next-i18next/client";

import {
  captureDocumentPage,
  createSearchableScanPdf,
  detectDocumentCorners,
  documentAreaRatio,
  loadDocumentScanner,
  normalizedCornerMovement,
  scannerFilename,
  type DocumentCorners,
  type DocumentScanFilter,
  type OcrProgress,
} from "@/lib/document-scanner";

type CaptureMode = "photo" | "video" | "document";
type CameraState = "idle" | "requesting" | "ready" | "error";

type ScanPage = {
  id: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
};

const maximumScanPages = 24;
const maximumVideoBytes = 23 * 1_024 * 1_024;
const maximumVideoSeconds = 60;

const cameraErrorKey = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "media.capture.errors.permission";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "media.capture.errors.notFound";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "media.capture.errors.inUse";
    }
  }
  return "media.capture.errors.unavailable";
};

const supportedRecorderType = () => {
  if (typeof MediaRecorder === "undefined") return null;
  return [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
};

const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;

const photoFromVideo = async (video: HTMLVideoElement) => {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Camera preview is not ready.");
  }
  const maximum = 2_800;
  const scale = Math.min(1, maximum / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Unable to encode photo."))),
      "image/jpeg",
      0.92,
    );
  });
};

export function InventoryMediaCapture({
  disabled = false,
  remainingSlots,
  onCapture,
}: {
  disabled?: boolean;
  remainingSlots: number;
  onCapture: (files: File[]) => void;
}) {
  const { t } = useT("resource");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderBytesRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const scanBusyRef = useRef(false);
  const latestCornersRef = useRef<DocumentCorners | null>(null);
  const stableCornersRef = useRef<DocumentCorners | null>(null);
  const stableSinceRef = useRef<number | null>(null);
  const autoCaptureArmedRef = useRef(true);
  const noDocumentSinceRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CaptureMode>("photo");
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [corners, setCorners] = useState<DocumentCorners | null>(null);
  const [documentFilter, setDocumentFilter] =
    useState<DocumentScanFilter>("color");
  const [autoCapture, setAutoCapture] = useState(true);
  const [stableProgress, setStableProgress] = useState(0);
  const [scanPages, setScanPages] = useState<ScanPage[]>([]);
  const [scannerLoading, setScannerLoading] = useState(false);
  const [processing, setProcessing] = useState<"page" | "ocr" | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    if (recording) {
      discardRecordingRef.current = true;
      recorderRef.current?.stop();
    }
    stopStream();
    setOpen(false);
    setCameraState("idle");
    setCameraError(null);
    setCorners(null);
    latestCornersRef.current = null;
    stableCornersRef.current = null;
    stableSinceRef.current = null;
    setStableProgress(0);
    setScanPages((current) => {
      current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
      return [];
    });
  }, [recording, stopStream]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !recording && !processing) close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open, processing, recording]);

  useEffect(
    () => () => {
      stopStream();
      scanPages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    },
    // Scan pages are explicitly revoked when removed or committed. This cleanup
    // only covers a component unmount with a still-open scan session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const start = async () => {
      stopStream();
      setCameraState("requesting");
      setCameraError(null);
      setOperationError(null);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCameraState("error");
        setCameraError(t("media.capture.errors.unsupported"));
        return;
      }
      const videoConstraints: MediaTrackConstraints = {
        facingMode: deviceId ? undefined : { ideal: "environment" },
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 2_560 },
        height: { ideal: 1_920 },
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: mode === "video" ? { echoCancellation: true } : false,
        });
      } catch (error) {
        if (mode === "video") {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: videoConstraints,
              audio: false,
            });
          } catch (fallbackError) {
            if (cancelled) return;
            setCameraState("error");
            setCameraError(t(cameraErrorKey(fallbackError)));
            return;
          }
        } else {
          if (cancelled) return;
          setCameraState("error");
          setCameraError(t(cameraErrorKey(error)));
          return;
        }
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setCameraState("ready");
      const available = await navigator.mediaDevices.enumerateDevices();
      if (!cancelled) {
        setDevices(available.filter((device) => device.kind === "videoinput"));
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (activeId) setDeviceId(activeId);
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [deviceId, mode, open, stopStream, t]);

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1_000);
      setRecordingSeconds(seconds);
      if (seconds >= maximumVideoSeconds) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const addScanPage = useCallback(
    async () => {
      const video = videoRef.current;
      if (
        !video ||
        scanBusyRef.current ||
        processing ||
        scanPages.length >= maximumScanPages
      ) {
        return;
      }
      scanBusyRef.current = true;
      setProcessing("page");
      setOperationError(null);
      try {
        const page = await captureDocumentPage({
          video,
          corners: latestCornersRef.current,
          filter: documentFilter,
        });
        const previewUrl = URL.createObjectURL(page.blob);
        setScanPages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            blob: page.blob,
            previewUrl,
            width: page.width,
            height: page.height,
          },
        ]);
        autoCaptureArmedRef.current = false;
        stableSinceRef.current = null;
        stableCornersRef.current = null;
        setStableProgress(0);
      } catch (error) {
        setOperationError(
          error instanceof Error
            ? error.message
            : t("media.capture.errors.scanFailed"),
        );
      } finally {
        scanBusyRef.current = false;
        setProcessing(null);
      }
    }, [documentFilter, processing, scanPages.length, t]);

  useEffect(() => {
    if (!open || mode !== "document") return;
    let cancelled = false;
    let running = false;
    setScannerLoading(true);
    void loadDocumentScanner()
      .catch(() => {
        if (!cancelled) setOperationError(t("media.capture.errors.scannerLoad"));
      })
      .finally(() => {
        if (!cancelled) setScannerLoading(false);
      });

    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (
        cancelled ||
        running ||
        cameraState !== "ready" ||
        !video?.videoWidth ||
        processing
      ) {
        return;
      }
      running = true;
      try {
        const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const detected = await detectDocumentCorners(canvas);
        if (cancelled) return;
        const scaled = detected?.map((point) => ({
          x: point.x / scale,
          y: point.y / scale,
        })) as DocumentCorners | undefined;
        const next = scaled ?? null;
        latestCornersRef.current = next;
        setCorners(next);

        const now = performance.now();
        if (!next || documentAreaRatio(next, video.videoWidth, video.videoHeight) < 0.18) {
          stableCornersRef.current = null;
          stableSinceRef.current = null;
          setStableProgress(0);
          noDocumentSinceRef.current ??= now;
          if (now - noDocumentSinceRef.current > 650) autoCaptureArmedRef.current = true;
          return;
        }
        noDocumentSinceRef.current = null;
        const previous = stableCornersRef.current;
        if (
          !previous ||
          normalizedCornerMovement(
            previous,
            next,
            video.videoWidth,
            video.videoHeight,
          ) > 0.018
        ) {
          if (
            previous &&
            normalizedCornerMovement(
              previous,
              next,
              video.videoWidth,
              video.videoHeight,
            ) > 0.07
          ) {
            autoCaptureArmedRef.current = true;
          }
          stableCornersRef.current = next;
          stableSinceRef.current = now;
          setStableProgress(0);
          return;
        }
        const stableSince = stableSinceRef.current ?? now;
        stableSinceRef.current = stableSince;
        stableCornersRef.current = next;
        const progress = Math.min(1, (now - stableSince) / 1_150);
        setStableProgress(progress);
        if (autoCapture && autoCaptureArmedRef.current && progress >= 1) {
          autoCaptureArmedRef.current = false;
          void addScanPage();
        }
      } catch {
        // Individual low-resolution analysis frames may be unreadable while the
        // camera changes focus. Keep the live preview and inspect the next frame.
      } finally {
        running = false;
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [addScanPage, autoCapture, cameraState, mode, open, processing, t]);

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || remainingSlots < 1) return;
    setProcessing("page");
    setOperationError(null);
    try {
      const blob = await photoFromVideo(video);
      const type = "image/jpeg";
      onCapture([
        new File([blob], scannerFilename("photo", type), {
          type,
          lastModified: Date.now(),
        }),
      ]);
      close();
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : t("media.capture.errors.photoFailed"),
      );
    } finally {
      setProcessing(null);
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    const mimeType = supportedRecorderType();
    if (!stream || !mimeType || remainingSlots < 1) {
      setOperationError(t("media.capture.errors.videoUnsupported"));
      return;
    }
    try {
      recorderChunksRef.current = [];
      recorderBytesRef.current = 0;
      discardRecordingRef.current = false;
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_000_000,
        audioBitsPerSecond: 96_000,
      });
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        recorderChunksRef.current.push(event.data);
        recorderBytesRef.current += event.data.size;
        if (recorderBytesRef.current >= maximumVideoBytes && recorder.state === "recording") {
          recorder.stop();
        }
      };
      recorder.onerror = () => {
        setOperationError(t("media.capture.errors.videoFailed"));
        setRecording(false);
      };
      recorder.onstop = () => {
        setRecording(false);
        recorderRef.current = null;
        if (discardRecordingRef.current) return;
        const normalizedType = recorder.mimeType.split(";", 1)[0] || "video/webm";
        const blob = new Blob(recorderChunksRef.current, { type: normalizedType });
        if (!blob.size) {
          setOperationError(t("media.capture.errors.videoFailed"));
          return;
        }
        onCapture([
          new File([blob], scannerFilename("video", normalizedType), {
            type: normalizedType,
            lastModified: Date.now(),
          }),
        ]);
        close();
      };
      recorderRef.current = recorder;
      setRecordingSeconds(0);
      setRecording(true);
      recorder.start(1_000);
    } catch {
      setOperationError(t("media.capture.errors.videoUnsupported"));
    }
  };

  const finishDocument = async () => {
    if (!scanPages.length || remainingSlots < 1) return;
    setProcessing("ocr");
    setOperationError(null);
    setOcrProgress(null);
    try {
      const pdf = await createSearchableScanPdf(
        scanPages.map((page) => page.blob),
        setOcrProgress,
      );
      const file = new File(
        [pdf],
        scannerFilename("document", "application/pdf"),
        { type: "application/pdf", lastModified: Date.now() },
      );
      onCapture([file]);
      scanPages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
      setScanPages([]);
      close();
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : t("media.capture.errors.ocrFailed"),
      );
    } finally {
      setProcessing(null);
    }
  };

  const removeScanPage = (id: string) => {
    setScanPages((current) => {
      const removed = current.find((page) => page.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((page) => page.id !== id);
    });
  };

  const polygonPoints = useMemo(
    () => corners?.map((point) => `${point.x},${point.y}`).join(" ") ?? "",
    [corners],
  );

  const modeOptions: Array<{
    id: CaptureMode;
    icon: typeof Camera;
    label: string;
  }> = [
    { id: "photo", icon: Camera, label: t("media.capture.modes.photo") },
    { id: "video", icon: Video, label: t("media.capture.modes.video") },
    { id: "document", icon: ScanLine, label: t("media.capture.modes.document") },
  ];

  return (
    <>
      <button
        type="button"
        disabled={disabled || remainingSlots < 1}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-solid px-4 py-2.5 text-xs font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Camera size={16} aria-hidden="true" />
        {t("media.capture.open")}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-slate-950 text-white">
          <header className="flex items-center gap-3 border-b border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur sm:px-5">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">
                {t("media.capture.title")}
              </h2>
              <p className="truncate text-[11px] text-white/60">
                {mode === "document"
                  ? t("media.capture.documentHint")
                  : t("media.capture.cameraHint")}
              </p>
            </div>
            {devices.length > 1 ? (
              <label className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white/10">
                <SwitchCamera size={18} aria-hidden="true" />
                <span className="sr-only">{t("media.capture.camera")}</span>
                <select
                  value={deviceId}
                  onChange={(event) => setDeviceId(event.target.value)}
                  disabled={recording || Boolean(processing)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={t("media.capture.camera")}
                >
                  {devices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || t("media.capture.cameraNumber", { number: index + 1 })}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={close}
              disabled={Boolean(processing)}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 disabled:opacity-40"
              aria-label={t("media.capture.close")}
            >
              <X size={18} />
            </button>
          </header>

          <main className="relative min-h-0 flex-1 overflow-hidden bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={(event) =>
                setVideoDimensions({
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight,
                })
              }
              className="size-full object-contain"
              aria-label={t("media.capture.preview")}
            />

            {mode === "document" && corners && videoDimensions.width > 0 ? (
              <svg
                className="pointer-events-none absolute inset-0 size-full"
                viewBox={`0 0 ${videoDimensions.width} ${videoDimensions.height}`}
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <polygon
                  points={polygonPoints}
                  fill="rgba(163,230,53,0.12)"
                  stroke="rgb(190,242,100)"
                  strokeWidth={Math.max(4, videoDimensions.width / 280)}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : null}

            {mode === "document" ? (
              <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
                <div className="rounded-full bg-black/65 px-4 py-2 text-center text-xs font-semibold shadow-lg backdrop-blur">
                  {scannerLoading
                    ? t("media.capture.scannerLoading")
                    : corners
                      ? stableProgress > 0.05 && autoCapture
                        ? t("media.capture.holdStill", {
                            percent: Math.round(stableProgress * 100),
                          })
                        : t("media.capture.edgesFound")
                      : t("media.capture.findDocument")}
                </div>
              </div>
            ) : null}

            {recording ? (
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-xs font-bold tabular-nums backdrop-blur">
                <span className="size-2 animate-pulse rounded-full bg-red-500" />
                {formatDuration(recordingSeconds)} / 01:00
              </div>
            ) : null}

            {cameraState !== "ready" ? (
              <div className="absolute inset-0 grid place-items-center bg-slate-950/90 p-6 text-center">
                <div className="max-w-sm">
                  {cameraState === "requesting" ? (
                    <LoaderCircle className="mx-auto size-8 animate-spin text-lime-300" />
                  ) : (
                    <Camera className="mx-auto size-9 text-white/55" />
                  )}
                  <p className="mt-3 text-sm font-semibold">
                    {cameraState === "requesting"
                      ? t("media.capture.openingCamera")
                      : cameraError ?? t("media.capture.cameraOff")}
                  </p>
                </div>
              </div>
            ) : null}

            {processing === "ocr" ? (
              <div className="absolute inset-0 z-10 grid place-items-center bg-slate-950/90 p-6 text-center backdrop-blur-sm">
                <div className="w-full max-w-sm">
                  <LoaderCircle className="mx-auto size-9 animate-spin text-lime-300" />
                  <p className="mt-4 text-sm font-semibold">
                    {t("media.capture.ocrRunning", {
                      page: ocrProgress?.page ?? 1,
                      count: ocrProgress?.pageCount ?? scanPages.length,
                    })}
                  </p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-lime-300 transition-[width] duration-300"
                      style={{ width: `${Math.round((ocrProgress?.progress ?? 0) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-white/55">
                    {t("media.capture.ocrLocal")}
                  </p>
                </div>
              </div>
            ) : null}
          </main>

          <footer className="border-t border-white/10 bg-slate-950 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
            {operationError ? (
              <p className="mb-3 rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-xs text-red-100">
                {operationError}
              </p>
            ) : null}

            {mode === "document" ? (
              <div className="mb-3 space-y-3">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {scanPages.map((page, index) => (
                    <div
                      key={page.id}
                      className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-white/5"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={page.previewUrl}
                        alt={t("media.capture.page", { number: index + 1 })}
                        className="size-full object-cover"
                      />
                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold">
                        {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeScanPage(page.id)}
                        className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/75 text-white"
                        aria-label={t("media.capture.removePage", { number: index + 1 })}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                  {!scanPages.length ? (
                    <div className="flex h-16 flex-1 items-center gap-3 rounded-xl border border-dashed border-white/20 px-3 text-xs text-white/55">
                      <Images size={18} />
                      {t("media.capture.noPages")}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 rounded-lg bg-white/10 p-1">
                    {(["color", "grayscale", "black-white"] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setDocumentFilter(filter)}
                        className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${
                          documentFilter === filter
                            ? "bg-white text-slate-950"
                            : "text-white/65"
                        }`}
                      >
                        {t(`media.capture.filters.${filter}`)}
                      </button>
                    ))}
                  </div>
                  <label className="flex min-h-9 items-center gap-2 text-[11px] font-medium text-white/70">
                    <input
                      type="checkbox"
                      checked={autoCapture}
                      onChange={(event) => setAutoCapture(event.target.checked)}
                      className="size-4 accent-lime-300"
                    />
                    {t("media.capture.autoCapture")}
                  </label>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div />
              {mode === "photo" ? (
                <button
                  type="button"
                  onClick={() => void capturePhoto()}
                  disabled={cameraState !== "ready" || Boolean(processing)}
                  className="grid size-20 place-items-center rounded-full border-4 border-white bg-white/20 disabled:opacity-40"
                  aria-label={t("media.capture.takePhoto")}
                >
                  <span className="size-14 rounded-full bg-white" />
                </button>
              ) : mode === "video" ? (
                <button
                  type="button"
                  onClick={() =>
                    recording ? recorderRef.current?.stop() : startRecording()
                  }
                  disabled={cameraState !== "ready" || Boolean(processing)}
                  className="grid size-20 place-items-center rounded-full border-4 border-white bg-white/15 disabled:opacity-40"
                  aria-label={
                    recording
                      ? t("media.capture.stopVideo")
                      : t("media.capture.startVideo")
                  }
                >
                  <span
                    className={`bg-red-500 transition-all ${
                      recording ? "size-8 rounded-lg" : "size-14 rounded-full"
                    }`}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void addScanPage()}
                  disabled={
                    cameraState !== "ready" ||
                    Boolean(processing) ||
                    scanPages.length >= maximumScanPages
                  }
                  className="grid size-20 place-items-center rounded-full border-4 border-white bg-lime-300 text-slate-950 disabled:opacity-40"
                  aria-label={t("media.capture.scanPage")}
                >
                  {processing === "page" ? (
                    <LoaderCircle className="size-7 animate-spin" />
                  ) : (
                    <ScanLine size={30} />
                  )}
                </button>
              )}
              <div className="flex justify-end">
                {mode === "document" && scanPages.length ? (
                  <button
                    type="button"
                    onClick={() => void finishDocument()}
                    disabled={Boolean(processing)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-lime-300 px-4 text-xs font-bold text-slate-950 disabled:opacity-40"
                  >
                    <Check size={15} />
                    {t("media.capture.finish", { count: scanPages.length })}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-white/10 p-1">
              {modeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    disabled={recording || Boolean(processing)}
                    className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-bold transition ${
                      mode === option.id
                        ? "bg-white text-slate-950"
                        : "text-white/65 hover:text-white"
                    }`}
                    aria-pressed={mode === option.id}
                  >
                    <Icon size={15} />
                    {option.label}
                  </button>
                );
              })}
            </div>
            {mode === "document" ? (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[10px] text-white/45">
                <FileText size={12} />
                {t("media.capture.searchablePdf")}
              </p>
            ) : null}
          </footer>
        </div>
      ) : null}
    </>
  );
}
