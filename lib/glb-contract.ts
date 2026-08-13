export type GlbValidation =
  | { valid: true }
  | { valid: false; error: string };

export const MAX_GLB_BYTES = 80 * 1024 * 1024;
export const MAX_GLB_JSON_BYTES = 16 * 1024 * 1024;
export const MAX_GLB_ACCESSOR_COUNT = 5_000_000;
export const MAX_GLB_TOTAL_ACCESSOR_ELEMENTS = 20_000_000;
export const MAX_GLB_PRIMITIVES = 20_000;
export const MAX_GLB_IMAGE_DIMENSION = 8_192;
export const MAX_GLB_IMAGE_PIXELS = 32 * 1024 * 1024;
export const MAX_GLB_TOTAL_IMAGE_PIXELS = 64 * 1024 * 1024;

const MAX_GLB_BUFFER_VIEWS = 100_000;
const MAX_GLB_ACCESSORS = 100_000;
const MAX_GLB_MESHES = 20_000;
const MAX_GLB_IMAGES = 4_096;
const MAX_GLB_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;

const supportedImageMimeTypes = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const GLB_MAGIC = 0x46546c67;

const structuralArrayLimits = {
  accessors: MAX_GLB_ACCESSORS,
  animations: 10_000,
  buffers: 1,
  bufferViews: MAX_GLB_BUFFER_VIEWS,
  cameras: 10_000,
  images: MAX_GLB_IMAGES,
  materials: 20_000,
  meshes: MAX_GLB_MESHES,
  nodes: 100_000,
  samplers: 20_000,
  scenes: 10_000,
  skins: 10_000,
  textures: 20_000,
} as const;

const supportedRequiredExtensions = new Set([
  "EXT_materials_bump",
  "EXT_mesh_gpu_instancing",
  "EXT_texture_avif",
  "EXT_texture_webp",
  "KHR_lights_punctual",
  "KHR_materials_anisotropy",
  "KHR_materials_clearcoat",
  "KHR_materials_dispersion",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_iridescence",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_unlit",
  "KHR_materials_volume",
  "KHR_mesh_quantization",
  "KHR_texture_transform",
]);

type JsonRecord = Record<string, unknown>;

type ParsedDataUri = {
  mimeType: string;
  payload: string;
  byteLength: number;
};

type BufferBacking =
  | { kind: "binary"; bytes: Uint8Array }
  | { kind: "data-uri"; data: ParsedDataUri };

type BufferViewInfo = {
  byteOffset: number;
  byteLength: number;
  byteStride?: number;
};

class GlbContractError extends Error {}

function fail(message: string): never {
  throw new GlbContractError(message);
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): JsonRecord => {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  return value;
};

const requireSafeInteger = (
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) => {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail(`${label} is outside the supported range.`);
  }
  return value as number;
};

const checkedSum = (left: number, right: number, label: string) => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail(`${label} is outside the supported range.`);
  return result;
};

const checkedProduct = (left: number, right: number, label: string) => {
  const result = left * right;
  if (!Number.isSafeInteger(result)) fail(`${label} is outside the supported range.`);
  return result;
};

const requireObjectArray = <Key extends keyof typeof structuralArrayLimits>(
  document: JsonRecord,
  key: Key,
) => {
  const value = document[key];
  if (value === undefined) return [] as JsonRecord[];
  if (!Array.isArray(value)) fail(`GLB ${key} must be an array.`);
  if (value.length > structuralArrayLimits[key]) {
    fail(`The GLB contains too many ${key}.`);
  }
  return value.map((entry, index) =>
    requireRecord(entry, `GLB ${key}[${index}]`),
  );
};

const requireStringArray = (document: JsonRecord, key: string) => {
  const value = document[key];
  if (value === undefined) return [] as string[];
  if (!Array.isArray(value) || value.length > 128) {
    fail(`GLB ${key} must be a bounded array.`);
  }
  const strings = value.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) {
      fail(`GLB ${key} contains an invalid extension name.`);
    }
    return entry;
  });
  if (new Set(strings).size !== strings.length) {
    fail(`GLB ${key} contains duplicate extension names.`);
  }
  return strings;
};

const parseBase64DataUri = (uri: string, label: string): ParsedDataUri => {
  const comma = uri.indexOf(",");
  if (comma < 5 || !uri.startsWith("data:")) {
    fail(`${label} is not a valid data URI.`);
  }
  const metadata = uri.slice(5, comma).split(";");
  if (metadata.at(-1)?.toLowerCase() !== "base64") {
    fail(`${label} must use base64 encoding.`);
  }
  const payload = uri.slice(comma + 1);
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) ||
    payload.length % 4 === 1 ||
    (payload.includes("=") && payload.length % 4 !== 0)
  ) {
    fail(`${label} contains invalid base64 data.`);
  }
  const unpaddedLength = payload.replace(/=+$/, "").length;
  const byteLength = Math.floor((unpaddedLength * 6) / 8);
  return {
    mimeType: (metadata[0] || "text/plain").toLowerCase(),
    payload,
    byteLength,
  };
};

const decodeBase64Range = (
  data: ParsedDataUri,
  byteOffset: number,
  byteLength: number,
) => {
  const end = checkedSum(byteOffset, byteLength, "Data URI byte range");
  if (end > data.byteLength) fail("A data URI byte range is invalid.");
  if (byteLength === 0) return new Uint8Array();

  const firstGroup = Math.floor(byteOffset / 3);
  const lastGroup = Math.ceil(end / 3);
  const encoded = data.payload.slice(firstGroup * 4, lastGroup * 4);
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    fail("A GLB data URI could not be decoded.");
  }
  const skip = byteOffset - firstGroup * 3;
  if (skip + byteLength > decoded.length) {
    fail("A GLB data URI is shorter than declared.");
  }
  return Uint8Array.from(
    { length: byteLength },
    (_, index) => decoded.charCodeAt(skip + index),
  );
};

const bytesFromBacking = (
  backing: BufferBacking,
  byteOffset: number,
  byteLength: number,
) => {
  if (backing.kind === "binary") {
    return backing.bytes.subarray(byteOffset, byteOffset + byteLength);
  }
  return decodeBase64Range(backing.data, byteOffset, byteLength);
};

const readUint32BE = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    false,
  );

const readUint16BE = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    false,
  );

const hasAscii = (bytes: Uint8Array, offset: number, value: string) =>
  [...value].every(
    (character, index) => bytes[offset + index] === character.charCodeAt(0),
  );

const validateImageSignature = (bytes: Uint8Array, mimeType: string) => {
  const png =
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp =
    bytes.length >= 12 &&
    hasAscii(bytes, 0, "RIFF") &&
    hasAscii(bytes, 8, "WEBP");
  let avif = false;
  if (bytes.length >= 16 && hasAscii(bytes, 4, "ftyp")) {
    const boxLength = Math.min(readUint32BE(bytes, 0), bytes.length);
    for (let offset = 8; offset + 4 <= boxLength; offset += 4) {
      if (hasAscii(bytes, offset, "avif") || hasAscii(bytes, offset, "avis")) {
        avif = true;
        break;
      }
    }
  }
  const matches =
    (mimeType === "image/png" && png) ||
    (mimeType === "image/jpeg" && jpeg) ||
    (mimeType === "image/webp" && webp) ||
    (mimeType === "image/avif" && avif);
  if (!matches) fail("An embedded GLB image does not match its MIME type.");
};

const pngDimensions = (bytes: Uint8Array) => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length < 24 ||
    !signature.every((value, index) => bytes[index] === value) ||
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    fail("An embedded PNG texture has an invalid header.");
  }
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
};

const jpegDimensions = (bytes: Uint8Array, completeHeader: boolean) => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail("An embedded JPEG texture has an invalid header.");
  }
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2) fail("An embedded JPEG texture is malformed.");
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7 || offset + 7 > bytes.length) break;
      return {
        height: readUint16BE(bytes, offset + 3),
        width: readUint16BE(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  if (!completeHeader && bytes.length === MAX_IMAGE_HEADER_BYTES) {
    fail("An embedded JPEG texture header is too large.");
  }
  fail("An embedded JPEG texture has no supported size header.");
};

const validateImageDimensions = (
  bytes: Uint8Array,
  mimeType: string,
  completeHeader: boolean,
) => {
  const dimensions = mimeType === "image/png"
    ? pngDimensions(bytes)
    : jpegDimensions(bytes, completeHeader);
  const pixels = checkedProduct(
    dimensions.width,
    dimensions.height,
    "Embedded texture dimensions",
  );
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_GLB_IMAGE_DIMENSION ||
    dimensions.height > MAX_GLB_IMAGE_DIMENSION ||
    pixels > MAX_GLB_IMAGE_PIXELS
  ) {
    fail("An embedded texture exceeds the supported dimensions.");
  }
  return pixels;
};

const componentLayouts: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const accessorTypes: Record<
  string,
  { components: number; matrixDimension?: number }
> = {
  SCALAR: { components: 1 },
  VEC2: { components: 2 },
  VEC3: { components: 3 },
  VEC4: { components: 4 },
  MAT2: { components: 4, matrixDimension: 2 },
  MAT3: { components: 9, matrixDimension: 3 },
  MAT4: { components: 16, matrixDimension: 4 },
};

const validateExtensions = (document: JsonRecord) => {
  const used = requireStringArray(document, "extensionsUsed");
  const required = requireStringArray(document, "extensionsRequired");
  const usedSet = new Set(used);
  for (const extension of required) {
    if (!usedSet.has(extension)) {
      fail(`Required GLB extension ${extension} is not listed as used.`);
    }
    if (!supportedRequiredExtensions.has(extension)) {
      fail(`Required GLB extension ${extension} is not supported by the viewer.`);
    }
  }
};

const validateNestedStructuralArrays = (
  arrays: Record<string, JsonRecord[]>,
) => {
  let animationEntries = 0;
  for (const [index, animation] of arrays.animations.entries()) {
    for (const key of ["channels", "samplers"] as const) {
      const value = animation[key];
      if (!Array.isArray(value)) fail(`GLB animations[${index}].${key} must be an array.`);
      animationEntries = checkedSum(
        animationEntries,
        value.length,
        "GLB animation entry count",
      );
      if (animationEntries > 100_000) fail("The GLB contains too many animation entries.");
      value.forEach((entry, entryIndex) =>
        requireRecord(entry, `GLB animations[${index}].${key}[${entryIndex}]`),
      );
    }
  }

  let nodeReferences = 0;
  for (const [index, node] of arrays.nodes.entries()) {
    if (node.children === undefined) continue;
    if (!Array.isArray(node.children)) fail(`GLB nodes[${index}].children must be an array.`);
    nodeReferences = checkedSum(nodeReferences, node.children.length, "GLB node references");
    if (nodeReferences > 200_000) fail("The GLB contains too many node references.");
    for (const child of node.children) {
      requireSafeInteger(child, `GLB nodes[${index}] child`, 0, arrays.nodes.length - 1);
    }
  }

  for (const [index, scene] of arrays.scenes.entries()) {
    if (scene.nodes === undefined) continue;
    if (!Array.isArray(scene.nodes)) fail(`GLB scenes[${index}].nodes must be an array.`);
    if (scene.nodes.length > 100_000) fail("A GLB scene contains too many nodes.");
    for (const node of scene.nodes) {
      requireSafeInteger(node, `GLB scenes[${index}] node`, 0, arrays.nodes.length - 1);
    }
  }

  for (const [index, skin] of arrays.skins.entries()) {
    if (!Array.isArray(skin.joints) || skin.joints.length > 100_000) {
      fail(`GLB skins[${index}].joints must be a bounded array.`);
    }
    for (const joint of skin.joints) {
      requireSafeInteger(joint, `GLB skins[${index}] joint`, 0, arrays.nodes.length - 1);
    }
  }
};

/**
 * Validates the self-contained GLB subset accepted by the room viewer. The
 * implementation is runtime-neutral so the upload route and browser enforce
 * identical allocation and feature bounds before GLTFLoader sees the asset.
 */
export function validateGlbPayload(bytes: Uint8Array): GlbValidation {
  try {
    if (bytes.byteLength < 20 || bytes.byteLength > MAX_GLB_BYTES) {
      fail("The textured mesh is not a supported GLB file.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== GLB_MAGIC) {
      fail("The textured mesh is not a GLB file.");
    }
    if (view.getUint32(4, true) !== 2) fail("Only GLB version 2 is supported.");
    if (view.getUint32(8, true) !== bytes.byteLength) {
      fail("The GLB length header is invalid.");
    }

    const jsonLength = view.getUint32(12, true);
    if (
      view.getUint32(16, true) !== JSON_CHUNK_TYPE ||
      jsonLength === 0 ||
      jsonLength > MAX_GLB_JSON_BYTES ||
      jsonLength % 4 !== 0 ||
      20 + jsonLength > bytes.byteLength
    ) {
      fail("The GLB JSON chunk is invalid.");
    }

    let document: JsonRecord;
    try {
      const jsonText = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes.subarray(20, 20 + jsonLength))
        .replace(/[\u0000 ]+$/u, "");
      document = requireRecord(JSON.parse(jsonText), "GLB document");
    } catch (error) {
      if (error instanceof GlbContractError) throw error;
      fail("The GLB JSON chunk is malformed.");
    }

    const asset = requireRecord(document.asset, "GLB asset");
    if (asset.version !== "2.0") fail("The GLB asset version is invalid.");
    validateExtensions(document);

    const arrays = Object.fromEntries(
      Object.keys(structuralArrayLimits).map((key) => [
        key,
        requireObjectArray(
          document,
          key as keyof typeof structuralArrayLimits,
        ),
      ]),
    ) as Record<keyof typeof structuralArrayLimits, JsonRecord[]>;
    validateNestedStructuralArrays(arrays);

    const afterJson = 20 + jsonLength;
    let binaryChunk: Uint8Array | undefined;
    if (afterJson < bytes.byteLength) {
      if (afterJson + 8 > bytes.byteLength) fail("The GLB binary chunk is invalid.");
      const binaryLength = view.getUint32(afterJson, true);
      if (
        view.getUint32(afterJson + 4, true) !== BIN_CHUNK_TYPE ||
        binaryLength % 4 !== 0 ||
        afterJson + 8 + binaryLength !== bytes.byteLength
      ) {
        fail("The GLB binary chunk is invalid.");
      }
      binaryChunk = bytes.subarray(afterJson + 8, bytes.byteLength);
    }

    let bufferBacking: BufferBacking | undefined;
    let declaredBufferLength = 0;
    if (arrays.buffers.length === 0) {
      if (binaryChunk) fail("The GLB binary chunk has no declared buffer.");
    } else {
      const buffer = arrays.buffers[0] as JsonRecord;
      declaredBufferLength = requireSafeInteger(
        buffer.byteLength,
        "GLB buffer byteLength",
        1,
        MAX_GLB_BYTES,
      );
      if (buffer.uri === undefined) {
        if (!binaryChunk) fail("The GLB embedded buffer is missing.");
        if (
          binaryChunk.byteLength < declaredBufferLength ||
          binaryChunk.byteLength > declaredBufferLength + 3
        ) {
          fail("The GLB binary chunk length does not match its buffer.");
        }
        bufferBacking = { kind: "binary", bytes: binaryChunk };
      } else {
        if (typeof buffer.uri !== "string" || !buffer.uri.startsWith("data:")) {
          fail("Textured meshes must embed their buffers and images.");
        }
        if (binaryChunk) fail("A data URI buffer cannot also use a GLB binary chunk.");
        const data = parseBase64DataUri(buffer.uri, "GLB buffer URI");
        if (data.byteLength !== declaredBufferLength) {
          fail("The GLB data URI buffer length does not match its declaration.");
        }
        bufferBacking = { kind: "data-uri", data };
      }
    }

    const bufferViews: BufferViewInfo[] = arrays.bufferViews.map(
      (bufferView, index) => {
        if (!bufferBacking) fail("The GLB has buffer views without a buffer.");
        requireSafeInteger(bufferView.buffer, `GLB bufferViews[${index}].buffer`, 0, 0);
        const byteOffset = bufferView.byteOffset === undefined
          ? 0
          : requireSafeInteger(
              bufferView.byteOffset,
              `GLB bufferViews[${index}].byteOffset`,
            );
        const byteLength = requireSafeInteger(
          bufferView.byteLength,
          `GLB bufferViews[${index}].byteLength`,
          1,
          declaredBufferLength,
        );
        if (checkedSum(byteOffset, byteLength, "GLB buffer view range") > declaredBufferLength) {
          fail(`GLB bufferViews[${index}] exceeds its buffer.`);
        }
        let byteStride: number | undefined;
        if (bufferView.byteStride !== undefined) {
          byteStride = requireSafeInteger(
            bufferView.byteStride,
            `GLB bufferViews[${index}].byteStride`,
            4,
            252,
          );
          if (byteStride % 4 !== 0) {
            fail(`GLB bufferViews[${index}].byteStride is not aligned.`);
          }
        }
        if (
          bufferView.target !== undefined &&
          bufferView.target !== 34962 &&
          bufferView.target !== 34963
        ) {
          fail(`GLB bufferViews[${index}].target is invalid.`);
        }
        return { byteOffset, byteLength, byteStride };
      },
    );

    let totalAccessorElements = 0;
    const accessorKinds = arrays.accessors.map((accessor, index) => {
      if (accessor.sparse !== undefined) {
        fail("Sparse GLB accessors are not supported by the bounded viewer.");
      }
      if (accessor.bufferView === undefined) {
        fail("Zero-initialized GLB accessors are not supported by the bounded viewer.");
      }
      const bufferViewIndex = requireSafeInteger(
        accessor.bufferView,
        `GLB accessors[${index}].bufferView`,
        0,
        bufferViews.length - 1,
      );
      const bufferView = bufferViews[bufferViewIndex];
      if (!bufferView) fail(`GLB accessors[${index}] references a missing buffer view.`);
      const componentType = requireSafeInteger(
        accessor.componentType,
        `GLB accessors[${index}].componentType`,
      );
      const componentBytes = componentLayouts[componentType];
      if (!componentBytes) fail(`GLB accessors[${index}] has an unsupported component type.`);
      if (typeof accessor.type !== "string" || !accessorTypes[accessor.type]) {
        fail(`GLB accessors[${index}] has an unsupported item type.`);
      }
      const layout = accessorTypes[accessor.type] as {
        components: number;
        matrixDimension?: number;
      };
      const count = requireSafeInteger(
        accessor.count,
        `GLB accessors[${index}].count`,
        1,
        MAX_GLB_ACCESSOR_COUNT,
      );
      const elements = checkedProduct(count, layout.components, "GLB accessor elements");
      totalAccessorElements = checkedSum(
        totalAccessorElements,
        elements,
        "GLB total accessor elements",
      );
      if (totalAccessorElements > MAX_GLB_TOTAL_ACCESSOR_ELEMENTS) {
        fail("The GLB contains too many accessor elements.");
      }
      if (accessor.normalized !== undefined && typeof accessor.normalized !== "boolean") {
        fail(`GLB accessors[${index}].normalized must be boolean.`);
      }
      const byteOffset = accessor.byteOffset === undefined
        ? 0
        : requireSafeInteger(
            accessor.byteOffset,
            `GLB accessors[${index}].byteOffset`,
          );
      const matrixDimension = layout.matrixDimension;
      const columnBytes = matrixDimension
        ? checkedProduct(matrixDimension, componentBytes, "GLB matrix column size")
        : 0;
      const paddedColumnBytes = matrixDimension
        ? Math.ceil(columnBytes / 4) * 4
        : 0;
      const itemBytes = matrixDimension
        ? checkedProduct(paddedColumnBytes, matrixDimension, "GLB matrix item size")
        : checkedProduct(layout.components, componentBytes, "GLB accessor item size");
      const alignment = matrixDimension ? Math.max(4, componentBytes) : componentBytes;
      if (
        byteOffset % componentBytes !== 0 ||
        checkedSum(bufferView.byteOffset, byteOffset, "GLB accessor offset") % alignment !== 0
      ) {
        fail(`GLB accessors[${index}] is not correctly aligned.`);
      }
      const stride = bufferView.byteStride ?? itemBytes;
      if (stride < itemBytes || stride % componentBytes !== 0) {
        fail(`GLB accessors[${index}] has an invalid byte stride.`);
      }
      const priorItems = checkedProduct(count - 1, stride, "GLB accessor byte range");
      const requiredBytes = checkedSum(priorItems, itemBytes, "GLB accessor byte range");
      if (
        byteOffset > bufferView.byteLength ||
        requiredBytes > bufferView.byteLength - byteOffset
      ) {
        fail(`GLB accessors[${index}] exceeds its buffer view.`);
      }
      for (const key of ["min", "max"] as const) {
        if (accessor[key] === undefined) continue;
        if (
          !Array.isArray(accessor[key]) ||
          accessor[key].length !== layout.components ||
          accessor[key].some(
            (entry) => typeof entry !== "number" || !Number.isFinite(entry),
          )
        ) {
          fail(`GLB accessors[${index}].${key} is invalid.`);
        }
      }
      return { componentType, type: accessor.type };
    });

    let primitiveCount = 0;
    for (const [meshIndex, mesh] of arrays.meshes.entries()) {
      if (!Array.isArray(mesh.primitives) || mesh.primitives.length === 0) {
        fail(`GLB meshes[${meshIndex}].primitives must be a non-empty array.`);
      }
      primitiveCount = checkedSum(
        primitiveCount,
        mesh.primitives.length,
        "GLB primitive count",
      );
      if (primitiveCount > MAX_GLB_PRIMITIVES) {
        fail("The GLB contains too many mesh primitives.");
      }
      for (const [primitiveIndex, primitiveValue] of mesh.primitives.entries()) {
        const primitive = requireRecord(
          primitiveValue,
          `GLB meshes[${meshIndex}].primitives[${primitiveIndex}]`,
        );
        const attributes = requireRecord(
          primitive.attributes,
          `GLB meshes[${meshIndex}].primitives[${primitiveIndex}].attributes`,
        );
        const attributeEntries = Object.entries(attributes);
        if (attributeEntries.length === 0 || attributeEntries.length > 64) {
          fail("A GLB primitive has an unsupported number of attributes.");
        }
        for (const [semantic, accessorIndex] of attributeEntries) {
          requireSafeInteger(
            accessorIndex,
            `GLB primitive attribute ${semantic}`,
            0,
            arrays.accessors.length - 1,
          );
        }
        if (primitive.indices !== undefined) {
          const indexAccessor = requireSafeInteger(
            primitive.indices,
            "GLB primitive index accessor",
            0,
            arrays.accessors.length - 1,
          );
          const kind = accessorKinds[indexAccessor];
          if (
            !kind ||
            kind.type !== "SCALAR" ||
            ![5121, 5123, 5125].includes(kind.componentType)
          ) {
            fail("A GLB primitive uses an invalid index accessor.");
          }
        }
        if (primitive.mode !== undefined) {
          requireSafeInteger(primitive.mode, "GLB primitive mode", 0, 6);
        }
        if (primitive.targets !== undefined) {
          if (!Array.isArray(primitive.targets) || primitive.targets.length > 64) {
            fail("A GLB primitive has invalid morph targets.");
          }
          for (const targetValue of primitive.targets) {
            const target = requireRecord(targetValue, "GLB morph target");
            for (const [semantic, accessorIndex] of Object.entries(target)) {
              requireSafeInteger(
                accessorIndex,
                `GLB morph target ${semantic}`,
                0,
                arrays.accessors.length - 1,
              );
            }
          }
        }
      }
    }

    let totalImagePixels = 0;
    for (const [index, image] of arrays.images.entries()) {
      if ((image.uri === undefined) === (image.bufferView === undefined)) {
        fail(`GLB images[${index}] must have exactly one embedded source.`);
      }
      let mimeType: string;
      let imageBytes: Uint8Array;
      let imageByteLength: number;
      if (image.uri !== undefined) {
        if (typeof image.uri !== "string" || !image.uri.startsWith("data:")) {
          fail("Textured meshes must embed their buffers and images.");
        }
        const data = parseBase64DataUri(image.uri, `GLB images[${index}] URI`);
        mimeType = data.mimeType;
        imageByteLength = data.byteLength;
        imageBytes = decodeBase64Range(
          data,
          0,
          Math.min(imageByteLength, MAX_IMAGE_HEADER_BYTES),
        );
      } else {
        if (!bufferBacking) fail("An embedded GLB image has no buffer.");
        const bufferViewIndex = requireSafeInteger(
          image.bufferView,
          `GLB images[${index}].bufferView`,
          0,
          bufferViews.length - 1,
        );
        const bufferView = bufferViews[bufferViewIndex];
        if (!bufferView) fail(`GLB images[${index}] references a missing buffer view.`);
        if (bufferView.byteStride !== undefined) {
          fail("An embedded GLB image cannot use an interleaved buffer view.");
        }
        if (typeof image.mimeType !== "string") {
          fail(`GLB images[${index}].mimeType is missing.`);
        }
        mimeType = image.mimeType.toLowerCase();
        imageByteLength = bufferView.byteLength;
        imageBytes = bytesFromBacking(
          bufferBacking,
          bufferView.byteOffset,
          Math.min(imageByteLength, MAX_IMAGE_HEADER_BYTES),
        );
      }
      if (imageByteLength < 1 || imageByteLength > MAX_GLB_IMAGE_BYTES) {
        fail("An embedded GLB image exceeds the supported byte size.");
      }
      if (!supportedImageMimeTypes.has(mimeType)) {
        fail("An embedded GLB image uses an unsupported MIME type.");
      }
      validateImageSignature(imageBytes, mimeType);
      if (mimeType === "image/png" || mimeType === "image/jpeg") {
        totalImagePixels = checkedSum(
          totalImagePixels,
          validateImageDimensions(
            imageBytes,
            mimeType,
            imageBytes.byteLength === imageByteLength,
          ),
          "GLB image pixels",
        );
        if (totalImagePixels > MAX_GLB_TOTAL_IMAGE_PIXELS) {
          fail("The GLB contains too many decoded texture pixels.");
        }
      }
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "The GLB is invalid.",
    };
  }
}
