import { labelElementKey, type LabelElement, type LabelSetupDto, type LabelRowLayout, type LabelTextElement } from "@/lib/label-setup-contract";

export function isRowText(element: LabelElement): element is LabelTextElement {
  return ["name", "subtitle", "identifier", "url", "location", "text"].includes(element.type);
}

export function hugsRowContent(element: LabelElement) {
  return isRowText(element) && element.rowSizing !== "fixed";
}

/** Flow order is independent of stacking order and the stored free-layout geometry. */
export function orderedRowElements(elements: LabelElement[]) {
  return elements.filter(element => element.type !== "background")
    .sort((a, b) => (a.rowOrder ?? a.x) - (b.rowOrder ?? b.x));
}

export function moveRowElement(elements: LabelElement[], key: string, index: number) {
  const ordered = orderedRowElements(elements);
  const source = ordered.findIndex(element => labelElementKey(element) === key);
  if (source < 0) return elements;
  const [element] = ordered.splice(source, 1);
  ordered.splice(Math.max(0, Math.min(index, ordered.length)), 0, element);
  const order = new Map(ordered.map((item, i) => [labelElementKey(item), i]));
  return elements.map(item => item.type === "background" ? item : { ...item, rowOrder: order.get(labelElementKey(item))! });
}

export const DEFAULT_LABEL_ROW: LabelRowLayout = {
  mode: "row", gapMm: 2, paddingTopMm: 0, paddingRightMm: 2,
  paddingBottomMm: 0, paddingLeftMm: 2, align: "middle",
};

export function initializeLabelRow<T extends Pick<LabelSetupDto, "widthMm" | "heightMm" | "elements" | "layout">>(setup: T): T {
  const order = new Map(orderedRowElements(setup.elements).map((item, i) => [labelElementKey(item), i]));
  return {
    ...setup, layout: setup.layout ?? { ...DEFAULT_LABEL_ROW },
    elements: setup.elements.map(element => element.type === "background" ? element : {
      ...element, rowOrder: order.get(labelElementKey(element)),
      rowWidthMm: element.rowWidthMm ?? Math.max(0.1, element.width / 100 * setup.widthMm),
      rowHeightMm: element.rowHeightMm ?? Math.max(0.1, element.height / 100 * setup.heightMm),
    }),
  };
}

/** Resolve in millimeters first so text growth never scales images, QR codes or spacing. */
export function resolveLabelRow(setup: LabelSetupDto, measuredWidths: Record<string, number>): LabelSetupDto {
  const layout = setup.layout;
  if (!layout) return setup;
  const availableHeight = setup.heightMm - layout.paddingTopMm - layout.paddingBottomMm;
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  let right = layout.paddingLeftMm;
  const items = orderedRowElements(setup.elements).filter(element => element.visible);
  items.forEach((element, index) => {
    const measured = measuredWidths[labelElementKey(element)];
    const width = hugsRowContent(element) && Number.isFinite(measured)
      ? Math.max(0.1, measured) : element.rowWidthMm ?? element.width / 100 * setup.widthMm;
    const height = element.rowHeightMm ?? element.height / 100 * setup.heightMm;
    const y = layout.paddingTopMm + Math.max(0, availableHeight - height) *
      (layout.align === "bottom" ? 1 : layout.align === "middle" ? 0.5 : 0);
    boxes.set(labelElementKey(element), { x: right, y, width, height });
    right += width + (index < items.length - 1 ? layout.gapMm : 0);
  });
  const widthMm = Math.max(1, right + layout.paddingRightMm);
  return {
    ...setup, widthMm,
    elements: setup.elements.map(element => {
      if (element.type === "background") return { ...element, x: 0, y: 0, width: 100, height: 100 };
      const box = boxes.get(labelElementKey(element));
      return box ? { ...element, x: box.x / widthMm * 100, y: box.y / setup.heightMm * 100,
        width: box.width / widthMm * 100, height: box.height / setup.heightMm * 100 } : element;
    }),
  };
}
