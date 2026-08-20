import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { resources, stockSettings } from "@/db/schema";
import { db } from "@/lib/db";

export type ConnectionStockStatus = "out" | "low" | "healthy";

export type ConnectionStockSummary = {
  resourceId: string;
  quantity: number;
  minimumStock: number;
  unitName: string;
  status: ConnectionStockStatus;
};

export async function getConnectionStockSummaries(
  organizationId: string,
  resourceIds: readonly string[],
): Promise<ConnectionStockSummary[]> {
  const ids = Array.from(new Set(resourceIds));
  if (!ids.length) return [];

  const rows = await db
    .select({
      resourceId: resources.id,
      quantity: resources.quantity,
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
    );

  return rows.map((row) => {
    const minimumStock = row.minimumStock ?? 0;
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
    };
  });
}
