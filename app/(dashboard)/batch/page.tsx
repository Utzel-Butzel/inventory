"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  AlertTriangle,
  Aperture,
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  CircleStop,
  FileImage,
  ImagePlus,
  LoaderCircle,
  LocateFixed,
  MapPin,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MAX_PHOTOS = 12;
const MAX_CAPTURE_EDGE = 1920;

const FALLBACK_RESOURCE_TYPES = [
  { value: "object", label: "Object" },
  { value: "tool", label: "Tool" },
  { value: "furniture", label: "Furniture" },
  { value: "clothing", label: "Clothing" },
  { value: "vehicle", label: "Vehicle" },
  { value: "place", label: "Place" },
  { value: "person", label: "Person" },
  { value: "project", label: "Project" },
  { value: "other", label: "Other" },
] as const;

type ResourceType = string;
type InventoryTypeOption = { key: string; label: string };
type CameraState = "idle" | "requesting" | "ready" | "error";
type GeoState = "idle" | "requesting" | "ready" | "error";
type JobState = "running" | "complete" | "warning" | "error";
type JobStage =
  | "creating"
  | "uploading"
  | "analyzing"
  | "cover"
  | "complete";

type CapturedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

type Coordinates = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
};

type Resource = {
  id: string;
  name: string;
};

type BatchJob = {
  id: string;
  createdAt: string;
  photoCount: number;
  stage: JobStage;
  state: JobState;
  progress: number;
  coverRequested: boolean;
  resourceId?: string;
  resourceName?: string;
  message?: string;
};

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
]);

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const readError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Fall through to the status text when an endpoint did not return JSON.
  }
  return response.statusText || `Request failed (${response.status})`;
};

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

const cameraErrorMessage = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera access was blocked. Allow it in your browser settings, or upload photos instead.";
    }
    if (error.name === "NotFoundError") return "No camera was found on this device.";
    if (error.name === "NotReadableError") {
      return "The camera is already in use by another app.";
    }
  }
  return error instanceof Error ? error.message : "The camera could not be opened.";
};

const stageLabel = (job: BatchJob) => {
  if (job.state === "complete") return "Ready";
  if (job.state === "warning") return "Saved with a warning";
  if (job.state === "error") return "Needs attention";
  if (job.stage === "creating") return "Creating item";
  if (job.stage === "uploading") return "Uploading photos";
  if (job.stage === "analyzing") return "AI is identifying it";
  if (job.stage === "cover") return "Generating cover";
  return "Processing";
};

export default function BatchCapturePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<CapturedPhoto[]>([]);

  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);

  const [resourceType, setResourceType] = useState<ResourceType>("object");
  const [resourceTypes, setResourceTypes] = useState<InventoryTypeOption[]>(
    FALLBACK_RESOURCE_TYPES.map(({ value, label }) => ({ key: value, label })),
  );
  const [locationName, setLocationName] = useState("");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [geoState, setGeoState] = useState<GeoState>("idle");
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [autoGenerateCover, setAutoGenerateCover] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<BatchJob[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/inventory-types", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<{ types: InventoryTypeOption[] }>;
      })
      .then(({ types }) => {
        if (active && types.length) setResourceTypes(types);
      })
      .catch(() => {
        // Keep the built-in fallback list when type configuration is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  const updatePhotos = useCallback(
    (updater: (current: CapturedPhoto[]) => CapturedPhoto[]) => {
      setPhotos((current) => {
        const next = updater(current);
        photosRef.current = next;
        return next;
      });
    },
    [],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsVideoReady(false);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const available = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "videoinput",
    );
    setDevices(available);
    return available;
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      setCameraMessage(null);
      setFormError(null);
      setCameraState("requesting");
      setIsVideoReady(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("error");
        setCameraMessage(
          "Live camera capture is not supported here. Open this page over HTTPS or upload photos instead.",
        );
        return;
      }

      stopCamera();

      const candidates: MediaStreamConstraints[] = deviceId
        ? [
            { video: { deviceId: { exact: deviceId } }, audio: false },
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            { video: true, audio: false },
          ]
        : [
            { video: { facingMode: { exact: "environment" } }, audio: false },
            { video: { facingMode: { ideal: "environment" } }, audio: false },
            { video: true, audio: false },
          ];

      let nextStream: MediaStream | null = null;
      let lastError: unknown = null;
      for (const constraints of candidates) {
        try {
          nextStream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!nextStream) {
        setCameraState("error");
        setCameraMessage(cameraErrorMessage(lastError));
        return;
      }

      streamRef.current = nextStream;
      const track = nextStream.getVideoTracks()[0];
      const activeDeviceId = track?.getSettings().deviceId;
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId);

      try {
        const available = await refreshDevices();
        const rearCamera = available?.find((device) =>
          /(back|rear|environment|world)/i.test(device.label),
        );
        if (!deviceId && rearCamera && rearCamera.deviceId !== activeDeviceId) {
          const rearStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: rearCamera.deviceId } },
            audio: false,
          });
          nextStream.getTracks().forEach((item) => item.stop());
          streamRef.current = rearStream;
          nextStream = rearStream;
          setSelectedDeviceId(rearCamera.deviceId);
        }
      } catch {
        // The facing-mode stream is still usable when device labels are hidden.
      }

      if (videoRef.current) {
        videoRef.current.srcObject = nextStream;
        try {
          await videoRef.current.play();
        } catch {
          // The video can still start through its autoplay attribute.
        }
      }
      setCameraState("ready");
    },
    [refreshDevices, stopCamera],
  );

  useEffect(() => {
    if (!navigator.mediaDevices) return;
    const handleDeviceChange = () => void refreshDevices();
    void refreshDevices().catch(() => undefined);
    navigator.mediaDevices.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener?.(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [refreshDevices]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    },
    [],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      setFormError(null);
      const supported = incoming.filter((file) =>
        supportedImageTypes.has(file.type),
      );
      const unsupportedCount = incoming.length - supported.length;
      const openSlots = MAX_PHOTOS - photosRef.current.length;
      const accepted = supported.slice(0, openSlots).map((file) => ({
        id: makeId(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      const skippedForLimit = supported.length - accepted.length;
      if (unsupportedCount || skippedForLimit) {
        const details = [
          unsupportedCount
            ? `${unsupportedCount} unsupported file${unsupportedCount === 1 ? "" : "s"}`
            : "",
          skippedForLimit
            ? `${skippedForLimit} over the ${MAX_PHOTOS}-photo limit`
            : "",
        ]
          .filter(Boolean)
          .join(" and ");
        setFormError(`Skipped ${details}.`);
      }
      updatePhotos((current) => [...current, ...accepted]);
    },
    [updatePhotos],
  );

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !isVideoReady || video.readyState < 2) {
      setFormError("The camera is still warming up. Try again in a moment.");
      return;
    }
    if (photosRef.current.length >= MAX_PHOTOS) {
      setFormError(`Each item can contain up to ${MAX_PHOTOS} photos.`);
      return;
    }

    setFormError(null);
    setIsCapturing(true);
    try {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) throw new Error("Camera frame is not ready.");
      const scale = Math.min(
        1,
        MAX_CAPTURE_EDGE / Math.max(sourceWidth, sourceHeight),
      );
      const width = Math.round(sourceWidth * scale);
      const height = Math.round(sourceHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot capture the frame.");
      context.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("The photo could not be processed.");
      const file = new File([blob], `capture-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      addFiles([file]);
      setShutterFlash(true);
      window.setTimeout(() => setShutterFlash(false), 120);
      navigator.vibrate?.(35);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "The photo could not be captured.",
      );
    } finally {
      setIsCapturing(false);
    }
  }, [addFiles, isVideoReady]);

  const removePhoto = (photoId: string) => {
    updatePhotos((current) => {
      const target = current.find((photo) => photo.id === photoId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((photo) => photo.id !== photoId);
    });
  };

  const requestLocation = useCallback(() => {
    setGeoMessage(null);
    if (!navigator.geolocation) {
      setGeoState("error");
      setGeoMessage("Geolocation is not supported by this browser.");
      return;
    }
    setGeoState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          accuracy: position.coords.accuracy,
        });
        setGeoState("ready");
      },
      (error) => {
        setGeoState("error");
        setGeoMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location access was blocked. You can still save this item without coordinates."
            : "Your current location could not be determined.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);

  const patchJob = useCallback(
    (jobId: string, values: Partial<BatchJob>) => {
      setJobs((current) =>
        current.map((job) => (job.id === jobId ? { ...job, ...values } : job)),
      );
    },
    [],
  );

  const processBatch = useCallback(
    async (
      jobId: string,
      files: File[],
      input: {
        type: ResourceType;
        locationName: string;
        coordinates: Coordinates | null;
        cover: boolean;
      },
    ) => {
      let createdResource: Resource | undefined;
      try {
        const created = await requestJson<{ resource: Resource }>(
          "/api/v1/resources",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "Untitled item",
              description: "",
              type: input.type,
              status: "available",
              quantity: 1,
              location: input.locationName.trim() || null,
              gpsLatitude: input.coordinates?.latitude ?? null,
              gpsLongitude: input.coordinates?.longitude ?? null,
              gpsAltitude: input.coordinates?.altitude ?? null,
            }),
          },
        );
        createdResource = created.resource;
        patchJob(jobId, {
          resourceId: created.resource.id,
          resourceName: created.resource.name,
          stage: "uploading",
          progress: 24,
        });

        const upload = new FormData();
        files.forEach((file) => upload.append("files", file, file.name));
        await requestJson(`/api/v1/resources/${created.resource.id}/media`, {
          method: "POST",
          body: upload,
        });
        patchJob(jobId, { stage: "analyzing", progress: 58 });

        let analyzedResource = created.resource;
        try {
          const analyzed = await requestJson<{ resource: Resource }>(
            `/api/v1/resources/${created.resource.id}/analyze`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ overwrite: true }),
            },
          );
          analyzedResource = analyzed.resource;
          patchJob(jobId, {
            resourceName: analyzed.resource.name,
            progress: input.cover ? 78 : 100,
          });
        } catch (error) {
          patchJob(jobId, {
            state: "warning",
            stage: "complete",
            progress: 100,
            message: `Item and photos saved, but AI analysis failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          });
          return;
        }

        if (input.cover) {
          patchJob(jobId, { stage: "cover", progress: 82 });
          try {
            const covered = await requestJson<{ resource: Resource }>(
              `/api/v1/resources/${created.resource.id}/cover`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({}),
              },
            );
            analyzedResource = covered.resource;
          } catch (error) {
            patchJob(jobId, {
              state: "warning",
              stage: "complete",
              progress: 100,
              resourceName: analyzedResource.name,
              message: `Item analyzed, but its AI cover failed: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            });
            return;
          }
        }

        patchJob(jobId, {
          state: "complete",
          stage: "complete",
          progress: 100,
          resourceName: analyzedResource.name,
          message: input.cover
            ? "Item, metadata, and AI cover are ready."
            : "Item and AI metadata are ready.",
        });
      } catch (error) {
        patchJob(jobId, {
          state: "error",
          stage: "complete",
          progress: 100,
          resourceId: createdResource?.id,
          resourceName: createdResource?.name,
          message:
            error instanceof Error ? error.message : "This batch could not be saved.",
        });
      }
    },
    [patchJob],
  );

  const sendBatch = () => {
    if (!photos.length) {
      setFormError("Take or upload at least one photo first.");
      return;
    }
    const files = photos.map((photo) => photo.file);
    const jobId = makeId();
    const job: BatchJob = {
      id: jobId,
      createdAt: new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date()),
      photoCount: files.length,
      stage: "creating",
      state: "running",
      progress: 8,
      coverRequested: autoGenerateCover,
    };
    setJobs((current) => [job, ...current]);
    const input = {
      type: resourceType,
      locationName,
      coordinates,
      cover: autoGenerateCover,
    };

    updatePhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      return [];
    });
    setFormError(null);
    void processBatch(jobId, files, input);
  };

  const coordinateLabel = useMemo(() => {
    if (!coordinates) return null;
    return `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(
      5,
    )}`;
  }, [coordinates]);

  const activeJobs = jobs.filter((job) => job.state === "running").length;

  return (
    <div className="min-h-full bg-[#f4f5f0] text-[#1d211b]">
      <div className="mx-auto w-full max-w-[1540px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/inventory"
              className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[#687065] transition hover:text-[#20251f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635bff] focus-visible:ring-offset-2"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Inventory
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#20251f] text-[#dfff71] shadow-sm">
                <Aperture className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8277]">
                  Fast intake
                </p>
                <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                  Batch capture
                </h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-[#dfe2d9] bg-white px-3 py-2 text-xs font-medium text-[#687065] shadow-sm sm:self-auto">
            <span
              className={`h-2 w-2 rounded-full ${
                activeJobs ? "animate-pulse bg-[#635bff]" : "bg-[#9ba397]"
              }`}
            />
            {activeJobs
              ? `${activeJobs} ${activeJobs === 1 ? "item" : "items"} processing`
              : "Ready for the next item"}
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.62fr)]">
          <section
            className="overflow-hidden rounded-[28px] border border-black/10 bg-[#11130f] shadow-[0_18px_50px_rgba(25,29,22,0.12)]"
            aria-labelledby="camera-heading"
          >
            <div className="relative aspect-[4/3] min-h-[340px] max-h-[680px] w-full overflow-hidden bg-[#11130f] sm:aspect-[16/10]">
              <h2 id="camera-heading" className="sr-only">
                Camera capture
              </h2>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onCanPlay={() => setIsVideoReady(true)}
                className={`h-full w-full object-cover transition-opacity duration-500 ${
                  cameraState === "ready" ? "opacity-100" : "opacity-0"
                }`}
                aria-label="Live camera preview"
              />

              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.42),transparent_28%,transparent_70%,rgba(0,0,0,0.55))]" />
              <div
                className={`pointer-events-none absolute inset-0 z-30 bg-white transition-opacity duration-150 ${
                  shutterFlash ? "opacity-70" : "opacity-0"
                }`}
              />

              <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 p-3 sm:p-4">
                <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-2 text-xs font-medium text-white backdrop-blur-md">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      cameraState === "ready" && isVideoReady
                        ? "bg-[#dfff71]"
                        : cameraState === "requesting"
                          ? "animate-pulse bg-amber-300"
                          : "bg-white/45"
                    }`}
                  />
                  {cameraState === "ready" && isVideoReady
                    ? "Camera ready"
                    : cameraState === "requesting"
                      ? "Opening camera"
                      : "Camera off"}
                </div>

                {devices.length > 1 ? (
                  <label className="relative max-w-[58%]">
                    <span className="sr-only">Camera device</span>
                    <select
                      value={selectedDeviceId}
                      onChange={(event) => {
                        const deviceId = event.target.value;
                        setSelectedDeviceId(deviceId);
                        void startCamera(deviceId);
                      }}
                      className="max-w-full appearance-none truncate rounded-full border border-white/15 bg-black/35 py-2 pl-3 pr-9 text-xs font-medium text-white outline-none backdrop-blur-md focus:ring-2 focus:ring-[#dfff71]"
                    >
                      {devices.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Camera ${index + 1}`}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white"
                      aria-hidden="true"
                    />
                  </label>
                ) : null}
              </div>

              {cameraState !== "ready" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                  <div className="mb-5 grid h-20 w-20 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white shadow-inner">
                    {cameraState === "requesting" ? (
                      <LoaderCircle
                        className="h-8 w-8 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Video className="h-8 w-8" aria-hidden="true" />
                    )}
                  </div>
                  <p className="max-w-sm text-lg font-semibold text-white">
                    {cameraState === "error"
                      ? "Camera unavailable"
                      : cameraState === "requesting"
                        ? "Waiting for permission…"
                        : "Photograph the item in place"}
                  </p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
                    {cameraMessage ??
                      "We’ll prefer the rear camera. You can also upload existing images at any time."}
                  </p>
                  {cameraState !== "requesting" ? (
                    <button
                      type="button"
                      onClick={() => void startCamera(selectedDeviceId)}
                      className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#dfff71] px-5 py-2.5 text-sm font-semibold text-[#20251f] transition hover:bg-[#e8ff9a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#11130f]"
                    >
                      <Camera className="h-4 w-4" aria-hidden="true" />
                      {cameraState === "error" ? "Try camera again" : "Allow camera"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-4 sm:p-6">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="group flex h-12 min-w-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dfff71] sm:px-4"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
                <button
                  type="button"
                  onClick={() => void capturePhoto()}
                  disabled={
                    cameraState !== "ready" ||
                    !isVideoReady ||
                    isCapturing ||
                    photos.length >= MAX_PHOTOS
                  }
                  aria-label="Take photo"
                  className="grid h-[74px] w-[74px] place-items-center rounded-full border-[5px] border-white bg-white/20 shadow-[0_4px_24px_rgba(0,0,0,0.35)] transition hover:scale-[1.04] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dfff71] focus-visible:ring-offset-4 focus-visible:ring-offset-black"
                >
                  <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-white text-[#171a15]">
                    {isCapturing ? (
                      <LoaderCircle
                        className="h-5 w-5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Camera className="h-5 w-5" aria-hidden="true" />
                    )}
                  </span>
                </button>
                {cameraState === "ready" ? (
                  <button
                    type="button"
                    onClick={() => {
                      stopCamera();
                      setCameraState("idle");
                    }}
                    className="flex h-12 min-w-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dfff71] sm:px-4"
                  >
                    <CircleStop className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Stop</span>
                  </button>
                ) : (
                  <div className="h-12 min-w-12" aria-hidden="true" />
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
                className="sr-only"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
            </div>

            <div className="border-t border-white/10 px-4 py-4 text-white sm:px-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    Photo tray
                    <span className="ml-2 font-normal text-white/45">
                      {photos.length}/{MAX_PHOTOS}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-white/40">
                    Add several angles for a better AI result.
                  </p>
                </div>
                {photos.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      updatePhotos((current) => {
                        current.forEach((photo) =>
                          URL.revokeObjectURL(photo.previewUrl),
                        );
                        return [];
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-white/55 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dfff71]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Clear
                  </button>
                ) : null}
              </div>

              {photos.length ? (
                <div className="flex gap-3 overflow-x-auto pb-1" aria-label="Selected photos">
                  {photos.map((photo, index) => (
                    <div
                      key={photo.id}
                      className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-white/5"
                    >
                      <img
                        src={photo.previewUrl}
                        alt={`Selected item view ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                      {index === 0 ? (
                        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                          Primary
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removePhoto(photo.id)}
                        aria-label={`Remove photo ${index + 1}`}
                        className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white shadow-sm transition hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dfff71]"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="grid h-24 w-24 shrink-0 place-items-center rounded-2xl border border-dashed border-white/20 text-white/45 transition hover:border-white/40 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dfff71]"
                      aria-label="Add more photos"
                    >
                      <ImagePlus className="h-5 w-5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-white/15 px-4 py-4 text-left transition hover:border-white/30 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#dfff71]"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/60">
                    <FileImage className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-white/75">
                      No photos yet
                    </span>
                    <span className="mt-0.5 block text-xs text-white/40">
                      Take a photo or choose images from this device.
                    </span>
                  </span>
                </button>
              )}
            </div>
          </section>

          <aside className="flex flex-col rounded-[28px] border border-[#dfe2d9] bg-white p-5 shadow-[0_12px_36px_rgba(25,29,22,0.06)] sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8a9187]">
                  Defaults
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]">
                  Describe the batch
                </h2>
              </div>
              <span className="rounded-full bg-[#f0f1ec] px-2.5 py-1 text-[11px] font-semibold text-[#737a70]">
                Optional
              </span>
            </div>

            <div className="space-y-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#363b34]">
                  Item type
                </span>
                <span className="relative block">
                  <select
                    value={resourceType}
                    onChange={(event) =>
                      setResourceType(event.target.value as ResourceType)
                    }
                    className="h-12 w-full appearance-none rounded-2xl border border-[#dde0d7] bg-[#f8f9f5] px-4 pr-10 text-sm font-medium outline-none transition focus:border-[#635bff] focus:bg-white focus:ring-4 focus:ring-[#635bff]/10"
                  >
                    {resourceTypes.map((type) => (
                      <option key={type.key} value={type.key}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#767d73]"
                    aria-hidden="true"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#363b34]">
                  Location label
                </span>
                <span className="relative block">
                  <MapPin
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#81887e]"
                    aria-hidden="true"
                  />
                  <input
                    value={locationName}
                    onChange={(event) => setLocationName(event.target.value)}
                    maxLength={240}
                    placeholder="e.g. Workshop · Shelf B2"
                    className="h-12 w-full rounded-2xl border border-[#dde0d7] bg-[#f8f9f5] pl-11 pr-4 text-sm outline-none transition placeholder:text-[#a2a89f] focus:border-[#635bff] focus:bg-white focus:ring-4 focus:ring-[#635bff]/10"
                  />
                </span>
              </label>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[#363b34]">
                    GPS coordinates
                  </span>
                  {coordinates ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCoordinates(null);
                        setGeoState("idle");
                        setGeoMessage(null);
                      }}
                      className="text-xs font-medium text-[#777e74] underline-offset-2 hover:text-[#30352e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635bff]"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={requestLocation}
                  disabled={geoState === "requesting"}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635bff] focus-visible:ring-offset-2 ${
                    coordinates
                      ? "border-[#cce99a] bg-[#f5ffe5]"
                      : "border-[#dde0d7] bg-[#f8f9f5] hover:border-[#c9cdc3] hover:bg-white"
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                      coordinates
                        ? "bg-[#dfff71] text-[#32372f]"
                        : "bg-white text-[#737a70] shadow-sm"
                    }`}
                  >
                    {geoState === "requesting" ? (
                      <LoaderCircle
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : coordinates ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <LocateFixed className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[#363b34]">
                      {coordinates
                        ? coordinateLabel
                        : geoState === "requesting"
                          ? "Finding your location…"
                          : "Use current location"}
                    </span>
                    <span className="mt-0.5 block text-xs text-[#858c82]">
                      {coordinates
                        ? `Accurate to about ${Math.round(coordinates.accuracy)} m · Tap to refresh`
                        : "Saved privately with this inventory item"}
                    </span>
                  </span>
                  {coordinates ? (
                    <RefreshCw
                      className="ml-auto h-3.5 w-3.5 shrink-0 text-[#7e857b]"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
                {geoMessage ? (
                  <p className="mt-2 text-xs leading-5 text-amber-700">{geoMessage}</p>
                ) : null}
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-[#dedcfb] bg-[#f7f6ff] p-4">
                <span className="flex min-w-0 items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#635bff] text-white shadow-sm shadow-[#635bff]/25">
                    <WandSparkles className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-[#353251]">
                      Generate AI cover
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-[#777392]">
                      Identify the item, then create a clean studio cover from the first photo.
                    </span>
                  </span>
                </span>
                <span className="relative shrink-0">
                  <input
                    type="checkbox"
                    checked={autoGenerateCover}
                    onChange={(event) => setAutoGenerateCover(event.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="block h-6 w-11 rounded-full bg-[#c9c7df] transition peer-checked:bg-[#635bff] peer-focus-visible:ring-2 peer-focus-visible:ring-[#635bff] peer-focus-visible:ring-offset-2" />
                  <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
                </span>
              </label>
            </div>

            <div className="mt-auto pt-6">
              {formError ? (
                <div
                  role="alert"
                  className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700"
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  {formError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={sendBatch}
                disabled={!photos.length}
                className="group flex min-h-14 w-full items-center justify-between rounded-2xl bg-[#20251f] px-5 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(32,37,31,0.18)] transition hover:-translate-y-0.5 hover:bg-[#2b3129] hover:shadow-[0_14px_30px_rgba(32,37,31,0.22)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-[#c8ccc4] disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635bff] focus-visible:ring-offset-2"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Create with AI
                </span>
                <span className="flex items-center gap-2 text-white/65 group-hover:text-white group-disabled:text-white/70">
                  {photos.length
                    ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"}`
                    : "Add photos"}
                  <Send className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-[#92988f]">
                The tray clears immediately, so you can capture the next item while AI works.
              </p>
            </div>
          </aside>
        </div>

        <section className="mt-6" aria-labelledby="jobs-heading" aria-live="polite">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8a9187]">
                Background queue
              </p>
              <h2 id="jobs-heading" className="mt-1 text-lg font-semibold">
                Recent captures
              </h2>
            </div>
            {jobs.length ? (
              <button
                type="button"
                onClick={() =>
                  setJobs((current) =>
                    current.filter((job) => job.state === "running"),
                  )
                }
                className="rounded-lg px-2 py-1.5 text-xs font-medium text-[#747b71] transition hover:bg-white hover:text-[#30352e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635bff]"
              >
                Clear finished
              </button>
            ) : null}
          </div>

          {jobs.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {jobs.map((job) => (
                <article
                  key={job.id}
                  className="rounded-2xl border border-[#dfe2d9] bg-white p-4 shadow-[0_6px_20px_rgba(25,29,22,0.04)]"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                        job.state === "running"
                          ? "bg-[#efeeff] text-[#635bff]"
                          : job.state === "complete"
                            ? "bg-[#effbd9] text-[#4c7118]"
                            : job.state === "warning"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700"
                      }`}
                    >
                      {job.state === "running" ? (
                        <LoaderCircle
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : job.state === "complete" ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#343a32]">
                            {job.resourceName && job.resourceName !== "Untitled item"
                              ? job.resourceName
                              : `${job.photoCount}-photo capture`}
                          </p>
                          <p className="mt-0.5 text-xs text-[#8a9187]">
                            {job.createdAt} · {stageLabel(job)}
                          </p>
                        </div>
                        {job.resourceId ? (
                          <Link
                            href={`/inventory/${job.resourceId}`}
                            className="shrink-0 rounded-full bg-[#f1f2ed] px-3 py-1.5 text-xs font-semibold text-[#4f564d] transition hover:bg-[#e6e8e1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635bff]"
                          >
                            Open item
                          </Link>
                        ) : null}
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#eceee8]">
                        <div
                          className={`h-full rounded-full transition-[width] duration-500 ${
                            job.state === "error"
                              ? "bg-red-500"
                              : job.state === "warning"
                                ? "bg-amber-500"
                                : job.state === "complete"
                                  ? "bg-[#87b438]"
                                  : "bg-[#635bff]"
                          }`}
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      {job.message ? (
                        <p
                          className={`mt-2 text-xs leading-5 ${
                            job.state === "error"
                              ? "text-red-700"
                              : job.state === "warning"
                                ? "text-amber-700"
                                : "text-[#777e74]"
                          }`}
                        >
                          {job.message}
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#8c9389]">
                          <span
                            className={
                              job.stage !== "creating" ? "text-[#526b2e]" : ""
                            }
                          >
                            Save item
                          </span>
                          <span
                            className={
                              ["analyzing", "cover", "complete"].includes(job.stage)
                                ? "text-[#526b2e]"
                                : ""
                            }
                          >
                            Upload
                          </span>
                          <span
                            className={
                              ["cover", "complete"].includes(job.stage)
                                ? "text-[#526b2e]"
                                : ""
                            }
                          >
                            Analyze
                          </span>
                          {job.coverRequested ? (
                            <span
                              className={
                                job.stage === "complete" ? "text-[#526b2e]" : ""
                              }
                            >
                              Cover
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-[#d5d9cf] bg-white/45 px-6 text-center">
              <div>
                <ImagePlus
                  className="mx-auto h-5 w-5 text-[#949b91]"
                  aria-hidden="true"
                />
                <p className="mt-2 text-sm font-medium text-[#687065]">
                  Nothing queued yet
                </p>
                <p className="mt-1 text-xs text-[#969c93]">
                  Completed and in-progress items will stay visible here.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
