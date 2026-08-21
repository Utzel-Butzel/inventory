import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  assemblyBuildComponents,
  assemblyBuilds,
  bomLines,
  media,
  organizations,
  resourceOptionConfigurations,
  resourceOptionGroups,
  resourceOptionSelections,
  resourceOptionValues,
  resourceRelations,
  resources,
  stockLocationBalances,
  stockMovements,
  stockSettings,
  stockUnits,
  variantBomOverrides,
  type AssemblyBuildComponentRecord,
  type AssemblyBuildRecord,
  type ResourceRecord,
  type StockMovementRecord,
  type StockTrackingMode,
  type StockUnitRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  BOM_WRITE_LOCK_ID,
  VARIANT_FAMILY_WRITE_LOCK_ID,
} from "@/lib/inventory-locks";
import {
  allocatedVariantQuantity,
  assertVariantAllocationFits,
} from "@/lib/variant-stock-invariant";
import {
  enqueueStockMovementWebhookEvents,
  enqueueWebhookEvent,
} from "@/lib/webhooks";

const MAX_STOCK_QUANTITY = 2_000_000_000;

export type BomComponentInput = {
  resourceId: string;
  slotKey?: string;
  quantityPerAssembly: number;
  position?: number;
  note?: string;
};

export type AssemblyBuildInput = {
  quantity: number;
  occurredAt?: Date;
  location?: string | null;
  note?: string;
  componentResourceSelections?: Record<string, string>;
  componentUnitIds?: Record<string, string[]>;
  outputUnitCodes?: string[];
};

type IdempotencyInput = { key: string; requestHash: string };

export class AssemblyOperationError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "AssemblyOperationError";
  }
}

export function assemblyHttpError(error: unknown, fallback: string) {
  if (error instanceof AssemblyOperationError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("stock_units_resource_code_unique")) {
    return {
      status: 409 as const,
      message: "One of the output or component unit codes already exists.",
    };
  }
  if (message.includes("assembly_builds_idempotency_key_unique")) {
    return {
      status: 409 as const,
      message: "That Idempotency-Key was already used for another assembly build.",
    };
  }
  return { status: 500 as const, message: fallback };
}

const jsonRecord = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const trackingMode = (value: StockTrackingMode | null): StockTrackingMode =>
  value ?? "bulk";

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

const movementDto = (row: StockMovementRecord) => ({
  id: row.id,
  resourceId: row.resourceId,
  unitId: row.unitId,
  assemblyBuildId: row.assemblyBuildId,
  purchaseReceiptId: row.purchaseReceiptId,
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

type BomOrigin = "local" | "inherited" | "override" | "variant";

type StoredBomLine = {
  id: string;
  slotKey: string;
  componentResourceId: string;
  quantityPerAssembly: number;
  position: number;
  note: string;
};

type EffectiveBomLine = StoredBomLine & { origin: BomOrigin };

type StoredVariantOverride = {
  id: string;
  variantResourceId: string;
  slotKey: string;
  componentResourceId: string | null;
  quantityPerAssembly: number | null;
  position: number | null;
  note: string;
  removed: boolean;
};

type NormalizedBomComponent = {
  slotKey: string;
  componentResourceId: string;
  quantityPerAssembly: number;
  position: number;
  note: string;
};

type ReadExecutor = Pick<typeof db, "select">;
type AssemblyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const sortBomLines = <T extends { position: number; slotKey: string }>(
  rows: T[],
) =>
  rows.sort(
    (left, right) =>
      left.position - right.position || left.slotKey.localeCompare(right.slotKey),
  );

async function findVariantPrimary(
  executor: ReadExecutor,
  organizationId: string,
  resourceId: string,
) {
  const [relation] = await executor
    .select({ primaryResourceId: resourceRelations.targetResourceId })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.sourceResourceId, resourceId),
        eq(resourceRelations.relationTypeKey, "variant_of"),
      ),
    )
    .limit(1);
  return relation?.primaryResourceId ?? null;
}

async function readStoredBom(
  executor: ReadExecutor,
  organizationId: string,
  assemblyResourceId: string,
): Promise<StoredBomLine[]> {
  return executor
    .select({
      id: bomLines.id,
      slotKey: bomLines.slotKey,
      componentResourceId: bomLines.componentResourceId,
      quantityPerAssembly: bomLines.quantityPerAssembly,
      position: bomLines.position,
      note: bomLines.note,
    })
    .from(bomLines)
    .where(
      and(
        eq(bomLines.organizationId, organizationId),
        eq(bomLines.assemblyResourceId, assemblyResourceId),
      ),
    )
    .orderBy(asc(bomLines.position), asc(bomLines.slotKey), asc(bomLines.id));
}

async function readVariantOverrides(
  executor: ReadExecutor,
  organizationId: string,
  variantResourceId: string,
): Promise<StoredVariantOverride[]> {
  return executor
    .select({
      id: variantBomOverrides.id,
      variantResourceId: variantBomOverrides.variantResourceId,
      slotKey: variantBomOverrides.slotKey,
      componentResourceId: variantBomOverrides.componentResourceId,
      quantityPerAssembly: variantBomOverrides.quantityPerAssembly,
      position: variantBomOverrides.position,
      note: variantBomOverrides.note,
      removed: variantBomOverrides.removed,
    })
    .from(variantBomOverrides)
    .where(
      and(
        eq(variantBomOverrides.organizationId, organizationId),
        eq(variantBomOverrides.variantResourceId, variantResourceId),
      ),
    )
    .orderBy(asc(variantBomOverrides.slotKey));
}

function applyVariantBomOverrides(
  baseLines: StoredBomLine[],
  overrides: StoredVariantOverride[],
): EffectiveBomLine[] {
  const baseBySlot = new Map(baseLines.map((line) => [line.slotKey, line]));
  const overrideBySlot = new Map(overrides.map((row) => [row.slotKey, row]));
  const effective: EffectiveBomLine[] = [];

  for (const base of baseLines) {
    const override = overrideBySlot.get(base.slotKey);
    if (!override) {
      effective.push({ ...base, origin: "inherited" });
      continue;
    }
    if (override.removed) continue;
    if (
      override.componentResourceId === null ||
      override.quantityPerAssembly === null ||
      override.position === null
    ) {
      throw new AssemblyOperationError(
        "This variant contains an invalid bill-of-materials override.",
        409,
      );
    }
    effective.push({
      id: override.id,
      slotKey: override.slotKey,
      componentResourceId: override.componentResourceId,
      quantityPerAssembly: override.quantityPerAssembly,
      position: override.position,
      note: override.note,
      origin: "override",
    });
  }

  for (const override of overrides) {
    if (baseBySlot.has(override.slotKey) || override.removed) continue;
    if (
      override.componentResourceId === null ||
      override.quantityPerAssembly === null ||
      override.position === null
    ) {
      throw new AssemblyOperationError(
        "This variant contains an invalid bill-of-materials override.",
        409,
      );
    }
    effective.push({
      id: override.id,
      slotKey: override.slotKey,
      componentResourceId: override.componentResourceId,
      quantityPerAssembly: override.quantityPerAssembly,
      position: override.position,
      note: override.note,
      origin: "variant",
    });
  }

  return sortBomLines(effective);
}

async function resolveEffectiveBomRecipe(
  executor: ReadExecutor,
  organizationId: string,
  resourceId: string,
) {
  const primaryResourceId = await findVariantPrimary(
    executor,
    organizationId,
    resourceId,
  );
  if (!primaryResourceId) {
    const baseLines = await readStoredBom(executor, organizationId, resourceId);
    return {
      lines: baseLines.map((line) => ({ ...line, origin: "local" as const })),
      baseLines,
      primary: null,
      overrideCount: 0,
    };
  }

  if (
    await findVariantPrimary(executor, organizationId, primaryResourceId)
  ) {
    throw new AssemblyOperationError(
      "Nested variant families cannot inherit a bill of materials.",
      409,
    );
  }
  const baseLines = await readStoredBom(
    executor,
    organizationId,
    primaryResourceId,
  );
  const overrides = await readVariantOverrides(
    executor,
    organizationId,
    resourceId,
  );
  const [primary] = await executor
    .select({ id: resources.id, name: resources.name })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, primaryResourceId),
      ),
    )
    .limit(1);
  if (!primary) {
    throw new AssemblyOperationError("The primary variant item no longer exists.", 409);
  }
  return {
    lines: applyVariantBomOverrides(baseLines, overrides),
    baseLines,
    primary,
    overrideCount: overrides.length,
  };
}

async function readOptionControlledBomLines(
  executor: ReadExecutor,
  organizationId: string,
  resourceId: string,
  baseLines: StoredBomLine[],
) {
  const selections = await executor
    .select({
      groupName: resourceOptionGroups.name,
      slotKey: resourceOptionGroups.bomSlotKey,
      componentResourceId: resourceOptionValues.componentResourceId,
    })
    .from(resourceOptionConfigurations)
    .innerJoin(
      resourceOptionSelections,
      and(
        eq(
          resourceOptionSelections.configurationId,
          resourceOptionConfigurations.id,
        ),
        eq(
          resourceOptionSelections.organizationId,
          resourceOptionConfigurations.organizationId,
        ),
      ),
    )
    .innerJoin(
      resourceOptionGroups,
      and(
        eq(resourceOptionGroups.id, resourceOptionSelections.groupId),
        eq(
          resourceOptionGroups.organizationId,
          resourceOptionSelections.organizationId,
        ),
      ),
    )
    .innerJoin(
      resourceOptionValues,
      and(
        eq(resourceOptionValues.id, resourceOptionSelections.valueId),
        eq(resourceOptionValues.groupId, resourceOptionSelections.groupId),
      ),
    )
    .where(
      and(
        eq(resourceOptionConfigurations.organizationId, organizationId),
        eq(resourceOptionConfigurations.resourceId, resourceId),
        sql`${resourceOptionGroups.bomSlotKey} is not null`,
      ),
    );
  const baseBySlot = new Map(baseLines.map((line) => [line.slotKey, line]));
  return selections.map((selection) => {
    const base = selection.slotKey
      ? baseBySlot.get(selection.slotKey)
      : undefined;
    if (!base || !selection.componentResourceId) {
      throw new AssemblyOperationError(
        `The BOM mapping for option group "${selection.groupName}" is invalid.`,
        409,
      );
    }
    return {
      groupName: selection.groupName,
      slotKey: base.slotKey,
      componentResourceId: selection.componentResourceId,
      quantityPerAssembly: base.quantityPerAssembly,
      position: base.position,
      note: base.note,
      baseComponentResourceId: base.componentResourceId,
    };
  });
}

async function syncOptionBomOverridesForPrimary(
  transaction: AssemblyTransaction,
  organizationId: string,
  primaryResourceId: string,
  baseLines: StoredBomLine[],
) {
  const configurations = await transaction
    .select({ resourceId: resourceOptionConfigurations.resourceId })
    .from(resourceOptionConfigurations)
    .where(
      and(
        eq(resourceOptionConfigurations.organizationId, organizationId),
        eq(
          resourceOptionConfigurations.primaryResourceId,
          primaryResourceId,
        ),
        sql`${resourceOptionConfigurations.resourceId} <> ${primaryResourceId}`,
      ),
    );
  const variantIds = configurations.map((row) => row.resourceId);
  if (!variantIds.length) return;
  const controlledByVariant = new Map<
    string,
    Awaited<ReturnType<typeof readOptionControlledBomLines>>
  >();
  for (const variantId of variantIds) {
    controlledByVariant.set(
      variantId,
      await readOptionControlledBomLines(
        transaction,
        organizationId,
        variantId,
        baseLines,
      ),
    );
  }
  const slotKeys = Array.from(
    new Set(
      Array.from(controlledByVariant.values()).flatMap((lines) =>
        lines.map((line) => line.slotKey),
      ),
    ),
  );
  if (slotKeys.length) {
    await transaction
      .delete(variantBomOverrides)
      .where(
        and(
          eq(variantBomOverrides.organizationId, organizationId),
          inArray(variantBomOverrides.variantResourceId, variantIds),
          inArray(variantBomOverrides.slotKey, slotKeys),
        ),
      );
  }
  const now = new Date();
  const requiredOverrides = Array.from(controlledByVariant.entries()).flatMap(
    ([variantResourceId, lines]) =>
      lines.flatMap((line) =>
        line.componentResourceId === line.baseComponentResourceId
          ? []
          : [
              {
                organizationId,
                variantResourceId,
                slotKey: line.slotKey,
                componentResourceId: line.componentResourceId,
                quantityPerAssembly: line.quantityPerAssembly,
                position: line.position,
                note: line.note,
                removed: false,
                updatedAt: now,
              },
            ],
      ),
  );
  if (requiredOverrides.length) {
    await transaction.insert(variantBomOverrides).values(requiredOverrides);
  }
}

async function getBomWithExecutor(
  executor: ReadExecutor,
  organizationId: string,
  resourceId: string,
  options: {
    authorizeChoice?: (resource: ResourceRecord) => boolean | Promise<boolean>;
  } = {},
) {
  const [resource] = await executor
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
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
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (!resource) return null;

  const recipe = await resolveEffectiveBomRecipe(
    executor,
    organizationId,
    resourceId,
  );
  const componentIds = Array.from(
    new Set(recipe.lines.map((line) => line.componentResourceId)),
  );
  const variantLinks = componentIds.length
    ? await executor
        .select({
          variantResourceId: resourceRelations.sourceResourceId,
          primaryResourceId: resourceRelations.targetResourceId,
        })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, organizationId),
            eq(resourceRelations.relationTypeKey, "variant_of"),
            inArray(resourceRelations.targetResourceId, componentIds),
          ),
        )
        .orderBy(asc(resourceRelations.createdAt), asc(resourceRelations.id))
    : [];
  const choiceResourceIds = Array.from(
    new Set([
      ...componentIds,
      ...variantLinks.map((link) => link.variantResourceId),
    ]),
  );
  const componentRows = choiceResourceIds.length
    ? await executor
        .select({
          id: resources.id,
          name: resources.name,
          sku: resources.sku,
          availableQuantity: resources.quantity,
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
            inArray(resources.id, choiceResourceIds),
          ),
        )
    : [];
  const componentById = new Map(componentRows.map((row) => [row.id, row]));
  if (componentIds.some((componentId) => !componentById.has(componentId))) {
    throw new AssemblyOperationError("A bill-of-materials component no longer exists.", 409);
  }
  const variantResourceRows =
    options.authorizeChoice && variantLinks.length
      ? await executor
          .select()
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              inArray(
                resources.id,
                variantLinks.map((link) => link.variantResourceId),
              ),
            ),
          )
      : [];
  const variantResourceById = new Map(
    variantResourceRows.map((variant) => [variant.id, variant]),
  );
  const allowedVariantIds = new Set<string>();
  for (const link of variantLinks) {
    const variant = componentById.get(link.variantResourceId);
    const authorizationResource = variantResourceById.get(link.variantResourceId);
    if (
      variant &&
      (!options.authorizeChoice ||
        (authorizationResource &&
          (await options.authorizeChoice(authorizationResource))))
    ) {
      allowedVariantIds.add(variant.id);
    }
  }
  const visibleChoiceIds = [
    ...componentIds,
    ...Array.from(allowedVariantIds),
  ];
  const availableUnitRows = visibleChoiceIds.length
    ? await executor
        .select()
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            inArray(stockUnits.resourceId, visibleChoiceIds),
            eq(stockUnits.status, "available"),
          ),
        )
        .orderBy(asc(stockUnits.resourceId), asc(stockUnits.code))
    : [];
  const coverRows = visibleChoiceIds.length
    ? await executor
        .select({
          id: media.id,
          resourceId: media.resourceId,
          url: media.url,
          altText: media.altText,
          width: media.width,
          height: media.height,
        })
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            inArray(media.resourceId, visibleChoiceIds),
            eq(media.kind, "image"),
          ),
        )
        .orderBy(asc(media.resourceId), asc(media.position), asc(media.createdAt))
    : [];
  const coverByResource = new Map<
    string,
    {
      id: string;
      url: string;
      altText: string;
      width: number | null;
      height: number | null;
    }
  >();
  for (const cover of coverRows) {
    if (!coverByResource.has(cover.resourceId)) {
      coverByResource.set(cover.resourceId, {
        id: cover.id,
        url: cover.url,
        altText: cover.altText,
        width: cover.width,
        height: cover.height,
      });
    }
  }
  const unitsByResource = new Map<string, typeof availableUnitRows>();
  for (const unit of availableUnitRows) {
    const list = unitsByResource.get(unit.resourceId) ?? [];
    list.push(unit);
    unitsByResource.set(unit.resourceId, list);
  }
  const variantsByPrimary = new Map<string, string[]>();
  for (const link of variantLinks) {
    if (!allowedVariantIds.has(link.variantResourceId)) continue;
    const current = variantsByPrimary.get(link.primaryResourceId) ?? [];
    current.push(link.variantResourceId);
    variantsByPrimary.set(link.primaryResourceId, current);
  }
  const choiceDto = (choiceId: string, primaryId: string) => {
    const choice = componentById.get(choiceId)!;
    return {
      resourceId: choice.id,
      name: choice.name,
      sku: choice.sku,
      availableQuantity: choice.availableQuantity,
      trackingMode: trackingMode(choice.trackingMode),
      cover: coverByResource.get(choice.id) ?? null,
      availableUnits: (unitsByResource.get(choice.id) ?? []).map((unit) => ({
        id: unit.id,
        code: unit.code,
        location: unit.location,
      })),
      isPrimary: choice.id === primaryId,
    };
  };
  const components = recipe.lines.map((line) => {
    const component = componentById.get(line.componentResourceId)!;
    return {
      id: line.id,
      slotKey: line.slotKey,
      origin: line.origin,
      resourceId: component.id,
      name: component.name,
      sku: component.sku,
      quantityPerAssembly: line.quantityPerAssembly,
      position: line.position,
      note: line.note,
      availableQuantity: component.availableQuantity,
      trackingMode: trackingMode(component.trackingMode),
      cover: coverByResource.get(component.id) ?? null,
      availableUnits: (unitsByResource.get(component.id) ?? []).map((unit) => ({
        id: unit.id,
        code: unit.code,
        location: unit.location,
      })),
      choices: [
        choiceDto(component.id, component.id),
        ...(variantsByPrimary.get(component.id) ?? [])
          .map((variantId) => choiceDto(variantId, component.id))
          .sort(
            (left, right) =>
              left.name.localeCompare(right.name) ||
              left.resourceId.localeCompare(right.resourceId),
          ),
      ],
    };
  });
  const buildableQuantity = components.length
    ? Math.min(
        ...components.map((component) =>
          Math.floor(component.availableQuantity / component.quantityPerAssembly),
        ),
      )
    : 0;

  return {
    resource: {
      ...resource,
      trackingMode: trackingMode(resource.trackingMode),
    },
    components,
    buildableQuantity,
    inheritance: recipe.primary
      ? {
          primaryResourceId: recipe.primary.id,
          primaryName: recipe.primary.name,
          overrideCount: recipe.overrideCount,
        }
      : null,
  };
}

export async function getBom(
  organizationId: string,
  resourceId: string,
  options: {
    authorizeChoice?: (resource: ResourceRecord) => boolean | Promise<boolean>;
  } = {},
) {
  return db.transaction(
    (transaction) =>
      getBomWithExecutor(transaction, organizationId, resourceId, options),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function normalizeBomComponents(
  components: BomComponentInput[],
  referenceLines: Array<Pick<StoredBomLine, "slotKey" | "componentResourceId" | "position">>,
): NormalizedBomComponent[] {
  const normalized = components.map((component, index) => ({
    slotKey: component.slotKey ?? null,
    componentResourceId: component.resourceId,
    quantityPerAssembly: component.quantityPerAssembly,
    position: component.position ?? index,
    note: component.note ?? "",
  }));
  const usedSlots = new Set(
    normalized.flatMap((component) => (component.slotKey ? [component.slotKey] : [])),
  );
  if (usedSlots.size !== normalized.filter((component) => component.slotKey).length) {
    throw new AssemblyOperationError(
      "Each bill-of-materials slot key may appear only once.",
      422,
    );
  }

  for (const component of normalized) {
    if (component.slotKey) continue;
    const exact = referenceLines.find(
      (line) =>
        line.componentResourceId === component.componentResourceId &&
        !usedSlots.has(line.slotKey),
    );
    if (exact) {
      component.slotKey = exact.slotKey;
      usedSlots.add(exact.slotKey);
    }
  }
  for (const component of normalized) {
    if (component.slotKey) continue;
    const samePosition = referenceLines.find(
      (line) => line.position === component.position && !usedSlots.has(line.slotKey),
    );
    component.slotKey = samePosition?.slotKey ?? randomUUID();
    usedSlots.add(component.slotKey);
  }
  return normalized.map((component) => ({
    ...component,
    slotKey: component.slotKey!,
  }));
}

function assertDistinctRecipeComponents(
  components: Array<{ componentResourceId: string }>,
) {
  if (
    new Set(components.map((component) => component.componentResourceId)).size !==
    components.length
  ) {
    throw new AssemblyOperationError(
      "Each component may appear only once in a bill of materials.",
      422,
    );
  }
}

async function assertEffectiveBomGraphAcyclic(
  executor: ReadExecutor,
  organizationId: string,
  proposed: {
    resourceId: string;
    isVariant: boolean;
    lines: NormalizedBomComponent[];
  },
) {
  const storedBaseRows = await executor
    .select({
      assemblyResourceId: bomLines.assemblyResourceId,
      id: bomLines.id,
      slotKey: bomLines.slotKey,
      componentResourceId: bomLines.componentResourceId,
      quantityPerAssembly: bomLines.quantityPerAssembly,
      position: bomLines.position,
      note: bomLines.note,
    })
    .from(bomLines)
    .where(eq(bomLines.organizationId, organizationId));
  const storedOverrides = await executor
    .select({
      id: variantBomOverrides.id,
      variantResourceId: variantBomOverrides.variantResourceId,
      slotKey: variantBomOverrides.slotKey,
      componentResourceId: variantBomOverrides.componentResourceId,
      quantityPerAssembly: variantBomOverrides.quantityPerAssembly,
      position: variantBomOverrides.position,
      note: variantBomOverrides.note,
      removed: variantBomOverrides.removed,
    })
    .from(variantBomOverrides)
    .where(eq(variantBomOverrides.organizationId, organizationId));
  const variantLinks = await executor
    .select({
      variantResourceId: resourceRelations.sourceResourceId,
      primaryResourceId: resourceRelations.targetResourceId,
    })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.relationTypeKey, "variant_of"),
      ),
    );

  const baseByAssembly = new Map<string, StoredBomLine[]>();
  for (const row of storedBaseRows) {
    const lines = baseByAssembly.get(row.assemblyResourceId) ?? [];
    lines.push(row);
    baseByAssembly.set(row.assemblyResourceId, lines);
  }
  if (!proposed.isVariant) {
    baseByAssembly.set(
      proposed.resourceId,
      proposed.lines.map((line) => ({ id: line.slotKey, ...line })),
    );
  }
  const overridesByVariant = new Map<string, StoredVariantOverride[]>();
  for (const row of storedOverrides) {
    const rows = overridesByVariant.get(row.variantResourceId) ?? [];
    rows.push(row);
    overridesByVariant.set(row.variantResourceId, rows);
  }
  const primaryByVariant = new Map(
    variantLinks.map((link) => [link.variantResourceId, link.primaryResourceId]),
  );
  const cache = new Map<string, EffectiveBomLine[]>();
  const resolving = new Set<string>();
  const resolve = (resourceId: string): EffectiveBomLine[] => {
    if (proposed.isVariant && resourceId === proposed.resourceId) {
      return proposed.lines.map((line) => ({
        id: line.slotKey,
        ...line,
        origin: "variant" as const,
      }));
    }
    const cached = cache.get(resourceId);
    if (cached) return cached;
    if (resolving.has(resourceId)) {
      throw new AssemblyOperationError(
        "This variant family contains a circular inheritance dependency.",
        409,
      );
    }
    resolving.add(resourceId);
    const primaryResourceId = primaryByVariant.get(resourceId);
    const lines = primaryResourceId
      ? applyVariantBomOverrides(
          resolve(primaryResourceId),
          overridesByVariant.get(resourceId) ?? [],
        )
      : (baseByAssembly.get(resourceId) ?? []).map((line) => ({
          ...line,
          origin: "local" as const,
        }));
    resolving.delete(resourceId);
    cache.set(resourceId, lines);
    return lines;
  };

  const assemblyIds = new Set([
    ...baseByAssembly.keys(),
    ...primaryByVariant.keys(),
    proposed.resourceId,
  ]);
  const adjacency = new Map<string, string[]>();
  for (const assemblyId of assemblyIds) {
    const lines = resolve(assemblyId);
    assertDistinctRecipeComponents(lines);
    adjacency.set(
      assemblyId,
      lines.map((line) => line.componentResourceId),
    );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (resourceId: string): boolean => {
    if (visiting.has(resourceId)) return true;
    if (visited.has(resourceId)) return false;
    visiting.add(resourceId);
    for (const componentResourceId of adjacency.get(resourceId) ?? []) {
      if (visit(componentResourceId)) return true;
    }
    visiting.delete(resourceId);
    visited.add(resourceId);
    return false;
  };
  if (Array.from(assemblyIds).some(visit)) {
    throw new AssemblyOperationError(
      "This bill of materials would create a circular assembly dependency.",
      409,
    );
  }
}

/**
 * Revalidates the complete effective BOM graph after another service has
 * inserted family links or sparse variant overrides in the same transaction.
 */
export async function assertCurrentEffectiveBomGraphAcyclic(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  resourceId: string,
) {
  const recipe = await resolveEffectiveBomRecipe(
    transaction,
    organizationId,
    resourceId,
  );
  await assertEffectiveBomGraphAcyclic(transaction, organizationId, {
    resourceId,
    isVariant: Boolean(recipe.primary),
    lines: recipe.lines.map((line) => ({
      slotKey: line.slotKey,
      componentResourceId: line.componentResourceId,
      quantityPerAssembly: line.quantityPerAssembly,
      position: line.position,
      note: line.note,
    })),
  });
}

export async function replaceBom(
  organizationId: string,
  assemblyResourceId: string,
  components: BomComponentInput[],
) {
  await db.transaction(async (transaction) => {
    // Two concurrent replacements can otherwise each introduce one half of a
    // cycle. The transaction-scoped advisory lock serializes graph mutations.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );

    const currentRecipe = await resolveEffectiveBomRecipe(
      transaction,
      organizationId,
      assemblyResourceId,
    );
    const referencesBySlot = new Map(
      [...currentRecipe.baseLines, ...currentRecipe.lines].map((line) => [
        line.slotKey,
        line,
      ]),
    );
    const normalizedComponents = normalizeBomComponents(
      components,
      Array.from(referencesBySlot.values()),
    );

    const ids = Array.from(
      new Set([
        assemblyResourceId,
        ...normalizedComponents.map((item) => item.componentResourceId),
      ]),
    ).sort();
    const lockedResources = await transaction
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, ids),
        ),
      )
      .orderBy(asc(resources.id))
      .for("update");
    if (!lockedResources.some((item) => item.id === assemblyResourceId)) {
      throw new AssemblyOperationError("Not found", 404);
    }
    if (lockedResources.length !== ids.length) {
      throw new AssemblyOperationError(
        "One or more selected components no longer exist.",
        422,
      );
    }
    if (
      normalizedComponents.some(
        (item) => item.componentResourceId === assemblyResourceId,
      )
    ) {
      throw new AssemblyOperationError(
        "An assembly cannot contain itself as a component.",
        422,
      );
    }
    assertDistinctRecipeComponents(normalizedComponents);

    if (currentRecipe.primary) {
      const controlledLines = await readOptionControlledBomLines(
        transaction,
        organizationId,
        assemblyResourceId,
        currentRecipe.baseLines,
      );
      const submittedBySlot = new Map(
        normalizedComponents.map((line) => [line.slotKey, line]),
      );
      for (const controlled of controlledLines) {
        const submitted = submittedBySlot.get(controlled.slotKey);
        if (
          !submitted ||
          submitted.componentResourceId !== controlled.componentResourceId ||
          submitted.quantityPerAssembly !== controlled.quantityPerAssembly ||
          submitted.position !== controlled.position ||
          submitted.note !== controlled.note
        ) {
          throw new AssemblyOperationError(
            `The BOM slot controlled by option group "${controlled.groupName}" follows its selected option. Change the option definition instead.`,
            409,
          );
        }
      }
    } else {
      const mappedDefaults = await transaction
        .select({
          groupName: resourceOptionGroups.name,
          slotKey: resourceOptionGroups.bomSlotKey,
          componentResourceId: resourceOptionValues.componentResourceId,
        })
        .from(resourceOptionGroups)
        .innerJoin(
          resourceOptionValues,
          and(
            eq(resourceOptionValues.groupId, resourceOptionGroups.id),
            eq(resourceOptionValues.isDefault, true),
          ),
        )
        .where(
          and(
            eq(resourceOptionGroups.organizationId, organizationId),
            eq(resourceOptionGroups.primaryResourceId, assemblyResourceId),
            sql`${resourceOptionGroups.bomSlotKey} is not null`,
          ),
        );
      const submittedBySlot = new Map(
        normalizedComponents.map((line) => [line.slotKey, line]),
      );
      for (const mapping of mappedDefaults) {
        const submitted = mapping.slotKey
          ? submittedBySlot.get(mapping.slotKey)
          : undefined;
        if (!submitted) {
          throw new AssemblyOperationError(
            `The BOM slot used by option group "${mapping.groupName}" cannot be removed. Edit or clear the option groups first.`,
            409,
          );
        }
        if (submitted.componentResourceId !== mapping.componentResourceId) {
          throw new AssemblyOperationError(
            `The default component for option group "${mapping.groupName}" must match its mapped BOM slot. Edit the option group first.`,
            409,
          );
        }
      }
    }
    await assertEffectiveBomGraphAcyclic(transaction, organizationId, {
      resourceId: assemblyResourceId,
      isVariant: Boolean(currentRecipe.primary),
      lines: normalizedComponents,
    });

    if (currentRecipe.primary) {
      const baseBySlot = new Map(
        currentRecipe.baseLines.map((line) => [line.slotKey, line]),
      );
      const submittedBySlot = new Map(
        normalizedComponents.map((line) => [line.slotKey, line]),
      );
      const overrideValues: Array<typeof variantBomOverrides.$inferInsert> = [];
      const now = new Date();
      for (const base of currentRecipe.baseLines) {
        const submitted = submittedBySlot.get(base.slotKey);
        if (!submitted) {
          overrideValues.push({
            organizationId,
            variantResourceId: assemblyResourceId,
            slotKey: base.slotKey,
            removed: true,
            note: "",
            updatedAt: now,
          });
          continue;
        }
        if (
          submitted.componentResourceId === base.componentResourceId &&
          submitted.quantityPerAssembly === base.quantityPerAssembly &&
          submitted.position === base.position &&
          submitted.note === base.note
        ) {
          continue;
        }
        overrideValues.push({
          organizationId,
          variantResourceId: assemblyResourceId,
          slotKey: submitted.slotKey,
          componentResourceId: submitted.componentResourceId,
          quantityPerAssembly: submitted.quantityPerAssembly,
          position: submitted.position,
          note: submitted.note,
          updatedAt: now,
        });
      }
      for (const submitted of normalizedComponents) {
        if (baseBySlot.has(submitted.slotKey)) continue;
        overrideValues.push({
          organizationId,
          variantResourceId: assemblyResourceId,
          slotKey: submitted.slotKey,
          componentResourceId: submitted.componentResourceId,
          quantityPerAssembly: submitted.quantityPerAssembly,
          position: submitted.position,
          note: submitted.note,
          updatedAt: now,
        });
      }
      await transaction
        .delete(variantBomOverrides)
        .where(
          and(
            eq(variantBomOverrides.organizationId, organizationId),
            eq(variantBomOverrides.variantResourceId, assemblyResourceId),
          ),
        );
      if (overrideValues.length) {
        await transaction.insert(variantBomOverrides).values(overrideValues);
      }
    } else {
      await transaction
        .delete(bomLines)
        .where(
          and(
            eq(bomLines.organizationId, organizationId),
            eq(bomLines.assemblyResourceId, assemblyResourceId),
          ),
        );
      if (normalizedComponents.length) {
        const now = new Date();
        await transaction.insert(bomLines).values(
          normalizedComponents.map((component) => ({
            organizationId,
            assemblyResourceId,
            slotKey: component.slotKey,
            componentResourceId: component.componentResourceId,
            quantityPerAssembly: component.quantityPerAssembly,
            position: component.position,
            note: component.note,
            updatedAt: now,
          })),
        );
      }
      await syncOptionBomOverridesForPrimary(
        transaction,
        organizationId,
        assemblyResourceId,
        normalizedComponents.map((line) => ({
          id: line.slotKey,
          slotKey: line.slotKey,
          componentResourceId: line.componentResourceId,
          quantityPerAssembly: line.quantityPerAssembly,
          position: line.position,
          note: line.note,
        })),
      );
    }
  });

  const result = await getBom(organizationId, assemblyResourceId);
  if (!result) throw new AssemblyOperationError("Not found", 404);
  return result;
}

export async function resetVariantBomOverrides(
  organizationId: string,
  variantResourceId: string,
) {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );
    const recipe = await resolveEffectiveBomRecipe(
      transaction,
      organizationId,
      variantResourceId,
    );
    if (!recipe.primary) {
      throw new AssemblyOperationError(
        "Only a linked variant can reset inherited bill-of-materials changes.",
        409,
      );
    }
    const controlledLines = await readOptionControlledBomLines(
      transaction,
      organizationId,
      variantResourceId,
      recipe.baseLines,
    );
    const controlledBySlot = new Map(
      controlledLines.map((line) => [line.slotKey, line]),
    );
    const inherited = recipe.baseLines.map((line) => ({
      slotKey: line.slotKey,
      componentResourceId:
        controlledBySlot.get(line.slotKey)?.componentResourceId ??
        line.componentResourceId,
      quantityPerAssembly: line.quantityPerAssembly,
      position: line.position,
      note: line.note,
    }));
    await assertEffectiveBomGraphAcyclic(transaction, organizationId, {
      resourceId: variantResourceId,
      isVariant: true,
      lines: inherited,
    });
    await transaction
      .delete(variantBomOverrides)
      .where(
        and(
          eq(variantBomOverrides.organizationId, organizationId),
          eq(variantBomOverrides.variantResourceId, variantResourceId),
        ),
      );
    const requiredOverrides = controlledLines.flatMap((line) =>
      line.componentResourceId === line.baseComponentResourceId
        ? []
        : [
            {
              organizationId,
              variantResourceId,
              slotKey: line.slotKey,
              componentResourceId: line.componentResourceId,
              quantityPerAssembly: line.quantityPerAssembly,
              position: line.position,
              note: line.note,
              removed: false,
              updatedAt: new Date(),
            },
          ],
    );
    if (requiredOverrides.length) {
      await transaction.insert(variantBomOverrides).values(requiredOverrides);
    }
  });

  const result = await getBom(organizationId, variantResourceId);
  if (!result) throw new AssemblyOperationError("Not found", 404);
  return result;
}

/**
 * Detach a first-class variant without changing the resource that owns its
 * operational data. The effective inherited BOM is materialized first so the
 * now-standalone item keeps exactly the recipe it had at detachment time.
 */
export async function detachResourceVariant(
  organizationId: string,
  variantResourceId: string,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    // Keep the global lock order aligned with merge/build and family writes:
    // BOM graph, family membership, then resource rows.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );

    const recipe = await resolveEffectiveBomRecipe(
      transaction,
      organizationId,
      variantResourceId,
    );
    if (!recipe.primary) {
      throw new AssemblyOperationError(
        "Only a linked variant can be detached from a variant family.",
        409,
      );
    }

    const resourceIds = Array.from(
      new Set([
        variantResourceId,
        recipe.primary.id,
        ...recipe.lines.map((line) => line.componentResourceId),
      ]),
    ).sort();
    const lockedResources = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, resourceIds),
        ),
      )
      .orderBy(asc(resources.id))
      .for("update");
    const variant = lockedResources.find(
      (resource) => resource.id === variantResourceId,
    );
    if (!variant) throw new AssemblyOperationError("Not found", 404);
    if (lockedResources.length !== resourceIds.length) {
      throw new AssemblyOperationError(
        "The primary item or one of the effective BOM components no longer exists.",
        409,
      );
    }
    assertDistinctRecipeComponents(recipe.lines);

    await transaction
      .delete(bomLines)
      .where(
        and(
          eq(bomLines.organizationId, organizationId),
          eq(bomLines.assemblyResourceId, variantResourceId),
        ),
      );
    const now = new Date();
    if (recipe.lines.length) {
      await transaction.insert(bomLines).values(
        recipe.lines.map((line) => ({
          organizationId,
          assemblyResourceId: variantResourceId,
          slotKey: line.slotKey,
          componentResourceId: line.componentResourceId,
          quantityPerAssembly: line.quantityPerAssembly,
          position: line.position,
          note: line.note,
          updatedAt: now,
        })),
      );
    }
    await transaction
      .delete(variantBomOverrides)
      .where(
        and(
          eq(variantBomOverrides.organizationId, organizationId),
          eq(variantBomOverrides.variantResourceId, variantResourceId),
        ),
      );
    await transaction
      .delete(resourceOptionConfigurations)
      .where(
        and(
          eq(resourceOptionConfigurations.organizationId, organizationId),
          eq(resourceOptionConfigurations.resourceId, variantResourceId),
        ),
      );
    const [removedMembership] = await transaction
      .delete(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, organizationId),
          eq(resourceRelations.sourceResourceId, variantResourceId),
          eq(resourceRelations.targetResourceId, recipe.primary.id),
          eq(resourceRelations.relationTypeKey, "variant_of"),
        ),
      )
      .returning({ id: resourceRelations.id });
    if (!removedMembership) {
      throw new AssemblyOperationError(
        "This item is no longer linked to that variant family.",
        409,
      );
    }

    const [saved] = await transaction
      .update(resources)
      .set({ updatedAt: now })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, variantResourceId),
        ),
      )
      .returning();
    if (!saved) throw new AssemblyOperationError("Not found", 404);

    await enqueueWebhookEvent(transaction, {
      organizationId,
      type: "inventory.resource.updated",
      aggregateType: "resource",
      aggregateId: variantResourceId,
      actor,
      data: {
        resource: saved,
        changedFields: ["variantFamily", "bom"],
        family: {
          role: "standalone",
          detachedFromResourceId: recipe.primary.id,
        },
      },
    });

    return {
      resourceId: variantResourceId,
      materializedBomLineCount: recipe.lines.length,
    };
  });
}

type BuildComponentDto = {
  resourceId: string | null;
  name: string;
  sku: string | null;
  quantityPerAssembly: number;
  quantityConsumed: number;
  componentUnits: Array<{
    id: string;
    code: string;
    location: string | null;
    status: string;
    outputUnitId: string | null;
  }>;
  stockMovementIds: string[];
  outputUnitIds: string[];
};

function buildComponentsDto(
  rows: AssemblyBuildComponentRecord[],
  unitsById: Map<string, StockUnitRecord>,
) {
  const grouped = new Map<string, BuildComponentDto>();
  for (const row of rows) {
    const key = row.componentResourceId ?? `${row.componentName}:${row.componentSku ?? ""}`;
    const current = grouped.get(key) ?? {
      resourceId: row.componentResourceId,
      name: row.componentName,
      sku: row.componentSku,
      quantityPerAssembly: row.quantityPerAssembly,
      quantityConsumed: 0,
      componentUnits: [],
      stockMovementIds: [],
      outputUnitIds: [],
    };
    current.quantityConsumed += row.quantityConsumed;
    if (row.stockMovementId && !current.stockMovementIds.includes(row.stockMovementId)) {
      current.stockMovementIds.push(row.stockMovementId);
    }
    if (row.outputUnitId && !current.outputUnitIds.includes(row.outputUnitId)) {
      current.outputUnitIds.push(row.outputUnitId);
    }
    if (row.componentUnitId) {
      const unit = unitsById.get(row.componentUnitId);
      if (unit) {
        current.componentUnits.push({
          id: unit.id,
          code: unit.code,
          location: unit.location,
          status: unit.status,
          outputUnitId: row.outputUnitId,
        });
      }
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values());
}

const buildDto = (
  build: AssemblyBuildRecord,
  componentRows: AssemblyBuildComponentRecord[],
  unitsById: Map<string, StockUnitRecord>,
) => {
  const outputIds = Array.from(
    new Set(
      componentRows
        .map((component) => component.outputUnitId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  return {
    id: build.id,
    assemblyResourceId: build.assemblyResourceId,
    quantity: build.quantity,
    occurredAt: build.occurredAt.toISOString(),
    location: build.location,
    note: build.note,
    createdBy: build.createdBy,
    createdAt: build.createdAt.toISOString(),
    components: buildComponentsDto(componentRows, unitsById),
    outputUnits: outputIds
      .map((id) => unitsById.get(id))
      .filter((unit): unit is StockUnitRecord => Boolean(unit))
      .map(unitDto),
  };
};

export async function listAssemblyBuilds(
  organizationId: string,
  assemblyResourceId: string,
  options: { limit?: number } = {},
) {
  const [resource] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, assemblyResourceId),
      ),
    )
    .limit(1);
  if (!resource) return null;

  const builds = await db
    .select()
    .from(assemblyBuilds)
    .where(
      and(
        eq(assemblyBuilds.organizationId, organizationId),
        eq(assemblyBuilds.assemblyResourceId, assemblyResourceId),
      ),
    )
    .orderBy(desc(assemblyBuilds.occurredAt), desc(assemblyBuilds.createdAt))
    .limit(Math.min(100, Math.max(1, options.limit ?? 50)));
  if (!builds.length) return { builds: [] };

  const buildIds = builds.map((build) => build.id);
  const componentRows = await db
    .select()
    .from(assemblyBuildComponents)
    .where(
      and(
        eq(assemblyBuildComponents.organizationId, organizationId),
        inArray(assemblyBuildComponents.buildId, buildIds),
      ),
    )
    .orderBy(asc(assemblyBuildComponents.createdAt), asc(assemblyBuildComponents.id));
  const unitIds = Array.from(
    new Set(
      componentRows
        .flatMap((component) => [component.componentUnitId, component.outputUnitId])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const unitRows = unitIds.length
    ? await db
        .select()
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            inArray(stockUnits.id, unitIds),
          ),
        )
    : [];
  const unitsById = new Map(unitRows.map((unit) => [unit.id, unit]));
  const componentsByBuild = new Map<string, AssemblyBuildComponentRecord[]>();
  for (const component of componentRows) {
    const list = componentsByBuild.get(component.buildId) ?? [];
    list.push(component);
    componentsByBuild.set(component.buildId, list);
  }
  return {
    builds: builds.map((build) =>
      buildDto(build, componentsByBuild.get(build.id) ?? [], unitsById),
    ),
  };
}

async function resolveBuildComponentSelections(
  transaction: AssemblyTransaction,
  organizationId: string,
  recipeLines: EffectiveBomLine[],
  selections: Record<string, string> | undefined,
) {
  const lineBySlot = new Map(recipeLines.map((line) => [line.slotKey, line]));
  for (const slotKey of Object.keys(selections ?? {})) {
    if (!lineBySlot.has(slotKey)) {
      throw new AssemblyOperationError(
        "componentResourceSelections contains a slot that is not in this bill of materials.",
        422,
      );
    }
  }

  const selectedVariantIds = Array.from(
    new Set(
      recipeLines.flatMap((line) => {
        const selectedResourceId = selections?.[line.slotKey];
        return selectedResourceId && selectedResourceId !== line.componentResourceId
          ? [selectedResourceId]
          : [];
      }),
    ),
  );
  const memberships = selectedVariantIds.length
    ? await transaction
        .select({
          variantResourceId: resourceRelations.sourceResourceId,
          primaryResourceId: resourceRelations.targetResourceId,
        })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, organizationId),
            eq(resourceRelations.relationTypeKey, "variant_of"),
            inArray(resourceRelations.sourceResourceId, selectedVariantIds),
          ),
        )
    : [];
  const primaryByVariant = new Map(
    memberships.map((membership) => [
      membership.variantResourceId,
      membership.primaryResourceId,
    ]),
  );

  return recipeLines.map((line) => {
    const selectedResourceId =
      selections?.[line.slotKey] ?? line.componentResourceId;
    if (
      selectedResourceId !== line.componentResourceId &&
      primaryByVariant.get(selectedResourceId) !== line.componentResourceId
    ) {
      throw new AssemblyOperationError(
        "A selected component configuration is not a direct variant of its BOM component.",
        422,
      );
    }
    return {
      ...line,
      baseComponentResourceId: line.componentResourceId,
      componentResourceId: selectedResourceId,
    };
  });
}

export async function buildAssembly(
  organizationId: string,
  assemblyResourceId: string,
  input: AssemblyBuildInput,
  actor: string,
  idempotency: IdempotencyInput,
  authorize: (resource: ResourceRecord) => boolean | Promise<boolean>,
) {
  let lockedResourcesAuthorized = false;

  const validateReplay = (existing: AssemblyBuildRecord) => {
    if (
      existing.assemblyResourceId !== assemblyResourceId ||
      existing.createdBy !== actor ||
      existing.requestHash !== idempotency.requestHash
    ) {
      throw new AssemblyOperationError(
        "That Idempotency-Key was already used for another resource, actor, or payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  };

  try {
    return await db.transaction(async (transaction) => {
      // Builds and recipe writes share one lock order: BOM graph first, then
      // resource rows. The effective inherited recipe therefore cannot change
      // between resolution and stock consumption.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
      );
      await transaction.execute(
        sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
      );
      const effectiveRecipe = await resolveEffectiveBomRecipe(
        transaction,
        organizationId,
        assemblyResourceId,
      );
      const initialBom = await resolveBuildComponentSelections(
        transaction,
        organizationId,
        effectiveRecipe.lines,
        input.componentResourceSelections,
      );

      const resourceIds = Array.from(
        new Set([
          assemblyResourceId,
          ...initialBom.map((line) => line.componentResourceId),
        ]),
      ).sort();
      const lockedResources = await transaction
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, resourceIds),
          ),
        )
        .orderBy(asc(resources.id))
        .for("update");
      if (!lockedResources.some((resource) => resource.id === assemblyResourceId)) {
        throw new AssemblyOperationError("Not found", 404);
      }
      if (lockedResources.length !== resourceIds.length) {
        throw new AssemblyOperationError(
          "The assembly or one of its components no longer exists.",
          409,
        );
      }
      for (const resource of lockedResources) {
        if (!(await authorize(resource))) {
          throw new AssemblyOperationError(
            "You do not have permission to manage stock for every item in this assembly.",
            403,
          );
        }
      }
      lockedResourcesAuthorized = true;

      const [replayAfterLock] = await transaction
        .select()
        .from(assemblyBuilds)
        .where(
          and(
            eq(assemblyBuilds.organizationId, organizationId),
            eq(assemblyBuilds.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (replayAfterLock) return validateReplay(replayAfterLock);

      if (!initialBom.length) {
        throw new AssemblyOperationError(
          "Define at least one component before building this assembly.",
          409,
        );
      }
      const resourceById = new Map(lockedResources.map((row) => [row.id, row]));
      const [organization] = await transaction
        .select({ allowNegativeStock: organizations.allowNegativeStock })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      if (!organization) {
        throw new AssemblyOperationError("Organization not found", 404);
      }
      const currentBom = initialBom.map((line) => {
        const component = resourceById.get(line.componentResourceId);
        if (!component) {
          throw new AssemblyOperationError("A component no longer exists.", 409);
        }
        return { ...line, name: component.name, sku: component.sku };
      });
      assertDistinctRecipeComponents(currentBom);

      const settingsRows = await transaction
        .select({
          resourceId: stockSettings.resourceId,
          trackingMode: stockSettings.trackingMode,
        })
        .from(stockSettings)
        .where(
          and(
            eq(stockSettings.organizationId, organizationId),
            inArray(stockSettings.resourceId, resourceIds),
          ),
        );
      const modeByResource = new Map(
        settingsRows.map((row) => [row.resourceId, row.trackingMode]),
      );
      const locatedRows = await transaction
        .select({
          resourceId: stockLocationBalances.resourceId,
          quantity: sql<number>`coalesce(sum(${stockLocationBalances.quantity}), 0)::int`,
        })
        .from(stockLocationBalances)
        .where(
          and(
            eq(stockLocationBalances.organizationId, organizationId),
            inArray(stockLocationBalances.resourceId, resourceIds),
          ),
        )
        .groupBy(stockLocationBalances.resourceId);
      const locatedByResource = new Map(
        locatedRows.map((row) => [row.resourceId, Number(row.quantity)]),
      );
      const assembly = resourceById.get(assemblyResourceId);
      if (!assembly) throw new AssemblyOperationError("Not found", 404);
      const assemblyMode = modeByResource.get(assemblyResourceId) ?? "bulk";
      if (assembly.quantity + input.quantity > MAX_STOCK_QUANTITY) {
        throw new AssemblyOperationError(
          `This build would exceed the maximum supported stock of ${MAX_STOCK_QUANTITY}.`,
          409,
        );
      }
      if (assemblyMode === "bulk" && input.outputUnitCodes?.length) {
        throw new AssemblyOperationError(
          "Output unit codes can only be supplied for serialized assemblies.",
          422,
        );
      }

      const bomComponentIds = new Set(
        currentBom.map((line) => line.componentResourceId),
      );
      for (const componentId of Object.keys(input.componentUnitIds ?? {})) {
        if (!bomComponentIds.has(componentId)) {
          throw new AssemblyOperationError(
            "componentUnitIds contains an item that is not in this bill of materials.",
            422,
          );
        }
        if ((modeByResource.get(componentId) ?? "bulk") !== "serialized") {
          throw new AssemblyOperationError(
            "Concrete component units may only be selected for serialized components.",
            422,
          );
        }
      }

      for (const line of currentBom) {
        const required = line.quantityPerAssembly * input.quantity;
        if (!Number.isSafeInteger(required) || required > MAX_STOCK_QUANTITY) {
          throw new AssemblyOperationError(
            `The required quantity for ${line.name} exceeds the supported range.`,
            422,
          );
        }
        const component = resourceById.get(line.componentResourceId);
        const componentMode = modeByResource.get(line.componentResourceId) ?? "bulk";
        if (
          !component ||
          (component.quantity < required &&
            (!organization.allowNegativeStock || componentMode === "serialized"))
        ) {
          throw new AssemblyOperationError(
            `${line.name} needs ${required}, but only ${component?.quantity ?? 0} are available.`,
            409,
          );
        }
        if (componentMode === "bulk" && !organization.allowNegativeStock) {
          const unassigned =
            component.quantity -
            (locatedByResource.get(line.componentResourceId) ?? 0);
          if (unassigned < required) {
            throw new AssemblyOperationError(
              `${line.name} needs ${required} unassigned units, but only ${Math.max(0, unassigned)} are available. Move the required stock to “Unassigned” before building so location balances stay accurate.`,
              409,
            );
          }
        }
        const selectedIds = input.componentUnitIds?.[line.componentResourceId];
        if (selectedIds && selectedIds.length !== required) {
          throw new AssemblyOperationError(
            `${line.name} requires exactly ${required} selected serialized units.`,
            422,
          );
        }
      }

      const occurredAt = input.occurredAt ?? new Date();
      const now = new Date();
      const [build] = await transaction
        .insert(assemblyBuilds)
        .values({
          organizationId,
          assemblyResourceId,
          quantity: input.quantity,
          occurredAt,
          location: input.location ?? assembly.location,
          note: input.note ?? "",
          idempotencyKey: idempotency.key,
          requestHash: idempotency.requestHash,
          response: {},
          createdBy: actor,
        })
        .returning();

      let outputUnits: StockUnitRecord[] = [];
      if (assemblyMode === "serialized") {
        const outputCodes =
          input.outputUnitCodes ??
          Array.from({ length: input.quantity }, () =>
            `ASM-${assemblyResourceId.slice(0, 8).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          );
        if (
          outputCodes.length !== input.quantity ||
          new Set(outputCodes).size !== outputCodes.length
        ) {
          throw new AssemblyOperationError(
            "Provide one unique output unit code for every built unit.",
            422,
          );
        }
        outputUnits = await transaction
          .insert(stockUnits)
          .values(
            outputCodes.map((code) => ({
              organizationId,
              resourceId: assemblyResourceId,
              code,
              status: "available" as const,
              location: input.location ?? assembly.location,
              metadata: { assemblyBuildId: build.id },
              acquiredAt: occurredAt,
              lastMovedAt: occurredAt,
            })),
          )
          .returning();
      }

      const allMovements: StockMovementRecord[] = [];
      const allocationValues: Array<typeof assemblyBuildComponents.$inferInsert> = [];
      const componentBalances: Array<{
        resourceId: string;
        name: string;
        quantity: number;
      }> = [];

      for (const line of currentBom) {
        const component = resourceById.get(line.componentResourceId);
        if (!component) {
          throw new AssemblyOperationError("A component no longer exists.", 409);
        }
        const required = line.quantityPerAssembly * input.quantity;
        const balanceAfter = component.quantity - required;
        if (balanceAfter < -MAX_STOCK_QUANTITY) {
          throw new AssemblyOperationError(
            `Consuming ${line.name} would exceed the minimum supported stock of -${MAX_STOCK_QUANTITY}.`,
            409,
          );
        }
        const mode = modeByResource.get(line.componentResourceId) ?? "bulk";
        if (!organization.allowNegativeStock) {
          const variantAllocation = await allocatedVariantQuantity(
            transaction,
            line.componentResourceId,
          );
          assertVariantAllocationFits(
            balanceAfter,
            variantAllocation,
            (message) => new AssemblyOperationError(message, 409),
          );
        }

        if (mode === "serialized") {
          const requestedIds = input.componentUnitIds?.[line.componentResourceId];
          let selectedUnits: StockUnitRecord[];
          if (requestedIds) {
            const lockedUnits = await transaction
              .select()
              .from(stockUnits)
              .where(
                and(
                  eq(stockUnits.organizationId, organizationId),
                  eq(stockUnits.resourceId, line.componentResourceId),
                  inArray(stockUnits.id, requestedIds),
                ),
              )
              .orderBy(asc(stockUnits.id))
              .for("update");
            const byId = new Map(lockedUnits.map((unit) => [unit.id, unit]));
            selectedUnits = requestedIds
              .map((id) => byId.get(id))
              .filter((unit): unit is StockUnitRecord => Boolean(unit));
            if (
              selectedUnits.length !== required ||
              selectedUnits.some((unit) => unit.status !== "available")
            ) {
              throw new AssemblyOperationError(
                `One or more selected ${line.name} units are missing or unavailable.`,
                409,
              );
            }
          } else {
            selectedUnits = await transaction
              .select()
              .from(stockUnits)
              .where(
                and(
                  eq(stockUnits.organizationId, organizationId),
                  eq(stockUnits.resourceId, line.componentResourceId),
                  eq(stockUnits.status, "available"),
                ),
              )
              .orderBy(asc(stockUnits.code), asc(stockUnits.id))
              .limit(required)
              .for("update");
            if (selectedUnits.length !== required) {
              throw new AssemblyOperationError(
                `${line.name} needs ${required} available serialized units, but only ${selectedUnits.length} could be allocated.`,
                409,
              );
            }
          }

          await transaction
            .update(stockUnits)
            .set({ status: "in-use", lastMovedAt: occurredAt, updatedAt: now })
            .where(
              and(
                eq(stockUnits.organizationId, organizationId),
                inArray(stockUnits.id, selectedUnits.map((unit) => unit.id)),
              ),
            );
          await transaction
            .update(resources)
            .set({ quantity: balanceAfter, updatedAt: now })
            .where(
              and(
                eq(resources.organizationId, organizationId),
                eq(resources.id, line.componentResourceId),
              ),
            );
          const movements = await transaction
            .insert(stockMovements)
            .values(
              selectedUnits.map((unit, index) => ({
                organizationId,
                resourceId: line.componentResourceId,
                unitId: unit.id,
                assemblyBuildId: build.id,
                delta: -1,
                quantity: 1,
                balanceAfter: component.quantity - index - 1,
                type: "assembly-consumption",
                reason: `Installed in ${assembly.name}`,
                note: input.note ?? "",
                location: unit.location ?? input.location ?? assembly.location,
                fromLocationResourceId: unit.locationResourceId,
                occurredAt,
                createdBy: actor,
              })),
            )
            .returning();
          allMovements.push(...movements);
          const movementByUnit = new Map(
            movements.map((movement) => [movement.unitId, movement]),
          );
          selectedUnits.forEach((unit, index) => {
            allocationValues.push({
              organizationId,
              buildId: build.id,
              componentResourceId: line.componentResourceId,
              componentName: line.name,
              componentSku: line.sku,
              quantityPerAssembly: line.quantityPerAssembly,
              quantityConsumed: 1,
              componentUnitId: unit.id,
              outputUnitId:
                outputUnits[Math.floor(index / line.quantityPerAssembly)]?.id ?? null,
              stockMovementId: movementByUnit.get(unit.id)?.id ?? null,
            });
          });
        } else {
          await transaction
            .update(resources)
            .set({ quantity: balanceAfter, updatedAt: now })
            .where(
              and(
                eq(resources.organizationId, organizationId),
                eq(resources.id, line.componentResourceId),
              ),
            );
          const [movement] = await transaction
            .insert(stockMovements)
            .values({
              organizationId,
              resourceId: line.componentResourceId,
              assemblyBuildId: build.id,
              delta: -required,
              quantity: required,
              balanceAfter,
              type: "assembly-consumption",
              reason: `Used to build ${input.quantity} × ${assembly.name}`,
              note: input.note ?? "",
              location: input.location ?? assembly.location,
              occurredAt,
              createdBy: actor,
            })
            .returning();
          allMovements.push(movement);
          if (outputUnits.length) {
            outputUnits.forEach((unit) => {
              allocationValues.push({
                organizationId,
                buildId: build.id,
                componentResourceId: line.componentResourceId,
                componentName: line.name,
                componentSku: line.sku,
                quantityPerAssembly: line.quantityPerAssembly,
                quantityConsumed: line.quantityPerAssembly,
                outputUnitId: unit.id,
                stockMovementId: movement.id,
              });
            });
          } else {
            allocationValues.push({
              organizationId,
              buildId: build.id,
              componentResourceId: line.componentResourceId,
              componentName: line.name,
              componentSku: line.sku,
              quantityPerAssembly: line.quantityPerAssembly,
              quantityConsumed: required,
              stockMovementId: movement.id,
            });
          }
        }
        componentBalances.push({
          resourceId: line.componentResourceId,
          name: line.name,
          quantity: balanceAfter,
        });
      }

      const assemblyBalanceAfter = assembly.quantity + input.quantity;
      await transaction
        .update(resources)
        .set({ quantity: assemblyBalanceAfter, updatedAt: now })
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, assemblyResourceId),
          ),
        );
      if (outputUnits.length) {
        const movements = await transaction
          .insert(stockMovements)
          .values(
            outputUnits.map((unit, index) => ({
              organizationId,
              resourceId: assemblyResourceId,
              unitId: unit.id,
              assemblyBuildId: build.id,
              delta: 1,
              quantity: 1,
              balanceAfter: assembly.quantity + index + 1,
              type: "assembly-output",
              reason: "Assembly completed",
              note: input.note ?? "",
              location: input.location ?? assembly.location,
              occurredAt,
              createdBy: actor,
            })),
          )
          .returning();
        allMovements.push(...movements);
      } else {
        const [movement] = await transaction
          .insert(stockMovements)
          .values({
            organizationId,
            resourceId: assemblyResourceId,
            assemblyBuildId: build.id,
            delta: input.quantity,
            quantity: input.quantity,
            balanceAfter: assemblyBalanceAfter,
            type: "assembly-output",
            reason: "Assembly completed",
            note: input.note ?? "",
            location: input.location ?? assembly.location,
            occurredAt,
            createdBy: actor,
          })
          .returning();
        allMovements.push(movement);
      }

      const savedAllocations = allocationValues.length
        ? await transaction
            .insert(assemblyBuildComponents)
            .values(allocationValues)
            .returning()
        : [];
      await enqueueStockMovementWebhookEvents(transaction, allMovements);
      const unitsById = new Map<string, StockUnitRecord>();
      for (const unit of outputUnits) unitsById.set(unit.id, unit);
      const componentUnitIds = savedAllocations
        .map((row) => row.componentUnitId)
        .filter((id): id is string => Boolean(id));
      if (componentUnitIds.length) {
        const installedRows = await transaction
          .select()
          .from(stockUnits)
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              inArray(stockUnits.id, componentUnitIds),
            ),
          );
        for (const unit of installedRows) unitsById.set(unit.id, unit);
      }
      const response = {
        build: buildDto(build, savedAllocations, unitsById),
        resource: {
          id: assembly.id,
          name: assembly.name,
          quantity: assemblyBalanceAfter,
          trackingMode: assemblyMode,
        },
        outputUnits: outputUnits.map(unitDto),
        componentBalances,
        movements: allMovements.map(movementDto),
      };
      const storedResponse = jsonRecord(response);
      await transaction
        .update(assemblyBuilds)
        .set({ response: storedResponse })
        .where(
          and(
            eq(assemblyBuilds.organizationId, organizationId),
            eq(assemblyBuilds.id, build.id),
          ),
        );
      return { response: storedResponse, replayed: false } as const;
    });
  } catch (error) {
    if (lockedResourcesAuthorized) {
      const [winner] = await db
        .select()
        .from(assemblyBuilds)
        .where(
          and(
            eq(assemblyBuilds.organizationId, organizationId),
            eq(assemblyBuilds.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (winner) return validateReplay(winner);
    }
    throw error;
  }
}
