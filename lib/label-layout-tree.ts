import { labelElementKey, MAX_LABEL_ELEMENTS, type LabelAutoLayoutGroup, type LabelElement, type LabelSetupDto } from "@/lib/label-setup-contract";
import type { LayoutBox } from "@/lib/label-layout-engine";
export type LayoutDraft = Pick<LabelSetupDto, "layout" | "elements" | "widthMm" | "heightMm">;
export const ROOT_FRAME = "$root";
export type LayoutItem = { id: string; parentId: string; order: number; element?: LabelElement; frame?: LabelAutoLayoutGroup };

export function layoutItems(setup: LayoutDraft): LayoutItem[] {
  const groups = setup.layout?.groups ?? [];
  const order = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 64;
    seen.add(id);
    const frame = groups.find(group => group.id === id);
    return frame?.order ?? Math.min(64, ...setup.elements.filter(e => e.groupId === id).map(e => e.rowOrder ?? e.x),
      ...groups.filter(group => group.parentId === id).map(group => order(group.id, new Set(seen))));
  };
  return [
    ...setup.elements.filter(e => e.type !== "background").map(element => ({ id: labelElementKey(element), parentId: element.groupId ?? ROOT_FRAME, order: element.rowOrder ?? element.x, element })),
    ...groups.map(frame => ({ id: frame.id, parentId: frame.parentId ?? ROOT_FRAME, order: order(frame.id), frame })),
  ];
}
export const layoutChildren = (setup: LayoutDraft, parent = ROOT_FRAME) => layoutItems(setup).filter(item => item.parentId === parent).sort((a, b) => a.order - b.order);
export function layoutAncestors(setup: LayoutDraft, id: string) {
  const items = new Map(layoutItems(setup).map(item => [item.id, item]));
  const ancestors: string[] = [];
  let parent = items.get(id)?.parentId;
  while (parent && !ancestors.includes(parent)) { ancestors.push(parent); parent = items.get(parent)?.parentId; }
  return ancestors;
}
export function topLevelSelection(setup: LayoutDraft, ids: string[]) {
  const valid = new Set(layoutItems(setup).map(item => item.id));
  return [...new Set(ids)].filter(id => valid.has(id) && !layoutAncestors(setup, id).some(parent => ids.includes(parent)));
}
function writeItems<T extends LayoutDraft>(setup: T, items: LayoutItem[]): T {
  const byId = new Map(items.map(item => [item.id, item]));
  return { ...setup, elements: setup.elements.filter(e => e.type === "background" || byId.has(labelElementKey(e))).map(element => {
    const item = byId.get(labelElementKey(element));
    return item ? { ...element, groupId: item.parentId === ROOT_FRAME ? undefined : item.parentId, rowOrder: item.order } : element;
  }), layout: setup.layout ? { ...setup.layout, groups: items.filter(item => item.frame).map(item => ({ ...item.frame!, parentId: item.parentId === ROOT_FRAME ? undefined : item.parentId, order: item.order })) } : setup.layout };
}
export function moveLayoutNodes<T extends LayoutDraft>(setup: T, ids: string[], parentId: string, index: number): T {
  const selected = topLevelSelection(setup, ids);
  if (!selected.length || (parentId !== ROOT_FRAME && !setup.layout?.groups?.some(group => group.id === parentId))) return setup;
  if (selected.includes(parentId) || layoutAncestors(setup, parentId).some(id => selected.includes(id))) return setup;
  const items = layoutItems(setup);
  const moved = items.filter(item => selected.includes(item.id)).sort((a, b) => a.order - b.order);
  const siblings = items.filter(item => item.parentId === parentId && !selected.includes(item.id)).sort((a, b) => a.order - b.order);
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, ...moved);
  siblings.forEach((item, order) => { item.parentId = parentId; item.order = order; });
  return writeItems(setup, items);
}
export function wrapLayoutNodes<T extends LayoutDraft>(setup: T, ids: string[], id: string, name: string, boxes: Record<string, LayoutBox> = {}): T {
  if (!setup.layout || (setup.layout.groups?.length ?? 0) >= MAX_LABEL_ELEMENTS) return setup;
  const selected = topLevelSelection(setup, ids);
  const paths = selected.map(key => layoutAncestors(setup, key));
  const parent = paths[0]?.find(ancestor => paths.every(path => path.includes(ancestor))) ?? ROOT_FRAME;
  const ordered = layoutItems(setup).filter(item => selected.includes(item.id)).sort((a, b) => a.order - b.order);
  const bounds = ordered.map(item => boxes[item.id]).filter(Boolean);
  const horizontalSpread = bounds.length > 1 ? Math.max(...bounds.map(box => box.x)) - Math.min(...bounds.map(box => box.x)) : 0;
  const verticalSpread = bounds.length > 1 ? Math.max(...bounds.map(box => box.y)) - Math.min(...bounds.map(box => box.y)) : 0;
  const direction = verticalSpread > horizontalSpread ? "column" : "row";
  const sorted = [...ordered].sort((a, b) => (boxes[a.id]?.[direction === "row" ? "x" : "y"] ?? a.order) - (boxes[b.id]?.[direction === "row" ? "x" : "y"] ?? b.order));
  const distances = sorted.slice(1).map((item, index) => {
    const previous = boxes[sorted[index].id], current = boxes[item.id];
    return previous && current ? direction === "row" ? current.x - previous.x - previous.width : current.y - previous.y - previous.height : 0;
  });
  const gapMm = distances.length ? Math.round(distances.reduce((a, b) => a + b, 0) / distances.length * 100) / 100 : 0;
  const frame: LabelAutoLayoutGroup = { id, name, parentId: parent === ROOT_FRAME ? undefined : parent, order: Math.min(64, ...ordered.map(item => item.order)),
    direction, gapMm: Math.max(-1000, Math.min(1000, gapMm)), paddingMm: 0, align: "start", widthSizing: selected.length ? "hug" : "fixed", heightSizing: selected.length ? "hug" : "fixed", widthMm: 10, heightMm: 5 };
  let next = { ...setup, layout: { ...setup.layout, groups: [...(setup.layout.groups ?? []), frame] } } as T;
  next = moveLayoutNodes(next, sorted.map(item => item.id), id, 0);
  return next;
}
export function dissolveLayoutFrame<T extends LayoutDraft>(setup: T, id: string): T {
  const frame = setup.layout?.groups?.find(group => group.id === id);
  if (!frame) return setup;
  const parent = frame.parentId ?? ROOT_FRAME;
  const siblings = layoutChildren(setup, parent);
  const next = moveLayoutNodes(setup, layoutChildren(setup, id).map(item => item.id), parent, siblings.findIndex(item => item.id === id));
  return { ...next, layout: { ...next.layout!, groups: next.layout!.groups?.filter(group => group.id !== id) } };
}
export function deleteLayoutNodes<T extends LayoutDraft>(setup: T, ids: string[]): T {
  return writeItems(setup, layoutItems(setup).filter(item => !ids.includes(item.id) && !layoutAncestors(setup, item.id).some(parent => ids.includes(parent))));
}
export function duplicateLayoutNodes<T extends LayoutDraft>(setup: T, ids: string[], createId: () => string): { setup: T; ids: string[] } {
  const selection = topLevelSelection(setup, ids);
  const items = layoutItems(setup).filter(item => selection.includes(item.id) || layoutAncestors(setup, item.id).some(parent => selection.includes(parent)));
  if (setup.elements.length + items.filter(item => item.element).length > MAX_LABEL_ELEMENTS || (setup.layout?.groups?.length ?? 0) + items.filter(item => item.frame).length > MAX_LABEL_ELEMENTS) return { setup, ids };
  const mapping = new Map(items.map(item => [item.id, createId()]));
  const elements = items.filter(item => item.element).map(item => ({ ...structuredClone(item.element!), ...("autoWidth" in item.element! ? { autoWidth: false } : {}), id: mapping.get(item.id)!, groupId: mapping.get(item.parentId) ?? (item.parentId === ROOT_FRAME ? undefined : item.parentId), rowOrder: item.order + 0.5 }));
  const groups = items.filter(item => item.frame).map(item => ({ ...structuredClone(item.frame!), id: mapping.get(item.id)!, parentId: mapping.get(item.parentId) ?? (item.parentId === ROOT_FRAME ? undefined : item.parentId), order: item.order + 0.5 }));
  let next = { ...setup, elements: [...setup.elements, ...elements], layout: { ...setup.layout!, groups: [...(setup.layout?.groups ?? []), ...groups] } } as T;
  // Fractional values are temporary; normalize every sibling list before persistence.
  const all = layoutItems(next);
  for (const parent of new Set(all.map(item => item.parentId))) all.filter(item => item.parentId === parent).sort((a, b) => a.order - b.order).forEach((item, index) => { item.order = index; });
  next = writeItems(next, all);
  return { setup: next, ids: selection.map(id => mapping.get(id)!) };
}
