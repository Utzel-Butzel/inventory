import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./support/typescript-paths-loader.mjs", import.meta.url));

const {
  reconcileFailedRoomScanAssetReplacement,
  reconcileFailedRoomScanCreation,
  RoomScanSpatialConflictError,
  roomScanAssetContentDisposition,
  roomScanAssetMimeType,
  roomScanCreationErrorStatus,
  roomScanMatchesReplayIdentity,
  roomScanMatchesSpatialMetadata,
  roomScanWorldMapChecksumMatches,
  roomScanWriteReceipt,
} = await import("../lib/room-scan-upload-policy.ts");

test("room scan downloads use fixed non-executable MIME types and attachments", () => {
  assert.equal(
    roomScanAssetMimeType("world_map"),
    "application/vnd.apple.arkit.world-map",
  );
  assert.equal(roomScanAssetMimeType("model_usdz"), "model/vnd.usdz+zip");
  assert.equal(roomScanAssetMimeType("structure_model"), "model/vnd.usdz+zip");
  assert.equal(roomScanAssetMimeType("guide_image"), "image/jpeg");
  assert.equal(roomScanAssetMimeType("textured_mesh"), "model/gltf-binary");
  assert.equal(
    roomScanAssetMimeType("gaussian_splat"),
    "application/octet-stream",
  );

  const disposition = roomScanAssetContentDisposition(
    "room.html\r\nX-Injection: yes",
  );
  assert.match(disposition, /^attachment;/);
  assert.equal(disposition.includes("\r"), false);
  assert.equal(disposition.includes("\n"), false);
  assert.equal(disposition.includes("%0D%0A"), true);
});

test("write and replay receipts never expose room-scene read data", () => {
  assert.deepEqual(roomScanWriteReceipt("scan-1", false), {
    id: "scan-1",
    replayed: false,
  });
  assert.deepEqual(roomScanWriteReceipt("scan-1", true), {
    id: "scan-1",
    replayed: true,
  });
  assert.equal("scene" in roomScanWriteReceipt("scan-1", true), false);
});

test("coordinate-space transform conflicts map to HTTP 409", () => {
  assert.equal(
    roomScanCreationErrorStatus(
      new RoomScanSpatialConflictError(
        "georeference",
        "That coordinate space already has a different georeference.",
      ),
    ),
    409,
  );
  assert.equal(
    roomScanCreationErrorStatus(
      new RoomScanSpatialConflictError(
        "world-map",
        "That coordinate space already has a different ARWorldMap snapshot.",
      ),
    ),
    409,
  );
  assert.equal(
    roomScanCreationErrorStatus(
      new RoomScanSpatialConflictError(
        "web-from-world",
        "That coordinate space already has a different webFromWorld transform.",
      ),
    ),
    409,
  );
  assert.equal(roomScanCreationErrorStatus(new Error("database unavailable")), 500);
});

const existingScan = {
  id: "11111111-1111-4111-8111-111111111111",
  roomResourceId: "22222222-2222-4222-8222-222222222222",
  structureId: "33333333-3333-4333-8333-333333333333",
  coordinateSpaceId: "44444444-4444-4444-8444-444444444444",
  floorIdentifier: "EG",
  floorIndex: 0,
  roomIdentifier: "workshop",
};

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const scene = {
  schemaVersion: 1,
  coordinateSystem: "arkit-right-handed-y-up",
  units: "meter",
  matrixOrder: "column-major",
  worldFromModel: identity,
  webFromWorld: identity,
  bounds: { min: [-1, 0, -1], max: [1, 2.5, 1] },
  surfaces: [],
  objects: [],
};
const georeference = {
  latitude: 49.4521,
  longitude: 11.0767,
  altitude: 308.5,
  headingDegrees: 87.25,
  capturedAt: "2026-08-12T09:15:00+02:00",
  source: "gps",
  localReferencePosition: [0, 0, 0],
};
const assets = [
  { kind: "world_map", checksumSha256: "a".repeat(64) },
  { kind: "model_usdz", checksumSha256: "b".repeat(64) },
];
const existingReplayScan = {
  ...existingScan,
  scene,
  capturedAt: new Date("2026-08-12T07:15:00.000Z"),
  deviceModel: "iPhone17,1",
  coordinateSpaceGeoreference: georeference,
  assets,
};
const matchingReplayRequest = {
  roomResourceId: existingScan.roomResourceId,
  scene,
  capturedAt: new Date("2026-08-12T07:15:00.000Z"),
  deviceModel: "iPhone17,1",
  spatial: {
    structureId: existingScan.structureId,
    coordinateSpaceId: existingScan.coordinateSpaceId,
    floorIdentifier: existingScan.floorIdentifier,
    floorIndex: existingScan.floorIndex,
    roomIdentifier: existingScan.roomIdentifier,
    georeference,
  },
  assets: [...assets].reverse(),
};

const keyframe = {
  id: "77777777-7777-4777-8777-777777777777",
  capturedAt: new Date("2026-08-12T07:15:02.000Z"),
  timestamp: 14.5,
  cameraTransform: identity,
  intrinsics: [800, 0, 0, 0, 800, 0, 400, 300, 1],
  width: 800,
  height: 600,
  orientation: "right",
  quality: 0.9,
  checksumSha256: "d".repeat(64),
};

test("scan replay identity includes spatial grouping metadata", () => {
  assert.equal(
    roomScanMatchesSpatialMetadata(existingScan, {
      structureId: existingScan.structureId,
      coordinateSpaceId: existingScan.coordinateSpaceId,
      floorIdentifier: "EG",
      floorIndex: 0,
      roomIdentifier: "workshop",
    }),
    true,
  );
  assert.equal(
    roomScanMatchesSpatialMetadata(existingScan, {
      structureId: existingScan.structureId,
      coordinateSpaceId: "55555555-5555-4555-8555-555555555555",
      floorIdentifier: "EG",
      floorIndex: 0,
      roomIdentifier: "workshop",
    }),
    false,
  );
  assert.equal(roomScanMatchesSpatialMetadata(existingScan, undefined), false);
});

test("exact scan replay covers scene, capture metadata, georeference, and asset bytes", () => {
  assert.equal(
    roomScanMatchesReplayIdentity(existingReplayScan, matchingReplayRequest),
    true,
  );
  assert.equal(
    roomScanMatchesReplayIdentity(existingReplayScan, {
      ...matchingReplayRequest,
      scene: {
        ...scene,
        bounds: { ...scene.bounds, max: [2, 2.5, 1] },
      },
    }),
    false,
  );
  assert.equal(
    roomScanMatchesReplayIdentity(existingReplayScan, {
      ...matchingReplayRequest,
      capturedAt: new Date("2026-08-12T07:15:01.000Z"),
    }),
    false,
  );
  assert.equal(
    roomScanMatchesReplayIdentity(existingReplayScan, {
      ...matchingReplayRequest,
      spatial: {
        ...matchingReplayRequest.spatial,
        georeference: { ...georeference, headingDegrees: 90 },
      },
    }),
    false,
  );
  assert.equal(
    roomScanMatchesReplayIdentity(existingReplayScan, {
      ...matchingReplayRequest,
      assets: [
        { kind: "world_map", checksumSha256: "c".repeat(64) },
        assets[1],
      ],
    }),
    false,
  );
});

test("exact scan replay covers calibrated keyframe metadata and image bytes", () => {
  assert.equal(
    roomScanMatchesReplayIdentity(
      { ...existingReplayScan, keyframes: [keyframe] },
      { ...matchingReplayRequest, keyframes: [{ ...keyframe }] },
    ),
    true,
  );
  assert.equal(
    roomScanMatchesReplayIdentity(
      { ...existingReplayScan, keyframes: [keyframe] },
      {
        ...matchingReplayRequest,
        keyframes: [{ ...keyframe, checksumSha256: "e".repeat(64) }],
      },
    ),
    false,
  );
  assert.equal(
    roomScanMatchesReplayIdentity(
      { ...existingReplayScan, keyframes: [keyframe] },
      {
        ...matchingReplayRequest,
        keyframes: [{ ...keyframe, cameraTransform: [...identity.slice(0, 12), 1, 0, 0, 1] }],
      },
    ),
    false,
  );
});

test("photorealistic derivatives attached later do not change capture replay identity", () => {
  assert.equal(
    roomScanMatchesReplayIdentity(
      {
        ...existingReplayScan,
        assets: [
          ...assets,
          { kind: "textured_mesh", checksumSha256: "f".repeat(64) },
          { kind: "gaussian_splat", checksumSha256: "e".repeat(64) },
        ],
      },
      matchingReplayRequest,
    ),
    true,
  );
});

test("a shared coordinate space requires one byte-identical ARWorldMap snapshot", () => {
  assert.equal(roomScanWorldMapChecksumMatches(undefined, "a".repeat(64)), true);
  assert.equal(
    roomScanWorldMapChecksumMatches("a".repeat(64), "a".repeat(64)),
    true,
  );
  assert.equal(
    roomScanWorldMapChecksumMatches("a".repeat(64), "b".repeat(64)),
    false,
  );
});

test("a matching scan proves an ambiguous create committed without deleting assets", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanCreation({
    scanId: existingReplayScan.id,
    request: matchingReplayRequest,
    findScan: async () => existingReplayScan,
    cleanupUncommittedAssets: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "committed", scanId: existingReplayScan.id });
  assert.equal(cleanupCalls, 0);
});

test("assets are deleted only when the database proves the create did not commit", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanCreation({
    scanId: existingReplayScan.id,
    request: matchingReplayRequest,
    findScan: async () => null,
    cleanupUncommittedAssets: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "not-committed" });
  assert.equal(cleanupCalls, 1);
});

test("a concurrent commit with conflicting spatial metadata is not treated as this request", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanCreation({
    scanId: existingScan.id,
    request: {
      ...matchingReplayRequest,
      spatial: {
        ...matchingReplayRequest.spatial,
        coordinateSpaceId: "55555555-5555-4555-8555-555555555555",
      },
    },
    findScan: async () => existingReplayScan,
    cleanupUncommittedAssets: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "conflict" });
  assert.equal(cleanupCalls, 1);
});

test("an unavailable commit check preserves assets for later reconciliation", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanCreation({
    scanId: existingReplayScan.id,
    request: matchingReplayRequest,
    findScan: async () => {
      throw new Error("database unavailable");
    },
    cleanupUncommittedAssets: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "unknown" });
  assert.equal(cleanupCalls, 0);
});

const incomingReplacement = {
  storageKey: "room-scans/scan-1/new-room.glb",
  checksumSha256: "a".repeat(64),
};

test("an ambiguous replacement preserves bytes when the new asset committed", async () => {
  let cleanupCalls = 0;
  const committedAsset = {
    ...incomingReplacement,
    id: "asset-new",
  };
  const result = await reconcileFailedRoomScanAssetReplacement({
    incoming: incomingReplacement,
    findCurrentAsset: async () => committedAsset,
    cleanupUncommittedAsset: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "committed", asset: committedAsset });
  assert.equal(cleanupCalls, 0);
});

test("a different current asset proves the new replacement bytes are unreferenced", async () => {
  let cleanupCalls = 0;
  const currentAsset = {
    storageKey: "room-scans/scan-1/previous-room.glb",
    checksumSha256: "b".repeat(64),
    id: "asset-previous",
  };
  const result = await reconcileFailedRoomScanAssetReplacement({
    incoming: incomingReplacement,
    findCurrentAsset: async () => currentAsset,
    cleanupUncommittedAsset: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, {
    kind: "different-current-asset",
    asset: currentAsset,
  });
  assert.equal(cleanupCalls, 1);
});

test("an absent asset proves the replacement did not commit and deletes new bytes", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanAssetReplacement({
    incoming: incomingReplacement,
    findCurrentAsset: async () => null,
    cleanupUncommittedAsset: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "not-committed" });
  assert.equal(cleanupCalls, 1);
});

test("an unavailable replacement read preserves possibly committed bytes", async () => {
  let cleanupCalls = 0;
  const result = await reconcileFailedRoomScanAssetReplacement({
    incoming: incomingReplacement,
    findCurrentAsset: async () => {
      throw new Error("database unavailable");
    },
    cleanupUncommittedAsset: async () => {
      cleanupCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "unknown" });
  assert.equal(cleanupCalls, 0);
});
