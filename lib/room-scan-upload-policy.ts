import type { RoomScanAssetKind } from "@/db/schema";
import type { RoomScene } from "@/lib/room-scene-contract";
import type {
  RoomKeyframeFeatureDescriptor,
  RoomKeyframeInput,
} from "@/lib/room-keyframe-contract";
import {
  spatialGeoreferenceFramesApproximatelyEqual,
  type RoomScanSpatialMetadata,
  type SpatialGeoreference,
} from "@/lib/spatial-structure-contract";

export const roomScanAssetMimeTypes = {
  world_map: "application/vnd.apple.arkit.world-map",
  model_usdz: "model/vnd.usdz+zip",
  structure_model: "model/vnd.usdz+zip",
  guide_image: "image/jpeg",
  textured_mesh: "model/gltf-binary",
  gaussian_splat: "application/octet-stream",
} as const satisfies Record<RoomScanAssetKind, string>;

export const roomScanAssetMimeType = (kind: RoomScanAssetKind) =>
  roomScanAssetMimeTypes[kind];

export const roomScanAssetContentDisposition = (name: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

export const roomScanWriteReceipt = (id: string, replayed: boolean) => ({
  id,
  replayed,
});

export type RoomScanSpatialConflictKind =
  | "georeference"
  | "web-from-world"
  | "world-map";

/** A client-provided spatial frame conflicts with an existing coordinate space. */
export class RoomScanSpatialConflictError extends Error {
  readonly kind: RoomScanSpatialConflictKind;

  constructor(kind: RoomScanSpatialConflictKind, message: string) {
    super(message);
    this.name = "RoomScanSpatialConflictError";
    this.kind = kind;
  }
}

export const roomScanCreationErrorStatus = (error: unknown) => {
  if (error instanceof RoomScanSpatialConflictError) return 409;
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("another room") ||
    message.includes("another structure") ||
    message.includes("different spatial metadata") ||
    message.includes("different upload payload")
  ) return 409;
  if (message.includes("not found")) return 404;
  if (message.includes("only")) return 422;
  return 500;
};

export type RoomScanAssetFingerprint = {
  kind: RoomScanAssetKind;
  checksumSha256: string;
};

export type RoomScanKeyframeFingerprint = Omit<
  RoomKeyframeInput,
  "fileField" | "capturedAt" | "featureDescriptor"
> & {
  capturedAt: Date;
  featureDescriptor?: RoomKeyframeFeatureDescriptor | null;
  checksumSha256: string;
};

export type ExistingRoomScanReplayIdentity = {
  id: string;
  roomResourceId: string;
  structureId: string | null;
  coordinateSpaceId: string | null;
  floorIdentifier: string | null;
  floorIndex: number | null;
  roomIdentifier: string | null;
  scene: RoomScene;
  capturedAt: Date;
  deviceModel: string | null;
  coordinateSpaceGeoreference: SpatialGeoreference | null;
  assets: RoomScanAssetFingerprint[];
  keyframes?: RoomScanKeyframeFingerprint[];
};

export type RoomScanReplayRequest = {
  roomResourceId: string;
  scene: RoomScene;
  capturedAt: Date;
  deviceModel?: string;
  spatial?: RoomScanSpatialMetadata;
  assets: RoomScanAssetFingerprint[];
  keyframes?: RoomScanKeyframeFingerprint[];
};

export const roomScanMatchesSpatialMetadata = (
  scan: Pick<
    ExistingRoomScanReplayIdentity,
    | "id"
    | "structureId"
    | "coordinateSpaceId"
    | "floorIdentifier"
    | "floorIndex"
    | "roomIdentifier"
  >,
  spatial?: RoomScanSpatialMetadata,
) => {
  if (!spatial?.structureId) {
    return (
      scan.structureId === null &&
      scan.coordinateSpaceId === null &&
      scan.floorIdentifier === null &&
      scan.floorIndex === null &&
      scan.roomIdentifier === null
    );
  }
  return (
    scan.structureId === spatial.structureId &&
    scan.coordinateSpaceId === (spatial.coordinateSpaceId ?? scan.id) &&
    scan.floorIdentifier === (spatial.floorIdentifier ?? null) &&
    scan.floorIndex === (spatial.floorIndex ?? null) &&
    scan.roomIdentifier === (spatial.roomIdentifier ?? null)
  );
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const assetFingerprintsMatch = (
  left: RoomScanAssetFingerprint[],
  right: RoomScanAssetFingerprint[],
) => {
  // Photorealistic derivatives are mutable enrichment products that can be
  // attached or regenerated after the immutable RoomPlan capture. They do not
  // change the identity of the original idempotent scan upload.
  const mutableKinds = new Set<RoomScanAssetKind>([
    "textured_mesh",
    "gaussian_splat",
  ]);
  const normalize = (assets: RoomScanAssetFingerprint[]) =>
    assets
      .filter(({ kind }) => !mutableKinds.has(kind))
      .map(({ kind, checksumSha256 }) => `${kind}:${checksumSha256}`)
      .sort();
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
};

const keyframeFingerprintsMatch = (
  left: RoomScanKeyframeFingerprint[] = [],
  right: RoomScanKeyframeFingerprint[] = [],
) => {
  const normalize = (frames: RoomScanKeyframeFingerprint[]) =>
    [...frames]
      .sort((first, second) => first.id.localeCompare(second.id))
      .map((frame) => ({
        id: frame.id,
        capturedAt: frame.capturedAt.toISOString(),
        timestamp: frame.timestamp,
        cameraTransform: frame.cameraTransform,
        intrinsics: frame.intrinsics,
        width: frame.width,
        height: frame.height,
        orientation: frame.orientation,
        quality: frame.quality,
        featureDescriptor: frame.featureDescriptor ?? null,
        checksumSha256: frame.checksumSha256,
      }));
  return canonicalJson(normalize(left)) === canonicalJson(normalize(right));
};

export const roomScanWorldMapChecksumMatches = (
  existingChecksum: string | undefined,
  incomingChecksum: string | undefined,
) => existingChecksum === undefined || existingChecksum === incomingChecksum;

/**
 * Scan ids are immutable idempotency keys. A replay is accepted only when all
 * persisted request data matches, including the coordinate frame and asset
 * bytes; a reused id with a changed payload is a conflict.
 */
export const roomScanMatchesReplayIdentity = (
  scan: ExistingRoomScanReplayIdentity,
  request: RoomScanReplayRequest,
) =>
  scan.roomResourceId === request.roomResourceId &&
  roomScanMatchesSpatialMetadata(scan, request.spatial) &&
  canonicalJson(scan.scene) === canonicalJson(request.scene) &&
  scan.capturedAt.getTime() === request.capturedAt.getTime() &&
  scan.deviceModel === (request.deviceModel ?? null) &&
  assetFingerprintsMatch(scan.assets, request.assets) &&
  keyframeFingerprintsMatch(scan.keyframes, request.keyframes) &&
  (request.spatial?.georeference === undefined ||
    (scan.coordinateSpaceGeoreference !== null &&
      spatialGeoreferenceFramesApproximatelyEqual(
        scan.coordinateSpaceGeoreference,
        request.spatial.georeference,
      )));

export async function reconcileFailedRoomScanCreation(options: {
  scanId: string;
  request: RoomScanReplayRequest;
  findScan: (
    scanId: string,
  ) => Promise<ExistingRoomScanReplayIdentity | null>;
  cleanupUncommittedAssets: () => Promise<void>;
}) {
  let existing: ExistingRoomScanReplayIdentity | null;
  try {
    existing = await options.findScan(options.scanId);
  } catch {
    // A failed COMMIT acknowledgement is ambiguous. If the follow-up read also
    // fails, preserving possible committed assets is safer than corrupting a
    // successfully committed scan. Unreferenced files can be reaped later.
    return { kind: "unknown" } as const;
  }

  if (existing && roomScanMatchesReplayIdentity(existing, options.request)) {
    return { kind: "committed", scanId: existing.id } as const;
  }

  await options.cleanupUncommittedAssets();
  return existing
    ? ({ kind: "conflict" } as const)
    : ({ kind: "not-committed" } as const);
}

export type RoomScanAssetReplacementIdentity = {
  storageKey: string;
  checksumSha256: string;
};

/**
 * Resolves an ambiguous asset-replacement error without ever deleting bytes
 * that a successfully committed database row may reference.
 */
export async function reconcileFailedRoomScanAssetReplacement<
  TAsset extends RoomScanAssetReplacementIdentity,
>(options: {
  incoming: RoomScanAssetReplacementIdentity;
  findCurrentAsset: () => Promise<TAsset | null>;
  cleanupUncommittedAsset: () => Promise<void>;
}) {
  let current: TAsset | null;
  try {
    current = await options.findCurrentAsset();
  } catch {
    // The replacement COMMIT and its verification read are both ambiguous.
    // Preserve the new bytes; a storage reaper can remove an orphan later,
    // whereas deleting a committed object would corrupt the room scene.
    return { kind: "unknown" } as const;
  }

  if (
    current?.storageKey === options.incoming.storageKey &&
    current.checksumSha256 === options.incoming.checksumSha256
  ) {
    return { kind: "committed", asset: current } as const;
  }

  await options.cleanupUncommittedAsset();
  return current
    ? ({ kind: "different-current-asset", asset: current } as const)
    : ({ kind: "not-committed" } as const);
}
