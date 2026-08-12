import type { RoomScanAssetKind } from "@/db/schema";
import { z } from "zod";
import { requireIdentity } from "@/lib/api-auth";
import {
  roomScanAssetContentDisposition,
  roomScanAssetMimeType,
} from "@/lib/room-scan-upload-policy";
import { getRoomScanAsset } from "@/lib/room-scans";
import { readMediaBytes } from "@/lib/storage";

type Context = { params: Promise<{ id: string; kind: string }> };

const allowedKinds = new Set<RoomScanAssetKind>([
  "world_map",
  "model_usdz",
  "guide_image",
]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const { id, kind } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid room scan identifier." }, { status: 422 });
  }
  if (!allowedKinds.has(kind as RoomScanAssetKind)) {
    return Response.json({ error: "Unknown room scan asset." }, { status: 404 });
  }
  const asset = await getRoomScanAsset(id, kind as RoomScanAssetKind);
  if (!asset) return Response.json({ error: "Room scan asset not found." }, { status: 404 });

  try {
    const bytes = await readMediaBytes({
      storageKey: asset.storageKey,
      url: asset.storageUrl,
    });
    return new Response(bytes, {
      headers: {
        "Content-Type": roomScanAssetMimeType(kind as RoomScanAssetKind),
        "Content-Length": String(bytes.length),
        "Content-Disposition": roomScanAssetContentDisposition(asset.name),
        "Cache-Control": "private, max-age=3600",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        ETag: `"${asset.checksumSha256}"`,
      },
    });
  } catch {
    return Response.json({ error: "Room scan asset file not found." }, { status: 404 });
  }
}
