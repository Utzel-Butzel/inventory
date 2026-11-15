import type { LabelAutoLayoutGroup, LabelElement, LabelRowLayout, LabelSetupDto } from "@/lib/label-setup-contract";

export type LayoutBox = { x: number; y: number; width: number; height: number };
export type LayoutMeasurements = { widths?: Record<string, number>; heights?: Record<string, number> };
type Sizing = "hug" | "fill" | "fixed";
type Frame = LabelAutoLayoutGroup | LabelRowLayout;
type Node = { id: string; element?: LabelElement; frame?: Frame; children: Node[]; order: number };
type Box = LayoutBox & { node: Node; children: Box[]; overflowY: boolean; overflowX: boolean };
const textTypes = new Set(["name", "subtitle", "identifier", "url", "location", "text"]);
const key = (element: LabelElement) => element.id ?? element.type;
const factor = (align: string | undefined) => align === "end" || align === "bottom" ? 1 : align === "center" || align === "middle" ? 0.5 : 0;
const positive = (value: number) => Math.max(0.1, value);
export function framePadding(frame: Frame) {
  const fallback = "paddingMm" in frame ? frame.paddingMm : 0;
  return { top: frame.paddingTopMm ?? fallback, right: frame.paddingRightMm ?? fallback,
    bottom: frame.paddingBottomMm ?? fallback, left: frame.paddingLeftMm ?? fallback };
}
export function elementWidthSizing(element: LabelElement): Sizing {
  return element.widthSizing ?? (textTypes.has(element.type) && (!("rowSizing" in element) || element.rowSizing !== "fixed") ? "hug" : "fixed");
}

/** Shared physical layout for the designer, renderer and print validation. No browser state. */
export function computeLabelAutoLayout(
  setup: Pick<LabelSetupDto, "layout" | "elements" | "widthMm" | "heightMm">,
  measurements: LayoutMeasurements = {},
) {
  const elements: Record<string, LayoutBox> = {}, frames: Record<string, LayoutBox> = {};
  const layout = setup.layout;
  if (!layout) return { widthMm: setup.widthMm, heightMm: setup.heightMm, elements, frames, overflowY: false, overflowX: false };
  const root: Node = { id: "$root", frame: layout, children: [], order: 0 };
  const groups = new Map((layout.groups ?? []).map(frame => [frame.id, { id: frame.id, frame, children: [], order: frame.order ?? Infinity } as Node]));
  for (const node of groups.values()) {
    const parent = "parentId" in node.frame! ? node.frame.parentId : undefined;
    (groups.get(parent ?? "") ?? root).children.push(node);
  }
  for (const element of setup.elements) {
    if (element.type === "background" || element.ignoreLayout) continue;
    (groups.get(element.groupId ?? "") ?? root).children.push({ id: key(element), element, children: [], order: element.rowOrder ?? element.x });
  }
  // Old groups derive their position from their first member; explicit order takes precedence.
  const sort = (node: Node, path = new Set<string>()): number => {
    if (path.has(node.id)) { node.children = []; return 0; }
    const seen = new Set(path).add(node.id);
    const orders = node.children.map(child => sort(child, seen));
    if (!Number.isFinite(node.order)) node.order = Math.min(...orders, 64);
    node.children.sort((a, b) => a.order - b.order);
    return node.order;
  };
  sort(root);
  const visible = (node: Node): boolean => node.element ? node.element.visible : (node.frame as LabelAutoLayoutGroup).visible !== false &&
    (node.frame?.widthSizing === "fixed" || node.frame?.heightSizing === "fixed" || node.children.some(visible));
  const mode = (node: Node, axis: "width" | "height"): Sizing => node === root
    ? axis === "height" ? "fixed" : layout.widthSizing === "fixed" ? "fixed" : "hug"
    : node.element ? axis === "width" ? elementWidthSizing(node.element) : node.element.heightSizing ?? "fixed"
      : node.frame?.[axis === "width" ? "widthSizing" : "heightSizing"] ?? "hug";

  const cache = new Map<string, Box>();
  const measure = (node: Node, forcedWidth?: number, forcedHeight?: number, depth = 0): Box => {
    const cacheKey = `${node.id}:${forcedWidth}:${forcedHeight}`;
    let result = cache.get(cacheKey);
    if (!result) { result = measureNode(node, forcedWidth, forcedHeight, depth); cache.set(cacheKey, result); }
    return { ...result };
  };
  const measureNode = (node: Node, forcedWidth?: number, forcedHeight?: number, depth = 0): Box => {
    if (node.element) {
      const e = node.element;
      const width = forcedWidth ?? (mode(node, "width") === "hug" ? measurements.widths?.[node.id] : undefined)
        ?? e.rowWidthMm ?? e.width / 100 * setup.widthMm;
      const height = forcedHeight ?? (mode(node, "height") === "hug" ? measurements.heights?.[node.id] : undefined)
        ?? e.rowHeightMm ?? e.height / 100 * setup.heightMm;
      return { node, x: 0, y: 0, width: positive(width), height: positive(height), children: [], overflowX: false, overflowY: false };
    }
    const frame = node.frame!;
    const padding = framePadding(frame);
    const vertical = frame.direction === "column";
    const main = vertical ? "height" : "width", cross = vertical ? "width" : "height";
    const mainStart = vertical ? padding.top : padding.left, mainEnd = vertical ? padding.bottom : padding.right;
    const crossStart = vertical ? padding.left : padding.top, crossEnd = vertical ? padding.right : padding.bottom;
    const nodes = depth > 32 ? [] : node.children.filter(visible);
    const natural = nodes.map(child => measure(child, undefined, undefined, depth + 1));
    // Empty legacy groups occupy no space; explicitly sized frames still keep their dimensions.
    const explicit = {
      width: forcedWidth ?? (mode(node, "width") === "fixed" ? node === root ? setup.widthMm : frame.widthMm ?? 10 : undefined),
      height: forcedHeight ?? (mode(node, "height") === "fixed" ? node === root ? setup.heightMm : frame.heightMm ?? 10 : undefined),
    };
    const gap = frame.gapMm;
    const crossGap = frame.crossGapMm ?? gap;
    const limit = explicit[main] === undefined ? Infinity : positive(explicit[main]! - mainStart - mainEnd);
    const lines: Box[][] = [[]];
    let occupied = 0;
    for (const child of natural) {
      let line = lines[lines.length - 1];
      if (frame.wrap && line.length && occupied + gap + child[main] > limit + 0.000001) {
        lines.push([]); line = lines[lines.length - 1]; occupied = 0;
      }
      occupied += (line.length ? gap : 0) + child[main];
      line.push(child);
    }
    const mainExtent = (line: Box[]) => {
      let cursor = 0, end = 0;
      for (const child of line) { end = Math.max(end, cursor + child[main]); cursor += child[main] + gap; }
      return end;
    };
    const naturalMain = Math.max(0, ...lines.map(mainExtent));
    const naturalCross = lines.reduce((sum, line, index) => sum + Math.max(0, ...line.map(child => child[cross])) + (index ? crossGap : 0), 0);
    const size = { width: 0, height: 0 };
    size[main] = positive(explicit[main] ?? mainStart + naturalMain + mainEnd);
    size[cross] = positive(explicit[cross] ?? crossStart + naturalCross + crossEnd);
    const innerMain = positive(size[main] - mainStart - mainEnd);
    let innerCross = positive(size[cross] - crossStart - crossEnd);
    // Resolve fill against available space, then remeasure nested frames at their assigned size.
    const laidLines = lines.map(line => {
      const fills = line.filter(child => mode(child.node, main) === "fill");
      const fixed = line.filter(child => mode(child.node, main) !== "fill").reduce((sum, child) => sum + child[main], 0);
      const fillSize = positive((innerMain - fixed - gap * Math.max(0, line.length - 1)) / Math.max(1, fills.length));
      const lineCross = lines.length === 1 ? innerCross : Math.max(0.1, ...line.map(child => child[cross]));
      return line.map(child => {
        const assigned: { width?: number; height?: number } = {};
        if (mode(child.node, main) === "fill") assigned[main] = fillSize;
        if (mode(child.node, cross) === "fill") assigned[cross] = lineCross;
        return measure(child.node, assigned.width, assigned.height, depth + 1);
      });
    });
    if (explicit[cross] === undefined) {
      size[cross] = positive(crossStart + crossEnd + laidLines.reduce((sum, line, index) => sum + Math.max(0, ...line.map(child => child[cross])) + (index ? crossGap : 0), 0));
      innerCross = positive(size[cross] - crossStart - crossEnd);
    }
    const totalCross = laidLines.reduce((sum, line, index) => sum + Math.max(0, ...line.map(child => child[cross])) + (index ? crossGap : 0), 0);
    let crossCursor = crossStart + (lines.length > 1 ? Math.max(0, innerCross - totalCross) * factor(frame.align) : 0);
    const children: Box[] = [];
    for (const line of laidLines) {
      const lineCross = lines.length === 1 ? innerCross : Math.max(0.1, ...line.map(child => child[cross]));
      const used = line.reduce((sum, child) => sum + child[main], 0);
      const actualGap = frame.mainAlign === "space-between" && line.length > 1 ? Math.max(0, (innerMain - used) / (line.length - 1)) : gap;
      let cursor = mainStart + (frame.mainAlign === "space-between" ? 0 : Math.max(0, innerMain - used - gap * Math.max(0, line.length - 1)) * factor(frame.mainAlign));
      for (const child of line) {
        const offset = crossCursor + Math.max(0, lineCross - child[cross]) * factor(frame.align);
        child.x = vertical ? offset : cursor;
        child.y = vertical ? cursor : offset;
        children.push(child);
        cursor += child[main] + actualGap;
      }
      crossCursor += lineCross + crossGap;
    }
    const overflowY = size.height - padding.top - padding.bottom < 0.1 || children.some(child => child.overflowY || child.y + child.height > size.height - padding.bottom + 0.000001);
    const overflowX = children.some(child => child.overflowX || child.x + child.width > size.width - padding.right + 0.000001);
    return { node, x: 0, y: 0, ...size, children, overflowY, overflowX };
  };
  const box = measure(root);
  const collect = (box: Box, x: number, y: number) => {
    const bounds = { x: x + box.x, y: y + box.y, width: box.width, height: box.height };
    (box.node.element ? elements : frames)[box.node.id] = bounds;
    for (const child of box.children) collect(child, bounds.x, bounds.y);
  };
  collect(box, 0, 0);
  for (const element of setup.elements.filter(element => element.ignoreLayout && element.visible)) {
    let parent = element.groupId;
    let hidden = false;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const group = layout.groups?.find(group => group.id === parent);
      if (group?.visible === false) hidden = true;
      parent = group?.parentId;
    }
    if (hidden) continue;
    const parentBox = frames[element.groupId ?? "$root"];
    elements[key(element)] = { x: (parentBox?.x ?? 0) + element.x / 100 * setup.widthMm, y: (parentBox?.y ?? 0) + element.y / 100 * setup.heightMm,
      width: element.rowWidthMm ?? element.width / 100 * setup.widthMm, height: element.rowHeightMm ?? element.height / 100 * setup.heightMm };
  }
  return { widthMm: Math.max(1, box.width), heightMm: setup.heightMm, elements, frames, overflowY: box.overflowY, overflowX: box.overflowX };
}
