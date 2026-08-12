import { createHash } from "node:crypto";
import { z } from "zod";

import type { RoomScanAssetKind } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import { roomSceneSchema } from "@/lib/room-scene-contract";
import { roomScanSpatialMetadataSchema } from "@/lib/spatial-structure-contract";
import {
  reconcileFailedRoomScanCreation,
  roomScanAssetMimeTypes,
  roomScanCreationErrorStatus,
  roomScanMatchesReplayIdentity,
  roomScanWriteReceipt,
  type RoomScanAssetFingerprint,
  type RoomScanReplayRequest,
} from "@/lib/room-scan-upload-policy";
import {
  createRoomScan,
  findRoomScanReplayIdentity,
  listRoomScans,
} from "@/lib/room-scans";
import {
  deleteStoredMedia,
  maxRoomScanUploadBytes,
  storeRoomScanAsset,
  type StoredBinaryAsset,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const identifiersSchema = z.object({
  id: z.uuid(),
  roomResourceId: z.uuid(),
});

const assetFields: Array<{
  field: string;
  kind: RoomScanAssetKind;
  fallbackMimeType: string;
  required: boolean;
}> = [
  {
    field: "worldMap",
    kind: "world_map",
    fallbackMimeType: roomScanAssetMimeTypes.world_map,
    required: true,
  },
  {
    field: "model",
    kind: "model_usdz",
    fallbackMimeType: roomScanAssetMimeTypes.model_usdz,
    required: true,
  },
  {
    field: "structureModel",
    kind: "structure_model",
    fallbackMimeType: roomScanAssetMimeTypes.structure_model,
    required: false,
  },
  {
    field: "guideImage",
    kind: "guide_image",
    fallbackMimeType: roomScanAssetMimeTypes.guide_image,
    required: false,
  },
];

const textField = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
};

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const activeOnly = new URL(request.url).searchParams.get("includeSuperseded") !== "true";
  return Response.json(await listRoomScans({ activeOnly }));
}

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;

  const uploadLimit = maxRoomScanUploadBytes();
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > uploadLimit + 3_000_000
  ) {
    return Response.json(
      { error: "The complete room scan exceeds the upload size limit." },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart room scan upload." }, { status: 400 });
  }

  const identifiers = identifiersSchema.safeParse({
    id: textField(form, "id"),
    roomResourceId: textField(form, "roomResourceId"),
  });
  if (!identifiers.success) {
    return Response.json({ error: "Invalid scan or room identifier." }, { status: 422 });
  }

  const georeferenceText = textField(form, "georeference")?.trim();
  if (georeferenceText && georeferenceText.length > 100_000) {
    return Response.json(
      { error: "The spatial georeference is too large." },
      { status: 413 },
    );
  }
  let georeference: unknown;
  if (georeferenceText) {
    try {
      georeference = JSON.parse(georeferenceText);
    } catch {
      return Response.json(
        { error: "The spatial georeference is not valid JSON." },
        { status: 422 },
      );
    }
  }
  const floorIndexText = textField(form, "floorIndex")?.trim();
  const spatial = roomScanSpatialMetadataSchema.safeParse({
    structureId: textField(form, "structureId")?.trim() || undefined,
    structureName: textField(form, "structureName")?.trim() || undefined,
    coordinateSpaceId:
      textField(form, "coordinateSpaceId")?.trim() || undefined,
    floorIdentifier:
      textField(form, "floorIdentifier")?.trim() || undefined,
    floorIndex:
      floorIndexText === undefined || floorIndexText === ""
        ? undefined
        : Number(floorIndexText),
    roomIdentifier: textField(form, "roomIdentifier")?.trim() || undefined,
    georeference,
  });
  if (!spatial.success) {
    return Response.json(
      { error: "Invalid spatial structure metadata.", details: spatial.error.flatten() },
      { status: 422 },
    );
  }

  const sceneText = textField(form, "scene");
  if (!sceneText || sceneText.length > 2_000_000) {
    return Response.json(
      { error: "The normalized room scene is missing or too large." },
      { status: 413 },
    );
  }
  let scenePayload: unknown;
  try {
    scenePayload = JSON.parse(sceneText);
  } catch {
    return Response.json({ error: "The room scene is not valid JSON." }, { status: 422 });
  }
  const parsedScene = roomSceneSchema.safeParse(scenePayload);
  if (!parsedScene.success) {
    return Response.json(
      { error: "Invalid RoomPlan scene.", details: parsedScene.error.flatten() },
      { status: 422 },
    );
  }

  const capturedAtText = textField(form, "capturedAt");
  const capturedAt = capturedAtText ? new Date(capturedAtText) : new Date(Number.NaN);
  if (!Number.isFinite(capturedAt.getTime())) {
    return Response.json({ error: "Invalid capture date." }, { status: 422 });
  }
  const deviceModel = textField(form, "deviceModel")?.trim().slice(0, 120) || undefined;
  const files = assetFields.map((definition) => {
    const entry = form.get(definition.field);
    return {
      ...definition,
      file: entry instanceof File && entry.size > 0 ? entry : null,
    };
  });
  const missing = files.find(({ required, file }) => required && !file);
  if (missing) {
    return Response.json(
      { error: `${missing.field} is required for a reusable room scan.` },
      { status: 400 },
    );
  }
  const totalAssetBytes = files.reduce((total, { file }) => total + (file?.size ?? 0), 0);
  if (totalAssetBytes > uploadLimit) {
    return Response.json(
      { error: "The combined room scan assets exceed the upload size limit." },
      { status: 413 },
    );
  }

  const assetPayloads = await Promise.all(
    files.map(async (item) => ({
      ...item,
      bytes: item.file ? Buffer.from(await item.file.arrayBuffer()) : null,
    })),
  );
  const assetFingerprints: RoomScanAssetFingerprint[] = assetPayloads
    .filter(
      (item): item is typeof item & { bytes: Buffer } => item.bytes !== null,
    )
    .map(({ kind, bytes }) => ({
      kind,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    }));
  const replayRequest: RoomScanReplayRequest = {
    roomResourceId: identifiers.data.roomResourceId,
    scene: parsedScene.data,
    capturedAt,
    deviceModel,
    spatial: spatial.data,
    assets: assetFingerprints,
  };
  const existing = await findRoomScanReplayIdentity(identifiers.data.id);
  if (existing) {
    if (!roomScanMatchesReplayIdentity(existing, replayRequest)) {
      return Response.json(
        { error: "That scan identifier belongs to a different upload payload." },
        { status: 409 },
      );
    }
    return Response.json(roomScanWriteReceipt(existing.id, true));
  }

  const stored: Array<{ kind: RoomScanAssetKind; stored: StoredBinaryAsset }> = [];
  try {
    for (const item of assetPayloads) {
      if (!item.file || !item.bytes) continue;
      stored.push({
        kind: item.kind,
        stored: await storeRoomScanAsset({
          bytes: item.bytes,
          // Never trust a multipart MIME type for an authenticated same-origin
          // download. Each role has one fixed, non-executable content type.
          mimeType: item.fallbackMimeType,
          originalName: item.file.name || `${item.kind}.bin`,
          roomScanId: identifiers.data.id,
        }),
      });
    }
  } catch (error) {
    await Promise.allSettled(
      stored.map(({ stored: item }) => deleteStoredMedia(item)),
    );
    const message = error instanceof Error ? error.message : "Unable to save room scan.";
    return Response.json({ error: message }, { status: 500 });
  }

  let result: Awaited<ReturnType<typeof createRoomScan>>;
  try {
    result = await createRoomScan({
      id: identifiers.data.id,
      roomResourceId: identifiers.data.roomResourceId,
      scene: parsedScene.data,
      capturedAt,
      deviceModel,
      actor: authorization.identity.subject,
      assets: stored,
      spatial: spatial.data,
    });
  } catch (error) {
    const settlement = await reconcileFailedRoomScanCreation({
      scanId: identifiers.data.id,
      request: replayRequest,
      findScan: findRoomScanReplayIdentity,
      cleanupUncommittedAssets: async () => {
        await Promise.allSettled(
          stored.map(({ stored: item }) => deleteStoredMedia(item)),
        );
      },
    });
    if (settlement.kind === "committed") {
      return Response.json(roomScanWriteReceipt(settlement.scanId, true));
    }
    const message = error instanceof Error ? error.message : "Unable to save room scan.";
    const status = settlement.kind === "conflict"
      ? 409
      : roomScanCreationErrorStatus(error);
    return Response.json({ error: message }, { status });
  }

  if (result.kind === "existing") {
    await Promise.allSettled(
      stored.map(({ stored: item }) => deleteStoredMedia(item)),
    );
    return Response.json(roomScanWriteReceipt(result.scanId, true));
  }

  return Response.json(
    roomScanWriteReceipt(result.scanId, false),
    { status: 201 },
  );
}
