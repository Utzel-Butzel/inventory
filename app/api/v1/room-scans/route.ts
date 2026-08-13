import { createHash } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";

import type { RoomScanAssetKind } from "@/db/schema";
import { requirePermission } from "@/lib/api-auth";
import { roomSceneSchema } from "@/lib/room-scene-contract";
import {
  isJpegKeyframe,
  keyframeFileEnvelopeIsValid,
  MAX_GAUSSIAN_SPLAT_BYTES,
  MAX_ROOM_KEYFRAME_BYTES,
  MAX_TEXTURED_MESH_BYTES,
  roomKeyframesInputSchema,
  photorealisticFileEnvelopeIsValid,
  validateGaussianSplatPly,
  validateGlb,
} from "@/lib/room-keyframe-contract";
import { roomScanSpatialMetadataSchema } from "@/lib/spatial-structure-contract";
import {
  reconcileFailedRoomScanCreation,
  roomScanAssetMimeTypes,
  roomScanCreationErrorStatus,
  roomScanMatchesReplayIdentity,
  roomScanWriteReceipt,
  type RoomScanAssetFingerprint,
  type RoomScanKeyframeFingerprint,
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
  {
    field: "texturedMesh",
    kind: "textured_mesh",
    fallbackMimeType: roomScanAssetMimeTypes.textured_mesh,
    required: false,
  },
  {
    field: "gaussianSplat",
    kind: "gaussian_splat",
    fallbackMimeType: roomScanAssetMimeTypes.gaussian_splat,
    required: false,
  },
];

const textField = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
};

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "spatial.read");
  if (authorization.response) return authorization.response;
  const activeOnly = new URL(request.url).searchParams.get("includeSuperseded") !== "true";
  return Response.json(await listRoomScans({ activeOnly }));
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "spatial.manage");
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
  const keyframesText = textField(form, "keyframes")?.trim();
  if (keyframesText && keyframesText.length > 500_000) {
    return Response.json({ error: "The keyframe metadata is too large." }, { status: 413 });
  }
  let keyframesPayload: unknown = [];
  if (keyframesText) {
    try {
      keyframesPayload = JSON.parse(keyframesText);
    } catch {
      return Response.json({ error: "The keyframe metadata is not valid JSON." }, { status: 422 });
    }
  }
  const parsedKeyframes = roomKeyframesInputSchema.safeParse(keyframesPayload);
  if (!parsedKeyframes.success) {
    return Response.json(
      { error: "Invalid room camera keyframes.", details: parsedKeyframes.error.flatten() },
      { status: 422 },
    );
  }
  if (parsedKeyframes.data.length && !spatial.data.coordinateSpaceId) {
    return Response.json(
      { error: "Camera keyframes require an explicit spatial coordinate space." },
      { status: 422 },
    );
  }
  const expectedKeyframeFields = new Set(
    parsedKeyframes.data.map(({ fileField }) => fileField),
  );
  const unexpectedKeyframeField = [...form.keys()].find(
    (field) => field.startsWith("keyframe:") && !expectedKeyframeFields.has(field),
  );
  if (unexpectedKeyframeField) {
    return Response.json(
      { error: `Unreferenced keyframe image field: ${unexpectedKeyframeField}.` },
      { status: 422 },
    );
  }
  const duplicateKeyframeField = [...expectedKeyframeFields].find(
    (field) => form.getAll(field).length !== 1,
  );
  if (duplicateKeyframeField) {
    return Response.json(
      { error: `${duplicateKeyframeField} must have exactly one image part.` },
      { status: 422 },
    );
  }
  const keyframeFiles = parsedKeyframes.data.map((metadata) => {
    const entry = form.get(metadata.fileField);
    return {
      metadata,
      file: entry instanceof File && entry.size > 0 ? entry : null,
    };
  });
  const missingKeyframe = keyframeFiles.find(({ file }) => !file);
  if (missingKeyframe) {
    return Response.json(
      { error: `${missingKeyframe.metadata.fileField} is required by the keyframe metadata.` },
      { status: 400 },
    );
  }
  const oversizedKeyframe = keyframeFiles.find(
    ({ file }) => (file?.size ?? 0) > MAX_ROOM_KEYFRAME_BYTES,
  );
  if (oversizedKeyframe) {
    return Response.json(
      { error: `${oversizedKeyframe.metadata.fileField} exceeds the per-keyframe limit.` },
      { status: 413 },
    );
  }
  const invalidKeyframeEnvelope = keyframeFiles.find(
    ({ file }) => file && !keyframeFileEnvelopeIsValid(file),
  );
  if (invalidKeyframeEnvelope) {
    return Response.json(
      { error: `${invalidKeyframeEnvelope.metadata.fileField} must be an image/jpeg .jpg file.` },
      { status: 415 },
    );
  }
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
  const oversizedPhotorealAsset = files.find(
    ({ kind, file }) =>
      (kind === "textured_mesh" && (file?.size ?? 0) > MAX_TEXTURED_MESH_BYTES) ||
      (kind === "gaussian_splat" && (file?.size ?? 0) > MAX_GAUSSIAN_SPLAT_BYTES),
  );
  if (oversizedPhotorealAsset) {
    return Response.json(
      { error: `${oversizedPhotorealAsset.field} exceeds its upload size limit.` },
      { status: 413 },
    );
  }
  const invalidPhotorealEnvelope = files.find(
    ({ kind, file }) =>
      file &&
      (kind === "textured_mesh" || kind === "gaussian_splat") &&
      !photorealisticFileEnvelopeIsValid(kind, file),
  );
  if (invalidPhotorealEnvelope) {
    return Response.json(
      {
        error:
          invalidPhotorealEnvelope.kind === "textured_mesh"
            ? "texturedMesh must be a model/gltf-binary .glb file."
            : "gaussianSplat must be an application/octet-stream .ply file.",
      },
      { status: 415 },
    );
  }
  const totalAssetBytes =
    files.reduce((total, { file }) => total + (file?.size ?? 0), 0) +
    keyframeFiles.reduce((total, { file }) => total + (file?.size ?? 0), 0);
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
  for (const item of assetPayloads) {
    if (!item.bytes) continue;
    const validation =
      item.kind === "textured_mesh"
        ? validateGlb(item.bytes)
        : item.kind === "gaussian_splat"
          ? validateGaussianSplatPly(item.bytes)
          : null;
    if (validation && !validation.valid) {
      return Response.json({ error: validation.error }, { status: 422 });
    }
  }
  const keyframePayloads = await Promise.all(
    keyframeFiles.map(async (item) => ({
      ...item,
      file: item.file!,
      bytes: Buffer.from(await item.file!.arrayBuffer()),
    })),
  );
  const invalidJpeg = keyframePayloads.find(({ bytes }) => !isJpegKeyframe(bytes));
  if (invalidJpeg) {
    return Response.json(
      { error: `${invalidJpeg.metadata.fileField} is not a valid JPEG image.` },
      { status: 422 },
    );
  }
  for (const item of keyframePayloads) {
    try {
      const image = await sharp(item.bytes, {
        failOn: "error",
        limitInputPixels: 4_096 * 4_096,
      }).metadata();
      if (
        image.format !== "jpeg" ||
        image.width !== item.metadata.width ||
        image.height !== item.metadata.height
      ) {
        return Response.json(
          {
            error: `${item.metadata.fileField} dimensions do not match its decoded JPEG pixels.`,
          },
          { status: 422 },
        );
      }
    } catch {
      return Response.json(
        { error: `${item.metadata.fileField} is not a decodable bounded JPEG image.` },
        { status: 422 },
      );
    }
  }
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
    keyframes: keyframePayloads.map(({ metadata, bytes }) => ({
      id: metadata.id,
      capturedAt: new Date(metadata.capturedAt),
      timestamp: metadata.timestamp,
      cameraTransform: metadata.cameraTransform,
      intrinsics: metadata.intrinsics,
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.orientation,
      quality: metadata.quality,
      featureDescriptor: metadata.featureDescriptor,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    } satisfies RoomScanKeyframeFingerprint)),
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
  const storedKeyframes: Array<{
    metadata: (typeof parsedKeyframes.data)[number];
    stored: StoredBinaryAsset;
  }> = [];
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
          originalName:
            item.kind === "textured_mesh"
              ? "textured-room.glb"
              : item.kind === "gaussian_splat"
                ? "room-splat.ply"
                : item.file.name || `${item.kind}.bin`,
          roomScanId: identifiers.data.id,
        }),
      });
    }
    for (const item of keyframePayloads) {
      storedKeyframes.push({
        metadata: item.metadata,
        stored: await storeRoomScanAsset({
          bytes: item.bytes,
          mimeType: "image/jpeg",
          originalName: `${item.metadata.id}.jpg`,
          roomScanId: identifiers.data.id,
        }),
      });
    }
  } catch (error) {
    await Promise.allSettled(
      [...stored, ...storedKeyframes].map(({ stored: item }) => deleteStoredMedia(item)),
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
      keyframes: storedKeyframes,
      spatial: spatial.data,
    });
  } catch (error) {
    const settlement = await reconcileFailedRoomScanCreation({
      scanId: identifiers.data.id,
      request: replayRequest,
      findScan: findRoomScanReplayIdentity,
      cleanupUncommittedAssets: async () => {
        await Promise.allSettled(
          [...stored, ...storedKeyframes].map(({ stored: item }) =>
            deleteStoredMedia(item),
          ),
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
      [...stored, ...storedKeyframes].map(({ stored: item }) => deleteStoredMedia(item)),
    );
    return Response.json(roomScanWriteReceipt(result.scanId, true));
  }

  return Response.json(
    roomScanWriteReceipt(result.scanId, false),
    { status: 201 },
  );
}
