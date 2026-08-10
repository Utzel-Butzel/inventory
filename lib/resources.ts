import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";

import {
  assemblyBuildComponents,
  assemblyBuilds,
  bomLines,
  media,
  purchaseOrderLines,
  resourceCreationRequests,
  resources,
  stockMovements,
  stockSettings,
  stockUnits,
  type MediaRecord,
  type NewResource,
  type ResourceRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { BOM_WRITE_LOCK_ID } from "@/lib/inventory-locks";

export type ResourceWithMedia = ResourceRecord & {
  media: MediaRecord[];
  cover: MediaRecord | null;
};

const attachMedia = (
  rows: ResourceRecord[],
  mediaRows: MediaRecord[],
): ResourceWithMedia[] => {
  const grouped = new Map<string, MediaRecord[]>();
  for (const item of mediaRows) {
    const existing = grouped.get(item.resourceId) ?? [];
    existing.push(item);
    grouped.set(item.resourceId, existing);
  }

  return rows.map((resource) => {
    const resourceMedia = (grouped.get(resource.id) ?? []).sort(
      (left, right) => left.position - right.position,
    );
    return {
      ...resource,
      media: resourceMedia,
      cover: resourceMedia.find((item) => item.kind === "image") ?? null,
    };
  });
};

export async function listResources(options: {
  query?: string;
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 24));
  const conditions = [];

  if (options.query?.trim()) {
    const pattern = `%${options.query.trim()}%`;
    conditions.push(
      or(
        ilike(resources.name, pattern),
        ilike(resources.description, pattern),
        ilike(resources.sku, pattern),
        ilike(resources.location, pattern),
        sql`${resources.tags}::text ILIKE ${pattern}`,
      ),
    );
  }
  if (options.type && options.type !== "all") {
    conditions.push(eq(resources.type, options.type as ResourceRecord["type"]));
  }
  if (options.status && options.status !== "all") {
    conditions.push(eq(resources.status, options.status));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(resources)
      .where(where)
      .orderBy(desc(resources.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(resources).where(where),
  ]);

  const mediaRows = rows.length
    ? await db
        .select()
        .from(media)
        .where(inArray(media.resourceId, rows.map((row) => row.id)))
        .orderBy(asc(media.position))
    : [];

  return {
    resources: attachMedia(rows, mediaRows),
    pagination: {
      page,
      pageSize,
      total: totalRows[0]?.value ?? 0,
      pages: Math.max(1, Math.ceil((totalRows[0]?.value ?? 0) / pageSize)),
    },
  };
}

export async function getResource(id: string) {
  const [row] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, id))
    .limit(1);
  if (!row) return null;

  const mediaRows = await db
    .select()
    .from(media)
    .where(eq(media.resourceId, id))
    .orderBy(asc(media.position));
  return attachMedia([row], mediaRows)[0];
}

export async function createResource(values: NewResource) {
  const [created] = await db.insert(resources).values(values).returning();
  return { ...created, media: [], cover: null } satisfies ResourceWithMedia;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("That Idempotency-Key was already used with a different request.");
    this.name = "IdempotencyConflictError";
  }
}

type StoredCreationResponse = { resource: ResourceWithMedia };

const deserializeCreationResponse = (value: Record<string, unknown>) =>
  value as unknown as StoredCreationResponse;

async function findResourceCreationRequest(idempotencyKey: string) {
  const [existing] = await db
    .select()
    .from(resourceCreationRequests)
    .where(eq(resourceCreationRequests.idempotencyKey, idempotencyKey))
    .limit(1);
  return existing ?? null;
}

export async function createResourceIdempotently(options: {
  values: NewResource;
  idempotencyKey: string;
  requestHash: string;
}) {
  const replay = async () => {
    const existing = await findResourceCreationRequest(options.idempotencyKey);
    if (!existing) return null;
    if (existing.requestHash !== options.requestHash) {
      throw new IdempotencyConflictError();
    }
    return {
      response: deserializeCreationResponse(existing.response),
      replayed: true,
    } as const;
  };

  const existing = await replay();
  if (existing) return existing;

  try {
    const response = await db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(resources)
        .values(options.values)
        .returning();
      const envelope = {
        resource: { ...created, media: [], cover: null },
      } satisfies StoredCreationResponse;
      const snapshot = JSON.parse(JSON.stringify(envelope)) as Record<
        string,
        unknown
      >;
      await transaction.insert(resourceCreationRequests).values({
        idempotencyKey: options.idempotencyKey,
        requestHash: options.requestHash,
        resourceId: created.id,
        response: snapshot,
      });
      return envelope;
    });
    return { response, replayed: false } as const;
  } catch (error) {
    // A concurrent request can win the unique-key race while this transaction
    // is open. Its committed snapshot is the authoritative replay response.
    const concurrentReplay = await replay();
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }
}

export async function updateResource(
  id: string,
  values: Partial<NewResource>,
) {
  const [updated] = await db
    .update(resources)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(resources.id, id))
    .returning();
  if (!updated) return null;
  return getResource(updated.id);
}

export async function deleteResource(id: string) {
  const resource = await getResource(id);
  if (!resource) return null;
  await db.delete(resources).where(eq(resources.id, id));
  return resource;
}

export async function getDashboardStats() {
  const [totals] = await db
    .select({
      resources: count(),
      units: sql<number>`coalesce(sum(${resources.quantity}), 0)::int`,
      valueCents: sql<number>`coalesce(sum(${resources.valueCents} * ${resources.quantity}), 0)::bigint`,
      available: sql<number>`count(*) filter (where ${resources.status} = 'available')::int`,
      attention: sql<number>`count(*) filter (where ${resources.status} = 'maintenance')::int`,
    })
    .from(resources);

  const byType = await db
    .select({ type: resources.type, value: count() })
    .from(resources)
    .groupBy(resources.type)
    .orderBy(desc(count()));

  return {
    resources: totals?.resources ?? 0,
    units: Number(totals?.units ?? 0),
    valueCents: Number(totals?.valueCents ?? 0),
    available: Number(totals?.available ?? 0),
    attention: Number(totals?.attention ?? 0),
    byType,
  };
}

const normalizeName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const bigrams = (value: string) => {
  const normalized = ` ${normalizeName(value)} `;
  return new Set(
    Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) =>
      normalized.slice(index, index + 2),
    ),
  );
};

const diceSimilarity = (left: string, right: string) => {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  if (!leftSet.size || !rightSet.size) return 0;
  let overlap = 0;
  for (const entry of leftSet) if (rightSet.has(entry)) overlap += 1;
  return (2 * overlap) / (leftSet.size + rightSet.size);
};

export async function findDuplicateResources() {
  const rows = await db
    .select()
    .from(resources)
    .orderBy(desc(resources.updatedAt))
    .limit(1_000);
  const mediaRows = rows.length
    ? await db
        .select()
        .from(media)
        .where(inArray(media.resourceId, rows.map((row) => row.id)))
    : [];
  const enriched = attachMedia(rows, mediaRows);
  const pairs: Array<{
    left: ResourceWithMedia;
    right: ResourceWithMedia;
    score: number;
    reason: string;
  }> = [];

  for (let leftIndex = 0; leftIndex < enriched.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < enriched.length;
      rightIndex += 1
    ) {
      const left = enriched[leftIndex];
      const right = enriched[rightIndex];
      if (!left || !right) continue;
      const score = diceSimilarity(left.name, right.name);
      const sameSku = Boolean(left.sku && right.sku && left.sku === right.sku);
      if (sameSku || score >= 0.72) {
        pairs.push({
          left,
          right,
          score: sameSku ? 1 : score,
          reason: sameSku ? "Matching SKU" : "Similar name",
        });
      }
    }
  }

  return pairs.sort((left, right) => right.score - left.score).slice(0, 100);
}

export async function mergeResources(
  keepId: string,
  duplicateId: string,
  actor?: string,
) {
  if (keepId === duplicateId) throw new Error("Choose two different items.");
  const merged = await db.transaction(async (transaction) => {
    // Serialize every BOM graph rewrite, including merges. Otherwise a merge
    // could race a recipe update or collapse an indirect path into a cycle.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );

    const lockedResources = await transaction
      .select()
      .from(resources)
      .where(inArray(resources.id, [keepId, duplicateId]))
      .orderBy(asc(resources.id))
      .for("update");
    const lockedKeep = lockedResources.find((item) => item.id === keepId);
    const lockedDuplicate = lockedResources.find((item) => item.id === duplicateId);
    if (!lockedKeep || !lockedDuplicate) {
      return false;
    }

    const bomEdges = await transaction
      .select({
        parent: bomLines.assemblyResourceId,
        child: bomLines.componentResourceId,
      })
      .from(bomLines);
    const adjacency = new Map<string, Set<string>>();
    for (const edge of bomEdges) {
      const parent = edge.parent === duplicateId ? keepId : edge.parent;
      const child = edge.child === duplicateId ? keepId : edge.child;
      // A direct relationship between the aliases disappears when they become
      // one item. Every other self-edge indicates an unsafe indirect collapse.
      if (parent === child) continue;
      const children = adjacency.get(parent) ?? new Set<string>();
      children.add(child);
      adjacency.set(parent, children);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const containsCycle = (resourceId: string): boolean => {
      if (visiting.has(resourceId)) return true;
      if (visited.has(resourceId)) return false;
      visiting.add(resourceId);
      for (const componentId of adjacency.get(resourceId) ?? []) {
        if (containsCycle(componentId)) return true;
      }
      visiting.delete(resourceId);
      visited.add(resourceId);
      return false;
    };
    if (Array.from(adjacency.keys()).some(containsCycle)) {
      throw new Error(
        "These items cannot be merged because that would create a circular bill of materials.",
      );
    }

    const [historicalBuild] = await transaction
      .select({ id: assemblyBuilds.id })
      .from(assemblyBuilds)
      .where(eq(assemblyBuilds.assemblyResourceId, duplicateId))
      .limit(1);
    const [historicalComponent] = await transaction
      .select({ id: assemblyBuildComponents.id })
      .from(assemblyBuildComponents)
      .where(eq(assemblyBuildComponents.componentResourceId, duplicateId))
      .limit(1);
    if (historicalBuild || historicalComponent) {
      throw new Error(
        "These items cannot be merged because the duplicate is part of completed assembly build history. Archive it instead so the audit trail stays immutable.",
      );
    }

    const [receivedOrderLine] = await transaction
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.resourceId, duplicateId),
          sql`${purchaseOrderLines.receivedQuantity} > 0`,
        ),
      )
      .limit(1);
    if (receivedOrderLine) {
      throw new Error(
        "These items cannot be merged because the duplicate has received purchase-order history. Archive it instead so receipt retries and audit records stay immutable.",
      );
    }

    const mediaRows = await transaction
      .select()
      .from(media)
      .where(inArray(media.resourceId, [keepId, duplicateId]));
    const keepMedia = mediaRows.filter((item) => item.resourceId === keepId);
    const duplicateMedia = mediaRows.filter((item) => item.resourceId === duplicateId);
    const highestPosition = keepMedia.reduce(
      (highest, item) => Math.max(highest, item.position),
      -1,
    );
    for (const [index, item] of duplicateMedia.entries()) {
      await transaction
        .update(media)
        .set({ resourceId: keepId, position: highestPosition + index + 1 })
        .where(eq(media.id, item.id));
    }

    // Repoint structured relationships before deleting the duplicate. BOM
    // parent collisions keep the canonical item's recipe; component collisions
    // add quantities so an assembly that referenced both aliases keeps the same
    // material requirement.
    const duplicateParentLines = await transaction
      .select()
      .from(bomLines)
      .where(eq(bomLines.assemblyResourceId, duplicateId));
    for (const line of duplicateParentLines) {
      if (line.componentResourceId === keepId) {
        await transaction.delete(bomLines).where(eq(bomLines.id, line.id));
        continue;
      }
      const [collision] = await transaction
        .select({ id: bomLines.id })
        .from(bomLines)
        .where(
          and(
            eq(bomLines.assemblyResourceId, keepId),
            eq(bomLines.componentResourceId, line.componentResourceId),
          ),
        )
        .limit(1);
      if (collision) {
        await transaction.delete(bomLines).where(eq(bomLines.id, line.id));
      } else {
        await transaction
          .update(bomLines)
          .set({ assemblyResourceId: keepId, updatedAt: new Date() })
          .where(eq(bomLines.id, line.id));
      }
    }

    const duplicateComponentLines = await transaction
      .select()
      .from(bomLines)
      .where(eq(bomLines.componentResourceId, duplicateId));
    for (const line of duplicateComponentLines) {
      if (line.assemblyResourceId === keepId) {
        await transaction.delete(bomLines).where(eq(bomLines.id, line.id));
        continue;
      }
      const [collision] = await transaction
        .select()
        .from(bomLines)
        .where(
          and(
            eq(bomLines.assemblyResourceId, line.assemblyResourceId),
            eq(bomLines.componentResourceId, keepId),
          ),
        )
        .limit(1);
      if (collision) {
        await transaction
          .update(bomLines)
          .set({
            quantityPerAssembly:
              collision.quantityPerAssembly + line.quantityPerAssembly,
            updatedAt: new Date(),
          })
          .where(eq(bomLines.id, collision.id));
        await transaction.delete(bomLines).where(eq(bomLines.id, line.id));
      } else {
        await transaction
          .update(bomLines)
          .set({ componentResourceId: keepId, updatedAt: new Date() })
          .where(eq(bomLines.id, line.id));
      }
    }

    const duplicateOrderLines = await transaction
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.resourceId, duplicateId));
    for (const line of duplicateOrderLines) {
      const [collision] = await transaction
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, line.purchaseOrderId),
            eq(purchaseOrderLines.resourceId, keepId),
          ),
        )
        .limit(1);
      if (collision) {
        await transaction
          .update(purchaseOrderLines)
          .set({
            orderedQuantity: collision.orderedQuantity + line.orderedQuantity,
            receivedQuantity: collision.receivedQuantity + line.receivedQuantity,
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrderLines.id, collision.id));
        await transaction
          .delete(purchaseOrderLines)
          .where(eq(purchaseOrderLines.id, line.id));
      } else {
        await transaction
          .update(purchaseOrderLines)
          .set({ resourceId: keepId, updatedAt: new Date() })
          .where(eq(purchaseOrderLines.id, line.id));
      }
    }

    const settingsRows = await transaction
      .select()
      .from(stockSettings)
      .where(inArray(stockSettings.resourceId, [keepId, duplicateId]));
    const keepSettings = settingsRows.find((item) => item.resourceId === keepId);
    const duplicateSettings = settingsRows.find(
      (item) => item.resourceId === duplicateId,
    );
    const finalTrackingMode =
      keepSettings?.trackingMode === "serialized" ||
      duplicateSettings?.trackingMode === "serialized"
        ? ("serialized" as const)
        : ("bulk" as const);
    const now = new Date();

    const materializeBulkUnits = async (resource: ResourceRecord) => {
      if (resource.quantity === 0) return;
      if (resource.quantity > 5_000) {
        throw new Error(
          `Cannot merge ${resource.quantity} bulk units into serialized stock. Reduce it to 5,000 or fewer first.`,
        );
      }
      const width = Math.max(4, String(resource.quantity).length);
      const prefix = `STK-${resource.id.slice(0, 8).toUpperCase()}-M`;
      const createdUnits = await transaction
        .insert(stockUnits)
        .values(
          Array.from({ length: resource.quantity }, (_, index) => ({
            resourceId: resource.id,
            code: `${prefix}-${String(index + 1).padStart(width, "0")}`,
            status: "available" as const,
            location: resource.location,
            metadata: {},
            acquiredAt: resource.createdAt,
            lastMovedAt: now,
          })),
        )
        .returning();
      await transaction.insert(stockMovements).values(
        createdUnits.map((unit) => ({
          resourceId: resource.id,
          unitId: unit.id,
          delta: 0,
          balanceAfter: resource.quantity,
          type: "serialization-opening",
          reason: "Bulk stock converted during inventory merge",
          note: "",
          location: unit.location,
          occurredAt: now,
          createdBy: actor ?? null,
        })),
      );
    };

    if (finalTrackingMode === "serialized") {
      if ((keepSettings?.trackingMode ?? "bulk") === "bulk") {
        await materializeBulkUnits(lockedKeep);
      }
      if ((duplicateSettings?.trackingMode ?? "bulk") === "bulk") {
        await materializeBulkUnits(lockedDuplicate);
      }
    }

    const [keepUnitRows, duplicateUnitRows] = await Promise.all([
      transaction
        .select({ id: stockUnits.id, code: stockUnits.code })
        .from(stockUnits)
        .where(eq(stockUnits.resourceId, keepId)),
      transaction
        .select({ id: stockUnits.id, code: stockUnits.code })
        .from(stockUnits)
        .where(eq(stockUnits.resourceId, duplicateId)),
    ]);
    const usedCodes = new Set(keepUnitRows.map((unit) => unit.code));
    for (const unit of duplicateUnitRows) {
      if (!usedCodes.has(unit.code)) {
        usedCodes.add(unit.code);
        continue;
      }
      const mergedCode = `${unit.code.slice(0, 165)}-M-${unit.id.slice(0, 8)}`;
      await transaction
        .update(stockUnits)
        .set({ code: mergedCode, updatedAt: now })
        .where(eq(stockUnits.id, unit.id));
      usedCodes.add(mergedCode);
    }

    await transaction
      .update(stockUnits)
      .set({ resourceId: keepId, updatedAt: now })
      .where(eq(stockUnits.resourceId, duplicateId));
    await transaction
      .update(stockMovements)
      .set({ resourceId: keepId })
      .where(eq(stockMovements.resourceId, duplicateId));

    const combinedQuantity = lockedKeep.quantity + lockedDuplicate.quantity;
    await transaction
      .insert(stockSettings)
      .values({
        resourceId: keepId,
        trackingMode: finalTrackingMode,
        minimumStock: Math.max(
          keepSettings?.minimumStock ?? 0,
          duplicateSettings?.minimumStock ?? 0,
        ),
        reorderQuantity: Math.max(
          keepSettings?.reorderQuantity ?? 0,
          duplicateSettings?.reorderQuantity ?? 0,
        ),
        leadTimeDays: Math.max(
          keepSettings?.leadTimeDays ?? 0,
          duplicateSettings?.leadTimeDays ?? 0,
        ),
        unitName:
          keepSettings?.unitName && keepSettings.unitName !== "unit"
            ? keepSettings.unitName
            : duplicateSettings?.unitName ?? keepSettings?.unitName ?? "unit",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: stockSettings.resourceId,
        set: {
          trackingMode: finalTrackingMode,
          minimumStock: Math.max(
            keepSettings?.minimumStock ?? 0,
            duplicateSettings?.minimumStock ?? 0,
          ),
          reorderQuantity: Math.max(
            keepSettings?.reorderQuantity ?? 0,
            duplicateSettings?.reorderQuantity ?? 0,
          ),
          leadTimeDays: Math.max(
            keepSettings?.leadTimeDays ?? 0,
            duplicateSettings?.leadTimeDays ?? 0,
          ),
          unitName:
            keepSettings?.unitName && keepSettings.unitName !== "unit"
              ? keepSettings.unitName
              : duplicateSettings?.unitName ?? keepSettings?.unitName ?? "unit",
          updatedAt: now,
        },
      });

    await transaction
      .update(resources)
      .set({
        description: lockedKeep.description || lockedDuplicate.description,
        quantity: combinedQuantity,
        location: lockedKeep.location || lockedDuplicate.location,
        serialNumber: lockedKeep.serialNumber || lockedDuplicate.serialNumber,
        valueCents: lockedKeep.valueCents ?? lockedDuplicate.valueCents,
        tags: Array.from(new Set([...lockedKeep.tags, ...lockedDuplicate.tags])),
        categories: [...lockedKeep.categories, ...lockedDuplicate.categories].filter(
          (category, index, all) =>
            all.findIndex((candidate) => candidate.name === category.name) ===
            index,
        ),
        updatedAt: now,
      })
      .where(eq(resources.id, keepId));
    await transaction.insert(stockMovements).values({
      resourceId: keepId,
      // The duplicate ledger is repointed above, so its deltas already explain
      // the transferred quantity. This row is an audit marker, not another receipt.
      delta: 0,
      balanceAfter: combinedQuantity,
      type: "merge",
      reason: `Merged stock from ${lockedDuplicate.name}`,
      note: `Source inventory ID: ${duplicateId}`,
      location: lockedKeep.location || lockedDuplicate.location,
      occurredAt: now,
      createdBy: actor ?? null,
    });
    await transaction.delete(resources).where(eq(resources.id, duplicateId));
    return true;
  });

  return merged ? getResource(keepId) : null;
}
