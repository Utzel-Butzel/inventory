import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPlyHeader,
  maximumGaussianSplatSourcePoints,
  parseSampledGaussianSplat,
  roomKeyframeDisplayOrientation,
  sampleRoomKeyframes,
  validateEmbeddedGlb,
} from "../lib/room-scene-visualization.ts";

function binaryPositionPly(points, extraProperties = []) {
  const properties = [
    ["float", "x"],
    ["float", "y"],
    ["float", "z"],
    ...extraProperties.map(({ name }) => ["float", name]),
  ];
  const header = new TextEncoder().encode([
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${points.length}`,
    ...properties.map(([type, name]) => `property ${type} ${name}`),
    "end_header",
    "",
  ].join("\n"));
  const stride = properties.length * 4;
  const bytes = new Uint8Array(header.length + points.length * stride);
  bytes.set(header);
  const view = new DataView(bytes.buffer);
  points.forEach((point, pointIndex) => {
    const values = [point.x, point.y, point.z, ...extraProperties.map(
      ({ value }) => value(point, pointIndex),
    )];
    values.forEach((value, valueIndex) => {
      view.setFloat32(header.length + pointIndex * stride + valueIndex * 4, value, true);
    });
  });
  return bytes.buffer;
}

function glb(document) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + paddedLength);
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const target = new Uint8Array(bytes, 20, paddedLength);
  target.fill(0x20);
  target.set(json);
  return bytes;
}

test("samples long keyframe captures deterministically and retains the best frame", () => {
  const frames = Array.from({ length: 300 }, (_, index) => ({
    id: `frame-${index}`,
    quality: index === 157 ? 1 : index / 1_000,
  }));

  const sampled = sampleRoomKeyframes(frames, 40);

  assert.equal(sampled.length, 40);
  assert.equal(new Set(sampled.map((frame) => frame.id)).size, 40);
  assert.ok(sampled.some((frame) => frame.id === "frame-157"));
  assert.deepEqual(sampled, sampleRoomKeyframes(frames, 40));
});

test("rejects GLB assets that can fetch external buffers or images", () => {
  assert.equal(validateEmbeddedGlb(glb({ asset: { version: "2.0" } })).valid, true);
  assert.equal(validateEmbeddedGlb(glb({ asset: { version: "1.0" } })).valid, false);
  assert.equal(
    validateEmbeddedGlb(
      glb({
        asset: { version: "2.0" },
        images: [{ uri: "https://tracking.example/texture.jpg" }],
      }),
    ).valid,
    false,
  );
  assert.equal(
    validateEmbeddedGlb(
      glb({ asset: { version: "2.0" }, buffers: [{ uri: "mesh.bin" }] }),
    ).valid,
    false,
  );
});

test("recognizes ASCII and binary PLY headers without trusting an extension", () => {
  assert.equal(hasPlyHeader(new TextEncoder().encode("ply\nformat ascii 1.0\n").buffer), true);
  assert.equal(hasPlyHeader(new TextEncoder().encode("ply\r\nformat binary_little_endian 1.0\r\n").buffer), true);
  assert.equal(hasPlyHeader(new TextEncoder().encode("not a point cloud").buffer), false);
});

test("samples a bounded PLY subset directly while retaining capture coverage", () => {
  const bytes = binaryPositionPly(
    Array.from({ length: 5 }, (_, index) => ({ x: index, y: index + 10, z: -index })),
  );

  const sampled = parseSampledGaussianSplat(bytes, 3);

  assert.equal(sampled.sourceCount, 5);
  assert.deepEqual(
    [...sampled.positions].map((value) => value || 0),
    [0, 10, 0, 2, 12, -2, 4, 14, -4],
  );
  assert.ok(
    [...sampled.colors].every(
      (value, index) => Math.abs(value - [0.72, 0.76, 0.82][index % 3]) < 1e-6,
    ),
  );
  assert.ok([...sampled.opacity, ...sampled.scale].every(Number.isFinite));
});

test("keeps malformed Gaussian Splat attributes out of GPU buffers", () => {
  const nonFiniteColor = binaryPositionPly(
    [{ x: 1, y: 2, z: 3 }],
    [
      { name: "red", value: () => Number.NaN },
      { name: "green", value: () => 0.4 },
      { name: "blue", value: () => 0.6 },
    ],
  );
  const sampled = parseSampledGaussianSplat(nonFiniteColor);
  assert.ok(
    [...sampled.colors].every(
      (value, index) => Math.abs(value - [0.72, 0.76, 0.82][index]) < 1e-6,
    ),
  );

  const nonFinitePosition = binaryPositionPly([
    { x: Number.NaN, y: 2, z: 3 },
  ]);
  assert.throws(
    () => parseSampledGaussianSplat(nonFinitePosition),
    /non-finite sampled position/,
  );

  const overflowingHeader = new TextEncoder().encode([
    "ply",
    "format binary_little_endian 1.0",
    "element vertex 1",
    "property double x",
    "property double y",
    "property double z",
    "end_header",
    "",
  ].join("\n"));
  const overflowing = new Uint8Array(overflowingHeader.length + 24);
  overflowing.set(overflowingHeader);
  const overflowingView = new DataView(overflowing.buffer);
  overflowingView.setFloat64(overflowingHeader.length, 1e100, true);
  overflowingView.setFloat64(overflowingHeader.length + 8, 2, true);
  overflowingView.setFloat64(overflowingHeader.length + 16, 3, true);
  assert.throws(
    () => parseSampledGaussianSplat(overflowing.buffer),
    /non-finite sampled position/,
  );
});

test("rejects source point counts that exceed the browser safety bound", () => {
  const header = new TextEncoder().encode([
    "ply",
    "format binary_little_endian 1.0",
    `element vertex ${maximumGaussianSplatSourcePoints + 1}`,
    "property float x",
    "property float y",
    "property float z",
    "end_header",
    "",
  ].join("\n"));
  assert.throws(
    () => parseSampledGaussianSplat(header.buffer),
    /vertex count is unsupported/,
  );
});

test("maps native AR camera rasters to their two-dimensional display orientation", () => {
  assert.deepEqual(roomKeyframeDisplayOrientation("up"), {
    quarterTurn: false,
    transform: "",
  });
  assert.deepEqual(roomKeyframeDisplayOrientation("right"), {
    quarterTurn: true,
    transform: "rotate(90deg)",
  });
  assert.deepEqual(roomKeyframeDisplayOrientation("left-mirrored"), {
    quarterTurn: true,
    transform: "rotate(-90deg) scaleX(-1)",
  });
});
