import "server-only";

import { and, asc, desc, eq, isNull, lte, ne, sql } from "drizzle-orm";

import {
  inventoryCounts,
  inventoryCyclePolicies,
  inventoryTypeDefinitions,
  organizations,
  resources,
  stockLocationBalances,
  stockMovements,
  stockSettings,
} from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueStockMovementWebhookEvents } from "@/lib/webhooks";
import { StockOperationError } from "@/lib/stock";
import {
  allocatedVariantQuantity,
  assertVariantAllocationFits,
} from "@/lib/variant-stock-invariant";
import { violatesNegativeStockPolicy } from "@/lib/negative-stock-policy";

const MAX_STOCK_QUANTITY = 2_000_000_000;

const nextDate = (from: Date, intervalDays: number) =>
  new Date(from.getTime() + intervalDays * 24 * 60 * 60 * 1_000);

const policyDto = (row: typeof inventoryCyclePolicies.$inferSelect | undefined) =>
  row
    ? {
        ...row,
        nextDueAt: row.nextDueAt.toISOString(),
        lastCompletedAt: row.lastCompletedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;

const countDto = (row: typeof inventoryCounts.$inferSelect) => ({
  ...row,
  countedAt: row.countedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

export async function getInventoryCycle(
  organizationId: string,
  resourceId: string,
) {
  const [resource] = await db
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
  const [policyRows, history] = await Promise.all([
    db
      .select()
      .from(inventoryCyclePolicies)
      .where(
        and(
          eq(inventoryCyclePolicies.organizationId, organizationId),
          eq(inventoryCyclePolicies.resourceId, resourceId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(inventoryCounts)
      .where(
        and(
          eq(inventoryCounts.organizationId, organizationId),
          eq(inventoryCounts.resourceId, resourceId),
        ),
      )
      .orderBy(desc(inventoryCounts.countedAt))
      .limit(25),
  ]);
  return {
    resource: { ...resource, trackingMode: resource.trackingMode ?? "bulk" },
    policy: policyDto(policyRows[0]),
    history: history.map(countDto),
  };
}

export async function saveInventoryCyclePolicy(
  organizationId: string,
  resourceId: string,
  input: { intervalDays: number; enabled: boolean },
  actor: string,
) {
  const [resource] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (!resource) throw new StockOperationError("Not found", 404);
  const now = new Date();
  const [saved] = await db
    .insert(inventoryCyclePolicies)
    .values({
      organizationId,
      resourceId,
      intervalDays: input.intervalDays,
      enabled: input.enabled,
      nextDueAt: nextDate(now, input.intervalDays),
      createdBy: actor,
      updatedBy: actor,
    })
    .onConflictDoUpdate({
      target: inventoryCyclePolicies.resourceId,
      set: {
        organizationId,
        intervalDays: input.intervalDays,
        enabled: input.enabled,
        nextDueAt: sql`coalesce(${inventoryCyclePolicies.lastCompletedAt}, ${now}) + (${input.intervalDays} * interval '1 day')`,
        updatedBy: actor,
        updatedAt: now,
      },
    })
    .returning();
  return policyDto(saved);
}

export async function recordInventoryCount(
  organizationId: string,
  resourceId: string,
  input: {
    countedQuantity: number;
    locationResourceId?: string | null;
    countedAt?: Date;
    note?: string;
  },
  actor: string,
  idempotencyKey?: string,
) {
  const replay = (existing: typeof inventoryCounts.$inferSelect) => {
    const requestedCountedAt = input.countedAt?.getTime();
    if (
      existing.resourceId !== resourceId ||
      existing.countedQuantity !== input.countedQuantity ||
      existing.locationResourceId !== (input.locationResourceId ?? null) ||
      existing.note !== (input.note ?? "") ||
      (requestedCountedAt !== undefined &&
        existing.countedAt.getTime() !== requestedCountedAt)
    ) {
      throw new StockOperationError(
        "That Idempotency-Key was already used for a different count.",
        409,
      );
    }
    return { count: countDto(existing), replayed: true } as const;
  };

  try {
    return await db.transaction(async (transaction) => {
    if (idempotencyKey) {
      const [existing] = await transaction
        .select()
        .from(inventoryCounts)
        .where(
          and(
            eq(inventoryCounts.organizationId, organizationId),
            eq(inventoryCounts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return replay(existing);
    }

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
    if (!resource) throw new StockOperationError("Not found", 404);
    if (idempotencyKey) {
      const [existing] = await transaction
        .select()
        .from(inventoryCounts)
        .where(
          and(
            eq(inventoryCounts.organizationId, organizationId),
            eq(inventoryCounts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return replay(existing);
    }
    const [settings] = await transaction
      .select({ trackingMode: stockSettings.trackingMode })
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resourceId),
        ),
      )
      .limit(1);
    const serialized = settings?.trackingMode === "serialized";
    if (serialized && input.locationResourceId) {
      throw new StockOperationError(
        "Complete serialized counts for the whole item after reviewing its individual units.",
        409,
      );
    }
    if (serialized && input.countedQuantity !== resource.quantity) {
      throw new StockOperationError(
        `Serialized stock is currently ${resource.quantity}. Correct individual unit statuses first, then complete the review with the matching count.`,
        409,
      );
    }

    let expectedQuantity = resource.quantity;
    let locationBalanceId: string | null = null;
    if (input.locationResourceId) {
      if (input.locationResourceId === resourceId) {
        throw new StockOperationError(
          "An inventory item cannot be counted as its own location.",
          422,
        );
      }
      const [location] = await transaction
        .select({ id: resources.id })
        .from(resources)
        .innerJoin(
          inventoryTypeDefinitions,
          and(
            eq(resources.type, inventoryTypeDefinitions.key),
            eq(
              resources.organizationId,
              inventoryTypeDefinitions.organizationId,
            ),
          ),
        )
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(inventoryTypeDefinitions.organizationId, organizationId),
            eq(resources.id, input.locationResourceId),
            ne(resources.status, "archived"),
            eq(inventoryTypeDefinitions.canContain, true),
            isNull(inventoryTypeDefinitions.archivedAt),
          ),
        )
        .limit(1);
      if (!location) {
        throw new StockOperationError(
          "Choose an active inventory item configured to contain stock.",
          422,
        );
      }
      const [locationBalance] = await transaction
        .select()
        .from(stockLocationBalances)
        .where(
          and(
            eq(stockLocationBalances.organizationId, organizationId),
            eq(stockLocationBalances.resourceId, resourceId),
            eq(stockLocationBalances.locationResourceId, input.locationResourceId),
          ),
        )
        .limit(1)
        .for("update");
      expectedQuantity = locationBalance?.quantity ?? 0;
      locationBalanceId = locationBalance?.id ?? null;
    } else if (!serialized && !resource.allowNegativeStock) {
      const [{ assigned }] = await transaction
        .select({
          assigned: sql<number>`coalesce(sum(${stockLocationBalances.quantity}), 0)::int`,
        })
        .from(stockLocationBalances)
        .where(
          and(
            eq(stockLocationBalances.organizationId, organizationId),
            eq(stockLocationBalances.resourceId, resourceId),
          ),
        );
      if (input.countedQuantity < Number(assigned ?? 0)) {
        throw new StockOperationError(
          `The total count cannot be below the ${assigned} units already assigned to locations. Count a specific location instead.`,
          409,
        );
      }
    }

    const variance = input.countedQuantity - expectedQuantity;
    const balanceAfter = resource.quantity + variance;
    if (Math.abs(balanceAfter) > MAX_STOCK_QUANTITY) {
      throw new StockOperationError(
        `This count exceeds the supported stock range of -${MAX_STOCK_QUANTITY} to ${MAX_STOCK_QUANTITY}.`,
        409,
      );
    }
    if (
      violatesNegativeStockPolicy({
        allowNegativeStock: resource.allowNegativeStock,
        quantityBefore: resource.quantity,
        quantityAfter: balanceAfter,
      })
    ) {
      throw new StockOperationError("This count would make the total stock negative.", 409);
    }
    if (!input.locationResourceId && !resource.allowNegativeStock) {
      const variantAllocation = await allocatedVariantQuantity(
        transaction,
        resourceId,
      );
      assertVariantAllocationFits(
        balanceAfter,
        variantAllocation,
        (message) => new StockOperationError(message, 409),
      );
    }
    const countedAt = input.countedAt ?? new Date();
    await transaction
      .update(resources)
      .set({ quantity: balanceAfter, updatedAt: new Date() })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resourceId),
        ),
      );

    if (input.locationResourceId) {
      if (locationBalanceId) {
        await transaction
          .update(stockLocationBalances)
          .set({ quantity: input.countedQuantity, updatedAt: new Date() })
          .where(
            and(
              eq(stockLocationBalances.organizationId, organizationId),
              eq(stockLocationBalances.id, locationBalanceId),
            ),
          );
      } else if (input.countedQuantity > 0) {
        await transaction.insert(stockLocationBalances).values({
          organizationId,
          resourceId,
          locationResourceId: input.locationResourceId,
          quantity: input.countedQuantity,
        });
      }
    }

    const [movement] = await transaction
      .insert(stockMovements)
      .values({
        organizationId,
        resourceId,
        delta: variance,
        quantity: Math.abs(variance),
        balanceAfter,
        fromLocationBalanceAfter:
          input.locationResourceId && variance < 0 ? input.countedQuantity : null,
        toLocationBalanceAfter:
          input.locationResourceId && variance > 0 ? input.countedQuantity : null,
        type: "inventory-count",
        reason: "Inventory count reconciliation",
        note: input.note ?? "",
        fromLocationResourceId:
          input.locationResourceId && variance < 0 ? input.locationResourceId : null,
        toLocationResourceId:
          input.locationResourceId && variance > 0 ? input.locationResourceId : null,
        occurredAt: countedAt,
        createdBy: actor,
      })
      .returning();
    await enqueueStockMovementWebhookEvents(transaction, [movement]);
    const [count] = await transaction
      .insert(inventoryCounts)
      .values({
        organizationId,
        resourceId,
        locationResourceId: input.locationResourceId ?? null,
        expectedQuantity,
        countedQuantity: input.countedQuantity,
        variance,
        countedAt,
        note: input.note ?? "",
        movementId: movement.id,
        idempotencyKey,
        createdBy: actor,
      })
      .returning();

    const [policy] = await transaction
      .select()
      .from(inventoryCyclePolicies)
      .where(
        and(
          eq(inventoryCyclePolicies.organizationId, organizationId),
          eq(inventoryCyclePolicies.resourceId, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (policy) {
      await transaction
        .update(inventoryCyclePolicies)
        .set({
          lastCompletedAt: countedAt,
          nextDueAt: nextDate(countedAt, policy.intervalDays),
          updatedBy: actor,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventoryCyclePolicies.organizationId, organizationId),
            eq(inventoryCyclePolicies.resourceId, resourceId),
          ),
        );
    }
    return { count: countDto(count), movementId: movement.id, replayed: false };
    });
  } catch (error) {
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(inventoryCounts)
        .where(
          and(
            eq(inventoryCounts.organizationId, organizationId),
            eq(inventoryCounts.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return replay(existing);
    }
    throw error;
  }
}

export async function listDueInventoryCycles(organizationId: string) {
  const rows = await db
    .select({
      resourceId: resources.id,
      name: resources.name,
      type: resources.type,
      quantity: resources.quantity,
      intervalDays: inventoryCyclePolicies.intervalDays,
      nextDueAt: inventoryCyclePolicies.nextDueAt,
      lastCompletedAt: inventoryCyclePolicies.lastCompletedAt,
    })
    .from(inventoryCyclePolicies)
    .innerJoin(resources, eq(resources.id, inventoryCyclePolicies.resourceId))
    .where(
      and(
        eq(inventoryCyclePolicies.organizationId, organizationId),
        eq(resources.organizationId, organizationId),
        eq(inventoryCyclePolicies.enabled, true),
        lte(inventoryCyclePolicies.nextDueAt, new Date()),
      ),
    )
    .orderBy(asc(inventoryCyclePolicies.nextDueAt));
  return rows.map((row) => ({
    ...row,
    nextDueAt: row.nextDueAt.toISOString(),
    lastCompletedAt: row.lastCompletedAt?.toISOString() ?? null,
  }));
}
