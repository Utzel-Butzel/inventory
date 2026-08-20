import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  organizations,
  resources,
  resourceVariants,
  stockMovements,
  stockSettings,
  type ResourceVariantRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueStockMovementWebhookEvents } from "@/lib/webhooks";
import {
  computeVariantStockSummary,
  nextVariantStockQuantities,
  type ResourceVariantCreateInput,
  type ResourceVariantDto,
  type ResourceVariantMovementInput,
  type ResourceVariantPatchInput,
} from "@/lib/resource-variant-contract";

type DbExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ResourceVariantError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "ResourceVariantError";
  }
}

export function resourceVariantHttpError(error: unknown, fallback: string) {
  if (error instanceof ResourceVariantError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("resource_variants_resource_name_unique")) {
    return {
      status: 409 as const,
      message: "This item already has a variant with that name.",
    };
  }
  if (
    message.includes("resource_variants_sku_unique") ||
    message.includes("resources_sku_unique")
  ) {
    return {
      status: 409 as const,
      message: "That SKU is already used by an item or variant.",
    };
  }
  if (message.includes("resource_variants_barcode_unique")) {
    return {
      status: 409 as const,
      message: "That barcode is already used by another variant.",
    };
  }
  return { status: 500 as const, message: fallback };
}

export const resourceVariantDto = (
  row: ResourceVariantRecord,
): ResourceVariantDto => ({
  id: row.id,
  resourceId: row.resourceId,
  name: row.name,
  sku: row.sku,
  barcode: row.barcode,
  priceCents: row.priceCents,
  currency: row.currency,
  quantity: row.quantity,
  position: row.position,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const assertBulkTracking = async (
  executor: DbExecutor,
  organizationId: string,
  resourceId: string,
) => {
  const [settings] = await executor
    .select({ trackingMode: stockSettings.trackingMode })
    .from(stockSettings)
    .where(
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, resourceId),
      ),
    )
    .limit(1);
  if (settings?.trackingMode === "serialized") {
    throw new ResourceVariantError(
      "Variants are available for bulk-tracked items only. Serialized units remain identified at item level.",
      409,
    );
  }
};

export const assertVariantIdentifiersAvailable = async (
  executor: DbExecutor,
  organizationId: string,
  sku: string | null | undefined,
  barcode: string | null | undefined,
  resourceId: string,
  variantId?: string,
) => {
  const [parent] = await executor
    .select({ sku: resources.sku, barcode: resources.barcode })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (sku) {
    const [parentWithSku, variantWithSku] = await Promise.all([
      executor
        .select({ id: resources.id })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.sku, sku),
          ),
        )
        .limit(1),
      executor
        .select({ id: resourceVariants.id })
        .from(resourceVariants)
        .where(
          and(
            eq(resourceVariants.organizationId, organizationId),
            eq(resourceVariants.sku, sku),
          ),
        )
        .limit(1),
    ]);
    if (
      parentWithSku[0] ||
      (variantWithSku[0] && variantWithSku[0].id !== variantId) ||
      parent?.sku === sku
    ) {
      throw new ResourceVariantError(
        "That SKU is already used by an item or variant.",
        409,
      );
    }
  }
  if (barcode) {
    const [parentWithBarcode, variantWithBarcode] = await Promise.all([
      executor
        .select({ id: resources.id })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.barcode, barcode),
          ),
        )
        .limit(1),
      executor
        .select({ id: resourceVariants.id })
        .from(resourceVariants)
        .where(
          and(
            eq(resourceVariants.organizationId, organizationId),
            eq(resourceVariants.barcode, barcode),
          ),
        )
        .limit(1),
    ]);
    if (
      parentWithBarcode[0] ||
      (variantWithBarcode[0] && variantWithBarcode[0].id !== variantId) ||
      parent?.barcode === barcode
    ) {
      throw new ResourceVariantError(
        "That barcode is already used by an item or variant.",
        409,
      );
    }
  }
};

export async function listResourceVariants(
  organizationId: string,
  resourceId: string,
) {
  const [resource] = await db
    .select({ id: resources.id, quantity: resources.quantity })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (!resource) return null;

  const [settings, variants] = await Promise.all([
    db
      .select({ trackingMode: stockSettings.trackingMode })
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resourceId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.resourceId, resourceId),
        ),
      )
      .orderBy(asc(resourceVariants.position), asc(resourceVariants.name)),
  ]);
  return {
    variants: variants.map(resourceVariantDto),
    summary: computeVariantStockSummary(
      resource.quantity,
      variants.map((variant) => variant.quantity),
    ),
    trackingMode: settings[0]?.trackingMode ?? "bulk",
  };
}

export async function createResourceVariant(
  organizationId: string,
  resourceId: string,
  input: ResourceVariantCreateInput,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({
        id: resources.id,
        quantity: resources.quantity,
        currency: resources.currency,
      })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!resource) throw new ResourceVariantError("Not found", 404);
    await assertBulkTracking(transaction, organizationId, resourceId);
    await assertVariantIdentifiersAvailable(
      transaction,
      organizationId,
      input.sku,
      input.barcode,
      resourceId,
    );

    const existingVariants = await transaction
      .select({ id: resourceVariants.id, quantity: resourceVariants.quantity })
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.resourceId, resourceId),
        ),
      )
      .orderBy(asc(resourceVariants.id))
      .for("update");
    const allocated = existingVariants.reduce(
      (total, variant) => total + variant.quantity,
      0,
    );
    const allocation = input.initialAllocation;
    if (allocated + allocation > resource.quantity) {
      throw new ResourceVariantError(
        `Only ${resource.quantity - allocated} unallocated units are available. Add stock first or choose a smaller opening allocation.`,
        409,
      );
    }

    const [{ nextPosition }] = await transaction
      .select({
        nextPosition: sql<number>`coalesce(max(${resourceVariants.position}), -1)::int + 1`,
      })
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.resourceId, resourceId),
        ),
      );
    const now = new Date();
    const [created] = await transaction
      .insert(resourceVariants)
      .values({
        organizationId,
        resourceId,
        name: input.name,
        sku: input.sku,
        barcode: input.barcode,
        priceCents: input.priceCents,
        currency: input.currency ?? resource.currency,
        quantity: allocation,
        position: input.position ?? Number(nextPosition ?? 0),
        createdBy: actor,
        updatedBy: actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (allocation > 0) {
      const [movement] = await transaction
        .insert(stockMovements)
        .values({
          organizationId,
          resourceId,
          variantId: created.id,
          variantDelta: allocation,
          variantBalanceAfter: allocation,
          delta: 0,
          quantity: allocation,
          balanceAfter: resource.quantity,
          type: "variant-allocation",
          reason: "Existing item stock allocated to a new variant",
          note: "",
          occurredAt: now,
          createdBy: actor,
        })
        .returning();
      await enqueueStockMovementWebhookEvents(transaction, [movement]);
    }
    return resourceVariantDto(created);
  });
}

export async function updateResourceVariant(
  organizationId: string,
  resourceId: string,
  variantId: string,
  patch: ResourceVariantPatchInput,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    const [variant] = await transaction
      .select()
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.id, variantId),
          eq(resourceVariants.resourceId, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!variant) throw new ResourceVariantError("Variant not found", 404);
    await assertBulkTracking(transaction, organizationId, resourceId);
    await assertVariantIdentifiersAvailable(
      transaction,
      organizationId,
      patch.sku === undefined ? undefined : patch.sku,
      patch.barcode === undefined ? undefined : patch.barcode,
      resourceId,
      variant.id,
    );

    const [saved] = await transaction
      .update(resourceVariants)
      .set({ ...patch, updatedBy: actor, updatedAt: new Date() })
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.id, variant.id),
        ),
      )
      .returning();
    return resourceVariantDto(saved);
  });
}

export async function deleteResourceVariant(
  organizationId: string,
  resourceId: string,
  variantId: string,
) {
  return db.transaction(async (transaction) => {
    const [variant] = await transaction
      .select()
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.id, variantId),
          eq(resourceVariants.resourceId, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!variant) throw new ResourceVariantError("Variant not found", 404);
    if (variant.quantity > 0) {
      throw new ResourceVariantError(
        "Move this variant's stock to zero before deleting it.",
        409,
      );
    }
    const [movement] = await transaction
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.variantId, variant.id),
        ),
      )
      .limit(1);
    if (movement) {
      throw new ResourceVariantError(
        "This variant has stock history and cannot be deleted. Keep it for the audit trail.",
        409,
      );
    }
    await transaction
      .delete(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.id, variant.id),
        ),
      );
    return resourceVariantDto(variant);
  });
}

export async function bookResourceVariantMovement(
  organizationId: string,
  resourceId: string,
  variantId: string,
  input: ResourceVariantMovementInput,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({
        id: resources.id,
        quantity: resources.quantity,
        allowNegativeStock: organizations.allowNegativeStock,
      })
      .from(resources)
      .innerJoin(
        organizations,
        eq(organizations.id, resources.organizationId),
      )
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!resource) throw new ResourceVariantError("Not found", 404);
    await assertBulkTracking(transaction, organizationId, resourceId);

    const [variant] = await transaction
      .select()
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.id, variantId),
          eq(resourceVariants.resourceId, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!variant) throw new ResourceVariantError("Variant not found", 404);

    let nextVariantQuantity: number;
    let nextResourceQuantity: number;
    try {
      const next = nextVariantStockQuantities(
        resource.quantity,
        variant.quantity,
        input.delta,
        resource.allowNegativeStock,
      );
      nextVariantQuantity = next.nextVariantQuantity;
      nextResourceQuantity = next.nextParentQuantity;
    } catch (error) {
      if (variant.quantity + input.delta < 0) {
        throw new ResourceVariantError(
          `This variant only contains ${variant.quantity} units.`,
          409,
        );
      }
      throw new ResourceVariantError(
        error instanceof Error
          ? error.message
          : "This variant stock booking is invalid.",
        409,
      );
    }

    const now = new Date();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
    const [savedVariant] = await transaction
      .update(resourceVariants)
      .set({
        quantity: nextVariantQuantity,
        updatedBy: actor,
        updatedAt: now,
      })
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          eq(resourceVariants.id, variant.id),
        ),
      )
      .returning();
    await transaction
      .update(resources)
      .set({ quantity: nextResourceQuantity, updatedAt: now })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resource.id),
        ),
      );
    const [movement] = await transaction
      .insert(stockMovements)
      .values({
        organizationId,
        resourceId,
        variantId: variant.id,
        variantDelta: input.delta,
        variantBalanceAfter: nextVariantQuantity,
        delta: input.delta,
        quantity: Math.abs(input.delta),
        balanceAfter: nextResourceQuantity,
        type: input.type,
        reason: input.reason,
        note: input.note,
        occurredAt,
        createdBy: actor,
      })
      .returning();
    await enqueueStockMovementWebhookEvents(transaction, [movement]);
    return {
      variant: resourceVariantDto(savedVariant),
      resource: { id: resource.id, quantity: nextResourceQuantity },
      movement: {
        id: movement.id,
        delta: movement.delta,
        balanceAfter: movement.balanceAfter,
        variantDelta: movement.variantDelta,
        variantBalanceAfter: movement.variantBalanceAfter,
        occurredAt: movement.occurredAt.toISOString(),
      },
    };
  });
}
