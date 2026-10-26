import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { media, resourceRelations, type MediaRecord } from "@/db/schema";
import { db } from "@/lib/db";

/** Resolve display covers without adding inherited files to editable media. */
export async function getResourceCoverMap(
  organizationId: string,
  resourceIds: readonly string[],
  ownMedia?: readonly MediaRecord[],
  executor: Pick<typeof db, "selectDistinctOn"> = db,
) {
  const ids = Array.from(new Set(resourceIds));
  const covers = new Map<string, MediaRecord>();
  if (!ids.length) return covers;

  const rows = ownMedia ?? await executor
    .selectDistinctOn([media.resourceId])
    .from(media)
    .where(and(
      eq(media.organizationId, organizationId),
      inArray(media.resourceId, ids),
      eq(media.kind, "image"),
    ))
    .orderBy(asc(media.resourceId), asc(media.position), asc(media.createdAt), asc(media.id));

  for (const item of [...rows].sort((left, right) =>
    left.position - right.position ||
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id),
  )) {
    if (item.kind === "image" && !covers.has(item.resourceId)) {
      covers.set(item.resourceId, item);
    }
  }

  const missingIds = ids.filter((id) => !covers.has(id));
  if (!missingIds.length) return covers;

  const inherited = await executor
    .selectDistinctOn([resourceRelations.sourceResourceId])
    .from(resourceRelations)
    .innerJoin(media, and(
      eq(media.resourceId, resourceRelations.targetResourceId),
      eq(media.organizationId, organizationId),
      eq(media.kind, "image"),
    ))
    .where(and(
      eq(resourceRelations.organizationId, organizationId),
      eq(resourceRelations.relationTypeKey, "variant_of"),
      inArray(resourceRelations.sourceResourceId, missingIds),
    ))
    .orderBy(
      asc(resourceRelations.sourceResourceId),
      asc(media.position),
      asc(media.createdAt),
      asc(media.id),
    );

  for (const row of inherited) {
    covers.set(row.resource_relations.sourceResourceId, row.media);
  }
  return covers;
}

export async function getResourceCoverSummaries(
  organizationId: string,
  resourceIds: readonly string[],
  executor: Pick<typeof db, "selectDistinctOn"> = db,
) {
  const covers = await getResourceCoverMap(organizationId, resourceIds, undefined, executor);
  return Array.from(covers, ([resourceId, cover]) => ({
    id: cover.id,
    resourceId,
    url: cover.url,
    altText: cover.altText,
    width: cover.width,
    height: cover.height,
  }));
}
