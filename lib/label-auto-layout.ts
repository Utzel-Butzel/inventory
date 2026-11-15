import { computeLabelAutoLayout, elementWidthSizing, type LayoutBox } from "@/lib/label-layout-engine";
import { labelElementKey, type LabelElement, type LabelSetupDto, type LabelRowLayout, type LabelTextElement } from "@/lib/label-setup-contract";

export function isRowText(element: LabelElement): element is LabelTextElement {
  return ["name", "subtitle", "identifier", "url", "location", "text"].includes(element.type);
}

export function hugsRowContent(element: LabelElement) {
  return isRowText(element) && elementWidthSizing(element) === "hug";
}

/** Flow order is independent of stacking order and the stored free-layout geometry. */
export function orderedRowElements(elements: LabelElement[]) {
  return elements.filter(element => element.type !== "background")
    .sort((a, b) => (a.rowOrder ?? a.x) - (b.rowOrder ?? b.x));
}

/** Groups form indivisible items in the outer row. */
export function rowBlocks(elements: LabelElement[]) {
  const blocks: LabelElement[][] = [];
  const groups = new Map<string, LabelElement[]>();
  for (const element of orderedRowElements(elements)) {
    if (!element.groupId) { blocks.push([element]); continue; }
    let members = groups.get(element.groupId);
    if (!members) { members = []; groups.set(element.groupId, members); blocks.push(members); }
    members.push(element);
  }
  return blocks;
}

export function rowSiblings(elements: LabelElement[], key: string) {
  const element = elements.find(item => labelElementKey(item) === key);
  return element?.groupId
    ? orderedRowElements(elements).filter(item => item.groupId === element.groupId)
    : rowBlocks(elements).map(block => block[0]);
}

function applyRowOrder(elements: LabelElement[], ordered: LabelElement[]) {
  const order = new Map(ordered.map((item, index) => [labelElementKey(item), index]));
  return elements.map(item => item.type === "background" ? item : { ...item, rowOrder: order.get(labelElementKey(item))! });
}

export function moveRowElement(elements: LabelElement[], key: string, index: number) {
  const blocks = rowBlocks(elements);
  const blockIndex = blocks.findIndex(block => block.some(item => labelElementKey(item) === key));
  if (blockIndex < 0) return elements;
  const block = blocks[blockIndex];
  if (block[0].groupId) {
    const source = block.findIndex(item => labelElementKey(item) === key);
    const [element] = block.splice(source, 1);
    block.splice(Math.max(0, Math.min(index, block.length)), 0, element);
  } else {
    blocks.splice(blockIndex, 1);
    blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, block);
  }
  return applyRowOrder(elements, blocks.flat());
}

export function moveRowGroup(elements: LabelElement[], groupId: string, direction: number) {
  const blocks = rowBlocks(elements);
  const index = blocks.findIndex(block => block[0].groupId === groupId);
  if (index < 0) return elements;
  const [block] = blocks.splice(index, 1);
  blocks.splice(Math.max(0, Math.min(index + direction, blocks.length)), 0, block);
  return applyRowOrder(elements, blocks.flat());
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
      ...element, rowOrder: element.rowOrder ?? order.get(labelElementKey(element)),
      rowWidthMm: element.rowWidthMm ?? Math.max(0.1, element.width / 100 * setup.widthMm),
      rowHeightMm: element.rowHeightMm ?? Math.max(0.1, element.height / 100 * setup.heightMm),
    }),
  };
}

/** Resolve in millimeters first so text growth never scales images, QR codes or spacing. */
export type ResolvedLabelSetup = LabelSetupDto & { autoLayoutFrames?: Record<string, LayoutBox>; autoLayoutOverflowY?: boolean; autoLayoutOverflowX?: boolean };
export function resolveLabelRow(setup: LabelSetupDto, measuredWidths: Record<string, number>, measuredHeights: Record<string, number> = {}): ResolvedLabelSetup {
  if (!setup.layout) return setup;
  const result = computeLabelAutoLayout(setup, { widths: measuredWidths, heights: measuredHeights });
  return {
    ...setup, widthMm: result.widthMm, autoLayoutFrames: result.frames,
    autoLayoutOverflowY: result.overflowY, autoLayoutOverflowX: result.overflowX,
    elements: setup.elements.map(element => {
      if (element.type === "background") return { ...element, x: 0, y: 0, width: 100, height: 100 };
      const box = result.elements[labelElementKey(element)];
      return box ? { ...element, x: box.x / result.widthMm * 100, y: box.y / setup.heightMm * 100,
        width: box.width / result.widthMm * 100, height: box.height / setup.heightMm * 100 } : { ...element, visible: false };
    }),
  };
}
