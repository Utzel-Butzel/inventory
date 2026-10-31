import { and, asc, eq } from "drizzle-orm";

import { media, resources } from "@/db/schema";
import { requireResourcePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { deleteStoredMedia } from "@/lib/storage";
import { enqueueWebhookEvent } from "@/lib/webhooks";
import { z } from "zod";

const previewInput = z.object({
  previewMediaId: z.string().uuid().nullable(),
  posterMediaId: z.string().uuid().nullable(),
}).strict();

type Context = { params: Promise<{ id: string; mediaId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id, mediaId } = await context.params;
  const authorization = await requireResourcePermission(request, "inventory.update", id);
  if (authorization.response) return authorization.response;
  const parsed = previewInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid video preview references." }, { status: 422 });
  const organizationId = authorization.identity.organizationId;
  return db.transaction(async (transaction) => {
    const [resource] = await transaction.select().from(resources).where(and(
      eq(resources.organizationId, organizationId), eq(resources.id, id),
    )).for("update");
    if (!resource) return Response.json({ error: "Not found" }, { status: 404 });
    const attachments = await transaction.select().from(media).where(and(
      eq(media.organizationId, organizationId), eq(media.resourceId, id),
    ));
    const target = attachments.find((item) => item.id === mediaId);
    if (!target) return Response.json({ error: "Not found" }, { status: 404 });
    if (target.kind !== "video") return Response.json({ error: "Only videos can have previews." }, { status: 422 });
    for (const [field, kind] of [["previewMediaId", "video"], ["posterMediaId", "image"]] as const) {
      const reference = parsed.data[field];
      if (reference === null) continue;
      const candidate = attachments.find((item) => item.id === reference);
      if (!candidate || candidate.id === mediaId || candidate.kind !== kind ||
          !candidate.mimeType.startsWith(`${kind}/`) || candidate.mimeType === "image/svg+xml" ||
          (kind === "video" && (candidate.previewMediaId || candidate.posterMediaId)) ||
          attachments.some((item) => item.previewMediaId === mediaId)) {
        return Response.json({ error: "Choose a matching attachment from this item. Preview chains are not supported." }, { status: 422 });
      }
    }
    const [updated] = await transaction.update(media).set(parsed.data).where(and(
      eq(media.organizationId, organizationId), eq(media.resourceId, id), eq(media.id, mediaId),
    )).returning();
    await enqueueWebhookEvent(transaction, {
      organizationId, type: "inventory.resource.updated", aggregateType: "resource", aggregateId: id,
      actor: authorization.identity.subject,
      data: { resource: { ...resource, media: attachments.map((item) => item.id === mediaId ? updated : item) }, changedFields: ["media"] },
    });
    return Response.json({ media: updated });
  });
}

export async function DELETE(request: Request, context: Context) {
  const { id, mediaId } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;
  const item = await db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, authorization.identity.organizationId),
          eq(resources.id, id),
        ),
      )
      .limit(1)
      .for("update");
    if (!resource) throw new Error("Resource disappeared while deleting media.");
    const [deleted] = await transaction
      .delete(media)
      .where(
        and(
          eq(media.organizationId, authorization.identity.organizationId),
          eq(media.id, mediaId),
          eq(media.resourceId, id),
        ),
      )
      .returning();
    if (!deleted) return null;
    const remainingMedia = await transaction
      .select()
      .from(media)
      .where(
        and(
          eq(media.organizationId, authorization.identity.organizationId),
          eq(media.resourceId, id),
        ),
      )
      .orderBy(asc(media.position));
    await enqueueWebhookEvent(transaction, {
      organizationId: authorization.identity.organizationId,
      type: "inventory.resource.updated",
      aggregateType: "resource",
      aggregateId: id,
      actor: authorization.identity.subject,
      data: {
        resource: {
          ...resource,
          media: remainingMedia,
          cover: remainingMedia.find((entry) => entry.kind === "image") ?? null,
        },
        changedFields: ["media", "cover"],
      },
    });
    return deleted;
  });
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteStoredMedia(item);
  return new Response(null, { status: 204 });
}
