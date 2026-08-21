import { and, eq } from "drizzle-orm";

import { media } from "@/db/schema";
import { requirePermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  getOrCreateImageVariant,
  imageVariantEtag,
} from "@/lib/image-variants";
import {
  normalizeMediaImageFit,
  normalizeMediaImageVariantWidth,
} from "@/lib/media-image";
import { readMediaBytes } from "@/lib/storage";

type Context = {
  params: Promise<{ id: string; fit: string; width: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailable = () =>
  Response.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;

  const params = await context.params;
  const width = normalizeMediaImageVariantWidth(params.width);
  const fit = normalizeMediaImageFit(params.fit);
  if (!width || !fit) return unavailable();

  const [item] = await db
    .select()
    .from(media)
    .where(
      and(
        eq(media.id, params.id),
        eq(media.organizationId, authorization.identity.organizationId),
        eq(media.kind, "image"),
      ),
    )
    .limit(1);
  if (
    !item ||
    !item.mimeType.startsWith("image/") ||
    item.mimeType === "image/svg+xml"
  ) {
    return unavailable();
  }

  const etag = imageVariantEtag(item, width, fit);
  const cacheHeaders = {
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }

  try {
    const bytes = await getOrCreateImageVariant(item, width, fit, () =>
      readMediaBytes(item),
    );
    const basename = item.name.replace(/\.[^.]+$/, "") || "image";
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...cacheHeaders,
        "Content-Type": "image/webp",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${basename}-${width}.webp`)}`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch {
    return unavailable();
  }
}
