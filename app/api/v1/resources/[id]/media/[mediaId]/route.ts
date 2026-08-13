import { and, asc, eq } from "drizzle-orm";

import { media, resources } from "@/db/schema";
import { requireResourcePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { deleteStoredMedia } from "@/lib/storage";
import { enqueueWebhookEvent } from "@/lib/webhooks";

type Context = { params: Promise<{ id: string; mediaId: string }> };

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
      .where(eq(resources.id, id))
      .limit(1)
      .for("update");
    if (!resource) throw new Error("Resource disappeared while deleting media.");
    const [deleted] = await transaction
      .delete(media)
      .where(and(eq(media.id, mediaId), eq(media.resourceId, id)))
      .returning();
    if (!deleted) return null;
    const remainingMedia = await transaction
      .select()
      .from(media)
      .where(eq(media.resourceId, id))
      .orderBy(asc(media.position));
    await enqueueWebhookEvent(transaction, {
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
