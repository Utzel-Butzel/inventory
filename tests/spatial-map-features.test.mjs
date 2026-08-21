import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./support/typescript-paths-loader.mjs", import.meta.url));

const {
  roomGeoreference,
  spatialStructureMapFeatures,
} = await import("../lib/spatial-map-features.ts");
const {
  displayedMapCoordinates,
  isRenderableMapFeature,
} = await import("../lib/map-features.ts");
const { identitySpatialMatrix } = await import("../lib/room-scene-contract.ts");

const structureAnchor = {
  latitude: 51,
  longitude: 13,
  altitude: 100,
  headingDegrees: 0,
  source: "manual",
};
const scanAnchor = {
  latitude: 51.0001,
  longitude: 13.0002,
  altitude: 101,
  headingDegrees: 90,
  source: "gps",
};
const scene = {
  schemaVersion: 1,
  coordinateSystem: "arkit-right-handed-y-up",
  units: "meter",
  matrixOrder: "column-major",
  worldFromModel: identitySpatialMatrix,
  webFromWorld: identitySpatialMatrix,
  bounds: { min: [-2, 0, -3], max: [2, 2.5, 3] },
  surfaces: [],
  objects: [],
};
const room = {
  roomIdentifier: "studio",
  roomResourceId: "room-resource",
  roomName: "Studio",
  coordinateSpaceId: "frame-a",
  georeference: null,
  scan: {
    id: "scan-a",
    revision: 1,
    status: "active",
    scene,
    capturedAt: "2026-08-12T10:00:00Z",
    deviceModel: "iPhone",
    assets: [],
    coordinateSpaceId: "frame-a",
    georeference: scanAnchor,
  },
  placements: [
    {
      id: "placement-a",
      resource: {
        id: "resource-a",
        name: "Chair",
        description: "",
        type: "furniture",
        status: "available",
        location: "Studio",
        cover: null,
      },
      position: [1, 0, -2],
      orientation: [0, 0, 0, 1],
      extent: null,
      confidence: 0.9,
      method: "scene-depth",
      anchorIdentifier: null,
      capturedAt: "2026-08-12T10:00:00Z",
      updatedAt: "2026-08-12T10:00:00Z",
    },
  ],
};
const structure = {
  id: "structure-a",
  name: "Workshop",
  description: "",
  georeference: structureAnchor,
  floorCount: 1,
  roomCount: 1,
  activeScanCount: 1,
  coordinateSpaceCount: 1,
  boundsCoordinateSpaceId: "frame-a",
  boundsGeoreference: scanAnchor,
  bounds: { min: [-4, 0, -5], max: [4, 3, 5] },
  createdAt: "2026-08-12T10:00:00Z",
  updatedAt: "2026-08-12T10:00:00Z",
};

test("emits a broad structure marker and bounds with their coordinate-space anchor", () => {
  const collection = spatialStructureMapFeatures([structure], null, {});
  assert.deepEqual(
    collection.features.map((feature) => feature.properties.spatialKind),
    ["structure-footprint", "structure-marker"],
  );
});

test("drills into one floor with room and positioned-item geometry", () => {
  const detail = {
    ...structure,
    floors: [{ identifier: "ground", index: 0, roomCount: 1, rooms: [room] }],
  };
  const collection = spatialStructureMapFeatures([structure], detail, {
    activeStructureId: structure.id,
    activeFloorIdentifier: "ground",
  });
  const kinds = collection.features.map((feature) => feature.properties.spatialKind);
  assert.deepEqual(kinds, [
    "structure-footprint",
    "structure-marker",
    "room-footprint",
    "positioned-item",
  ]);
  const item = collection.features.find(
    (feature) => feature.properties.spatialKind === "positioned-item",
  );
  assert.equal(item.properties.resourceId, "resource-a");
  assert.equal(item.properties.coordinateSpaceId, "frame-a");
});

test("moves room footprints and positioned items with the saved layout transform", () => {
  const detail = {
    ...structure,
    floors: [{ identifier: "ground", index: 0, roomCount: 1, rooms: [room] }],
  };
  const original = spatialStructureMapFeatures([structure], detail, {
    activeStructureId: structure.id,
    activeFloorIdentifier: "ground",
  });
  const movedRoom = {
    ...room,
    scan: {
      ...room.scan,
      layoutTransform: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        4, 0, 0, 1,
      ],
    },
  };
  const movedDetail = {
    ...detail,
    floors: [{ identifier: "ground", index: 0, roomCount: 1, rooms: [movedRoom] }],
  };
  const moved = spatialStructureMapFeatures([structure], movedDetail, {
    activeStructureId: structure.id,
    activeFloorIdentifier: "ground",
  });
  const coordinate = (collection, kind) => {
    const feature = collection.features.find(
      (candidate) => candidate.properties.spatialKind === kind,
    );
    return feature.geometry.type === "Point"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates[0][0];
  };
  assert.ok(
    coordinate(moved, "room-footprint")[1] <
      coordinate(original, "room-footprint")[1],
  );
  assert.ok(
    coordinate(moved, "positioned-item")[1] <
      coordinate(original, "positioned-item")[1],
  );
});

test("omits structure bounds without their exact coordinate-space georeference", () => {
  const collection = spatialStructureMapFeatures([
    { ...structure, boundsGeoreference: null },
  ], null, {});
  assert.deepEqual(
    collection.features.map((feature) => feature.properties.spatialKind),
    ["structure-marker"],
  );
});

test("prefers the scan anchor and rejects unsafe cross-frame structure fallbacks", () => {
  assert.equal(roomGeoreference(structure, room), scanAnchor);
  assert.equal(
    roomGeoreference(structure, {
      ...room,
    scan: { ...room.scan, georeference: null },
    }),
    null,
  );
  assert.equal(
    roomGeoreference(structure, {
      ...room,
      coordinateSpaceId: null,
      scan: { ...room.scan, coordinateSpaceId: null, georeference: null },
    }),
    structureAnchor,
  );
});

test("derives a building marker from a multi-polygon room footprint", () => {
  const multiFloorScene = {
    ...scene,
    surfaces: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        category: "floor",
        dimensions: [2, 2, 0],
        transform: identitySpatialMatrix,
        polygonCorners: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]],
        confidence: "high",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        category: "floor",
        dimensions: [2, 2, 0],
        transform: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          3, 0, 0, 1,
        ],
        polygonCorners: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]],
        confidence: "high",
      },
    ],
  };
  const roomWithMultipleFloors = {
    ...room,
    scan: { ...room.scan, scene: multiFloorScene },
  };
  const detail = {
    ...structure,
    georeference: null,
    bounds: null,
    boundsCoordinateSpaceId: null,
    boundsGeoreference: null,
    floors: [{ identifier: "ground", index: 0, roomCount: 1, rooms: [roomWithMultipleFloors] }],
  };
  const collection = spatialStructureMapFeatures([detail], detail, {
    activeStructureId: detail.id,
    activeFloorIdentifier: "ground",
  });

  assert.ok(collection.features.some(
    (feature) =>
      feature.properties.spatialKind === "room-footprint" &&
      feature.geometry.type === "MultiPolygon",
  ));
  assert.ok(collection.features.some(
    (feature) => feature.id === `structure-derived-marker:${detail.id}`,
  ));
});

test("uses only valid features from displayed inventory items for map bounds", () => {
  const visiblePoint = {
    id: "visible-point",
    type: "point",
    layer: "Location",
    description: "",
    coordinates: [13.7, 51.05],
  };
  const invalidPoint = {
    ...visiblePoint,
    id: "invalid-point",
    coordinates: [Number.NaN, 51.05],
  };
  const hiddenPoint = {
    ...visiblePoint,
    id: "hidden-point",
    coordinates: [12.3, 50.9],
  };

  assert.equal(isRenderableMapFeature(visiblePoint), true);
  assert.equal(isRenderableMapFeature(invalidPoint), false);
  assert.equal(isRenderableMapFeature(null), false);
  assert.deepEqual(
    displayedMapCoordinates(
      [{ id: "visible" }],
      {
        visible: [visiblePoint, invalidPoint],
        hidden: [hiddenPoint],
      },
    ),
    [[13.7, 51.05]],
  );
});
