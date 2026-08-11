import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import {
  inventoryAssignments,
  resources,
  stockMovements,
  stockScanExecutions,
  stockScanWorkflows,
  stockSettings,
  stockUnits,
  type StockScanWorkflowRecord,
  type StockUnitRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  scanWorkflowCreateSchema,
  scanWorkflowLimits,
  type ScanWorkflowCreateInput,
  type ScanWorkflowDto,
  type ScanWorkflowExtraction,
  type ScanWorkflowPatchInput,
  type StockScanExecuteInput,
} from "@/lib/scan-workflow-contract";

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
  description: row.description,
  enabled: row.enabled,
  resourceId: row.resourceId,
  revision: row.revision,
  extraction: row.extraction,
  identifierPropertyKey: row.identifierPropertyKey,
  createMissingUnit: row.createMissingUnit,
  unitStatus: row.unitStatus,
  fixedProperties: row.fixedProperties,
  inputFields: row.inputFields,
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
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    resourceId: workflow.resourceId,
    extraction: workflow.extraction,
    identifierPropertyKey: workflow.identifierPropertyKey,
    createMissingUnit: workflow.createMissingUnit,
    unitStatus: workflow.unitStatus,
    fixedProperties: workflow.fixedProperties,
    inputFields: workflow.inputFields,
  });
  if (!parsed.success) {
    throw new ScanWorkflowError(
      "The persisted workflow configuration is invalid and must be repaired.",
      409,
    );
  }
};

export async function listScanWorkflows() {
  const rows = await db
    .select()
    .from(stockScanWorkflows)
    .orderBy(asc(stockScanWorkflows.name), asc(stockScanWorkflows.id));
  return rows.map(workflowDto);
}

export async function getScanWorkflow(id: string) {
  const [row] = await db
    .select()
    .from(stockScanWorkflows)
    .where(eq(stockScanWorkflows.id, id))
    .limit(1);
  return row ? workflowDto(row) : null;
}

export async function createScanWorkflow(
  input: ScanWorkflowCreateInput,
  actor: string,
) {
  const [resource] = await db
    .select({ id: resources.id, trackingMode: stockSettings.trackingMode })
    .from(resources)
    .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
    .where(eq(resources.id, input.resourceId))
    .limit(1);
  if (!resource) {
    throw new ScanWorkflowError("The selected inventory item does not exist.", 422);
  }
  if (resource.trackingMode !== "serialized") {
    throw new ScanWorkflowError(
      "Configure the selected inventory item for serialized stock tracking first.",
      409,
    );
  }

  const [created] = await db
    .insert(stockScanWorkflows)
    .values({ ...input, createdBy: actor, updatedBy: actor })
    .returning();
  return workflowDto(created);
}

export async function updateScanWorkflow(
  id: string,
  patch: ScanWorkflowPatchInput,
  actor: string,
) {
  const [current] = await db
    .select()
    .from(stockScanWorkflows)
    .where(eq(stockScanWorkflows.id, id))
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
    name: current.name,
    description: current.description,
    enabled: current.enabled,
    resourceId: current.resourceId,
    extraction: current.extraction,
    identifierPropertyKey: current.identifierPropertyKey,
    createMissingUnit: current.createMissingUnit,
    unitStatus: current.unitStatus,
    fixedProperties: current.fixedProperties,
    inputFields: current.inputFields,
    ...changes,
  });
  if (!merged.success) {
    throw new ScanWorkflowError("The combined workflow configuration is invalid.", 422, {
      validation: merged.error.flatten(),
    });
  }

  if (changes.resourceId || changes.enabled === true) {
    const [resource] = await db
      .select({ id: resources.id, trackingMode: stockSettings.trackingMode })
      .from(resources)
      .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
      .where(eq(resources.id, merged.data.resourceId))
      .limit(1);
    if (!resource) {
      throw new ScanWorkflowError(
        "The selected inventory item does not exist.",
        422,
      );
    }
    if (resource.trackingMode !== "serialized") {
      throw new ScanWorkflowError(
        "Configure the selected inventory item for serialized stock tracking first.",
        409,
      );
    }
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
        eq(stockScanWorkflows.id, id),
        eq(stockScanWorkflows.revision, revision),
      ),
    )
    .returning();

  if (!saved) {
    const [latest] = await db
      .select({ revision: stockScanWorkflows.revision })
      .from(stockScanWorkflows)
      .where(eq(stockScanWorkflows.id, id))
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

export async function deleteScanWorkflow(id: string, revision: number) {
  const [deleted] = await db
    .delete(stockScanWorkflows)
    .where(
      and(
        eq(stockScanWorkflows.id, id),
        eq(stockScanWorkflows.revision, revision),
      ),
    )
    .returning({ id: stockScanWorkflows.id });
  if (deleted) return true;

  const [current] = await db
    .select({ revision: stockScanWorkflows.revision })
    .from(stockScanWorkflows)
    .where(eq(stockScanWorkflows.id, id))
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

const configuredMetadataChanges = (
  workflow: StockScanWorkflowRecord,
  identifier: string,
) => ({
  [workflow.identifierPropertyKey]: identifier,
  ...Object.fromEntries(
    workflow.fixedProperties.map((property) => [property.key, property.value]),
  ),
});

const resolveMetadataChanges = (
  workflow: StockScanWorkflowRecord,
  identifier: string,
  inputs: Record<string, string>,
) => {
  const fieldsByKey = new Map(
    workflow.inputFields.map((field) => [field.key, field]),
  );
  for (const key of Object.keys(inputs)) {
    if (!fieldsByKey.has(key)) {
      throw new ScanWorkflowError(`Input ${key} is not allowed by this workflow.`, 422);
    }
  }

  const selectedInputs: Record<string, string> = {};
  for (const field of workflow.inputFields) {
    const selected = inputs[field.key];
    if (selected === undefined || selected === "") {
      if (field.required) {
        throw new ScanWorkflowError(`Input ${field.label} is required.`, 422);
      }
      continue;
    }
    if (!field.options.some((option) => option.value === selected)) {
      throw new ScanWorkflowError(
        `Input ${field.label} must use one of its configured options.`,
        422,
      );
    }
    selectedInputs[field.key] = selected;
  }

  return { ...configuredMetadataChanges(workflow, identifier), ...selectedInputs };
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

export async function resolveStockScan(workflowId: string, scannedValue: string) {
  const [workflow] = await db
    .select()
    .from(stockScanWorkflows)
    .where(eq(stockScanWorkflows.id, workflowId))
    .limit(1);
  if (!workflow) throw new ScanWorkflowError("Workflow not found.", 404);
  if (!workflow.enabled) {
    throw new ScanWorkflowError("This scan workflow is disabled.", 409);
  }
  assertWorkflowConfiguration(workflow);

  const identifier = extractScanIdentifier(scannedValue, workflow.extraction);
  const [resource] = await db
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
      updatedAt: resources.updatedAt,
      trackingMode: stockSettings.trackingMode,
    })
    .from(resources)
    .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
    .where(eq(resources.id, workflow.resourceId))
    .limit(1);
  if (!resource) {
    throw new ScanWorkflowError("The workflow inventory item no longer exists.", 409);
  }
  if (resource.trackingMode !== "serialized") {
    throw new ScanWorkflowError(
      "The workflow inventory item must use serialized stock tracking.",
      409,
    );
  }

  const [unit] = await db
    .select()
    .from(stockUnits)
    .where(
      and(
        eq(stockUnits.resourceId, workflow.resourceId),
        eq(stockUnits.code, identifier),
      ),
    )
    .limit(1);
  const existingMetadata = unit ? validatedUnitMetadata(unit) : null;
  const metadataChanges = configuredMetadataChanges(workflow, identifier);
  const transition = calculateScanTransition(
    resource.quantity,
    unit?.status ?? null,
    workflow.unitStatus,
  );

  return {
    workflow: workflowDto(workflow),
    resource: resourcePreview(
      resource,
      resource.trackingMode,
    ),
    identifier,
    unit: unit ? unitDto(unit) : null,
    expectedResourceUpdatedAt: resource.updatedAt.toISOString(),
    expectedUnitId: unit?.id ?? null,
    expectedUnitUpdatedAt: unit?.updatedAt.toISOString() ?? null,
    ...transition,
    willCreate: !unit && workflow.createMissingUnit,
    fields: workflow.inputFields,
    fixedProperties: workflow.fixedProperties,
    metadataPreview: {
      ...(existingMetadata ?? {}),
      ...metadataChanges,
    },
  };
}

const hashCode = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type ExecutionIdempotency = {
  key: string;
  requestHash: string;
};

export async function executeStockScan(
  input: StockScanExecuteInput,
  actor: string,
  idempotency: ExecutionIdempotency,
) {
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
        .where(eq(stockScanExecutions.idempotencyKey, idempotency.key))
        .limit(1);
      if (existingExecution) return validateReplay(existingExecution);

      const [initialWorkflow] = await transaction
        .select()
        .from(stockScanWorkflows)
        .where(eq(stockScanWorkflows.id, input.workflowId))
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
          updatedAt: resources.updatedAt,
        })
        .from(resources)
        .where(eq(resources.id, initialWorkflow.resourceId))
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
        .where(eq(stockScanExecutions.idempotencyKey, idempotency.key))
        .limit(1);
      if (executionAfterLock) return validateReplay(executionAfterLock);

      // Lock and reread the workflow after the resource. A concurrent edit
      // cannot alter extraction or move the workflow to another resource while
      // this execution is being committed.
      const [workflow] = await transaction
        .select()
        .from(stockScanWorkflows)
        .where(eq(stockScanWorkflows.id, input.workflowId))
        .limit(1)
        .for("update");
      if (!workflow) throw new ScanWorkflowError("Workflow not found.", 404);
      if (workflow.resourceId !== resource.id) {
        throw new ScanWorkflowError(
          "The workflow changed while the scan was being prepared. Resolve it again.",
          409,
          { currentRevision: workflow.revision },
        );
      }
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
      assertWorkflowConfiguration(workflow);
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
        .where(eq(stockSettings.resourceId, resource.id))
        .limit(1);
      if (settings?.trackingMode !== "serialized") {
        throw new ScanWorkflowError(
          "The workflow inventory item must use serialized stock tracking.",
          409,
        );
      }

      const identifier = extractScanIdentifier(input.code, workflow.extraction);
      const metadataChanges = resolveMetadataChanges(
        workflow,
        identifier,
        input.inputs,
      );

      // Unit is locked only after its resource lock has been acquired.
      const [existingUnit] = await transaction
        .select()
        .from(stockUnits)
        .where(
          and(
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
        ...metadataChanges,
      };
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
            lastMovedAt: now,
            updatedAt: now,
          })
          .where(eq(stockUnits.id, existingUnit.id))
          .returning();
      } else {
        [savedUnit] = await transaction
          .insert(stockUnits)
          .values({
            resourceId: resource.id,
            code: identifier,
            status: nextStatus,
            location: resource.location,
            metadata: afterMetadata,
            acquiredAt: now,
            lastMovedAt: now,
          })
          .returning();
      }

      await transaction
        .update(resources)
        .set({ quantity: balanceAfter, updatedAt: now })
        .where(eq(resources.id, resource.id));
      const statusChanged =
        existingUnit !== undefined && existingUnit.status !== nextStatus;
      const [movement] = await transaction
        .insert(stockMovements)
        .values({
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
        metadataBefore: beforeMetadata,
        metadataAfter: afterMetadata,
      };
      const storedResponse = jsonRecord(response);
      await transaction.insert(stockScanExecutions).values({
        idempotencyKey: idempotency.key,
        workflowId: workflow.id,
        workflowRevision: workflow.revision,
        resourceId: resource.id,
        unitId: savedUnit.id,
        requestHash: idempotency.requestHash,
        codeHash: hashCode(input.code),
        actor,
        createdUnit: !existingUnit,
        beforeMetadata,
        afterMetadata,
        response: storedResponse,
      });
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
      .where(eq(stockScanExecutions.idempotencyKey, idempotency.key))
      .limit(1);
    if (winner) return validateReplay(winner);
    throw error;
  }
}
