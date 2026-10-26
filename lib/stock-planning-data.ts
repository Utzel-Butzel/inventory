import "server-only";

import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { orderLines, orders, resources, stockMovements, stockSettings } from "@/db/schema";
import { db } from "@/lib/db";
import { DAY_MS, type PlanningInput, type PlanningReceipt } from "@/lib/stock-planning";

export async function getStockPlanningData(organizationId: string) {
  return db.transaction(async (transaction) => {
    const now = new Date();
    const since = new Date(now.getTime() - 90 * DAY_MS).toISOString();
    const recentSince = new Date(now.getTime() - 30 * DAY_MS).toISOString();
    const items = await transaction.select({
      resourceId: resources.id, name: resources.name, subtitle: resources.subtitle,
      sku: resources.sku, quantity: resources.quantity, createdAt: resources.createdAt,
      unitName: stockSettings.unitName, minimumStock: stockSettings.minimumStock,
      reorderQuantity: stockSettings.reorderQuantity, leadTimeDays: stockSettings.leadTimeDays,
      purchaseUnitName: stockSettings.purchaseUnitName, purchaseUnitFactor: stockSettings.purchaseUnitFactor,
    }).from(stockSettings).innerJoin(resources, and(
      eq(resources.id, stockSettings.resourceId), eq(resources.organizationId, stockSettings.organizationId),
    )).where(and(eq(stockSettings.organizationId, organizationId), ne(resources.status, "archived")));

    // Only real demand counts: issues, production consumption and waste. Inventory
    // corrections, transfers, reservations and temporary loans are not consumption.
    // A reserved serialized sale has delta 0 on issue, but still has quantity 1.
    const demand = sql`case when ${stockMovements.type} in ('issue', 'waste', 'assembly-consumption')
      and (${orders.type} is null or ${orders.type} <> 'loan')
      then greatest(-${stockMovements.delta}, ${stockMovements.quantity}, 0) else 0 end`;
    const [usage, incoming] = await Promise.all([
      transaction.select({
        resourceId: stockMovements.resourceId,
        firstMovementAt: sql<string>`min(${stockMovements.occurredAt})`,
        consumed: sql<number>`coalesce(sum(case when ${stockMovements.occurredAt} >= ${since} then ${demand} else 0 end), 0)::float8`,
        recentConsumed: sql<number>`coalesce(sum(case when ${stockMovements.occurredAt} >= ${recentSince} then ${demand} else 0 end), 0)::float8`,
        demandDays: sql<number>`count(distinct ((${stockMovements.occurredAt} at time zone 'UTC')::date)) filter (where ${stockMovements.occurredAt} >= ${since} and ${demand} > 0)::int`,
      }).from(stockMovements)
        .leftJoin(orderLines, and(eq(orderLines.id, stockMovements.orderLineId), eq(orderLines.organizationId, organizationId)))
        .leftJoin(orders, and(eq(orders.id, orderLines.orderId), eq(orders.organizationId, organizationId)))
        .where(and(eq(stockMovements.organizationId, organizationId), lte(stockMovements.occurredAt, now)))
        .groupBy(stockMovements.resourceId),
      transaction.select({
        resourceId: orderLines.resourceId,
        quantity: sql<number>`${orderLines.orderedQuantity} - ${orderLines.fulfilledQuantity}`,
        expectedAt: sql<string | null>`coalesce(${orderLines.expectedAt}, ${orders.expectedAt})`,
      }).from(orderLines).innerJoin(orders, and(eq(orders.id, orderLines.orderId), eq(orders.organizationId, organizationId)))
        .where(and(eq(orderLines.organizationId, organizationId), eq(orders.type, "purchase"),
          inArray(orders.status, ["ordered", "partially-received"]),
          gte(sql`${orderLines.orderedQuantity} - ${orderLines.fulfilledQuantity}`, 1))),
    ]);
    const usageById = new Map(usage.map((row) => [row.resourceId, row]));
    const receiptsById = new Map<string, PlanningReceipt[]>();
    for (const row of incoming) {
      const receipts = receiptsById.get(row.resourceId) ?? [];
      receipts.push({ quantity: Number(row.quantity), expectedAt: row.expectedAt ? new Date(row.expectedAt).toISOString() : null });
      receiptsById.set(row.resourceId, receipts);
    }
    return {
      generatedAt: now.toISOString(),
      items: items.map(({ createdAt, ...item }): PlanningInput => {
        const history = usageById.get(item.resourceId);
        // Start with the first actual stock observation, not an item's catalog age.
        const start = history ? new Date(history.firstMovementAt).getTime() : createdAt.getTime();
        return {
          ...item, observedDays: Math.max(1, Math.min(90, (now.getTime() - start) / DAY_MS)),
          consumed: Number(history?.consumed ?? 0), recentConsumed: Number(history?.recentConsumed ?? 0),
          demandDays: Number(history?.demandDays ?? 0), receipts: receiptsById.get(item.resourceId) ?? [],
        };
      }),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
