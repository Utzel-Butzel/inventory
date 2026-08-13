import { and, eq } from "drizzle-orm";

import { media } from "@/db/schema";
import { requireResourcePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { deleteStoredMedia } from "@/lib/storage";

type Context = { params: Promise<{ id: string; mediaId: string }> };

export async function DELETE(request: Request, context: Context) {
  const { id, mediaId } = await context.params;
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id,
  );
  if (authorization.response) return authorization.response;
  const [item] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.resourceId, id)))
    .limit(1);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  await db.delete(media).where(eq(media.id, item.id));
  await deleteStoredMedia(item);
  return new Response(null, { status: 204 });
}
