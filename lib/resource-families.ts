import "server-only";

import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  bomLines,
  resourceRelations,
  resourceOptionConfigurations,
  resourceOptionGroups,
  resources,
  resourceVariants,
  stockSettings,
  variantBomOverrides,
  type ResourceRecord,
  type StockTrackingMode,
} from "@/db/schema";
import {
  AssemblyOperationError,
  assertCurrentEffectiveBomGraphAcyclic,
} from "@/lib/assemblies";
import { db } from "@/lib/db";
import {
  BOM_WRITE_LOCK_ID,
  VARIANT_FAMILY_WRITE_LOCK_ID,
} from "@/lib/inventory-locks";
import { enqueueWebhookEvent } from "@/lib/webhooks";

export const VARIANT_RELATION_TYPE = "variant_of" as const;

/**
 * These fields are deliberately local to every first-class variant. Shared
 * catalog fields are copied from the primary resource and can be kept in sync
 * by consulting the relation's overriddenFields attribute.
 */
export const VARIANT_LOCAL_FIELDS = ["name", "sku", "barcode"] as const;

export const VARIANT_INHERITED_CATALOG_FIELDS = [
  "description",
  "type",
  "valueCents",
  "currency",
  "priority",
  "tags",
  "categories",
  "customFields",
  "notes",
] as const;

const variantInheritedCatalogFieldSet = new Set<string>(
  VARIANT_INHERITED_CATALOG_FIELDS,
);

export type ResourceFamilyMemberDto = {
  id: string;
  name: string;
  type: string;
  status: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  trackingMode: StockTrackingMode;
  updatedAt: string;
  overriddenFields: string[];
};

export type ResourceFamilyDto = {
  role: "primary" | "variant";
  currentResourceId: string;
  primary: ResourceFamilyMemberDto;
  variants: ResourceFamilyMemberDto[];
  legacyVariantCount: number;
  optionGroupCount: number;
  summary: {
    totalQuantity: number;
    primaryQuantity: number;
    variantQuantity: number;
    variantCount: number;
    serializedVariantCount: number;
  };
};

export type CreateResourceFamilyVariantInput = {
  name: string;
  sku: string | null;
  barcode: string | null;
};

export type AttachExistingResourceVariantInput = {
  variantResourceId: string;
};

export class ResourceFamilyError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "ResourceFamilyError";
  }
}

export function resourceFamilyHttpError(error: unknown, fallback: string) {
  if (error instanceof ResourceFamilyError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("resources_sku_unique") ||
    message.includes("resource_variants_sku_unique")
  ) {
    return {
      status: 409 as const,
      message: "That SKU is already used by an item or variant.",
    };
  }
  if (
    message.includes("resources_barcode_unique") ||
    message.includes("resource_variants_barcode_unique")
  ) {
    return {
      status: 409 as const,
      message: "That barcode is already used by an item or variant.",
    };
  }
  if (message.includes("resource_relations_variant_source_unique")) {
    return {
      status: 409 as const,
      message: "This item already belongs to a variant family.",
    };
  }
  return { status: 500 as const, message: fallback };
}

export const overriddenFieldsFromAttributes = (attributes: unknown) => {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return [];
  }
  const value = (attributes as Record<string, unknown>).overriddenFields;
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((field): field is string => typeof field === "string")),
  ).sort();
};

export type ResourceVariantMembership = {
  relationId: string;
  primaryResourceId: string;
  overriddenFields: string[];
};

export type ResourceFamilyTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * Transaction-scoped membership lookup used by catalog write paths. Keeping
 * it executor-based lets a primary update and its inherited variant updates
 * share the same commit boundary.
 */
export async function findResourceVariantMembership(
  transaction: ResourceFamilyTransaction,
  organizationId: string,
  resourceId: string,
): Promise<ResourceVariantMembership | null> {
  const [membership] = await transaction
    .select({
      relationId: resourceRelations.id,
      primaryResourceId: resourceRelations.targetResourceId,
      attributes: resourceRelations.attributes,
    })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.sourceResourceId, resourceId),
        eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
      ),
    )
    .limit(1);
  return membership
    ? {
        relationId: membership.relationId,
        primaryResourceId: membership.primaryResourceId,
        overriddenFields: overriddenFieldsFromAttributes(
          membership.attributes,
        ),
      }
    : null;
}

export async function getResourceVariantContext(
  organizationId: string,
  resourceId: string,
) {
  const [membership] = await db
    .select({
      primaryResourceId: resourceRelations.targetResourceId,
      attributes: resourceRelations.attributes,
    })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.sourceResourceId, resourceId),
        eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
      ),
    )
    .limit(1);
  if (!membership) return null;

  const [primary] = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, membership.primaryResourceId),
      ),
    )
    .limit(1);
  return primary
    ? {
        primary,
        overriddenFields: overriddenFieldsFromAttributes(
          membership.attributes,
        ).filter((field) => variantInheritedCatalogFieldSet.has(field)),
      }
    : null;
}

const familyMemberDto = (
  resource: ResourceRecord,
  trackingMode: StockTrackingMode | null | undefined,
  overriddenFields: string[],
): ResourceFamilyMemberDto => ({
  id: resource.id,
  name: resource.name,
  type: resource.type,
  status: resource.status,
  sku: resource.sku,
  barcode: resource.barcode,
  quantity: resource.quantity,
  trackingMode: trackingMode ?? "bulk",
  updatedAt: resource.updatedAt.toISOString(),
  overriddenFields,
});

export async function getResourceFamily(
  organizationId: string,
  currentResourceId: string,
  options: {
    authorize?: (resource: ResourceRecord) => boolean | Promise<boolean>;
  } = {},
): Promise<ResourceFamilyDto | null> {
  const [current] = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, currentResourceId),
      ),
    )
    .limit(1);
  if (!current) return null;

  const [outgoingMembership] = await db
    .select({ targetResourceId: resourceRelations.targetResourceId })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.sourceResourceId, currentResourceId),
        eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
      ),
    )
    .limit(1);

  const primaryResourceId =
    outgoingMembership?.targetResourceId ?? currentResourceId;
  if (outgoingMembership) {
    const [nestedMembership] = await db
      .select({ id: resourceRelations.id })
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, organizationId),
          eq(resourceRelations.sourceResourceId, primaryResourceId),
          eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
        ),
      )
      .limit(1);
    if (nestedMembership) {
      throw new ResourceFamilyError(
        "This variant family is invalid because variant families cannot be nested.",
        409,
      );
    }
  }

  const memberships = await db
    .select({
      sourceResourceId: resourceRelations.sourceResourceId,
      attributes: resourceRelations.attributes,
    })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.targetResourceId, primaryResourceId),
        eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
      ),
    )
    .orderBy(asc(resourceRelations.createdAt), asc(resourceRelations.id));

  const memberIds = Array.from(
    new Set([
      primaryResourceId,
      ...memberships.map((membership) => membership.sourceResourceId),
    ]),
  );
  const [memberRows, settingsRows, legacyRows, optionGroupRows] = await Promise.all([
    db
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, memberIds),
        ),
      ),
    db
      .select({
        resourceId: stockSettings.resourceId,
        trackingMode: stockSettings.trackingMode,
      })
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          inArray(stockSettings.resourceId, memberIds),
        ),
      ),
    db
      .select({ value: count() })
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.resourceId, primaryResourceId),
        ),
      ),
    db
      .select({ value: count() })
      .from(resourceOptionGroups)
      .where(
        and(
          eq(resourceOptionGroups.organizationId, organizationId),
          eq(resourceOptionGroups.primaryResourceId, primaryResourceId),
        ),
      ),
  ]);

  const rowsById = new Map(memberRows.map((row) => [row.id, row]));
  const primaryRow = rowsById.get(primaryResourceId);
  if (!primaryRow) {
    throw new ResourceFamilyError("The primary inventory item was not found.", 404);
  }
  if (options.authorize) {
    const authorized = await Promise.all(
      memberRows.map((resource) => options.authorize!(resource)),
    );
    if (authorized.some((allowed) => !allowed)) {
      throw new ResourceFamilyError(
        "You do not have permission to view every item in this variant family.",
        403,
      );
    }
  }
  const trackingModeById = new Map(
    settingsRows.map((row) => [row.resourceId, row.trackingMode]),
  );
  const attributesByVariantId = new Map(
    memberships.map((membership) => [
      membership.sourceResourceId,
      overriddenFieldsFromAttributes(membership.attributes),
    ]),
  );

  const primary = familyMemberDto(
    primaryRow,
    trackingModeById.get(primaryRow.id),
    [],
  );
  const variants = memberships
    .flatMap((membership) => {
      const row = rowsById.get(membership.sourceResourceId);
      return row
        ? [
            familyMemberDto(
              row,
              trackingModeById.get(row.id),
              attributesByVariantId.get(row.id) ?? [],
            ),
          ]
        : [];
    })
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
  const variantQuantity = variants.reduce(
    (total, variant) => total + variant.quantity,
    0,
  );

  return {
    role: outgoingMembership ? "variant" : "primary",
    currentResourceId,
    primary,
    variants,
    legacyVariantCount: Number(legacyRows[0]?.value ?? 0),
    optionGroupCount: Number(optionGroupRows[0]?.value ?? 0),
    summary: {
      totalQuantity: primary.quantity + variantQuantity,
      primaryQuantity: primary.quantity,
      variantQuantity,
      variantCount: variants.length,
      serializedVariantCount: variants.filter(
        (variant) => variant.trackingMode === "serialized",
      ).length,
    },
  };
}

async function assertIdentifiersAvailable(
  transaction: ResourceFamilyTransaction,
  organizationId: string,
  input: CreateResourceFamilyVariantInput,
) {
  const resourceIdentifierChecks = [
    ...(input.sku ? [eq(resources.sku, input.sku)] : []),
    ...(input.barcode ? [eq(resources.barcode, input.barcode)] : []),
  ];
  const legacyIdentifierChecks = [
    ...(input.sku ? [eq(resourceVariants.sku, input.sku)] : []),
    ...(input.barcode ? [eq(resourceVariants.barcode, input.barcode)] : []),
  ];
  if (!resourceIdentifierChecks.length && !legacyIdentifierChecks.length) return;

  const [resourceConflicts, legacyConflicts] = await Promise.all([
    resourceIdentifierChecks.length
      ? transaction
          .select({ sku: resources.sku, barcode: resources.barcode })
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              or(...resourceIdentifierChecks),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    legacyIdentifierChecks.length
      ? transaction
          .select({ sku: resourceVariants.sku, barcode: resourceVariants.barcode })
          .from(resourceVariants)
          .where(
            and(
              eq(resourceVariants.organizationId, organizationId),
              or(...legacyIdentifierChecks),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  const conflicts = [...resourceConflicts, ...legacyConflicts];
  if (input.sku && conflicts.some((conflict) => conflict.sku === input.sku)) {
    throw new ResourceFamilyError(
      "That SKU is already used by an item or variant.",
      409,
    );
  }
  if (
    input.barcode &&
    conflicts.some((conflict) => conflict.barcode === input.barcode)
  ) {
    throw new ResourceFamilyError(
      "That barcode is already used by an item or variant.",
      409,
    );
  }
}

type FamilyBomLine = {
  assemblyResourceId: string;
  slotKey: string;
  componentResourceId: string;
  quantityPerAssembly: number;
  position: number;
  note: string;
};

const sameBomLine = (left: FamilyBomLine, right: FamilyBomLine) =>
  left.componentResourceId === right.componentResourceId &&
  left.quantityPerAssembly === right.quantityPerAssembly &&
  left.position === right.position &&
  left.note === right.note;

/**
 * Reuse the primary's stable slots where an existing recipe clearly refers to
 * the same component or position. Unmatched lines retain their own stable key
 * and become variant-only additions.
 */
function alignExistingBomToPrimary(
  primaryLines: FamilyBomLine[],
  variantLines: FamilyBomLine[],
) {
  const primaryBySlot = new Map(
    primaryLines.map((line) => [line.slotKey, line]),
  );
  const usedSlots = new Set<string>();
  const aligned = variantLines.map((line) => ({ ...line, alignedSlotKey: "" }));

  for (const line of aligned) {
    if (primaryBySlot.has(line.slotKey) && !usedSlots.has(line.slotKey)) {
      line.alignedSlotKey = line.slotKey;
      usedSlots.add(line.slotKey);
    }
  }
  for (const line of aligned) {
    if (line.alignedSlotKey) continue;
    const match = primaryLines.find(
      (primary) =>
        primary.componentResourceId === line.componentResourceId &&
        !usedSlots.has(primary.slotKey),
    );
    if (!match) continue;
    line.alignedSlotKey = match.slotKey;
    usedSlots.add(match.slotKey);
  }
  for (const line of aligned) {
    if (line.alignedSlotKey) continue;
    const match = primaryLines.find(
      (primary) =>
        primary.position === line.position && !usedSlots.has(primary.slotKey),
    );
    if (!match) continue;
    line.alignedSlotKey = match.slotKey;
    usedSlots.add(match.slotKey);
  }
  for (const line of aligned) {
    if (line.alignedSlotKey) continue;
    line.alignedSlotKey = usedSlots.has(line.slotKey)
      ? randomUUID()
      : line.slotKey;
    usedSlots.add(line.alignedSlotKey);
  }

  return aligned.map(({ alignedSlotKey, ...line }) => ({
    ...line,
    slotKey: alignedSlotKey,
  }));
}

/**
 * Connect an existing standalone inventory item to a primary. No operational
 * records move: stock, locations, units, relationships, assignments, and
 * manufacturing history already belong to the existing resource. Catalog and
 * recipe differences are recorded as sparse overrides before inheritance is
 * enabled.
 */
export async function attachExistingResourceVariant(options: {
  organizationId: string;
  primaryResourceId: string;
  input: AttachExistingResourceVariantInput;
  actor: string;
  authorizeVariant?: (
    resource: ResourceRecord,
  ) => boolean | Promise<boolean>;
}) {
  const variantResourceId = options.input.variantResourceId;
  if (variantResourceId === options.primaryResourceId) {
    throw new ResourceFamilyError(
      "Choose a different inventory item to connect as a variant.",
      422,
    );
  }

  return db.transaction(async (transaction) => {
    // Match every other BOM/family mutation: graph lock, family lock, resource
    // rows in UUID order. This keeps attachment atomic with builds and edits.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );

    const storedBomLines = await transaction
      .select({
        assemblyResourceId: bomLines.assemblyResourceId,
        slotKey: bomLines.slotKey,
        componentResourceId: bomLines.componentResourceId,
        quantityPerAssembly: bomLines.quantityPerAssembly,
        position: bomLines.position,
        note: bomLines.note,
      })
      .from(bomLines)
      .where(
        and(
          eq(bomLines.organizationId, options.organizationId),
          inArray(bomLines.assemblyResourceId, [
            options.primaryResourceId,
            variantResourceId,
          ]),
        ),
      )
      .orderBy(asc(bomLines.assemblyResourceId), asc(bomLines.position));
    const resourceIds = Array.from(
      new Set([
        options.primaryResourceId,
        variantResourceId,
        ...storedBomLines.map((line) => line.componentResourceId),
      ]),
    ).sort();
    const lockedResources = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, options.organizationId),
          inArray(resources.id, resourceIds),
        ),
      )
      .orderBy(asc(resources.id))
      .for("update");
    const primary = lockedResources.find(
      (resource) => resource.id === options.primaryResourceId,
    );
    const variant = lockedResources.find(
      (resource) => resource.id === variantResourceId,
    );
    if (!primary || !variant) throw new ResourceFamilyError("Not found", 404);
    if (lockedResources.length !== resourceIds.length) {
      throw new ResourceFamilyError(
        "The existing item or one of its bill-of-materials components no longer exists.",
        409,
      );
    }
    if (
      options.authorizeVariant &&
      (!(await options.authorizeVariant(variant)))
    ) {
      throw new ResourceFamilyError(
        "You do not have permission to update the existing inventory item.",
        403,
      );
    }
    if (primary.status === "archived" || variant.status === "archived") {
      throw new ResourceFamilyError(
        "Restore both inventory items before connecting them as variants.",
        409,
      );
    }

    const familyLinks = await transaction
      .select({
        sourceResourceId: resourceRelations.sourceResourceId,
        targetResourceId: resourceRelations.targetResourceId,
      })
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, options.organizationId),
          eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
          or(
            inArray(resourceRelations.sourceResourceId, [
              options.primaryResourceId,
              variantResourceId,
            ]),
            eq(resourceRelations.targetResourceId, variantResourceId),
          ),
        ),
      );
    if (
      familyLinks.some(
        (link) => link.sourceResourceId === options.primaryResourceId,
      )
    ) {
      throw new ResourceFamilyError(
        "Add variants from the primary inventory item; variant families cannot be nested.",
        409,
      );
    }
    if (
      familyLinks.some((link) => link.sourceResourceId === variantResourceId)
    ) {
      throw new ResourceFamilyError(
        "The selected inventory item already belongs to a variant family.",
        409,
      );
    }
    if (
      familyLinks.some((link) => link.targetResourceId === variantResourceId)
    ) {
      throw new ResourceFamilyError(
        "The selected inventory item is itself a primary item. Detach its variants first.",
        409,
      );
    }

    const optionGroups = await transaction
      .select({ primaryResourceId: resourceOptionGroups.primaryResourceId })
      .from(resourceOptionGroups)
      .where(
        and(
          eq(resourceOptionGroups.organizationId, options.organizationId),
          inArray(resourceOptionGroups.primaryResourceId, [
            options.primaryResourceId,
            variantResourceId,
          ]),
        ),
      );
    if (
      optionGroups.some(
        (group) => group.primaryResourceId === options.primaryResourceId,
      )
    ) {
      throw new ResourceFamilyError(
        "This family uses option groups. Generate variants from the option matrix instead.",
        409,
      );
    }
    if (
      optionGroups.some(
        (group) => group.primaryResourceId === variantResourceId,
      )
    ) {
      throw new ResourceFamilyError(
        "The selected inventory item owns option groups and cannot become a nested variant.",
        409,
      );
    }
    const [optionConfiguration, existingOverride] = await Promise.all([
      transaction
        .select({ id: resourceOptionConfigurations.resourceId })
        .from(resourceOptionConfigurations)
        .where(
          and(
            eq(
              resourceOptionConfigurations.organizationId,
              options.organizationId,
            ),
            eq(resourceOptionConfigurations.resourceId, variantResourceId),
          ),
        )
        .limit(1),
      transaction
        .select({ id: variantBomOverrides.id })
        .from(variantBomOverrides)
        .where(
          and(
            eq(variantBomOverrides.organizationId, options.organizationId),
            eq(variantBomOverrides.variantResourceId, variantResourceId),
          ),
        )
        .limit(1),
    ]);
    if (optionConfiguration.length || existingOverride.length) {
      throw new ResourceFamilyError(
        "The selected inventory item has inconsistent variant metadata and cannot be connected safely.",
        409,
      );
    }

    const primaryLines = storedBomLines.filter(
      (line) => line.assemblyResourceId === options.primaryResourceId,
    );
    const variantLines = alignExistingBomToPrimary(
      primaryLines,
      storedBomLines.filter(
        (line) => line.assemblyResourceId === variantResourceId,
      ),
    );
    const variantBySlot = new Map(
      variantLines.map((line) => [line.slotKey, line]),
    );
    const primaryBySlot = new Map(
      primaryLines.map((line) => [line.slotKey, line]),
    );
    const now = new Date();
    const overrideValues: Array<typeof variantBomOverrides.$inferInsert> = [];
    for (const primaryLine of primaryLines) {
      const variantLine = variantBySlot.get(primaryLine.slotKey);
      if (!variantLine) {
        overrideValues.push({
          organizationId: options.organizationId,
          variantResourceId,
          slotKey: primaryLine.slotKey,
          removed: true,
          note: "",
          updatedAt: now,
        });
      } else if (!sameBomLine(primaryLine, variantLine)) {
        overrideValues.push({
          organizationId: options.organizationId,
          variantResourceId,
          slotKey: variantLine.slotKey,
          componentResourceId: variantLine.componentResourceId,
          quantityPerAssembly: variantLine.quantityPerAssembly,
          position: variantLine.position,
          note: variantLine.note,
          updatedAt: now,
        });
      }
    }
    for (const variantLine of variantLines) {
      if (primaryBySlot.has(variantLine.slotKey)) continue;
      overrideValues.push({
        organizationId: options.organizationId,
        variantResourceId,
        slotKey: variantLine.slotKey,
        componentResourceId: variantLine.componentResourceId,
        quantityPerAssembly: variantLine.quantityPerAssembly,
        position: variantLine.position,
        note: variantLine.note,
        updatedAt: now,
      });
    }

    const overriddenFields = VARIANT_INHERITED_CATALOG_FIELDS.filter(
      (field) => !isDeepStrictEqual(variant[field], primary[field]),
    );
    await transaction.insert(resourceRelations).values({
      organizationId: options.organizationId,
      sourceResourceId: variantResourceId,
      targetResourceId: primary.id,
      relationTypeKey: VARIANT_RELATION_TYPE,
      origin: "manual",
      attributes: { overriddenFields, protected: true },
      createdBy: options.actor,
      createdAt: now,
    });
    await transaction
      .delete(bomLines)
      .where(
        and(
          eq(bomLines.organizationId, options.organizationId),
          eq(bomLines.assemblyResourceId, variantResourceId),
        ),
      );
    if (overrideValues.length) {
      await transaction.insert(variantBomOverrides).values(overrideValues);
    }
    try {
      await assertCurrentEffectiveBomGraphAcyclic(
        transaction,
        options.organizationId,
        variantResourceId,
      );
    } catch (error) {
      if (error instanceof AssemblyOperationError) {
        throw new ResourceFamilyError(error.message, error.status);
      }
      throw error;
    }

    const [saved, candidateSettings] = await Promise.all([
      transaction
        .update(resources)
        .set({ updatedAt: now })
        .where(
          and(
            eq(resources.organizationId, options.organizationId),
            eq(resources.id, variantResourceId),
          ),
        )
        .returning(),
      transaction
        .select({ trackingMode: stockSettings.trackingMode })
        .from(stockSettings)
        .where(
          and(
            eq(stockSettings.organizationId, options.organizationId),
            eq(stockSettings.resourceId, variantResourceId),
          ),
        )
        .limit(1),
    ]);
    const savedVariant = saved[0];
    if (!savedVariant) throw new ResourceFamilyError("Not found", 404);

    await enqueueWebhookEvent(transaction, {
      organizationId: options.organizationId,
      type: "inventory.resource.updated",
      aggregateType: "resource",
      aggregateId: variantResourceId,
      actor: options.actor,
      data: {
        resource: savedVariant,
        changedFields: ["variantFamily", "bom"],
        family: {
          role: "variant",
          primaryResourceId: primary.id,
          relationType: VARIANT_RELATION_TYPE,
          connectedExisting: true,
        },
      },
    });

    return familyMemberDto(
      savedVariant,
      candidateSettings[0]?.trackingMode,
      overriddenFields,
    );
  });
}

export async function createResourceFamilyVariant(options: {
  organizationId: string;
  primaryResourceId: string;
  input: CreateResourceFamilyVariantInput;
  actor: string;
  authorizeCreated?: (
    resource: ResourceRecord,
  ) => boolean | Promise<boolean>;
}) {
  return db.transaction(async (transaction) => {
    // Serialize membership changes with resource edit/delete paths so a
    // primary cannot become a variant between validation and relation insert.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );

    const [primary] = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, options.organizationId),
          eq(resources.id, options.primaryResourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!primary) throw new ResourceFamilyError("Not found", 404);
    if (primary.status === "archived") {
      throw new ResourceFamilyError(
        "Restore the primary inventory item before adding variants.",
        409,
      );
    }

    const [primaryMembership] = await transaction
      .select({ id: resourceRelations.id })
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, options.organizationId),
          eq(resourceRelations.sourceResourceId, primary.id),
          eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
        ),
      )
      .limit(1);
    if (primaryMembership) {
      throw new ResourceFamilyError(
        "Add variants from the primary inventory item; variant families cannot be nested.",
        409,
      );
    }

    const [optionGroup] = await transaction
      .select({ id: resourceOptionGroups.id })
      .from(resourceOptionGroups)
      .where(
        and(
          eq(resourceOptionGroups.organizationId, options.organizationId),
          eq(resourceOptionGroups.primaryResourceId, primary.id),
        ),
      )
      .limit(1);
    if (optionGroup) {
      throw new ResourceFamilyError(
        "This family uses option groups. Generate variants from the option matrix instead of adding one manually.",
        409,
      );
    }

    await assertIdentifiersAvailable(
      transaction,
      options.organizationId,
      options.input,
    );

    const [primarySettings] = await transaction
      .select()
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, options.organizationId),
          eq(stockSettings.resourceId, primary.id),
        ),
      )
      .limit(1);
    const now = new Date();
    const [created] = await transaction
      .insert(resources)
      .values({
        organizationId: options.organizationId,
        name: options.input.name,
        description: primary.description,
        type: primary.type,
        status: "available",
        sku: options.input.sku,
        quantity: 0,
        serialNumber: null,
        barcode: options.input.barcode,
        valueCents: primary.valueCents,
        currency: primary.currency,
        priority: primary.priority,
        tags: primary.tags,
        categories: primary.categories,
        customFields: primary.customFields,
        relatedResourceIds: [],
        mapFeatures: [],
        notes: primary.notes,
        createdBy: options.actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (
      options.authorizeCreated &&
      (!(await options.authorizeCreated(created)))
    ) {
      throw new ResourceFamilyError(
        "This variant would fall outside the inventory rule that grants your access.",
        403,
      );
    }

    const trackingMode = primarySettings?.trackingMode ?? "bulk";
    // The resources_initialize_stock trigger already created this row together
    // with the opening stock movement. Apply the primary item's settings to
    // that row instead of inserting a duplicate primary key.
    await transaction
      .update(stockSettings)
      .set({
        trackingMode,
        minimumStock: primarySettings?.minimumStock ?? 0,
        reorderQuantity: primarySettings?.reorderQuantity ?? 0,
        leadTimeDays: primarySettings?.leadTimeDays ?? 0,
        unitName: primarySettings?.unitName ?? "unit",
        purchaseUnitName: primarySettings?.purchaseUnitName ?? null,
        purchaseUnitFactor: primarySettings?.purchaseUnitFactor ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(stockSettings.organizationId, options.organizationId),
          eq(stockSettings.resourceId, created.id),
        ),
      );

    await transaction.insert(resourceRelations).values({
      organizationId: options.organizationId,
      sourceResourceId: created.id,
      targetResourceId: primary.id,
      relationTypeKey: VARIANT_RELATION_TYPE,
      origin: "manual",
      attributes: {
        overriddenFields: [],
        protected: true,
      },
      createdBy: options.actor,
      createdAt: now,
    });

    await enqueueWebhookEvent(transaction, {
      organizationId: options.organizationId,
      type: "inventory.resource.created",
      aggregateType: "resource",
      aggregateId: created.id,
      actor: options.actor,
      data: {
        resource: { ...created, media: [], cover: null },
        family: {
          role: "variant",
          primaryResourceId: primary.id,
          relationType: VARIANT_RELATION_TYPE,
        },
      },
    });

    return familyMemberDto(created, trackingMode, []);
  });
}
