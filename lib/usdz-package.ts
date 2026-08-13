const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

const EOCD_SIZE = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;
const MAX_USDZ_ENTRIES = 2_048;
const MAX_USDZ_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_USDZ_ENTRY_BYTES = 500 * 1024 * 1024;
const MAX_USDZ_PATH_BYTES = 1_024;
// Bit 11 (UTF-8 names) is the only general-purpose flag USDZ needs.
const ALLOWED_ZIP_FLAGS = 0x0800;

const allowedEntryExtensions = new Set([
  ".usd",
  ".usda",
  ".usdc",
  ".usdz",
  ".png",
  ".jpg",
  ".jpeg",
  ".exr",
  ".avif",
  ".m4a",
  ".mp3",
  ".wav",
]);
const nativeUsdExtensions = new Set([".usd", ".usda", ".usdc"]);

export type UsdzPackageValidation =
  | { valid: true; entryCount: number; totalUncompressedBytes: number }
  | { valid: false; error: string };

const failure = (error: string): UsdzPackageValidation => ({ valid: false, error });

const inBounds = (offset: number, length: number, total: number) =>
  Number.isSafeInteger(offset) &&
  Number.isSafeInteger(length) &&
  offset >= 0 &&
  length >= 0 &&
  offset <= total &&
  length <= total - offset;

const readUint16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const readUint32 = (view: DataView, offset: number) => view.getUint32(offset, true);

const lastIndexOfSignature = (
  bytes: Uint8Array,
  signature: number,
  minimumOffset: number,
) => {
  for (let offset = bytes.length - 4; offset >= minimumOffset; offset -= 1) {
    if (
      bytes[offset] === (signature & 0xff) &&
      bytes[offset + 1] === ((signature >>> 8) & 0xff) &&
      bytes[offset + 2] === ((signature >>> 16) & 0xff) &&
      bytes[offset + 3] === ((signature >>> 24) & 0xff)
    ) {
      return offset;
    }
  }
  return -1;
};

const decodeEntryPath = (bytes: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const entryExtension = (path: string) => {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
};

const safeEntryPath = (path: string) => {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[a-z]:/i.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.endsWith("/")
  ) {
    return false;
  }
  const segments = path.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
};

const nativeLayerSignatureMatches = (
  extension: string,
  bytes: Uint8Array,
  dataOffset: number,
  size: number,
) => {
  const prefixLength = Math.min(size, 16);
  const prefix = bytes.subarray(dataOffset, dataOffset + prefixLength);
  if (extension === ".usdc") {
    return prefix.length >= 8 && new TextDecoder().decode(prefix.subarray(0, 8)) === "PXR-USDC";
  }
  if (extension === ".usda") {
    return prefix.length >= 5 && new TextDecoder().decode(prefix.subarray(0, 5)) === "#usda";
  }
  if (extension === ".usd") {
    const text = new TextDecoder().decode(prefix);
    return text.startsWith("PXR-USDC") || text.startsWith("#usda");
  }
  return false;
};

const validateExtraFields = (bytes: Uint8Array) => {
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 4) return false;
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      bytes.byteLength - offset,
    );
    const dataLength = view.getUint16(2, true);
    if (dataLength > bytes.length - offset - 4) return false;
    offset += 4 + dataLength;
  }
  return offset === bytes.length;
};

/**
 * Validate the bounded subset of ZIP required by the USDZ specification.
 * This intentionally does not extract entries or compute CRCs.
 */
export const validateUsdzPackage = (bytes: Uint8Array): UsdzPackageValidation => {
  if (bytes.length < EOCD_SIZE) return failure("The USDZ package is truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdMinimum = Math.max(0, bytes.length - EOCD_SIZE - MAX_ZIP_COMMENT_BYTES);
  const eocdOffset = lastIndexOfSignature(bytes, EOCD_SIGNATURE, eocdMinimum);
  if (eocdOffset < 0 || !inBounds(eocdOffset, EOCD_SIZE, bytes.length)) {
    return failure("The USDZ package has no valid central directory.");
  }

  const commentLength = readUint16(view, eocdOffset + 20);
  if (eocdOffset + EOCD_SIZE + commentLength !== bytes.length) {
    return failure("The USDZ package end record is malformed.");
  }
  const diskNumber = readUint16(view, eocdOffset + 4);
  const centralDirectoryDisk = readUint16(view, eocdOffset + 6);
  const entriesOnDisk = readUint16(view, eocdOffset + 8);
  const entryCount = readUint16(view, eocdOffset + 10);
  const centralDirectorySize = readUint32(view, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_USDZ_ENTRIES
  ) {
    return failure("The USDZ package has an unsafe entry count or spans multiple disks.");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    (eocdOffset >= 20 && readUint32(view, eocdOffset - 20) === ZIP64_LOCATOR_SIGNATURE) ||
    (eocdOffset >= 56 && readUint32(view, eocdOffset - 56) === ZIP64_EOCD_SIGNATURE)
  ) {
    return failure("ZIP64 USDZ packages are not supported.");
  }
  if (
    !inBounds(centralDirectoryOffset, centralDirectorySize, bytes.length) ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    return failure("The USDZ central directory metadata is inconsistent.");
  }

  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  const paths = new Set<string>();
  const occupiedRanges: Array<{ start: number; end: number }> = [];
  let expectedLocalHeaderOffset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (!inBounds(cursor, 46, eocdOffset) || readUint32(view, cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      return failure("The USDZ central directory is malformed.");
    }
    const flags = readUint16(view, cursor + 8);
    const compression = readUint16(view, cursor + 10);
    const crc32 = readUint32(view, cursor + 16);
    const compressedSize = readUint32(view, cursor + 20);
    const uncompressedSize = readUint32(view, cursor + 24);
    const nameLength = readUint16(view, cursor + 28);
    const extraLength = readUint16(view, cursor + 30);
    const commentBytes = readUint16(view, cursor + 32);
    const startDisk = readUint16(view, cursor + 34);
    const localHeaderOffset = readUint32(view, cursor + 42);
    const centralEntrySize = 46 + nameLength + extraLength + commentBytes;
    if (!inBounds(cursor, centralEntrySize, eocdOffset)) {
      return failure("The USDZ central directory entry is truncated.");
    }
    if (
      nameLength === 0 ||
      nameLength > MAX_USDZ_PATH_BYTES ||
      startDisk !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      return failure("The USDZ entry metadata is unsupported.");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      return failure("Encrypted USDZ entries are not allowed.");
    }
    if ((flags & ~ALLOWED_ZIP_FLAGS) !== 0) {
      return failure("The USDZ entry uses unsupported ZIP flags.");
    }
    if (compression !== 0 || compressedSize !== uncompressedSize) {
      return failure("Every USDZ entry must use STORE with no compression.");
    }
    if (uncompressedSize > MAX_USDZ_ENTRY_BYTES) {
      return failure("A USDZ entry exceeds the safe size limit.");
    }
    totalUncompressedBytes += uncompressedSize;
    if (
      !Number.isSafeInteger(totalUncompressedBytes) ||
      totalUncompressedBytes > MAX_USDZ_TOTAL_UNCOMPRESSED_BYTES
    ) {
      return failure("The USDZ package exceeds the safe expanded-size limit.");
    }

    const centralNameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const centralExtraBytes = bytes.subarray(
      cursor + 46 + nameLength,
      cursor + 46 + nameLength + extraLength,
    );
    if (!validateExtraFields(centralExtraBytes)) {
      return failure("The USDZ central extra-field metadata is malformed.");
    }
    const path = decodeEntryPath(centralNameBytes);
    if (!path || !safeEntryPath(path) || paths.has(path)) {
      return failure("The USDZ package contains an unsafe or duplicate entry path.");
    }
    paths.add(path);
    const extension = entryExtension(path);
    if (!allowedEntryExtensions.has(extension)) {
      return failure(`The USDZ package contains an unsupported file type (${extension || "none"}).`);
    }
    if (index === 0 && (path.includes("/") || !nativeUsdExtensions.has(extension))) {
      return failure("The first USDZ entry must be a root native USD default layer.");
    }

    if (!inBounds(localHeaderOffset, 30, centralDirectoryOffset)) {
      return failure("A USDZ local file header is out of bounds.");
    }
    if (localHeaderOffset !== expectedLocalHeaderOffset) {
      return failure("USDZ local file records must be contiguous and ordered.");
    }
    if (readUint32(view, localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      return failure("A USDZ local file header is malformed.");
    }
    const localFlags = readUint16(view, localHeaderOffset + 6);
    const localCompression = readUint16(view, localHeaderOffset + 8);
    const localCrc32 = readUint32(view, localHeaderOffset + 14);
    const localCompressedSize = readUint32(view, localHeaderOffset + 18);
    const localUncompressedSize = readUint32(view, localHeaderOffset + 22);
    const localNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    const localHeaderSize = 30 + localNameLength + localExtraLength;
    const dataOffset = localHeaderOffset + localHeaderSize;
    if (
      localFlags !== flags ||
      localCompression !== compression ||
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      localNameLength !== nameLength ||
      !inBounds(localHeaderOffset, localHeaderSize, centralDirectoryOffset) ||
      !inBounds(dataOffset, compressedSize, centralDirectoryOffset)
    ) {
      return failure("USDZ central and local file metadata do not match.");
    }
    const rangeEnd = dataOffset + compressedSize;
    if (
      occupiedRanges.some(
        (range) => localHeaderOffset < range.end && range.start < rangeEnd,
      )
    ) {
      return failure("USDZ entry byte ranges must not overlap.");
    }
    occupiedRanges.push({ start: localHeaderOffset, end: rangeEnd });
    expectedLocalHeaderOffset = rangeEnd;
    const localNameBytes = bytes.subarray(
      localHeaderOffset + 30,
      localHeaderOffset + 30 + localNameLength,
    );
    const localExtraBytes = bytes.subarray(
      localHeaderOffset + 30 + localNameLength,
      localHeaderOffset + 30 + localNameLength + localExtraLength,
    );
    if (!validateExtraFields(localExtraBytes)) {
      return failure("The USDZ local extra-field metadata is malformed.");
    }
    if (!centralNameBytes.every((value, byteIndex) => value === localNameBytes[byteIndex])) {
      return failure("USDZ central and local entry paths do not match.");
    }
    if (dataOffset % 64 !== 0) {
      return failure("Every USDZ entry payload must begin on a 64-byte boundary.");
    }
    if (
      index === 0 &&
      !nativeLayerSignatureMatches(extension, bytes, dataOffset, uncompressedSize)
    ) {
      return failure("The USDZ default layer does not contain native USDA or USDC data.");
    }
    cursor += centralEntrySize;
  }
  if (cursor !== eocdOffset) return failure("The USDZ central directory size is invalid.");
  if (expectedLocalHeaderOffset !== centralDirectoryOffset) {
    return failure("The USDZ local file records do not end at the central directory.");
  }

  return { valid: true, entryCount, totalUncompressedBytes };
};
