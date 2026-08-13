import "server-only";

import { and, asc, desc, eq, isNull, lte, ne, sql } from "drizzle-orm";

import {
  inventoryCounts,
  inventoryCyclePolicies,
  inventoryTypeDefinitions,
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

export async function getInventoryCycle(resourceId: string) {
  const [resource] = await db
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
      trackingMode: stockSettings.trackingMode,
    })
    .from(resources)
    .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
    .where(eq(resources.id, resourceId))
    .limit(1);
  if (!resource) return null;
  const [policyRows, history] = await Promise.all([
    db
      .select()
      .from(inventoryCyclePolicies)
      .where(eq(inventoryCyclePolicies.resourceId, resourceId))
      .limit(1),
    db
      .select()
      .from(inventoryCounts)
      .where(eq(inventoryCounts.resourceId, resourceId))
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
  resourceId: string,
  input: { intervalDays: number; enabled: boolean },
  actor: string,
) {
  const [resource] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);
  if (!resource) throw new StockOperationError("Not found", 404);
  const now = new Date();
  const [saved] = await db
    .insert(inventoryCyclePolicies)
    .values({
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
        .where(eq(inventoryCounts.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) return replay(existing);
    }

    const [resource] = await transaction
      .select({
        id: resources.id,
        quantity: resources.quantity,
      })
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1)
      .for("update");
    if (!resource) throw new StockOperationError("Not found", 404);
    if (idempotencyKey) {
      const [existing] = await transaction
        .select()
        .from(inventoryCounts)
        .where(eq(inventoryCounts.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) return replay(existing);
    }
    const [settings] = await transaction
      .select({ trackingMode: stockSettings.trackingMode })
      .from(stockSettings)
      .where(eq(stockSettings.resourceId, resourceId))
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
          eq(resources.type, inventoryTypeDefinitions.key),
        )
        .where(
          and(
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
            eq(stockLocationBalances.resourceId, resourceId),
            eq(stockLocationBalances.locationResourceId, input.locationResourceId),
          ),
        )
        .limit(1)
        .for("update");
      expectedQuantity = locationBalance?.quantity ?? 0;
      locationBalanceId = locationBalance?.id ?? null;
    } else if (!serialized) {
      const [{ assigned }] = await transaction
        .select({
          assigned: sql<number>`coalesce(sum(${stockLocationBalances.quantity}), 0)::int`,
        })
        .from(stockLocationBalances)
        .where(eq(stockLocationBalances.resourceId, resourceId));
      if (input.countedQuantity < Number(assigned ?? 0)) {
        throw new StockOperationError(
          `The total count cannot be below the ${assigned} units already assigned to locations. Count a specific location instead.`,
          409,
        );
      }
    }

    const variance = input.countedQuantity - expectedQuantity;
    const balanceAfter = resource.quantity + variance;
    if (balanceAfter < 0) {
      throw new StockOperationError("This count would make the total stock negative.", 409);
    }
    if (!input.locationResourceId) {
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
      .where(eq(resources.id, resourceId));

    if (input.locationResourceId) {
      if (locationBalanceId) {
        await transaction
          .update(stockLocationBalances)
          .set({ quantity: input.countedQuantity, updatedAt: new Date() })
          .where(eq(stockLocationBalances.id, locationBalanceId));
      } else if (input.countedQuantity > 0) {
        await transaction.insert(stockLocationBalances).values({
          resourceId,
          locationResourceId: input.locationResourceId,
          quantity: input.countedQuantity,
        });
      }
    }

    const [movement] = await transaction
      .insert(stockMovements)
      .values({
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
      .where(eq(inventoryCyclePolicies.resourceId, resourceId))
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
        .where(eq(inventoryCyclePolicies.resourceId, resourceId));
    }
    return { count: countDto(count), movementId: movement.id, replayed: false };
    });
  } catch (error) {
    if (idempotencyKey) {
      const [existing] = await db
        .select()
        .from(inventoryCounts)
        .where(eq(inventoryCounts.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) return replay(existing);
    }
    throw error;
  }
}

export async function listDueInventoryCycles() {
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
