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
import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
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

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was blocked. Allow camera access in your browser settings, then try again.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No camera was found on this device. You can upload a photo or enter the code manually.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The camera is already in use or could not be started. Close other camera apps and try again.";
    }
    if (error.name === "OverconstrainedError") {
      return "The selected camera is not available. Choose another camera or try again.";
    }
  }
  return "The camera could not be started. You can still upload a photo or enter the code manually.";
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
          "Camera access requires a secure HTTPS connection. Open this page over HTTPS, or use photo upload/manual entry below.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus("error");
        setCameraError(
          "This browser does not provide camera access. Use photo upload or manual entry below.",
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
              label: device.label || `Camera ${index + 1}`,
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
        setCameraError(cameraErrorMessage(error));
      }
    },
    [invalidatePhoto, stopCamera],
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
          "No QR code was found. Try a closer, sharper photo with the whole code visible, or enter the code manually.",
        );
        return;
      }
      setLastDetectedCode(code);
      setCameraStatus("paused");
      onDetectedRef.current(code, "photo");
    } catch {
      if (generation !== photoGenerationRef.current) return;
      setPhotoError(
        "This image could not be read. Try another photo or enter the code manually.",
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
      setManualError("Enter the complete content expected by the selected workflow.");
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
              className="flex items-center gap-2 text-sm font-semibold text-[#292c31]"
            >
              <Camera className="size-4 text-[#5147d9]" aria-hidden="true" />
              Scan with camera
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#5f6672]">
              Hold the complete QR code inside the frame.
            </p>
          </div>
          {devices.length > 1 ? (
            <label className="text-xs font-medium text-[#555c67]">
              <span className="sr-only">Camera</span>
              <select
                aria-label="Camera"
                value={selectedDeviceId}
                disabled={disabled || isCameraBusy || photoBusy}
                onChange={(event) => handleDeviceChange(event.target.value)}
                className="h-9 max-w-52 rounded-lg border border-[#dfe2e7] bg-white px-3 text-xs text-[#34383f] shadow-sm"
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
            aria-label="Live camera preview for QR-code scanning"
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
                <CheckCircle2 className="size-10 text-emerald-400" aria-hidden="true" />
              ) : cameraStatus === "error" ? (
                <CameraOff className="size-10 text-amber-300" aria-hidden="true" />
              ) : isCameraBusy ? (
                <LoaderCircle className="size-10 animate-spin text-white" aria-hidden="true" />
              ) : (
                <QrCode className="size-10 text-white/80" aria-hidden="true" />
              )}
              <p className="mt-3 text-sm font-semibold">
                {cameraStatus === "paused"
                  ? "Scanner paused after detection"
                  : cameraStatus === "error"
                    ? "Camera unavailable"
                    : isCameraBusy
                      ? "Waiting for camera permission…"
                      : "Camera is off"}
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
              Stop camera
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
              {cameraStatus === "paused" ? "Scan another code" : "Start camera"}
            </Button>
          )}
        </div>

        {cameraError ? (
          <div
            role="alert"
            className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{cameraError}</span>
          </div>
        ) : (
          <p className="mt-2 text-[11px] leading-4 text-[#5f6672]">
            Camera access works on HTTPS or localhost. The video stays on this device and is
            only inspected for QR codes.
          </p>
        )}
      </section>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-[#e4e7eb]" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5f6672]">
          or
        </span>
        <span className="h-px flex-1 bg-[#e4e7eb]" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border border-[#e4e7eb] bg-[#f9fafb] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[#34383f]">
            <FileImage className="size-4 text-[#5f6672]" aria-hidden="true" />
            Upload a QR photo
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#5f6672]">
            Useful when camera access is blocked or the label is hard to reach.
          </p>
          <label
            htmlFor={uploadInputId}
            aria-disabled={disabled || photoBusy}
            className={cn(
              "mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dfe2e7] bg-white px-3 text-xs font-semibold text-[#34383f] shadow-sm transition hover:bg-[#f4f5f7]",
              (disabled || photoBusy) && "pointer-events-none opacity-50",
            )}
          >
            {photoBusy ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FileImage className="size-3.5" aria-hidden="true" />
            )}
            {photoBusy ? "Reading photo…" : "Choose or take photo"}
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
            <p role="alert" className="mt-2 text-xs leading-5 text-[#b83243]">
              {photoError}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-[#e4e7eb] bg-[#f9fafb] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[#34383f]">
            <Keyboard className="size-4 text-[#5f6672]" aria-hidden="true" />
            Enter code manually
          </h3>
          <form className="mt-3" onSubmit={submitManualCode} noValidate>
            <label htmlFor={`${uploadInputId}-manual`} className="sr-only">
              Complete QR-code content
            </label>
            <div className="flex flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
              <input
                id={`${uploadInputId}-manual`}
                value={manualCode}
                disabled={disabled || photoBusy}
                autoComplete="off"
                spellCheck={false}
                placeholder="Complete QR-code content"
                onChange={(event) => {
                  setManualCode(event.target.value);
                  if (manualError) setManualError(null);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border border-[#dfe2e7] bg-white px-3 font-mono text-xs text-[#292c31] shadow-sm placeholder:font-sans placeholder:text-[#5f6672]"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={disabled || photoBusy}
              >
                Use code
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-[#5f6672]">
              Enter exactly what the QR code contains. Depending on the selected workflow,
              a URL or prefixed value may be required; a bare EPD number is not always enough.
            </p>
            {manualError ? (
              <p role="alert" className="mt-2 text-xs text-[#b83243]">
                {manualError}
              </p>
            ) : null}
          </form>
        </section>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {lastDetectedCode ? `Code detected: ${lastDetectedCode}` : ""}
      </p>
    </div>
  );
}
