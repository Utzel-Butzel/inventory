import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { resourceSlugs, resources } from "@/db/schema";
import { db } from "@/lib/db";
import {
  isResourceUuid,
  resourceSlugSchema,
} from "@/lib/resource-slug-contract";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ResourceSlugExecutor = typeof db | Transaction;

export async function listResourceSlugRows(
  organizationId: string,
  resourceIds: readonly string[],
  executor: Pick<ResourceSlugExecutor, "select"> = db,
) {
  const ids = Array.from(new Set(resourceIds));
  if (!ids.length) return [];

  return executor
    .select({
      resourceId: resourceSlugs.resourceId,
      slug: resourceSlugs.slug,
      position: resourceSlugs.position,
    })
    .from(resourceSlugs)
    .where(
      and(
        eq(resourceSlugs.organizationId, organizationId),
        inArray(resourceSlugs.resourceId, ids),
      ),
    )
    .orderBy(
      asc(resourceSlugs.resourceId),
      asc(resourceSlugs.position),
      asc(resourceSlugs.slug),
    );
}

export async function replaceResourceSlugs(
  executor: Pick<ResourceSlugExecutor, "delete" | "insert">,
  options: {
    organizationId: string;
    resourceId: string;
    slugs: readonly string[];
    actor?: string | null;
  },
) {
  await executor
    .delete(resourceSlugs)
    .where(
      and(
        eq(resourceSlugs.organizationId, options.organizationId),
        eq(resourceSlugs.resourceId, options.resourceId),
      ),
    );

  if (!options.slugs.length) return;
  await executor.insert(resourceSlugs).values(
    options.slugs.map((slug, position) => ({
      organizationId: options.organizationId,
      resourceId: options.resourceId,
      slug,
      position,
      createdBy: options.actor ?? null,
    })),
  );
}

export async function resolveResourceId(
  organizationId: string,
  reference: string,
) {
  if (isResourceUuid(reference)) {
    const [resource] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, reference),
        ),
      )
      .limit(1);
    return resource?.id ?? null;
  }

  const parsed = resourceSlugSchema.safeParse(reference);
  if (!parsed.success) return null;
  const [slug] = await db
    .select({ resourceId: resourceSlugs.resourceId })
    .from(resourceSlugs)
    .where(
      and(
        eq(resourceSlugs.organizationId, organizationId),
        eq(resourceSlugs.slug, parsed.data),
      ),
    )
    .limit(1);
  return slug?.resourceId ?? null;
}
