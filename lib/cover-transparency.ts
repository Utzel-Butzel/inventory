import sharp from "sharp";

const outputSize = 1024;
const maximumRgbDistance = Math.sqrt(3 * 255 * 255);

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

const smoothstep = (minimum: number, maximum: number, value: number) => {
  const position = clampUnit((value - minimum) / (maximum - minimum));
  return position * position * (3 - 2 * position);
};

export function extractDifferenceMattePixels(
  whitePixels: Uint8Array,
  blackPixels: Uint8Array,
) {
  if (
    whitePixels.length !== blackPixels.length ||
    whitePixels.length % 4 !== 0
  ) {
    throw new Error("Difference-matting images must have identical dimensions.");
  }

  const output = Buffer.alloc(whitePixels.length);
  for (let offset = 0; offset < whitePixels.length; offset += 4) {
    const redDifference = whitePixels[offset]! - blackPixels[offset]!;
    const greenDifference =
      whitePixels[offset + 1]! - blackPixels[offset + 1]!;
    const blueDifference =
      whitePixels[offset + 2]! - blackPixels[offset + 2]!;
    const pixelDistance = Math.sqrt(
      redDifference * redDifference +
        greenDifference * greenDifference +
        blueDifference * blueDifference,
    );
    const alpha = clampUnit(1 - pixelDistance / maximumRgbDistance);

    if (alpha > 0.01) {
      output[offset] = Math.round(
        Math.min(255, blackPixels[offset]! / alpha),
      );
      output[offset + 1] = Math.round(
        Math.min(255, blackPixels[offset + 1]! / alpha),
      );
      output[offset + 2] = Math.round(
        Math.min(255, blackPixels[offset + 2]! / alpha),
      );
    }
    output[offset + 3] = Math.round(alpha * 255);
  }
  return output;
}

const hasTransparentNeighbour = (
  alphaValues: Float32Array,
  pixelIndex: number,
  width: number,
  height: number,
) => {
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  for (let yOffset = -2; yOffset <= 2; yOffset += 1) {
    const neighbourY = y + yOffset;
    if (neighbourY < 0 || neighbourY >= height) continue;
    for (let xOffset = -2; xOffset <= 2; xOffset += 1) {
      const neighbourX = x + xOffset;
      if (
        neighbourX < 0 ||
        neighbourX >= width ||
        (xOffset === 0 && yOffset === 0)
      ) {
        continue;
      }
      if (alphaValues[neighbourY * width + neighbourX]! < 0.08) return true;
    }
  }
  return false;
};

export function extractGreenScreenPixels(
  pixels: Uint8Array,
  width?: number,
  height?: number,
) {
  if (pixels.length % 4 !== 0) {
    throw new Error("Greenscreen image pixels must use RGBA channels.");
  }
  const pixelCount = pixels.length / 4;
  if (
    (width !== undefined || height !== undefined) &&
    (!width || !height || width * height !== pixelCount)
  ) {
    throw new Error("Greenscreen image dimensions do not match its pixels.");
  }

  const alphaValues = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const sourceAlpha = pixels[offset + 3]! / 255;
    const greenDominance = Math.max(0, green - Math.max(red, blue));
    const distanceFromGreen = Math.sqrt(
      red * red + (255 - green) * (255 - green) + blue * blue,
    );
    const dominanceAlpha = 1 - smoothstep(12, 235, greenDominance);
    const distanceAlpha = smoothstep(18, 150, distanceFromGreen);
    alphaValues[pixelIndex] = clampUnit(
      Math.min(dominanceAlpha, distanceAlpha) * sourceAlpha,
    );
  }

  const output = Buffer.alloc(pixels.length);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const sourceAlpha = pixels[offset + 3]! / 255;
    const greenDominance = Math.max(0, green - Math.max(red, blue));
    const colorSpread = green - Math.min(red, blue);
    const isKeyEdge = Boolean(
      width &&
        height &&
        colorSpread > 12 &&
        alphaValues[pixelIndex]! > 0.05 &&
        hasTransparentNeighbour(
          alphaValues,
          pixelIndex,
          width,
          height,
        ),
    );
    let alpha = alphaValues[pixelIndex]!;
    if (isKeyEdge && greenDominance <= 12) {
      // A red or blue antialiased edge mixed 50/50 with green is no longer
      // green-dominant, so a chroma-distance key alone mistakes it for an
      // opaque yellow/cyan halo. Near the transparent matte, recover the
      // minimum plausible foreground alpha from the screen composite.
      const edgeAlpha =
        (Math.max(red, blue, 255 - green) / 255) * sourceAlpha;
      alpha = Math.min(alpha, edgeAlpha);
    }

    if (alpha > 0.01) {
      let recoveredRed = Math.min(255, red / alpha);
      let recoveredBlue = Math.min(255, blue / alpha);
      const recoveredGreen = Math.min(
        255,
        Math.max(0, (green - (1 - alpha) * 255) / alpha),
      );
      const greenLimit = isKeyEdge
        ? (recoveredRed + recoveredBlue) / 2
        : Math.max(recoveredRed, recoveredBlue);
      const cleanedGreen = Math.min(recoveredGreen, greenLimit);
      if (isKeyEdge && cleanedGreen < recoveredGreen) {
        const removedSpill = recoveredGreen - cleanedGreen;
        recoveredRed = Math.min(255, recoveredRed + removedSpill * 0.15);
        recoveredBlue = Math.min(255, recoveredBlue + removedSpill * 0.15);
      }
      output[offset] = Math.round(recoveredRed);
      output[offset + 1] = Math.round(cleanedGreen);
      output[offset + 2] = Math.round(recoveredBlue);
    }
    output[offset + 3] = Math.round(alpha * 255);
  }
  return output;
}

const rgbaSquare = (bytes: Buffer) =>
  sharp(bytes, { failOnError: false })
    .rotate()
    .resize({ width: outputSize, height: outputSize, fit: "cover" })
    .ensureAlpha()
    .raw()
    .toBuffer();

const encodeRgbaPng = (pixels: Buffer) =>
  sharp(pixels, {
    raw: { width: outputSize, height: outputSize, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

export async function extractDifferenceMatte(
  whiteImage: Buffer,
  blackImage: Buffer,
) {
  const [whitePixels, blackPixels] = await Promise.all([
    rgbaSquare(whiteImage),
    rgbaSquare(blackImage),
  ]);
  return encodeRgbaPng(
    extractDifferenceMattePixels(whitePixels, blackPixels),
  );
}

export async function extractGreenScreen(image: Buffer) {
  const pixels = await rgbaSquare(image);
  return encodeRgbaPng(
    extractGreenScreenPixels(pixels, outputSize, outputSize),
  );
}
