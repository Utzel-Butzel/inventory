import assert from "node:assert/strict";
import test from "node:test";

import {
  identitySpatialMatrix,
  roomSceneSchema,
  spatialMatricesApproximatelyEqual,
  spatialPlacementInputSchema,
} from "../lib/room-scene-contract.ts";

const validScene = {
  schemaVersion: 1,
  coordinateSystem: "arkit-right-handed-y-up",
  units: "meter",
  matrixOrder: "column-major",
  worldFromModel: identitySpatialMatrix,
  webFromWorld: identitySpatialMatrix,
  bounds: {
    min: [-2, 0, -3],
    max: [2, 2.6, 3],
  },
  surfaces: [
    {
      id: "1eed24e6-20f7-489d-bbf4-a57da56565e3",
      category: "wall",
      dimensions: [4, 2.6, 0],
      transform: identitySpatialMatrix,
      polygonCorners: [[-2, -1.3, 0], [2, -1.3, 0], [2, 1.3, 0], [-2, 1.3, 0]],
      confidence: "high",
    },
  ],
  objects: [],
};

test("accepts the shared ARKit/RoomPlan scene contract", () => {
  assert.equal(roomSceneSchema.safeParse(validScene).success, true);
});

test("rejects inverted bounds and row-major affine transforms", () => {
  const inverted = structuredClone(validScene);
  inverted.bounds = { min: [1, 0, 0], max: [0, 1, 1] };
  assert.equal(roomSceneSchema.safeParse(inverted).success, false);

  const rowMajorTranslation = structuredClone(validScene);
  rowMajorTranslation.worldFromModel = [
    1, 0, 0, 2,
    0, 1, 0, 3,
    0, 0, 1, 4,
    0, 0, 0, 1,
  ];
  assert.equal(roomSceneSchema.safeParse(rowMajorTranslation).success, false);
});

test("requires normalized orientation and non-negative item extents", () => {
  const validPlacement = {
    position: [0.4, 0.9, -1.25],
    orientation: [0, 0, 0, 1],
    extent: [0.2, 0.08, 0.3],
    confidence: 0.94,
    method: "scene-depth",
    anchorIdentifier: "13d6a81c-f6e5-48b8-aa0f-c1b266de82bb",
    capturedAt: "2026-08-12T09:15:00Z",
  };
  assert.equal(spatialPlacementInputSchema.safeParse(validPlacement).success, true);

  assert.equal(
    spatialPlacementInputSchema.safeParse({
      ...validPlacement,
      orientation: [0, 0, 0, 0.4],
    }).success,
    false,
  );
  assert.equal(
    spatialPlacementInputSchema.safeParse({
      ...validPlacement,
      extent: [0.2, -0.08, 0.3],
    }).success,
    false,
  );
  assert.equal(
    spatialPlacementInputSchema.safeParse({
      ...validPlacement,
      extent: [0, 100, 0.3],
    }).success,
    true,
  );
  assert.equal(
    spatialPlacementInputSchema.safeParse({
      ...validPlacement,
      extent: [0.2, 100.01, 0.3],
    }).success,
    false,
  );
});

test("compares a shared world-to-web transform with numeric tolerance", () => {
  assert.equal(
    spatialMatricesApproximatelyEqual(
      identitySpatialMatrix,
      identitySpatialMatrix.map((value, index) =>
        index === 12 ? value + 1e-7 : value
      ),
    ),
    true,
  );
  assert.equal(
    spatialMatricesApproximatelyEqual(
      identitySpatialMatrix,
      identitySpatialMatrix.map((value, index) =>
        index === 12 ? value + 0.01 : value
      ),
    ),
    false,
  );
});
