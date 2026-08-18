import "server-only";

import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";

import {
  resourceRelations,
  resourceOptionGroups,
  resources,
  resourceVariants,
  stockSettings,
  type ResourceRecord,
  type StockTrackingMode,
} from "@/db/schema";
import { db } from "@/lib/db";
import { VARIANT_FAMILY_WRITE_LOCK_ID } from "@/lib/inventory-locks";
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
