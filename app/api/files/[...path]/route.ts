import { eq } from "drizzle-orm";

import { media } from "@/db/schema";
import { requirePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { readLocalMedia } from "@/lib/storage";

type Context = { params: Promise<{ path: string[] }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const { path: segments } = await context.params;
  const storageKey = segments.join("/");
  const [item] = await db
    .select()
    .from(media)
    .where(eq(media.storageKey, storageKey))
    .limit(1);
  if (!item || !item.url.startsWith("/api/files/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const bytes = await readLocalMedia(item.storageKey);
    return new Response(bytes, {
      headers: {
        "Content-Type": item.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
}
