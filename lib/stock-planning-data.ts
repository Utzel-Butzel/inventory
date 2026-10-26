import "server-only";

import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { orderLines, orders, resources, stockMovements, stockSettings } from "@/db/schema";
import { db } from "@/lib/db";
import { DAY_MS, type PlanningInput, type PlanningReceipt } from "@/lib/stock-planning";
import { reconstructStockHistory } from "@/lib/stock-planning-chart";

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
    const ageDays = sql<number>`floor(extract(epoch from (${now.toISOString()}::timestamptz - ${stockMovements.occurredAt})) / 86400)::int`;
    const [usage, incoming, dailyMovements] = await Promise.all([
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
      transaction.select({
        resourceId: stockMovements.resourceId, ageDays,
        delta: sql<number>`sum(${stockMovements.delta})::float8`,
      }).from(stockMovements)
        .innerJoin(stockSettings, and(eq(stockSettings.resourceId, stockMovements.resourceId), eq(stockSettings.organizationId, organizationId)))
        .where(and(eq(stockMovements.organizationId, organizationId), gte(stockMovements.occurredAt, new Date(since)), lte(stockMovements.occurredAt, now)))
        .groupBy(sql`1, 2`),
    ]);
    const usageById = new Map(usage.map((row) => [row.resourceId, row]));
    const receiptsById = new Map<string, PlanningReceipt[]>();
    const movementsById = new Map<string, { ageDays: number; delta: number }[]>();
    for (const row of dailyMovements) {
      const movements = movementsById.get(row.resourceId) ?? [];
      movements.push({ ageDays: Number(row.ageDays), delta: Number(row.delta) });
      movementsById.set(row.resourceId, movements);
    }
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
        const observedDays = Math.max(0, Math.min(90, (now.getTime() - start) / DAY_MS));
        return {
          ...item, observedDays: Math.max(1, observedDays),
          history: reconstructStockHistory(item.quantity, history ? observedDays : 0, movementsById.get(item.resourceId) ?? []),
          consumed: Number(history?.consumed ?? 0), recentConsumed: Number(history?.recentConsumed ?? 0),
          demandDays: Number(history?.demandDays ?? 0), receipts: receiptsById.get(item.resourceId) ?? [],
        };
      }),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
