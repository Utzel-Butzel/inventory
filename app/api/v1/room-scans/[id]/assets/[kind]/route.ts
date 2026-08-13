import type { RoomScanAssetKind } from "@/db/schema";
import { z } from "zod";
import { requirePermission } from "@/lib/api-auth";
import {
  reconcileFailedRoomScanAssetReplacement,
  roomScanAssetContentDisposition,
  roomScanAssetMimeType,
} from "@/lib/room-scan-upload-policy";
import {
  MAX_GAUSSIAN_SPLAT_BYTES,
  MAX_TEXTURED_MESH_BYTES,
  validateGaussianSplatPly,
  validateGlb,
} from "@/lib/room-keyframe-contract";
import {
  getRoomScanAsset,
  replaceRoomScanAsset,
} from "@/lib/room-scans";
import {
  deleteStoredMedia,
  readMediaBytes,
  storeRoomScanAsset,
} from "@/lib/storage";

type Context = { params: Promise<{ id: string; kind: string }> };

const allowedKinds = new Set<RoomScanAssetKind>([
  "world_map",
  "model_usdz",
  "structure_model",
  "guide_image",
  "textured_mesh",
  "gaussian_splat",
]);
const mutablePhotorealKinds = new Set<RoomScanAssetKind>([
  "textured_mesh",
  "gaussian_splat",
]);

const serializePhotorealAsset = (
  scanId: string,
  kind: "textured_mesh" | "gaussian_splat",
  asset: NonNullable<Awaited<ReturnType<typeof getRoomScanAsset>>>,
) => ({
  id: asset.id,
  kind: asset.kind,
  name: asset.name,
  mimeType: asset.mimeType,
  size: asset.size,
  checksumSha256: asset.checksumSha256,
  createdAt: asset.createdAt,
  url: `/api/v1/room-scans/${encodeURIComponent(scanId)}/assets/${kind}`,
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "spatial.read");
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

export async function PUT(request: Request, context: Context) {
  const authorization = await requirePermission(request, "spatial.manage");
  if (authorization.response) return authorization.response;
  const { id, kind } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid room scan identifier." }, { status: 422 });
  }
  if (!mutablePhotorealKinds.has(kind as RoomScanAssetKind)) {
    return Response.json(
      { error: "Only photorealistic derivative assets can be replaced." },
      { status: 404 },
    );
  }
  const typedKind = kind as "textured_mesh" | "gaussian_splat";
  const expectedMimeType = roomScanAssetMimeType(typedKind);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== expectedMimeType) {
    return Response.json(
      { error: `Expected Content-Type ${expectedMimeType}.` },
      { status: 415 },
    );
  }
  const limit =
    typedKind === "textured_mesh"
      ? MAX_TEXTURED_MESH_BYTES
      : MAX_GAUSSIAN_SPLAT_BYTES;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    return Response.json({ error: "The photorealistic asset is too large." }, { status: 413 });
  }
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length) {
    return Response.json({ error: "The photorealistic asset is empty." }, { status: 400 });
  }
  if (bytes.length > limit) {
    return Response.json({ error: "The photorealistic asset is too large." }, { status: 413 });
  }
  const validation =
    typedKind === "textured_mesh"
      ? validateGlb(bytes)
      : validateGaussianSplatPly(bytes);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 422 });
  }

  let stored: Awaited<ReturnType<typeof storeRoomScanAsset>>;
  try {
    stored = await storeRoomScanAsset({
      bytes,
      mimeType: expectedMimeType,
      originalName:
        typedKind === "textured_mesh" ? "textured-room.glb" : "room-splat.ply",
      roomScanId: id,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to store asset." },
      { status: 500 },
    );
  }

  try {
    const result = await replaceRoomScanAsset({ scanId: id, kind: typedKind, stored });
    if (result.kind === "scan-not-found") {
      await deleteStoredMedia(stored).catch(() => undefined);
      return Response.json({ error: "Room scan not found." }, { status: 404 });
    }
    if (result.previous) {
      await deleteStoredMedia({
        storageKey: result.previous.storageKey,
        url: result.previous.storageUrl,
      }).catch(() => undefined);
    }
    return Response.json(
      {
        asset: serializePhotorealAsset(id, typedKind, result.asset),
      },
      { status: result.previous ? 200 : 201 },
    );
  } catch (error) {
    const settlement = await reconcileFailedRoomScanAssetReplacement({
      incoming: stored,
      findCurrentAsset: () => getRoomScanAsset(id, typedKind),
      cleanupUncommittedAsset: () =>
        deleteStoredMedia(stored).catch(() => undefined),
    });
    if (settlement.kind === "committed") {
      return Response.json({
        asset: serializePhotorealAsset(id, typedKind, settlement.asset),
      });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to attach asset." },
      { status: 500 },
    );
  }
}
