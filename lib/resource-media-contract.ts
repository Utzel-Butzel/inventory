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

export type ObjectScanImageValidation =
  | { valid: true }
  | { valid: false; status: 422; error: string };

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

/**
 * An inventory Object Capture model needs a regular image for cards, detail
 * views, AI recognition, and cover generation. The image may already belong to
 * the resource or be uploaded in the same multipart batch.
 *
 * This deliberately validates writes only. Legacy resources that contain a
 * model without an image remain readable and can be repaired by adding one.
 */
export const validateObjectScanImage = (
  existingMedia: ReadonlyArray<{ kind?: string; mimeType?: string }>,
  uploads: ReadonlyArray<{ type: string }>,
): ObjectScanImageValidation => {
  if (!uploads.some((file) => isUsdzMediaType(file.type))) {
    return { valid: true };
  }

  const hasExistingImage = existingMedia.some(
    (item) =>
      item.kind === "image" || item.mimeType?.startsWith("image/") === true,
  );
  const hasUploadedImage = uploads.some((file) => file.type.startsWith("image/"));
  if (hasExistingImage || hasUploadedImage) return { valid: true };

  return {
    valid: false,
    status: 422,
    error:
      "Apple Object Capture model uploads require an item image. Upload an image with the USDZ model, or add an image first.",
  };
};

export const isInlinePublicMediaType = (mimeType: string) =>
  (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") ||
  isUsdzMediaType(mimeType);

export const storageProviderSupportsMediaType = (
  provider: "local" | "openinary",
  mimeType: string,
) => provider === "local" || !isUsdzMediaType(mimeType);
