import sharp from "sharp";

export const maximumImageGenerationReferenceDimension = 1024;
// Base64 expands this to at most ~10.7 MB, leaving ample room inside Google's
// legacy 20 MB inline request limit and OpenAI's larger image-edit file limit.
export const maximumImageGenerationReferenceBytes = 8_000_000;

const maximumImageGenerationReferencePixels = 64_000_000;

export type PreparedImageGenerationReference = {
  bytes: Buffer;
  filename: "inventory-source.png" | "inventory-source.jpg";
  mimeType: "image/png" | "image/jpeg";
};

const sourceImage = (source: Buffer) =>
  sharp(source, {
    failOn: "warning",
    limitInputPixels: maximumImageGenerationReferencePixels,
  });

const normalizedPipeline = (source: Buffer) =>
  sourceImage(source).rotate().resize({
    width: maximumImageGenerationReferenceDimension,
    height: maximumImageGenerationReferenceDimension,
    fit: "inside",
    withoutEnlargement: true,
  });

/**
 * Normalize an image-edit reference independently from the requested output
 * resolution. Google receives this inline as base64 and OpenAI receives it as
 * multipart data, so both the decoded bytes and dimensions must stay bounded.
 */
export async function prepareImageGenerationReferenceImage(
  source: Buffer,
): Promise<PreparedImageGenerationReference> {
  if (!source.length)
    throw new Error("The image generation reference is empty.");

  const metadata = await sourceImage(source).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(
      "The image generation reference dimensions could not be read.",
    );
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new Error(
      "Animated or multi-page image generation references are not supported.",
    );
  }

  const png = await normalizedPipeline(source)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  if (png.length <= maximumImageGenerationReferenceBytes) {
    return {
      bytes: png,
      filename: "inventory-source.png",
      mimeType: "image/png",
    };
  }

  // Very noisy, high-bit-depth, or alpha-heavy input may not compress enough
  // as PNG. JPEG is accepted by both providers and gives a firm payload bound.
  const jpeg = await normalizedPipeline(source)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  if (jpeg.length > maximumImageGenerationReferenceBytes) {
    throw new Error(
      "The normalized image generation reference is too large for the provider.",
    );
  }
  return {
    bytes: jpeg,
    filename: "inventory-source.jpg",
    mimeType: "image/jpeg",
  };
}
