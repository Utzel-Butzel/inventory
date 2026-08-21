import { validateGlbPayload } from "@/lib/glb-contract";

export const roomPhotorealAssetKinds = [
  "textured_mesh",
  "gaussian_splat",
] as const;

export type RoomPhotorealAssetKind =
  (typeof roomPhotorealAssetKinds)[number];

export type RoomCameraKeyframe = {
  id: string;
  capturedAt: string;
  timestamp: number;
  cameraTransform: number[];
  intrinsics: number[];
  width: number;
  height: number;
  orientation: string;
  quality: number;
  url: string;
  mimeType: string;
  size: number;
  checksumSha256: string;
};

export function roomKeyframeDisplayOrientation(orientation: string) {
  const transforms: Record<string, string> = {
    up: "",
    "up-mirrored": "scaleX(-1)",
    down: "rotate(180deg)",
    "down-mirrored": "rotate(180deg) scaleX(-1)",
    left: "rotate(-90deg)",
    "left-mirrored": "rotate(-90deg) scaleX(-1)",
    right: "rotate(90deg)",
    "right-mirrored": "rotate(90deg) scaleX(-1)",
  };
  return {
    quarterTurn: orientation.startsWith("left") || orientation.startsWith("right"),
    transform: transforms[orientation] ?? "",
  };
}

/** Maps a normalized native-camera pixel into the upright raster we display. */
export function roomKeyframeDisplayPoint(
  orientation: string,
  x: number,
  y: number,
): [number, number] {
  if (orientation === "up-mirrored") return [1 - x, y];
  if (orientation === "down") return [1 - x, 1 - y];
  if (orientation === "down-mirrored") return [x, 1 - y];
  if (orientation === "left") return [y, 1 - x];
  if (orientation === "left-mirrored") return [y, x];
  if (orientation === "right") return [1 - y, x];
  if (orientation === "right-mirrored") return [1 - y, 1 - x];
  return [x, y];
}

export const maximumVisibleRoomKeyframes = 80;
export const maximumTexturedMeshBytes = 80 * 1024 * 1024;
export const maximumGaussianSplatBytes = 80 * 1024 * 1024;
export const maximumGaussianSplatPoints = 250_000;
export const maximumGaussianSplatSourcePoints = 2_000_000;
export const maximumPhotorealAssets = 2;
export const maximumPhotorealAggregateBytes = 120 * 1024 * 1024;

/** Keeps linked-room viewers inside one bounded fetch/decode envelope. */
export function selectPhotorealAssetBudget<T extends { size: number }>(
  assets: readonly T[],
  perAssetLimit: number,
  aggregateLimit = maximumPhotorealAggregateBytes,
  countLimit = maximumPhotorealAssets,
) {
  const selected: T[] = [];
  let bytes = 0;
  for (const asset of assets) {
    if (
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > perAssetLimit ||
      selected.length >= countLimit ||
      bytes + asset.size > aggregateLimit
    ) {
      continue;
    }
    selected.push(asset);
    bytes += asset.size;
  }
  return { selected, bytes, skipped: assets.length - selected.length };
}

/**
 * Selects a spatially useful, deterministic subset without biasing the view
 * toward the beginning of a long capture. The highest-quality frame is always
 * retained so a user can inspect the best reference photo.
 */
export function sampleRoomKeyframes<T extends Pick<RoomCameraKeyframe, "id" | "quality">>(
  keyframes: readonly T[],
  limit = maximumVisibleRoomKeyframes,
) {
  if (limit <= 0 || keyframes.length === 0) return [];
  if (keyframes.length <= limit) return [...keyframes];

  const sampled = new Map<string, T>();
  const best = keyframes.reduce((current, frame) =>
    frame.quality > current.quality ? frame : current,
  );
  sampled.set(best.id, best);

  const remaining = Math.max(0, limit - sampled.size);
  for (let index = 0; index < remaining; index += 1) {
    const sourceIndex = Math.round(
      (index * (keyframes.length - 1)) / Math.max(remaining - 1, 1),
    );
    const frame = keyframes[sourceIndex];
    if (frame) sampled.set(frame.id, frame);
  }

  // A duplicate best frame can leave one free slot. Fill it from the capture
  // order while keeping the result bounded.
  if (sampled.size < limit) {
    for (const frame of keyframes) {
      sampled.set(frame.id, frame);
      if (sampled.size >= limit) break;
    }
  }
  return [...sampled.values()];
}

type AnalysisKeyframe = Pick<
  RoomCameraKeyframe,
  "id" | "quality" | "cameraTransform"
>;

type CameraView = {
  position: [number, number, number];
  forward: [number, number, number];
};

const cameraView = (frame: AnalysisKeyframe): CameraView | null => {
  const matrix = frame.cameraTransform;
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return null;
  const forwardLength = Math.hypot(matrix[8]!, matrix[9]!, matrix[10]!);
  if (forwardLength <= 1e-6) return null;
  return {
    position: [matrix[12]!, matrix[13]!, matrix[14]!],
    // ARKit cameras look down their local negative Z axis.
    forward: [
      -matrix[8]! / forwardLength,
      -matrix[9]! / forwardLength,
      -matrix[10]! / forwardLength,
    ],
  };
};

const cameraPositionDistance = (left: CameraView, right: CameraView) =>
  Math.hypot(
    left.position[0] - right.position[0],
    left.position[1] - right.position[1],
    left.position[2] - right.position[2],
  );

const cameraAngleDistance = (left: CameraView, right: CameraView) => {
  const dot = left.forward.reduce(
    (sum, value, index) => sum + value * right.forward[index]!,
    0,
  );
  return Math.acos(Math.max(-1, Math.min(1, dot))) / Math.PI;
};

/**
 * Chooses analysis photos by camera coverage instead of capture time alone.
 * A quality term keeps blurred frames out while farthest-view sampling retains
 * different positions and look directions around the room.
 */
export function sampleRoomAnalysisKeyframes<T extends AnalysisKeyframe>(
  keyframes: readonly T[],
  limit: number,
) {
  if (limit <= 0 || keyframes.length === 0) return [];
  if (keyframes.length <= limit) return [...keyframes];

  const views = keyframes.map(cameraView);
  if (!views.some(Boolean)) return sampleRoomKeyframes(keyframes, limit);

  let maximumPositionSpan = 0;
  for (let left = 0; left < views.length; left += 1) {
    const leftView = views[left];
    if (!leftView) continue;
    for (let right = left + 1; right < views.length; right += 1) {
      const rightView = views[right];
      if (!rightView) continue;
      maximumPositionSpan = Math.max(
        maximumPositionSpan,
        cameraPositionDistance(leftView, rightView),
      );
    }
  }

  const bestIndex = keyframes.reduce(
    (current, frame, index) =>
      frame.quality > keyframes[current]!.quality ? index : current,
    0,
  );
  const selected = new Set<number>([bestIndex]);

  while (selected.size < Math.min(limit, keyframes.length)) {
    let nextIndex = -1;
    let nextScore = -Infinity;
    for (let index = 0; index < keyframes.length; index += 1) {
      if (selected.has(index)) continue;
      const view = views[index];
      let minimumSpatialDistance = 1;
      let hasSpatialComparison = false;
      if (view) {
        minimumSpatialDistance = Infinity;
        for (const selectedIndex of selected) {
          const selectedView = views[selectedIndex];
          if (!selectedView) continue;
          hasSpatialComparison = true;
          const positionDistance = maximumPositionSpan > 1e-6
            ? Math.min(
                1,
                cameraPositionDistance(view, selectedView) / maximumPositionSpan,
              )
            : 0;
          const viewDistance = cameraAngleDistance(view, selectedView);
          minimumSpatialDistance = Math.min(
            minimumSpatialDistance,
            viewDistance * 0.65 + positionDistance * 0.35,
          );
        }
      }
      const temporalDistance = Math.min(
        ...[...selected].map((selectedIndex) =>
          Math.abs(index - selectedIndex) / Math.max(1, keyframes.length - 1)
        ),
      );
      const diversity = hasSpatialComparison
        ? minimumSpatialDistance * 0.88 + temporalDistance * 0.12
        : temporalDistance;
      const score = diversity * 0.86 + keyframes[index]!.quality * 0.14;
      if (score > nextScore + 1e-12) {
        nextScore = score;
        nextIndex = index;
      }
    }
    if (nextIndex < 0) break;
    selected.add(nextIndex);
  }

  return [...selected].map((index) => keyframes[index]!);
}

const decoder = new TextDecoder();

/**
 * Applies the same bounded, self-contained GLB contract as the upload route
 * immediately before browser decoding.
 */
export function validateEmbeddedGlb(bytes: ArrayBuffer) {
  return validateGlbPayload(new Uint8Array(bytes));
}

export function hasPlyHeader(bytes: ArrayBuffer) {
  if (bytes.byteLength < 4) return false;
  const header = decoder.decode(
    new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 32)),
  );
  return /^ply(?:\r\n|\r|\n)/.test(header);
}

type PlyScalarType =
  | "char"
  | "int8"
  | "uchar"
  | "uint8"
  | "short"
  | "int16"
  | "ushort"
  | "uint16"
  | "int"
  | "int32"
  | "uint"
  | "uint32"
  | "float"
  | "float32"
  | "double"
  | "float64";

type PlyProperty = {
  name: string;
  type: PlyScalarType;
  offset: number;
};

const plyScalarWidths: Record<PlyScalarType, number> = {
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
  type: PlyScalarType,
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
  }
};

const normalizedPlyColor = (value: number, type: PlyScalarType) => {
  const normalized =
    type === "uchar" || type === "uint8"
      ? value / 255
      : type === "ushort" || type === "uint16"
        ? value / 65_535
        : value;
  const srgb = Math.max(0, Math.min(1, normalized));
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
};

export type SampledGaussianSplat = {
  sourceCount: number;
  positions: Float32Array;
  colors: Float32Array;
  opacity: Float32Array;
  scale: Float32Array;
};

/**
 * Reads only an evenly spaced subset of a binary vertex-only PLY. This avoids
 * constructing a multi-million-point intermediate geometry before applying
 * the browser render cap.
 */
export function parseSampledGaussianSplat(
  bytes: ArrayBuffer,
  maximumPoints = maximumGaussianSplatPoints,
): SampledGaussianSplat {
  if (bytes.byteLength > maximumGaussianSplatBytes) {
    throw new RangeError("The Gaussian Splat asset is too large.");
  }
  if (!Number.isSafeInteger(maximumPoints) || maximumPoints < 1) {
    throw new RangeError("The Gaussian Splat sample limit is invalid.");
  }

  const probe = new Uint8Array(
    bytes,
    0,
    Math.min(bytes.byteLength, 65_536),
  );
  const probeText = new TextDecoder("latin1").decode(probe);
  const headerEnd = /(?:^|\r?\n)end_header\r?\n/.exec(probeText);
  if (!headerEnd) throw new Error("The PLY header is missing or too large.");
  const headerLength = headerEnd.index + headerEnd[0].length;
  const headerBytes = probe.subarray(0, headerLength);
  if (headerBytes.some((value) => value > 0x7f)) {
    throw new Error("The PLY header is not ASCII.");
  }
  const lines = decoder.decode(headerBytes).split(/\r?\n/);
  if (lines[0] !== "ply" || !lines.includes("format binary_little_endian 1.0")) {
    throw new Error("Only binary little-endian PLY files are supported.");
  }

  let currentElement: string | null = null;
  let vertexCount: number | null = null;
  let vertexStride = 0;
  const properties: PlyProperty[] = [];
  for (const line of lines) {
    const element = /^element\s+(\S+)\s+(\d+)$/.exec(line);
    if (element) {
      currentElement = element[1] ?? null;
      const count = Number(element[2]);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("The PLY element count is invalid.");
      }
      if (currentElement === "vertex") {
        if (vertexCount !== null) throw new Error("The PLY has multiple vertex elements.");
        vertexCount = count;
      } else if (count !== 0) {
        throw new Error("The PLY may only contain vertices.");
      }
      continue;
    }
    if (!line.startsWith("property ") || currentElement !== "vertex") continue;
    const scalar = /^property\s+(\S+)\s+(\S+)$/.exec(line);
    const type = scalar?.[1] as PlyScalarType | undefined;
    const name = scalar?.[2];
    if (!type || !name || plyScalarWidths[type] === undefined) {
      throw new Error("The PLY contains an unsupported vertex property.");
    }
    if (properties.some((property) => property.name === name)) {
      throw new Error("The PLY contains duplicate vertex properties.");
    }
    properties.push({ name, type, offset: vertexStride });
    vertexStride += plyScalarWidths[type];
    if (vertexStride > 1_024) throw new Error("The PLY vertex record is too large.");
  }

  if (
    vertexCount === null ||
    vertexCount < 1 ||
    vertexCount > maximumGaussianSplatSourcePoints ||
    vertexStride < 1
  ) {
    throw new Error("The PLY vertex count is unsupported.");
  }
  const byName = new Map(properties.map((property) => [property.name, property]));
  const x = byName.get("x");
  const y = byName.get("y");
  const z = byName.get("z");
  if (!x || !y || !z) throw new Error("The PLY has no XYZ positions.");
  if (headerLength + vertexCount * vertexStride !== bytes.byteLength) {
    throw new Error("The PLY vertex payload length is invalid.");
  }

  const targetCount = Math.min(vertexCount, maximumPoints);
  const positions = new Float32Array(targetCount * 3);
  const colors = new Float32Array(targetCount * 3);
  const opacity = new Float32Array(targetCount);
  const scale = new Float32Array(targetCount);
  const view = new DataView(bytes);
  const red = byName.get("red") ?? byName.get("r");
  const green = byName.get("green") ?? byName.get("g");
  const blue = byName.get("blue") ?? byName.get("b");
  const dc0 = byName.get("f_dc_0");
  const dc1 = byName.get("f_dc_1");
  const dc2 = byName.get("f_dc_2");
  const opacityProperty = byName.get("opacity");
  const scales = [
    byName.get("scale_0"),
    byName.get("scale_1"),
    byName.get("scale_2"),
  ];
  const read = (property: PlyProperty, base: number) =>
    readPlyScalar(view, base + property.offset, property.type);
  const sphericalHarmonicConstant = 0.282_094_791_773_878_14;

  for (let index = 0; index < targetCount; index += 1) {
    const sourceIndex = targetCount === 1
      ? 0
      : Math.round((index * (vertexCount - 1)) / (targetCount - 1));
    const base = headerLength + sourceIndex * vertexStride;
    const px = read(x, base);
    const py = read(y, base);
    const pz = read(z, base);
    if (![px, py, pz].every((value) => Number.isFinite(Math.fround(value)))) {
      throw new Error("The PLY contains a non-finite sampled position.");
    }
    const offset = index * 3;
    positions[offset] = px;
    positions[offset + 1] = py;
    positions[offset + 2] = pz;

    const rgb = red && green && blue
      ? [read(red, base), read(green, base), read(blue, base)]
      : null;
    const dc = dc0 && dc1 && dc2
      ? [read(dc0, base), read(dc1, base), read(dc2, base)]
      : null;
    if (rgb?.every(Number.isFinite)) {
      colors[offset] = normalizedPlyColor(rgb[0]!, red!.type);
      colors[offset + 1] = normalizedPlyColor(rgb[1]!, green!.type);
      colors[offset + 2] = normalizedPlyColor(rgb[2]!, blue!.type);
    } else if (dc?.every(Number.isFinite)) {
      colors[offset] = Math.max(
        0,
        Math.min(1, 0.5 + sphericalHarmonicConstant * dc[0]!),
      );
      colors[offset + 1] = Math.max(
        0,
        Math.min(1, 0.5 + sphericalHarmonicConstant * dc[1]!),
      );
      colors[offset + 2] = Math.max(
        0,
        Math.min(1, 0.5 + sphericalHarmonicConstant * dc[2]!),
      );
    } else {
      colors[offset] = 0.72;
      colors[offset + 1] = 0.76;
      colors[offset + 2] = 0.82;
    }

    const rawOpacity = opacityProperty ? read(opacityProperty, base) : Number.NaN;
    opacity[index] = Number.isFinite(rawOpacity)
      ? 1 / (1 + Math.exp(-rawOpacity))
      : 0.78;
    const rawScales = scales.map((property) =>
      property ? read(property, base) : Number.NaN,
    );
    const rawScale = rawScales.every(Number.isFinite)
      ? Math.max(...rawScales)
      : Number.NaN;
    scale[index] = Number.isFinite(rawScale)
      ? Math.max(0.003, Math.min(0.08, Math.exp(rawScale)))
      : 0.012;
  }

  return { sourceCount: vertexCount, positions, colors, opacity, scale };
}
