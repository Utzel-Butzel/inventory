import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { resources, stockScanWorkflows } from "@/db/schema";
import { db } from "@/lib/db";
import {
  getScanWorkflowTargetGroups,
  type ScanWorkflowTargetGroup,
} from "@/lib/scan-workflows";

export type PublicActionFlowView = {
  triggerId: string;
  name: string;
  description: string;
  resourceName: string;
  targetSelectionMode: "all" | "radio" | "checkbox";
  allowVariantSelection: boolean;
  targetGroups: ScanWorkflowTargetGroup[];
  requiresCode: boolean;
  identifierLabel: string;
  quantityInputKey: string | null;
  inputFields: Array<{
    key: string;
    label: string;
    required: boolean;
    type: "text" | "textarea" | "number" | "checkbox" | "select" | "radio" | "media" | "file";
    placeholder: string;
    options: Array<{ value: string; label: string; color?: string }>;
  }>;
  operation:
    | { type: "unit" }
    | { type: "stock-adjustment"; direction: "in" | "out"; quantity: number }
    | { type: "assembly-build"; quantity: number };
};

const publicActionFlowDto = (
  workflow: typeof stockScanWorkflows.$inferSelect,
  resourceName: string,
  targetGroups: ScanWorkflowTargetGroup[],
): PublicActionFlowView => ({
  triggerId: workflow.publicTriggerId,
  name: workflow.name,
  description: workflow.description,
  resourceName,
  targetSelectionMode: workflow.targetSelectionMode,
  allowVariantSelection: workflow.allowVariantSelection,
  targetGroups,
  requiresCode: !workflow.publicTriggerCode,
  identifierLabel: workflow.identifierPropertyKey,
  quantityInputKey: workflow.quantityInputKey,
  inputFields: workflow.inputFields.map((field) => ({
    key: field.key,
    label: field.label,
    required: field.required,
    type: field.type ?? "select",
    placeholder: field.placeholder ?? "",
    options: field.options,
  })),
  operation:
    workflow.operation.type === "stock-adjustment"
      ? {
          type: "stock-adjustment",
          direction: workflow.operation.delta > 0 ? "in" : "out",
          quantity: Math.abs(workflow.operation.delta),
        }
      : workflow.operation,
});

export async function getPublicActionFlow(triggerId: string) {
  if (!z.string().uuid().safeParse(triggerId).success) return null;
  const [result] = await db
    .select({ workflow: stockScanWorkflows, resourceName: resources.name })
    .from(stockScanWorkflows)
    .innerJoin(
      resources,
      and(
        eq(resources.organizationId, stockScanWorkflows.organizationId),
        eq(resources.id, stockScanWorkflows.resourceId),
      ),
    )
    .where(
      and(
        eq(stockScanWorkflows.publicTriggerId, triggerId),
        eq(stockScanWorkflows.publicTriggerEnabled, true),
        eq(stockScanWorkflows.enabled, true),
      ),
    )
    .limit(1);
  if (!result) return null;
  const targetGroups = await getScanWorkflowTargetGroups(
    result.workflow.organizationId,
    result.workflow,
  );
  return {
    workflow: result.workflow,
    view: publicActionFlowDto(
      result.workflow,
      targetGroups.map((group) => group.name).join(", ") || result.resourceName,
      targetGroups,
    ),
  };
}
