import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import {
  inventoryAssignments,
  resourceRelations,
  resources,
  stockMovements,
  stockScanExecutions,
  stockScanWorkflows,
  stockSettings,
  stockUnits,
  type StockScanWorkflowRecord,
  type StockUnitRecord,
} from "@/db/schema";
import { db, type DatabaseExecutor } from "@/lib/db";
import { buildAssembly } from "@/lib/assemblies";
import {
  listCustomFieldDefinitions,
  validateCustomFieldValues,
} from "@/lib/custom-fields";
import type {
  CustomFieldValue,
  CustomFieldValues,
} from "@/lib/custom-field-contract";
import { isCustomFieldDefinitionApplicable } from "@/lib/custom-field-contract";
import { bookStockMovement } from "@/lib/stock";
import {
  enqueueStockMovementWebhookEvents,
  enqueueWebhookEvent,
} from "@/lib/webhooks";
import {
  scanWorkflowCreateSchema,
  scanWorkflowLimits,
  type ScanWorkflowCreateInput,
  type ScanWorkflowDto,
  type ScanWorkflowExtraction,
  type ScanWorkflowPatchInput,
  type StockScanExecuteInput,
} from "@/lib/scan-workflow-contract";
import type { ScanCodeType } from "@/lib/scan-code-types";
import { extractScanRegexValue } from "@/lib/scan-regex";

const MAX_STOCK_QUANTITY = 2_000_000_000;

export class ScanWorkflowError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ScanWorkflowError";
  }
}

export function scanWorkflowHttpError(error: unknown, fallback: string) {
  if (error instanceof ScanWorkflowError) {
    return {
      status: error.status,
      message: error.message,
      details: error.details,
    };
  }
  const message = error instanceof Error ? error.message : "";
  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    ([403, 404, 409, 422] as const).includes(
      (error as { status: 403 | 404 | 409 | 422 }).status,
    )
      ? (error as { status: 403 | 404 | 409 | 422 }).status
      : null;
  if (status) {
    return { status, message: message || fallback, details: undefined };
  }
  if (message.includes("stock_units_resource_code_unique")) {
    return {
      status: 409 as const,
      message: "A serialized unit with that identifier already exists.",
      details: undefined,
    };
  }
  return {
    status: 500 as const,
    message: fallback,
    details: undefined,
  };
}

const workflowDto = (row: StockScanWorkflowRecord): ScanWorkflowDto => ({
  id: row.id,
  name: row.name,
  actions: row.actions,
  oncePerCode: row.oncePerCode,
  description: row.description,
  enabled: row.enabled,
  resourceId: row.resourceId,
  resourceIds: row.resourceIds.length ? row.resourceIds : [row.resourceId],
  targetSelectionMode: row.targetSelectionMode,
  allowVariantSelection: row.allowVariantSelection,
  codeTypes: row.codeTypes,
  publicTriggerEnabled: row.publicTriggerEnabled,
  publicTriggerId: row.publicTriggerId,
  publicTriggerCode: row.publicTriggerCode,
  quantityInputKey: row.quantityInputKey,
  revision: row.revision,
  extraction: row.extraction,
  identifierPropertyKey: row.identifierPropertyKey,
  identifierStorage: row.identifierStorage,
  extractedFields: row.extractedFields,
  operation: row.operation,
  createMissingUnit: row.createMissingUnit,
  unitStatus: row.unitStatus,
  fixedProperties: row.fixedProperties,
  inputFields: row.inputFields,
  triggerWebhook: row.triggerWebhook,
  webhookEventName: row.webhookEventName,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const unitDto = (row: StockUnitRecord) => ({
  id: row.id,
  resourceId: row.resourceId,
  code: row.code,
  status: row.status,
  location: row.location,
  metadata: row.metadata,
  customFields: row.customFields,
  acquiredAt: row.acquiredAt.toISOString(),
  lastMovedAt: row.lastMovedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const movementDto = (row: typeof stockMovements.$inferSelect) => ({
  id: row.id,
  resourceId: row.resourceId,
  unitId: row.unitId,
  delta: row.delta,
  balanceAfter: row.balanceAfter,
  type: row.type,
  reason: row.reason,
  note: row.note,
  location: row.location,
  occurredAt: row.occurredAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
});

const validatedUnitMetadata = (
  unit: Pick<StockUnitRecord, "id" | "metadata">,
): Record<string, unknown> => {
  const metadata: unknown = unit.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ScanWorkflowError(
      "The unit has invalid metadata and cannot be updated safely. Repair its metadata before running this scan.",
      409,
      { unitId: unit.id },
    );
  }
  return { ...(metadata as Record<string, unknown>) };
};

const jsonRecord = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const assertWorkflowConfiguration = (workflow: StockScanWorkflowRecord) => {
  const parsed = scanWorkflowCreateSchema.safeParse({
    actions: workflow.actions,
    oncePerCode: workflow.oncePerCode,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    resourceId: workflow.resourceId,
    resourceIds: workflow.resourceIds.length
      ? workflow.resourceIds
      : [workflow.resourceId],
    targetSelectionMode: workflow.targetSelectionMode,
    allowVariantSelection: workflow.allowVariantSelection,
    codeTypes: workflow.codeTypes,
    publicTriggerEnabled: workflow.publicTriggerEnabled,
    publicTriggerCode: workflow.publicTriggerCode,
    quantityInputKey: workflow.quantityInputKey,
    extraction: workflow.extraction,
    identifierPropertyKey: workflow.identifierPropertyKey,
    identifierStorage: workflow.identifierStorage,
    extractedFields: workflow.extractedFields,
    operation: workflow.operation,
    createMissingUnit: workflow.createMissingUnit,
    unitStatus: workflow.unitStatus,
    fixedProperties: workflow.fixedProperties,
    inputFields: workflow.inputFields,
    triggerWebhook: workflow.triggerWebhook,
    webhookEventName: workflow.webhookEventName,
  });
  if (!parsed.success) {
    throw new ScanWorkflowError(
      "The persisted workflow configuration is invalid and must be repaired.",
      409,
    );
  }
  return parsed.data;
};

const configuredWorkflowTargetIds = (
  workflow: Pick<StockScanWorkflowRecord, "resourceId" | "resourceIds">,
) => workflow.resourceIds.length ? workflow.resourceIds : [workflow.resourceId];

export type ScanWorkflowTargetOption = {
  id: string;
  name: string;
  quantity: number;
  trackingMode: "bulk" | "serialized";
  updatedAt: string;
};

export type ScanWorkflowTargetGroup = {
  resourceId: string;
  name: string;
  options: ScanWorkflowTargetOption[];
};

export async function getScanWorkflowTargetGroups(
  organizationId: string,
  workflow: Pick<
    StockScanWorkflowRecord,
    "resourceId" | "resourceIds" | "allowVariantSelection"
  >,
  executor: DatabaseExecutor = db,
): Promise<ScanWorkflowTargetGroup[]> {
  const targetIds = configuredWorkflowTargetIds(workflow);
  const baseRows = await executor
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
      trackingMode: stockSettings.trackingMode,
      updatedAt: resources.updatedAt,
    })
    .from(resources)
    .leftJoin(
      stockSettings,
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, resources.id),
      ),
    )
    .where(
      and(
        eq(resources.organizationId, organizationId),
        inArray(resources.id, targetIds),
      ),
    );
  const baseById = new Map(baseRows.map((row) => [row.id, row]));
  const variantsByPrimary = new Map<string, ScanWorkflowTargetOption[]>();

  if (workflow.allowVariantSelection) {
    const memberships = await executor
      .select({
        primaryResourceId: resourceRelations.targetResourceId,
        variantResourceId: resourceRelations.sourceResourceId,
      })
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, organizationId),
          eq(resourceRelations.relationTypeKey, "variant_of"),
          inArray(resourceRelations.targetResourceId, targetIds),
        ),
      );
    const variantIds = memberships.map((membership) => membership.variantResourceId);
    const variantRows = variantIds.length
      ? await executor
          .select({
            id: resources.id,
            name: resources.name,
            quantity: resources.quantity,
            trackingMode: stockSettings.trackingMode,
            updatedAt: resources.updatedAt,
          })
          .from(resources)
          .leftJoin(
            stockSettings,
            and(
              eq(stockSettings.organizationId, organizationId),
              eq(stockSettings.resourceId, resources.id),
            ),
          )
          .where(
            and(
              eq(resources.organizationId, organizationId),
              inArray(resources.id, variantIds),
            ),
          )
      : [];
    const variantById = new Map(variantRows.map((row) => [row.id, row]));
    for (const membership of memberships) {
      const variant = variantById.get(membership.variantResourceId);
      if (!variant) continue;
      const options = variantsByPrimary.get(membership.primaryResourceId) ?? [];
      options.push({
        ...variant,
        trackingMode: variant.trackingMode ?? "bulk",
        updatedAt: variant.updatedAt.toISOString(),
      });
      variantsByPrimary.set(membership.primaryResourceId, options);
    }
  }

  return targetIds.flatMap((resourceId) => {
    const base = baseById.get(resourceId);
    if (!base) return [];
    const variantOptions = variantsByPrimary.get(resourceId) ?? [];
    const options = variantOptions.length
      ? variantOptions.sort(
          (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
        )
      : [
          {
            ...base,
            trackingMode: base.trackingMode ?? "bulk",
            updatedAt: base.updatedAt.toISOString(),
          },
        ];
    return [{ resourceId, name: base.name, options }];
  });
}

export const selectWorkflowTargetIds = (
  workflow: Pick<StockScanWorkflowRecord, "targetSelectionMode">,
  groups: ScanWorkflowTargetGroup[],
  requestedResourceIds: string[] = [],
) => {
  const selected = requestedResourceIds.length
    ? requestedResourceIds
    : workflow.targetSelectionMode === "radio"
      ? groups.slice(0, 1).map((group) => group.options[0]?.id).filter(Boolean)
      : groups.map((group) => group.options[0]?.id).filter(Boolean);
  if (!selected.length || new Set(selected).size !== selected.length) {
    throw new ScanWorkflowError("Select at least one unique target inventory item.", 422);
  }
  const groupByOption = new Map(
    groups.flatMap((group) => group.options.map((option) => [option.id, group] as const)),
  );
  const selectedGroups = selected.map((resourceId) => groupByOption.get(resourceId));
  if (selectedGroups.some((group) => !group)) {
    throw new ScanWorkflowError("A selected target is not allowed by this action flow.", 422);
  }
  if (new Set(selectedGroups.map((group) => group!.resourceId)).size !== selected.length) {
    throw new ScanWorkflowError("Choose at most one variation of each target product.", 422);
  }
  if (workflow.targetSelectionMode === "radio" && selected.length !== 1) {
    throw new ScanWorkflowError("This action flow requires exactly one target.", 422);
  }
  if (
    workflow.targetSelectionMode === "all" &&
    (selected.length !== groups.length || selectedGroups.length !== groups.length)
  ) {
    throw new ScanWorkflowError("This action flow must run for every configured target.", 422);
  }
  return selected;
};

const workflowStoredUnitKeys = (input: ScanWorkflowCreateInput) => [
  ...(input.identifierStorage === "custom-field"
    ? [input.identifierPropertyKey]
    : []),
  ...input.extractedFields
    .filter((field) => field.storage === "custom-field")
    .map((field) => field.key),
  ...input.fixedProperties
    .filter((field) => field.storage === "custom-field")
    .map((field) => field.key),
  ...input.inputFields
    .filter((field) => field.storage === "custom-field")
    .map((field) => field.key),
];

const workflowUsesUnitStorage = (input: ScanWorkflowCreateInput) =>
  input.identifierStorage !== "execution" ||
  input.extractedFields.some((field) => field.storage !== "execution") ||
  input.fixedProperties.some((field) => field.storage !== "execution") ||
  input.inputFields.some((field) => field.storage !== "execution");

async function assertWorkflowStorageConfiguration(
  organizationId: string,
  input: ScanWorkflowCreateInput,
  resource: {
    trackingMode: "bulk" | "serialized" | null;
    type: string;
    categories: Array<string | { name: string }>;
  },
) {
  if (input.publicTriggerEnabled && input.publicTriggerCode) {
    try {
      extractScanIdentifier(input.publicTriggerCode, input.extraction);
    } catch (error) {
      throw new ScanWorkflowError(
        error instanceof Error
          ? `The public URL trigger code is invalid: ${error.message}`
          : "The public URL trigger code is invalid.",
        422,
      );
    }
  }
  if (input.actions.length) return;
  const producesUnit =
    input.operation.type === "unit" ||
    (input.operation.type === "assembly-build" &&
      resource.trackingMode === "serialized");
  if (!producesUnit && workflowUsesUnitStorage(input)) {
    throw new ScanWorkflowError(
      "This action does not create or update a serialized unit. Store scanned and entered values with the flow execution instead.",
      422,
    );
  }

  const customFieldKeys = workflowStoredUnitKeys(input);
  if (!customFieldKeys.length) return;
  const definitions = (
    await listCustomFieldDefinitions({
      organizationId,
      entityType: "stock_unit",
    })
  ).filter((definition) =>
    isCustomFieldDefinitionApplicable(definition, {
      type: resource.type,
      categories: resource.categories,
    }),
  );
  const configuredKeys = new Set(definitions.map((definition) => definition.key));
  const missingKeys = customFieldKeys.filter((key) => !configuredKeys.has(key));
  if (missingKeys.length) {
    throw new ScanWorkflowError(
      `Configure these stock-unit custom fields before saving the action flow: ${missingKeys.join(", ")}.`,
      422,
      { fields: missingKeys },
    );
  }
}

export async function listScanWorkflows(organizationId: string) {
  const rows = await db
    .select()
    .from(stockScanWorkflows)
    .where(eq(stockScanWorkflows.organizationId, organizationId))
    .orderBy(asc(stockScanWorkflows.name), asc(stockScanWorkflows.id));
  return rows.map(workflowDto);
}

export async function getScanWorkflow(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, id),
      ),
    )
    .limit(1);
  return row ? workflowDto(row) : null;
}

export async function createScanWorkflow(
  organizationId: string,
  input: ScanWorkflowCreateInput,
  actor: string,
) {
  const targetIds = input.resourceIds.length
    ? input.resourceIds
    : [input.resourceId];
  const targetResources = await db
    .select({
      id: resources.id,
      type: resources.type,
      categories: resources.categories,
      trackingMode: stockSettings.trackingMode,
    })
    .from(resources)
    .leftJoin(
      stockSettings,
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, resources.id),
      ),
    )
    .where(
      and(
        eq(resources.organizationId, organizationId),
        inArray(resources.id, targetIds),
      ),
    );
  if (targetResources.length !== targetIds.length) {
    throw new ScanWorkflowError("A selected inventory item does not exist.", 422);
  }
  for (const resource of targetResources) {
    if (!input.actions.length && input.operation.type === "unit" && resource.trackingMode !== "serialized") {
      throw new ScanWorkflowError(
        "Configure every selected inventory item for serialized stock tracking first.",
        409,
      );
    }
    if (
      !input.actions.length && input.operation.type === "stock-adjustment" &&
      resource.trackingMode === "serialized"
    ) {
      throw new ScanWorkflowError(
        "Quantity adjustments require bulk-tracked inventory items.",
        409,
      );
    }
    await assertWorkflowStorageConfiguration(organizationId, input, resource);
  }

  const [created] = await db
    .insert(stockScanWorkflows)
    .values({
      organizationId,
      ...input,
      resourceId: targetIds[0],
      resourceIds: targetIds,
      createdBy: actor,
      updatedBy: actor,
    })
    .returning();
  return workflowDto(created);
}

export async function updateScanWorkflow(
  organizationId: string,
  id: string,
  patch: ScanWorkflowPatchInput,
  actor: string,
) {
  const [current] = await db
    .select()
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, id),
      ),
    )
    .limit(1);
  if (!current) throw new ScanWorkflowError("Workflow not found.", 404);
  if (current.revision !== patch.revision) {
    throw new ScanWorkflowError(
      "The workflow was changed by another request. Reload it and try again.",
      409,
      { currentRevision: current.revision },
    );
  }

  const { revision, ...changes } = patch;
  const merged = scanWorkflowCreateSchema.safeParse({
    actions: current.actions,
    oncePerCode: current.oncePerCode,
    name: current.name,
    description: current.description,
    enabled: current.enabled,
    resourceId: current.resourceId,
    resourceIds: current.resourceIds.length
      ? current.resourceIds
      : [current.resourceId],
    targetSelectionMode: current.targetSelectionMode,
    allowVariantSelection: current.allowVariantSelection,
    codeTypes: current.codeTypes,
    publicTriggerEnabled: current.publicTriggerEnabled,
    publicTriggerCode: current.publicTriggerCode,
    quantityInputKey: current.quantityInputKey,
    extraction: current.extraction,
    identifierPropertyKey: current.identifierPropertyKey,
    identifierStorage: current.identifierStorage,
    extractedFields: current.extractedFields,
    operation: current.operation,
    createMissingUnit: current.createMissingUnit,
    unitStatus: current.unitStatus,
    fixedProperties: current.fixedProperties,
    inputFields: current.inputFields,
    triggerWebhook: current.triggerWebhook,
    webhookEventName: current.webhookEventName,
    ...changes,
  });
  if (!merged.success) {
    throw new ScanWorkflowError("The combined workflow configuration is invalid.", 422, {
      validation: merged.error.flatten(),
    });
  }

  {
    const targetIds = merged.data.resourceIds.length
      ? merged.data.resourceIds
      : [merged.data.resourceId];
    const targetResources = await db
      .select({
        id: resources.id,
        type: resources.type,
        categories: resources.categories,
        trackingMode: stockSettings.trackingMode,
      })
      .from(resources)
      .leftJoin(
        stockSettings,
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resources.id),
        ),
      )
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, targetIds),
        ),
      );
    if (targetResources.length !== targetIds.length) {
      throw new ScanWorkflowError(
        "A selected inventory item does not exist.",
        422,
      );
    }
    for (const resource of targetResources) {
      if (
        !merged.data.actions.length && merged.data.operation.type === "unit" &&
        resource.trackingMode !== "serialized"
      ) {
        throw new ScanWorkflowError(
          "Configure every selected inventory item for serialized stock tracking first.",
          409,
        );
      }
      if (
        !merged.data.actions.length && merged.data.operation.type === "stock-adjustment" &&
        resource.trackingMode === "serialized"
      ) {
        throw new ScanWorkflowError(
          "Quantity adjustments require bulk-tracked inventory items.",
          409,
        );
      }
      await assertWorkflowStorageConfiguration(
        organizationId,
        merged.data,
        resource,
      );
    }
    changes.resourceId = targetIds[0];
    changes.resourceIds = targetIds;
  }

  const now = new Date();
  const [saved] = await db
    .update(stockScanWorkflows)
    .set({
      ...changes,
      revision: sql`${stockScanWorkflows.revision} + 1`,
      updatedBy: actor,
      updatedAt: now,
    })
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, id),
        eq(stockScanWorkflows.revision, revision),
      ),
    )
    .returning();

  if (!saved) {
    const [latest] = await db
      .select({ revision: stockScanWorkflows.revision })
      .from(stockScanWorkflows)
      .where(
        and(
          eq(stockScanWorkflows.organizationId, organizationId),
          eq(stockScanWorkflows.id, id),
        ),
      )
      .limit(1);
    if (!latest) throw new ScanWorkflowError("Workflow not found.", 404);
    throw new ScanWorkflowError(
      "The workflow was changed by another request. Reload it and try again.",
      409,
      { currentRevision: latest.revision },
    );
  }
  return workflowDto(saved);
}

export async function deleteScanWorkflow(
  organizationId: string,
  id: string,
  revision: number,
) {
  const [deleted] = await db
    .delete(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, id),
        eq(stockScanWorkflows.revision, revision),
      ),
    )
    .returning({ id: stockScanWorkflows.id });
  if (deleted) return true;

  const [current] = await db
    .select({ revision: stockScanWorkflows.revision })
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, id),
      ),
    )
    .limit(1);
  if (!current) throw new ScanWorkflowError("Workflow not found.", 404);
  throw new ScanWorkflowError(
    "The workflow was changed by another request. Reload it and try again.",
    409,
    { currentRevision: current.revision },
  );
}

export async function rotateScanWorkflowPublicTrigger(
  organizationId: string,
  id: string,
  revision: number,
  actor: string,
) {
  const [saved] = await db
    .update(stockScanWorkflows)
    .set({
      publicTriggerId: randomUUID(),
      revision: sql`${stockScanWorkflows.revision} + 1`,
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, id),
        eq(stockScanWorkflows.revision, revision),
      ),
    )
    .returning();
  if (saved) return workflowDto(saved);
  const [current] = await db
    .select({ revision: stockScanWorkflows.revision })
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, id),
      ),
    )
    .limit(1);
  if (!current) throw new ScanWorkflowError("Workflow not found.", 404);
  throw new ScanWorkflowError(
    "The workflow was changed by another request. Reload it and try again.",
    409,
    { currentRevision: current.revision },
  );
}

export function extractScanIdentifier(
  scannedValue: string,
  extraction: ScanWorkflowExtraction,
) {
  let identifier: string;
  if (extraction.mode === "full") {
    identifier = scannedValue.trim();
  } else if (extraction.mode === "prefix") {
    if (!scannedValue.startsWith(extraction.prefix)) {
      throw new ScanWorkflowError(
        "The scanned value does not match the configured prefix.",
        422,
      );
    }
    identifier = scannedValue.slice(extraction.prefix.length).trim();
  } else if (extraction.mode === "regex") {
    const extracted = extractScanRegexValue(scannedValue, extraction);
    if (extracted.value === null) {
      throw new ScanWorkflowError(extracted.error, 422);
    }
    identifier = extracted.value;
  } else {
    let scannedUrl: URL;
    try {
      scannedUrl = new URL(scannedValue);
    } catch {
      throw new ScanWorkflowError(
        "The scanned value is not a valid absolute URL.",
        422,
      );
    }
    if (
      extraction.sourceOrigin !== undefined &&
      scannedUrl.origin !== extraction.sourceOrigin
    ) {
      throw new ScanWorkflowError(
        "The scanned URL does not match the configured source origin.",
        422,
      );
    }
    if (
      extraction.sourcePath !== undefined &&
      scannedUrl.pathname !== extraction.sourcePath
    ) {
      throw new ScanWorkflowError(
        "The scanned URL does not match the configured source path.",
        422,
      );
    }
    const values = scannedUrl.searchParams.getAll(extraction.parameter);
    if (values.length !== 1) {
      throw new ScanWorkflowError(
        `The scanned URL must contain exactly one ${extraction.parameter} query value.`,
        422,
      );
    }
    identifier = values[0].trim();
  }

  if (!identifier) {
    throw new ScanWorkflowError("The scan did not contain an identifier.", 422);
  }
  if (identifier.length > scanWorkflowLimits.identifier) {
    throw new ScanWorkflowError(
      `The extracted identifier must not exceed ${scanWorkflowLimits.identifier} characters.`,
      422,
    );
  }
  return identifier;
}

const assertScannedCodeType = (
  workflow: Pick<StockScanWorkflowRecord, "codeTypes">,
  codeType: ScanCodeType | null,
) => {
  // Manual entry and legacy clients do not know the scanner symbology. When a
  // scanner does report it, enforce the workflow allowlist server-side.
  if (codeType && !workflow.codeTypes.includes(codeType)) {
    throw new ScanWorkflowError(
      `This action flow does not accept ${codeType.replaceAll("_", " ")} codes.`,
      422,
      { codeType, allowedCodeTypes: workflow.codeTypes },
    );
  }
};

type WorkflowValues = {
  metadata: Record<string, unknown>;
  customFields: CustomFieldValues;
  execution: Record<string, unknown>;
};

const assignWorkflowValue = (
  values: WorkflowValues,
  storage: "custom-field" | "metadata" | "execution",
  key: string,
  value: unknown,
) => {
  if (storage === "custom-field") {
    values.customFields[key] = value as CustomFieldValue;
  } else {
    values[storage][key] = value;
  }
};

const isEmptyInput = (value: unknown) =>
  value === undefined || value === null || value === "" ||
  (Array.isArray(value) && value.length === 0);

export const normalizeInputValue = (
  field: StockScanWorkflowRecord["inputFields"][number],
  value: unknown,
) => {
  const type = field.type ?? "select";
  if (type === "select" || type === "radio") {
    if (
      typeof value !== "string" ||
      !field.options.some((option) => option.value === value)
    ) {
      throw new ScanWorkflowError(
        `Input ${field.label} must use one of its configured options.`,
        422,
      );
    }
    return value;
  }
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) {
      throw new ScanWorkflowError(`Input ${field.label} must be a number.`, 422);
    }
    return number;
  }
  if (type === "checkbox") {
    if (typeof value !== "boolean") {
      throw new ScanWorkflowError(`Input ${field.label} must be true or false.`, 422);
    }
    return value;
  }
  if (type === "media" || type === "file") {
    if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string")
    ) {
      throw new ScanWorkflowError(
        `Input ${field.label} must contain uploaded media identifiers.`,
        422,
      );
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new ScanWorkflowError(`Input ${field.label} must be text.`, 422);
  }
  return value;
};

export const resolveWorkflowValues = (
  workflow: StockScanWorkflowRecord,
  identifier: string,
  scannedValue: string,
  inputs: StockScanExecuteInput["inputs"] = {},
  options: { validateRequired?: boolean } = {},
) => {
  const values: WorkflowValues = { metadata: {}, customFields: {}, execution: {} };
  assignWorkflowValue(
    values,
    workflow.identifierStorage,
    workflow.identifierPropertyKey,
    identifier,
  );
  for (const field of workflow.extractedFields) {
    assignWorkflowValue(
      values,
      field.storage,
      field.key,
      extractScanIdentifier(scannedValue, field.extraction),
    );
  }
  for (const property of workflow.fixedProperties) {
    assignWorkflowValue(
      values,
      property.storage ?? "metadata",
      property.key,
      property.value,
    );
  }

  const fieldsByKey = new Map(
    workflow.inputFields.map((field) => [field.key, field]),
  );
  for (const key of Object.keys(inputs)) {
    if (!fieldsByKey.has(key)) {
      throw new ScanWorkflowError(`Input ${key} is not allowed by this workflow.`, 422);
    }
  }

  for (const field of workflow.inputFields) {
    const selected = inputs[field.key];
    if (isEmptyInput(selected)) {
      if (field.required && options.validateRequired !== false) {
        throw new ScanWorkflowError(`Input ${field.label} is required.`, 422);
      }
      continue;
    }
    assignWorkflowValue(
      values,
      field.storage ?? "metadata",
      field.key,
      normalizeInputValue(field, selected),
    );
  }
  return values;
};

const resolveWorkflowOperation = (
  configuration: ScanWorkflowCreateInput,
  inputs: StockScanExecuteInput["inputs"],
): ScanWorkflowCreateInput["operation"] => {
  const operation = configuration.operation;
  const quantityInputKey = configuration.quantityInputKey;
  if (!quantityInputKey || operation.type === "unit") return operation;
  const field = configuration.inputFields.find(
    (candidate) => candidate.key === quantityInputKey,
  );
  if (!field) {
    throw new ScanWorkflowError("The configured quantity input no longer exists.", 409);
  }
  const quantity = normalizeInputValue(field, inputs[quantityInputKey]);
  const maximum = operation.type === "assembly-build" ? 1_000 : 1_000_000;
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > maximum
  ) {
    throw new ScanWorkflowError(
      `Input ${field.label} must be a whole number between 1 and ${maximum}.`,
      422,
    );
  }
  return operation.type === "assembly-build"
    ? { type: "assembly-build", quantity }
    : {
        type: "stock-adjustment",
        delta: Math.sign(operation.delta) * quantity,
      };
};

const resourcePreview = (
  resource: { id: string; name: string; quantity: number },
  trackingMode: "bulk" | "serialized",
) => ({
  id: resource.id,
  name: resource.name,
  quantity: resource.quantity,
  trackingMode,
});

const calculateScanTransition = (
  quantityBefore: number,
  statusBefore: StockUnitRecord["status"] | null,
  configuredStatus: StockScanWorkflowRecord["unitStatus"],
) => {
  const statusAfter = configuredStatus ?? statusBefore ?? ("available" as const);
  const wasAvailable = statusBefore === "available";
  const isAvailable = statusAfter === "available";
  const delta =
    statusBefore === null
      ? isAvailable
        ? 1
        : 0
      : wasAvailable === isAvailable
        ? 0
        : isAvailable
          ? 1
          : -1;
  const quantityAfter = quantityBefore + delta;
  if (quantityAfter < 0) {
    throw new ScanWorkflowError(
      "This scan would make available stock negative.",
      409,
    );
  }
  if (quantityAfter > MAX_STOCK_QUANTITY) {
    throw new ScanWorkflowError(
      `This scan exceeds the maximum supported stock of ${MAX_STOCK_QUANTITY}.`,
      409,
    );
  }
  return {
    statusBefore,
    statusAfter,
    quantityBefore,
    quantityAfter,
    delta,
  };
};

const assertResolvedUnitGuard = (
  input: StockScanExecuteInput,
  unit: StockUnitRecord | undefined,
) => {
  const currentUpdatedAt = unit?.updatedAt.toISOString() ?? null;
  const guardMatches =
    input.expectedUnitId === null
      ? unit === undefined
      : unit !== undefined &&
        unit.id === input.expectedUnitId &&
        currentUpdatedAt === input.expectedUnitUpdatedAt;
  if (!guardMatches) {
    throw new ScanWorkflowError(
      "The unit changed after this scan was resolved. Resolve the scan again before executing it.",
      409,
      {
        expectedUnitId: input.expectedUnitId,
        currentUnitId: unit?.id ?? null,
        currentUnitUpdatedAt: currentUpdatedAt,
      },
    );
  }
};

export async function resolveStockScan(
  organizationId: string,
  workflowId: string,
  scannedValue: string,
  codeType: ScanCodeType | null = null,
  requestedResourceIds: string[] = [],
) {
  const [workflow] = await db
    .select()
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, workflowId),
      ),
    )
    .limit(1);
  if (!workflow) throw new ScanWorkflowError("Workflow not found.", 404);
  if (!workflow.enabled) {
    throw new ScanWorkflowError("This scan workflow is disabled.", 409);
  }
  const configuration = assertWorkflowConfiguration(workflow);
  assertScannedCodeType(workflow, codeType);

  if (configuration.actions.length) throw new ScanWorkflowError(
    "This flow uses an action chain. Load its runner configuration, then preview and confirm the complete chain.",
    422,
    { configurationUrl: `/api/v1/stock/scan-workflows/${workflow.id}/runner`, previewUrl: "/api/v1/stock/action-chains/preview", executeUrl: "/api/v1/stock/action-chains/execute" },
  );

  const identifier = extractScanIdentifier(scannedValue, workflow.extraction);
  const targetGroups = await getScanWorkflowTargetGroups(
    organizationId,
    workflow,
  );
  if (targetGroups.length !== configuredWorkflowTargetIds(workflow).length) {
    throw new ScanWorkflowError(
      "A configured workflow inventory item no longer exists.",
      409,
    );
  }
  const selectedResourceIds = selectWorkflowTargetIds(
    workflow,
    targetGroups,
    requestedResourceIds,
  );
  const configuredValues = resolveWorkflowValues(
    workflow,
    identifier,
    scannedValue,
    {},
    { validateRequired: false },
  );
  const optionsById = new Map(
    targetGroups.flatMap((group) =>
      group.options.map((option) => [option.id, option] as const),
    ),
  );
  const targets = await Promise.all(
    selectedResourceIds.map(async (resourceId) => {
      const resource = optionsById.get(resourceId);
      if (!resource) {
        throw new ScanWorkflowError(
          "A selected target is not available anymore.",
          409,
        );
      }
      if (
        configuration.operation.type === "unit" &&
        resource.trackingMode !== "serialized"
      ) {
        throw new ScanWorkflowError(
          "Every selected target must use serialized stock tracking.",
          409,
        );
      }
      if (
        configuration.operation.type === "stock-adjustment" &&
        resource.trackingMode === "serialized"
      ) {
        throw new ScanWorkflowError(
          "Every selected target must use bulk stock tracking.",
          409,
        );
      }
      const [unit] =
        configuration.operation.type === "unit"
          ? await db
              .select()
              .from(stockUnits)
              .where(
                and(
                  eq(stockUnits.organizationId, organizationId),
                  eq(stockUnits.resourceId, resource.id),
                  eq(stockUnits.code, identifier),
                ),
              )
              .limit(1)
          : [undefined];
      const existingMetadata = unit ? validatedUnitMetadata(unit) : null;
      const transition =
        configuration.operation.type === "unit"
          ? calculateScanTransition(
              resource.quantity,
              unit?.status ?? null,
              workflow.unitStatus,
            )
          : {
              statusBefore: null,
              statusAfter: null,
              quantityBefore: resource.quantity,
              quantityAfter:
                resource.quantity +
                (configuration.operation.type === "stock-adjustment"
                  ? configuration.operation.delta
                  : configuration.operation.quantity),
              delta:
                configuration.operation.type === "stock-adjustment"
                  ? configuration.operation.delta
                  : configuration.operation.quantity,
            };
      if (
        transition.quantityAfter > MAX_STOCK_QUANTITY ||
        transition.quantityAfter < -MAX_STOCK_QUANTITY
      ) {
        throw new ScanWorkflowError(
          `The action for ${resource.name} exceeds the supported stock quantity range.`,
          409,
        );
      }
      return {
        resource: resourcePreview(resource, resource.trackingMode),
        unit: unit ? unitDto(unit) : null,
        expectedResourceUpdatedAt: resource.updatedAt,
        expectedUnitId: unit?.id ?? null,
        expectedUnitUpdatedAt: unit?.updatedAt.toISOString() ?? null,
        ...transition,
        willCreate:
          configuration.operation.type === "unit"
            ? !unit && workflow.createMissingUnit
            : configuration.operation.type === "assembly-build",
        metadataPreview: {
          ...(existingMetadata ?? {}),
          ...configuredValues.metadata,
        },
        customFieldsPreview: {
          ...(unit?.customFields ?? {}),
          ...configuredValues.customFields,
        },
        executionPreview: configuredValues.execution,
      };
    }),
  );
  const first = targets[0];
  if (!first) {
    throw new ScanWorkflowError("Select at least one target inventory item.", 422);
  }

  return {
    workflow: workflowDto(workflow),
    targetGroups,
    selectedResourceIds,
    targets,
    resources: targets.map((target) => target.resource),
    resource: first.resource,
    identifier,
    operation: configuration.operation,
    unit: first.unit,
    expectedResourceUpdatedAt: first.expectedResourceUpdatedAt,
    expectedUnitId: first.expectedUnitId,
    expectedUnitUpdatedAt: first.expectedUnitUpdatedAt,
    expectedTargets: targets.map((target) => ({
      resourceId: target.resource.id,
      resourceUpdatedAt: target.expectedResourceUpdatedAt,
      unitId: target.expectedUnitId,
      unitUpdatedAt: target.expectedUnitUpdatedAt,
    })),
    statusBefore: targets.length === 1 ? first.statusBefore : null,
    statusAfter: targets.length === 1 ? first.statusAfter : null,
    quantityBefore: targets.reduce((total, target) => total + target.quantityBefore, 0),
    quantityAfter: targets.reduce((total, target) => total + target.quantityAfter, 0),
    delta: targets.reduce((total, target) => total + target.delta, 0),
    willCreate: targets.some((target) => target.willCreate),
    fields: workflow.inputFields,
    fixedProperties: workflow.fixedProperties,
    metadataPreview: first.metadataPreview,
    customFieldsPreview: first.customFieldsPreview,
    executionPreview: first.executionPreview,
  };
}

const hashCode = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type ExecutionIdempotency = {
  key: string;
  requestHash: string;
  publicTriggerId?: string;
};

export const assertPublicExecutionAccess = (
  workflow: StockScanWorkflowRecord,
  idempotency: ExecutionIdempotency,
) => {
  if (
    idempotency.publicTriggerId &&
    (!workflow.publicTriggerEnabled ||
      workflow.publicTriggerId !== idempotency.publicTriggerId)
  ) {
    throw new ScanWorkflowError("This public action URL is not available.", 404);
  }
};

async function executeNonUnitScan(
  organizationId: string,
  input: StockScanExecuteInput,
  actor: string,
  idempotency: ExecutionIdempotency,
  targetResourceId: string,
) {
  const [existing] = await db
    .select({
      requestHash: stockScanExecutions.requestHash,
      response: stockScanExecutions.response,
    })
    .from(stockScanExecutions)
    .where(
      and(
        eq(stockScanExecutions.organizationId, organizationId),
        eq(stockScanExecutions.idempotencyKey, idempotency.key),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.requestHash !== idempotency.requestHash) {
      throw new ScanWorkflowError(
        "That Idempotency-Key was already used for a different payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  }

  const [workflow] = await db
    .select()
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, input.workflowId),
      ),
    )
    .limit(1);
  if (!workflow) throw new ScanWorkflowError("Workflow not found.", 404);
  assertPublicExecutionAccess(workflow, idempotency);
  const configuration = assertWorkflowConfiguration(workflow);
  if (configuration.operation.type === "unit") {
    throw new ScanWorkflowError("This flow requires a serialized unit action.", 409);
  }
  if (!workflow.enabled) {
    throw new ScanWorkflowError("This scan workflow is disabled.", 409);
  }
  assertScannedCodeType(workflow, input.codeType);
  if (workflow.revision !== input.revision) {
    throw new ScanWorkflowError(
      "The workflow has changed. Resolve the scan again before executing it.",
      409,
      { currentRevision: workflow.revision },
    );
  }
  const [resource] = await db
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
      updatedAt: resources.updatedAt,
      trackingMode: stockSettings.trackingMode,
    })
    .from(resources)
    .leftJoin(
      stockSettings,
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, resources.id),
      ),
    )
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, targetResourceId),
      ),
    )
    .limit(1);
  if (!resource) {
    throw new ScanWorkflowError("The workflow inventory item no longer exists.", 409);
  }
  if (resource.updatedAt.toISOString() !== input.expectedResourceUpdatedAt) {
    throw new ScanWorkflowError(
      "The inventory quantity changed after this action was reviewed. Scan the code again.",
      409,
    );
  }

  const identifier = extractScanIdentifier(input.code, workflow.extraction);
  const values = resolveWorkflowValues(
    workflow,
    identifier,
    input.code,
    input.inputs,
    { validateRequired: true },
  );
  const operation = resolveWorkflowOperation(configuration, input.inputs);

  let operationResult: Record<string, unknown>;
  let unitId: string | null = null;
  let movement: Record<string, unknown> | null = null;
  let resourceResult: Record<string, unknown>;
  if (operation.type === "stock-adjustment") {
    if (resource.trackingMode === "serialized") {
      throw new ScanWorkflowError(
        "Quantity adjustments require a bulk-tracked inventory item.",
        409,
      );
    }
    const result = await bookStockMovement(
      organizationId,
      resource.id,
      {
        delta: operation.delta,
        quantity: Math.abs(operation.delta),
        type: "scan-adjustment",
        reason: `Action flow: ${workflow.name}`,
        note: `Scanned identifier: ${identifier}`,
      },
      actor,
      {
        ...idempotency,
        expectedResourceUpdatedAt: input.expectedResourceUpdatedAt,
      },
    );
    operationResult = jsonRecord(result.response);
    resourceResult = jsonRecord(result.response.resource);
    movement = jsonRecord(result.response.movement);
  } else if (operation.type === "assembly-build") {
    const outputCodes =
      resource.trackingMode === "serialized"
        ? operation.quantity === 1
          ? [identifier]
          : Array.from(
              { length: operation.quantity },
              (_, index) => `${identifier}-${index + 1}`,
            )
        : undefined;
    const result = await buildAssembly(
      organizationId,
      resource.id,
      {
        quantity: operation.quantity,
        outputUnitCodes: outputCodes,
        outputUnitMetadata: values.metadata,
        outputUnitCustomFields: values.customFields,
        note: `Action flow: ${workflow.name}`,
      },
      actor,
      {
        ...idempotency,
        expectedResourceUpdatedAt: input.expectedResourceUpdatedAt,
      },
      () => true,
    );
    operationResult = jsonRecord(result.response);
    resourceResult = jsonRecord(result.response.resource);
    const outputUnits = Array.isArray(result.response.outputUnits)
      ? result.response.outputUnits
      : [];
    const firstUnit = outputUnits[0];
    unitId =
      firstUnit && typeof firstUnit === "object" && "id" in firstUnit
        ? String(firstUnit.id)
        : null;
    const movements = Array.isArray(result.response.movements)
      ? result.response.movements
      : [];
    movement = movements.length
      ? jsonRecord(movements[movements.length - 1])
      : null;
  } else {
    throw new ScanWorkflowError(
      "This flow requires a serialized unit action.",
      409,
    );
  }

  const recordedValues = {
    ...values.metadata,
    ...values.customFields,
    ...values.execution,
  };
  const response = jsonRecord({
    workflowId: workflow.id,
    revision: workflow.revision,
    operation,
    resource: resourceResult,
    unit:
      operation.type === "assembly-build" &&
      Array.isArray(operationResult.outputUnits)
        ? operationResult.outputUnits[0] ?? null
        : null,
    movement,
    created: operation.type === "assembly-build",
    metadataBefore: null,
    metadataAfter: recordedValues,
    actionResult: operationResult,
  });

  try {
    await db.transaction(async (transaction) => {
      await transaction.insert(stockScanExecutions).values({
        organizationId,
        idempotencyKey: idempotency.key,
        workflowId: workflow.id,
        workflowRevision: workflow.revision,
        resourceId: resource.id,
        unitId,
        requestHash: idempotency.requestHash,
        codeHash: hashCode(input.code),
        codeType: input.codeType,
        actor,
        createdUnit: operation.type === "assembly-build" && Boolean(unitId),
        beforeMetadata: null,
        afterMetadata: recordedValues,
        response,
      });
      if (workflow.triggerWebhook) {
        await enqueueWebhookEvent(transaction, {
          organizationId,
          type: "inventory.action.executed",
          aggregateType: "action_flow",
          aggregateId: workflow.id,
          actor,
          data: {
            eventName: workflow.webhookEventName,
            workflow: { id: workflow.id, name: workflow.name, revision: workflow.revision },
            identifier,
            codeType: input.codeType,
            values: recordedValues,
            result: response,
          },
        });
      }
    });
    return { response, replayed: false } as const;
  } catch (error) {
    const [winner] = await db
      .select({
        requestHash: stockScanExecutions.requestHash,
        response: stockScanExecutions.response,
      })
      .from(stockScanExecutions)
      .where(
        and(
          eq(stockScanExecutions.organizationId, organizationId),
          eq(stockScanExecutions.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (winner?.requestHash === idempotency.requestHash) {
      return { response: winner.response, replayed: true } as const;
    }
    throw error;
  }
}

async function executeStockScanForTarget(
  organizationId: string,
  input: StockScanExecuteInput,
  actor: string,
  idempotency: ExecutionIdempotency,
  targetResourceId: string,
) {
  const [operationWorkflow] = await db
    .select({ operation: stockScanWorkflows.operation })
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, input.workflowId),
      ),
    )
    .limit(1);
  if (operationWorkflow?.operation.type !== "unit") {
    return executeNonUnitScan(
      organizationId,
      input,
      actor,
      idempotency,
      targetResourceId,
    );
  }

  const validateReplay = (existing: {
    requestHash: string;
    response: Record<string, unknown>;
  }) => {
    if (existing.requestHash !== idempotency.requestHash) {
      throw new ScanWorkflowError(
        "That Idempotency-Key was already used for a different payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  };

  try {
    return await db.transaction(async (transaction) => {
      const [existingExecution] = await transaction
        .select({
          requestHash: stockScanExecutions.requestHash,
          response: stockScanExecutions.response,
        })
        .from(stockScanExecutions)
        .where(
          and(
            eq(stockScanExecutions.organizationId, organizationId),
            eq(stockScanExecutions.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (existingExecution) return validateReplay(existingExecution);

      const [initialWorkflow] = await transaction
        .select()
        .from(stockScanWorkflows)
        .where(
          and(
            eq(stockScanWorkflows.organizationId, organizationId),
            eq(stockScanWorkflows.id, input.workflowId),
          ),
        )
        .limit(1);
      if (!initialWorkflow) throw new ScanWorkflowError("Workflow not found.", 404);

      // Resource is always the first mutable stock row locked. This serializes
      // quantity changes and unit creation for the configured item.
      const [resource] = await transaction
        .select({
          id: resources.id,
          name: resources.name,
          quantity: resources.quantity,
          location: resources.location,
          type: resources.type,
          categories: resources.categories,
          updatedAt: resources.updatedAt,
        })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, targetResourceId),
          ),
        )
        .limit(1)
        .for("update");
      if (!resource) {
        throw new ScanWorkflowError(
          "The workflow inventory item no longer exists.",
          409,
        );
      }

      // A same-resource request may have waited for the resource lock.
      const [executionAfterLock] = await transaction
        .select({
          requestHash: stockScanExecutions.requestHash,
          response: stockScanExecutions.response,
        })
        .from(stockScanExecutions)
        .where(
          and(
            eq(stockScanExecutions.organizationId, organizationId),
            eq(stockScanExecutions.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (executionAfterLock) return validateReplay(executionAfterLock);

      // Lock and reread the workflow after the resource. A concurrent edit
      // cannot alter extraction or move the workflow to another resource while
      // this execution is being committed.
      const [workflow] = await transaction
        .select()
        .from(stockScanWorkflows)
        .where(
          and(
            eq(stockScanWorkflows.organizationId, organizationId),
            eq(stockScanWorkflows.id, input.workflowId),
          ),
        )
        .limit(1)
        .for("update");
      if (!workflow) throw new ScanWorkflowError("Workflow not found.", 404);
      assertPublicExecutionAccess(workflow, idempotency);
      if (!workflow.enabled) {
        throw new ScanWorkflowError("This scan workflow is disabled.", 409);
      }
      if (workflow.revision !== input.revision) {
        throw new ScanWorkflowError(
          "The workflow has changed. Resolve the scan again before executing it.",
          409,
          { currentRevision: workflow.revision },
        );
      }
      const configuration = assertWorkflowConfiguration(workflow);
      assertScannedCodeType(workflow, input.codeType);
      if (resource.updatedAt.toISOString() !== input.expectedResourceUpdatedAt) {
        throw new ScanWorkflowError(
          "The inventory quantity changed after this scan was resolved. Resolve the scan again before executing it.",
          409,
          { currentResourceUpdatedAt: resource.updatedAt.toISOString() },
        );
      }

      const [settings] = await transaction
        .select({ trackingMode: stockSettings.trackingMode })
        .from(stockSettings)
        .where(
          and(
            eq(stockSettings.organizationId, organizationId),
            eq(stockSettings.resourceId, resource.id),
          ),
        )
        .limit(1);
      if (settings?.trackingMode !== "serialized") {
        throw new ScanWorkflowError(
          "The workflow inventory item must use serialized stock tracking.",
          409,
        );
      }

      const identifier = extractScanIdentifier(input.code, workflow.extraction);
      const workflowValues = resolveWorkflowValues(
        workflow,
        identifier,
        input.code,
        input.inputs,
        { validateRequired: true },
      );

      // Unit is locked only after its resource lock has been acquired.
      const [existingUnit] = await transaction
        .select()
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.resourceId, resource.id),
            eq(stockUnits.code, identifier),
          ),
        )
        .limit(1)
        .for("update");
      if (existingUnit) {
        const [activeAssignment] = await transaction
          .select({ id: inventoryAssignments.id })
          .from(inventoryAssignments)
          .where(
            and(
              eq(inventoryAssignments.organizationId, organizationId),
              eq(inventoryAssignments.stockUnitId, existingUnit.id),
              eq(inventoryAssignments.status, "active"),
            ),
          )
          .limit(1);
        if (activeAssignment) {
          throw new ScanWorkflowError(
            "This unit has an active assignment or reservation. Return or cancel it before running a scan workflow.",
            409,
          );
        }
      }
      assertResolvedUnitGuard(input, existingUnit);
      if (!existingUnit && !workflow.createMissingUnit) {
        throw new ScanWorkflowError(
          "No unit with that identifier exists and this workflow may not create one.",
          404,
        );
      }

      const now = new Date();
      const beforeMetadata = existingUnit
        ? validatedUnitMetadata(existingUnit)
        : null;
      const afterMetadata = {
        ...(beforeMetadata ?? {}),
        ...workflowValues.metadata,
      };
      const beforeCustomFields = existingUnit?.customFields ?? null;
      const afterCustomFields = await validateCustomFieldValues({
        organizationId,
        entityType: "stock_unit",
        target: { type: resource.type, categories: resource.categories },
        values: {
          ...(beforeCustomFields ?? {}),
          ...workflowValues.customFields,
        },
        currentValues: beforeCustomFields ?? undefined,
        enforceRequired: true,
        executor: transaction,
      });
      const transition = calculateScanTransition(
        resource.quantity,
        existingUnit?.status ?? null,
        workflow.unitStatus,
      );
      const nextStatus = transition.statusAfter;
      const delta = transition.delta;
      const balanceAfter = transition.quantityAfter;

      let savedUnit: StockUnitRecord;
      if (existingUnit) {
        [savedUnit] = await transaction
          .update(stockUnits)
          .set({
            status: nextStatus,
            metadata: afterMetadata,
            customFields: afterCustomFields,
            lastMovedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              eq(stockUnits.id, existingUnit.id),
            ),
          )
          .returning();
      } else {
        [savedUnit] = await transaction
          .insert(stockUnits)
          .values({
            organizationId,
            resourceId: resource.id,
            code: identifier,
            status: nextStatus,
            location: resource.location,
            metadata: afterMetadata,
            customFields: afterCustomFields,
            acquiredAt: now,
            lastMovedAt: now,
          })
          .returning();
      }

      await transaction
        .update(resources)
        .set({ quantity: balanceAfter, updatedAt: now })
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, resource.id),
          ),
        );
      const statusChanged =
        existingUnit !== undefined && existingUnit.status !== nextStatus;
      const [movement] = await transaction
        .insert(stockMovements)
        .values({
          organizationId,
          resourceId: resource.id,
          unitId: savedUnit.id,
          delta,
          quantity: Math.abs(delta),
          balanceAfter,
          type: existingUnit
            ? statusChanged
              ? "scan-unit-status"
              : "scan-unit-update"
            : "scan-unit-created",
          reason: existingUnit
            ? statusChanged
              ? `Scan workflow changed unit status from ${existingUnit.status} to ${nextStatus}`
              : "Scan workflow updated unit properties"
            : "Scan workflow created serialized unit",
          note: `Workflow: ${workflow.name}`,
          location: savedUnit.location,
          occurredAt: now,
          createdBy: actor,
        })
        .returning();
      await enqueueStockMovementWebhookEvents(transaction, [movement]);

      const response = {
        workflowId: workflow.id,
        revision: workflow.revision,
        resource: {
          id: resource.id,
          name: resource.name,
          quantity: balanceAfter,
        },
        unit: unitDto(savedUnit),
        movement: movementDto(movement),
        created: !existingUnit,
        operation: configuration.operation,
        metadataBefore: beforeMetadata,
        metadataAfter: {
          ...afterMetadata,
          ...afterCustomFields,
          ...workflowValues.execution,
        },
        customFieldsBefore: beforeCustomFields,
        customFieldsAfter: afterCustomFields,
      };
      const storedResponse = jsonRecord(response);
      await transaction.insert(stockScanExecutions).values({
        organizationId,
        idempotencyKey: idempotency.key,
        workflowId: workflow.id,
        workflowRevision: workflow.revision,
        resourceId: resource.id,
        unitId: savedUnit.id,
        requestHash: idempotency.requestHash,
        codeHash: hashCode(input.code),
        codeType: input.codeType,
        actor,
        createdUnit: !existingUnit,
        beforeMetadata,
        afterMetadata: {
          ...afterMetadata,
          ...afterCustomFields,
          ...workflowValues.execution,
        },
        response: storedResponse,
      });
      if (workflow.triggerWebhook) {
        await enqueueWebhookEvent(transaction, {
          organizationId,
          type: "inventory.action.executed",
          aggregateType: "action_flow",
          aggregateId: workflow.id,
          actor,
          data: {
            eventName: workflow.webhookEventName,
            workflow: { id: workflow.id, name: workflow.name, revision: workflow.revision },
            identifier,
            codeType: input.codeType,
            values: storedResponse.metadataAfter as Record<string, unknown>,
            result: storedResponse,
          },
        });
      }
      return { response: storedResponse, replayed: false } as const;
    });
  } catch (error) {
    // Different resources do not share a row lock. If they race on one global
    // key, the losing transaction rolls back and safely replays the winner.
    const [winner] = await db
      .select({
        requestHash: stockScanExecutions.requestHash,
        response: stockScanExecutions.response,
      })
      .from(stockScanExecutions)
      .where(
        and(
          eq(stockScanExecutions.organizationId, organizationId),
          eq(stockScanExecutions.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (winner) return validateReplay(winner);
    throw error;
  }
}

const derivedExecutionUuid = (key: string, resourceId: string) => {
  const hex = createHash("sha256").update(`${key}:${resourceId}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

export async function executeStockScan(
  organizationId: string,
  input: StockScanExecuteInput,
  actor: string,
  idempotency: ExecutionIdempotency,
) {
  const [workflow] = await db
    .select()
    .from(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.organizationId, organizationId),
        eq(stockScanWorkflows.id, input.workflowId),
      ),
    )
    .limit(1);
  if (!workflow) throw new ScanWorkflowError("Workflow not found.", 404);
  if (workflow.actions.length) {
    const { runActionChain } = await import("@/lib/action-chain-engine");
    const report = await runActionChain({ workflowId: input.workflowId, code: input.code, codeType: input.codeType, inputs: input.inputs, selectedResourceIds: input.selectedResourceIds, expectedPlanHash: input.expectedPlanHash }, organizationId, { actor, ...idempotency }, false);
    return { response: jsonRecord(report), replayed: report.replayed ?? false };
  }
  assertPublicExecutionAccess(workflow, idempotency);
  if (workflow.revision !== input.revision) {
    throw new ScanWorkflowError(
      "The workflow has changed. Resolve the scan again before executing it.",
      409,
      { currentRevision: workflow.revision },
    );
  }
  const groups = await getScanWorkflowTargetGroups(organizationId, workflow);
  const selectedResourceIds = selectWorkflowTargetIds(
    workflow,
    groups,
    input.selectedResourceIds,
  );
  const expectedByResource = new Map(
    input.expectedTargets.map((target) => [target.resourceId, target]),
  );
  if (
    (selectedResourceIds.length > 1 || input.selectedResourceIds.length > 0) &&
    selectedResourceIds.some((resourceId) => !expectedByResource.has(resourceId))
  ) {
    throw new ScanWorkflowError(
      "The target review is incomplete. Resolve the action flow again.",
      409,
    );
  }
  if (
    workflow.operation.type === "unit" &&
    !workflow.createMissingUnit &&
    selectedResourceIds.some(
      (resourceId) => expectedByResource.get(resourceId)?.unitId === null,
    )
  ) {
    throw new ScanWorkflowError(
      "At least one selected target has no matching unit and this flow may not create it.",
      404,
    );
  }

  const results = [];
  for (const resourceId of selectedResourceIds) {
    const expected = expectedByResource.get(resourceId);
    const childInput: StockScanExecuteInput = {
      ...input,
      selectedResourceIds: [resourceId],
      expectedTargets: expected ? [expected] : [],
      expectedResourceUpdatedAt:
        expected?.resourceUpdatedAt ?? input.expectedResourceUpdatedAt,
      expectedUnitId: expected?.unitId ?? input.expectedUnitId,
      expectedUnitUpdatedAt:
        expected?.unitUpdatedAt ?? input.expectedUnitUpdatedAt,
    };
    const childKey =
      selectedResourceIds.length === 1
        ? idempotency.key
        : derivedExecutionUuid(idempotency.key, resourceId);
    results.push(
      await executeStockScanForTarget(
        organizationId,
        childInput,
        actor,
        {
          ...idempotency,
          key: childKey,
          requestHash: hashCode(`${idempotency.requestHash}:${resourceId}`),
        },
        resourceId,
      ),
    );
  }

  if (results.length === 1) return results[0];
  const responses = results.map((result) => result.response);
  const first = responses[0] ?? {};
  return {
    response: jsonRecord({
      ...first,
      resources: responses.map((response) => response.resource),
      units: responses.map((response) => response.unit).filter(Boolean),
      results: responses,
      created: responses.some((response) => response.created === true),
    }),
    replayed: results.every((result) => result.replayed),
  } as const;
}
