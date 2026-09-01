import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { resources, stockMovements, stockSettings } from "@/db/schema";
import { db } from "@/lib/db";

export type ConnectionStockStatus = "out" | "low" | "healthy";

export type ConnectionStockSummary = {
  resourceId: string;
  quantity: number;
  minimumStock: number;
  unitName: string;
  status: ConnectionStockStatus;
  priceFlow: ConnectionPriceFlow;
};

export type ConnectionPriceFlowDirection = {
  quantity: number;
  amountCents: number;
  movementCount: number;
  pricedMovementCount: number;
};

export type ConnectionPriceFlow = {
  currency: string;
  inbound: ConnectionPriceFlowDirection;
  outbound: ConnectionPriceFlowDirection;
  neutral: ConnectionPriceFlowDirection;
  unpricedMovementCount: number;
  estimated: boolean;
};

export async function getConnectionStockSummaries(
  organizationId: string,
  resourceIds: readonly string[],
): Promise<ConnectionStockSummary[]> {
  const ids = Array.from(new Set(resourceIds));
  if (!ids.length) return [];

  const [rows, movementRows] = await Promise.all([
    db
      .select({
        resourceId: resources.id,
        quantity: resources.quantity,
        currency: resources.currency,
        minimumStock: stockSettings.minimumStock,
        unitName: stockSettings.unitName,
      })
      .from(resources)
      .leftJoin(
        stockSettings,
        and(
          eq(stockSettings.organizationId, resources.organizationId),
          eq(stockSettings.resourceId, resources.id),
        ),
      )
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, ids),
        ),
      ),
    db
      .select({
        resourceId: stockMovements.resourceId,
        inboundQuantity: sql<number>`coalesce(sum(case when ${stockMovements.delta} > 0 then ${stockMovements.delta} else 0 end), 0)::float8`,
        inboundAmountCents: sql<number>`coalesce(sum(case when ${stockMovements.delta} > 0 then coalesce(${stockMovements.totalPriceCents}, ${stockMovements.costCents}, 0) else 0 end), 0)::float8`,
        inboundMovementCount: sql<number>`count(*) filter (where ${stockMovements.delta} > 0)::int`,
        inboundPricedMovementCount: sql<number>`count(*) filter (where ${stockMovements.delta} > 0 and (${stockMovements.totalPriceCents} is not null or ${stockMovements.costCents} is not null))::int`,
        outboundQuantity: sql<number>`coalesce(sum(case when ${stockMovements.delta} < 0 then -${stockMovements.delta} else 0 end), 0)::float8`,
        outboundAmountCents: sql<number>`coalesce(sum(case when ${stockMovements.delta} < 0 then coalesce(${stockMovements.totalPriceCents}, ${stockMovements.costCents}, 0) else 0 end), 0)::float8`,
        outboundMovementCount: sql<number>`count(*) filter (where ${stockMovements.delta} < 0)::int`,
        outboundPricedMovementCount: sql<number>`count(*) filter (where ${stockMovements.delta} < 0 and (${stockMovements.totalPriceCents} is not null or ${stockMovements.costCents} is not null))::int`,
        neutralQuantity: sql<number>`coalesce(sum(case when ${stockMovements.delta} = 0 then ${stockMovements.quantity} else 0 end), 0)::float8`,
        neutralAmountCents: sql<number>`coalesce(sum(case when ${stockMovements.delta} = 0 then coalesce(${stockMovements.totalPriceCents}, ${stockMovements.costCents}, 0) else 0 end), 0)::float8`,
        neutralMovementCount: sql<number>`count(*) filter (where ${stockMovements.delta} = 0)::int`,
        neutralPricedMovementCount: sql<number>`count(*) filter (where ${stockMovements.delta} = 0 and (${stockMovements.totalPriceCents} is not null or ${stockMovements.costCents} is not null))::int`,
        unpricedMovementCount: sql<number>`count(*) filter (where (${stockMovements.delta} <> 0 or ${stockMovements.quantity} > 0) and ${stockMovements.totalPriceCents} is null and ${stockMovements.costCents} is null)::int`,
        estimated: sql<boolean>`coalesce(bool_or(${stockMovements.totalPriceCents} is null and ${stockMovements.costCents} is not null and ${stockMovements.costEstimated}), false)`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          inArray(stockMovements.resourceId, ids),
        ),
      )
      .groupBy(stockMovements.resourceId),
  ]);

  const movementByResource = new Map(
    movementRows.map((row) => [row.resourceId, row]),
  );

  const direction = (
    quantity: number | null | undefined,
    amountCents: number | null | undefined,
    movementCount: number | null | undefined,
    pricedMovementCount: number | null | undefined,
  ): ConnectionPriceFlowDirection => ({
    quantity: Number(quantity ?? 0),
    amountCents: Number(amountCents ?? 0),
    movementCount: Number(movementCount ?? 0),
    pricedMovementCount: Number(pricedMovementCount ?? 0),
  });

  return rows.map((row) => {
    const minimumStock = row.minimumStock ?? 0;
    const movement = movementByResource.get(row.resourceId);
    const status: ConnectionStockStatus =
      row.quantity <= 0
        ? "out"
        : minimumStock > 0 && row.quantity <= minimumStock
          ? "low"
          : "healthy";
    return {
      resourceId: row.resourceId,
      quantity: row.quantity,
      minimumStock,
      unitName: row.unitName ?? "unit",
      status,
      priceFlow: {
        currency: row.currency,
        inbound: direction(
          movement?.inboundQuantity,
          movement?.inboundAmountCents,
          movement?.inboundMovementCount,
          movement?.inboundPricedMovementCount,
        ),
        outbound: direction(
          movement?.outboundQuantity,
          movement?.outboundAmountCents,
          movement?.outboundMovementCount,
          movement?.outboundPricedMovementCount,
        ),
        neutral: direction(
          movement?.neutralQuantity,
          movement?.neutralAmountCents,
          movement?.neutralMovementCount,
          movement?.neutralPricedMovementCount,
        ),
        unpricedMovementCount: Number(movement?.unpricedMovementCount ?? 0),
        estimated: Boolean(movement?.estimated),
      },
    };
  });
}
