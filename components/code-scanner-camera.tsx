"use client";

import {
  Camera,
  CameraOff,
  CheckCircle2,
  FileImage,
  Keyboard,
  LoaderCircle,
  Play,
  QrCode,
  ShieldAlert,
} from "lucide-react";
import jsQR from "jsqr";
import { useT } from "next-i18next/client";
import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button, cn } from "@/components/ui";

type CameraStatus = "idle" | "requesting" | "active" | "paused" | "error";

export type ScannerSource = "camera" | "photo" | "manual";

type CodeScannerCameraProps = {
  onDetected: (code: string, source: ScannerSource) => void;
  disabled?: boolean;
};

type CameraDevice = {
  id: string;
  label: string;
};

const CAMERA_FRAME_INTERVAL = 110;
const CAMERA_MAX_EDGE = 1_280;
const PHOTO_MAX_EDGE = 2_048;
const PHOTO_THRESHOLDS = [128, 160, 190] as const;

function cameraErrorKey(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "camera.errors.blocked";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "camera.errors.notFound";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "camera.errors.inUse";
    }
    if (error.name === "OverconstrainedError") {
      return "camera.errors.unavailable";
    }
  }
  return "camera.errors.generic";
}

function decodePixels(data: Uint8ClampedArray, width: number, height: number) {
  const original = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  if (original?.data.trim()) return original.data.trim();

  for (const threshold of PHOTO_THRESHOLDS) {
    const blackAndWhite = new Uint8ClampedArray(data.length);
    for (let index = 0; index < data.length; index += 4) {
      const luminance =
        data[index] * 0.299 +
        data[index + 1] * 0.587 +
        data[index + 2] * 0.114;
      const value = luminance < threshold ? 0 : 255;
      blackAndWhite[index] = value;
      blackAndWhite[index + 1] = value;
      blackAndWhite[index + 2] = value;
      blackAndWhite[index + 3] = 255;
    }
    const decoded = jsQR(blackAndWhite, width, height, {
      inversionAttempts: "attemptBoth",
    });
    if (decoded?.data.trim()) return decoded.data.trim();
  }

  return null;
}

async function decodePhoto(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();

    const sourceWidth = image.naturalWidth;
    const sourceHeight = image.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("The image is empty.");

    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image processing is not available.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    return decodePixels(context.getImageData(0, 0, width, height).data, width, height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function CodeScannerCamera({
  onDetected,
  disabled = false,
}: CodeScannerCameraProps) {
  const { t, i18n } = useT("scanner");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const cameraGenerationRef = useRef(0);
  const photoGenerationRef = useRef(0);
  const onDetectedRef = useRef(onDetected);
  const uploadInputId = useId();

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [lastDetectedCode, setLastDetectedCode] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  const stopCamera = useCallback(() => {
    cameraGenerationRef.current += 1;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const invalidatePhoto = useCallback(() => {
    photoGenerationRef.current += 1;
  }, []);

  useEffect(
    () => () => {
      stopCamera();
      invalidatePhoto();
    },
    [invalidatePhoto, stopCamera],
  );

  const startCamera = useCallback(
    async (deviceId?: string) => {
      invalidatePhoto();
      setPhotoBusy(false);
      stopCamera();
      const generation = cameraGenerationRef.current;
      setCameraError(null);
      setPhotoError(null);
      setLastDetectedCode(null);

      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        setCameraStatus("error");
        setCameraError(
          t("camera.errors.secureContext"),
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus("error");
        setCameraError(
          t("camera.errors.unsupported"),
        );
        return;
      }

      setCameraStatus("requesting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : {
                facingMode: { ideal: "environment" },
                width: { ideal: 1_920 },
                height: { ideal: 1_080 },
              },
        });

        if (generation !== cameraGenerationRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          for (const track of stream.getTracks()) track.stop();
          streamRef.current = null;
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (generation !== cameraGenerationRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? "";
        if (activeDeviceId) setSelectedDeviceId(activeDeviceId);

        try {
          const availableDevices = (await navigator.mediaDevices.enumerateDevices())
            .filter((device) => device.kind === "videoinput")
            .map((device, index) => ({
              id: device.deviceId,
              label: device.label || t("camera.deviceFallback", {
                value: integer.format(index + 1),
              }),
            }));
          if (generation !== cameraGenerationRef.current) return;
          setDevices(availableDevices);
        } catch {
          // Device selection is an enhancement; the active stream remains usable.
        }

        // Enumeration is asynchronous too. Do not publish status or schedule a
        // frame for a camera generation that another source has already stopped.
        if (generation !== cameraGenerationRef.current) return;
        setCameraStatus("active");
        let lastFrameAt = 0;

        const scanFrame = (timestamp: number) => {
          if (generation !== cameraGenerationRef.current) return;
          animationFrameRef.current = requestAnimationFrame(scanFrame);
          if (timestamp - lastFrameAt < CAMERA_FRAME_INTERVAL) return;
          if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;
          lastFrameAt = timestamp;

          const canvas = canvasRef.current;
          if (!canvas || !video.videoWidth || !video.videoHeight) return;
          const scale = Math.min(
            1,
            CAMERA_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight),
          );
          const width = Math.max(1, Math.round(video.videoWidth * scale));
          const height = Math.max(1, Math.round(video.videoHeight * scale));
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;

          context.drawImage(video, 0, 0, width, height);
          const frame = context.getImageData(0, 0, width, height);
          const result = jsQR(frame.data, width, height, {
            inversionAttempts: "attemptBoth",
          });
          const code = result?.data.trim();
          if (!code) return;

          setLastDetectedCode(code);
          setCameraStatus("paused");
          stopCamera();
          onDetectedRef.current(code, "camera");
        };

        animationFrameRef.current = requestAnimationFrame(scanFrame);
      } catch (error) {
        if (generation !== cameraGenerationRef.current) return;
        stopCamera();
        setCameraStatus("error");
        setCameraError(t(cameraErrorKey(error)));
      }
    },
    [integer, invalidatePhoto, stopCamera, t],
  );

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    void startCamera(deviceId);
  };

  const handlePhoto = async (file: File | undefined) => {
    if (!file || disabled) return;
    invalidatePhoto();
    const generation = photoGenerationRef.current;
    stopCamera();
    setCameraStatus("idle");
    setPhotoBusy(true);
    setPhotoError(null);
    setLastDetectedCode(null);
    try {
      const code = await decodePhoto(file);
      if (generation !== photoGenerationRef.current) return;
      if (!code) {
        setPhotoError(
          t("camera.errors.noQr"),
        );
        return;
      }
      setLastDetectedCode(code);
      setCameraStatus("paused");
      onDetectedRef.current(code, "photo");
    } catch {
      if (generation !== photoGenerationRef.current) return;
      setPhotoError(
        t("camera.errors.imageUnreadable"),
      );
    } finally {
      if (generation === photoGenerationRef.current) setPhotoBusy(false);
    }
  };

  const submitManualCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || photoBusy) return;
    const code = manualCode.trim();
    if (!code) {
      setManualError(t("camera.errors.manualRequired"));
      return;
    }
    invalidatePhoto();
    setPhotoBusy(false);
    stopCamera();
    setCameraStatus("paused");
    setLastDetectedCode(code);
    setManualError(null);
    onDetectedRef.current(code, "manual");
  };

  const isCameraActive = cameraStatus === "active";
  const isCameraBusy = cameraStatus === "requesting";

  return (
    <div className="space-y-5">
      <section aria-labelledby="camera-scanner-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              id="camera-scanner-title"
              className="flex items-center gap-2 text-sm font-semibold text-foreground"
            >
              <Camera className="size-4 text-brand" aria-hidden="true" />
              {t("camera.title")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              {t("camera.description")}
            </p>
          </div>
          {devices.length > 1 ? (
            <label className="text-xs font-medium text-muted-strong">
              <span className="sr-only">{t("camera.cameraLabel")}</span>
              <select
                aria-label={t("camera.cameraLabel")}
                value={selectedDeviceId}
                disabled={disabled || isCameraBusy || photoBusy}
                onChange={(event) => handleDeviceChange(event.target.value)}
                className="h-9 max-w-52 rounded-lg border border-border bg-surface px-3 text-xs text-foreground shadow-sm"
              >
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <div className="relative aspect-[4/3] min-h-56 overflow-hidden rounded-2xl bg-[#161a22] sm:aspect-video">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label={t("camera.previewLabel")}
            className={cn(
              "size-full object-cover transition-opacity",
              isCameraActive ? "opacity-100" : "opacity-20",
            )}
          />
          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

          {isCameraActive ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="relative size-[58%] max-h-64 max-w-64 rounded-[1.25rem] border border-white/35 shadow-[0_0_0_999px_rgb(10_13_18/0.3)]">
                <span className="absolute -left-px -top-px h-10 w-10 rounded-tl-[1.25rem] border-l-4 border-t-4 border-white" />
                <span className="absolute -right-px -top-px h-10 w-10 rounded-tr-[1.25rem] border-r-4 border-t-4 border-white" />
                <span className="absolute -bottom-px -left-px h-10 w-10 rounded-bl-[1.25rem] border-b-4 border-l-4 border-white" />
                <span className="absolute -bottom-px -right-px h-10 w-10 rounded-br-[1.25rem] border-b-4 border-r-4 border-white" />
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center text-white">
              {cameraStatus === "paused" ? (
                <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
              ) : cameraStatus === "error" ? (
                <CameraOff className="size-10 text-warning" aria-hidden="true" />
              ) : isCameraBusy ? (
                <LoaderCircle className="size-10 animate-spin text-white" aria-hidden="true" />
              ) : (
                <QrCode className="size-10 text-white/80" aria-hidden="true" />
              )}
              <p className="mt-3 text-sm font-semibold">
                {cameraStatus === "paused"
                  ? t("camera.status.paused")
                  : cameraStatus === "error"
                    ? t("camera.status.unavailable")
                    : isCameraBusy
                      ? t("camera.status.waiting")
                      : t("camera.status.off")}
              </p>
              {lastDetectedCode ? (
                <p className="mt-1 max-w-full truncate font-mono text-xs text-white/65">
                  {lastDetectedCode}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {isCameraActive ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => {
                stopCamera();
                setCameraStatus("idle");
              }}
            >
              <CameraOff className="size-3.5" aria-hidden="true" />
              {t("camera.stop")}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={disabled || isCameraBusy || photoBusy}
              onClick={() => void startCamera(selectedDeviceId || undefined)}
            >
              {isCameraBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-3.5" aria-hidden="true" />
              )}
              {t(cameraStatus === "paused" ? "camera.scanAnother" : "camera.start")}
            </Button>
          )}
        </div>

        {cameraError ? (
          <div
            role="alert"
            className="mt-3 flex gap-2 rounded-xl border border-warning-border bg-warning-soft px-3 py-2.5 text-xs leading-5 text-warning"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{cameraError}</span>
          </div>
        ) : (
          <p className="mt-2 text-[11px] leading-4 text-muted">
            {t("camera.privacy")}
          </p>
        )}
      </section>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          {t("camera.separator")}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface-subtle p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileImage className="size-4 text-muted" aria-hidden="true" />
            {t("camera.photo.title")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {t("camera.photo.description")}
          </p>
          <label
            htmlFor={uploadInputId}
            aria-disabled={disabled || photoBusy}
            className={cn(
              "mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-surface-hover",
              (disabled || photoBusy) && "pointer-events-none opacity-50",
            )}
          >
            {photoBusy ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FileImage className="size-3.5" aria-hidden="true" />
            )}
            {t(photoBusy ? "camera.photo.reading" : "camera.photo.choose")}
          </label>
          <input
            id={uploadInputId}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={disabled || photoBusy}
            className="sr-only"
            onChange={(event) => {
              const input = event.currentTarget;
              void handlePhoto(input.files?.[0]).finally(() => {
                input.value = "";
              });
            }}
          />
          {photoError ? (
            <p role="alert" className="mt-2 text-xs leading-5 text-danger">
              {photoError}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-border bg-surface-subtle p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Keyboard className="size-4 text-muted" aria-hidden="true" />
            {t("camera.manual.title")}
          </h3>
          <form className="mt-3" onSubmit={submitManualCode} noValidate>
            <label htmlFor={`${uploadInputId}-manual`} className="sr-only">
              {t("camera.manual.label")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
              <input
                id={`${uploadInputId}-manual`}
                value={manualCode}
                disabled={disabled || photoBusy}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("camera.manual.placeholder")}
                onChange={(event) => {
                  setManualCode(event.target.value);
                  if (manualError) setManualError(null);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-xs text-foreground shadow-sm placeholder:font-sans placeholder:text-muted"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={disabled || photoBusy}
              >
                {t("camera.manual.use")}
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-muted">
              {t("camera.manual.help")}
            </p>
            {manualError ? (
              <p role="alert" className="mt-2 text-xs text-danger">
                {manualError}
              </p>
            ) : null}
          </form>
        </section>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {lastDetectedCode ? t("camera.detected", { code: lastDetectedCode }) : ""}
      </p>
    </div>
  );
}
