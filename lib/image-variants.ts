import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type {
  MediaImageFit,
  MediaImageVariantWidth,
} from "@/lib/media-image";

type VariantMedia = {
  storageKey: string;
  url: string;
  size: number;
};

const SOURCE_IMAGE_MAX_DIMENSION = 2200;
const PREWARM_WIDTHS = [96, 384, 640] as const;

const variantCacheRoot = () => {
  const configured = process.env.IMAGE_VARIANT_CACHE_PATH?.trim();
  return path.resolve(
    configured ||
      path.join(
        process.env.STORAGE_LOCAL_PATH ?? path.join(process.cwd(), "data/uploads"),
        ".variants",
      ),
  );
};

function variantCacheKey(
  media: VariantMedia,
  width: MediaImageVariantWidth,
  fit: MediaImageFit,
) {
  return createHash("sha256")
    .update("responsive-media-v1\0")
    .update(media.storageKey)
    .update("\0")
    .update(media.url)
    .update("\0")
    .update(String(media.size))
    .update("\0")
    .update(String(width))
    .update("\0")
    .update(fit)
    .digest("hex");
}

function variantCachePath(
  media: VariantMedia,
  width: MediaImageVariantWidth,
  fit: MediaImageFit,
) {
  const key = variantCacheKey(media, width, fit);
  return path.join(variantCacheRoot(), key.slice(0, 2), `${key}.webp`);
}

function variantQuality(width: MediaImageVariantWidth) {
  if (width <= 192) return 72;
  if (width <= 640) return 76;
  return 80;
}

async function renderImageVariant(
  source: Buffer,
  width: MediaImageVariantWidth,
  fit: MediaImageFit,
) {
  const pipeline = sharp(source, { failOn: "none" }).rotate();
  if (fit === "cover") {
    pipeline.resize({
      width,
      height: width,
      fit: "cover",
      position: "attention",
    });
  } else {
    pipeline.resize({ width, fit: "inside" });
  }
  return pipeline
    .webp({
      quality: variantQuality(width),
      effort: 4,
      smartSubsample: true,
    })
    .toBuffer();
}

const pendingVariants = new Map<string, Promise<Buffer>>();

export async function getOrCreateImageVariant(
  media: VariantMedia,
  width: MediaImageVariantWidth,
  fit: MediaImageFit,
  loadSource: () => Promise<Buffer>,
) {
  const target = variantCachePath(media, width, fit);
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const existing = pendingVariants.get(target);
  if (existing) return existing;

  const pending = (async () => {
    const bytes = await renderImageVariant(await loadSource(), width, fit);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return bytes;
  })();
  pendingVariants.set(target, pending);
  try {
    return await pending;
  } finally {
    pendingVariants.delete(target);
  }
}

export function imageVariantEtag(
  media: VariantMedia,
  width: MediaImageVariantWidth,
  fit: MediaImageFit,
) {
  return `"${variantCacheKey(media, width, fit)}"`;
}

const optimizableSourceMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

export async function normalizeStoredImage(bytes: Buffer, mimeType: string) {
  if (!optimizableSourceMimeTypes.has(mimeType)) return bytes;

  try {
    const metadata = await sharp(bytes, { failOn: "none" }).metadata();
    const width = metadata.autoOrient.width ?? metadata.width ?? 0;
    const height = metadata.autoOrient.height ?? metadata.height ?? 0;
    if (
      width <= SOURCE_IMAGE_MAX_DIMENSION &&
      height <= SOURCE_IMAGE_MAX_DIMENSION &&
      bytes.length < 1_500_000
    ) {
      return bytes;
    }

    const pipeline = sharp(bytes, { failOn: "none" })
      .rotate()
      .resize({
        width: SOURCE_IMAGE_MAX_DIMENSION,
        height: SOURCE_IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
    const normalized =
      mimeType === "image/jpeg"
        ? await pipeline.jpeg({ quality: 84, mozjpeg: true }).toBuffer()
        : mimeType === "image/webp"
          ? await pipeline.webp({ quality: 82, effort: 4 }).toBuffer()
          : mimeType === "image/avif"
            ? await pipeline.avif({ quality: 58, effort: 4 }).toBuffer()
            : await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

    const exceedsDimension =
      width > SOURCE_IMAGE_MAX_DIMENSION || height > SOURCE_IMAGE_MAX_DIMENSION;
    return exceedsDimension || normalized.length < bytes.length ? normalized : bytes;
  } catch {
    return bytes;
  }
}

export async function prewarmStoredImageVariants(
  media: VariantMedia,
  source: Buffer,
) {
  for (const width of PREWARM_WIDTHS) {
    await getOrCreateImageVariant(media, width, "cover", async () => source);
  }
}
