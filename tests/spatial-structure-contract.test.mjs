import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeSpatialBounds,
  roomScanSpatialMetadataSchema,
  sharedCoordinateSpaceBounds,
  spatialGeoreferenceFramesApproximatelyEqual,
  spatialGeoreferenceSchema,
  spatialStructureCreateSchema,
  transformSpatialBounds,
} from "../lib/spatial-structure-contract.ts";

const georeference = {
  latitude: 49.4521,
  longitude: 11.0767,
  altitude: 308.5,
  headingDegrees: 87.25,
  horizontalAccuracy: 3.2,
  verticalAccuracy: 5.4,
  capturedAt: "2026-08-12T09:15:00+02:00",
  source: "gps",
};

test("accepts a coordinate-space georeference and defaults its AR reference to the origin", () => {
  const parsed = spatialGeoreferenceSchema.parse(georeference);
  assert.deepEqual(parsed.localReferencePosition, [0, 0, 0]);
  assert.equal(parsed.headingDegrees, 87.25);
});

test("compares coordinate-space anchors with physical tolerances and circular headings", () => {
  const first = spatialGeoreferenceSchema.parse({
    ...georeference,
    headingDegrees: 359.999,
    localReferencePosition: [4, 1.5, -7],
  });
  const harmlessDrift = spatialGeoreferenceSchema.parse({
    ...georeference,
    latitude: georeference.latitude + 0.00000005,
    longitude: georeference.longitude - 0.00000005,
    altitude: georeference.altitude + 0.005,
    headingDegrees: 0.001,
    localReferencePosition: [4.005, 1.495, -7.005],
    horizontalAccuracy: 30,
    capturedAt: "2026-08-12T10:15:00+02:00",
  });
  assert.equal(
    spatialGeoreferenceFramesApproximatelyEqual(first, harmlessDrift),
    true,
  );
  assert.equal(
    spatialGeoreferenceFramesApproximatelyEqual(first, {
      ...harmlessDrift,
      latitude: first.latitude + 0.000001,
    }),
    false,
  );
  assert.equal(
    spatialGeoreferenceFramesApproximatelyEqual(first, {
      ...harmlessDrift,
      localReferencePosition: [4.05, 1.5, -7],
    }),
    false,
  );
});

test("rejects ambiguous headings and duplicate local reference points", () => {
  assert.equal(
    spatialGeoreferenceSchema.safeParse({
      ...georeference,
      headingDegrees: 360,
    }).success,
    false,
  );
  assert.equal(
    spatialGeoreferenceSchema.safeParse({
      ...georeference,
      referencePoints: [
        {
          id: "entrance",
          localPosition: [0, 0, 0],
          latitude: 49.4521,
          longitude: 11.0767,
        },
        {
          id: "entrance",
          localPosition: [8, 0, -2],
          latitude: 49.4522,
          longitude: 11.0768,
        },
      ],
    }).success,
    false,
  );
});

test("keeps legacy scans ungrouped but requires a structure for floor or coordinate metadata", () => {
  assert.deepEqual(roomScanSpatialMetadataSchema.parse({}), {});
  assert.equal(
    roomScanSpatialMetadataSchema.safeParse({ floorIdentifier: "EG" }).success,
    false,
  );
  const parsed = roomScanSpatialMetadataSchema.parse({
    structureId: "9ee76de4-e8bc-4a58-95dd-0e73733d7ddb",
    coordinateSpaceId: "172134eb-4d7b-4d15-9188-dc247d2e769f",
    floorIdentifier: "EG",
    floorIndex: 0,
    roomIdentifier: "workshop",
    georeference,
  });
  assert.equal(parsed.floorIndex, 0);
});

test("validates standalone structure creation and nullable canonical georeferencing", () => {
  const parsed = spatialStructureCreateSchema.parse({ name: "Rosenwerk" });
  assert.equal(parsed.description, "");
  assert.equal(parsed.georeference, null);
});

test("merges compatible local bounds", () => {
  assert.deepEqual(
    mergeSpatialBounds([
      { min: [-2, 0, -3], max: [2, 2.5, 3] },
      { min: [1, -0.2, 2], max: [7, 3, 9] },
    ]),
    { min: [-2, -0.2, -3], max: [7, 3, 9] },
  );
  assert.equal(mergeSpatialBounds([]), null);
});

test("never combines room bounds across unknown or different AR coordinate spaces", () => {
  const first = { min: [-2, 0, -3], max: [2, 2.5, 3] };
  const second = { min: [1, 0, 2], max: [7, 3, 9] };
  assert.equal(
    sharedCoordinateSpaceBounds([
      { coordinateSpaceId: "space-a", bounds: first },
      { coordinateSpaceId: "space-b", bounds: second },
    ]),
    null,
  );
  assert.equal(
    sharedCoordinateSpaceBounds([
      { coordinateSpaceId: null, bounds: first },
      { coordinateSpaceId: null, bounds: second },
    ]),
    null,
  );
  assert.deepEqual(
    sharedCoordinateSpaceBounds([
      { coordinateSpaceId: "space-a", bounds: first },
      { coordinateSpaceId: "space-a", bounds: second },
    ]),
    {
      coordinateSpaceId: "space-a",
      bounds: { min: [-2, 0, -3], max: [7, 3, 9] },
    },
  );
});

test("transforms model-space bounds before merging a shared AR world", () => {
  assert.deepEqual(
    transformSpatialBounds(
      { min: [-1, 0, -2], max: [1, 3, 2] },
      [
        0, 0, -1, 0,
        0, 1, 0, 0,
        1, 0, 0, 0,
        8, 0, -3, 1,
      ],
    ),
    { min: [6, 0, -4], max: [10, 3, -2] },
  );
});
