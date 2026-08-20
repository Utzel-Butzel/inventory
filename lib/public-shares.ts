import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  media,
  publicShares,
  resources,
  type MediaRecord,
  type PublicShareRecord,
  type ResourceRecord,
} from "@/db/schema";
import { listCustomFieldDefinitions } from "@/lib/custom-fields";
import { db } from "@/lib/db";
import {
  isPublicShareFilterValueCompatible,
  publicShareIdSchema,
  publicShareFilterSchema,
  type PublicShareCreateInput,
  type PublicShareFilter,
} from "@/lib/public-share-contract";

export class PublicShareError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 422,
  ) {
    super(message);
    this.name = "PublicShareError";
  }
}

export type PublicShareSummary = {
  id: string;
  name: string;
  scope: PublicShareRecord["scope"];
  resourceId: string | null;
  resourceName: string | null;
  filter: PublicShareFilter | null;
  createdBy: string | null;
  createdAt: string;
};

export type PublicCustomFieldDefinition = {
  key: string;
  label: string;
  fieldType: Exclude<
    Awaited<ReturnType<typeof listCustomFieldDefinitions>>[number]["fieldType"],
    "reference"
  >;
  options: Array<{ value: string; label: string; color?: string }>;
};

export type PublicMedia = Pick<
  MediaRecord,
  | "id"
  | "name"
  | "mimeType"
  | "kind"
  | "size"
  | "width"
  | "height"
  | "position"
  | "altText"
> & { url: string };

export type PublicResource = Pick<
  ResourceRecord,
  | "id"
  | "name"
  | "description"
  | "type"
  | "status"
  | "sku"
  | "quantity"
  | "location"
  | "tags"
  | "categories"
> & {
  customFields: Record<string, string | number | boolean | string[]>;
  media: PublicMedia[];
  cover: PublicMedia | null;
};

const summaryDto = (
  row: PublicShareRecord,
  resourceName: string | null = null,
): PublicShareSummary => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  resourceId: row.resourceId,
  resourceName,
  filter: row.filter,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

const validShareFilter = (share: PublicShareRecord) => {
  if (share.filter === null) return null;
  const parsed = publicShareFilterSchema.safeParse(share.filter);
  return parsed.success ? parsed.data : undefined;
};

const shareResourceCondition = (share: PublicShareRecord): SQL | null => {
  if (share.scope === "item") {
    return share.resourceId ? eq(resources.id, share.resourceId) : null;
  }
  const filter = validShareFilter(share);
  if (filter === undefined) return null;
  if (filter === null) return sql`true`;
  return sql`(${resources.customFields} -> ${filter.fieldKey}) = ${JSON.stringify(
    filter.value,
  )}::jsonb`;
};

const publicMediaUrl = (shareId: string, mediaId: string) =>
  `/api/public/shares/${encodeURIComponent(shareId)}/media/${encodeURIComponent(mediaId)}`;

function attachPublicMedia(
  shareId: string,
  rows: ResourceRecord[],
  mediaRows: MediaRecord[],
): PublicResource[] {
  const grouped = new Map<string, PublicMedia[]>();
  const publicUrls = new Map<string, Map<string, string>>();
  for (const item of mediaRows) {
    const shareUrl = publicMediaUrl(shareId, item.id);
    const publicItem: PublicMedia = {
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      kind: item.kind,
      size: item.size,
      width: item.width,
      height: item.height,
      position: item.position,
      altText: item.altText,
      url: shareUrl,
    };
    const entries = grouped.get(item.resourceId) ?? [];
    entries.push(publicItem);
    grouped.set(item.resourceId, entries);

    const resourceUrls = publicUrls.get(item.resourceId) ?? new Map();
    resourceUrls.set(item.url, shareUrl);
    publicUrls.set(item.resourceId, resourceUrls);
  }

  return rows.map((row) => {
    const resourceMedia = (grouped.get(row.id) ?? []).sort(
      (left, right) => left.position - right.position,
    );
    return {
      id: row.id,
      name: row.name,
      description: Array.from(publicUrls.get(row.id) ?? []).reduce(
        (description, [privateUrl, publicUrl]) =>
          description.replaceAll(privateUrl, publicUrl),
        row.description,
      ),
      type: row.type,
      status: row.status,
      sku: row.sku,
      quantity: row.quantity,
      location: row.location,
      tags: row.tags,
      categories: row.categories,
      customFields: row.customFields,
      media: resourceMedia,
      cover:
        resourceMedia.find(
          (item) =>
            item.kind === "image" &&
            item.mimeType.startsWith("image/") &&
            item.mimeType !== "image/svg+xml",
        ) ?? null,
    };
  });
}

async function publicCustomFieldDefinitions(organizationId: string) {
  const definitions = await listCustomFieldDefinitions({
    organizationId,
    entityType: "inventory",
  });
  return definitions
    .filter((definition) => definition.fieldType !== "reference")
    .map(
      (definition): PublicCustomFieldDefinition => ({
        key: definition.key,
        label: definition.label,
        fieldType: definition.fieldType as PublicCustomFieldDefinition["fieldType"],
        options: definition.options.map((option) => ({
          value: option.value,
          label: option.label,
          ...(option.color ? { color: option.color } : {}),
        })),
      }),
    );
}

function redactReferenceFields(
  rows: PublicResource[],
  definitions: PublicCustomFieldDefinition[],
) {
  const publicKeys = new Set(definitions.map((definition) => definition.key));
  return rows.map((row) => ({
    ...row,
    customFields: Object.fromEntries(
      Object.entries(row.customFields).filter(([key]) => publicKeys.has(key)),
    ),
  }));
}

export async function listPublicShares(organizationId: string) {
  const rows = await db
    .select({ share: publicShares, resourceName: resources.name })
    .from(publicShares)
    .leftJoin(resources, eq(publicShares.resourceId, resources.id))
    .where(
      and(
        eq(publicShares.organizationId, organizationId),
        isNull(publicShares.revokedAt),
      ),
    )
    .orderBy(desc(publicShares.createdAt));
  return rows.map((row) => summaryDto(row.share, row.resourceName));
}

export async function createPublicShare(
  organizationId: string,
  input: PublicShareCreateInput,
  actor: string,
) {
  if (input.scope === "item") {
    const [resource] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, input.resourceId),
        ),
      )
      .limit(1);
    if (!resource) throw new PublicShareError("Inventory item not found.", 404);
  } else if (input.filter) {
    const definitions = await listCustomFieldDefinitions({
      organizationId,
      entityType: "inventory",
    });
    const definition = definitions.find(
      (candidate) => candidate.key === input.filter?.fieldKey,
    );
    if (!definition) {
      throw new PublicShareError(
        "The selected custom field is not active.",
        422,
      );
    }
    if (!isPublicShareFilterValueCompatible(definition, input.filter.value)) {
      throw new PublicShareError(
        `The filter value is not valid for ${definition.label}.`,
        422,
      );
    }
  }

  const [created] = await db
    .insert(publicShares)
    .values({
      organizationId,
      name: input.name,
      scope: input.scope,
      resourceId: input.scope === "item" ? input.resourceId : null,
      filter: input.scope === "inventory" ? input.filter ?? null : null,
      createdBy: actor,
    })
    .returning();

  let resourceName: string | null = null;
  if (created.resourceId) {
    const [resource] = await db
      .select({ name: resources.name })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, created.resourceId),
        ),
      )
      .limit(1);
    resourceName = resource?.name ?? null;
  }
  return summaryDto(created, resourceName);
}

export async function revokePublicShare(organizationId: string, id: string) {
  if (!publicShareIdSchema.safeParse(id).success) return false;
  const [revoked] = await db
    .update(publicShares)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(publicShares.organizationId, organizationId),
        eq(publicShares.id, id),
        isNull(publicShares.revokedAt),
      ),
    )
    .returning({ id: publicShares.id });
  return Boolean(revoked);
}

export async function getActivePublicShare(id: string) {
  if (!publicShareIdSchema.safeParse(id).success) return null;
  const [share] = await db
    .select()
    .from(publicShares)
    .where(and(eq(publicShares.id, id), isNull(publicShares.revokedAt)))
    .limit(1);
  return share ?? null;
}

export async function listPublicShareResources(options: {
  share: PublicShareRecord;
  query?: string;
  page?: number;
  pageSize?: number;
}) {
  const requestedPage = options.page ?? 1;
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(10_000, Math.max(1, requestedPage))
    : 1;
  const requestedPageSize = options.pageSize ?? 24;
  const pageSize = Number.isSafeInteger(requestedPageSize)
    ? Math.min(48, Math.max(1, requestedPageSize))
    : 24;
  const query = options.query?.trim().slice(0, 240);
  const shareCondition = shareResourceCondition(options.share);
  if (!shareCondition) {
    return {
      resources: [],
      definitions: [],
      pagination: { page, pageSize, total: 0, pages: 1 },
    };
  }
  const conditions: SQL[] = [
    eq(resources.organizationId, options.share.organizationId),
    shareCondition,
  ];
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(
      or(
        ilike(resources.name, pattern),
        ilike(resources.description, pattern),
        ilike(resources.sku, pattern),
        ilike(resources.location, pattern),
        sql`${resources.tags}::text ILIKE ${pattern}`,
      )!,
    );
  }
  const where = and(...conditions);
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
        .where(
          and(
            eq(media.organizationId, options.share.organizationId),
            inArray(media.resourceId, rows.map((row) => row.id)),
          ),
        )
        .orderBy(asc(media.position))
    : [];
  const total = totalRows[0]?.value ?? 0;
  const definitions = await publicCustomFieldDefinitions(
    options.share.organizationId,
  );
  return {
    resources: redactReferenceFields(
      attachPublicMedia(options.share.id, rows, mediaRows),
      definitions,
    ),
    definitions,
    pagination: {
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export async function getPublicSharedResource(
  share: PublicShareRecord,
  resourceId?: string,
) {
  const requestedId = resourceId ?? share.resourceId;
  if (!requestedId || !publicShareIdSchema.safeParse(requestedId).success) return null;
  const shareCondition = shareResourceCondition(share);
  if (!shareCondition) return null;
  const [row] = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, share.organizationId),
        eq(resources.id, requestedId),
        shareCondition,
      ),
    )
    .limit(1);
  if (!row) return null;
  const mediaRows = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.organizationId, share.organizationId),
        eq(media.resourceId, row.id),
      ),
    )
    .orderBy(asc(media.position));
  const definitions = await publicCustomFieldDefinitions(share.organizationId);
  const resource = redactReferenceFields(
    attachPublicMedia(share.id, [row], mediaRows),
    definitions,
  )[0] ?? null;
  return resource ? { resource, definitions } : null;
}

export async function getPublicSharedMedia(shareId: string, mediaId: string) {
  const share = await getActivePublicShare(shareId);
  if (!share || !publicShareIdSchema.safeParse(mediaId).success) return null;
  const shareCondition = shareResourceCondition(share);
  if (!shareCondition) return null;
  const [row] = await db
    .select({ item: media })
    .from(media)
    .innerJoin(resources, eq(media.resourceId, resources.id))
    .where(
      and(
        eq(media.organizationId, share.organizationId),
        eq(resources.organizationId, share.organizationId),
        eq(media.id, mediaId),
        shareCondition,
      ),
    )
    .limit(1);
  return row?.item ?? null;
}
