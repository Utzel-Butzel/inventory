import "server-only";

import { isDeepStrictEqual } from "node:util";

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
  inventoryAssignments,
  inventoryCounts,
  inventoryCyclePolicies,
  media,
  orderLineUnits,
  orderLines as purchaseOrderLines,
  resourceLendingSettings,
  resourceCreationRequests,
  resourceFavorites,
  resourceOptionSelections,
  resourceOptionValues,
  resourceRelations,
  resourceSlugs,
  resourceVariants,
  roomScanAssets,
  roomScanKeyframes,
  roomScans,
  resources,
  stockLocationBalances,
  stockMovements,
  stockSettings,
  stockUnits,
  type MediaRecord,
  type NewResource,
  type ResourceRecord,
} from "@/db/schema";
import {
  DEFAULT_INVENTORY_PAGE_SIZE,
  MAX_INVENTORY_PAGE_SIZE,
} from "@/lib/inventory-pagination";
import { db } from "@/lib/db";
import {
  enqueueStockMovementWebhookEvents,
  enqueueWebhookEvent,
} from "@/lib/webhooks";
import { validateCustomFieldValues } from "@/lib/custom-fields";
import {
  BOM_WRITE_LOCK_ID,
  VARIANT_FAMILY_WRITE_LOCK_ID,
} from "@/lib/inventory-locks";
import {
  findResourceVariantMembership,
  overriddenFieldsFromAttributes,
  VARIANT_INHERITED_CATALOG_FIELDS,
  VARIANT_RELATION_TYPE,
} from "@/lib/resource-families";
import {
  listResourceSlugRows,
  replaceResourceSlugs,
} from "@/lib/resource-slugs";

export type ResourceWithMedia = ResourceRecord & {
  slugs: string[];
  media: MediaRecord[];
  cover: MediaRecord | null;
};

type VariantInheritedCatalogField =
  (typeof VARIANT_INHERITED_CATALOG_FIELDS)[number];

const variantInheritedCatalogFieldSet = new Set<string>(
  VARIANT_INHERITED_CATALOG_FIELDS,
);

const changedResourceFields = (
  current: ResourceRecord,
  proposed: ResourceRecord,
  candidateFields: string[],
) =>
  candidateFields.filter(
    (field) =>
      field !== "updatedAt" &&
      !isDeepStrictEqual(
        current[field as keyof ResourceRecord],
        proposed[field as keyof ResourceRecord],
      ),
  );

const inheritedCatalogFieldsAmong = (fields: string[]) =>
  fields.filter((field): field is VariantInheritedCatalogField =>
    variantInheritedCatalogFieldSet.has(field),
  );

const inheritedCatalogPatch = (
  source: ResourceRecord,
  fields: VariantInheritedCatalogField[],
) => {
  const patch: Partial<NewResource> = {};
  for (const field of fields) {
    (patch as Record<string, unknown>)[field] = source[field];
  }
  return patch;
};

const attachMedia = (
  rows: ResourceRecord[],
  mediaRows: MediaRecord[],
  slugRows: Array<{ resourceId: string; slug: string; position: number }> = [],
): ResourceWithMedia[] => {
  const grouped = new Map<string, MediaRecord[]>();
  for (const item of mediaRows) {
    const existing = grouped.get(item.resourceId) ?? [];
    existing.push(item);
    grouped.set(item.resourceId, existing);
  }

  const groupedSlugs = new Map<string, Array<{ slug: string; position: number }>>();
  for (const item of slugRows) {
    const existing = groupedSlugs.get(item.resourceId) ?? [];
    existing.push({ slug: item.slug, position: item.position });
    groupedSlugs.set(item.resourceId, existing);
  }

  return rows.map((resource) => {
    const resourceMedia = (grouped.get(resource.id) ?? []).sort(
      (left, right) => left.position - right.position,
    );
    return {
      ...resource,
      slugs: (groupedSlugs.get(resource.id) ?? [])
        .sort((left, right) => left.position - right.position)
        .map((item) => item.slug),
      media: resourceMedia,
      cover: resourceMedia.find((item) => item.kind === "image") ?? null,
    };
  });
};

export async function listResources(options: {
  organizationId: string;
  favoriteUserId?: string;
  favoritesOnly?: boolean;
  query?: string;
  type?: string;
  status?: string;
  priority?: string;
  sort?: string;
  direction?: string;
  loanable?: boolean;
  page?: number;
  pageSize?: number;
  mediaMode?: "all" | "cover";
}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(
    MAX_INVENTORY_PAGE_SIZE,
    Math.max(1, options.pageSize ?? DEFAULT_INVENTORY_PAGE_SIZE),
  );
  const conditions = [eq(resources.organizationId, options.organizationId)];

  if (options.query?.trim()) {
    const pattern = `%${options.query.trim()}%`;
    const slugMatches = db
      .select({ resourceId: resourceSlugs.resourceId })
      .from(resourceSlugs)
      .where(
        and(
          eq(resourceSlugs.organizationId, options.organizationId),
          ilike(resourceSlugs.slug, pattern),
        ),
      );
    const variantMatches = db
      .select({ resourceId: resourceVariants.resourceId })
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, options.organizationId),
          or(
            ilike(resourceVariants.name, pattern),
            ilike(resourceVariants.sku, pattern),
            ilike(resourceVariants.barcode, pattern),
          ),
        ),
      );
    conditions.push(
      or(
        ilike(resources.name, pattern),
        ilike(resources.description, pattern),
        ilike(resources.sku, pattern),
        ilike(resources.barcode, pattern),
        ilike(resources.location, pattern),
        sql`${resources.tags}::text ILIKE ${pattern}`,
        sql`${resources.customFields}::text ILIKE ${pattern}`,
        inArray(resources.id, slugMatches),
        inArray(resources.id, variantMatches),
      )!,
    );
  }
  if (options.type && options.type !== "all") {
    conditions.push(eq(resources.type, options.type as ResourceRecord["type"]));
  }
  if (options.status && options.status !== "all") {
    conditions.push(eq(resources.status, options.status));
  }
  if (options.loanable) {
    const loanableResources = db
      .select({ resourceId: resourceLendingSettings.resourceId })
      .from(resourceLendingSettings)
      .where(
        and(
          eq(resourceLendingSettings.organizationId, options.organizationId),
          eq(resourceLendingSettings.enabled, true),
        ),
      );
    conditions.push(inArray(resources.id, loanableResources));
  }
  const favoriteResources = options.favoriteUserId
    ? db
        .select({ resourceId: resourceFavorites.resourceId })
        .from(resourceFavorites)
        .where(
          and(
            eq(resourceFavorites.organizationId, options.organizationId),
            eq(resourceFavorites.userId, options.favoriteUserId),
          ),
        )
    : null;
  if (options.favoritesOnly) {
    conditions.push(
      favoriteResources
        ? inArray(resources.id, favoriteResources)
        : sql`false`,
    );
  }

  if (options.priority && /^[1-5]$/.test(options.priority)) {
    conditions.push(eq(resources.priority, Number(options.priority)));
  }
  const sortColumns = {
    name: resources.name, type: resources.type, status: resources.status,
    sku: resources.sku, location: resources.location, quantity: resources.quantity,
    valueCents: resources.valueCents, priority: resources.priority,
    createdAt: resources.createdAt, updatedAt: resources.updatedAt,
  };
  const sortColumn = options.sort && Object.hasOwn(sortColumns, options.sort)
    ? sortColumns[options.sort as keyof typeof sortColumns] : resources.updatedAt;
  const ordering = options.direction === "asc" ? asc(sortColumn) : desc(sortColumn);

  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(resources)
      .where(where)
      .orderBy(ordering, asc(resources.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(resources).where(where),
  ]);

  const mediaRowsPromise =
    options.mediaMode === "cover"
      ? db
          .selectDistinctOn([media.resourceId])
          .from(media)
          .where(
            and(
              eq(media.organizationId, options.organizationId),
              inArray(media.resourceId, rows.map((row) => row.id)),
              eq(media.kind, "image"),
            ),
          )
          .orderBy(
            asc(media.resourceId),
            asc(media.position),
            asc(media.createdAt),
          )
      : db
          .select()
          .from(media)
          .where(
            and(
              eq(media.organizationId, options.organizationId),
              inArray(media.resourceId, rows.map((row) => row.id)),
            ),
          )
          .orderBy(asc(media.position));

  const [mediaRows, slugRows, favoriteRows] = rows.length
    ? await Promise.all([
        mediaRowsPromise,
        listResourceSlugRows(
          options.organizationId,
          rows.map((row) => row.id),
        ),
        options.favoriteUserId
          ? db
              .select({ resourceId: resourceFavorites.resourceId })
              .from(resourceFavorites)
              .where(
                and(
                  eq(resourceFavorites.organizationId, options.organizationId),
                  eq(resourceFavorites.userId, options.favoriteUserId),
                  inArray(
                    resourceFavorites.resourceId,
                    rows.map((row) => row.id),
                  ),
                ),
              )
          : Promise.resolve([]),
      ])
    : [[], [], []];
  const favoriteIds = new Set(favoriteRows.map((row) => row.resourceId));

  return {
    resources: attachMedia(rows, mediaRows, slugRows).map((resource) => ({
      ...resource,
      isFavorite: favoriteIds.has(resource.id),
    })),
    pagination: {
      page,
      pageSize,
      total: totalRows[0]?.value ?? 0,
      pages: Math.max(1, Math.ceil((totalRows[0]?.value ?? 0) / pageSize)),
    },
  };
}

export async function countResourcesForRecognition(organizationId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(resources)
    .where(eq(resources.organizationId, organizationId));
  return row?.value ?? 0;
}

/**
 * Searches recognition metadata across the complete inventory before applying
 * a response-size bound. A small recent image-bearing fallback lets visual
 * reranking still help records with sparse metadata. Image bytes are read only
 * for the final shortlist in the route.
 */
export async function listResourcesForRecognition(
  organizationId: string,
  searchTerms: readonly string[],
  limit = 2_000,
) {
  const boundedLimit = Math.min(5_000, Math.max(1, Math.trunc(limit)));
  const patterns = Array.from(
    new Set(
      searchTerms
        .map((term) => term.trim().replace(/[%_]+/gu, " ").trim())
        .filter((term) => term.length >= 1)
        .map((term) => term.slice(0, 160)),
    ),
  )
    .slice(0, 16)
    .map((term) => `%${term}%`);
  const resourceMatches = patterns.flatMap((pattern) => [
    ilike(resources.name, pattern),
    ilike(resources.description, pattern),
    ilike(resources.type, pattern),
    ilike(resources.sku, pattern),
    ilike(resources.barcode, pattern),
    ilike(resources.serialNumber, pattern),
    ilike(resources.location, pattern),
    sql`${resources.tags}::text ILIKE ${pattern}`,
    sql`${resources.categories}::text ILIKE ${pattern}`,
    sql`${resources.customFields}::text ILIKE ${pattern}`,
  ]);
  const relevance = sql<number>`(${sql.join(
    patterns.flatMap((pattern) => [
      sql`CASE WHEN ${resources.sku} ILIKE ${pattern} OR ${resources.barcode} ILIKE ${pattern} OR ${resources.serialNumber} ILIKE ${pattern} THEN 24 ELSE 0 END`,
      sql`CASE WHEN ${resources.name} ILIKE ${pattern} THEN 16 ELSE 0 END`,
      sql`CASE WHEN ${resources.tags}::text ILIKE ${pattern} OR ${resources.categories}::text ILIKE ${pattern} THEN 7 ELSE 0 END`,
      sql`CASE WHEN ${resources.description} ILIKE ${pattern} OR ${resources.customFields}::text ILIKE ${pattern} THEN 3 ELSE 0 END`,
    ]),
    sql` + `,
  )})`;
  const matchingMedia = db
    .select({ resourceId: media.resourceId })
    .from(media)
    .where(
      and(
        eq(media.organizationId, organizationId),
        eq(media.kind, "image"),
        or(...patterns.map((pattern) => ilike(media.altText, pattern))),
      ),
    );
  const recognitionWhere = patterns.length
    ? and(
        eq(resources.organizationId, organizationId),
        or(...resourceMatches, inArray(resources.id, matchingMedia)),
      )
    : sql`false`;
  const resourcesWithImages = db
    .select({ resourceId: media.resourceId })
    .from(media)
    .where(
      and(
        eq(media.organizationId, organizationId),
        eq(media.kind, "image"),
      ),
    )
    .groupBy(media.resourceId);
  const fallbackLimit = Math.min(40, boundedLimit);
  const [
    matchingRows,
    matchingTotalRows,
    fallbackRows,
    imageResourceTotalRows,
    inventoryTotalRows,
  ] = await Promise.all([
      db
        .select()
        .from(resources)
        .where(recognitionWhere)
        .orderBy(desc(relevance), desc(resources.updatedAt))
        .limit(boundedLimit),
      db.select({ value: count() }).from(resources).where(recognitionWhere),
      db
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, resourcesWithImages),
          ),
        )
        .orderBy(desc(resources.updatedAt))
        .limit(fallbackLimit),
      db
        .select({ value: count() })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, resourcesWithImages),
          ),
        ),
      db
        .select({ value: count() })
        .from(resources)
        .where(eq(resources.organizationId, organizationId)),
    ]);
  const fallbackIds = new Set(fallbackRows.map((row) => row.id));
  const rows = Array.from(
    new Map(
      [...matchingRows, ...fallbackRows].map((row) => [row.id, row] as const),
    ).values(),
  ).slice(0, boundedLimit);
  const [mediaRows, slugRows] = rows.length
    ? await Promise.all([
        db
          .select()
          .from(media)
          .where(
            and(
              eq(media.organizationId, organizationId),
              inArray(media.resourceId, rows.map((row) => row.id)),
              eq(media.kind, "image"),
            ),
          )
          .orderBy(asc(media.position)),
        listResourceSlugRows(
          organizationId,
          rows.map((row) => row.id),
        ),
      ])
    : [[], []];
  return {
    resources: attachMedia(rows, mediaRows, slugRows),
    visualFallbackResourceIds: fallbackIds,
    matchingTotal: matchingTotalRows[0]?.value ?? 0,
    inventoryTotal: inventoryTotalRows[0]?.value ?? 0,
    truncated:
      (matchingTotalRows[0]?.value ?? 0) > matchingRows.length ||
      (imageResourceTotalRows[0]?.value ?? 0) > fallbackRows.length,
  };
}

export async function getResource(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.id, id),
        eq(resources.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return null;

  const [mediaRows, slugRows] = await Promise.all([
    db
      .select()
      .from(media)
      .where(
        and(
          eq(media.resourceId, id),
          eq(media.organizationId, organizationId),
        ),
      )
      .orderBy(asc(media.position)),
    listResourceSlugRows(organizationId, [id]),
  ]);
  return attachMedia([row], mediaRows, slugRows)[0];
}

export async function getResourceCovers(
  organizationId: string,
  resourceIds: readonly string[],
) {
  const uniqueIds = Array.from(new Set(resourceIds));
  if (!uniqueIds.length) return [];

  const rows = await db
    .select({
      id: media.id,
      resourceId: media.resourceId,
      url: media.url,
      altText: media.altText,
      width: media.width,
      height: media.height,
    })
    .from(media)
    .where(
      and(
        eq(media.organizationId, organizationId),
        inArray(media.resourceId, uniqueIds),
        eq(media.kind, "image"),
      ),
    )
    .orderBy(asc(media.resourceId), asc(media.position), asc(media.createdAt));

  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.resourceId)) return false;
    seen.add(row.resourceId);
    return true;
  });
}

export async function createResource(
  organizationId: string,
  values: NewResource,
  actor?: string | null,
  slugs: readonly string[] = [],
) {
  const created = await db.transaction(async (transaction) => {
    const [row] = await transaction
      .insert(resources)
      .values({ ...values, organizationId })
      .returning();
    await replaceResourceSlugs(transaction, {
      organizationId,
      resourceId: row.id,
      slugs,
      actor: actor ?? values.createdBy ?? null,
    });
    await enqueueWebhookEvent(transaction, {
      organizationId,
      type: "inventory.resource.created",
      aggregateType: "resource",
      aggregateId: row.id,
      actor: actor ?? values.createdBy ?? null,
      data: { resource: { ...row, slugs, media: [], cover: null } },
    });
    return row;
  });
  return {
    ...created,
    slugs: [...slugs],
    media: [],
    cover: null,
  } satisfies ResourceWithMedia;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("That Idempotency-Key was already used with a different request.");
    this.name = "IdempotencyConflictError";
  }
}

type StoredCreationResponse = { resource: ResourceWithMedia };

const deserializeCreationResponse = (value: Record<string, unknown>) => {
  const response = value as unknown as StoredCreationResponse;
  return {
    ...response,
    resource: {
      ...response.resource,
      slugs: Array.isArray(response.resource.slugs)
        ? response.resource.slugs
        : [],
    },
  } satisfies StoredCreationResponse;
};

async function findResourceCreationRequest(
  organizationId: string,
  idempotencyKey: string,
) {
  const [existing] = await db
    .select()
    .from(resourceCreationRequests)
    .where(
      and(
        eq(resourceCreationRequests.organizationId, organizationId),
        eq(resourceCreationRequests.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return existing ?? null;
}

export async function replayResourceCreation(options: {
  organizationId: string;
  idempotencyKey: string;
  requestHash: string;
}) {
  const existing = await findResourceCreationRequest(
    options.organizationId,
    options.idempotencyKey,
  );
  if (!existing) return null;
  if (existing.requestHash !== options.requestHash) {
    throw new IdempotencyConflictError();
  }
  return {
    response: deserializeCreationResponse(existing.response),
    replayed: true,
  } as const;
}

export async function createResourceIdempotently(options: {
  organizationId: string;
  values: NewResource;
  slugs?: readonly string[];
  idempotencyKey: string;
  requestHash: string;
  actor?: string | null;
}) {
  const replay = () => replayResourceCreation(options);

  const existing = await replay();
  if (existing) return existing;

  try {
    const response = await db.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(resources)
        .values({ ...options.values, organizationId: options.organizationId })
        .returning();
      const slugs = [...(options.slugs ?? [])];
      await replaceResourceSlugs(transaction, {
        organizationId: options.organizationId,
        resourceId: created.id,
        slugs,
        actor: options.actor ?? options.values.createdBy ?? null,
      });
      const envelope = {
        resource: { ...created, slugs, media: [], cover: null },
      } satisfies StoredCreationResponse;
      const snapshot = JSON.parse(JSON.stringify(envelope)) as Record<
        string,
        unknown
      >;
      await transaction.insert(resourceCreationRequests).values({
        organizationId: options.organizationId,
        idempotencyKey: options.idempotencyKey,
        requestHash: options.requestHash,
        resourceId: created.id,
        response: snapshot,
      });
      await enqueueWebhookEvent(transaction, {
        organizationId: options.organizationId,
        type: "inventory.resource.created",
        aggregateType: "resource",
        aggregateId: created.id,
        actor: options.actor ?? options.values.createdBy ?? null,
        data: { resource: envelope.resource },
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
  organizationId: string,
  id: string,
  values: Partial<NewResource>,
  actor?: string | null,
) {
  return updateResourceWithCustomFieldValidation({
    organizationId,
    id,
    values,
    validateCustomFields: false,
    customFieldsProvided: false,
    actor,
  });
}

export async function updateResourceWithCustomFieldValidation(options: {
  organizationId: string;
  id: string;
  values: Partial<NewResource>;
  slugs?: readonly string[];
  validateCustomFields: boolean;
  customFieldsProvided: boolean;
  authorize?: (
    current: ResourceRecord,
    proposed: ResourceRecord,
  ) => boolean | Promise<boolean>;
  actor?: string | null;
}) {
  const updated = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );
    const [current] = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.id, options.id),
          eq(resources.organizationId, options.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return null;

    const currentSlugRows = await listResourceSlugRows(
      options.organizationId,
      [current.id],
      transaction,
    );
    const currentSlugs = currentSlugRows.map((row) => row.slug);
    const slugsChanged =
      options.slugs !== undefined &&
      !isDeepStrictEqual(currentSlugs, options.slugs);

    let values = options.values;
    if (values.type !== undefined && values.type !== "place") {
      const [spatialScan] = await transaction
        .select({ id: roomScans.id })
        .from(roomScans)
        .where(
          and(
            eq(roomScans.organizationId, options.organizationId),
            eq(roomScans.roomResourceId, current.id),
          ),
        )
        .limit(1);
      if (spatialScan) {
        throw new Error("RESOURCE_HAS_ROOM_SCANS");
      }
    }
    if (options.validateCustomFields) {
      const customFields = await validateCustomFieldValues({
        organizationId: options.organizationId,
        entityType: "inventory",
        target: {
          type: values.type ?? current.type,
          categories: values.categories ?? current.categories,
        },
        values: values.customFields ?? current.customFields,
        currentValues: current.customFields,
        enforceRequired: options.customFieldsProvided,
        executor: transaction,
      });
      values = { ...values, customFields };
    }

    const now = new Date();
    const proposed = {
      ...current,
      ...values,
      updatedAt: now,
    } satisfies ResourceRecord;
    const changedFields = changedResourceFields(
      current,
      proposed,
      Object.keys(values),
    );
    if (slugsChanged) changedFields.push("slugs");
    if (
      options.authorize &&
      (!(await options.authorize(current, proposed)))
    ) {
      throw new Error("RESOURCE_PERMISSION_DENIED");
    }

    const membership = await findResourceVariantMembership(
      transaction,
      options.organizationId,
      current.id,
    );
    const inheritedChangedFields = inheritedCatalogFieldsAmong(changedFields);
    let nextVariantOverrides: string[] | null = null;
    const propagatedVariantUpdates: Array<{
      current: ResourceRecord;
      proposed: ResourceRecord;
      values: Partial<NewResource>;
      changedFields: string[];
    }> = [];

    if (membership && inheritedChangedFields.length) {
      const [primary] = await transaction
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, options.organizationId),
            eq(resources.id, membership.primaryResourceId),
          ),
        )
        .limit(1);
      if (!primary) {
        throw new Error("VARIANT_PRIMARY_NOT_FOUND");
      }
      const overrides = new Set(
        membership.overriddenFields.filter((field) =>
          variantInheritedCatalogFieldSet.has(field),
        ),
      );
      for (const field of inheritedChangedFields) {
        if (isDeepStrictEqual(proposed[field], primary[field])) {
          overrides.delete(field);
        } else {
          overrides.add(field);
        }
      }
      nextVariantOverrides = VARIANT_INHERITED_CATALOG_FIELDS.filter((field) =>
        overrides.has(field),
      );
    } else if (!membership && inheritedChangedFields.length) {
      const familyRelations = await transaction
        .select({
          sourceResourceId: resourceRelations.sourceResourceId,
          attributes: resourceRelations.attributes,
        })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, options.organizationId),
            eq(resourceRelations.targetResourceId, current.id),
            eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
          ),
        )
        .orderBy(asc(resourceRelations.sourceResourceId))
        .for("update");
      const variantIds = familyRelations.map(
        (relation) => relation.sourceResourceId,
      );
      const variants = variantIds.length
        ? await transaction
            .select()
            .from(resources)
            .where(
              and(
                eq(resources.organizationId, options.organizationId),
                inArray(resources.id, variantIds),
              ),
            )
            .orderBy(asc(resources.id))
            .for("update")
        : [];
      if (variants.length !== variantIds.length) {
        throw new Error("VARIANT_FAMILY_MEMBER_NOT_FOUND");
      }
      const attributesByVariantId = new Map(
        familyRelations.map((relation) => [
          relation.sourceResourceId,
          new Set(overriddenFieldsFromAttributes(relation.attributes)),
        ]),
      );

      for (const variant of variants) {
        const overrides = attributesByVariantId.get(variant.id) ?? new Set();
        const inheritedFields = inheritedChangedFields.filter(
          (field) => !overrides.has(field),
        );
        if (!inheritedFields.length) continue;

        let variantValues = inheritedCatalogPatch(proposed, inheritedFields);
        let proposedVariant = {
          ...variant,
          ...variantValues,
          updatedAt: now,
        } satisfies ResourceRecord;
        if (
          proposedVariant.type !== "place" &&
          proposedVariant.type !== variant.type
        ) {
          const [spatialScan] = await transaction
            .select({ id: roomScans.id })
            .from(roomScans)
            .where(
              and(
                eq(roomScans.organizationId, options.organizationId),
                eq(roomScans.roomResourceId, variant.id),
              ),
            )
            .limit(1);
          if (spatialScan) {
            throw new Error("RESOURCE_HAS_ROOM_SCANS");
          }
        }
        if (
          inheritedFields.some((field) =>
            ["type", "categories", "customFields"].includes(field),
          )
        ) {
          const customFields = await validateCustomFieldValues({
            organizationId: options.organizationId,
            entityType: "inventory",
            target: {
              type: proposedVariant.type,
              categories: proposedVariant.categories,
            },
            values: proposedVariant.customFields,
            currentValues: variant.customFields,
            enforceRequired: true,
            executor: transaction,
          });
          variantValues = { ...variantValues, customFields };
          proposedVariant = {
            ...proposedVariant,
            customFields,
          };
        }
        const variantChangedFields = changedResourceFields(
          variant,
          proposedVariant,
          Object.keys(variantValues),
        );
        if (!variantChangedFields.length) continue;
        if (
          options.authorize &&
          (!(await options.authorize(variant, proposedVariant)))
        ) {
          throw new Error("RESOURCE_PERMISSION_DENIED");
        }
        propagatedVariantUpdates.push({
          current: variant,
          proposed: proposedVariant,
          values: variantValues,
          changedFields: variantChangedFields,
        });
      }
    }

    const [saved] = await transaction
      .update(resources)
      .set({ ...values, updatedAt: now })
      .where(
        and(
          eq(resources.id, options.id),
          eq(resources.organizationId, options.organizationId),
        ),
      )
      .returning();
    if (saved) {
      if (slugsChanged && options.slugs) {
        await replaceResourceSlugs(transaction, {
          organizationId: options.organizationId,
          resourceId: saved.id,
          slugs: options.slugs,
          actor: options.actor ?? null,
        });
      }
      const savedSlugs =
        options.slugs === undefined ? currentSlugs : [...options.slugs];
      await enqueueWebhookEvent(transaction, {
        organizationId: options.organizationId,
        type: "inventory.resource.updated",
        aggregateType: "resource",
        aggregateId: saved.id,
        actor: options.actor ?? null,
        data: { resource: { ...saved, slugs: savedSlugs }, changedFields },
      });
      if (membership && nextVariantOverrides) {
        await transaction
          .update(resourceRelations)
          .set({
            attributes: {
              overriddenFields: nextVariantOverrides,
              protected: true,
            },
          })
          .where(
            and(
              eq(resourceRelations.organizationId, options.organizationId),
              eq(resourceRelations.id, membership.relationId),
              eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
            ),
          );
      }
      for (const variantUpdate of propagatedVariantUpdates) {
        const [variantSaved] = await transaction
          .update(resources)
          .set({ ...variantUpdate.values, updatedAt: now })
          .where(
            and(
              eq(resources.organizationId, options.organizationId),
              eq(resources.id, variantUpdate.current.id),
            ),
          )
          .returning();
        if (!variantSaved) {
          throw new Error("VARIANT_FAMILY_MEMBER_NOT_FOUND");
        }
        await enqueueWebhookEvent(transaction, {
          organizationId: options.organizationId,
          type: "inventory.resource.updated",
          aggregateType: "resource",
          aggregateId: variantSaved.id,
          actor: options.actor ?? null,
          data: {
            resource: variantSaved,
            changedFields: variantUpdate.changedFields,
            inheritedFromResourceId: saved.id,
          },
        });
      }
    }
    return saved ?? null;
  });

  return updated ? getResource(options.organizationId, updated.id) : null;
}

export async function updateResourcesBatch(options: {
  organizationId: string;
  ids: string[];
  changes: Partial<Pick<NewResource, "type" | "status" | "location" | "priority">>;
  addTags: string[];
  authorize?: (
    current: ResourceRecord,
    proposed: ResourceRecord,
  ) => boolean | Promise<boolean>;
  actor?: string | null;
}) {
  const ids = Array.from(new Set(options.ids));
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );
    const rows = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, options.organizationId),
          inArray(resources.id, ids),
        ),
      )
      .orderBy(asc(resources.id))
      .for("update");

    if (rows.length !== ids.length) {
      throw new Error("BATCH_RESOURCE_NOT_FOUND");
    }

    const normalizedTags = options.addTags.map((tag) => tag.toLowerCase());
    const changesInheritedCatalogData =
      options.changes.type !== undefined ||
      options.changes.priority !== undefined ||
      normalizedTags.length > 0;
    if (changesInheritedCatalogData) {
      const [familyMember] = await transaction
        .select({ id: resourceRelations.id })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, options.organizationId),
            eq(resourceRelations.relationTypeKey, VARIANT_RELATION_TYPE),
            or(
              inArray(resourceRelations.sourceResourceId, ids),
              inArray(resourceRelations.targetResourceId, ids),
            ),
          ),
        )
        .limit(1);
      if (familyMember) {
        throw new Error("VARIANT_FAMILY_BATCH_INHERITANCE_UNSUPPORTED");
      }
    }
    for (const row of rows) {
      const nextTags = normalizedTags.length
        ? Array.from(new Set([...row.tags, ...normalizedTags]))
        : row.tags;
      const proposed = {
        ...row,
        ...options.changes,
        tags: nextTags,
        updatedAt: new Date(),
      } satisfies ResourceRecord;
      if (options.authorize && !(await options.authorize(row, proposed))) {
        throw new Error("RESOURCE_PERMISSION_DENIED");
      }
      const [saved] = await transaction
        .update(resources)
        .set({
          ...options.changes,
          ...(normalizedTags.length ? { tags: nextTags } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(resources.organizationId, options.organizationId),
            eq(resources.id, row.id),
          ),
        )
        .returning();
      await enqueueWebhookEvent(transaction, {
        organizationId: options.organizationId,
        type: "inventory.resource.updated",
        aggregateType: "resource",
        aggregateId: saved.id,
        actor: options.actor ?? null,
        data: {
          resource: saved,
          changedFields: [
            ...Object.keys(options.changes),
            ...(normalizedTags.length ? ["tags"] : []),
          ],
        },
      });
    }

    return { updated: rows.length, ids: rows.map((row) => row.id) };
  });
}

export async function deleteResource(
  organizationId: string,
  id: string,
  authorize?: (resource: ResourceRecord) => boolean | Promise<boolean>,
  actor?: string | null,
) {
  const resource = await getResource(organizationId, id);
  if (!resource) return null;
  const deleted = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );
    const [locked] = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.id, id),
          eq(resources.organizationId, organizationId),
        ),
      )
      .for("update");
    if (!locked) return null;
    if (authorize && !(await authorize(locked))) {
      throw new Error("RESOURCE_PERMISSION_DENIED");
    }
    const [linkedVariant] = await transaction
      .select({ id: resourceRelations.id })
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, organizationId),
          eq(resourceRelations.relationTypeKey, "variant_of"),
          eq(resourceRelations.targetResourceId, id),
        ),
      )
      .limit(1);
    if (linkedVariant) {
      throw new Error("RESOURCE_HAS_FIRST_CLASS_VARIANTS");
    }
    const optionValueReferences = await transaction
      .select({
        id: resourceOptionValues.id,
        groupId: resourceOptionValues.groupId,
      })
      .from(resourceOptionValues)
      .where(
        and(
          eq(resourceOptionValues.organizationId, organizationId),
          eq(resourceOptionValues.componentResourceId, id),
        ),
      );
    if (optionValueReferences.length) {
      const valueIds = optionValueReferences.map((value) => value.id);
      const groupIds = Array.from(
        new Set(optionValueReferences.map((value) => value.groupId)),
      );
      const [selectedValue] = await transaction
        .select({ id: resourceOptionSelections.valueId })
        .from(resourceOptionSelections)
        .where(
          and(
            eq(resourceOptionSelections.organizationId, organizationId),
            inArray(resourceOptionSelections.valueId, valueIds),
          ),
        )
        .limit(1);
      if (selectedValue) {
        throw new Error("RESOURCE_USED_BY_OPTION_SELECTION");
      }
      const groupValueCounts = await transaction
        .select({
          groupId: resourceOptionValues.groupId,
          value: count(),
        })
        .from(resourceOptionValues)
        .where(
          and(
            eq(resourceOptionValues.organizationId, organizationId),
            inArray(resourceOptionValues.groupId, groupIds),
          ),
        )
        .groupBy(resourceOptionValues.groupId);
      const referencesPerGroup = new Map<string, number>();
      for (const reference of optionValueReferences) {
        referencesPerGroup.set(
          reference.groupId,
          (referencesPerGroup.get(reference.groupId) ?? 0) + 1,
        );
      }
      if (
        groupValueCounts.some(
          (group) =>
            Number(group.value) - (referencesPerGroup.get(group.groupId) ?? 0) < 2,
        )
      ) {
        throw new Error("RESOURCE_REQUIRED_BY_OPTION_GROUP");
      }
      await transaction
        .delete(resourceOptionValues)
        .where(
          and(
            eq(resourceOptionValues.organizationId, organizationId),
            inArray(resourceOptionValues.id, valueIds),
          ),
        );
    }
    const [spatialAssets, keyframeImages] = await Promise.all([
      transaction
        .select({
          storageKey: roomScanAssets.storageKey,
          url: roomScanAssets.storageUrl,
        })
        .from(roomScanAssets)
        .innerJoin(
          roomScans,
          and(
            eq(roomScans.organizationId, roomScanAssets.organizationId),
            eq(roomScans.id, roomScanAssets.roomScanId),
          ),
        )
        .where(
          and(
            eq(roomScans.organizationId, organizationId),
            eq(roomScans.roomResourceId, id),
          ),
        ),
      transaction
        .select({
          storageKey: roomScanKeyframes.storageKey,
          url: roomScanKeyframes.storageUrl,
        })
        .from(roomScanKeyframes)
        .innerJoin(
          roomScans,
          and(
            eq(roomScans.organizationId, roomScanKeyframes.organizationId),
            eq(roomScans.id, roomScanKeyframes.roomScanId),
          ),
        )
        .where(
          and(
            eq(roomScans.organizationId, organizationId),
            eq(roomScans.roomResourceId, id),
          ),
        ),
    ]);
    await transaction.delete(resources).where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, id),
      ),
    );
    await enqueueWebhookEvent(transaction, {
      organizationId,
      type: "inventory.resource.deleted",
      aggregateType: "resource",
      aggregateId: locked.id,
      actor: actor ?? null,
      data: { resource },
    });
    return [...spatialAssets, ...keyframeImages];
  });
  return deleted ? { ...resource, roomScanAssets: deleted } : null;
}

export async function getDashboardStats(organizationId: string) {
  const [totals] = await db
    .select({
      resources: count(),
      units: sql<number>`coalesce(sum(${resources.quantity}), 0)::int`,
      valueCents: sql<number>`coalesce(sum(${resources.valueCents} * ${resources.quantity}), 0)::bigint`,
      available: sql<number>`count(*) filter (where ${resources.status} = 'available')::int`,
      attention: sql<number>`count(*) filter (where ${resources.status} = 'maintenance')::int`,
    })
    .from(resources)
    .where(eq(resources.organizationId, organizationId));

  const byType = await db
    .select({ type: resources.type, value: count() })
    .from(resources)
    .where(eq(resources.organizationId, organizationId))
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

export async function findDuplicateResources(organizationId: string) {
  const rows = await db
    .select()
    .from(resources)
    .where(eq(resources.organizationId, organizationId))
    .orderBy(desc(resources.updatedAt))
    .limit(1_000);
  const [mediaRows, slugRows] = rows.length
    ? await Promise.all([
        db
          .select()
          .from(media)
          .where(
            and(
              eq(media.organizationId, organizationId),
              inArray(media.resourceId, rows.map((row) => row.id)),
            ),
          ),
        listResourceSlugRows(
          organizationId,
          rows.map((row) => row.id),
        ),
      ])
    : [[], []];
  const enriched = attachMedia(rows, mediaRows, slugRows);
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
  organizationId: string,
  keepId: string,
  duplicateId: string,
  actor?: string,
  authorization?: {
    authorizeUpdate: (
      resource: ResourceRecord,
    ) => boolean | Promise<boolean>;
    authorizeDelete: (
      resource: ResourceRecord,
    ) => boolean | Promise<boolean>;
    authorizeOrders?: () => boolean | Promise<boolean>;
  },
) {
  if (keepId === duplicateId) throw new Error("Choose two different items.");
  const merged = await db.transaction(async (transaction) => {
    // Serialize every BOM graph rewrite, including merges. Otherwise a merge
    // could race a recipe update or collapse an indirect path into a cycle.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})`,
    );

    const lockedResources = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          inArray(resources.id, [keepId, duplicateId]),
        ),
      )
      .orderBy(asc(resources.id))
      .for("update");
    const lockedKeep = lockedResources.find((item) => item.id === keepId);
    const lockedDuplicate = lockedResources.find((item) => item.id === duplicateId);
    if (!lockedKeep || !lockedDuplicate) {
      return false;
    }

    const now = new Date();
    const combinedQuantity = lockedKeep.quantity + lockedDuplicate.quantity;
    const finalKeep = {
      ...lockedKeep,
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
      customFields: {
        ...lockedDuplicate.customFields,
        ...lockedKeep.customFields,
      },
      updatedAt: now,
    } satisfies ResourceRecord;

    if (authorization) {
      const [canUpdateLockedKeep, canDeleteLockedDuplicate, canUpdateFinalKeep] =
        await Promise.all([
          authorization.authorizeUpdate(lockedKeep),
          authorization.authorizeDelete(lockedDuplicate),
          authorization.authorizeUpdate(finalKeep),
        ]);
      if (
        !canUpdateLockedKeep ||
        !canDeleteLockedDuplicate ||
        !canUpdateFinalKeep
      ) {
        throw new Error("RESOURCE_PERMISSION_DENIED");
      }
    }

    const [spatialScan] = await transaction
      .select({ id: roomScans.id })
      .from(roomScans)
      .where(
        and(
          eq(roomScans.organizationId, organizationId),
          inArray(roomScans.roomResourceId, [keepId, duplicateId]),
        ),
      )
      .limit(1);
    if (spatialScan) {
      throw new Error("Rooms with 3D room scans cannot be merged.");
    }

    const [familyLink] = await transaction
      .select({ id: resourceRelations.id })
      .from(resourceRelations)
      .where(
        and(
          eq(resourceRelations.organizationId, organizationId),
          eq(resourceRelations.relationTypeKey, "variant_of"),
          or(
            inArray(resourceRelations.sourceResourceId, [keepId, duplicateId]),
            inArray(resourceRelations.targetResourceId, [keepId, duplicateId]),
          ),
        ),
      )
      .limit(1);
    if (familyLink) {
      throw new Error(
        "Items in a first-class variant family cannot be merged. Archive the duplicate or remove its family membership first.",
      );
    }

    const [variant] = await transaction
      .select({ id: resourceVariants.id })
      .from(resourceVariants)
      .where(
        and(
          eq(resourceVariants.organizationId, organizationId),
          inArray(resourceVariants.resourceId, [keepId, duplicateId]),
        ),
      )
      .limit(1);
    if (variant) {
      throw new Error(
        "Items with variants cannot be merged. Remove empty variants or archive the duplicate so variant stock and identifiers remain unambiguous.",
      );
    }

    const [
      structuredRelation,
      locationBalance,
      inventoryCount,
      cyclePolicy,
      assignment,
      locatedUnit,
    ] = await Promise.all([
      transaction
        .select({ id: resourceRelations.id })
        .from(resourceRelations)
        .where(
          and(
            eq(resourceRelations.organizationId, organizationId),
            or(
              eq(resourceRelations.sourceResourceId, duplicateId),
              eq(resourceRelations.targetResourceId, duplicateId),
            ),
          ),
        )
        .limit(1),
      transaction
        .select({ id: stockLocationBalances.id })
        .from(stockLocationBalances)
        .where(
          and(
            eq(stockLocationBalances.organizationId, organizationId),
            or(
              eq(stockLocationBalances.resourceId, duplicateId),
              eq(stockLocationBalances.locationResourceId, duplicateId),
            ),
          ),
        )
        .limit(1),
      transaction
        .select({ id: inventoryCounts.id })
        .from(inventoryCounts)
        .where(
          and(
            eq(inventoryCounts.organizationId, organizationId),
            eq(inventoryCounts.resourceId, duplicateId),
          ),
        )
        .limit(1),
      transaction
        .select({ resourceId: inventoryCyclePolicies.resourceId })
        .from(inventoryCyclePolicies)
        .where(
          and(
            eq(inventoryCyclePolicies.organizationId, organizationId),
            eq(inventoryCyclePolicies.resourceId, duplicateId),
          ),
        )
        .limit(1),
      transaction
        .select({ id: inventoryAssignments.id })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            or(
              eq(inventoryAssignments.resourceId, duplicateId),
              eq(inventoryAssignments.assigneeResourceId, duplicateId),
            ),
          ),
        )
        .limit(1),
      transaction
        .select({ id: stockUnits.id })
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.locationResourceId, duplicateId),
          ),
        )
        .limit(1),
    ]);
    if (
      structuredRelation.length ||
      locationBalance.length ||
      inventoryCount.length ||
      cyclePolicy.length ||
      assignment.length ||
      locatedUnit.length
    ) {
      throw new Error(
        "These items cannot be merged while the duplicate participates in locations, relationships, counts, cycles, or assignments. Move or archive those records first so their audit history stays intact.",
      );
    }

    const bomEdges = await transaction
      .select({
        parent: bomLines.assemblyResourceId,
        child: bomLines.componentResourceId,
      })
      .from(bomLines)
      .where(eq(bomLines.organizationId, organizationId));
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

    const affectedAssemblyIds = Array.from(
      new Set(
        bomEdges
          .filter(
            (edge) =>
              edge.child === duplicateId &&
              edge.parent !== keepId &&
              edge.parent !== duplicateId,
          )
          .map((edge) => edge.parent),
      ),
    ).sort();
    if (affectedAssemblyIds.length) {
      const affectedAssemblies = await transaction
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, affectedAssemblyIds),
          ),
        )
        .orderBy(asc(resources.id))
        .for("update");
      if (affectedAssemblies.length !== affectedAssemblyIds.length) {
        throw new Error(
          "An assembly affected by this merge no longer exists.",
        );
      }
      if (authorization) {
        const allowed = await Promise.all(
          affectedAssemblies.map((resource) =>
            authorization.authorizeUpdate(resource),
          ),
        );
        if (allowed.some((value) => !value)) {
          throw new Error("RESOURCE_PERMISSION_DENIED");
        }
      }
    }

    const [historicalBuild] = await transaction
      .select({ id: assemblyBuilds.id })
      .from(assemblyBuilds)
      .where(
        and(
          eq(assemblyBuilds.organizationId, organizationId),
          eq(assemblyBuilds.assemblyResourceId, duplicateId),
        ),
      )
      .limit(1);
    const [historicalComponent] = await transaction
      .select({ id: assemblyBuildComponents.id })
      .from(assemblyBuildComponents)
      .where(
        and(
          eq(assemblyBuildComponents.organizationId, organizationId),
          eq(assemblyBuildComponents.componentResourceId, duplicateId),
        ),
      )
      .limit(1);
    if (historicalBuild || historicalComponent) {
      throw new Error(
        "These items cannot be merged because the duplicate is part of completed assembly build history. Archive it instead so the audit trail stays immutable.",
      );
    }

    const duplicateOrderLines = await transaction
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.organizationId, organizationId),
          eq(purchaseOrderLines.resourceId, duplicateId),
        ),
      )
      .orderBy(asc(purchaseOrderLines.id))
      .for("update");
    const receivedOrderLine = duplicateOrderLines.find(
      (line) => line.fulfilledQuantity > 0,
    );
    if (receivedOrderLine) {
      throw new Error(
        "These items cannot be merged because the duplicate has received purchase-order history. Archive it instead so receipt retries and audit records stay immutable.",
      );
    }
    if (
      duplicateOrderLines.length &&
      authorization?.authorizeOrders &&
      !(await authorization.authorizeOrders())
    ) {
      throw new Error("ORDERS_PERMISSION_DENIED");
    }

    const mediaRows = await transaction
      .select()
      .from(media)
      .where(
        and(
          eq(media.organizationId, organizationId),
          inArray(media.resourceId, [keepId, duplicateId]),
        ),
      );
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
        .where(
          and(
            eq(media.organizationId, organizationId),
            eq(media.id, item.id),
          ),
        );
    }

    // Repoint structured relationships before deleting the duplicate. BOM
    // parent collisions keep the canonical item's recipe; component collisions
    // add quantities so an assembly that referenced both aliases keeps the same
    // material requirement.
    const duplicateParentLines = await transaction
      .select()
      .from(bomLines)
      .where(
        and(
          eq(bomLines.organizationId, organizationId),
          eq(bomLines.assemblyResourceId, duplicateId),
        ),
      );
    for (const line of duplicateParentLines) {
      if (line.componentResourceId === keepId) {
        await transaction.delete(bomLines).where(
          and(
            eq(bomLines.organizationId, organizationId),
            eq(bomLines.id, line.id),
          ),
        );
        continue;
      }
      const [collision] = await transaction
        .select({ id: bomLines.id })
        .from(bomLines)
        .where(
          and(
            eq(bomLines.organizationId, organizationId),
            eq(bomLines.assemblyResourceId, keepId),
            eq(bomLines.componentResourceId, line.componentResourceId),
          ),
        )
        .limit(1);
      if (collision) {
        await transaction.delete(bomLines).where(
          and(
            eq(bomLines.organizationId, organizationId),
            eq(bomLines.id, line.id),
          ),
        );
      } else {
        await transaction
          .update(bomLines)
          .set({ assemblyResourceId: keepId, updatedAt: new Date() })
          .where(
            and(
              eq(bomLines.organizationId, organizationId),
              eq(bomLines.id, line.id),
            ),
          );
      }
    }

    const duplicateComponentLines = await transaction
      .select()
      .from(bomLines)
      .where(
        and(
          eq(bomLines.organizationId, organizationId),
          eq(bomLines.componentResourceId, duplicateId),
        ),
      );
    for (const line of duplicateComponentLines) {
      if (line.assemblyResourceId === keepId) {
        await transaction.delete(bomLines).where(
          and(
            eq(bomLines.organizationId, organizationId),
            eq(bomLines.id, line.id),
          ),
        );
        continue;
      }
      const [collision] = await transaction
        .select()
        .from(bomLines)
        .where(
          and(
            eq(bomLines.organizationId, organizationId),
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
            quantityUnit: "base",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bomLines.organizationId, organizationId),
              eq(bomLines.id, collision.id),
            ),
          );
        await transaction.delete(bomLines).where(
          and(
            eq(bomLines.organizationId, organizationId),
            eq(bomLines.id, line.id),
          ),
        );
      } else {
        await transaction
          .update(bomLines)
          .set({
            componentResourceId: keepId,
            quantityUnit: "base",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bomLines.organizationId, organizationId),
              eq(bomLines.id, line.id),
            ),
          );
      }
    }

    for (const line of duplicateOrderLines) {
      const [collision] = await transaction
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.organizationId, organizationId),
            eq(purchaseOrderLines.orderId, line.orderId),
            eq(purchaseOrderLines.resourceId, keepId),
          ),
        )
        .limit(1);
      if (collision) {
        const mergedOrderedQuantity =
          collision.orderedQuantity + line.orderedQuantity;
        const mergedReceivedQuantity =
          collision.fulfilledQuantity + line.fulfilledQuantity;
        const compatiblePurchaseUnit =
          collision.purchaseUnitName === line.purchaseUnitName &&
          collision.purchaseUnitFactor === line.purchaseUnitFactor &&
          mergedOrderedQuantity % collision.purchaseUnitFactor === 0 &&
          mergedReceivedQuantity % collision.purchaseUnitFactor === 0;
        await transaction
          .update(purchaseOrderLines)
          .set({
            orderedQuantity: mergedOrderedQuantity,
            fulfilledQuantity: mergedReceivedQuantity,
            purchaseUnitName: compatiblePurchaseUnit
              ? collision.purchaseUnitName
              : null,
            purchaseUnitFactor: compatiblePurchaseUnit
              ? collision.purchaseUnitFactor
              : 1,
            ...(compatiblePurchaseUnit
              ? {}
              : { unitPriceCents: null, priceCurrency: null }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(purchaseOrderLines.organizationId, organizationId),
              eq(purchaseOrderLines.id, collision.id),
            ),
          );
        await transaction
          .update(orderLineUnits)
          .set({ orderLineId: collision.id, updatedAt: new Date() })
          .where(
            and(
              eq(orderLineUnits.organizationId, organizationId),
              eq(orderLineUnits.orderLineId, line.id),
            ),
          );
        await transaction
          .delete(purchaseOrderLines)
          .where(
            and(
              eq(purchaseOrderLines.organizationId, organizationId),
              eq(purchaseOrderLines.id, line.id),
            ),
          );
      } else {
        await transaction
          .update(purchaseOrderLines)
          .set({ resourceId: keepId, updatedAt: new Date() })
          .where(
            and(
              eq(purchaseOrderLines.organizationId, organizationId),
              eq(purchaseOrderLines.id, line.id),
            ),
          );
      }
    }

    const settingsRows = await transaction
      .select()
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          inArray(stockSettings.resourceId, [keepId, duplicateId]),
        ),
      );
    const keepSettings = settingsRows.find((item) => item.resourceId === keepId);
    const duplicateSettings = settingsRows.find(
      (item) => item.resourceId === duplicateId,
    );
    const finalTrackingMode =
      keepSettings?.trackingMode === "serialized" ||
      duplicateSettings?.trackingMode === "serialized"
        ? ("serialized" as const)
        : ("bulk" as const);
    const finalUnitName =
      keepSettings?.unitName && keepSettings.unitName !== "unit"
        ? keepSettings.unitName
        : duplicateSettings?.unitName ?? keepSettings?.unitName ?? "unit";
    const finalPurchaseUnitSettings =
      keepSettings?.purchaseUnitName && keepSettings.unitName === finalUnitName
        ? keepSettings
        : duplicateSettings?.purchaseUnitName &&
            duplicateSettings.unitName === finalUnitName
          ? duplicateSettings
          : null;

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
            organizationId,
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
      const openingMovements = await transaction
        .insert(stockMovements)
        .values(
          createdUnits.map((unit) => ({
            organizationId,
            resourceId: resource.id,
            unitId: unit.id,
            delta: 0,
            quantity: 1,
            balanceAfter: resource.quantity,
            type: "serialization-opening",
            reason: "Bulk stock converted during inventory merge",
            note: "",
            location: unit.location,
            occurredAt: now,
            createdBy: actor ?? null,
          })),
        )
        .returning();
      await enqueueStockMovementWebhookEvents(transaction, openingMovements);
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
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.resourceId, keepId),
          ),
        ),
      transaction
        .select({ id: stockUnits.id, code: stockUnits.code })
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.resourceId, duplicateId),
          ),
        ),
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
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.id, unit.id),
          ),
        );
      usedCodes.add(mergedCode);
    }

    await transaction
      .update(stockUnits)
      .set({ resourceId: keepId, updatedAt: now })
      .where(
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.resourceId, duplicateId),
        ),
      );
    await transaction
      .update(stockMovements)
      .set({ resourceId: keepId })
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, duplicateId),
        ),
      );

    await transaction
      .insert(stockSettings)
      .values({
        organizationId,
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
        unitName: finalUnitName,
        purchaseUnitName: finalPurchaseUnitSettings?.purchaseUnitName ?? null,
        purchaseUnitFactor: finalPurchaseUnitSettings?.purchaseUnitFactor ?? null,
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
          unitName: finalUnitName,
          purchaseUnitName: finalPurchaseUnitSettings?.purchaseUnitName ?? null,
          purchaseUnitFactor: finalPurchaseUnitSettings?.purchaseUnitFactor ?? null,
          updatedAt: now,
        },
      });

    await transaction
      .update(resources)
      .set({
        description: finalKeep.description,
        quantity: finalKeep.quantity,
        location: finalKeep.location,
        serialNumber: finalKeep.serialNumber,
        valueCents: finalKeep.valueCents,
        tags: finalKeep.tags,
        categories: finalKeep.categories,
        customFields: finalKeep.customFields,
        updatedAt: finalKeep.updatedAt,
      })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, keepId),
        ),
      );
    const [mergeMovement] = await transaction
      .insert(stockMovements)
      .values({
        organizationId,
        resourceId: keepId,
        // The duplicate ledger is repointed above, so its deltas already explain
        // the transferred quantity. This row is an audit marker, not another receipt.
        delta: 0,
        quantity: 0,
        balanceAfter: combinedQuantity,
        type: "merge",
        reason: `Merged stock from ${lockedDuplicate.name}`,
        note: `Source inventory ID: ${duplicateId}`,
        location: lockedKeep.location || lockedDuplicate.location,
        occurredAt: now,
        createdBy: actor ?? null,
      })
      .returning();
    await enqueueStockMovementWebhookEvents(transaction, [mergeMovement]);
    const mergedMedia = [
      ...keepMedia,
      ...duplicateMedia.map((item, index) => ({
        ...item,
        resourceId: keepId,
        position: highestPosition + index + 1,
      })),
    ].sort((left, right) => left.position - right.position);
    await enqueueWebhookEvent(transaction, {
      organizationId,
      type: "inventory.resource.merged",
      aggregateType: "resource",
      aggregateId: keepId,
      actor: actor ?? null,
      data: {
        keptResource: {
          ...finalKeep,
          media: mergedMedia,
          cover: mergedMedia.find((item) => item.kind === "image") ?? null,
        },
        removedResource: {
          ...lockedDuplicate,
          media: duplicateMedia,
          cover: duplicateMedia.find((item) => item.kind === "image") ?? null,
        },
        keptResourceId: keepId,
        removedResourceId: duplicateId,
      },
    });
    await transaction.delete(resources).where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, duplicateId),
      ),
    );
    return true;
  });

  return merged ? getResource(organizationId, keepId) : null;
}
