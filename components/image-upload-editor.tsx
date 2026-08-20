"use client";

import {
  Crop as CropIcon,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui";

type CropAspect = "original" | "square" | "four-three" | "sixteen-nine";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type SourceCrop = Size & Point;

const maximumOutputDimension = 2200;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const extensionForMimeType = (mimeType: string) => {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/heic") return "heic";
  return "jpg";
};

const outputMimeType = (mimeType: string) => {
  if (mimeType === "image/png" || mimeType === "image/webp") return mimeType;
  return "image/jpeg";
};

const fileNameParts = (file: File) => {
  const lastDot = file.name.lastIndexOf(".");
  if (lastDot > 0 && lastDot < file.name.length - 1) {
    return {
      baseName: file.name.slice(0, lastDot),
      extension: file.name.slice(lastDot + 1).toLowerCase(),
    };
  }
  return {
    baseName: file.name || "image",
    extension: extensionForMimeType(file.type),
  };
};

const cropFor = (
  image: Size,
  aspectRatio: number,
  zoom: number,
  pan: Point,
): SourceCrop => {
  const imageRatio = image.width / image.height;
  const baseWidth = imageRatio > aspectRatio
    ? image.height * aspectRatio
    : image.width;
  const baseHeight = imageRatio > aspectRatio
    ? image.height
    : image.width / aspectRatio;
  const width = baseWidth / zoom;
  const height = baseHeight / zoom;
  const centerX = image.width / 2 + pan.x * (image.width - width) / 2;
  const centerY = image.height / 2 + pan.y * (image.height - height) / 2;
  return {
    x: clamp(centerX - width / 2, 0, image.width - width),
    y: clamp(centerY - height / 2, 0, image.height - height),
    width,
    height,
  };
};

const canvasBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to create the cropped image."));
      },
      mimeType,
      0.92,
    );
  });

async function cropFile(
  file: File,
  image: HTMLImageElement,
  crop: SourceCrop,
  baseName: string,
) {
  const scale = Math.min(
    1,
    maximumOutputDimension / Math.max(crop.width, crop.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to prepare the image crop.");

  const requestedMimeType = outputMimeType(file.type);
  if (requestedMimeType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const blob = await canvasBlob(canvas, requestedMimeType);
  const mimeType = blob.type || requestedMimeType;
  return new File(
    [blob],
    `${baseName}.${extensionForMimeType(mimeType)}`,
    { type: mimeType, lastModified: Date.now() },
  );
}

export function ImageUploadEditor({
  file,
  previewUrl,
  onSave,
  onClose,
}: {
  file: File;
  previewUrl: string;
  onSave: (file: File) => void;
  onClose: () => void;
}) {
  const { t } = useT("resource");
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    pan: Point;
  } | null>(null);
  const initialName = useMemo(() => fileNameParts(file), [file]);
  const [baseName, setBaseName] = useState(initialName.baseName);
  const [aspect, setAspect] = useState<CropAspect>("original");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [imageError, setImageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const originalRatio = naturalSize
    ? naturalSize.width / naturalSize.height
    : 1;
  const aspectRatio = aspect === "square"
    ? 1
    : aspect === "four-three"
      ? 4 / 3
      : aspect === "sixteen-nine"
        ? 16 / 9
        : originalRatio;
  const crop = naturalSize
    ? cropFor(naturalSize, aspectRatio, zoom, pan)
    : null;
  const cropChanged = Boolean(
    crop && naturalSize && (
      crop.x > 0.5 ||
      crop.y > 0.5 ||
      crop.width < naturalSize.width - 0.5 ||
      crop.height < naturalSize.height - 0.5
    ),
  );
  const displayedExtension = cropChanged
    ? extensionForMimeType(outputMimeType(file.type))
    : initialName.extension;

  const imageStyle = crop && naturalSize
    ? {
        width: `${naturalSize.width / crop.width * 100}%`,
        height: `${naturalSize.height / crop.height * 100}%`,
        left: `${-crop.x / crop.width * 100}%`,
        top: `${-crop.y / crop.height * 100}%`,
      }
    : undefined;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      nameInputRef.current?.focus(),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const resetCrop = () => {
    setAspect("original");
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const startDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!crop || !naturalSize) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      pan,
    };
  };

  const dragImage = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId || !crop || !naturalSize) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontalRange = (naturalSize.width - crop.width) / 2;
    const verticalRange = (naturalSize.height - crop.height) / 2;
    const sourceDeltaX = -(event.clientX - start.clientX) * crop.width / bounds.width;
    const sourceDeltaY = -(event.clientY - start.clientY) * crop.height / bounds.height;
    setPan({
      x: horizontalRange > 0
        ? clamp(start.pan.x + sourceDeltaX / horizontalRange, -1, 1)
        : 0,
      y: verticalRange > 0
        ? clamp(start.pan.y + sourceDeltaY / verticalRange, -1, 1)
        : 0,
    });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStart.current = null;
  };

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.15 : 0.05;
    let next = pan;
    if (event.key === "ArrowLeft") next = { ...pan, x: pan.x - step };
    else if (event.key === "ArrowRight") next = { ...pan, x: pan.x + step };
    else if (event.key === "ArrowUp") next = { ...pan, y: pan.y - step };
    else if (event.key === "ArrowDown") next = { ...pan, y: pan.y + step };
    else return;
    event.preventDefault();
    setPan({ x: clamp(next.x, -1, 1), y: clamp(next.y, -1, 1) });
  };

  const applyChanges = async () => {
    const cleanedBaseName = baseName.trim().replace(/[\\/]/g, "-");
    if (!cleanedBaseName) {
      setError(t("media.editor.nameRequired"));
      nameInputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextFile = cropChanged && naturalSize && crop && imageRef.current
        ? await cropFile(file, imageRef.current, crop, cleanedBaseName)
        : new File(
            [file],
            `${cleanedBaseName}.${initialName.extension}`,
            { type: file.type, lastModified: file.lastModified },
          );
      onSave(nextFile);
    } catch {
      setError(t("media.editor.cropFailed"));
    } finally {
      setSaving(false);
    }
  };

  const aspectOptions: Array<{ value: CropAspect; label: string }> = [
    { value: "original", label: t("media.editor.original") },
    { value: "square", label: t("media.editor.square") },
    { value: "four-three", label: "4:3" },
    { value: "sixteen-nine", label: "16:9" },
  ];
  const maximumFrameWidth = Math.min(720, Math.max(180, 420 * aspectRatio));

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-overlay p-3 backdrop-blur-sm sm:p-6">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label={t("media.editor.close")}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {t("media.editor.title")}
            </h2>
            <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted">
              {t("media.editor.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-muted hover:text-foreground"
            aria-label={t("media.editor.close")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-5 py-5 sm:px-6">
          <label className="block text-xs font-semibold text-muted-strong">
            {t("media.editor.fileName")}
            <span className="mt-1.5 flex h-11 overflow-hidden rounded-xl border border-border bg-surface focus-within:border-success focus-within:ring-4 focus-within:ring-success-border">
              <input
                ref={nameInputRef}
                value={baseName}
                onChange={(event) => setBaseName(event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-3.5 text-sm text-foreground outline-none"
                aria-invalid={!baseName.trim()}
              />
              <span className="flex items-center border-l border-border bg-surface-subtle px-3 text-sm text-muted">
                .{displayedExtension}
              </span>
            </span>
          </label>

          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-muted-strong">
                  {t("media.editor.crop")}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {t("media.editor.cropInstructions")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetCrop}
                disabled={saving}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {t("media.editor.reset")}
              </Button>
            </div>

            <div className="mt-3 flex min-h-52 items-center justify-center rounded-2xl bg-slate-950 p-3 sm:p-4">
              <div
                role="application"
                tabIndex={0}
                aria-label={t("media.editor.cropArea")}
                onPointerDown={startDragging}
                onPointerMove={dragImage}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                onKeyDown={moveWithKeyboard}
                className="relative touch-none select-none overflow-hidden bg-black outline-none ring-white/70 focus-visible:ring-2"
                style={{
                  aspectRatio: String(aspectRatio),
                  width: `min(100%, ${maximumFrameWidth}px)`,
                }}
              >
                {!naturalSize && !imageError ? (
                  <span className="absolute inset-0 grid place-items-center text-white/70">
                    <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
                  </span>
                ) : null}
                {imageError ? (
                  <span className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-white/70">
                    {t("media.editor.previewUnavailable")}
                  </span>
                ) : null}
                {/* Blob preview URLs need the browser's native image decoder. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imageRef}
                  src={previewUrl}
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    setNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                    setImageError(false);
                  }}
                  onError={() => setImageError(true)}
                  className={`absolute max-w-none cursor-grab active:cursor-grabbing ${naturalSize ? "opacity-100" : "opacity-0"}`}
                  style={imageStyle}
                />
                <span className="pointer-events-none absolute inset-0 border border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.18)]" />
                <span className="pointer-events-none absolute inset-x-1/3 inset-y-0 border-x border-white/35" />
                <span className="pointer-events-none absolute inset-x-0 inset-y-1/3 border-y border-white/35" />
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.2fr]">
              <fieldset>
                <legend className="text-xs font-semibold text-muted-strong">
                  {t("media.editor.aspectRatio")}
                </legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {aspectOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setAspect(option.value);
                        setPan({ x: 0, y: 0 });
                      }}
                      disabled={saving}
                      className={`h-8 rounded-lg border px-3 text-xs font-semibold transition ${
                        aspect === option.value
                          ? "border-brand-solid bg-brand-soft text-brand"
                          : "border-border bg-surface text-muted-strong hover:border-border-strong"
                      }`}
                      aria-pressed={aspect === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="block text-xs font-semibold text-muted-strong">
                <span className="flex items-center justify-between gap-3">
                  {t("media.editor.zoom")}
                  <span className="font-mono text-[11px] font-normal text-muted">
                    {zoom.toFixed(1)}×
                  </span>
                </span>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.05"
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  disabled={saving}
                  className="mt-3 h-2 w-full cursor-pointer accent-brand-solid"
                />
              </label>
            </div>

            {crop ? (
              <p className="mt-3 text-[11px] text-muted" aria-live="polite">
                {t("media.editor.outputSize", {
                  width: Math.max(1, Math.round(crop.width)),
                  height: Math.max(1, Math.round(crop.height)),
                })}
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="mt-4 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-4 sm:px-6">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("media.editor.cancel")}
          </Button>
          <Button
            onClick={() => void applyChanges()}
            disabled={saving || (!naturalSize && !imageError)}
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CropIcon className="size-4" aria-hidden="true" />
            )}
            {saving
              ? t("media.editor.applying")
              : t("media.editor.apply")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
