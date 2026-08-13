import assert from "node:assert/strict";
import test from "node:test";

import { assembleRoomSceneManifests } from "../lib/room-scene-read-model.ts";

const capturedAt = new Date("2026-08-12T10:00:00Z");
const scene = {
  schemaVersion: 1,
  coordinateSystem: "arkit-right-handed-y-up",
  units: "meter",
  matrixOrder: "column-major",
  worldFromModel: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ],
  webFromWorld: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ],
  bounds: { min: [-1, 0, -1], max: [1, 2.5, 1] },
  surfaces: [],
  objects: [],
};

const scan = (id, roomResourceId) => ({
  id,
  roomResourceId,
  structureId: "structure-a",
  coordinateSpaceId: "space-a",
  floorIdentifier: "EG",
  floorIndex: 0,
  roomIdentifier: `room-${id}`,
  revision: 1,
  status: "active",
  scene,
  capturedAt,
  deviceModel: "iPhone",
  createdBy: "test@example.com",
  createdAt: capturedAt,
  updatedAt: capturedAt,
});

const room = (id, name) => ({
  id,
  name,
  description: `${name} description`,
  type: "place",
  status: "available",
  location: name,
});

const structure = { id: "structure-a", name: "Workshop" };
const coordinateSpace = {
  id: "space-a",
  georeference: {
    latitude: 49.45,
    longitude: 11.08,
    headingDegrees: 0,
    capturedAt: "2026-08-12T10:00:00Z",
    source: "manual",
    localReferencePosition: [0, 0, 0],
  },
};

test("assembles multiple room manifests from shared batched detail rows", () => {
  const rows = [
    {
      scan: scan("scan-a", "room-a"),
      room: room("room-a", "Studio"),
      structure,
      coordinateSpace,
    },
    {
      scan: scan("scan-b", "room-b"),
      room: room("room-b", "Storage"),
      structure,
      coordinateSpace,
    },
  ];
  const assets = [
    {
      id: "asset-a",
      roomScanId: "scan-a",
      kind: "world_map",
      name: "room-a.arworldmap",
      mimeType: "application/vnd.apple.arkit.world-map",
      size: 10,
      checksumSha256: "a".repeat(64),
      createdAt: capturedAt,
    },
    {
      id: "asset-b",
      roomScanId: "scan-b",
      kind: "model_usdz",
      name: "room-b.usdz",
      mimeType: "model/vnd.usdz+zip",
      size: 20,
      checksumSha256: "b".repeat(64),
      createdAt: capturedAt,
    },
  ];
  const placements = [
    {
      placement: {
        id: "placement-a",
        roomScanId: "scan-a",
        resourceId: "item-a",
        positionX: 1,
        positionY: 0.5,
        positionZ: -2,
        quaternionX: 0,
        quaternionY: 0,
        quaternionZ: 0,
        quaternionW: 1,
        extentX: 0.5,
        extentY: 1,
        extentZ: 0.5,
        confidence: 0.9,
        method: "scene-depth",
        anchorIdentifier: null,
        capturedAt,
        updatedAt: capturedAt,
      },
      resource: room("item-a", "Chair"),
    },
  ];
  const keyframes = [
    {
      id: "77777777-7777-4777-8777-777777777777",
      roomScanId: "scan-a",
      capturedAt,
      frameTimestamp: 12.5,
      cameraTransform: scene.worldFromModel,
      intrinsics: [800, 0, 0, 0, 800, 0, 400, 300, 1],
      imageWidth: 800,
      imageHeight: 600,
      orientation: "right",
      quality: 0.9,
      featureDescriptor: null,
      mimeType: "image/jpeg",
      size: 1024,
      checksumSha256: "c".repeat(64),
    },
  ];
  const covers = [
    {
      id: "cover-first",
      resourceId: "item-a",
      url: "/chair-first.jpg",
      altText: "Chair front",
    },
    {
      id: "cover-second",
      resourceId: "item-a",
      url: "/chair-second.jpg",
      altText: "Chair back",
    },
  ];

  const manifests = assembleRoomSceneManifests(
    rows,
    assets,
    keyframes,
    placements,
    covers,
  );

  assert.deepEqual(
    manifests.map((manifest) => manifest.scan.id),
    ["scan-a", "scan-b"],
  );
  assert.deepEqual(
    manifests.map((manifest) => manifest.scan.assets.map((asset) => asset.id)),
    [["asset-a"], ["asset-b"]],
  );
  assert.equal(manifests[0].placements.length, 1);
  assert.equal(manifests[1].placements.length, 0);
  assert.deepEqual(manifests[0].placements[0].position, [1, 0.5, -2]);
  assert.deepEqual(manifests[0].placements[0].extent, [0.5, 1, 0.5]);
  assert.equal(
    manifests[0].placements[0].resource.cover.id,
    "cover-first",
  );
  assert.equal(
    manifests[0].scan.georeference,
    coordinateSpace.georeference,
  );
  assert.equal(
    manifests[1].scan.assets[0].url,
    "/api/v1/room-scans/scan-b/assets/model_usdz",
  );
  assert.equal(
    manifests[0].scan.keyframes[0].url,
    "/api/v1/room-scans/scan-a/keyframes/77777777-7777-4777-8777-777777777777",
  );
  assert.equal(
    Object.hasOwn(manifests[0].scan.keyframes[0], "featureDescriptor"),
    false,
  );
});

test("returns an empty manifest set for an empty structure batch", () => {
  assert.deepEqual(assembleRoomSceneManifests([], [], [], [], []), []);
});
