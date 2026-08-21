import assert from "node:assert/strict";
import test from "node:test";

import {
  geographicToLocalArkit,
  isSpatialGeoreference,
  localArkitOffsetMeters,
  localArkitToGeographic,
  localFloorRingToGeoJson,
  roomSceneFootprintToGeoJson,
  transformSpatialPoint,
} from "../lib/spatial-georeference.ts";
import { identitySpatialMatrix } from "../lib/room-scene-contract.ts";

const anchor = {
  latitude: 51.0504,
  longitude: 13.7373,
  altitude: 118,
  headingDegrees: 0,
};

test("maps the documented ARKit axes to east, north and altitude", () => {
  assert.deepEqual(localArkitOffsetMeters([3, 2, -4], 0), {
    east: 3,
    north: 4,
    up: 2,
  });

  const coordinate = localArkitToGeographic([3, 2, -4], anchor);
  assert.ok(coordinate.longitude > anchor.longitude);
  assert.ok(coordinate.latitude > anchor.latitude);
  assert.equal(coordinate.altitude, 120);

  const roundTrip = geographicToLocalArkit(coordinate, anchor);
  roundTrip.forEach((value, index) => {
    assert.ok(Math.abs(value - [3, 2, -4][index]) < 1e-7);
  });
});

test("rotates local forward clockwise at all cardinal headings", () => {
  const offsets = [0, 90, 180, 270].map((heading) =>
    localArkitOffsetMeters([0, 0, -5], heading),
  );
  const expected = [
    { east: 0, north: 5 },
    { east: 5, north: 0 },
    { east: 0, north: -5 },
    { east: -5, north: 0 },
  ];
  offsets.forEach((offset, index) => {
    assert.ok(Math.abs(offset.east - expected[index].east) < 1e-10);
    assert.ok(Math.abs(offset.north - expected[index].north) < 1e-10);
  });
});

test("subtracts the optional local reference position", () => {
  const referencedAnchor = {
    ...anchor,
    localReferencePosition: [100, 7, -20],
  };
  const atAnchor = localArkitToGeographic([100, 7, -20], referencedAnchor);
  assert.deepEqual(atAnchor, {
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    altitude: anchor.altitude,
  });
  assert.deepEqual(
    geographicToLocalArkit(atAnchor, referencedAnchor),
    referencedAnchor.localReferencePosition,
  );
});

test("applies column-major ARKit transforms before georeferencing a scene", () => {
  const translated = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    5, 2, -3, 1,
  ];
  assert.deepEqual(transformSpatialPoint(translated, [1, 1, 1]), [6, 3, -2]);

  const scene = {
    schemaVersion: 1,
    coordinateSystem: "arkit-right-handed-y-up",
    units: "meter",
    matrixOrder: "column-major",
    worldFromModel: translated,
    webFromWorld: identitySpatialMatrix,
    bounds: { min: [-1, 0, -2], max: [1, 2.5, 2] },
    surfaces: [],
    objects: [],
  };
  const feature = roomSceneFootprintToGeoJson(scene, anchor, { roomName: "Studio" });
  assert.equal(feature.geometry.coordinates[0].length, 5);
  assert.deepEqual(
    feature.geometry.coordinates[0][0],
    feature.geometry.coordinates[0].at(-1),
  );
  assert.equal(feature.properties.roomName, "Studio");
});

test("applies a room layout delta before projecting a footprint onto the map", () => {
  const scene = {
    schemaVersion: 1,
    coordinateSystem: "arkit-right-handed-y-up",
    units: "meter",
    matrixOrder: "column-major",
    worldFromModel: identitySpatialMatrix,
    webFromWorld: identitySpatialMatrix,
    bounds: { min: [-1, 0, -1], max: [1, 2.5, 1] },
    surfaces: [],
    objects: [],
  };
  const original = roomSceneFootprintToGeoJson(scene, anchor, {});
  const moved = roomSceneFootprintToGeoJson(scene, anchor, {}, [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    5, 0, 0, 1,
  ]);
  assert.ok(
    moved.geometry.coordinates[0][0][0] >
      original.geometry.coordinates[0][0][0],
  );
  assert.ok(
    Math.abs(
      moved.geometry.coordinates[0][0][1] -
        original.geometry.coordinates[0][0][1],
    ) < 1e-10,
  );
});

test("uses RoomPlan's local XY floor dimensions instead of collapsing the footprint", () => {
  const angle = Math.PI / 4;
  const rotatedFloor = [
    Math.cos(angle), 0, -Math.sin(angle), 0,
    Math.sin(angle), 0, Math.cos(angle), 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ];
  const scene = {
    schemaVersion: 1,
    coordinateSystem: "arkit-right-handed-y-up",
    units: "meter",
    matrixOrder: "column-major",
    worldFromModel: identitySpatialMatrix,
    webFromWorld: identitySpatialMatrix,
    bounds: { min: [-10, 0, -10], max: [10, 3, 10] },
    surfaces: [
      {
        id: "282c2f4d-a9ba-4f97-b02a-98cc9c51d78a",
        category: "floor",
        dimensions: [4, 2, 0],
        transform: rotatedFloor,
        confidence: "high",
      },
    ],
    objects: [],
  };
  const feature = roomSceneFootprintToGeoJson(scene, anchor, {});
  assert.equal(feature.geometry.type, "Polygon");
  assert.equal(feature.geometry.coordinates[0].length, 5);
  const longitudes = feature.geometry.coordinates[0].map((point) => point[0]);
  const latitudes = feature.geometry.coordinates[0].map((point) => point[1]);
  assert.ok(Math.max(...longitudes) - Math.min(...longitudes) > 0.00001);
  assert.ok(Math.max(...latitudes) - Math.min(...latitudes) > 0.00001);
  assert.ok(Math.max(...longitudes) - Math.min(...longitudes) < 0.0001);
});

test("preserves RoomPlan's concave floor polygon instead of its bounding box", () => {
  const scene = {
    schemaVersion: 1,
    coordinateSystem: "arkit-right-handed-y-up",
    units: "meter",
    matrixOrder: "column-major",
    worldFromModel: identitySpatialMatrix,
    webFromWorld: identitySpatialMatrix,
    bounds: { min: [-2, 0, -2], max: [2, 3, 2] },
    surfaces: [{
      id: "282c2f4d-a9ba-4f97-b02a-98cc9c51d78b",
      category: "floor",
      dimensions: [4, 4, 0],
      transform: [
        1, 0, 0, 0,
        0, 0, 1, 0,
        0, 1, 0, 0,
        0, 0, 0, 1,
      ],
      polygonCorners: [
        [-2, -2, 0], [2, -2, 0], [2, -1, 0],
        [0, -1, 0], [0, 2, 0], [-2, 2, 0],
      ],
      confidence: "high",
    }],
    objects: [],
  };
  const feature = roomSceneFootprintToGeoJson(scene, anchor, {});
  assert.equal(feature.geometry.type, "Polygon");
  assert.equal(feature.geometry.coordinates[0].length, 7);
});

test("closes local floor rings and validates anchors defensively", () => {
  const feature = localFloorRingToGeoJson(
    [[0, 0], [4, 0], [4, -3], [0, -3]],
    anchor,
    { id: "building-a" },
  );
  assert.equal(feature.geometry.coordinates[0].length, 5);
  assert.deepEqual(
    feature.geometry.coordinates[0][0],
    feature.geometry.coordinates[0].at(-1),
  );
  assert.equal(isSpatialGeoreference(anchor), true);
  assert.equal(
    isSpatialGeoreference({ ...anchor, latitude: Number.NaN }),
    false,
  );
  assert.equal(
    isSpatialGeoreference({ ...anchor, longitude: 181 }),
    false,
  );
});
