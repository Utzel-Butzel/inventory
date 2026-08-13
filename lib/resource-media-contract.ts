export const USDZ_MEDIA_TYPE = "model/vnd.usdz+zip" as const;

export const resourceMediaMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  USDZ_MEDIA_TYPE,
] as const;

export type ResourceMediaMimeType = (typeof resourceMediaMimeTypes)[number];
export type ResourceMediaKind =
  | "image"
  | "video"
  | "document"
  | "model"
  | "unknown";

const allowedMimeTypes = new Set<string>(resourceMediaMimeTypes);

export const isResourceMediaMimeType = (
  mimeType: string,
): mimeType is ResourceMediaMimeType => allowedMimeTypes.has(mimeType);

export const isUsdzMediaType = (mimeType: string) =>
  mimeType === USDZ_MEDIA_TYPE;

export const resourceMediaKind = (mimeType: string): ResourceMediaKind => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "document";
  if (isUsdzMediaType(mimeType)) return "model";
  return "unknown";
};

export type ResourceMediaUploadValidation =
  | { valid: true }
  | { valid: false; status: 413 | 415; error: string };

export const validateResourceMediaUpload = (
  file: { name: string; type: string; size: number },
  sizeLimit: number,
): ResourceMediaUploadValidation => {
  if (file.size > sizeLimit) {
    return {
      valid: false,
      status: 413,
      error: `${file.name || "upload"} exceeds the upload size limit.`,
    };
  }

  if (!isResourceMediaMimeType(file.type)) {
    return {
      valid: false,
      status: 415,
      error: `${file.name || "upload"} has an unsupported file type (${file.type || "unknown"}).`,
    };
  }

  const hasUsdzExtension = file.name.toLowerCase().endsWith(".usdz");
  if (isUsdzMediaType(file.type) !== hasUsdzExtension) {
    return {
      valid: false,
      status: 415,
      error: `${file.name || "upload"} must use both the .usdz extension and ${USDZ_MEDIA_TYPE} content type.`,
    };
  }

  return { valid: true };
};

/** USDZ is an uncompressed ZIP package and starts with a local ZIP file header. */
export const hasUsdzFileSignature = (bytes: Uint8Array) =>
  bytes.length >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

export const isInlinePublicMediaType = (mimeType: string) =>
  (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") ||
  isUsdzMediaType(mimeType);

export const storageProviderSupportsMediaType = (
  provider: "local" | "openinary",
  mimeType: string,
) => provider === "local" || !isUsdzMediaType(mimeType);
