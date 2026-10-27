import type { ScanWorkflowInputField } from "@/lib/scan-workflow-contract";

// Only prepare a review automatically for a fully answered choice form.
// Free text, uploads, empty optional choices and multi-target runs stay manual.
export function canAutomaticallyReviewAssembly(
  actions: readonly { type: string; enabled?: boolean }[],
  fields: readonly Pick<ScanWorkflowInputField, "type" | "key" | "options">[],
  inputs: Record<string, unknown>,
  identifier: string,
  selectedResourceIds: readonly string[],
) {
  return Boolean(identifier.trim()) && selectedResourceIds.length === 1 &&
    actions.some((action) => action.enabled !== false && action.type === "assembly-build") &&
    fields.length > 0 && fields.every((field) =>
      (field.type === "radio" || field.type === "select") &&
      field.options.some((option) => option.value === inputs[field.key]),
    );
}
