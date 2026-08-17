import "server-only";

import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import {
  inventoryTypeDefinitions,
  relationTypeDefinitions,
  resourceRelations,
  resources,
  stockLocationBalances,
  stockUnits,
  type ResourceMapCoordinate,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  polygonCoversPoint,
  spatialFeaturePoints,
} from "@/lib/spatial-containment";

const RELATION_GRAPH_LOCK_ID = 7_214_002;

export class InventoryStructureError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 422 = 422,
  ) {
    super(message);
    this.name = "InventoryStructureError";
  }
}

export function inventoryStructureHttpError(error: unknown, fallback: string) {
  if (error instanceof InventoryStructureError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("inventory_type_definitions_pkey") ||
    message.includes("relation_type_definitions_pkey")
  ) {
    return { status: 409 as const, message: "That key is already in use." };
  }
  if (message.includes("resources_type_inventory_type_definitions")) {
    return { status: 422 as const, message: "Choose an active inventory type." };
  }
  return { status: 500 as const, message: fallback };
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

const typeDto = (row: typeof inventoryTypeDefinitions.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: iso(row.archivedAt),
});

const relationTypeDto = (row: typeof relationTypeDefinitions.$inferSelect) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  archivedAt: iso(row.archivedAt),
});

export async function listInventoryTypes(
  organizationId: string,
  includeArchived = false,
) {
  const rows = await db
    .select()
    .from(inventoryTypeDefinitions)
    .where(
      and(
        eq(inventoryTypeDefinitions.organizationId, organizationId),
        ...(includeArchived
          ? []
          : [isNull(inventoryTypeDefinitions.archivedAt)]),
      ),
    )
    .orderBy(
      asc(inventoryTypeDefinitions.position),
      asc(inventoryTypeDefinitions.label),
    );
  return rows.map(typeDto);
}

export async function assertActiveInventoryType(
  organizationId: string,
  key: string,
) {
  const [row] = await db
    .select({ key: inventoryTypeDefinitions.key })
    .from(inventoryTypeDefinitions)
    .where(
      and(
        eq(inventoryTypeDefinitions.organizationId, organizationId),
        eq(inventoryTypeDefinitions.key, key),
        isNull(inventoryTypeDefinitions.archivedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new InventoryStructureError("Choose an active inventory type.", 422);
  }
  return row.key;
}

export async function createInventoryType(
  organizationId: string,
  input: {
    key: string;
    label: string;
    description: string;
    color: string;
    icon: string;
    canContain: boolean;
    spatialContainment: boolean;
    position: number;
  },
  actor: string,
) {
  if (input.spatialContainment && !input.canContain) {
    throw new InventoryStructureError(
      "Spatial containment requires that this type can contain other items.",
    );
  }
  const [created] = await db
    .insert(inventoryTypeDefinitions)
    .values({
      ...input,
      organizationId,
      isSystem: false,
      createdBy: actor,
      updatedBy: actor,
    })
    .returning();
  return typeDto(created);
}

export async function updateInventoryType(
  organizationId: string,
  key: string,
  patch: Partial<{
    label: string;
    description: string;
    color: string;
    icon: string;
    canContain: boolean;
    spatialContainment: boolean;
    position: number;
    archived: boolean;
  }>,
  actor: string,
) {
  const [current] = await db
    .select()
    .from(inventoryTypeDefinitions)
    .where(
      and(
        eq(inventoryTypeDefinitions.organizationId, organizationId),
        eq(inventoryTypeDefinitions.key, key),
      ),
    )
    .limit(1);
  if (!current) throw new InventoryStructureError("Inventory type not found.", 404);

  const canContain = patch.canContain ?? current.canContain;
  const spatialContainment = patch.spatialContainment ?? current.spatialContainment;
  if (spatialContainment && !canContain) {
    throw new InventoryStructureError(
      "Spatial containment requires that this type can contain other items.",
    );
  }
  if (patch.archived && (key === "object" || key === "other")) {
    throw new InventoryStructureError(
      key === "object"
        ? "The default inventory type cannot be archived."
        : "The fallback type cannot be archived.",
      409,
    );
  }
  if (patch.archived && !current.archivedAt) {
    const [usedByResource] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.type, key),
        ),
      )
      .limit(1);
    if (usedByResource) {
      throw new InventoryStructureError(
        "Move existing inventory items to another type before archiving this type.",
        409,
      );
    }
  }
  if (current.canContain && !canContain) {
    const [manualChildren, bulkPlacements, unitPlacements] = await Promise.all([
      db
        .select({ id: resourceRelations.id })
        .from(resourceRelations)
        .innerJoin(
          resources,
          eq(resources.id, resourceRelations.sourceResourceId),
        )
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.type, key),
            eq(resourceRelations.relationTypeKey, "contains"),
            eq(resourceRelations.origin, "manual"),
          ),
        )
        .limit(1),
      db
        .select({ id: stockLocationBalances.id })
        .from(stockLocationBalances)
        .innerJoin(
          resources,
          eq(resources.id, stockLocationBalances.locationResourceId),
        )
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.type, key),
            gt(stockLocationBalances.quantity, 0),
          ),
        )
        .limit(1),
      db
        .select({ id: stockUnits.id })
        .from(stockUnits)
        .innerJoin(resources, eq(resources.id, stockUnits.locationResourceId))
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.type, key),
          ),
        )
        .limit(1),
    ]);
    const [manualChild] = manualChildren;
    if (manualChild) {
      throw new InventoryStructureError(
        "Move or remove manually contained items before disabling containment for this type.",
        409,
      );
    }
    if (bulkPlacements[0] || unitPlacements[0]) {
      throw new InventoryStructureError(
        "Move stock out of inventory locations of this type before disabling containment.",
        409,
      );
    }
  }
  const [updated] = await db
    .update(inventoryTypeDefinitions)
    .set({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.canContain !== undefined ? { canContain: patch.canContain } : {}),
      ...(patch.spatialContainment !== undefined
        ? { spatialContainment: patch.spatialContainment }
        : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      ...(patch.archived !== undefined
        ? { archivedAt: patch.archived ? new Date() : null }
        : {}),
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryTypeDefinitions.organizationId, organizationId),
        eq(inventoryTypeDefinitions.key, key),
      ),
    )
    .returning();
  await synchronizeSpatialContainment(organizationId, actor);
  return typeDto(updated);
}

export async function listRelationTypes(
  organizationId: string,
  includeArchived = false,
) {
  const rows = await db
    .select()
    .from(relationTypeDefinitions)
    .where(
      and(
        eq(relationTypeDefinitions.organizationId, organizationId),
        ...(includeArchived
          ? []
          : [isNull(relationTypeDefinitions.archivedAt)]),
      ),
    )
    .orderBy(
      asc(relationTypeDefinitions.position),
      asc(relationTypeDefinitions.label),
    );
  return rows.map(relationTypeDto);
}

export async function createRelationType(
  organizationId: string,
  input: {
    key: string;
    label: string;
    inverseLabel: string;
    description: string;
    allowManual: boolean;
    position: number;
  },
  actor: string,
) {
  const [created] = await db
    .insert(relationTypeDefinitions)
    .values({
      ...input,
      organizationId,
      spatial: false,
      isSystem: false,
      createdBy: actor,
      updatedBy: actor,
    })
    .returning();
  return relationTypeDto(created);
}

export async function updateRelationType(
  organizationId: string,
  key: string,
  patch: Partial<{
    label: string;
    inverseLabel: string;
    description: string;
    allowManual: boolean;
    position: number;
    archived: boolean;
  }>,
  actor: string,
) {
  const [current] = await db
    .select()
    .from(relationTypeDefinitions)
    .where(
      and(
        eq(relationTypeDefinitions.organizationId, organizationId),
        eq(relationTypeDefinitions.key, key),
      ),
    )
    .limit(1);
  if (!current) throw new InventoryStructureError("Relationship type not found.", 404);
  if (current.isSystem && patch.archived) {
    throw new InventoryStructureError(
      "Built-in relationship types cannot be archived.",
      409,
    );
  }
  if (current.key === "variant_of" && patch.allowManual === true) {
    throw new InventoryStructureError(
      "Variant-family links are managed from the primary item's variant panel.",
      409,
    );
  }
  const [updated] = await db
    .update(relationTypeDefinitions)
    .set({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.inverseLabel !== undefined
        ? { inverseLabel: patch.inverseLabel }
        : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.allowManual !== undefined ? { allowManual: patch.allowManual } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      ...(patch.archived !== undefined
        ? { archivedAt: patch.archived ? new Date() : null }
        : {}),
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(relationTypeDefinitions.organizationId, organizationId),
        eq(relationTypeDefinitions.key, key),
      ),
    )
    .returning();
  return relationTypeDto(updated);
}

export async function listResourceRelations(
  organizationId: string,
  resourceId: string,
) {
  const rows = await db
    .select()
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.organizationId, organizationId),
        or(
          eq(resourceRelations.sourceResourceId, resourceId),
          eq(resourceRelations.targetResourceId, resourceId),
        ),
      ),
    )
    .orderBy(asc(resourceRelations.createdAt));
  const ids = Array.from(
    new Set(
      rows.flatMap((row) => [row.sourceResourceId, row.targetResourceId]),
    ),
  );
  const [resourceRows, relationTypes] = await Promise.all([
    ids.length
      ? db
          .select({
            id: resources.id,
            name: resources.name,
            type: resources.type,
            status: resources.status,
          })
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              inArray(resources.id, ids),
            ),
          )
      : Promise.resolve([]),
    listRelationTypes(organizationId, true),
  ]);
  const resourcesById = new Map(resourceRows.map((row) => [row.id, row]));
  const relationTypesByKey = new Map(
    relationTypes.map((relationType) => [relationType.key, relationType]),
  );
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    source: resourcesById.get(row.sourceResourceId) ?? null,
    target: resourcesById.get(row.targetResourceId) ?? null,
    relationType: relationTypesByKey.get(row.relationTypeKey) ?? null,
  }));
}

function graphWouldCycle(
  edges: Array<{ sourceResourceId: string; targetResourceId: string }>,
  sourceResourceId: string,
  targetResourceId: string,
) {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of [...edges, { sourceResourceId, targetResourceId }]) {
    const targets = adjacency.get(edge.sourceResourceId) ?? new Set<string>();
    targets.add(edge.targetResourceId);
    adjacency.set(edge.sourceResourceId, targets);
  }
  const pending = [targetResourceId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === sourceResourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export async function createResourceRelation(
  organizationId: string,
  input: {
    sourceResourceId: string;
    targetResourceId: string;
    relationTypeKey: string;
  },
  actor: string,
) {
  if (input.sourceResourceId === input.targetResourceId) {
    throw new InventoryStructureError("An item cannot contain or relate to itself.");
  }
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${RELATION_GRAPH_LOCK_ID})`,
    );
    const [relationType] = await transaction
      .select()
      .from(relationTypeDefinitions)
      .where(
        and(
          eq(relationTypeDefinitions.organizationId, organizationId),
          eq(relationTypeDefinitions.key, input.relationTypeKey),
          isNull(relationTypeDefinitions.archivedAt),
        ),
      )
      .limit(1);
    if (!relationType || !relationType.allowManual) {
      throw new InventoryStructureError(
        "Choose a relationship type that allows manual assignments.",
      );
    }
    const endpoints = await transaction
      .select({
        id: resources.id,
        type: resources.type,
      })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, [input.sourceResourceId, input.targetResourceId]),
        ),
      );
    if (endpoints.length !== 2) {
      throw new InventoryStructureError("One of the inventory items was not found.", 404);
    }
    if (input.relationTypeKey === "contains") {
      const source = endpoints.find((item) => item.id === input.sourceResourceId)!;
      const [sourceType] = await transaction
        .select({ canContain: inventoryTypeDefinitions.canContain })
        .from(inventoryTypeDefinitions)
        .where(
          and(
            eq(inventoryTypeDefinitions.organizationId, organizationId),
            eq(inventoryTypeDefinitions.key, source.type),
          ),
        )
        .limit(1);
      if (!sourceType?.canContain) {
        throw new InventoryStructureError(
          "The selected parent type is not configured to contain other items.",
        );
      }
      const edges = await transaction
        .select({
          sourceResourceId: resourceRelations.sourceResourceId,
          targetResourceId: resourceRelations.targetResourceId,
        })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, organizationId),
            eq(resourceRelations.relationTypeKey, "contains"),
          ),
        );
      if (
        graphWouldCycle(
          edges,
          input.sourceResourceId,
          input.targetResourceId,
        )
      ) {
        throw new InventoryStructureError(
          "This placement would create a circular containment hierarchy.",
          409,
        );
      }
    }

    const [existing] = await transaction
      .select()
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.sourceResourceId, input.sourceResourceId),
          eq(resourceRelations.targetResourceId, input.targetResourceId),
          eq(resourceRelations.relationTypeKey, input.relationTypeKey),
          eq(resourceRelations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.origin === "manual") return existing;
      const [pinned] = await transaction
        .update(resourceRelations)
        .set({ origin: "manual", createdBy: actor })
        .where(eq(resourceRelations.id, existing.id))
        .returning();
      return pinned;
    }
    const [created] = await transaction
      .insert(resourceRelations)
      .values({
        ...input,
        organizationId,
        origin: "manual",
        createdBy: actor,
      })
      .returning();
    return created;
  });
}

export async function deleteManualResourceRelation(
  organizationId: string,
  relationId: string,
  resourceId: string,
  actor: string,
) {
  const [relation] = await db
    .select({ relationTypeKey: resourceRelations.relationTypeKey })
    .from(resourceRelations)
    .where(
      and(
        eq(resourceRelations.id, relationId),
        eq(resourceRelations.organizationId, organizationId),
        or(
          eq(resourceRelations.sourceResourceId, resourceId),
          eq(resourceRelations.targetResourceId, resourceId),
        ),
      ),
    )
    .limit(1);
  if (relation?.relationTypeKey === "variant_of") {
    throw new InventoryStructureError(
      "Variant-family links are managed from the primary item's variant panel.",
      409,
    );
  }
  const [deleted] = await db
    .delete(resourceRelations)
    .where(
      and(
        eq(resourceRelations.id, relationId),
        eq(resourceRelations.organizationId, organizationId),
        eq(resourceRelations.origin, "manual"),
        or(
          eq(resourceRelations.sourceResourceId, resourceId),
          eq(resourceRelations.targetResourceId, resourceId),
        ),
      ),
    )
    .returning();
  if (!deleted) {
    throw new InventoryStructureError(
      "Only a manual relationship can be removed here.",
      404,
    );
  }
  await synchronizeSpatialContainment(organizationId, actor);
  return deleted;
}

function polygonArea(polygon: ResourceMapCoordinate[]) {
  let area = 0;
  for (let index = 0; index < polygon.length - 1; index += 1) {
    const current = polygon[index]!;
    const next = polygon[index + 1]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area / 2);
}

export async function synchronizeSpatialContainment(
  organizationId: string,
  actor = "system:spatial",
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${RELATION_GRAPH_LOCK_ID})`,
    );
    const [resourceRows, containerTypes, manualContains] = await Promise.all([
      transaction
        .select({
          id: resources.id,
          type: resources.type,
          mapFeatures: resources.mapFeatures,
          gpsLatitude: resources.gpsLatitude,
          gpsLongitude: resources.gpsLongitude,
        })
        .from(resources)
        .where(eq(resources.organizationId, organizationId)),
      transaction
        .select({ key: inventoryTypeDefinitions.key })
        .from(inventoryTypeDefinitions)
        .where(
          and(
            eq(inventoryTypeDefinitions.organizationId, organizationId),
            eq(inventoryTypeDefinitions.canContain, true),
            eq(inventoryTypeDefinitions.spatialContainment, true),
            isNull(inventoryTypeDefinitions.archivedAt),
          ),
        ),
      transaction
        .select({
          sourceResourceId: resourceRelations.sourceResourceId,
          targetResourceId: resourceRelations.targetResourceId,
        })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, organizationId),
            eq(resourceRelations.relationTypeKey, "contains"),
            eq(resourceRelations.origin, "manual"),
          ),
        ),
    ]);
    const containerTypeKeys = new Set(containerTypes.map((item) => item.key));
    const manuallyPlaced = new Set(
      manualContains.map((item) => item.targetResourceId),
    );
    const candidates = resourceRows.flatMap((container) => {
      if (!containerTypeKeys.has(container.type)) return [];
      return container.mapFeatures.flatMap((feature) =>
        feature.type === "polygon"
          ? [{
              resourceId: container.id,
              featureId: feature.id,
              polygon: feature.coordinates,
              area: polygonArea(feature.coordinates),
            }]
          : [],
      );
    });
    const nextEdges: Array<{
      organizationId: string;
      sourceResourceId: string;
      targetResourceId: string;
      relationTypeKey: string;
      origin: "spatial";
      sourceFeatureId: string;
      targetFeatureId: string | null;
      createdBy: string;
    }> = [];
    for (const target of resourceRows) {
      if (manuallyPlaced.has(target.id)) continue;
      const points = spatialFeaturePoints(target);
      if (!points.length) continue;
      const containing = candidates
        .filter(
          (candidate) =>
            candidate.resourceId !== target.id &&
            points.every(({ point }) => polygonCoversPoint(candidate.polygon, point)),
        )
        .sort(
          (left, right) =>
            left.area - right.area ||
            left.resourceId.localeCompare(right.resourceId),
        )
        .find(
          (candidate) =>
            !graphWouldCycle(
              [
                ...manualContains,
                ...nextEdges.map((edge) => ({
                  sourceResourceId: edge.sourceResourceId,
                  targetResourceId: edge.targetResourceId,
                })),
              ],
              candidate.resourceId,
              target.id,
            ),
        );
      if (!containing) continue;
      nextEdges.push({
        organizationId,
        sourceResourceId: containing.resourceId,
        targetResourceId: target.id,
        relationTypeKey: "contains",
        origin: "spatial",
        sourceFeatureId: containing.featureId,
        targetFeatureId: points[0]?.featureId ?? null,
        createdBy: actor,
      });
    }
    await transaction
      .delete(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, organizationId),
          eq(resourceRelations.relationTypeKey, "contains"),
          eq(resourceRelations.origin, "spatial"),
        ),
      );
    if (nextEdges.length) {
      await transaction.insert(resourceRelations).values(nextEdges).onConflictDoNothing();
    }
    return { spatialRelations: nextEdges.length };
  });
}
