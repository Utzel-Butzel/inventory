"use client";

import {
  AlignLeft, AlignCenter, AlignRight, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, Keyboard,
  Barcode,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  BringToFront,
  SendToBack,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  Copy,
  Printer,
  LoaderCircle,
  Grid3X3,
  Grip,
  Hash,
  Image as ImageIcon,
  Link2,
  MapPin,
  Maximize2,
  QrCode as QrCodeIcon,
  Plus,
  Redo2,
  Trash2,
  Type,
  Undo2,
  Upload,
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
import { LabelCopyCount } from "@/components/label-copy-count";
import { LabelFrameProperties, LabelLayoutTree, LabelSizingControl } from "@/components/label-layout-groups";
import { LabelNumberControl } from "@/components/label-number-control";
import { labelFontWeights, defaultLabelFontSize, defaultLabelFontWeight, mmToPoints, pointsToMm } from "@/lib/label-typography";
import { labelNudge } from "@/lib/label-editor-keyboard";
import { LabelFontSelect } from "@/components/label-font-select";
import { LabelRichTextEditor } from "@/components/label-rich-text-editor";
import { defaultLabelTextContent, labelPlaceholderValues } from "@/lib/label-rich-text";
import { useLabelLayout } from "@/components/use-label-layout";
import { hugsRowContent, isRowText, initializeLabelRow } from "@/lib/label-auto-layout";
import { elementWidthSizing, type LayoutBox } from "@/lib/label-layout-engine";
import { ROOT_FRAME, layoutItems, layoutChildren, layoutAncestors, topLevelSelection, wrapLayoutNodes, dissolveLayoutFrame, moveLayoutNodes, deleteLayoutNodes, duplicateLayoutNodes } from "@/lib/label-layout-tree";
import { labelRowHeightError, type LabelAutoLayoutGroup } from "@/lib/label-setup-contract";
import { automaticLabelText } from "@/lib/label-dynamic-layout";
import { DEFAULT_CROP_PADDING, DEFAULT_CROP_TOLERANCE } from "@/lib/label-image-crop";
import { placeNewLabelElement, duplicateLabelElement, moveLabelElement, orderedLabelElements } from "@/lib/label-element-layout";
import {
  hasVisibleQrImageOverlap,
  labelElementKey,
  MAX_LABEL_ELEMENTS,
  MIN_LABEL_POSITION,
  type LabelTextElement,
  type LabelElement,
  type LabelSetupDto,
} from "@/lib/label-setup-contract";

type ElementType = LabelElement["type"];
type TextElement = LabelTextElement;
type QrElement = Extract<LabelElement, { type: "qr" }>;
type CoordinateKey = "x" | "y" | "width" | "height";
type CoordinateUnit = "mm" | "percent";
type PreviewScenario = "current" | "stress" | "missing";

export type LabelSetupDraft = Pick<
  LabelSetupDto,
  "name" | "widthMm" | "heightMm" | "elements" | "inverted" | "layout"
> &
  Partial<Pick<LabelSetupDto, "id" | "revision">>;

const ELEMENT_OPTIONS = [
  { type: "background", labelKey: "designer.elements.background", icon: ImageIcon },
  { type: "qr", labelKey: "designer.elements.qr", icon: QrCodeIcon },
  { type: "image", labelKey: "designer.elements.image", icon: ImageIcon },
  { type: "name", labelKey: "designer.elements.name", icon: Type },
  { type: "subtitle", labelKey: "designer.elements.subtitle", icon: Type },
  { type: "identifier", labelKey: "designer.elements.identifier", icon: Hash },
  { type: "barcode", labelKey: "designer.elements.barcode", icon: Barcode },
  { type: "url", labelKey: "designer.elements.url", icon: Link2 },
  { type: "location", labelKey: "designer.elements.location", icon: MapPin },
  { type: "text", labelKey: "designer.elements.text", icon: Type },
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
  previewOnly: true,
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
  const box = { id: crypto.randomUUID(), x: 5, y: 5, width: 30, height: 25, visible: true };
  switch (type) {
    case "text":
      return { type, ...box, width: 55, height: 35, content: [{ text: "[Title]" }], fontFamily: "sans", fontSizeMm: 3, textOverflow: "shrink" };
    case "background":
      return {
        type,
        ...box,
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
    case "subtitle":
      return { type, ...box, y: 60, width: 55, height: 25, fontSizeMm: 2.3, fontFamily: "sans", textOverflow: "shrink" };
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

function previewSetup(draft: LabelSetupDraft): LabelSetupDto {
  return {
    id: draft.id ?? "preview",
    name: draft.name,
    widthMm: draft.widthMm,
    heightMm: draft.heightMm,
    elements: draft.elements,
    inverted: draft.inverted,
    layout: draft.layout,
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
  onSaveAsNew,
  onClose,
  onDelete,
  onTestPrint,
  testPrintDestination,
  testPrintSuccess,
}: {
  value: LabelSetupDraft;
  sampleResource?: LabelResource | null;
  sampleResources?: LabelResource[];
  origin?: string;
  saving: boolean;
  error?: string | null;
  onChange: (next: LabelSetupDraft) => void;
  onSave: () => void;
  onSaveAsNew?: () => void;
  onClose: () => void;
  onDelete?: () => void;
  onTestPrint?: (node: HTMLElement, setup: LabelSetupDto, resource: LabelResource, copies: number) => Promise<void>;
  testPrintDestination?: string;
  testPrintSuccess?: string;
}) {
  const { t } = useT("labels");
  const canvasRef = useRef<HTMLDivElement>(null);
  const printPreviewRef = useRef<HTMLDivElement>(null);
  const testPrintLock = useRef(false);
  const uploadLock = useRef(false);
  const [testCopies, setTestCopies] = useState(1);
  const [testPrinting, setTestPrinting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const currentValueRef = useRef(value);
  const pastRef = useRef<LabelSetupDraft[]>([]);
  const futureRef = useRef<LabelSetupDraft[]>([]);
  const undoRef = useRef<() => void>(() => undefined);
  const redoRef = useRef<() => void>(() => undefined);
  const [historyState, setHistoryState] = useState({ past: 0, future: 0 });
  const [selectionState, setSelection] = useState<string[]>(() => {
    const initial = value.elements.find(element => element.type === "qr") ?? value.elements[0];
    return initial ? [labelElementKey(initial)] : [];
  });
  const selection = selectionState.filter(key => key === ROOT_FRAME || value.elements.some(element => labelElementKey(element) === key) || value.layout?.groups?.some(frame => frame.id === key));
  const selectedKey = selection.at(-1) ?? "";
  const setSelectedKey = (key: string | ((previous: string) => string)) => setSelection(previous => {
    const next = typeof key === "function" ? key(previous.at(-1) ?? "") : key;
    return next ? [next] : [];
  });
  const selectNode = (key: string, additive = false) => setSelection(previous => additive
    ? previous.includes(key) ? previous.filter(id => id !== key) : [...previous.filter(id => id !== ROOT_FRAME), key]
    : [key]);
  const [showAddElements, setShowAddElements] = useState(false);
  const [fontSizeUnit, setFontSizeUnit] = useState<"mm" | "pt">("mm");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(200);
  const [gridSizeMm, setGridSizeMm] = useState(1);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [coordinateUnit, setCoordinateUnit] =
    useState<CoordinateUnit>("mm");
  const [previewScenario, setPreviewScenario] =
    useState<PreviewScenario>("current");
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ pointerId: number; startX: number; startY: number; x: number; y: number; originX: number; originY: number; additive: boolean; initial: string[] } | null>(null);
  const [frameInteraction, setFrameInteraction] = useState<{
    id: string; mode: "move" | "resize"; pointerId: number; startX: number; startY: number;
    bounds: LayoutBox; boxes: Record<string, LayoutBox>; before: LabelSetupDraft;
  } | null>(null);
  const [interaction, setInteraction] = useState<{
    key: string;
    mode: "move" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    original: LabelElement;
    draftBefore: LabelSetupDraft;
    layoutBefore: LabelSetupDto;
  } | null>(null);

  const selected =
    value.elements.find((element) => labelElementKey(element) === selectedKey) ?? null;
  const elementName = (element: LabelElement) => {
    const siblings = value.elements.filter(item => item.type === element.type);
    const number = siblings.findIndex(item => labelElementKey(item) === labelElementKey(element)) + 1;
    const name = element.type === "image" && element.source ? t("designer.ownImage") : t(ELEMENT_OPTIONS.find(option => option.type === element.type)!.labelKey);
    return siblings.length > 1 || element.type === "text"
      ? t("designer.elementInstance", { element: name, number })
      : name;
  };
  const fitPixelsPerMm = Math.min(
    4,
    560 / Math.max(value.widthMm, 1),
    500 / Math.max(value.heightMm, 1),
  );
  const pixelsPerMm = fitPixelsPerMm * (zoomPercent / 100);
  const canvasHeight = value.heightMm * pixelsPerMm;
  const renderedSetup = useMemo(() => previewSetup(value), [value]);
  const fallbackSampleResource = useMemo<LabelResource>(
    () => ({
      ...SAMPLE_RESOURCE,
      name: t("designer.sample.name"),
      subtitle: t("designer.sample.subtitle"),
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
      subtitle: longestValue(resources, (resource) => resource.subtitle ?? "", t("designer.sample.subtitle")),
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
      subtitle: "",
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
  const previewLayout = useLabelLayout(renderedSetup, previewResource, origin);
  const previewSelected = previewLayout.elements.find(element => labelElementKey(element) === selectedKey) ?? selected;
  const canvasWidth = previewLayout.widthMm * pixelsPerMm;
  const orderedElements = orderedLabelElements(value.elements);
  const selectedLayer = orderedElements.findIndex(element => labelElementKey(element) === selectedKey);
  const rowLayout = value.layout;
  const selectedFrame = rowLayout && selection.length <= 1 ? selectedKey === ROOT_FRAME || !selection.length ? rowLayout : rowLayout.groups?.find(frame => frame.id === selectedKey) : undefined;
  const selectedParent = layoutItems(value).find(item => item.id === selectedKey)?.parentId ?? ROOT_FRAME;
  const selectedSiblings = layoutChildren(value, selectedParent);
  const layoutBoxes: Record<string, LayoutBox> = useMemo(() => ({ ...previewLayout.autoLayoutFrames,
    ...Object.fromEntries(previewLayout.elements.map(element => [labelElementKey(element), { x: element.x / 100 * previewLayout.widthMm,
      y: element.y / 100 * previewLayout.heightMm, width: element.width / 100 * previewLayout.widthMm, height: element.height / 100 * previewLayout.heightMm }])) }), [previewLayout]);
  const autoText = rowLayout ? undefined : automaticLabelText(value.elements);
  const qrImageOverlap = !rowLayout && hasVisibleQrImageOverlap(value.elements);
  const rowHeightError = previewLayout.autoLayoutOverflowY ?? labelRowHeightError(value);
  const rowWidthError = !!rowLayout && (previewLayout.widthMm > 1000 || !!previewLayout.autoLayoutOverflowX);
  const layoutInvalid = qrImageOverlap || rowHeightError || rowWidthError;
  const canUndo = historyState.past > 0;
  const canRedo = historyState.future > 0;
  const gridSpacingPx = gridSizeMm * pixelsPerMm;

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
      if (next.layout) next = initializeLabelRow(next);
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
      key: string,
      patch: Partial<LabelElement>,
      record = true,
    ) => {
      const current = currentValueRef.current;
      applyDraft(
        {
          ...current,
          elements: current.elements.map((element) =>
            labelElementKey(element) === key
              ? ({ ...element, ...patch } as LabelElement)
              : element,
          ),
        },
        record,
      );
    },
    [applyDraft],
  );

  const updateFrame = (id: string, patch: Partial<LabelAutoLayoutGroup>, record = true) => {
    const current = currentValueRef.current;
    if (!current.layout) return;
    if (id === ROOT_FRAME) {
      const { widthMm, heightMm, align, ...rest } = patch;
      applyDraft({ ...current, ...(widthMm !== undefined ? { widthMm } : {}), ...(heightMm !== undefined ? { heightMm } : {}),
        layout: { ...current.layout, ...rest, ...(align ? { align: align === "start" ? "top" : align === "end" ? "bottom" : "middle" } : {}) } }, record);
    } else applyDraft({ ...current, layout: { ...current.layout, groups: current.layout.groups?.map(frame => frame.id === id ? { ...frame, ...patch } : frame) } }, record);
  };
  const setSizing = (id: string, axis: "width" | "height", mode: "hug" | "fill" | "fixed") => {
    let current = structuredClone(currentValueRef.current);
    if (!current.layout) return;
    const size = axis === "width" ? "widthMm" : "heightMm", sizing = axis === "width" ? "widthSizing" : "heightSizing";
    const bounds = layoutBoxes[id];
    const measured = Math.min(1000, Math.max(0.1, bounds?.[axis] ?? 10));
    if (id === ROOT_FRAME) {
      current = { ...current, [size]: measured, layout: { ...current.layout, [sizing]: mode } };
    } else if (current.layout.groups?.some(frame => frame.id === id)) {
      current.layout.groups = current.layout.groups.map(frame => frame.id === id ? { ...frame, [sizing]: mode, [size]: measured } : frame);
    } else current.elements = current.elements.map(element => labelElementKey(element) === id ? { ...element, [sizing]: mode, [axis === "width" ? "rowWidthMm" : "rowHeightMm"]: measured } : element);
    // Fill needs a definite parent dimension. Freeze a hugging parent at its current size.
    if (mode === "fill") {
      const parentId = layoutItems(current).find(item => item.id === id)?.parentId ?? ROOT_FRAME;
      const parentSize = Math.min(1000, Math.max(0.1, layoutBoxes[parentId]?.[axis] ?? current[size]));
      if (parentId === ROOT_FRAME) {
        if (axis === "width" && current.layout!.widthSizing !== "fixed") current = { ...current, widthMm: parentSize, layout: { ...current.layout!, widthSizing: "fixed" } };
      } else current.layout!.groups = current.layout!.groups?.map(frame => frame.id === parentId && (frame[sizing] ?? "hug") === "hug" ? { ...frame, [sizing]: "fixed", [size]: parentSize } : frame);
    }
    applyDraft(current);
  };
  const createAutoLayout = () => {
    const current = initializeLabelRow(currentValueRef.current);
    if ((current.layout?.groups?.length ?? 0) >= MAX_LABEL_ELEMENTS) return;
    if (selection.includes(ROOT_FRAME)) return;
    const id = crypto.randomUUID();
    applyDraft(wrapLayoutNodes(current, selection, id, t("designer.frames.defaultName", { number: (current.layout?.groups?.length ?? 0) + 1 }), layoutBoxes));
    setSelectedKey(id);
    requestAnimationFrame(() => canvasRef.current?.focus());
  };
  const dissolveFrame = (id: string) => {
    const current = currentValueRef.current;
    const children = layoutChildren(current, id).map(item => item.id);
    applyDraft(dissolveLayoutFrame(current, id)); setSelection(children);
    requestAnimationFrame(() => canvasRef.current?.focus());
  };
  const shiftRowElement = (key: string, direction: number) => {
    const current = currentValueRef.current;
    const parent = layoutItems(current).find(item => item.id === key)?.parentId ?? ROOT_FRAME;
    const index = layoutChildren(current, parent).findIndex(item => item.id === key);
    applyDraft(moveLayoutNodes(current, [key], parent, index + direction));
  };

  const addElement = (type: ElementType) => {
    const current = currentValueRef.current;
    if (current.elements.length >= MAX_LABEL_ELEMENTS) return;
    const parentId = current.layout?.groups?.some(frame => frame.id === selectedKey) ? selectedKey
      : current.elements.find(element => labelElementKey(element) === selectedKey)?.groupId;
    const element = { ...placeNewLabelElement(newElement(type), current.elements), ...(current.layout && type !== "background" ? { groupId: parentId } : {}) };
    applyDraft({ ...current, elements: [...current.elements, { ...element, ...(current.layout ? { rowOrder: current.elements.filter(item => item.type !== "background").length } : {}) }] });
    setSelectedKey(labelElementKey(element));
    setShowAddElements(false);
    addButtonRef.current?.focus();
  };

  const removeElement = (key: string) => {
    const current = currentValueRef.current;
    const ordered = orderedLabelElements(current.elements);
    const index = ordered.findIndex(element => labelElementKey(element) === key);
    const elements = ordered.filter(element => labelElementKey(element) !== key)
      .map((element, layer) => ({ ...element, layer }));
    applyDraft({ ...current, elements });
    const next = elements[Math.min(index, elements.length - 1)];
    setSelectedKey(next ? labelElementKey(next) : "");
  };

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
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !editorRef.current?.contains(event.target)) return;
      if (event.defaultPrevented || event.isComposing || testPrintLock.current || uploadLock.current || editorRef.current?.dataset.busy === "true") return;
      const editable = event.target instanceof HTMLElement && (event.target.isContentEditable || !!event.target.closest("input, textarea, select"));
      if ((!editable || (event.target instanceof HTMLElement && event.target.isContentEditable)) && (event.metaKey || event.ctrlKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        if (event.shiftKey || event.key.toLowerCase() === "y") redoRef.current();
        else undoRef.current();
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
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
      const deltaX = ((event.clientX - interaction.startX) / (value.widthMm * pixelsPerMm)) * 100;
      const deltaY = ((event.clientY - interaction.startY) / rect.height) * 100;
      const original = interaction.original;

      if (currentValueRef.current.layout && original.type !== "background" && !original.ignoreLayout) {
        const current = currentValueRef.current;
        if (interaction.mode === "move") {
          const group = current.layout?.groups?.find(group => group.id === original.groupId);
          const vertical = (group?.direction ?? current.layout?.direction) === "column";
          const pointer = vertical ? (event.clientY - rect.top) / pixelsPerMm : (event.clientX - rect.left) / pixelsPerMm;
          const parent = original.groupId ?? ROOT_FRAME;
          const siblings = layoutChildren(interaction.draftBefore, parent).filter(item => item.id !== interaction.key);
          const before = siblings.find(item => {
            const child = interaction.layoutBefore.elements.find(element => labelElementKey(element) === item.id);
            const box = child ? { x: child.x / 100 * interaction.layoutBefore.widthMm, y: child.y / 100 * interaction.layoutBefore.heightMm,
              width: child.width / 100 * interaction.layoutBefore.widthMm, height: child.height / 100 * interaction.layoutBefore.heightMm } : layoutBoxes[item.id];
            return box && pointer < (vertical ? box.y + box.height / 2 : box.x + box.width / 2);
          });
          const index = before ? siblings.findIndex(item => item.id === before.id) : siblings.length;
          const next = moveLayoutNodes(current, [interaction.key], parent, index);
          if (JSON.stringify(next) !== JSON.stringify(current)) applyDraft(next, false);
        } else {
          const snapMm = (mm: number) => snapToGrid ? Math.round(mm / gridSizeMm) * gridSizeMm : roundMeasurement(mm);
          updateElement(interaction.key, {
            ...(hugsRowContent(original) ? {} : { widthSizing: "fixed", rowWidthMm: clamp(snapMm((interaction.layoutBefore.elements.find(element => labelElementKey(element) === interaction.key)!.width / 100 * interaction.layoutBefore.widthMm) + (event.clientX - interaction.startX) / pixelsPerMm), 0.1, 1000) }),
            heightSizing: "fixed",
            rowHeightMm: clamp(snapMm((interaction.layoutBefore.elements.find(element => labelElementKey(element) === interaction.key)!.height / 100 * interaction.layoutBefore.heightMm) + (event.clientY - interaction.startY) / pixelsPerMm), 0.1, 1000),
          }, false);
        }
        return;
      }
      if (interaction.mode === "move") {
        const maximumX = 100 - original.width;
        const maximumY = 100 - original.height;
        updateElement(interaction.key, {
          x: clamp(
            snapCoordinate(original.x + deltaX, value.widthMm),
            MIN_LABEL_POSITION,
            maximumX,
          ),
          y: clamp(
            snapCoordinate(original.y + deltaY, value.heightMm),
            MIN_LABEL_POSITION,
            maximumY,
          ),
        }, false);
      } else {
        const minimumWidth = (0.1 / value.widthMm) * 100;
        const minimumHeight = (0.1 / value.heightMm) * 100;
        updateElement(interaction.key, {
          ...("autoWidth" in original && original.autoWidth ? {} : { width: clamp(
            snapCoordinate(original.width + deltaX, value.widthMm),
            minimumWidth,
            Math.min(100, 100 - original.x),
          ) }),
          height: clamp(
            snapCoordinate(original.height + deltaY, value.heightMm),
            minimumHeight,
            Math.min(100, 100 - original.y),
          ),
        }, false);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) return;
      if (JSON.stringify(currentValueRef.current) !== JSON.stringify(interaction.draftBefore)) {
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
  }, [interaction, recordHistory, snapCoordinate, updateElement, value.heightMm, value.widthMm, pixelsPerMm, previewLayout, layoutBoxes, applyDraft, snapToGrid, gridSizeMm]);

  useEffect(() => {
    if (!frameInteraction) return;
    const drag = frameInteraction;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
      const current = currentValueRef.current;
      if (!current.layout) return;
      if (drag.mode === "resize") {
        const widthMm = clamp(roundMeasurement(drag.bounds.width + (event.clientX - drag.startX) / pixelsPerMm), 0.1, 1000);
        const heightMm = clamp(roundMeasurement(drag.bounds.height + (event.clientY - drag.startY) / pixelsPerMm), 0.1, 1000);
        applyDraft({ ...current, layout: { ...current.layout, groups: current.layout.groups?.map(frame => frame.id === drag.id
          ? { ...frame, widthSizing: "fixed", heightSizing: "fixed", widthMm, heightMm } : frame) } }, false);
      } else {
        const parent = layoutItems(drag.before).find(item => item.id === drag.id)?.parentId ?? ROOT_FRAME;
        const parentFrame = drag.before.layout?.groups?.find(frame => frame.id === parent) ?? drag.before.layout;
        const vertical = parentFrame?.direction === "column";
        const siblings = layoutChildren(drag.before, parent).filter(item => item.id !== drag.id);
        const center = vertical ? drag.bounds.y + drag.bounds.height / 2 + (event.clientY - drag.startY) / pixelsPerMm : drag.bounds.x + drag.bounds.width / 2 + (event.clientX - drag.startX) / pixelsPerMm;
        const target = siblings.findIndex(item => { const box = drag.boxes[item.id]; return box && center < (vertical ? box.y + box.height / 2 : box.x + box.width / 2); });
        applyDraft(moveLayoutNodes(current, [drag.id], parent, target < 0 ? siblings.length : target), false);
      }
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      if (event.type === "pointercancel") applyDraft(drag.before, false);
      else if (JSON.stringify(currentValueRef.current) !== JSON.stringify(drag.before)) recordHistory(drag.before);
      setFrameInteraction(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
  }, [frameInteraction, pixelsPerMm, applyDraft, recordHistory]);
  useEffect(() => {
    if (!marquee) return;
    const start = marquee;
    const move = (event: PointerEvent) => {
      if (event.pointerId === start.pointerId) setMarquee(previous => previous ? { ...previous,
        x: (event.clientX - start.originX) / pixelsPerMm, y: (event.clientY - start.originY) / pixelsPerMm } : null);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== start.pointerId) return;
      if (event.type !== "pointercancel") {
        const endX = (event.clientX - start.originX) / pixelsPerMm, endY = (event.clientY - start.originY) / pixelsPerMm;
        const minX = Math.min(start.startX, endX), maxX = Math.max(start.startX, endX);
        const minY = Math.min(start.startY, endY), maxY = Math.max(start.startY, endY);
        const hit = Object.entries(layoutBoxes).filter(([id, box]) => id !== ROOT_FRAME && (previewLayout.autoLayoutFrames?.[id] || previewLayout.elements.some(element => element.visible && labelElementKey(element) === id)) && box.x >= minX && box.y >= minY && box.x + box.width <= maxX && box.y + box.height <= maxY).map(([id]) => id);
        const ids = start.additive ? [...start.initial, ...hit] : hit;
        setSelection(value.layout ? topLevelSelection(value, ids) : [...new Set(ids)]);
      }
      setMarquee(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
  }, [marquee, pixelsPerMm, layoutBoxes, previewLayout, value]);
  const beginMarquee = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault(); canvasRef.current?.focus();
    const x = (event.clientX - rect.left) / pixelsPerMm, y = (event.clientY - rect.top) / pixelsPerMm;
    setMarquee({ pointerId: event.pointerId, startX: x, startY: y, x, y, originX: rect.left, originY: rect.top,
      additive: event.shiftKey, initial: selection });
  };
  const beginFrameInteraction = (event: ReactPointerEvent, id: string, mode: "move" | "resize") => {
    event.preventDefault(); event.stopPropagation(); canvasRef.current?.focus();
    if (event.shiftKey || event.metaKey || event.ctrlKey) { selectNode(id, true); return; }
    setSelectedKey(id);
    const bounds = layoutBoxes[id];
    if (bounds) setFrameInteraction({ id, mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      bounds, boxes: structuredClone(layoutBoxes), before: structuredClone(currentValueRef.current) });
  };

  const beginInteraction = (
    event: ReactPointerEvent,
    element: LabelElement,
    mode: "move" | "resize",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current?.focus();
    if (event.shiftKey || event.metaKey || event.ctrlKey) { selectNode(labelElementKey(element), true); return; }
    if (mode === "move" && rowLayout && element.groupId && selectedKey !== labelElementKey(element)) {
      const ancestors = layoutAncestors(value, labelElementKey(element)).filter(id => id !== ROOT_FRAME);
      beginFrameInteraction(event, ancestors.find(id => selection.includes(id)) ?? ancestors.at(-1)!, "move");
      return;
    }
    setSelectedKey(labelElementKey(element));
    setInteraction({
      key: labelElementKey(element),
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      original: currentValueRef.current.elements.find(item => labelElementKey(item) === labelElementKey(element)) ?? element,
      draftBefore: structuredClone(currentValueRef.current),
      layoutBefore: previewLayout,
    });
  };

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || saving || testPrintLock.current || uploadLock.current || interaction || frameInteraction) return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || target.closest("input, textarea, select, [role='menu']")) return;
    if (event.shiftKey && (event.code === "KeyA" || event.key.toLowerCase() === "a")) {
      event.preventDefault();
      if (event.altKey && rowLayout?.groups?.some(frame => frame.id === selectedKey)) dissolveFrame(selectedKey);
      else if (!event.altKey) createAutoLayout();
      return;
    }
    if (event.key === "Enter" && rowLayout?.groups?.some(frame => frame.id === selectedKey)) {
      event.preventDefault(); const child = layoutChildren(value, selectedKey)[0]; if (child) setSelectedKey(child.id); return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedKey(rowLayout && selectedKey && selectedKey !== ROOT_FRAME ? selectedParent : "");
      canvasRef.current?.focus();
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (rowLayout && selection.length && !selection.includes(ROOT_FRAME)) {
      if (mod && event.shiftKey && event.key.toLowerCase() === "g") { event.preventDefault(); dissolveFrame(selectedKey); return; }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault(); const result = duplicateLayoutNodes(currentValueRef.current, selection, () => crypto.randomUUID());
        applyDraft(result.setup); setSelection(result.ids); return;
      }
      if (["Delete", "Backspace"].includes(event.key)) {
        event.preventDefault(); applyDraft(deleteLayoutNodes(currentValueRef.current, selection)); setSelectedKey(selectedParent); requestAnimationFrame(() => canvasRef.current?.focus()); return;
      }
      if (rowLayout.groups?.some(frame => frame.id === selectedKey) && event.key.startsWith("Arrow")) {
        event.preventDefault(); shiftRowElement(selectedKey, event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1); return;
      }
    }
    if (mod && event.key.toLowerCase() === "d" && selected) {
      event.preventDefault(); duplicateSelected(); canvasRef.current?.focus(); return;
    }
    if (!mod && !event.altKey && ["Delete", "Backspace"].includes(event.key) && selected) {
      event.preventDefault(); removeElement(labelElementKey(selected)); canvasRef.current?.focus(); return;
    }
    if (mod && ["[", "]", "{", "}"].includes(event.key) && selected) {
      event.preventDefault();
      const forward = event.key === "]" || event.key === "}";
      applyDraft({ ...currentValueRef.current, elements: moveLabelElement(currentValueRef.current.elements, labelElementKey(selected), event.shiftKey ? (forward ? "front" : "back") : (forward ? "forward" : "backward")) });
      return;
    }
    if (!mod && !event.altKey && selected && rowLayout && selected.type !== "background" && event.key.startsWith("Arrow")) {
      event.preventDefault();
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) shiftRowElement(selectedKey, event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (!mod && !event.altKey && selected) {
      const current = currentValueRef.current.elements.find(element => labelElementKey(element) === labelElementKey(selected));
      const patch = current && labelNudge(current, event.key, event.shiftKey, value.widthMm, value.heightMm);
      if (patch && current) {
        event.preventDefault();
        if (patch.x !== current.x || patch.y !== current.y) updateElement(labelElementKey(current), patch, !event.repeat);
      }
    }
  };

  const uploadBackground = async (key: string | null, file: File) => {
    setBackgroundError(null);
    if (!BACKGROUND_FILE_TYPES.has(file.type)) {
      setBackgroundError(t("designer.backgroundUnsupported"));
      return;
    }
    if (file.size > MAX_BACKGROUND_FILE_BYTES) {
      setBackgroundError(t("designer.backgroundTooLarge"));
      return;
    }

    uploadLock.current = true;
    setUploadingImage(true);
    try {
      const source = await readFileAsDataUrl(file);
      const decoded = new Image();
      decoded.src = source;
      await Promise.race([decoded.decode(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Image decoding timed out.")), 8000))]);
      const current = currentValueRef.current;
      if (key === null) {
        if (current.elements.length >= MAX_LABEL_ELEMENTS) return;
        const width = 30;
        const height = Math.min(80, Math.max(5, width * current.widthMm / current.heightMm * decoded.naturalHeight / decoded.naturalWidth));
        const element = placeNewLabelElement({ ...newElement("image"), type: "image", width, height, fit: "contain", source, altText: file.name.slice(0, 300) }, current.elements);
        applyDraft({ ...current, elements: [...current.elements, { ...element, ...(current.layout ? { rowOrder: current.elements.filter(item => item.type !== "background").length } : {}) }] });
        setSelectedKey(labelElementKey(element));
      } else {
        const element = current.elements.find(element => labelElementKey(element) === key);
        if (!element) return;
        updateElement(key, { source, visible: true, ...(element.type === "image" ? { altText: file.name.slice(0, 300), fit: "contain" } : {}) });
      }
    } catch {
      setBackgroundError(t("designer.backgroundReadError"));
    } finally { uploadLock.current = false; setUploadingImage(false); }
  };

  const duplicateSelected = () => {
    if (!selected || value.elements.length >= MAX_LABEL_ELEMENTS) return;
    const current = currentValueRef.current;
    const copy = duplicateLabelElement(selected, current.elements, crypto.randomUUID());
    applyDraft({ ...current, elements: [...current.elements, { ...copy, ...(current.layout ? { rowOrder: current.elements.filter(item => item.type !== "background").length } : {}) }] });
    setSelectedKey(labelElementKey(copy));
  };
  const testPrint = async () => {
    if (!onTestPrint || testPrintLock.current) return;
    const node = printPreviewRef.current?.querySelector<HTMLElement>("article");
    if (!node) return;
    testPrintLock.current = true;
    setTestPrinting(true);
    setTestError(null);
    setTestSent(false);
    try {
      await onTestPrint(node, renderedSetup, previewResource, testCopies);
      setTestSent(true);
    } catch (error) { setTestError(error instanceof Error ? error.message : String(error)); }
    finally { testPrintLock.current = false; setTestPrinting(false); }
  };

  const updateZoom = (next: number) => {
    setZoomPercent(Math.min(400, Math.max(50, next)));
  };

  const coordinateDimensionMm = (key: CoordinateKey) =>
    key === "x" || key === "width" ? previewLayout.widthMm : value.heightMm;

  const displayedCoordinate = (key: CoordinateKey, normalized: number) =>
    coordinateUnit === "mm"
      ? roundMeasurement((normalized / 100) * coordinateDimensionMm(key))
      : roundCoordinate(normalized);

  return (
    <div
      data-label-designer
      className="w-full"
    >
      <section
        ref={editorRef}
        data-busy={saving || testPrinting || uploadingImage}
        onKeyDown={handleEditorKeyDown}
        aria-labelledby="label-designer-title"
        tabIndex={-1}
        className="flex w-full flex-col overflow-hidden rounded-[22px] border border-border bg-surface shadow-sm xl:h-[calc(100dvh-var(--app-shell-header-height)-76px)] xl:min-h-[640px]"
      >
        <header inert={testPrinting || uploadingImage || saving} className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <button ref={closeButtonRef} type="button" onClick={onClose}
              className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-foreground">
              <ArrowLeft size={16} aria-hidden="true" />{t("designer.back")}
            </button>
            <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-brand">
              {t("designer.eyebrow")}
            </p>
            <h1 id="label-designer-title" className="mt-1 text-lg font-semibold tracking-[-0.02em] text-foreground">
              {value.id ? t("designer.edit") : t("designer.create")}
            </h1>
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
          </div>
        </header>

        <div inert={testPrinting || uploadingImage || saving} className="grid min-h-0 flex-1 overflow-y-auto xl:grid-cols-[250px_minmax(300px,1fr)_320px] xl:overflow-hidden">
          <aside className="relative border-b border-border p-5 xl:overflow-y-auto xl:border-b-0 xl:border-r">
            <label className="block text-[12px] font-semibold text-muted">
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
                <LabelNumberControl key={key} label={key === "widthMm" ? t("designer.width") : t("designer.height")}
                  min={1} max={1000} step={0.1} unit="mm"
                  value={rowLayout && key === "widthMm" && rowLayout.widthSizing !== "fixed" ? roundMeasurement(previewLayout.widthMm) : value[key]}
                  disabled={!!rowLayout && key === "widthMm" && rowLayout.widthSizing !== "fixed"}
                  onChange={(next, record) => applyDraft({ ...currentValueRef.current, [key]: next }, record)} />
              ))}
            </div>

            <label className="mt-4 block text-xs font-semibold text-muted">
              {t("designer.layoutMode")}
              <select value={rowLayout ? "row" : "free"} onChange={event => applyDraft(event.target.value === "row" ? initializeLabelRow(currentValueRef.current) : { ...currentValueRef.current, layout: null, elements: currentValueRef.current.elements.map(element => ({ ...element, groupId: undefined })) })}
                className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-2 text-xs text-foreground">
                <option value="free">{t("designer.freeLayout")}</option>
                <option value="row">{t("designer.rowLayout")}</option>
              </select>
            </label>
            {rowLayout ? <div className="mt-3 space-y-3">
              <button type="button" onClick={() => setSelectedKey(ROOT_FRAME)} className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-surface-hover">{t("designer.frames.editRoot")}</button>
              <p className="text-xs font-semibold text-brand">{t("designer.actualLength", { length: roundMeasurement(previewLayout.widthMm) })}</p>
            </div> : <>
            <label className="mt-4 block text-xs font-semibold text-muted">
              {t("designer.autoLength")}
              <select value={autoText ? labelElementKey(autoText) : ""}
                onChange={event => {
                  const key = event.target.value;
                  applyDraft({ ...value, elements: value.elements.map(element =>
                    ["name", "subtitle", "identifier", "url", "location", "text"].includes(element.type)
                      ? { ...element, autoWidth: labelElementKey(element) === key } : element) });
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-2 text-xs text-foreground">
                <option value="">{t("designer.fixedLength")}</option>
                {value.elements.filter(element => element.visible && ["name", "subtitle", "identifier", "url", "location", "text"].includes(element.type))
                  .map(element => <option key={labelElementKey(element)} value={labelElementKey(element)}>{elementName(element)}</option>)}
              </select>
            </label>
            <p className="mt-2 text-[11px] leading-4 text-muted">{t("designer.autoLengthHint")}</p>
            {autoText ? <div className="mt-3">
              <LabelNumberControl label={t("designer.autoLengthRightMargin")} unit="mm"
                value={autoText.autoWidthRightMarginMm ?? 0} min={0} max={1000} step={0.1}
                onChange={(autoWidthRightMarginMm, record) => updateElement(labelElementKey(autoText), { autoWidthRightMarginMm }, record)} />
              <p className="mt-1.5 text-[11px] leading-4 text-muted">{t("designer.autoLengthRightMarginHint")}</p>
            </div> : null}
            {autoText ? <p className="mt-2 text-xs font-semibold text-brand">{t("designer.actualLength", { length: roundMeasurement(previewLayout.widthMm) })}</p> : null}

            </>}
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-semibold">
              <input type="checkbox" checked={value.inverted ?? false} onChange={event => applyDraft({ ...currentValueRef.current, inverted: event.target.checked })} />
              {t("print.inverted")}
            </label>
            {value.inverted ? <p className="mt-2 text-xs leading-5 text-muted">{t("print.invertedHint")}</p> : null}

            <div className="mt-6">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                {t("designer.layersTitle")}
              </p>
              <p className="mt-1 text-[11px] text-muted">{t(rowLayout ? "designer.frames.hint" : "designer.layersHint")}</p>
              <div className="mt-3" onKeyDown={event => {
                if (event.key === "Escape" && showAddElements) {
                  event.preventDefault();
                  event.stopPropagation();
                  setShowAddElements(false);
                  addButtonRef.current?.focus();
                }
              }}>
                <button
                  ref={addButtonRef}
                  type="button"
                  onClick={() => setShowAddElements(open => !open)}
                  disabled={value.elements.length >= MAX_LABEL_ELEMENTS}
                  aria-expanded={showAddElements}
                  aria-controls="label-element-picker"
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-sm hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={14} className="shrink-0" aria-hidden="true" />
                  <span className="text-xs font-semibold">{t("designer.addElement")}</span>
                </button>
                {showAddElements ? (
                  <div id="label-element-picker" className="mt-2 rounded-xl border border-border bg-surface-subtle p-1">
                    {ELEMENT_OPTIONS.map(option => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.type}
                          type="button"
                          aria-label={t("designer.addElementType", { element: t(option.labelKey) })}
                          onClick={() => addElement(option.type)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-muted-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
                        >
                          <Icon size={15} className="shrink-0 text-muted" aria-hidden="true" />
                          <span className="text-xs font-medium">{t(option.labelKey)}</span>
                          <Plus size={12} className="ml-auto shrink-0" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {value.elements.length >= MAX_LABEL_ELEMENTS ? (
                  <p className="mt-2 text-[11px] leading-4 text-muted">
                    {t("designer.elementLimit", { count: MAX_LABEL_ELEMENTS })}
                  </p>
                ) : null}
              </div>
              <label className="relative mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2.5 text-xs font-semibold hover:bg-surface-hover">
                <Upload size={14} aria-hidden="true" />{t(uploadingImage ? "designer.imageUploading" : "designer.insertImage")}
                <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml"
                  disabled={uploadingImage || value.elements.length >= MAX_LABEL_ELEMENTS}
                  onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadBackground(null, file); }} />
              </label>
              {backgroundError ? <p role="alert" className="mt-2 text-xs text-danger">{backgroundError}</p> : null}
              {rowLayout ? <>
                <button type="button" onClick={createAutoLayout} className="mt-3 flex w-full items-center justify-between rounded-lg border border-border px-2 py-2 text-xs hover:bg-surface-hover">
                  <span>{t("designer.frames.add")}</span><kbd className="text-muted">{t("designer.frames.shortcut")}</kbd>
                </button>
                <LabelLayoutTree setup={value} selection={selection} elementName={elementName} onSelect={selectNode}
                  onMove={(ids, parentId, index) => applyDraft(moveLayoutNodes(currentValueRef.current, ids, parentId, index))}
                  onVisibility={(id, visible) => value.layout?.groups?.some(frame => frame.id === id) ? updateFrame(id, { visible }) : updateElement(id, { visible })} />
                {value.elements.filter(element => element.type === "background").map(element => <button key={labelElementKey(element)} type="button" onClick={() => setSelectedKey(labelElementKey(element))}
                  className="mt-1 block w-full rounded px-2 py-2 text-left text-xs hover:bg-surface-hover">{elementName(element)}</button>)}
              </> : <div className="mt-3 space-y-1.5">
                {[...orderedElements].reverse().map(element => {
                  const key = labelElementKey(element);
                  const option = ELEMENT_OPTIONS.find(item => item.type === element.type)!;
                  const Icon = option.icon;
                  const name = elementName(element);

                  return (
                    <div
                      key={key}
                      className={`flex w-full items-center rounded-xl border transition ${
                        selection.includes(key)
                          ? "border-brand-border bg-brand-soft"
                          : "border-transparent hover:bg-surface-hover"
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={selection.includes(key)}
                        onClick={event => selectNode(key, event.shiftKey || event.metaKey || event.ctrlKey)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left"
                      >
                        <Icon size={15} className="shrink-0 text-muted" aria-hidden="true" />
                        <span title={name} className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-strong">
                          {name}
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-col">
                        <button type="button" title={t(rowLayout ? "designer.rowEarlier" : "designer.bringForward")} aria-label={rowLayout ? `${name}: ${t("designer.rowEarlier")}` : t("designer.raiseElement", { element: name })}
                          disabled={key === labelElementKey(orderedElements.at(-1)!)}
                          onClick={() => rowLayout ? shiftRowElement(key, -1) : applyDraft({ ...value, elements: moveLabelElement(value.elements, key, "forward") })}
                          className="rounded px-1 text-muted hover:text-brand disabled:opacity-25"><ArrowUp size={14} /></button>
                        <button type="button" title={t(rowLayout ? "designer.rowLater" : "designer.sendBackward")} aria-label={rowLayout ? `${name}: ${t("designer.rowLater")}` : t("designer.lowerElement", { element: name })}
                          disabled={key === labelElementKey(orderedElements[0])}
                          onClick={() => rowLayout ? shiftRowElement(key, 1) : applyDraft({ ...value, elements: moveLabelElement(value.elements, key, "backward") })}
                          className="rounded px-1 text-muted hover:text-brand disabled:opacity-25"><ArrowDown size={14} /></button>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={element.visible}
                        aria-label={t("designer.showElement", { element: name })}
                        onClick={() => updateElement(key, { visible: !element.visible })}
                        className={`relative mr-2 h-5 w-9 shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-focus/40 ${
                          element.visible ? "bg-brand-solid" : "bg-border-strong"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 size-4 rounded-full bg-on-brand shadow-sm transition ${
                            element.visible ? "left-[18px]" : "left-0.5"
                          }`}
                        />
                      </button>
                      <button type="button" title={t("designer.removeElement", { element: name })} aria-label={t("designer.removeElement", { element: name })}
                        onClick={() => removeElement(key)} className="mr-1 rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
                    </div>
                  );
                })}
                {value.elements.length === 0 ? (
                  <p className="text-xs leading-5 text-muted">{t("designer.noElements")}</p>
                ) : null}
              </div>}
            </div>
          </aside>

          <div className="relative min-h-[500px] overflow-auto bg-surface-muted p-6 pt-40 subtle-grid sm:pt-28 xl:min-h-0"
            onPointerDown={event => {
              if (event.button !== 0 || event.target !== event.currentTarget) return;
              beginMarquee(event);
            }}>
            <div className="absolute left-3 right-3 top-3 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/95 p-2 shadow-sm backdrop-blur">
              <label className="flex min-w-0 items-center gap-2 text-[11px] font-semibold text-muted">
                <span className="hidden xl:inline">{t("designer.previewScenario")}</span>
                <select
                  value={previewScenario}
                  onChange={(event) =>
                    setPreviewScenario(event.target.value as PreviewScenario)
                  }
                  className="h-8 min-w-0 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none"
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
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold ${
                  snapToGrid
                    ? "bg-brand-soft text-brand"
                    : "text-muted hover:bg-surface-hover"
                }`}
              >
                <Grid3X3 size={14} aria-hidden="true" />
                {t("designer.grid")}
              </button>
              <label className="flex items-center gap-1 text-[11px] font-semibold text-muted">
                <select
                  value={gridSizeMm}
                  onChange={(event) => setGridSizeMm(Number(event.target.value))}
                  aria-label={t("designer.gridSize")}
                  disabled={!snapToGrid}
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-[12px] text-foreground outline-none disabled:opacity-40"
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
                    className={`h-7 rounded-md px-2 text-[11px] font-semibold ${
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
                <span className="min-w-12 text-center text-[11px] font-semibold tabular-nums text-muted-strong">
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
            <div className="flex h-max min-h-full w-max min-w-full items-center justify-center"
              onPointerDown={event => {
                // Element drag/resize handles stop propagation; only empty canvas reaches here.
                if (event.button !== 0) return;
                beginMarquee(event);
              }}>
              <div
                ref={canvasRef}
                role="application"
                tabIndex={0}
                aria-label={t(rowLayout ? "designer.rowCanvas" : "designer.canvas")}
                className="relative shrink-0 touch-none outline-none focus-visible:ring-4 focus-visible:ring-focus/30"
                style={{ width: canvasWidth, height: canvasHeight }}
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
                <div className="pointer-events-none absolute inset-0 z-10">
                  {marquee ? <div className="absolute z-50 border border-focus bg-focus/10" style={{
                    left: Math.min(marquee.startX, marquee.x) * pixelsPerMm, top: Math.min(marquee.startY, marquee.y) * pixelsPerMm,
                    width: Math.abs(marquee.x - marquee.startX) * pixelsPerMm, height: Math.abs(marquee.y - marquee.startY) * pixelsPerMm,
                  }} /> : null}
                  {rowLayout?.groups?.map(frame => {
                    const box = layoutBoxes[frame.id];
                    if (!box || !previewLayout.autoLayoutFrames?.[frame.id]) return null;
                    return <div key={frame.id} onPointerDown={event => beginFrameInteraction(event, frame.id, "move")} className={`pointer-events-auto absolute border ${selection.includes(frame.id) ? "border-focus" : "border-transparent"}`}
                      style={{ left: box.x * pixelsPerMm, top: box.y * pixelsPerMm, width: box.width * pixelsPerMm, height: box.height * pixelsPerMm }}>
                      {selection.includes(frame.id) || (!frame.parentId && !selection.some(id => rowLayout.groups?.some(item => item.id === id))) ? <button type="button" onPointerDown={event => beginFrameInteraction(event, frame.id, "move")}
                        className={`pointer-events-auto absolute -top-5 cursor-move left-0 max-w-full truncate rounded px-1 text-[10px] ${selection.includes(frame.id) ? "bg-brand-solid text-on-brand" : "bg-surface text-muted"}`}>{frame.name}</button> : null}
                      {selection.includes(frame.id) ? <button type="button" aria-label={t("designer.frames.resize")} onPointerDown={event => beginFrameInteraction(event, frame.id, "resize")}
                        className="pointer-events-auto absolute -bottom-1.5 -right-1.5 z-30 size-3 cursor-nwse-resize border border-on-brand bg-brand-solid" /> : null}
                    </div>;
                  })}
                  {orderedLabelElements(previewLayout.elements)
                    .filter(
                      (element) => element.visible && element.type !== "background",
                    )
                    .map((element) => (
                    <div
                      key={labelElementKey(element)}
                      className={`pointer-events-auto absolute cursor-move border-2 transition-colors ${
                        selection.includes(labelElementKey(element))
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
                      onDoubleClick={event => { event.stopPropagation(); setSelectedKey(labelElementKey(element)); }}
                    >
                      {selectedKey === labelElementKey(element) ? (
                        <>
                          <span className="absolute -left-0.5 -top-6 inline-flex h-5 items-center gap-1 rounded bg-brand-solid px-1.5 text-[10px] font-semibold text-on-brand shadow-sm">
                            <Grip size={9} aria-hidden="true" />
                            {elementName(element)}
                          </span>
                          {(rowLayout ? hugsRowContent(element) : "autoWidth" in element && element.autoWidth) ? <button
                            type="button"
                            aria-label={t("designer.resizeElementHeight", { element: elementName(element) })}
                            title={t("designer.resizeElementHeight", { element: elementName(element) })}
                            className="absolute -bottom-2 left-1/2 grid h-4 w-6 -translate-x-1/2 cursor-ns-resize place-items-center rounded-sm border border-on-brand bg-brand-solid text-on-brand shadow"
                            onPointerDown={event => beginInteraction(event, element, "resize")}
                          >
                            <ArrowUpDown size={11} aria-hidden="true" />
                          </button> : <button
                            type="button"
                            aria-label={t("designer.resizeElement", {
                              element: elementName(element),
                            })}
                            className="absolute -bottom-2 -right-2 grid size-4 cursor-nwse-resize place-items-center rounded-sm border border-on-brand bg-brand-solid text-on-brand shadow"
                            onPointerDown={(event) => beginInteraction(event, element, "resize")}
                          >
                            <Maximize2 size={9} aria-hidden="true" />
                          </button>}
                        </>
                      ) : null}
                    </div>
                    ))}
                </div>
              </div>
            </div>
          </div>

          <aside className="relative border-t border-border p-5 xl:overflow-y-auto xl:border-l xl:border-t-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
              {t("designer.properties")}
            </p>
            {selection.length > 1 ? <div className="mt-3 space-y-3">
              <p className="text-xs text-muted">{t("designer.frames.selection", { count: selection.length })}</p>
              <Button onClick={createAutoLayout}>{t("designer.frames.add")} {t("designer.frames.shortcut")}</Button>
            </div> : selectedFrame ? <div className="mt-3">
              <LabelFrameProperties key={selectedKey || ROOT_FRAME} frame={selectedFrame} root={!("id" in selectedFrame)}
                bounds={layoutBoxes[selectedKey || ROOT_FRAME] ?? { x: 0, y: 0, width: 10, height: 5 }}
                onChange={(patch, record) => updateFrame(selectedKey || ROOT_FRAME, patch, record)}
                onSizing={(axis, mode) => setSizing(selectedKey || ROOT_FRAME, axis, mode)}
                onDissolve={"id" in selectedFrame ? () => dissolveFrame(selectedFrame.id) : undefined} />
            </div> : selected ? (
              <div className="mt-3">
                <div className="mb-4 flex items-center gap-2 rounded-xl bg-surface-subtle px-3 py-2.5">
                  {(() => {
                    const option = ELEMENT_OPTIONS.find((item) => item.type === selected.type)!;
                    const Icon = option.icon;
                    return <Icon size={16} className="text-brand" aria-hidden="true" />;
                  })()}
                  <span className="text-xs font-semibold text-foreground">
                    {elementName(selected)}
                  </span>
                  <button type="button" className="ml-auto rounded p-1 text-muted hover:text-foreground" onClick={duplicateSelected}
                    aria-label={t("designer.duplicateElement", { element: elementName(selected) })} title={t("designer.duplicate")}
                    disabled={value.elements.length >= MAX_LABEL_ELEMENTS}><Copy size={15} /></button>
                  <button
                    type="button"
                    aria-label={t("designer.removeElement", { element: elementName(selected) })}
                    className="rounded p-1 text-muted hover:text-danger"
                    onClick={() => removeElement(labelElementKey(selected))}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
                <div role="group" aria-label={t("designer.arrange")} className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-border p-1.5">
                  {rowLayout && selected.type !== "background" ? <>
                    <button type="button" title={t("designer.rowEarlier")} aria-label={t("designer.rowEarlier")}
                      disabled={selectedKey === selectedSiblings[0]?.id} onClick={() => shiftRowElement(selectedKey, -1)}
                      className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-hover disabled:opacity-30"><ArrowLeft size={17} /></button>
                    <button type="button" title={t("designer.rowLater")} aria-label={t("designer.rowLater")}
                      disabled={selectedKey === selectedSiblings.at(-1)?.id} onClick={() => shiftRowElement(selectedKey, 1)}
                      className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-hover disabled:opacity-30"><ArrowRight size={17} /></button>
                  </> : <>{([
                    ["forward", "bringForward", ArrowUp],
                    ["backward", "sendBackward", ArrowDown],
                    ["front", "bringFront", BringToFront],
                    ["back", "sendBack", SendToBack],
                  ] as const).map(([direction, label, Icon]) => (
                    <span key={direction} title={t(`designer.${label}`)}>
                      <button type="button" aria-label={t(`designer.${label}`)}
                        disabled={direction === "front" || direction === "forward" ? selectedLayer === orderedElements.length - 1 : selectedLayer === 0}
                        onClick={() => applyDraft({ ...value, elements: moveLabelElement(value.elements, selectedKey, direction) })}
                        className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-30">
                        <Icon size={17} aria-hidden="true" />
                      </button>
                    </span>
                  ))}</>}
                  {selected.type !== "background" && !rowLayout ? <>
                    <span className="mx-0.5 h-6 border-l border-border" aria-hidden="true" />
                    <button type="button" title={t("designer.centerHorizontal")} aria-label={t("designer.centerHorizontal")}
                      className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
                      onClick={() => updateElement(selectedKey, { x: clamp(selected.x + ((100 - (previewSelected?.width ?? selected.width)) / 2 - (previewSelected?.x ?? selected.x)) * previewLayout.widthMm / value.widthMm, 0, 100 - selected.width) })}>
                      <AlignHorizontalJustifyCenter size={17} aria-hidden="true" />
                    </button>
                    <button type="button" title={t("designer.centerVertical")} aria-label={t("designer.centerVertical")}
                      className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus"
                      onClick={() => updateElement(selectedKey, { y: (100 - selected.height) / 2 })}>
                      <AlignVerticalJustifyCenter size={17} aria-hidden="true" />
                    </button>
                  </> : null}
                </div>
                {rowLayout && selected.type !== "background" ? <div className="mb-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {(["width", "height"] as const).map(axis => <LabelSizingControl key={axis} axis={axis}
                      value={layoutBoxes[selectedKey]?.[axis] ?? 1}
                      mode={axis === "width" ? elementWidthSizing(selected) : selected.heightSizing ?? "fixed"}
                      allowHug={isRowText(selected)} onMode={mode => setSizing(selectedKey, axis, mode)}
                      onValue={(next, record) => updateElement(selectedKey, { [axis === "width" ? "rowWidthMm" : "rowHeightMm"]: next }, record)} />)}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={!!selected.ignoreLayout}
                    onChange={event => {
                      const current = currentValueRef.current;
                      const box = layoutBoxes[selectedKey], parent = layoutBoxes[selected.groupId ?? ROOT_FRAME];
                      if (!event.target.checked || !box || !parent) { updateElement(selectedKey, { ignoreLayout: event.target.checked }); return; }
                      applyDraft({ ...current, elements: current.elements.map(element => labelElementKey(element) === selectedKey ? { ...element, ignoreLayout: true, widthSizing: "fixed", heightSizing: "fixed",
                        x: clamp((box.x - parent.x) / current.widthMm * 100, MIN_LABEL_POSITION, 100 - element.width),
                        y: clamp((box.y - parent.y) / current.heightMm * 100, MIN_LABEL_POSITION, 100 - element.height), rowWidthMm: box.width, rowHeightMm: box.height } : element),
                        layout: { ...current.layout!, groups: current.layout?.groups?.map(frame => frame.id === selected.groupId ? { ...frame,
                          widthSizing: frame.widthSizing === "fill" ? "fill" : "fixed", heightSizing: frame.heightSizing === "fill" ? "fill" : "fixed", widthMm: parent.width, heightMm: parent.height } : frame) } });
                    }} />{t("designer.frames.ignoreLayout")}</label>
                  <button type="button" onClick={createAutoLayout} className="w-full rounded-lg border border-border px-2 py-2 text-xs hover:bg-surface-hover">{t("designer.frames.add")} {t("designer.frames.shortcut")}</button>
                </div> : null}
                {selected.type !== "background" ? (
                  <div className="grid grid-cols-2 gap-2">
                    {(rowLayout ? ["x", "y"] as const : ["x", "y", "width", "height"] as const).map((key) => {
                      const dimensionMm = coordinateDimensionMm(key);
                      const shown = previewSelected ?? selected;
                      const minimumNormalized =
                        key === "width" || key === "height"
                          ? (0.1 / dimensionMm) * 100
                          : MIN_LABEL_POSITION;
                      const maximumNormalized =
                        key === "x"
                          ? 100 - shown.width
                          : key === "y"
                            ? 100 - shown.height
                            : key === "width"
                              ? Math.min(100, 100 - shown.x)
                              : Math.min(100, 100 - shown.y);
                      return (
                        <LabelNumberControl key={`${selectedKey}-${key}-${coordinateUnit}`} label={t(`designer.coordinates.${key}`)} unit={coordinateUnit === "mm" ? "mm" : "%"}
                            min={displayedCoordinate(key, minimumNormalized)}
                            max={rowLayout && (key === "width" || key === "height") ? displayedCoordinate(key, (key === "width" ? 1000 : value.heightMm - rowLayout.paddingTopMm - rowLayout.paddingBottomMm) / dimensionMm * 100) : displayedCoordinate(key, maximumNormalized)}
                            step={coordinateUnit === "mm" ? 0.1 : 0.01}
                            value={displayedCoordinate(key, previewSelected?.[key] ?? selected[key])}
                            disabled={rowLayout ? !selected.ignoreLayout : key === "width" && "autoWidth" in selected && selected.autoWidth}
                            onChange={(next, record) => {
                              const normalized =
                                coordinateUnit === "mm"
                                  ? (next / dimensionMm) * 100
                                  : next;
                              if (rowLayout && !selected.ignoreLayout) {
                                const mm = normalized / 100 * dimensionMm;
                                if (key === "width" || key === "height") updateElement(selectedKey, { [key === "width" ? "rowWidthMm" : "rowHeightMm"]: clamp(mm, 0.1, key === "width" ? 1000 : Math.max(0.1, value.heightMm - rowLayout.paddingTopMm - rowLayout.paddingBottomMm)) }, record);
                                return;
                              }
                              // Map the visible geometry back to the unchanged template coordinate system.
                              const baseNormalized = key === "x" || key === "width"
                                ? selected[key] + (normalized - (previewSelected?.[key] ?? selected[key])) * previewLayout.widthMm / value.widthMm
                                : normalized;
                              const baseMinimum = key === "width" ? 10 / value.widthMm : key === "height" ? 10 / value.heightMm : MIN_LABEL_POSITION;
                              const baseMaximum = key === "x" ? 100 - selected.width : key === "y" ? 100 - selected.height : key === "width" ? Math.min(100, 100 - selected.x) : Math.min(100, 100 - selected.y);
                              updateElement(labelElementKey(selected), {
                                [key]: roundCoordinate(
                                  clamp(
                                    baseNormalized,
                                    baseMinimum,
                                    baseMaximum,
                                  ),
                                ),
                              }, record);
                            }}
                          />

                      );
                    })}
                  </div>
                ) : null}

                {selected.type === "background" ? (
                  <div className="space-y-4">
                    <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-subtle px-3 py-3 text-xs font-semibold text-muted-strong hover:border-focus hover:text-foreground">
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
                          if (file) void uploadBackground(labelElementKey(selected), file);
                        }}
                      />
                    </label>
                    <p className="text-[11px] leading-4 text-muted">
                      {t("designer.backgroundHint")}
                    </p>
                    {backgroundError ? (
                      <p role="alert" className="text-[12px] font-medium text-danger">
                        {backgroundError}
                      </p>
                    ) : null}
                    <label className="block text-[12px] font-semibold text-muted">
                      {t("designer.imageFit")}
                      <select
                        value={selected.fit ?? "cover"}
                        onChange={(event) =>
                          updateElement(labelElementKey(selected), {
                            fit: event.target.value as "cover" | "contain",
                          })
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        <option value="cover">{t("designer.fillFrame")}</option>
                        <option value="contain">{t("designer.fitImage")}</option>
                      </select>
                    </label>
                    <label className="block text-[12px] font-semibold text-muted">
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
                          updateElement(labelElementKey(selected), {
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
                          updateElement(labelElementKey(selected), { source: undefined })
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
                  <div>
                    <label className="relative mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-3 text-xs font-semibold">
                      <Upload size={14} />{t(selected.source ? "designer.replaceImage" : "designer.uploadOwnImage")}
                      <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml" disabled={uploadingImage}
                        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadBackground(selectedKey, file); }} />
                    </label>
                    <p className="mt-2 text-xs text-muted">{t(selected.source ? "designer.ownImageHint" : "designer.productImageHint")}</p>
                    {selected.source ? <Button size="sm" variant="secondary" className="mt-2" onClick={() => updateElement(selectedKey, { source: undefined, altText: undefined })}>{t("designer.useProductImage")}</Button> : null}
                    <label className="mt-4 block text-[12px] font-semibold text-muted">
                      {t("designer.imageFit")}
                      <select
                        value={selected.fit ?? "cover"}
                        onChange={(event) => updateElement(labelElementKey(selected), { fit: event.target.value as "cover" | "contain" })}
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none"
                      >
                        <option value="cover">{t("designer.fillFrame")}</option>
                        <option value="contain">{t("designer.fitImage")}</option>
                      </select>
                    </label>
                    <label className="mt-4 block text-[12px] font-semibold text-muted">
                      {t("designer.photoOptimization")}
                      <select value={selected.photoOptimization ?? "auto"}
                        onChange={event => updateElement(labelElementKey(selected), { photoOptimization: event.target.value as "auto" | "standard" })}
                        className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none">
                        <option value="auto">{t("designer.photoOptimizationAuto")}</option>
                        <option value="standard">{t("designer.photoOptimizationStandard")}</option>
                      </select>
                    </label>
                    <p className="mt-2 text-xs text-muted">{t("designer.photoOptimizationHint")}</p>
                    <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" checked={selected.cropWhiteMargins ?? false}
                        onChange={event => updateElement(labelElementKey(selected), { cropWhiteMargins: event.target.checked })} />
                      {t("designer.cropWhiteMargins")}
                    </label>
                    {selected.cropWhiteMargins ? <div className="mt-3 space-y-3">
                      <p className="text-xs text-muted">{t("designer.cropHint")}</p>
                      <label className="block text-xs font-semibold text-muted">
                        {t("designer.cropTolerance")}: {selected.cropTolerance ?? DEFAULT_CROP_TOLERANCE}
                        <input type="range" min={0} max={80} step={1} className="mt-2 w-full"
                          value={selected.cropTolerance ?? DEFAULT_CROP_TOLERANCE}
                          onChange={event => updateElement(labelElementKey(selected), { cropTolerance: Number(event.target.value) })} />
                      </label>
                      <label className="block text-xs font-semibold text-muted">
                        {t("designer.cropPadding")}: {selected.cropPadding ?? DEFAULT_CROP_PADDING}%
                        <input type="range" min={-10} max={20} step={1} className="mt-2 w-full"
                          value={selected.cropPadding ?? DEFAULT_CROP_PADDING}
                          onChange={event => updateElement(labelElementKey(selected), { cropPadding: Number(event.target.value) })} />
                      </label>
                      <p className="text-xs text-muted">{t("designer.cropPaddingHint")}</p>
                    </div> : null}
                  </div>
                ) : null}

                {selected.type === "qr" ? (
                  <div className="mt-4 space-y-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected.useShortcode ?? false}
                        onChange={event => updateElement(labelElementKey(selected), { useShortcode: event.target.checked })} />
                      {t("designer.useShortcode")}
                    </label>
                    <p className="text-xs text-muted">{t("designer.shortcodeHint")}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["foregroundColor", "designer.qrForeground", "#000000"],
                        ["backgroundColor", "designer.qrBackground", "#ffffff"],
                      ] as const).map(([key, labelKey, fallback]) => (
                        <label key={key} className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                          {t(labelKey)}
                          <input
                            type="color"
                            value={(selected as QrElement)[key] ?? fallback}
                            onChange={(event) =>
                              updateElement(labelElementKey(selected), {
                                [key]: event.target.value,
                              })
                            }
                            className="mt-1.5 h-10 w-full cursor-pointer rounded-lg border border-border bg-surface p-1"
                          />
                        </label>
                      ))}
                    </div>
                    <label className="block text-[12px] font-semibold text-muted">
                      {t("designer.qrMargin")}
                      <select
                        value={(selected as QrElement).quietZoneModules ?? 0}
                        onChange={(event) =>
                          updateElement(labelElementKey(selected), {
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
                    <p className="text-[11px] leading-4 text-muted">
                      {t("designer.qrColorHint")}
                    </p>
                  </div>
                ) : null}

                {["name", "subtitle", "identifier", "url", "location", "text"].includes(selected.type) ? (
                  <>
                    <div className="mt-4 space-y-3 rounded-xl border border-border bg-surface-subtle p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{t("designer.typography")}</p>
                      <LabelFontSelect
                        value={(selected as TextElement).fontFamily ?? (["name", "subtitle", "text"].includes(selected.type) ? "sans" : "monospace")}
                        onChange={fontFamily => {
                          const weights = labelFontWeights(fontFamily);
                          const currentWeight = (selected as TextElement).fontWeight;
                          const fontWeight = currentWeight === undefined ? undefined : weights.reduce((nearest, weight) => Math.abs(weight - currentWeight) < Math.abs(nearest - currentWeight) ? weight : nearest);
                          updateElement(labelElementKey(selected), { fontFamily, fontWeight });
                        }}
                      />
                      <label className="block text-[11px] font-semibold text-muted">
                        {t("designer.fontWeight")}
                        <select value={(selected as TextElement).fontWeight ?? ""} onChange={event => {
                          const weight = event.target.value ? Number(event.target.value) : undefined;
                          updateElement(labelElementKey(selected), { fontWeight: weight, ...((selected as TextElement).content ? { content: (selected as TextElement).content!.map(run => ({ ...run, weight: undefined })) } : {}) });
                        }} className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-foreground">
                          <option value="">{t("designer.originalWeight", { weight: defaultLabelFontWeight({ ...selected, fontWeight: undefined } as TextElement) })}</option>
                          {labelFontWeights((selected as TextElement).fontFamily).map(weight => <option key={weight} value={weight}>{weight} · {t(`designer.weights.${weight}`)}</option>)}
                        </select>
                      </label>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted">{t("designer.fontSizeUnits")}</p>
                        <div role="group" aria-label={t("designer.fontSizeUnits")} className="flex rounded-md bg-surface p-0.5">
                          {(["mm", "pt"] as const).map(unit => <button key={unit} type="button" aria-pressed={fontSizeUnit === unit} onClick={() => setFontSizeUnit(unit)} className={`rounded px-2 py-1 text-[11px] ${fontSizeUnit === unit ? "bg-brand-soft text-brand" : "text-muted"}`}>{unit}</button>)}
                        </div>
                      </div>
                      <LabelNumberControl key={`${labelElementKey(selected)}-size-${fontSizeUnit}`} label={t("designer.fontSizeValue")} unit={fontSizeUnit}
                        value={fontSizeUnit === "pt" ? mmToPoints((selected as TextElement).fontSizeMm ?? defaultLabelFontSize(selected as TextElement)) : (selected as TextElement).fontSizeMm ?? defaultLabelFontSize(selected as TextElement)}
                        min={fontSizeUnit === "pt" ? mmToPoints(0.5) : 0.5} max={fontSizeUnit === "pt" ? mmToPoints(100) : 100} step={fontSizeUnit === "pt" ? 0.5 : 0.1}
                        presets={fontSizeUnit === "pt" ? [6, 8, 9, 10, 12, 14, 16, 18, 24, 32, 48, 72] : [1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 16]}
                        onChange={(size, record) => {
                          const mm = Math.min(100, Math.max(0.5, fontSizeUnit === "pt" ? pointsToMm(size) : size));
                          updateElement(labelElementKey(selected), { fontSizeMm: mm, ...((selected as TextElement).minFontSizeMm! > mm ? { minFontSizeMm: mm } : {}) }, record);
                        }} />
                      <div className="grid grid-cols-2 gap-3">
                        <LabelNumberControl key={`${labelElementKey(selected)}-line`} label={t("designer.lineHeight")} value={(selected as TextElement).lineHeight ?? ((selected as TextElement).textOverflow === "shrink" ? 1.08 : 1.05)} min={0.8} max={3} step={0.01} unit="×"
                          onChange={(lineHeight, record) => updateElement(labelElementKey(selected), { lineHeight }, record)} />
                        <LabelNumberControl key={`${labelElementKey(selected)}-spacing`} label={t("designer.letterSpacing")} value={((selected as TextElement).letterSpacingEm ?? 0) * 100} min={-10} max={100} step={1} unit="%"
                          onChange={(spacing, record) => updateElement(labelElementKey(selected), { letterSpacingEm: spacing / 100 }, record)} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="mb-1 text-[11px] font-semibold text-muted">{t("designer.alignment")}</p>
                          <div role="group" aria-label={t("designer.alignment")} className="flex rounded-lg border border-border bg-surface p-0.5">
                            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([align, Icon]) => <button key={align} type="button" aria-label={t(`designer.align.${align}`)} title={t(`designer.align.${align}`)} aria-pressed={((selected as TextElement).align ?? 'left') === align} onClick={() => updateElement(labelElementKey(selected), { align })} className={`grid h-8 flex-1 place-items-center rounded-md ${((selected as TextElement).align ?? 'left') === align ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-hover'}`}><Icon size={15} /></button>)}
                          </div>
                        </div>
                        <div>
                          <p className="mb-1 text-[11px] font-semibold text-muted">{t("designer.verticalAlignment")}</p>
                          <div role="group" aria-label={t("designer.verticalAlignment")} className="flex rounded-lg border border-border bg-surface p-0.5">
                            {([['top', AlignStartHorizontal], ['middle', AlignCenterHorizontal], ['bottom', AlignEndHorizontal]] as const).map(([verticalAlign, Icon]) => <button key={verticalAlign} type="button" aria-label={t(`designer.verticalAlign.${verticalAlign}`)} title={t(`designer.verticalAlign.${verticalAlign}`)} aria-pressed={((selected as TextElement).verticalAlign ?? 'middle') === verticalAlign} onClick={() => updateElement(labelElementKey(selected), { verticalAlign })} className={`grid h-8 flex-1 place-items-center rounded-md ${((selected as TextElement).verticalAlign ?? 'middle') === verticalAlign ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-surface-hover'}`}><Icon size={15} /></button>)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <LabelRichTextEditor
                      key={labelElementKey(selected)}
                      value={defaultLabelTextContent(selected as TextElement)}
                      fontFamily={(selected as TextElement).fontFamily ?? (["name", "subtitle", "text"].includes(selected.type) ? "sans" : "monospace")}
                      fontWeight={defaultLabelFontWeight(selected as TextElement)}
                      placeholderValues={labelPlaceholderValues(previewResource, origin)}
                      onChange={content => updateElement(labelElementKey(selected), { content } as Partial<TextElement>)}
                    />
                    {selected.type !== "text" && (selected as TextElement).content !== undefined ? (
                      <button type="button" className="mt-2 text-xs text-brand hover:underline" onClick={() => updateElement(labelElementKey(selected), { content: undefined } as Partial<TextElement>)}>{t("designer.richText.reset")}</button>
                    ) : null}
                    <label className="mt-4 block text-[12px] font-semibold text-muted">
                      {t("designer.textOverflow")}
                      <select
                        value={(selected as TextElement).textOverflow ?? "ellipsis"}
                        disabled={rowLayout ? hugsRowContent(selected) || selected.heightSizing === "hug" : (selected as TextElement).autoWidth}
                        onChange={(event) =>
                          updateElement(labelElementKey(selected), {
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
                      <div className="mt-4">
                        <LabelNumberControl label={t("designer.minimumFontSize")} unit="mm"
                          min={0.5} max={(selected as TextElement).fontSizeMm ?? 3} step={0.1}
                          value={(selected as TextElement).minFontSizeMm ?? Math.min((selected as TextElement).fontSizeMm ?? 3, 1)}
                          onChange={(minFontSizeMm, record) => updateElement(labelElementKey(selected), { minFontSizeMm } as Partial<LabelElement>, record)} />
                      </div>
                    ) : null}
                  </>
                ) : null}
                <p className="mt-5 text-[12px] leading-5 text-muted">
                  {t(rowLayout ? "designer.rowInstructions" : "designer.instructions")}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted">
                {t("designer.chooseElement")}
              </p>
            )}
          </aside>
        </div>

        <div ref={printPreviewRef} aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}>
          <LabelRenderer resource={previewResource} setup={renderedSetup} origin={origin} />
        </div>
        <footer className="flex flex-col gap-3 border-t border-border bg-surface px-5 py-4 sm:px-6">
          <div>
            <button type="button" className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground" aria-expanded={showShortcuts} onClick={() => setShowShortcuts(current => !current)}><Keyboard size={14} />{t("designer.shortcuts")}</button>
            {showShortcuts ? <p className="mb-3 rounded-lg bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted-strong">{t(rowLayout ? "designer.rowShortcutHelp" : "designer.shortcutHelp")}</p> : null}
            {testError ? <p role="alert" className="mb-2 text-xs font-medium text-danger">{testError}</p> : null}
            {testSent ? <p role="status" className="mb-2 text-xs font-medium text-brand">{testPrintSuccess}</p> : null}
            {onTestPrint ? <p className="mb-2 text-xs text-muted">{t("designer.testHint", { destination: testPrintDestination, count: testCopies })}</p> : null}
            {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
            {rowHeightError || rowWidthError ? <p role="alert" className="text-xs font-semibold text-danger">{t(rowHeightError ? "designer.rowHeightError" : "designer.rowWidthError")}</p> : null}
            {qrImageOverlap ? (
              <p role="alert" className="text-xs font-medium text-warning">
                {t("designer.overlap")}
              </p>
            ) : !error ? (
              <p className="text-[12px] text-muted">
                {t("designer.previewNote")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onTestPrint ? <div className="mr-auto flex flex-wrap items-center gap-2">
              <LabelCopyCount label={t("copies.title")} value={testCopies} onChange={setTestCopies} disabled={saving || testPrinting || uploadingImage} />
              <Button variant="secondary" onClick={() => void testPrint()} disabled={saving || testPrinting || uploadingImage || layoutInvalid}>
              {testPrinting ? <LoaderCircle size={15} className="animate-spin" /> : <Printer size={15} />}{t(testPrinting ? "designer.testPrinting" : "designer.testPrint", { count: testCopies })}
            </Button></div> : null}
            {onDelete ? (
              <Button variant="danger" onClick={onDelete} disabled={saving || testPrinting || uploadingImage} className="sm:mr-2">
                {t("designer.delete")}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={saving || testPrinting || uploadingImage}>
              {t("designer.cancel")}
            </Button>
            {onSaveAsNew && value.id ? <Button variant="secondary" onClick={onSaveAsNew} disabled={saving || testPrinting || uploadingImage || !value.name.trim() || layoutInvalid}>
              <Copy size={15} />{t("designer.saveAsNew")}
            </Button> : null}
            <Button
              onClick={onSave}
              disabled={saving || testPrinting || uploadingImage || !value.name.trim() || layoutInvalid}
            >
              {saving ? t("designer.saving") : t("designer.save")}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
