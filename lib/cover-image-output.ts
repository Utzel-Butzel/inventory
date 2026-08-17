import sharp from "sharp";

const orientedDimensions = async (bytes: Buffer) => {
  const metadata = await sharp(bytes, { failOn: "none" }).metadata();
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!width || !height) {
    throw new Error("The generated cover image dimensions could not be read.");
  }
  return { width, height };
};

export async function squareImageSizeAtMost(
  images: Buffer[],
  maximumImageSize: number,
) {
  if (!Number.isSafeInteger(maximumImageSize) || maximumImageSize < 1) {
    throw new Error(
      "The maximum generated image size must be a positive integer.",
    );
  }
  if (!images.length) {
    throw new Error("At least one generated cover image is required.");
  }
  const dimensions = await Promise.all(images.map(orientedDimensions));
  return Math.min(
    maximumImageSize,
    ...dimensions.flatMap(({ width, height }) => [width, height]),
  );
}

export async function encodeOpaqueCoverImage(
  image: Buffer,
  maximumImageSize: number,
) {
  const outputSize = await squareImageSizeAtMost([image], maximumImageSize);
  return sharp(image, { failOn: "none" })
    .rotate()
    .resize({
      width: outputSize,
      height: outputSize,
      fit: "cover",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
