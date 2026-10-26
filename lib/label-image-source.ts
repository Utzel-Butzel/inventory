import type { LabelElement } from "@/lib/label-setup-contract";
import type { LabelResource } from "@/lib/label-target";

export function labelImageSource(element: Extract<LabelElement, { type: "image" }>, resource: LabelResource) {
  return element.source || resource.cover?.url || null;
}
export function labelNeedsProductImage(elements: LabelElement[]) {
  return elements.some(element => element.type === "image" && element.visible && !element.source);
}
