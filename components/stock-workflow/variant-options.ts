import type { StockItem, WorkflowDraft } from "./types";

// Match the runtime: choose a direct variant, or the target itself if none exist.
export function workflowVariantOptions(
  draft: Pick<WorkflowDraft, "allowVariantSelection">,
  target: StockItem,
  resources: StockItem[],
) {
  const variants = draft.allowVariantSelection
    ? resources.filter((item) => item.variantOfResourceId === target.resourceId)
    : [];
  return variants.length
    ? variants.sort((a, b) => a.name.localeCompare(b.name) || a.resourceId.localeCompare(b.resourceId))
    : [target];
}
