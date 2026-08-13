import sharp from "sharp";

const outputSize = 1024;
const maximumRgbDistance = Math.sqrt(3 * 255 * 255);

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

const smoothstep = (minimum: number, maximum: number, value: number) => {
  const position = clampUnit((value - minimum) / (maximum - minimum));
  return position * position * (3 - 2 * position);
};

type Rgb = { red: number; green: number; blue: number };

const rgbDistance = (
  red: number,
  green: number,
  blue: number,
  background: Rgb,
) =>
  Math.sqrt(
    (red - background.red) ** 2 +
      (green - background.green) ** 2 +
      (blue - background.blue) ** 2,
  );

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const estimateScreenBackground = (
  pixels: Uint8Array,
  width: number,
  height: number,
) => {
  // The generation prompt keeps the subject away from the image edge. Sampling
  // all four corners therefore identifies the actual screen even when the
  // provider ignores #00FF00 and returns an off-white or tinted backdrop.
  const sampleDepth = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (let y = 0; y < height; y += 1) {
    if (y >= sampleDepth && y < height - sampleDepth) continue;
    for (let x = 0; x < width; x += 1) {
      if (x >= sampleDepth && x < width - sampleDepth) continue;
      const offset = (y * width + x) * 4;
      reds.push(pixels[offset]!);
      greens.push(pixels[offset + 1]!);
      blues.push(pixels[offset + 2]!);
    }
  }
  const background = {
    red: median(reds),
    green: median(greens),
    blue: median(blues),
  };
  const deviations = reds.map((red, index) =>
    rgbDistance(red, greens[index]!, blues[index]!, background),
  );
  deviations.sort((left, right) => left - right);
  const deviation90 =
    deviations[Math.floor(deviations.length * 0.9)] ?? 0;
  const transparentDistance = Math.max(7, deviation90 * 1.35);
  const opaqueDistance = transparentDistance + Math.max(42, deviation90 * 2);
  return { background, opaqueDistance, transparentDistance };
};

const minimumCompositeAlpha = (
  red: number,
  green: number,
  blue: number,
  background: Rgb,
) => {
  let alpha = 0;
  for (const [color, screen] of [
    [red, background.red],
    [green, background.green],
    [blue, background.blue],
  ] as const) {
    if (color < screen && screen > 0) {
      alpha = Math.max(alpha, 1 - color / screen);
    } else if (color > screen && screen < 255) {
      alpha = Math.max(alpha, (color - screen) / (255 - screen));
    }
  }
  return clampUnit(alpha);
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

  const estimatedScreen =
    width && height && width >= 8 && height >= 8
      ? estimateScreenBackground(pixels, width, height)
      : null;
  const screen = estimatedScreen?.background ?? {
    red: 0,
    green: 255,
    blue: 0,
  };
  const screenIsGreen =
    screen.green - Math.max(screen.red, screen.blue) >= 60;

  const alphaValues = new Float32Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const sourceAlpha = pixels[offset + 3]! / 255;
    const distanceFromScreen = rgbDistance(red, green, blue, screen);
    const distanceAlpha = smoothstep(
      estimatedScreen?.transparentDistance ?? 18,
      estimatedScreen?.opaqueDistance ?? 150,
      distanceFromScreen,
    );
    if (screenIsGreen) {
      const greenDominance = Math.max(0, green - Math.max(red, blue));
      const dominanceAlpha = 1 - smoothstep(12, 235, greenDominance);
      alphaValues[pixelIndex] = clampUnit(
        Math.min(dominanceAlpha, distanceAlpha) * sourceAlpha,
      );
    } else {
      alphaValues[pixelIndex] = clampUnit(distanceAlpha * sourceAlpha);
    }
  }

  const output = Buffer.alloc(pixels.length);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const sourceAlpha = pixels[offset + 3]! / 255;
    const greenDominance = green - Math.max(red, blue);
    const colorSpread = green - Math.min(red, blue);
    const hasClearNeighbour = Boolean(
      width &&
        height &&
        hasTransparentNeighbour(alphaValues, pixelIndex, width, height),
    );
    const isKeyEdge = Boolean(
      hasClearNeighbour &&
        alphaValues[pixelIndex]! > 0.05 &&
        (alphaValues[pixelIndex]! < 0.98 ||
          (screenIsGreen && colorSpread > 12)),
    );
    let alpha = alphaValues[pixelIndex]!;
    if (isKeyEdge && (!screenIsGreen || greenDominance <= 12)) {
      // Chroma distance alone can mistake an antialiased foreground edge for
      // an opaque halo. Recover the smallest alpha compatible with a composite
      // over the detected screen color.
      alpha = Math.min(
        alpha,
        minimumCompositeAlpha(red, green, blue, screen) * sourceAlpha,
      );
    }

    if (alpha > 0.01) {
      let recoveredRed = Math.min(
        255,
        Math.max(0, (red - (1 - alpha) * screen.red) / alpha),
      );
      let recoveredGreen = Math.min(
        255,
        Math.max(0, (green - (1 - alpha) * screen.green) / alpha),
      );
      let recoveredBlue = Math.min(
        255,
        Math.max(0, (blue - (1 - alpha) * screen.blue) / alpha),
      );
      if (screenIsGreen && isKeyEdge) {
        const greenLimit = (recoveredRed + recoveredBlue) / 2;
        if (recoveredGreen > greenLimit) {
          const removedSpill = recoveredGreen - greenLimit;
          recoveredGreen = greenLimit;
          recoveredRed = Math.min(255, recoveredRed + removedSpill * 0.15);
          recoveredBlue = Math.min(255, recoveredBlue + removedSpill * 0.15);
        }
      }
      output[offset] = Math.round(recoveredRed);
      output[offset + 1] = Math.round(recoveredGreen);
      output[offset + 2] = Math.round(recoveredBlue);
    }
    output[offset + 3] = Math.round(alpha * 255);
  }
  return output;
}

const rgbaSquare = (bytes: Buffer) =>
  sharp(bytes, { failOn: "none" })
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
  const extracted = extractGreenScreenPixels(pixels, outputSize, outputSize);
  let transparentPixelCount = 0;
  for (let offset = 3; offset < extracted.length; offset += 4) {
    if (extracted[offset]! <= 4) transparentPixelCount += 1;
  }
  if (transparentPixelCount < outputSize * outputSize * 0.01) {
    throw new Error(
      "The generated screen background could not be separated reliably. Try difference matting or regenerate the cover.",
    );
  }
  return encodeRgbaPng(extracted);
}
