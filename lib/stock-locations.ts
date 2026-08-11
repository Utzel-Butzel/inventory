import "server-only";

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  inventoryTypeDefinitions,
  resources,
  stockLocationBalances,
  stockSettings,
  stockUnits,
} from "@/db/schema";
import { db } from "@/lib/db";

export async function listStockLocationResources() {
  return db
    .select({
      id: resources.id,
      name: resources.name,
      type: resources.type,
      status: resources.status,
    })
    .from(resources)
    .innerJoin(
      inventoryTypeDefinitions,
      eq(resources.type, inventoryTypeDefinitions.key),
    )
    .where(
      and(
        eq(inventoryTypeDefinitions.canContain, true),
        isNull(inventoryTypeDefinitions.archivedAt),
        ne(resources.status, "archived"),
      ),
    )
    .orderBy(asc(resources.name));
}

export async function getStockLocationBreakdown(resourceId: string) {
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
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

    const mode = resource.trackingMode ?? "bulk";
    if (mode === "serialized") {
      const rows = await transaction
        .select({
          locationResourceId: stockUnits.locationResourceId,
          quantity: sql<number>`count(*)::int`,
        })
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.resourceId, resourceId),
            eq(stockUnits.status, "available"),
          ),
        )
        .groupBy(stockUnits.locationResourceId);
      const locationIds = rows.flatMap((row) =>
        row.locationResourceId ? [row.locationResourceId] : [],
      );
      const locations = locationIds.length
        ? await transaction
            .select({
              id: resources.id,
              name: resources.name,
              type: resources.type,
            })
            .from(resources)
            .where(inArray(resources.id, locationIds))
        : [];
      const names = new Map(locations.map((location) => [location.id, location]));
      return {
        resource,
        trackingMode: mode,
        assignedQuantity: rows.reduce(
          (total, row) =>
            total + (row.locationResourceId ? Number(row.quantity) : 0),
          0,
        ),
        unassignedQuantity: Number(
          rows.find((row) => row.locationResourceId === null)?.quantity ?? 0,
        ),
        locations: rows.flatMap((row) => {
          if (!row.locationResourceId) return [];
          return [
            {
              locationResourceId: row.locationResourceId,
              name: names.get(row.locationResourceId)?.name ?? "Unknown location",
              type: names.get(row.locationResourceId)?.type ?? "other",
              quantity: Number(row.quantity),
            },
          ];
        }),
      };
    }

    const rows = await transaction
      .select({
        locationResourceId: stockLocationBalances.locationResourceId,
        quantity: stockLocationBalances.quantity,
        name: resources.name,
        type: resources.type,
      })
      .from(stockLocationBalances)
      .innerJoin(
        resources,
        eq(resources.id, stockLocationBalances.locationResourceId),
      )
      .where(eq(stockLocationBalances.resourceId, resourceId))
      .orderBy(asc(resources.name));
    const assignedQuantity = rows.reduce((total, row) => total + row.quantity, 0);
    return {
      resource,
      trackingMode: mode,
      assignedQuantity,
      unassignedQuantity: resource.quantity - assignedQuantity,
      locations: rows,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
