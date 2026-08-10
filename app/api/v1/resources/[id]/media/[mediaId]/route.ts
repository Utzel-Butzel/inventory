import { and, eq } from "drizzle-orm";

import { media } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { deleteStoredMedia } from "@/lib/storage";

type Context = { params: Promise<{ id: string; mediaId: string }> };

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const { id, mediaId } = await context.params;
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
