import { z } from "zod";

import {
  validateGlbPayload,
  type GlbValidation,
} from "@/lib/glb-contract";
import { spatialMatrix4Schema } from "@/lib/room-scene-contract";

export const MAX_ROOM_SCAN_KEYFRAMES = 32;
export const MAX_ROOM_KEYFRAME_BYTES = 6 * 1024 * 1024;
export const MAX_TEXTURED_MESH_BYTES = 80 * 1_000_000;
export const MAX_GAUSSIAN_SPLAT_BYTES = 80 * 1_000_000;
export const MAX_GAUSSIAN_SPLAT_VERTICES = 2_000_000;

export const roomKeyframeOrientations = [
  "up",
  "up-mirrored",
  "down",
  "down-mirrored",
  "left-mirrored",
  "right",
  "right-mirrored",
  "left",
] as const;

const finiteIntrinsic = z.number().finite().min(-100_000).max(100_000);

export const roomCameraIntrinsicsSchema = z
  .array(finiteIntrinsic)
  .length(9)
  .refine(
    (matrix) =>
      (matrix[0] ?? 0) > 0 &&
      (matrix[4] ?? 0) > 0 &&
      Math.abs((matrix[8] ?? 0) - 1) <= 0.001,
    "Expected a column-major ARKit pinhole-camera intrinsic matrix.",
  );

export const roomKeyframeFeatureDescriptorSchema = z
  .object({
    format: z.enum(["vision-feature-print-v1"]),
    dataBase64: z
      .string()
      .max(65_536)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/, "Invalid base64 descriptor."),
  })
  .strict();

export const roomKeyframeInputSchema = z
  .object({
    id: z.uuid(),
    fileField: z.string().max(80),
    capturedAt: z.iso.datetime({ offset: true }),
    timestamp: z.number().finite().min(0).max(1_000_000_000_000),
    cameraTransform: spatialMatrix4Schema,
    intrinsics: roomCameraIntrinsicsSchema,
    width: z.number().int().min(1).max(4_096),
    height: z.number().int().min(1).max(4_096),
    orientation: z.enum(roomKeyframeOrientations),
    quality: z.number().finite().min(0).max(1),
    featureDescriptor: roomKeyframeFeatureDescriptorSchema.nullish(),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.fileField !== `keyframe:${frame.id}`) {
      context.addIssue({
        code: "custom",
        path: ["fileField"],
        message: "Keyframe fileField must equal keyframe:<id>.",
      });
    }
  });

export const roomKeyframesInputSchema = z
  .array(roomKeyframeInputSchema)
  .max(MAX_ROOM_SCAN_KEYFRAMES)
  .superRefine((frames, context) => {
    const ids = new Set<string>();
    for (const [index, frame] of frames.entries()) {
      if (ids.has(frame.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Keyframe ids must be unique.",
        });
      }
      ids.add(frame.id);
    }
  });

export type RoomCameraIntrinsics = z.infer<typeof roomCameraIntrinsicsSchema>;
export type RoomKeyframeFeatureDescriptor = z.infer<
  typeof roomKeyframeFeatureDescriptorSchema
>;
export type RoomKeyframeInput = z.infer<typeof roomKeyframeInputSchema>;

export const isJpegKeyframe = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[bytes.length - 2] === 0xff &&
  bytes[bytes.length - 1] === 0xd9;

const extension = (name: string) => name.trim().toLowerCase().match(/\.[^.]+$/)?.[0];

export const keyframeFileEnvelopeIsValid = (file: {
  name: string;
  type: string;
}) =>
  file.type.toLowerCase() === "image/jpeg" &&
  [".jpg", ".jpeg"].includes(extension(file.name) ?? "");

export const photorealisticFileEnvelopeIsValid = (
  kind: "textured_mesh" | "gaussian_splat",
  file: { name: string; type: string },
) =>
  kind === "textured_mesh"
    ? file.type.toLowerCase() === "model/gltf-binary" &&
      extension(file.name) === ".glb"
    : file.type.toLowerCase() === "application/octet-stream" &&
      extension(file.name) === ".ply";

export type PhotorealisticAssetValidation = GlbValidation;

export const validateGlb = (
  bytes: Uint8Array,
): PhotorealisticAssetValidation => validateGlbPayload(bytes);

const plyScalarByteWidths: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

const readPlyScalar = (
  view: DataView,
  offset: number,
  type: string,
) => {
  switch (type) {
    case "char":
    case "int8":
      return view.getInt8(offset);
    case "uchar":
    case "uint8":
      return view.getUint8(offset);
    case "short":
    case "int16":
      return view.getInt16(offset, true);
    case "ushort":
    case "uint16":
      return view.getUint16(offset, true);
    case "int":
    case "int32":
      return view.getInt32(offset, true);
    case "uint":
    case "uint32":
      return view.getUint32(offset, true);
    case "float":
    case "float32":
      return view.getFloat32(offset, true);
    case "double":
    case "float64":
      return view.getFloat64(offset, true);
    default:
      return Number.NaN;
  }
};

export const validateGaussianSplatPly = (
  bytes: Uint8Array,
): PhotorealisticAssetValidation => {
  const headerProbe = bytes.subarray(0, Math.min(bytes.length, 65_536));
  // latin1 gives a one-byte-to-one-code-unit view, so arbitrary binary vertex
  // bytes after a short header cannot make an otherwise valid file undecodable.
  const probeText = new TextDecoder("latin1").decode(headerProbe);
  const headerEnd = /(?:^|\r?\n)end_header\r?\n/.exec(probeText);
  if (!headerEnd || headerEnd.index + headerEnd[0].length > 65_536) {
    return { valid: false, error: "The PLY header is missing or too large." };
  }
  const headerLength = headerEnd.index + headerEnd[0].length;
  const headerBytes = headerProbe.subarray(0, headerLength);
  if (headerBytes.some((value) => value > 0x7f)) {
    return { valid: false, error: "The Gaussian Splat PLY header is invalid." };
  }
  const header = new TextDecoder("ascii").decode(headerBytes);
  if (!header.startsWith("ply\n") && !header.startsWith("ply\r\n")) {
    return { valid: false, error: "The Gaussian Splat asset is not a PLY file." };
  }
  const lines = header.slice(0, headerLength).split(/\r?\n/);
  if (!lines.includes("format binary_little_endian 1.0")) {
    return {
      valid: false,
      error: "Gaussian Splat PLY files must use binary little-endian format.",
    };
  }

  let vertexCount: number | null = null;
  let currentElement: string | null = null;
  let vertexStride = 0;
  const vertexProperties = new Map<
    string,
    { type: string; offset: number }
  >();
  for (const line of lines) {
    const element = /^element\s+(\S+)\s+(\d+)$/.exec(line);
    if (element) {
      currentElement = element[1] ?? null;
      const count = Number(element[2]);
      if (!Number.isSafeInteger(count) || count < 0) {
        return { valid: false, error: "The PLY element count is invalid." };
      }
      if (currentElement === "vertex") {
        if (vertexCount !== null) {
          return { valid: false, error: "The PLY has multiple vertex elements." };
        }
        vertexCount = count;
      } else if (count !== 0) {
        return {
          valid: false,
          error: "Gaussian Splat PLY files may only contain vertices.",
        };
      }
      continue;
    }
    if (line.startsWith("property ") && currentElement === "vertex") {
      const scalar = /^property\s+(\S+)\s+(\S+)$/.exec(line);
      const byteWidth = scalar ? plyScalarByteWidths[scalar[1] ?? ""] : undefined;
      if (!byteWidth) {
        return {
          valid: false,
          error: "The PLY contains an unsupported or variable-length property.",
        };
      }
      const propertyName = scalar?.[2];
      if (!propertyName || vertexProperties.has(propertyName)) {
        return { valid: false, error: "The PLY contains duplicate vertex properties." };
      }
      vertexProperties.set(propertyName, {
        type: scalar?.[1] ?? "",
        offset: vertexStride,
      });
      vertexStride += byteWidth;
      if (vertexStride > 1_024) {
        return { valid: false, error: "The PLY vertex record is too large." };
      }
    }
  }
  if (vertexCount === null || vertexCount === 0 || vertexStride === 0) {
    return { valid: false, error: "The PLY contains no vertex data." };
  }
  if (vertexCount > MAX_GAUSSIAN_SPLAT_VERTICES) {
    return { valid: false, error: "The PLY contains too many vertices." };
  }
  if (!["x", "y", "z"].every((property) => vertexProperties.has(property))) {
    return {
      valid: false,
      error: "The Gaussian Splat PLY must contain x, y, and z vertex positions.",
    };
  }
  if (headerLength + vertexCount * vertexStride !== bytes.length) {
    return { valid: false, error: "The PLY vertex data length is invalid." };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = ["x", "y", "z"].map((name) => vertexProperties.get(name)!);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = headerLength + index * vertexStride;
    if (
      positions.some(
        (property) =>
          !Number.isFinite(
            Math.fround(
              readPlyScalar(view, base + property.offset, property.type),
            ),
          ),
      )
    ) {
      return {
        valid: false,
        error: "The Gaussian Splat PLY contains a non-finite position.",
      };
    }
  }
  return { valid: true };
};
