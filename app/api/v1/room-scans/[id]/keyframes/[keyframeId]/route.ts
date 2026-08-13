import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { getRoomScanKeyframe } from "@/lib/room-scans";
import { readMediaBytes } from "@/lib/storage";

type Context = {
  params: Promise<{ id: string; keyframeId: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "spatial.read");
  if (authorization.response) return authorization.response;

  const identifiers = z.object({ id: z.uuid(), keyframeId: z.uuid() }).safeParse(
    await context.params,
  );
  if (!identifiers.success) {
    return Response.json(
      { error: "Invalid room scan or keyframe identifier." },
      { status: 422 },
    );
  }
  const keyframe = await getRoomScanKeyframe(
    authorization.identity.organizationId,
    identifiers.data.id,
    identifiers.data.keyframeId,
  );
  if (!keyframe) {
    return Response.json({ error: "Room keyframe not found." }, { status: 404 });
  }
  try {
    const bytes = await readMediaBytes({
      storageKey: keyframe.storageKey,
      url: keyframe.storageUrl,
    });
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${keyframe.checksumSha256}"`,
      },
    });
  } catch {
    return Response.json(
      { error: "Room keyframe image not found." },
      { status: 404 },
    );
  }
}
