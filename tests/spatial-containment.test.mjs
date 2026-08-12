import assert from "node:assert/strict";
import test from "node:test";

import {
  polygonCoversPoint,
  spatialFeaturePoints,
  spatialTargetIsInside,
} from "../lib/spatial-containment.ts";

const room = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

test("GPS-only targets participate in spatial containment", () => {
  assert.equal(
    spatialTargetIsInside(room, {
      mapFeatures: [],
      gpsLatitude: 5,
      gpsLongitude: 5,
    }),
    true,
  );
  assert.equal(
    spatialTargetIsInside(room, {
      mapFeatures: [],
      gpsLatitude: 5,
      gpsLongitude: 12,
    }),
    false,
  );
});

test("closed polygon boundaries are included without matching outside points", () => {
  assert.equal(polygonCoversPoint(room, [5, 5]), true);
  assert.equal(polygonCoversPoint(room, [10, 5]), true);
  assert.equal(polygonCoversPoint(room, [0, 0]), true);
  assert.equal(polygonCoversPoint(room, [12, 5]), false);
});

test("explicit map geometry takes precedence over the GPS fallback", () => {
  const target = {
    mapFeatures: [{
      id: "explicit-point",
      type: "point",
      layer: "Location",
      description: "",
      coordinates: [12, 5],
    }],
    gpsLatitude: 5,
    gpsLongitude: 5,
  };

  assert.equal(spatialTargetIsInside(room, target), false);
  assert.deepEqual(spatialFeaturePoints(target), [{
    point: [12, 5],
    featureId: "explicit-point",
  }]);
});

test("clearing either GPS coordinate removes the spatial fallback", () => {
  assert.deepEqual(
    spatialFeaturePoints({
      mapFeatures: [],
      gpsLatitude: null,
      gpsLongitude: 5,
    }),
    [],
  );
  assert.deepEqual(
    spatialFeaturePoints({
      mapFeatures: [],
      gpsLatitude: 5,
      gpsLongitude: null,
    }),
    [],
  );
});
