"use client";

import {
  AlertTriangle,
  Camera,
  Check,
  ImagePlus,
  LoaderCircle,
  ScanSearch,
  Sparkles,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ChangeEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { prepareUpload } from "@/lib/client-media";
import type { InventoryCountMarker } from "@/lib/inventory-count-contract";

const markerCoordinateMaximum = 1_000;
// The initial endpoint only reserves one asynchronous Replicate prediction.
// Keep a finite transport window for image normalization and provider setup.
const countRequestTimeoutMilliseconds = 75_000;

type RenderedImageBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PhotoCountResult = {
  count: number;
  confidence: number;
  detectedItem: string;
  isExact: boolean;
  explanation: string;
  warnings: string[];
  markers: InventoryCountMarker[];
  model: string;
};

type PhotoCountProcessing = {
  status: "processing";
  jobToken: string;
  expiresAt: string;
  message?: string;
};

type PhotoCountCaptureProps = {
  itemId: string;
  itemName: string;
  unitName: string;
  direction: "in" | "out";
  quantity: string;
  availableQuantity: number;
  disabled?: boolean;
  onCount: (result: PhotoCountResult) => void;
};

class CountRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
    readonly terminal = false,
  ) {
    super(message);
    this.name = "CountRequestError";
  }
}

async function waitForCountRetry(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

function confidencePercent(value: number) {
  const normalized = value > 1 ? value : value * 100;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

function cleanCountResult(result: PhotoCountResult) {
  if (!Number.isInteger(result.count) || result.count < 0) {
    throw new Error("The counter returned an invalid quantity. Please try another photo.");
  }
  const markers = Array.isArray(result.markers)
    ? result.markers.filter(
        (marker) =>
          marker !== null &&
          typeof marker === "object" &&
          Number.isInteger(marker.x) &&
          marker.x >= 0 &&
          marker.x <= markerCoordinateMaximum &&
          Number.isInteger(marker.y) &&
          marker.y >= 0 &&
          marker.y <= markerCoordinateMaximum,
      )
    : [];
  if (markers.length !== result.count) {
    throw new Error(
      "The counter could not place one highlight on every piece. Please try another photo.",
    );
  }
  return {
    ...result,
    confidence: Number.isFinite(result.confidence) ? result.confidence : 0,
    detectedItem: result.detectedItem?.trim() || "objects",
    explanation: result.explanation?.trim() || "",
    warnings: Array.isArray(result.warnings)
      ? result.warnings.filter((warning) => typeof warning === "string" && warning.trim())
      : [],
    markers,
    model: result.model?.trim() || "AI vision",
  };
}

async function readCountResponse(
  response: Response,
): Promise<PhotoCountResult | PhotoCountProcessing> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (response.status === 202) {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "status" in payload &&
      payload.status === "processing" &&
      "jobToken" in payload &&
      typeof payload.jobToken === "string" &&
      "expiresAt" in payload &&
      typeof payload.expiresAt === "string"
    ) {
      return payload as PhotoCountProcessing;
    }
    throw new Error("The counter returned an invalid processing response.");
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed (HTTP ${response.status}).`;
    const rawRetryAfter = response.headers.get("Retry-After");
    const retryAfterSeconds = rawRetryAfter === null ? NaN : Number(rawRetryAfter);
    throw new CountRequestError(
      message,
      response.status,
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds
        : undefined,
      typeof payload === "object" &&
        payload !== null &&
        "terminal" in payload &&
        payload.terminal === true,
    );
  }
  if (typeof payload !== "object" || payload === null || !("count" in payload)) {
    throw new Error("The counter returned an invalid result.");
  }
  return payload as PhotoCountResult;
}

async function pollCountJob(
  processing: PhotoCountProcessing,
  signal: AbortSignal,
) {
  const expiresAt = Date.parse(processing.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new Error("The counter returned an invalid job deadline.");
  }
  const deadline = Math.min(expiresAt, Date.now() + 11 * 60_000);
  let jobToken = processing.jobToken;
  let delayMilliseconds = 3_000;
  while (Date.now() < deadline) {
    await waitForCountRetry(delayMilliseconds, signal);
    try {
      const response = await fetch("/api/v1/ai/count/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobToken }),
        signal,
      });
      const payload = await readCountResponse(response);
      if ("count" in payload) return payload;
      jobToken = payload.jobToken;
      delayMilliseconds = 3_000;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof TypeError) continue;
      if (
        error instanceof CountRequestError &&
        [429, 503].includes(error.status) &&
        error.retryAfterSeconds !== undefined
      ) {
        delayMilliseconds = Math.min(
          10_000,
          Math.max(1_000, error.retryAfterSeconds * 1_000),
        );
        continue;
      }
      throw error;
    }
  }
  throw new CountRequestError(
    "Counting took too long and expired. Please try again.",
    504,
  );
}

function PhotoCountPreview({
  previewUrl,
  markers,
}: {
  previewUrl: string | null;
  markers: InventoryCountMarker[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageBounds, setImageBounds] = useState<RenderedImageBounds | null>(null);

  const updateImageBounds = useCallback(() => {
    const container = containerRef.current;
    const image = imageRef.current;
    if (!container || !image?.naturalWidth || !image.naturalHeight) {
      setImageBounds(null);
      return;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const scale = Math.min(
      containerWidth / image.naturalWidth,
      containerHeight / image.naturalHeight,
    );
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    setImageBounds({
      left: (containerWidth - width) / 2,
      top: (containerHeight - height) / 2,
      width,
      height,
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(updateImageBounds);
    observer.observe(container);
    return () => observer.disconnect();
  }, [previewUrl, updateImageBounds]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-[4/3] overflow-hidden rounded-xl border border-violet-200 bg-slate-100"
    >
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          src={previewUrl}
          alt={
            markers.length
              ? `Photo with ${markers.length} highlighted counted pieces`
              : "Photo selected for piece counting"
          }
          className="size-full object-contain"
          onLoad={updateImageBounds}
        />
      ) : null}
      {imageBounds
        ? markers.map((marker, index) => {
            const style = {
              left:
                imageBounds.left +
                (marker.x / markerCoordinateMaximum) * imageBounds.width,
              top:
                imageBounds.top +
                (marker.y / markerCoordinateMaximum) * imageBounds.height,
            } satisfies CSSProperties;
            return (
              <span
                // The index distinguishes two exceptionally close detections.
                key={`${marker.x}-${marker.y}-${index}`}
                className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600 shadow-[0_1px_4px_rgba(15,23,42,.7)] ring-2 ring-white sm:size-3.5"
                style={style}
                aria-hidden="true"
              />
            );
          })
        : null}
      {markers.length ? (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-slate-950/75 px-2 py-1 text-[9px] font-bold text-white shadow-sm backdrop-blur">
          {markers.length} highlighted
        </span>
      ) : null}
    </div>
  );
}

export function PhotoCountCapture({
  itemId,
  itemName,
  unitName,
  direction,
  quantity,
  availableQuantity,
  disabled = false,
  onCount,
}: PhotoCountCaptureProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [counting, setCounting] = useState(false);
  const [result, setResult] = useState<PhotoCountResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!image) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  function resetImage() {
    abortRef.current?.abort();
    abortRef.current = null;
    attemptIdRef.current = null;
    setImage(null);
    setResult(null);
    setError(null);
    setCounting(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setError("Choose a photo in JPG, PNG, WebP, or HEIC format.");
      return;
    }

    abortRef.current?.abort();
    attemptIdRef.current = null;
    setPreparing(true);
    setError(null);
    setResult(null);
    try {
      setImage(await prepareUpload(selected));
    } catch (prepareError) {
      setImage(null);
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "The photo could not be prepared for counting.",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function countObjects() {
    if (!image || counting) return;
    const controller = new AbortController();
    const attemptId = attemptIdRef.current ?? crypto.randomUUID();
    const isResumingAttempt = attemptIdRef.current !== null;
    attemptIdRef.current = attemptId;
    let didReceiveJob = false;
    let didTimeOut = false;
    let timeout = window.setTimeout(() => {
      didTimeOut = true;
      controller.abort();
    }, countRequestTimeoutMilliseconds);
    abortRef.current?.abort();
    abortRef.current = controller;
    setCounting(true);
    setError(null);
    setResult(null);

    try {
      const startRetryDeadline = Date.now() + (isResumingAttempt ? 4_000 : 25_000);
      let initial: PhotoCountResult | PhotoCountProcessing;
      while (true) {
        const body = new FormData();
        body.append("image", image, image.name || "stock-count.jpg");
        body.append("itemHint", itemName.slice(0, 240));
        body.append("itemId", itemId);
        try {
          initial = await readCountResponse(
            await fetch("/api/v1/ai/count", {
              method: "POST",
              headers: { "Idempotency-Key": attemptId },
              body,
              signal: controller.signal,
            }),
          );
          break;
        } catch (error) {
          if (
            error instanceof CountRequestError &&
            error.status === 409 &&
            error.retryAfterSeconds !== undefined &&
            Date.now() < startRetryDeadline
          ) {
            await waitForCountRetry(
              Math.min(
                Math.max(250, startRetryDeadline - Date.now()),
                error.retryAfterSeconds * 1_000,
              ),
              controller.signal,
            );
            continue;
          }
          throw error;
        }
      }
      let rawResult: PhotoCountResult;
      if ("count" in initial) {
        rawResult = initial;
      } else {
        didReceiveJob = true;
        const expiresAt = Date.parse(initial.expiresAt);
        const remainingMilliseconds = Number.isFinite(expiresAt)
          ? Math.max(10_000, expiresAt - Date.now() + 10_000)
          : 5 * 60_000 + 10_000;
        window.clearTimeout(timeout);
        timeout = window.setTimeout(() => {
          didTimeOut = true;
          controller.abort();
        }, Math.min(remainingMilliseconds, 11 * 60_000));
        rawResult = await pollCountJob(initial, controller.signal);
      }
      attemptIdRef.current = null;
      const response = cleanCountResult(rawResult);
      setResult(response);
      if (response.count > 0) onCount(response);
    } catch (countError) {
      if (didTimeOut) {
        if (didReceiveJob) attemptIdRef.current = null;
        setError("Counting took too long and was stopped. Please try another photo.");
        return;
      }
      if (controller.signal.aborted) return;
      if (
        !didReceiveJob &&
        countError instanceof CountRequestError &&
        !(
          countError.status === 409 &&
          countError.retryAfterSeconds !== undefined
        )
      ) {
        attemptIdRef.current = null;
      }
      if (
        didReceiveJob &&
        countError instanceof CountRequestError &&
        countError.terminal
      ) {
        attemptIdRef.current = null;
      }
      setError(
        countError instanceof Error
          ? countError.message
          : "The objects could not be counted from this photo.",
      );
    } finally {
      window.clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted || didTimeOut) setCounting(false);
    }
  }

  const busy = preparing || counting;
  const confidence = result ? confidencePercent(result.confidence) : 0;
  const selectedQuantity = Number(quantity);
  const exceedsAvailable =
    result !== null &&
    direction === "out" &&
    Number.isFinite(selectedQuantity) &&
    selectedQuantity > availableQuantity;

  if (!expanded) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded(true)}
        className="mb-5 flex w-full items-center justify-between gap-4 rounded-2xl border border-violet-200 bg-[linear-gradient(135deg,rgba(245,243,255,.96),rgba(255,255,255,.96))] px-4 py-3.5 text-left transition hover:border-violet-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white shadow-sm shadow-violet-600/20">
            <Camera className="size-4.5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-slate-900">
              Count pieces from a photo
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-slate-600">
              Take a photo and let AI fill the quantity.
            </span>
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 shadow-sm">
          Try it
        </span>
      </button>
    );
  }

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/40">
      <div className="flex items-start justify-between gap-3 border-b border-violet-100 bg-white/75 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">
            <ScanSearch className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-xs font-semibold text-slate-900">Photo piece counter</h3>
            <p className="mt-0.5 text-[10px] leading-4 text-slate-600">
              Spread pieces out, shoot from above, and avoid overlaps where possible.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            resetImage();
            setExpanded(false);
          }}
          disabled={busy}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          aria-label="Close photo counter"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="p-4">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => void selectImage(event)}
          disabled={busy || disabled}
          className="sr-only"
        />

        {!image ? (
          <label
            htmlFor={inputId}
            className={`flex min-h-28 flex-col items-center justify-center rounded-xl border-2 border-dashed border-violet-200 bg-white px-5 py-5 text-center transition ${
              busy || disabled
                ? "cursor-wait opacity-55"
                : "cursor-pointer hover:border-violet-400 hover:bg-violet-50/50"
            }`}
          >
            {preparing ? (
              <LoaderCircle className="size-5 animate-spin text-violet-600" aria-hidden="true" />
            ) : (
              <ImagePlus className="size-5 text-violet-600" aria-hidden="true" />
            )}
            <span className="mt-2 text-xs font-semibold text-slate-800">
              {preparing ? "Preparing photo…" : "Take or choose a photo"}
            </span>
            <span className="mt-1 text-[10px] text-slate-600">
              The photo is analyzed for this count and is not attached to the item.
            </span>
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.1fr)]">
            <div className="relative">
              <PhotoCountPreview
                previewUrl={previewUrl}
                markers={result?.markers ?? []}
              />
              <button
                type="button"
                onClick={resetImage}
                disabled={counting}
                className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-lg bg-slate-950/75 text-white shadow-sm transition hover:bg-slate-950 disabled:opacity-40"
                aria-label="Remove counting photo"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="flex min-w-0 flex-col justify-center">
              {!result ? (
                <>
                  <p className="truncate text-[11px] font-semibold text-slate-700">
                    {image.name || "Camera photo"}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-600">
                    AI will count visible {unitName}s matching “{itemName}”. You can correct
                    the quantity before booking.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {counting ? (
                      <button
                        type="button"
                        onClick={() => {
                          abortRef.current?.abort();
                          abortRef.current = null;
                          setCounting(false);
                          setError("Stopped waiting. You can resume the same count.");
                        }}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3.5 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50"
                      >
                        <X className="size-4" aria-hidden="true" />
                        Stop waiting
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void countObjects()}
                        disabled={busy || disabled}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-violet-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-50"
                      >
                        <Sparkles className="size-4" aria-hidden="true" />
                        Count pieces
                      </button>
                    )}
                    <label
                      htmlFor={inputId}
                      className="inline-flex h-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Replace photo
                    </label>
                  </div>
                </>
              ) : (
                <div
                  className={`rounded-xl border p-3 ${
                    result.count > 0
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-amber-200 bg-amber-50"
                  }`}
                  aria-live="polite"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      {result.count > 0 ? (
                        <Check className="size-4 text-emerald-700" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-700" aria-hidden="true" />
                      )}
                      <strong className="text-lg tabular-nums">{result.count}</strong>
                      {result.detectedItem}
                    </span>
                    <span className="rounded-full bg-white/80 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-600">
                      {confidence}% confidence
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-slate-600">
                    {result.count > 0
                      ? "Quantity filled in automatically — verify it before booking."
                      : "No matching pieces were found. Try a clearer photo."}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {result && (result.explanation || result.warnings.length > 0 || !result.isExact) ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-[10px] leading-4 text-slate-600">
            {result.explanation ? <p>{result.explanation}</p> : null}
            {!result.isExact ? (
              <p className="mt-1.5 font-semibold text-amber-700">
                This is an estimate. Check hidden or overlapping pieces carefully.
              </p>
            ) : null}
            {result.warnings.map((warning) => (
              <p key={warning} className="mt-1.5 flex items-start gap-1.5 text-amber-700">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                {warning}
              </p>
            ))}
            <p className="mt-2 text-[9px] text-slate-600">Analyzed with {result.model}</p>
          </div>
        ) : null}

        {exceedsAvailable ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[10px] leading-4 text-rose-700">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            The selected quantity exceeds the {availableQuantity.toLocaleString()} currently
            available. Correct it or switch to stock in.
          </p>
        ) : null}

        {error ? (
          <div
            className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[10px] leading-4 text-rose-700"
            role="alert"
          >
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              {error}
            </span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {result ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setError(null);
              }}
              disabled={busy}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-40"
            >
              <ScanSearch className="size-3" aria-hidden="true" /> Count again
            </button>
            <label
              htmlFor={inputId}
              className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Use another photo
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export type { PhotoCountResult };
