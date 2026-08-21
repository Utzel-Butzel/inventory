import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPlyHeader,
  maximumGaussianSplatSourcePoints,
  parseSampledGaussianSplat,
  roomKeyframeDisplayPoint,
  roomKeyframeDisplayOrientation,
  sampleRoomAnalysisKeyframes,
  sampleRoomKeyframes,
  selectPhotorealAssetBudget,
  validateEmbeddedGlb,
} from "../lib/room-scene-visualization.ts";

test("maps native camera pixels through every display orientation", () => {
  const point = [0.2, 0.3];
  assert.deepEqual(roomKeyframeDisplayPoint("up", ...point), [0.2, 0.3]);
  assert.deepEqual(roomKeyframeDisplayPoint("up-mirrored", ...point), [0.8, 0.3]);
  assert.deepEqual(roomKeyframeDisplayPoint("down", ...point), [0.8, 0.7]);
  assert.deepEqual(roomKeyframeDisplayPoint("down-mirrored", ...point), [0.2, 0.7]);
  assert.deepEqual(roomKeyframeDisplayPoint("left", ...point), [0.3, 0.8]);
  assert.deepEqual(roomKeyframeDisplayPoint("left-mirrored", ...point), [0.3, 0.2]);
  assert.deepEqual(roomKeyframeDisplayPoint("right", ...point), [0.7, 0.2]);
  assert.deepEqual(roomKeyframeDisplayPoint("right-mirrored", ...point), [0.7, 0.8]);
});

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

function glb(document, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = binary
    ? Math.ceil(binary.byteLength / 4) * 4
    : 0;
  const bytes = new ArrayBuffer(
    20 + paddedLength + (binary ? 8 + binaryLength : 0),
  );
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  const target = new Uint8Array(bytes, 20, paddedLength);
  target.fill(0x20);
  target.set(json);
  if (binary) {
    const offset = 20 + paddedLength;
    view.setUint32(offset, binaryLength, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    new Uint8Array(bytes, offset + 8, binary.byteLength).set(binary);
  }
  return bytes;
}

const positionGlbDocument = (count = 1) => ({
  asset: { version: "2.0" },
  buffers: [{ byteLength: 12 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
  accessors: [{
    bufferView: 0,
    componentType: 5126,
    count,
    type: "VEC3",
  }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
});

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

test("samples analysis photos across distinct camera viewpoints", () => {
  const cameraTransform = (yawDegrees, x) => {
    const yaw = yawDegrees * Math.PI / 180;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    return [
      cosine, 0, -sine, 0,
      0, 1, 0, 0,
      sine, 0, cosine, 0,
      x, 1.5, 0, 1,
    ];
  };
  const frames = [0, 90, 180, 270].flatMap((yaw, direction) =>
    Array.from({ length: 6 }, (_, index) => ({
      id: `view-${direction}-${index}`,
      quality: direction === 0 && index === 0 ? 1 : 0.78 + index / 100,
      cameraTransform: cameraTransform(yaw, direction * 0.2 + index * 0.01),
      direction,
    }))
  );

  const sampled = sampleRoomAnalysisKeyframes(frames, 4);

  assert.equal(sampled.length, 4);
  assert.deepEqual(new Set(sampled.map(({ direction }) => direction)), new Set([0, 1, 2, 3]));
  assert.ok(sampled.some(({ id }) => id === "view-0-0"));
  assert.deepEqual(sampled, sampleRoomAnalysisKeyframes(frames, 4));
});

test("keeps multi-room photoreal assets inside one aggregate memory budget", () => {
  const assets = [
    { id: "primary", size: 80 },
    { id: "second", size: 30 },
    { id: "third", size: 20 },
    { id: "oversized", size: 81 },
  ];
  const result = selectPhotorealAssetBudget(assets, 80, 120, 2);
  assert.deepEqual(result.selected.map(({ id }) => id), ["primary", "second"]);
  assert.equal(result.bytes, 110);
  assert.equal(result.skipped, 2);
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

test("rejects bounded-viewer allocation bombs and unsupported GLTFLoader codecs", () => {
  assert.equal(
    validateEmbeddedGlb(
      glb(positionGlbDocument(), new Uint8Array(12)),
    ).valid,
    true,
  );
  assert.match(
    validateEmbeddedGlb(
      glb(positionGlbDocument(1_000_000_000), new Uint8Array(12)),
    ).error,
    /accessors\[0\]\.count/,
  );
  assert.equal(
    validateEmbeddedGlb(glb({
      asset: { version: "2.0" },
      buffers: [
        { byteLength: 1, uri: "data:application/octet-stream;base64,AA==" },
        { byteLength: 1, uri: "data:application/octet-stream;base64,AA==" },
      ],
    })).valid,
    false,
  );

  for (const extension of [
    "KHR_draco_mesh_compression",
    "KHR_texture_basisu",
    "EXT_meshopt_compression",
    "KHR_meshopt_compression",
  ]) {
    assert.equal(
      validateEmbeddedGlb(glb({
        asset: { version: "2.0" },
        extensionsUsed: [extension],
        extensionsRequired: [extension],
      })).valid,
      false,
    );
  }
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
