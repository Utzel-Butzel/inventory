import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  applyMetricSurfaceUvs,
  floorTextureTilesPerMetre,
  wallTextureTilesPerMetre,
} from "../lib/room-surface-uvs.ts";

const wallRepeat = new THREE.Vector2(7, 7);
const floorRepeat = new THREE.Vector2(6, 6);

/** Tiles the texture actually shows per metre, after its own repeat. */
function tilesPerMetre(geometry, repeat, axis) {
  const uv = geometry.getAttribute("uv");
  const position = geometry.getAttribute("position");
  const component = axis === "u" ? 0 : 1;
  let minUv = Infinity, maxUv = -Infinity, minPos = Infinity, maxPos = -Infinity;
  for (let vertex = 0; vertex < uv.count; vertex += 1) {
    const value = uv.getComponent(vertex, component);
    minUv = Math.min(minUv, value);
    maxUv = Math.max(maxUv, value);
    // Wall planes lie in local XY, so u tracks x and v tracks y.
    const along = position.getComponent(vertex, component === 0 ? 0 : 1);
    minPos = Math.min(minPos, along);
    maxPos = Math.max(maxPos, along);
  }
  const span = maxPos - minPos;
  if (span <= 0) return 0;
  return ((maxUv - minUv) * (component === 0 ? repeat.x : repeat.y)) / span;
}

function wallPlane(width, height) {
  const geometry = new THREE.PlaneGeometry(width, height);
  applyMetricSurfaceUvs(geometry, {
    textureRepeat: wallRepeat,
    tilesPerMetre: wallTextureTilesPerMetre,
  });
  return geometry;
}

test("tiles walls at the same density regardless of their size", () => {
  // Before this projection each plane got 0..1 across itself, so a narrow
  // wall beside a wide one tiled the same paint at a different size.
  const wide = tilesPerMetre(wallPlane(6, 2.8), wallRepeat, "u");
  const narrow = tilesPerMetre(wallPlane(1.4, 2.8), wallRepeat, "u");
  assert.ok(Math.abs(wide - wallTextureTilesPerMetre) < 1e-6);
  assert.ok(Math.abs(narrow - wallTextureTilesPerMetre) < 1e-6);
  assert.ok(Math.abs(wide - narrow) < 1e-6);
});

test("tiles an extruded wall the same as a plain one", () => {
  // A window fully inside a wall makes it an ExtrudeGeometry, whose generator
  // emits UVs in metres rather than 0..1. That was a six-fold mismatch against
  // the plain wall beside it on a six-metre wall.
  const shape = new THREE.Shape();
  shape.moveTo(-3, -1.4);
  shape.lineTo(3, -1.4);
  shape.lineTo(3, 1.4);
  shape.lineTo(-3, 1.4);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.75, -0.2);
  hole.lineTo(-0.75, 0.9);
  hole.lineTo(0.75, 0.9);
  hole.lineTo(0.75, -0.2);
  hole.closePath();
  shape.holes.push(hole);
  const extruded = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    depth: 0.1,
    steps: 1,
  });
  extruded.translate(0, 0, -0.05);
  extruded.computeVertexNormals();

  const rawSpan = extruded.getAttribute("uv");
  let rawMin = Infinity, rawMax = -Infinity;
  for (let i = 0; i < rawSpan.count; i += 1) {
    rawMin = Math.min(rawMin, rawSpan.getX(i));
    rawMax = Math.max(rawMax, rawSpan.getX(i));
  }
  // Confirm the generator really does hand back metres, not 0..1.
  assert.ok(rawMax - rawMin > 5);

  applyMetricSurfaceUvs(extruded, {
    textureRepeat: wallRepeat,
    tilesPerMetre: wallTextureTilesPerMetre,
  });
  assert.ok(
    Math.abs(tilesPerMetre(extruded, wallRepeat, "u") - wallTextureTilesPerMetre) < 1e-6,
  );
});

test("keeps the pattern continuous across pieces of one wall", () => {
  // Two halves of a split wall must agree on the UV at the edge they share,
  // otherwise the texture visibly jumps at the join.
  const left = new THREE.PlaneGeometry(2, 2.8);
  applyMetricSurfaceUvs(left, {
    offset: [-1, 0, 0],
    textureRepeat: wallRepeat,
    tilesPerMetre: wallTextureTilesPerMetre,
  });
  const right = new THREE.PlaneGeometry(2, 2.8);
  applyMetricSurfaceUvs(right, {
    offset: [1, 0, 0],
    textureRepeat: wallRepeat,
    tilesPerMetre: wallTextureTilesPerMetre,
  });
  const maxU = (attr) => {
    let m = -Infinity;
    for (let i = 0; i < attr.count; i += 1) m = Math.max(m, attr.getX(i));
    return m;
  };
  const minU = (attr) => {
    let m = Infinity;
    for (let i = 0; i < attr.count; i += 1) m = Math.min(m, attr.getX(i));
    return m;
  };
  // Left piece ends where the right piece begins, in UV as well as in space.
  assert.ok(Math.abs(maxU(left.getAttribute("uv")) - minU(right.getAttribute("uv"))) < 1e-6);
});

test("projects a floor along its own plane", () => {
  const floor = new THREE.BoxGeometry(6, 0.1, 5);
  applyMetricSurfaceUvs(floor, {
    textureRepeat: floorRepeat,
    tilesPerMetre: floorTextureTilesPerMetre,
  });
  const uv = floor.getAttribute("uv");
  const position = floor.getAttribute("position");
  // On an up-facing face the projection must follow x and z, never the 10 cm
  // thickness, which would smear the texture into stripes.
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    if (floor.getAttribute("normal").getY(vertex) < 0.9) continue;
    const expectedU = position.getX(vertex) * (floorTextureTilesPerMetre / floorRepeat.x);
    const expectedV = position.getZ(vertex) * (floorTextureTilesPerMetre / floorRepeat.y);
    assert.ok(Math.abs(uv.getX(vertex) - expectedU) < 1e-6);
    assert.ok(Math.abs(uv.getY(vertex) - expectedV) < 1e-6);
  }
});

test("leaves geometry without normals untouched", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  applyMetricSurfaceUvs(geometry, {
    textureRepeat: wallRepeat,
    tilesPerMetre: wallTextureTilesPerMetre,
  });
  assert.equal(geometry.getAttribute("uv"), undefined);
});

test("does not change how the unwrapper welds an extruded wall", async () => {
  // The lightmap unwrapper calls mergeVertices(geometry, 1e-5) on non-indexed
  // geometry, and that comparison includes uv. Scaling the UVs down brings
  // previously distinct values closer together, so this guards the one way the
  // texture projection could reach the bake: if it welded vertices the original
  // did not, charts would merge across a corner and leak light between faces.
  const { mergeVertices } = await import(
    "three/examples/jsm/utils/BufferGeometryUtils.js"
  );
  const buildWall = () => {
    const shape = new THREE.Shape();
    shape.moveTo(-3, -1.4);
    shape.lineTo(3, -1.4);
    shape.lineTo(3, 1.4);
    shape.lineTo(-3, 1.4);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-0.75, -0.2);
    hole.lineTo(-0.75, 0.9);
    hole.lineTo(0.75, 0.9);
    hole.lineTo(0.75, -0.2);
    hole.closePath();
    shape.holes.push(hole);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      bevelEnabled: false,
      depth: 0.1,
      steps: 1,
    });
    geometry.translate(0, 0, -0.05);
    geometry.computeVertexNormals();
    return geometry;
  };

  const original = mergeVertices(buildWall(), 1e-5);
  const projected = buildWall();
  applyMetricSurfaceUvs(projected, {
    textureRepeat: wallRepeat,
    tilesPerMetre: wallTextureTilesPerMetre,
  });
  const welded = mergeVertices(projected, 1e-5);

  assert.equal(
    welded.getAttribute("position").count,
    original.getAttribute("position").count,
  );
  assert.equal(welded.getIndex().count, original.getIndex().count);
});
