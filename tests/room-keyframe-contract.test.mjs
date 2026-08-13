import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./support/typescript-paths-loader.mjs", import.meta.url));

const {
  MAX_GAUSSIAN_SPLAT_VERTICES,
  isJpegKeyframe,
  keyframeFileEnvelopeIsValid,
  photorealisticFileEnvelopeIsValid,
  roomKeyframesInputSchema,
  validateGaussianSplatPly,
  validateGlb,
} = await import("../lib/room-keyframe-contract.ts");

const id = "77777777-7777-4777-8777-777777777777";
const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const frame = {
  id,
  fileField: `keyframe:${id}`,
  capturedAt: "2026-08-13T10:15:30.123Z",
  timestamp: 42.25,
  cameraTransform: identity,
  intrinsics: [800, 0, 0, 0, 800, 0, 400, 300, 1],
  width: 800,
  height: 600,
  orientation: "right",
  quality: 0.92,
};

test("accepts a bounded calibrated ARKit keyframe manifest", () => {
  assert.equal(roomKeyframesInputSchema.safeParse([frame]).success, true);
});

test("rejects duplicate ids, mismatched fields, invalid intrinsics, and excess frames", () => {
  assert.equal(roomKeyframesInputSchema.safeParse([frame, frame]).success, false);
  assert.equal(
    roomKeyframesInputSchema.safeParse([{ ...frame, fileField: "keyframe:other" }])
      .success,
    false,
  );
  assert.equal(
    roomKeyframesInputSchema.safeParse([{ ...frame, intrinsics: Array(9).fill(0) }])
      .success,
    false,
  );
  assert.equal(
    roomKeyframesInputSchema.safeParse(Array.from({ length: 33 }, (_, index) => ({
      ...frame,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      fileField: `keyframe:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }))).success,
    false,
  );
});

test("uses a conservative JPEG envelope check before decoding", () => {
  assert.equal(isJpegKeyframe(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), true);
  assert.equal(isJpegKeyframe(Uint8Array.from([0xff, 0xd8, 0, 0])), false);
});

test("requires exact safe MIME and extension pairs", () => {
  assert.equal(
    keyframeFileEnvelopeIsValid({ name: "frame.JPG", type: "image/jpeg" }),
    true,
  );
  assert.equal(
    keyframeFileEnvelopeIsValid({ name: "frame.html", type: "image/jpeg" }),
    false,
  );
  assert.equal(
    photorealisticFileEnvelopeIsValid("textured_mesh", {
      name: "room.glb",
      type: "model/gltf-binary",
    }),
    true,
  );
  assert.equal(
    photorealisticFileEnvelopeIsValid("gaussian_splat", {
      name: "room.ply",
      type: "text/plain",
    }),
    false,
  );
});

const makeGlb = (json) => {
  const encoded = Buffer.from(JSON.stringify(json));
  const paddedLength = Math.ceil(encoded.length / 4) * 4;
  const bytes = Buffer.alloc(20 + paddedLength, 0x20);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(paddedLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  encoded.copy(bytes, 20);
  return bytes;
};

test("accepts self-contained GLB v2 and rejects external resources", () => {
  assert.deepEqual(validateGlb(makeGlb({ asset: { version: "2.0" } })), {
    valid: true,
  });
  assert.equal(
    validateGlb(makeGlb({
      asset: { version: "2.0" },
      images: [{ uri: "https://example.test/texture.jpg" }],
    })).valid,
    false,
  );
});

const plyHeader = Buffer.from(
  "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n",
);

test("accepts bounded binary vertex-only PLY including non-ASCII data", () => {
  const vertex = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0, 0, 0, 0, 1, 2, 3, 4]);
  assert.deepEqual(validateGaussianSplatPly(Buffer.concat([plyHeader, vertex])), {
    valid: true,
  });
  assert.equal(
    validateGaussianSplatPly(Buffer.from("ply\nformat ascii 1.0\nend_header\n"))
      .valid,
    false,
  );
  const missingPositionHeader = Buffer.from(
    "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float opacity\nend_header\n",
  );
  assert.equal(
    validateGaussianSplatPly(
      Buffer.concat([missingPositionHeader, Buffer.alloc(4)]),
    ).valid,
    false,
  );

  const nonFiniteVertex = Buffer.alloc(12);
  nonFiniteVertex.writeFloatLE(Number.NaN, 0);
  assert.equal(
    validateGaussianSplatPly(Buffer.concat([plyHeader, nonFiniteVertex])).valid,
    false,
  );

  const doubleHeader = Buffer.from(
    "ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty double x\nproperty double y\nproperty double z\nend_header\n",
  );
  const overflowingVertex = Buffer.alloc(24);
  overflowingVertex.writeDoubleLE(1e100, 0);
  overflowingVertex.writeDoubleLE(2, 8);
  overflowingVertex.writeDoubleLE(3, 16);
  assert.equal(
    validateGaussianSplatPly(
      Buffer.concat([doubleHeader, overflowingVertex]),
    ).valid,
    false,
  );

  const excessiveHeader = Buffer.from(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${MAX_GAUSSIAN_SPLAT_VERTICES + 1}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`,
  );
  assert.match(
    validateGaussianSplatPly(excessiveHeader).valid
      ? ""
      : validateGaussianSplatPly(excessiveHeader).error,
    /too many vertices/,
  );
});
