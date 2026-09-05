import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  rectangularRoomScene,
  splitRoomScene,
  roomEditSchema,
  roomSceneCenterPosition,
} from "../lib/room-scene-editor.ts";
import {
  roomSceneSchema,
  identitySpatialMatrix,
} from "../lib/room-scene-contract.ts";
import {
  sceneFloorPolygons,
  transformSpatialPoint,
  localArkitToGeographic,
} from "../lib/spatial-georeference.ts";
import {
  roomWalkBodyCollides,
  roomWalkPointOnFloor,
} from "../lib/room-walk-navigation.ts";
import {
  roomRenderCacheKey,
  readRoomRenderCache,
  writeRoomRenderCache,
} from "../lib/room-render-cache.ts";

const area = (scene) =>
  sceneFloorPolygons(scene).reduce(
    (sum, polygon) =>
      sum +
      Math.abs(
        polygon.reduce((s, a, i) => {
          const b = polygon[(i + 1) % polygon.length];
          return s + a[0] * b[2] - b[0] * a[2];
        }, 0),
      ) /
        2,
    0,
  );
test("editing a map anchor retains rooms offset from the shared coordinate origin", () => {
  const scene = rectangularRoomScene(6, 4, 2.7, randomUUID);
  const layout = [...identitySpatialMatrix];
  layout[12] = 18;
  layout[14] = -23;
  const center = roomSceneCenterPosition(scene, layout);
  assert.deepEqual(center, [18, 1.35, -23]);
  const anchor = {
    latitude: 52.52,
    longitude: 13.405,
    headingDegrees: 37,
    source: "manual",
    capturedAt: "2026-09-05T10:00:00Z",
    localReferencePosition: [-4, 0, 8],
  };
  const position = localArkitToGeographic(center, anchor);
  const centeredAnchor = {
    ...anchor,
    ...position,
    localReferencePosition: center,
  };
  const corner = transformSpatialPoint(layout, scene.bounds.min);
  const before = localArkitToGeographic(corner, anchor);
  const after = localArkitToGeographic(corner, centeredAnchor);
  assert.ok(Math.abs(before.latitude - after.latitude) < 1e-8);
  assert.ok(Math.abs(before.longitude - after.longitude) < 1e-8);
});
test("manual rooms and both split axes preserve total floor area and clipped boundaries", () => {
  const scene = rectangularRoomScene(6, 4, 2.7, randomUUID);
  assert.equal(area(scene), 24);
  for (const axis of ["x", "z"]) {
    const cut = 0.4;
    const [left, right] = splitRoomScene(scene, axis, cut, randomUUID);
    assert.ok(roomSceneSchema.safeParse(left).success);
    assert.ok(roomSceneSchema.safeParse(right).success);
    assert.ok(Math.abs(area(left) + area(right) - 24) < 1e-8);
    const index = axis === "x" ? 0 : 2;
    for (const polygon of sceneFloorPolygons(left))
      for (const p of polygon) assert.ok(p[index] <= cut + 1e-7);
    for (const polygon of sceneFloorPolygons(right))
      for (const p of polygon) assert.ok(p[index] >= cut - 1e-7);
    assert.equal(scene.surfaces.length, 5);
  }
});
test("split assigns objects exactly once and refuses cuts through rotated furniture", () => {
  const scene = rectangularRoomScene(6, 4, 2.7, randomUUID);
  scene.objects = [-2, 2].map((x) => ({
    id: randomUUID(),
    category: "storage",
    dimensions: [1, 2, 0.6],
    transform: [...identitySpatialMatrix.slice(0, 12), x, 1, 0, 1],
    confidence: "high",
  }));
  const [left, right] = splitRoomScene(scene, "x", 0, randomUUID);
  assert.deepEqual(
    left.objects.map((o) => o.id),
    [scene.objects[0].id],
  );
  assert.deepEqual(
    right.objects.map((o) => o.id),
    [scene.objects[1].id],
  );
  assert.throws(
    () => splitRoomScene(scene, "x", 2, randomUUID),
    /crosses-furniture/,
  );
  assert.throws(() => splitRoomScene(scene, "x", 2.5, randomUUID), /too-small/);
});
test("editor validates model options, coordinates, revisions and rejects unknown actions", () => {
  const base = {
    action: "object",
    revision: 1,
    objectId: randomUUID(),
    appearance: { variant: "bookcase", color: "#bbaacc" },
  };
  assert.ok(roomEditSchema.safeParse(base).success);
  assert.equal(
    roomEditSchema.safeParse({
      ...base,
      appearance: { variant: "external-code" },
    }).success,
    false,
  );
  assert.equal(
    roomEditSchema.safeParse({ ...base, revision: 0 }).success,
    false,
  );
  assert.equal(
    roomEditSchema.safeParse({
      ...base,
      transform: identitySpatialMatrix.map(() => NaN),
    }).success,
    false,
  );
  assert.equal(
    roomEditSchema.safeParse({ ...base, action: "delete" }).success,
    false,
  );
});
test("walking body collides with low furniture even when eyes are above it", () => {
  const shape = {
    inverse: identitySpatialMatrix,
    min: [-0.5, 0, -0.5],
    max: [0.5, 0.8, 0.5],
  };
  assert.equal(roomWalkBodyCollides([0, 1.62, 0], 1.62, 0.2, [shape]), true);
  assert.equal(roomWalkBodyCollides([1, 1.62, 0], 1.62, 0.2, [shape]), false);
  assert.equal(roomWalkBodyCollides([0, 3, 0], 1.62, 0.2, [shape]), false);
});
test("walking respects a rotated wall and floor cutouts", () => {
  const c = Math.cos(Math.PI / 4),
    s = Math.sin(Math.PI / 4);
  const inverse = [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  const wall = { inverse, min: [-2, 0, -0.05], max: [2, 3, 0.05] };
  assert.equal(roomWalkBodyCollides([1, 1.62, -1], 1.62, 0.2, [wall]), true);
  assert.equal(roomWalkBodyCollides([1, 1.62, 1], 1.62, 0.2, [wall]), false);
  const floor = [
    [
      [0, 0, 0],
      [3, 0, 0],
      [3, 0, 1],
      [1, 0, 1],
      [1, 0, 3],
      [0, 0, 3],
    ],
  ];
  assert.equal(roomWalkPointOnFloor([0.5, 1.62, 2], floor), true);
  assert.equal(roomWalkPointOnFloor([2, 1.62, 2], floor), false);
});
test("cache fingerprints ignore property order and invalidate geometry or light changes", async () => {
  const a = await roomRenderCacheKey({
    light: 1,
    object: { variant: "wardrobe", x: 0 },
  });
  assert.equal(
    a,
    await roomRenderCacheKey({
      object: { x: 0, variant: "wardrobe" },
      light: 1,
    }),
  );
  assert.notEqual(
    a,
    await roomRenderCacheKey({
      light: 1,
      object: { variant: "bookcase", x: 0 },
    }),
  );
  assert.notEqual(
    a,
    await roomRenderCacheKey({
      light: 2,
      object: { variant: "wardrobe", x: 0 },
    }),
  );
  assert.equal(await readRoomRenderCache(a), null);
  assert.equal(await writeRoomRenderCache(a, { data: 1 }, 4), false);
});

test("partition follows an L-shaped floor instead of bridging empty space", () => {
  const scene = rectangularRoomScene(3, 3, 2.7, randomUUID);
  scene.bounds = { min: [0, 0, 0], max: [3, 2.7, 3] };
  scene.surfaces = [
    {
      id: randomUUID(),
      category: "floor",
      confidence: "high",
      dimensions: [3, 0, 3],
      transform: identitySpatialMatrix,
      polygonCorners: [
        [0, 0, 0],
        [3, 0, 0],
        [3, 0, 1],
        [1, 0, 1],
        [1, 0, 3],
        [0, 0, 3],
      ],
    },
  ];
  const [left, right] = splitRoomScene(scene, "x", 2, randomUUID);
  assert.ok(Math.abs(area(left) + area(right) - 5) < 1e-8);
  assert.equal(
    left.surfaces.find((s) => s.category === "wall").dimensions[0],
    1,
  );
  assert.equal(
    right.surfaces.find((s) => s.category === "wall").dimensions[0],
    1,
  );
});

test("catalog furniture fits the measured scan extents and open shelves keep separate panels", async () => {
  const THREE = await import("three");
  const { createRoomObjectModel } =
    await import("../components/room-object-models.ts");
  const material = new THREE.MeshStandardMaterial();
  const materials = Object.fromEntries(
    [
      "primary",
      "light",
      "dark",
      "metal",
      "glass",
      "ceramic",
      "water",
      "warm",
    ].map((key) => [key, material]),
  );
  for (const variant of [
    "wardrobe",
    "bookcase",
    "shelving",
    "sideboard",
    "drawers",
    "table",
    "chair",
    "sofa",
    "bed",
  ]) {
    const dimensions = [1.4, 2.2, 0.5];
    const model = createRoomObjectModel({
      category: "storage",
      variant,
      dimensions,
      materials,
    });
    const bounds = new THREE.Box3().setFromObject(model),
      extent = bounds.getSize(new THREE.Vector3()).toArray();
    extent.forEach((value, axis) =>
      assert.ok(value <= dimensions[axis] + 1e-6, variant),
    );
    assert.ok(bounds.getCenter(new THREE.Vector3()).length() < 1e-6, variant);
    assert.ok(model.children[0].children.length >= 4, variant);
    model.traverse((object) => object.geometry?.dispose());
  }
  material.dispose();
});

test("floor renderer leaves the empty corner of an L-shaped room open", async () => {
  const THREE = await import("three");
  const { createRoomFloorGeometry } =
    await import("../lib/room-floor-geometry.ts");
  const geometry = createRoomFloorGeometry({
    id: randomUUID(),
    category: "floor",
    confidence: "high",
    dimensions: [3, 0, 3],
    transform: identitySpatialMatrix,
    polygonCorners: [
      [0, 0, 0],
      [3, 0, 0],
      [3, 0, 1],
      [1, 0, 1],
      [1, 0, 3],
      [0, 0, 3],
    ],
  });
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(2, 2, 2),
    new THREE.Vector3(0, -1, 0),
  );
  assert.equal(ray.intersectObject(mesh).length, 0);
  ray.set(new THREE.Vector3(0.5, 2, 2), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(mesh).length > 0);
  geometry.dispose();
  mesh.material.dispose();
});
