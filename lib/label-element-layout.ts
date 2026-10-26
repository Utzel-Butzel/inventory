import { labelElementsOverlap, type LabelElement } from "@/lib/label-setup-contract";

/** Place a new instance without changing any of the existing elements. */
export function placeNewLabelElement(
  element: LabelElement,
  existing: LabelElement[],
): LabelElement {
  if (element.type === "background") return element;
  const occupied = existing.filter(item => item.visible && item.type !== "background");
  const previous = occupied.findLast(item => item.type === element.type);
  const preferred = {
    ...element,
    x: Math.min(previous ? previous.x + 4 : element.x, 100 - element.width),
    y: Math.min(previous ? previous.y + 4 : element.y, 100 - element.height),
  };
  const xPositions = new Set([preferred.x, 0, 100 - element.width]);
  const yPositions = new Set([preferred.y, 0, 100 - element.height]);
  for (const item of occupied) {
    xPositions.add(item.x + item.width + 2);
    xPositions.add(item.x - element.width - 2);
    yPositions.add(item.y + item.height + 2);
    yPositions.add(item.y - element.height - 2);
  }
  const candidates = [...xPositions]
    .filter(x => x >= 0 && x + element.width <= 100)
    .flatMap(x => [...yPositions]
      .filter(y => y >= 0 && y + element.height <= 100)
      .map(y => ({ ...element, x, y })))
    .sort((a, b) =>
      Math.hypot(a.x - preferred.x, a.y - preferred.y) -
      Math.hypot(b.x - preferred.x, b.y - preferred.y));

  const free = candidates.find(candidate =>
    occupied.every(item => !labelElementsOverlap(candidate, item)));
  if (free) return free;

  // Text can overlap other elements, but object images must not cover QR codes.
  const protectedType = element.type === "qr" ? "image" : element.type === "image" ? "qr" : null;
  if (protectedType) {
    const safe = candidates.find(candidate => occupied.every(item =>
      item.type !== protectedType || !labelElementsOverlap(candidate, item)));
    if (safe) return safe;
  }
  // If the label is full, leave the new instance selected for manual placement.
  return preferred;
}

/** Keep foreground ordering independent of full-label backgrounds. */
export function moveLabelElement(elements: LabelElement[], key: string, direction: "front" | "back"): LabelElement[] {
  const selected = elements.find(element => (element.id ?? element.type) === key);
  if (!selected) return elements;
  const remaining = elements.filter(element => element !== selected);
  return direction === "front" ? [...remaining, selected] : [selected, ...remaining];
}

export function duplicateLabelElement(element: LabelElement, existing: LabelElement[], id: string): LabelElement {
  return placeNewLabelElement({ ...structuredClone(element), id }, existing);
}
