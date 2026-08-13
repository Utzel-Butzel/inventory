import { getPublicSharedMedia } from "@/lib/public-shares";
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

export async function GET(_request: Request, context: Context) {
  const { shareId, mediaId } = await context.params;
  const item = await getPublicSharedMedia(shareId, mediaId);
  if (!item) return unavailable();
  try {
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
