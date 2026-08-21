import { getPublicSharedMedia } from "@/lib/public-shares";
import { getOrCreateImageVariant } from "@/lib/image-variants";
import { parseMediaImageVariant } from "@/lib/media-image";
import { isInlinePublicMediaType } from "@/lib/resource-media-contract";
import { readMediaBytes } from "@/lib/storage";

type Context = {
  params: Promise<{ shareId: string; mediaId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unavailable = () =>
  Response.json(
    { error: "Not found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );

export async function GET(request: Request, context: Context) {
  const { shareId, mediaId } = await context.params;
  const item = await getPublicSharedMedia(shareId, mediaId);
  if (!item) return unavailable();
  try {
    const url = new URL(request.url);
    const variantRequested = url.searchParams.has("w") || url.searchParams.has("fit");
    const variant = variantRequested
      ? parseMediaImageVariant(url.searchParams)
      : null;
    if (variantRequested && !variant) return unavailable();
    if (variant) {
      if (
        item.kind !== "image" ||
        !item.mimeType.startsWith("image/") ||
        item.mimeType === "image/svg+xml"
      ) {
        return unavailable();
      }
      const bytes = await getOrCreateImageVariant(
        item,
        variant.width,
        variant.fit,
        () => readMediaBytes(item),
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(bytes.length),
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${item.name.replace(/\.[^.]+$/, "")}-${variant.width}.webp`)}`,
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
    const bytes = await readMediaBytes(item);
    const safeInline = isInlinePublicMediaType(item.mimeType);
    return new Response(bytes, {
      headers: {
        "Content-Type": item.mimeType || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return unavailable();
  }
}
