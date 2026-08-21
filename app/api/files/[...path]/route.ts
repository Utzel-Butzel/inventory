import { and, eq } from "drizzle-orm";

import { media } from "@/db/schema";
import { requirePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  getOrCreateImageVariant,
  imageVariantEtag,
} from "@/lib/image-variants";
import { parseMediaImageVariant } from "@/lib/media-image";
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
    .where(
      and(
        eq(media.organizationId, authorization.identity.organizationId),
        eq(media.storageKey, storageKey),
      ),
    )
    .limit(1);
  if (!item || !item.url.startsWith("/api/files/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const url = new URL(request.url);
    const variantRequested = url.searchParams.has("w") || url.searchParams.has("fit");
    const variant = variantRequested
      ? parseMediaImageVariant(url.searchParams)
      : null;
    if (variantRequested && !variant) {
      return Response.json({ error: "Invalid image variant." }, { status: 422 });
    }
    if (variant) {
      if (
        item.kind !== "image" ||
        !item.mimeType.startsWith("image/") ||
        item.mimeType === "image/svg+xml"
      ) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
      const etag = imageVariantEtag(item, variant.width, variant.fit);
      const headers = {
        "Cache-Control": "private, max-age=86400",
        ETag: etag,
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      };
      if (request.headers.get("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers });
      }
      const bytes = await getOrCreateImageVariant(
        item,
        variant.width,
        variant.fit,
        () => readLocalMedia(item.storageKey),
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...headers,
          "Content-Type": "image/webp",
          "Content-Length": String(bytes.length),
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${item.name.replace(/\.[^.]+$/, "")}-${variant.width}.webp`)}`,
          "Content-Security-Policy": "sandbox; default-src 'none'",
        },
      });
    }
    const bytes = await readLocalMedia(item.storageKey);
    return new Response(bytes, {
      headers: {
        "Content-Type": item.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "Cache-Control": "private, max-age=3600",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
}
