"use client";

import {
  Barcode,
  Grip,
  Hash,
  Image as ImageIcon,
  Link2,
  MapPin,
  Maximize2,
  QrCode as QrCodeIcon,
  Type,
  X,
} from "lucide-react";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
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
  type LabelSetupDto,
} from "@/lib/label-setup-contract";

type ElementType = LabelElement["type"];

export type LabelSetupDraft = Pick<
  LabelSetupDto,
  "name" | "widthMm" | "heightMm" | "elements"
> &
  Partial<Pick<LabelSetupDto, "id" | "revision">>;

const ELEMENT_OPTIONS = [
  { type: "qr", labelKey: "designer.elements.qr", icon: QrCodeIcon },
  { type: "image", labelKey: "designer.elements.image", icon: ImageIcon },
  { type: "name", labelKey: "designer.elements.name", icon: Type },
  { type: "identifier", labelKey: "designer.elements.identifier", icon: Hash },
  { type: "barcode", labelKey: "designer.elements.barcode", icon: Barcode },
  { type: "url", labelKey: "designer.elements.url", icon: Link2 },
  { type: "location", labelKey: "designer.elements.location", icon: MapPin },
] as const;

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

const roundCoordinate = (value: number) => Math.round(value * 10) / 10;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const newElement = (type: ElementType): LabelElement => {
  const box = { x: 5, y: 5, width: 30, height: 25, visible: true };
  switch (type) {
    case "image":
      return { type, ...box, fit: "cover" };
    case "name":
      return { type, ...box, fontSizeMm: 3.8, align: "left" };
    case "identifier":
      return { type, ...box, fontSizeMm: 2.5, align: "left" };
    case "url":
      return { type, ...box, fontSizeMm: 1.8, align: "left" };
    case "location":
      return { type, ...box, fontSizeMm: 2.5, align: "left" };
    case "qr":
    case "barcode":
      return { type, ...box };
  }
};

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
  saving,
  error,
  onChange,
  onSave,
  onClose,
  onDelete,
}: {
  value: LabelSetupDraft;
  sampleResource?: LabelResource | null;
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
  const [selectedType, setSelectedType] = useState<ElementType>("qr");
  const [interaction, setInteraction] = useState<{
    type: ElementType;
    mode: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    original: LabelElement;
  } | null>(null);

  const selected =
    value.elements.find((element) => element.type === selectedType) ?? null;
  const pixelsPerMm = Math.min(
    4,
    560 / Math.max(value.widthMm, 1),
    500 / Math.max(value.heightMm, 1),
  );
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
  const qrImageOverlap = hasVisibleQrImageOverlap(value.elements);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const updateElement = useCallback((type: ElementType, patch: Partial<LabelElement>) => {
    onChange({
      ...value,
      elements: value.elements.map((element) =>
        element.type === type
          ? ({ ...element, ...patch } as LabelElement)
          : element,
      ),
    });
  }, [onChange, value]);

  const toggleElement = useCallback(
    (type: ElementType) => {
      const existing = value.elements.find((element) => element.type === type);
      let elements = existing
        ? value.elements.map((element) =>
            element.type === type
              ? ({ ...element, visible: !element.visible } as LabelElement)
              : element,
          )
        : [...value.elements, newElement(type)];
      if (
        (type === "qr" || type === "image") &&
        (!existing || !existing.visible)
      ) {
        elements = separateQrAndImage(
          elements,
          type,
          value.widthMm,
          value.heightMm,
        );
      }
      setSelectedType(type);
      onChange({ ...value, elements });
    },
    [onChange, value],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
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
        updateElement(interaction.type, {
          x: roundCoordinate(clamp(original.x + deltaX, 0, 100 - original.width)),
          y: roundCoordinate(clamp(original.y + deltaY, 0, 100 - original.height)),
        });
      } else {
        updateElement(interaction.type, {
          width: roundCoordinate(clamp(original.width + deltaX, 1, 100 - original.x)),
          height: roundCoordinate(clamp(original.height + deltaY, 1, 100 - original.y)),
        });
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId === interaction.pointerId) setInteraction(null);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [interaction, updateElement]);

  const beginInteraction = (
    event: ReactPointerEvent,
    element: LabelElement,
    mode: "move" | "resize",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedType(element.type);
    setInteraction({
      type: element.type,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      original: element,
    });
  };

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
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("designer.close")}
            className="grid size-9 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-foreground"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[250px_minmax(360px,1fr)_260px] lg:overflow-hidden">
          <aside className="border-b border-border p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <label className="block text-[11px] font-semibold text-muted">
              {t("designer.setupName")}
              <input
                value={value.name}
                maxLength={160}
                onChange={(event) => onChange({ ...value, name: event.target.value })}
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
                      if (Number.isFinite(next)) onChange({ ...value, [key]: next });
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

          <main className="flex min-h-[500px] items-center justify-center overflow-auto bg-surface-muted p-6 subtle-grid lg:min-h-0">
            <div
              ref={canvasRef}
              className="relative shrink-0 touch-none"
              style={{ width: canvasWidth, height: canvasHeight }}
              onPointerDown={() => setSelectedType("qr")}
            >
              <LabelRenderer
                resource={sampleResource ?? fallbackSampleResource}
                setup={renderedSetup}
                origin="https://inventory.example"
                pixelsPerMm={pixelsPerMm}
                showImagePlaceholder
                className="!shadow-[var(--shadow-md)]"
              />
              <div className="absolute inset-0">
                {value.elements
                  .filter((element) => element.visible)
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
                <div className="grid grid-cols-2 gap-2">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <label key={key} className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {t(`designer.coordinates.${key}`)} (%)
                      <input
                        type="number"
                        min={key === "width" || key === "height" ? 1 : 0}
                        max="100"
                        step="0.1"
                        value={selected[key]}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isFinite(next)) return;
                          const maximum =
                            key === "x"
                              ? 100 - selected.width
                              : key === "y"
                                ? 100 - selected.height
                                : key === "width"
                                  ? 100 - selected.x
                                  : 100 - selected.y;
                          updateElement(selected.type, {
                            [key]: roundCoordinate(clamp(next, key === "width" || key === "height" ? 1 : 0, maximum)),
                          });
                        }}
                        className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground outline-none focus:border-focus"
                      />
                    </label>
                  ))}
                </div>

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

                {["name", "identifier", "url", "location"].includes(selected.type) ? (
                  <>
                    <label className="mt-4 block text-[11px] font-semibold text-muted">
                      {t("designer.fontSize")}
                      <input
                        type="number"
                        min="0.5"
                        max="100"
                        step="0.1"
                        value={(selected as Extract<LabelElement, { type: "name" }>).fontSizeMm ?? 3}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next)) updateElement(selected.type, { fontSizeMm: next } as Partial<LabelElement>);
                        }}
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-focus"
                      />
                    </label>
                    <label className="mt-4 block text-[11px] font-semibold text-muted">
                      {t("designer.alignment")}
                      <select
                        value={(selected as Extract<LabelElement, { type: "name" }>).align ?? "left"}
                        onChange={(event) => updateElement(selected.type, { align: event.target.value as "left" | "center" | "right" } as Partial<LabelElement>)}
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        <option value="left">{t("designer.align.left")}</option>
                        <option value="center">{t("designer.align.center")}</option>
                        <option value="right">{t("designer.align.right")}</option>
                      </select>
                    </label>
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
