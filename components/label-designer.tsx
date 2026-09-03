"use client";

import {
  Barcode,
  Grid3X3,
  Grip,
  Hash,
  Image as ImageIcon,
  Link2,
  MapPin,
  Maximize2,
  QrCode as QrCodeIcon,
  Redo2,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useT } from "next-i18next/client";

import {
  LabelRenderer,
  type LabelResource,
} from "@/components/label-renderer";
import { Button } from "@/components/ui";
import {
  hasVisibleQrImageOverlap,
  labelElementsOverlap,
  type LabelElement,
  type LabelFontFamily,
  type LabelSetupDto,
} from "@/lib/label-setup-contract";

type ElementType = LabelElement["type"];
type TextElement = Extract<
  LabelElement,
  { type: "name" | "identifier" | "url" | "location" }
>;
type BackgroundElement = Extract<LabelElement, { type: "background" }>;
type QrElement = Extract<LabelElement, { type: "qr" }>;
type CoordinateKey = "x" | "y" | "width" | "height";
type CoordinateUnit = "mm" | "percent";
type PreviewScenario = "current" | "stress" | "missing";

export type LabelSetupDraft = Pick<
  LabelSetupDto,
  "name" | "widthMm" | "heightMm" | "elements"
> &
  Partial<Pick<LabelSetupDto, "id" | "revision">>;

const ELEMENT_OPTIONS = [
  { type: "background", labelKey: "designer.elements.background", icon: ImageIcon },
  { type: "qr", labelKey: "designer.elements.qr", icon: QrCodeIcon },
  { type: "image", labelKey: "designer.elements.image", icon: ImageIcon },
  { type: "name", labelKey: "designer.elements.name", icon: Type },
  { type: "identifier", labelKey: "designer.elements.identifier", icon: Hash },
  { type: "barcode", labelKey: "designer.elements.barcode", icon: Barcode },
  { type: "url", labelKey: "designer.elements.url", icon: Link2 },
  { type: "location", labelKey: "designer.elements.location", icon: MapPin },
] as const;

const MAX_HISTORY_LENGTH = 80;
const MAX_BACKGROUND_FILE_BYTES = 2 * 1024 * 1024;
const BACKGROUND_FILE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
]);

const SAMPLE_RESOURCE: LabelResource = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  name: "Cordless impact driver",
  sku: "TOOL-042",
  barcode: null,
  location: "Workshop · Shelf B",
  type: "tool",
  quantity: 3,
  cover: null,
};

const roundCoordinate = (value: number) => Math.round(value * 1_000) / 1_000;
const roundMeasurement = (value: number) => Math.round(value * 100) / 100;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const newElement = (type: ElementType): LabelElement => {
  const box = { x: 5, y: 5, width: 30, height: 25, visible: true };
  switch (type) {
    case "background":
      return {
        type,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        visible: true,
        fit: "cover",
        opacity: 1,
      };
    case "image":
      return { type, ...box, fit: "cover" };
    case "name":
      return {
        type,
        ...box,
        fontSizeMm: 3.8,
        fontFamily: "sans",
        align: "left",
        textOverflow: "ellipsis",
      };
    case "identifier":
      return {
        type,
        ...box,
        fontSizeMm: 2.5,
        fontFamily: "monospace",
        align: "left",
        textOverflow: "ellipsis",
      };
    case "url":
      return {
        type,
        ...box,
        fontSizeMm: 1.8,
        fontFamily: "monospace",
        align: "left",
        textOverflow: "ellipsis",
      };
    case "location":
      return {
        type,
        ...box,
        fontSizeMm: 2.5,
        fontFamily: "monospace",
        align: "left",
        textOverflow: "ellipsis",
      };
    case "qr":
      return {
        type,
        ...box,
        foregroundColor: "#000000",
        backgroundColor: "#ffffff",
        quietZoneModules: 0,
      };
    case "barcode":
      return { type, ...box };
  }
};

function longestValue(
  resources: LabelResource[],
  pick: (resource: LabelResource) => string | null | undefined,
  fallback: string,
) {
  return resources.reduce((longest, resource) => {
    const candidate = pick(resource) ?? "";
    return candidate.length > longest.length ? candidate : longest;
  }, fallback);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Unable to read background image."));
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Unable to read background image.")),
    );
    reader.readAsDataURL(file);
  });
}

function separateQrAndImage(
  elements: LabelElement[],
  activatedType: "qr" | "image",
  widthMm: number,
  heightMm: number,
) {
  const qr = elements.find((element) => element.type === "qr");
  const image = elements.find((element) => element.type === "image");
  if (
    !qr?.visible ||
    !image?.visible ||
    !labelElementsOverlap(qr, image)
  ) {
    return elements;
  }

  const anchor = activatedType === "image" ? qr : image;
  const splitHorizontally =
    anchor.width * widthMm >= anchor.height * heightMm;
  const length = splitHorizontally ? anchor.width : anchor.height;
  if (length < 1) return elements;
  const gap = roundCoordinate(Math.min(2, length * 0.05));
  const firstLength = roundCoordinate((length - gap) / 2);
  const secondLength = roundCoordinate(length - gap - firstLength);

  return elements.map((element) => {
    if (element.type === "qr") {
      return {
        ...element,
        x: anchor.x,
        y: anchor.y,
        ...(splitHorizontally
          ? { width: firstLength, height: anchor.height }
          : { width: anchor.width, height: firstLength }),
      };
    }
    if (element.type === "image") {
      return {
        ...element,
        ...(splitHorizontally
          ? {
              x: roundCoordinate(anchor.x + firstLength + gap),
              y: anchor.y,
              width: secondLength,
              height: anchor.height,
            }
          : {
              x: anchor.x,
              y: roundCoordinate(anchor.y + firstLength + gap),
              width: anchor.width,
              height: secondLength,
            }),
      };
    }
    return element;
  });
}

function previewSetup(draft: LabelSetupDraft): LabelSetupDto {
  return {
    id: draft.id ?? "preview",
    name: draft.name,
    widthMm: draft.widthMm,
    heightMm: draft.heightMm,
    elements: draft.elements,
    revision: draft.revision ?? 1,
    createdAt: "",
    updatedAt: "",
  };
}

export function LabelDesigner({
  value,
  sampleResource,
  sampleResources,
  origin = "https://inventory.example",
  saving,
  error,
  onChange,
  onSave,
  onClose,
  onDelete,
}: {
  value: LabelSetupDraft;
  sampleResource?: LabelResource | null;
  sampleResources?: LabelResource[];
  origin?: string;
  saving: boolean;
  error?: string | null;
  onChange: (next: LabelSetupDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const { t } = useT("labels");
  const canvasRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const currentValueRef = useRef(value);
  const pastRef = useRef<LabelSetupDraft[]>([]);
  const futureRef = useRef<LabelSetupDraft[]>([]);
  const undoRef = useRef<() => void>(() => undefined);
  const redoRef = useRef<() => void>(() => undefined);
  const [historyState, setHistoryState] = useState({ past: 0, future: 0 });
  const [selectedType, setSelectedType] = useState<ElementType>("qr");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [gridSizeMm, setGridSizeMm] = useState(1);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [coordinateUnit, setCoordinateUnit] =
    useState<CoordinateUnit>("mm");
  const [previewScenario, setPreviewScenario] =
    useState<PreviewScenario>("current");
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<{
    type: ElementType;
    mode: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    original: LabelElement;
    draftBefore: LabelSetupDraft;
  } | null>(null);

  const selected =
    value.elements.find((element) => element.type === selectedType) ?? null;
  const fitPixelsPerMm = Math.min(
    4,
    560 / Math.max(value.widthMm, 1),
    500 / Math.max(value.heightMm, 1),
  );
  const pixelsPerMm = fitPixelsPerMm * (zoomPercent / 100);
  const canvasWidth = value.widthMm * pixelsPerMm;
  const canvasHeight = value.heightMm * pixelsPerMm;
  const renderedSetup = useMemo(() => previewSetup(value), [value]);
  const fallbackSampleResource = useMemo<LabelResource>(
    () => ({
      ...SAMPLE_RESOURCE,
      name: t("designer.sample.name"),
      location: t("designer.sample.location"),
    }),
    [t],
  );
  const stressSampleResource = useMemo<LabelResource>(() => {
    const resources = [
      ...(sampleResources ?? []),
      ...(sampleResource ? [sampleResource] : []),
    ];
    const base = sampleResource ?? resources[0] ?? fallbackSampleResource;
    return {
      ...base,
      name: longestValue(
        resources,
        (resource) => resource.name,
        t("designer.sample.longName"),
      ),
      sku: longestValue(
        resources,
        (resource) => resource.sku,
        t("designer.sample.longSku"),
      ),
      location: longestValue(
        resources,
        (resource) => resource.location,
        t("designer.sample.longLocation"),
      ),
    };
  }, [fallbackSampleResource, sampleResource, sampleResources, t]);
  const missingSampleResource = useMemo<LabelResource>(
    () => ({
      ...(sampleResource ?? fallbackSampleResource),
      name: t("designer.sample.missingName"),
      sku: null,
      barcode: null,
      location: "",
      cover: null,
      quantity: 0,
    }),
    [fallbackSampleResource, sampleResource, t],
  );
  const previewResource =
    previewScenario === "stress"
      ? stressSampleResource
      : previewScenario === "missing"
        ? missingSampleResource
        : (sampleResource ?? fallbackSampleResource);
  const qrImageOverlap = hasVisibleQrImageOverlap(value.elements);
  const canUndo = historyState.past > 0;
  const canRedo = historyState.future > 0;
  const gridSpacingPx = gridSizeMm * pixelsPerMm;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

  const refreshHistory = useCallback(() => {
    setHistoryState({
      past: pastRef.current.length,
      future: futureRef.current.length,
    });
  }, []);

  const recordHistory = useCallback(
    (draft: LabelSetupDraft) => {
      pastRef.current.push(structuredClone(draft));
      if (pastRef.current.length > MAX_HISTORY_LENGTH) pastRef.current.shift();
      futureRef.current = [];
      refreshHistory();
    },
    [refreshHistory],
  );

  const applyDraft = useCallback(
    (next: LabelSetupDraft, record = true) => {
      if (record) recordHistory(currentValueRef.current);
      currentValueRef.current = next;
      onChange(next);
    },
    [onChange, recordHistory],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(structuredClone(currentValueRef.current));
    currentValueRef.current = previous;
    onChange(previous);
    refreshHistory();
  }, [onChange, refreshHistory]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(structuredClone(currentValueRef.current));
    currentValueRef.current = next;
    onChange(next);
    refreshHistory();
  }, [onChange, refreshHistory]);

  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  }, [redo, undo]);

  const updateElement = useCallback(
    (
      type: ElementType,
      patch: Partial<LabelElement>,
      record = true,
    ) => {
      const current = currentValueRef.current;
      applyDraft(
        {
          ...current,
          elements: current.elements.map((element) =>
            element.type === type
              ? ({ ...element, ...patch } as LabelElement)
              : element,
          ),
        },
        record,
      );
    },
    [applyDraft],
  );

  const toggleElement = useCallback(
    (type: ElementType) => {
      const current = currentValueRef.current;
      const existing = current.elements.find((element) => element.type === type);
      let elements = existing
        ? current.elements.map((element) =>
            element.type === type
              ? ({ ...element, visible: !element.visible } as LabelElement)
              : element,
          )
        : [...current.elements, newElement(type)];
      if (
        (type === "qr" || type === "image") &&
        (!existing || !existing.visible)
      ) {
        elements = separateQrAndImage(
          elements,
          type,
          current.widthMm,
          current.heightMm,
        );
      }
      setSelectedType(type);
      applyDraft({ ...current, elements });
    },
    [applyDraft],
  );

  const snapCoordinate = useCallback(
    (coordinate: number, dimensionMm: number) => {
      if (!snapToGrid) return roundCoordinate(coordinate);
      const millimeters = (coordinate / 100) * dimensionMm;
      return roundCoordinate(
        ((Math.round(millimeters / gridSizeMm) * gridSizeMm) / dimensionMm) *
          100,
      );
    },
    [gridSizeMm, snapToGrid],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !dialog.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialog.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (!interaction) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return;
      const deltaX = ((event.clientX - interaction.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - interaction.startY) / rect.height) * 100;
      const original = interaction.original;

      if (interaction.mode === "move") {
        const maximumX = 100 - original.width;
        const maximumY = 100 - original.height;
        updateElement(interaction.type, {
          x: clamp(
            snapCoordinate(original.x + deltaX, value.widthMm),
            0,
            maximumX,
          ),
          y: clamp(
            snapCoordinate(original.y + deltaY, value.heightMm),
            0,
            maximumY,
          ),
        }, false);
      } else {
        const minimumWidth = (0.1 / value.widthMm) * 100;
        const minimumHeight = (0.1 / value.heightMm) * 100;
        updateElement(interaction.type, {
          width: clamp(
            snapCoordinate(original.width + deltaX, value.widthMm),
            minimumWidth,
            100 - original.x,
          ),
          height: clamp(
            snapCoordinate(original.height + deltaY, value.heightMm),
            minimumHeight,
            100 - original.y,
          ),
        }, false);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return;
      const currentElement = currentValueRef.current.elements.find(
        (element) => element.type === interaction.type,
      );
      if (
        currentElement &&
        (currentElement.x !== interaction.original.x ||
          currentElement.y !== interaction.original.y ||
          currentElement.width !== interaction.original.width ||
          currentElement.height !== interaction.original.height)
      ) {
        recordHistory(interaction.draftBefore);
      }
      setInteraction(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [interaction, recordHistory, snapCoordinate, updateElement, value.heightMm, value.widthMm]);

  const beginInteraction = (
    event: ReactPointerEvent,
    element: LabelElement,
    mode: "move" | "resize",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current?.focus();
    setSelectedType(element.type);
    setInteraction({
      type: element.type,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      original: element,
      draftBefore: structuredClone(currentValueRef.current),
    });
  };

  const nudgeSelected = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (
      !selected ||
      selected.type === "background" ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      return;
    }
    event.preventDefault();
    const stepMm = event.shiftKey ? 1 : 0.1;
    const deltaX = (stepMm / value.widthMm) * 100;
    const deltaY = (stepMm / value.heightMm) * 100;
    updateElement(selected.type, {
      x: roundCoordinate(
        clamp(
          selected.x +
            (event.key === "ArrowLeft" ? -deltaX : event.key === "ArrowRight" ? deltaX : 0),
          0,
          100 - selected.width,
        ),
      ),
      y: roundCoordinate(
        clamp(
          selected.y +
            (event.key === "ArrowUp" ? -deltaY : event.key === "ArrowDown" ? deltaY : 0),
          0,
          100 - selected.height,
        ),
      ),
    });
  };

  const uploadBackground = async (file: File) => {
    setBackgroundError(null);
    if (!BACKGROUND_FILE_TYPES.has(file.type)) {
      setBackgroundError(t("designer.backgroundUnsupported"));
      return;
    }
    if (file.size > MAX_BACKGROUND_FILE_BYTES) {
      setBackgroundError(t("designer.backgroundTooLarge"));
      return;
    }

    try {
      const source = await readFileAsDataUrl(file);
      const current = currentValueRef.current;
      const existing = current.elements.find(
        (element): element is BackgroundElement => element.type === "background",
      );
      const elements = existing
        ? current.elements.map((element) =>
            element.type === "background"
              ? { ...element, source, visible: true }
              : element,
          )
        : [...current.elements, { ...newElement("background"), source }];
      applyDraft({ ...current, elements });
      setSelectedType("background");
    } catch {
      setBackgroundError(t("designer.backgroundReadError"));
    }
  };

  const updateZoom = (next: number) => {
    setZoomPercent(Math.min(400, Math.max(50, next)));
  };

  const coordinateDimensionMm = (key: CoordinateKey) =>
    key === "x" || key === "width" ? value.widthMm : value.heightMm;

  const displayedCoordinate = (key: CoordinateKey, normalized: number) =>
    coordinateUnit === "mm"
      ? roundMeasurement((normalized / 100) * coordinateDimensionMm(key))
      : roundCoordinate(normalized);

  return (
    <div
      data-label-designer
      className="fixed inset-0 z-[80] flex items-center justify-center bg-overlay p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="label-designer-title"
        tabIndex={-1}
        className="flex max-h-[94vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-[22px] border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-brand">
              {t("designer.eyebrow")}
            </p>
            <h2 id="label-designer-title" className="mt-1 text-lg font-semibold tracking-[-0.02em] text-foreground">
              {value.id ? t("designer.edit") : t("designer.create")}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label={t("designer.undo")}
              title={`${t("designer.undo")} (⌘Z)`}
              className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Undo2 size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label={t("designer.redo")}
              title={`${t("designer.redo")} (⇧⌘Z)`}
              className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Redo2 size={17} aria-hidden="true" />
            </button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label={t("designer.close")}
              className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-foreground"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[250px_minmax(360px,1fr)_260px] lg:overflow-hidden">
          <aside className="border-b border-border p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <label className="block text-[11px] font-semibold text-muted">
              {t("designer.setupName")}
              <input
                value={value.name}
                maxLength={160}
                onChange={(event) =>
                  applyDraft({
                    ...currentValueRef.current,
                    name: event.target.value,
                  })
                }
                className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-focus focus:ring-4 focus:ring-focus/10"
              />
            </label>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["widthMm", "heightMm"] as const).map((key) => (
                <label key={key} className="block text-[11px] font-semibold text-muted">
                  {key === "widthMm"
                    ? t("designer.width")
                    : t("designer.height")}
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="0.1"
                    value={value[key]}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next)) {
                        applyDraft({ ...currentValueRef.current, [key]: next });
                      }
                    }}
                    className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-focus"
                  />
                </label>
              ))}
            </div>

            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                {t("designer.elementsTitle")}
              </p>
              <div className="mt-2 space-y-1.5">
                {ELEMENT_OPTIONS.map((option) => {
                  const element = value.elements.find((item) => item.type === option.type);
                  const Icon = option.icon;
                  return (
                    <div
                      key={option.type}
                      className={`flex w-full items-center rounded-xl border transition ${
                        selectedType === option.type
                          ? "border-brand-border bg-brand-soft"
                          : "border-transparent hover:bg-surface-hover"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedType(option.type)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
                      >
                        <Icon size={15} className="shrink-0 text-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1 text-xs font-semibold text-muted-strong">
                          {t(option.labelKey)}
                        </span>
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={element?.visible ?? false}
                        aria-label={t("designer.showElement", {
                          element: t(option.labelKey),
                        })}
                        onClick={() => toggleElement(option.type)}
                        className={`relative mr-2 h-5 w-9 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-focus/40 ${
                          element?.visible ? "bg-brand-solid" : "bg-border-strong"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 size-4 rounded-full bg-on-brand shadow-sm transition ${
                            element?.visible ? "left-[18px]" : "left-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="relative min-h-[500px] overflow-auto bg-surface-muted p-6 pt-40 subtle-grid sm:pt-28 lg:min-h-0">
            <div className="absolute left-3 right-3 top-3 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/95 p-2 shadow-sm backdrop-blur">
              <label className="flex min-w-0 items-center gap-2 text-[10px] font-semibold text-muted">
                <span className="hidden xl:inline">{t("designer.previewScenario")}</span>
                <select
                  value={previewScenario}
                  onChange={(event) =>
                    setPreviewScenario(event.target.value as PreviewScenario)
                  }
                  className="h-8 min-w-0 rounded-lg border border-border bg-surface px-2 text-[11px] text-foreground outline-none"
                >
                  <option value="current">{t("designer.previewScenarios.current")}</option>
                  <option value="stress">{t("designer.previewScenarios.stress")}</option>
                  <option value="missing">{t("designer.previewScenarios.missing")}</option>
                </select>
              </label>
              <span className="h-5 w-px bg-border" aria-hidden="true" />
              <button
                type="button"
                role="switch"
                aria-checked={snapToGrid}
                onClick={() => setSnapToGrid((enabled) => !enabled)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold ${
                  snapToGrid
                    ? "bg-brand-soft text-brand"
                    : "text-muted hover:bg-surface-hover"
                }`}
              >
                <Grid3X3 size={14} aria-hidden="true" />
                {t("designer.grid")}
              </button>
              <label className="flex items-center gap-1 text-[10px] font-semibold text-muted">
                <select
                  value={gridSizeMm}
                  onChange={(event) => setGridSizeMm(Number(event.target.value))}
                  aria-label={t("designer.gridSize")}
                  disabled={!snapToGrid}
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-[11px] text-foreground outline-none disabled:opacity-40"
                >
                  {[0.5, 1, 2, 5].map((size) => (
                    <option key={size} value={size}>
                      {size} mm
                    </option>
                  ))}
                </select>
              </label>
              <span className="h-5 w-px bg-border" aria-hidden="true" />
              <div className="flex rounded-lg border border-border bg-surface p-0.5" aria-label={t("designer.coordinateUnit")}>
                {(["mm", "percent"] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setCoordinateUnit(unit)}
                    className={`h-7 rounded-md px-2 text-[10px] font-semibold ${
                      coordinateUnit === unit
                        ? "bg-brand-soft text-brand"
                        : "text-muted"
                    }`}
                  >
                    {unit === "mm" ? "mm" : "%"}
                  </button>
                ))}
              </div>
              <span className="h-5 w-px bg-border" aria-hidden="true" />
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateZoom(zoomPercent - 25)}
                  disabled={zoomPercent <= 50}
                  aria-label={t("designer.zoomOut")}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-hover disabled:opacity-35"
                >
                  <ZoomOut size={15} aria-hidden="true" />
                </button>
                <span className="min-w-12 text-center text-[10px] font-semibold tabular-nums text-muted-strong">
                  {zoomPercent}%
                </span>
                <button
                  type="button"
                  onClick={() => updateZoom(zoomPercent + 25)}
                  disabled={zoomPercent >= 400}
                  aria-label={t("designer.zoomIn")}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-hover disabled:opacity-35"
                >
                  <ZoomIn size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex h-max min-h-full w-max min-w-full items-center justify-center">
              <div
                ref={canvasRef}
                role="application"
                tabIndex={0}
                aria-label={t("designer.canvas")}
                className="relative shrink-0 touch-none outline-none focus-visible:ring-4 focus-visible:ring-focus/30"
                style={{ width: canvasWidth, height: canvasHeight }}
                onKeyDown={nudgeSelected}
                onPointerDown={() => canvasRef.current?.focus()}
              >
              <LabelRenderer
                resource={previewResource}
                setup={renderedSetup}
                origin={origin}
                pixelsPerMm={pixelsPerMm}
                showImagePlaceholder
                className="!shadow-[var(--shadow-md)]"
              />
              {snapToGrid ? (
                <div
                  className="pointer-events-none absolute inset-0 z-[5]"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgb(14 116 144 / 0.2) 1px, transparent 1px), linear-gradient(to bottom, rgb(14 116 144 / 0.2) 1px, transparent 1px)",
                    backgroundSize: `${gridSpacingPx}px ${gridSpacingPx}px`,
                  }}
                  aria-hidden="true"
                />
              ) : null}
                <div className="absolute inset-0 z-10">
                  {value.elements
                    .filter(
                      (element) => element.visible && element.type !== "background",
                    )
                    .map((element) => (
                    <div
                      key={element.type}
                      className={`absolute cursor-move border-2 transition-colors ${
                        selectedType === element.type
                          ? "z-20 border-focus bg-focus/[0.035]"
                          : "z-10 border-transparent hover:border-focus/50"
                      }`}
                      style={{
                        left: `${element.x}%`,
                        top: `${element.y}%`,
                        width: `${element.width}%`,
                        height: `${element.height}%`,
                      }}
                      onPointerDown={(event) => beginInteraction(event, element, "move")}
                    >
                      {selectedType === element.type ? (
                        <>
                          <span className="absolute -left-0.5 -top-6 inline-flex h-5 items-center gap-1 rounded bg-brand-solid px-1.5 text-[9px] font-semibold text-on-brand shadow-sm">
                            <Grip size={9} aria-hidden="true" />
                            {t(
                              ELEMENT_OPTIONS.find(
                                (option) => option.type === element.type,
                              )?.labelKey ?? "designer.elements.qr",
                            )}
                          </span>
                          <button
                            type="button"
                            aria-label={t("designer.resizeElement", {
                              element: t(
                                ELEMENT_OPTIONS.find(
                                  (option) => option.type === element.type,
                                )?.labelKey ?? "designer.elements.qr",
                              ),
                            })}
                            className="absolute -bottom-2 -right-2 grid size-4 cursor-nwse-resize place-items-center rounded-sm border border-on-brand bg-brand-solid text-on-brand shadow"
                            onPointerDown={(event) => beginInteraction(event, element, "resize")}
                          >
                            <Maximize2 size={9} aria-hidden="true" />
                          </button>
                        </>
                      ) : null}
                    </div>
                    ))}
                </div>
              </div>
            </div>
          </main>

          <aside className="border-t border-border p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              {t("designer.properties")}
            </p>
            {selected ? (
              <div className="mt-3">
                <div className="mb-4 flex items-center gap-2 rounded-xl bg-surface-subtle px-3 py-2.5">
                  {(() => {
                    const option = ELEMENT_OPTIONS.find((item) => item.type === selected.type)!;
                    const Icon = option.icon;
                    return <Icon size={16} className="text-brand" aria-hidden="true" />;
                  })()}
                  <span className="text-xs font-semibold text-foreground">
                    {t(
                      ELEMENT_OPTIONS.find((option) => option.type === selected.type)
                        ?.labelKey ?? "designer.elements.qr",
                    )}
                  </span>
                </div>
                {selected.type !== "background" ? (
                  <div className="grid grid-cols-2 gap-2">
                    {(["x", "y", "width", "height"] as const).map((key) => {
                      const dimensionMm = coordinateDimensionMm(key);
                      const minimumNormalized =
                        key === "width" || key === "height"
                          ? (0.1 / dimensionMm) * 100
                          : 0;
                      const maximumNormalized =
                        key === "x"
                          ? 100 - selected.width
                          : key === "y"
                            ? 100 - selected.height
                            : key === "width"
                              ? 100 - selected.x
                              : 100 - selected.y;
                      return (
                        <label key={key} className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                          {t(`designer.coordinates.${key}`)} ({coordinateUnit === "mm" ? "mm" : "%"})
                          <input
                            type="number"
                            min={displayedCoordinate(key, minimumNormalized)}
                            max={displayedCoordinate(key, maximumNormalized)}
                            step={coordinateUnit === "mm" ? "0.1" : "0.01"}
                            value={displayedCoordinate(key, selected[key])}
                            onChange={(event) => {
                              const next = Number(event.target.value);
                              if (!Number.isFinite(next)) return;
                              const normalized =
                                coordinateUnit === "mm"
                                  ? (next / dimensionMm) * 100
                                  : next;
                              updateElement(selected.type, {
                                [key]: roundCoordinate(
                                  clamp(
                                    normalized,
                                    minimumNormalized,
                                    maximumNormalized,
                                  ),
                                ),
                              });
                            }}
                            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground outline-none focus:border-focus"
                          />
                        </label>
                      );
                    })}
                  </div>
                ) : null}

                {selected.type === "background" ? (
                  <div className="space-y-4">
                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-subtle px-3 py-3 text-xs font-semibold text-muted-strong hover:border-focus hover:text-foreground">
                      <Upload size={15} aria-hidden="true" />
                      {selected.source
                        ? t("designer.replaceBackground")
                        : t("designer.uploadBackground")}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) void uploadBackground(file);
                        }}
                      />
                    </label>
                    <p className="text-[10px] leading-4 text-muted">
                      {t("designer.backgroundHint")}
                    </p>
                    {backgroundError ? (
                      <p role="alert" className="text-[11px] font-medium text-danger">
                        {backgroundError}
                      </p>
                    ) : null}
                    <label className="block text-[11px] font-semibold text-muted">
                      {t("designer.imageFit")}
                      <select
                        value={selected.fit ?? "cover"}
                        onChange={(event) =>
                          updateElement(selected.type, {
                            fit: event.target.value as "cover" | "contain",
                          })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        <option value="cover">{t("designer.fillFrame")}</option>
                        <option value="contain">{t("designer.fitImage")}</option>
                      </select>
                    </label>
                    <label className="block text-[11px] font-semibold text-muted">
                      <span className="flex items-center justify-between gap-2">
                        {t("designer.backgroundOpacity")}
                        <output>{Math.round((selected.opacity ?? 1) * 100)}%</output>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round((selected.opacity ?? 1) * 100)}
                        onChange={(event) =>
                          updateElement(selected.type, {
                            opacity: Number(event.target.value) / 100,
                          })
                        }
                        className="mt-2 w-full accent-[var(--color-brand-solid)]"
                      />
                    </label>
                    {selected.source ? (
                      <button
                        type="button"
                        onClick={() =>
                          updateElement(selected.type, { source: undefined })
                        }
                        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-danger-border bg-danger-soft px-3 text-xs font-semibold text-danger"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t("designer.removeBackground")}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {selected.type === "image" ? (
                  <label className="mt-4 block text-[11px] font-semibold text-muted">
                    {t("designer.imageFit")}
                    <select
                      value={selected.fit ?? "cover"}
                      onChange={(event) => updateElement(selected.type, { fit: event.target.value as "cover" | "contain" })}
                      className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                    >
                      <option value="cover">{t("designer.fillFrame")}</option>
                      <option value="contain">{t("designer.fitImage")}</option>
                    </select>
                  </label>
                ) : null}

                {selected.type === "qr" ? (
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["foregroundColor", "designer.qrForeground", "#000000"],
                        ["backgroundColor", "designer.qrBackground", "#ffffff"],
                      ] as const).map(([key, labelKey, fallback]) => (
                        <label key={key} className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                          {t(labelKey)}
                          <input
                            type="color"
                            value={(selected as QrElement)[key] ?? fallback}
                            onChange={(event) =>
                              updateElement(selected.type, {
                                [key]: event.target.value,
                              })
                            }
                            className="mt-1.5 h-10 w-full cursor-pointer rounded-lg border border-border bg-surface p-1"
                          />
                        </label>
                      ))}
                    </div>
                    <label className="block text-[11px] font-semibold text-muted">
                      {t("designer.qrMargin")}
                      <select
                        value={(selected as QrElement).quietZoneModules ?? 0}
                        onChange={(event) =>
                          updateElement(selected.type, {
                            quietZoneModules: Number(event.target.value),
                          })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        {[0, 1, 2, 3, 4].map((modules) => (
                          <option key={modules} value={modules}>
                            {modules === 0
                              ? t("designer.qrMarginNone")
                              : t("designer.qrMarginModules", { count: modules })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-[10px] leading-4 text-muted">
                      {t("designer.qrColorHint")}
                    </p>
                  </div>
                ) : null}

                {["name", "identifier", "url", "location"].includes(selected.type) ? (
                  <>
                    <label className="mt-4 block text-[11px] font-semibold text-muted">
                      {t("designer.fontSize")}
                      <input
                        type="number"
                        min="0.5"
                        max="100"
                        step="0.1"
                        value={(selected as TextElement).fontSizeMm ?? 3}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isFinite(next)) return;
                          const textElement = selected as TextElement;
                          updateElement(selected.type, {
                            fontSizeMm: next,
                            ...(textElement.minFontSizeMm !== undefined &&
                            textElement.minFontSizeMm > next
                              ? { minFontSizeMm: next }
                              : {}),
                          } as Partial<LabelElement>);
                        }}
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-focus"
                      />
                    </label>
                    <label className="mt-4 block text-[11px] font-semibold text-muted">
                      {t("designer.fontFamily")}
                      <select
                        value={
                          (selected as TextElement).fontFamily ??
                          (selected.type === "name" ? "sans" : "monospace")
                        }
                        onChange={(event) =>
                          updateElement(selected.type, {
                            fontFamily: event.target.value as LabelFontFamily,
                          } as Partial<LabelElement>)
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        <option value="sans">
                          {t("designer.fontFamilies.sans")}
                        </option>
                        <option value="serif">
                          {t("designer.fontFamilies.serif")}
                        </option>
                        <option value="monospace">
                          {t("designer.fontFamilies.monospace")}
                        </option>
                        <option value="rounded">
                          {t("designer.fontFamilies.rounded")}
                        </option>
                      </select>
                    </label>
                    <label className="mt-4 block text-[11px] font-semibold text-muted">
                      {t("designer.alignment")}
                      <select
                        value={(selected as TextElement).align ?? "left"}
                        onChange={(event) => updateElement(selected.type, { align: event.target.value as "left" | "center" | "right" } as Partial<LabelElement>)}
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        <option value="left">{t("designer.align.left")}</option>
                        <option value="center">{t("designer.align.center")}</option>
                        <option value="right">{t("designer.align.right")}</option>
                      </select>
                    </label>
                    <label className="mt-4 block text-[11px] font-semibold text-muted">
                      {t("designer.textOverflow")}
                      <select
                        value={(selected as TextElement).textOverflow ?? "ellipsis"}
                        onChange={(event) =>
                          updateElement(selected.type, {
                            textOverflow: event.target.value as "ellipsis" | "shrink",
                          } as Partial<LabelElement>)
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        <option value="ellipsis">
                          {t("designer.textOverflowModes.ellipsis")}
                        </option>
                        <option value="shrink">
                          {t("designer.textOverflowModes.shrink")}
                        </option>
                      </select>
                    </label>
                    {(selected as TextElement).textOverflow === "shrink" ? (
                      <label className="mt-4 block text-[11px] font-semibold text-muted">
                        {t("designer.minimumFontSize")}
                        <input
                          type="number"
                          min="0.5"
                          max={(selected as TextElement).fontSizeMm ?? 3}
                          step="0.1"
                          value={
                            (selected as TextElement).minFontSizeMm ??
                            Math.min((selected as TextElement).fontSizeMm ?? 3, 1)
                          }
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (Number.isFinite(next)) {
                              updateElement(selected.type, {
                                minFontSizeMm: next,
                              } as Partial<LabelElement>);
                            }
                          }}
                          className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-focus"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}
                <p className="mt-5 text-[11px] leading-5 text-muted">
                  {t("designer.instructions")}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted">
                {t("designer.chooseElement")}
              </p>
            )}
          </aside>
        </div>

        <footer className="flex flex-col gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
            {qrImageOverlap ? (
              <p role="alert" className="text-xs font-medium text-warning">
                {t("designer.overlap")}
              </p>
            ) : !error ? (
              <p className="text-[11px] text-muted">
                {t("designer.previewNote")}
              </p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            {onDelete ? (
              <Button variant="danger" onClick={onDelete} disabled={saving} className="mr-auto sm:mr-2">
                {t("designer.delete")}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {t("designer.cancel")}
            </Button>
            <Button
              onClick={onSave}
              disabled={saving || !value.name.trim() || qrImageOverlap}
            >
              {saving ? t("designer.saving") : t("designer.save")}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
