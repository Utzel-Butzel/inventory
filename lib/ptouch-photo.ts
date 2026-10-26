import type { LabelPixels } from "./ptouch-raster";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Moderate shadow lift, contrast and local clarity before ordered halftoning. */
export function clarifyPtouchPhoto(gray: Float32Array, width: number, height: number): Float32Array {
  // A gentler version of the selected photo comparison #3 (gamma 0.65).
  const lifted = Float32Array.from(gray, value => 255 * Math.pow(value / 255, 0.8));
  const horizontal = new Float32Array(gray.length);
  const result = new Float32Array(gray.length);
  // Eight feed dots and four head dots cover the same physical distance.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -8; dx <= 8; dx++) sum += lifted[y * width + Math.max(0, Math.min(width - 1, x + dx))];
      horizontal[y * width + x] = sum / 17;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let sum = 0;
      for (let dy = -4; dy <= 4; dy++) sum += horizontal[Math.max(0, Math.min(height - 1, y + dy)) * width + x];
      const sharpened = lifted[i] + (lifted[i] - sum / 9);
      // Preserve the white/transparent background without a dotted halo.
      result[i] = gray[i] >= 250 ? 255 : Math.max(0, Math.min(255, (sharpened - 127.5) * 1.25 + 127.5));
    }
  }
  return result;
}

export type PtouchPhotoOptimization = "auto" | "standard";

// Preserve middle/dark tones while assigning printable ink to pale surfaces.
const LIGHT_PHOTO_CURVE = [
  [0, 0], [40, 60], [100, 125], [150, 153], [180, 164],
  [210, 181], [230, 201], [240, 216], [245, 239], [248, 255], [255, 255],
] as const;

function lightPhotoTone(value: number): number {
  for (let index = 1; index < LIGHT_PHOTO_CURVE.length; index++) {
    const [x, y] = LIGHT_PHOTO_CURVE[index];
    const [previousX, previousY] = LIGHT_PHOTO_CURVE[index - 1];
    if (value <= x) return previousY + (y - previousY) * (value - previousX) / (x - previousX);
  }
  return 255;
}

/** Adapt to pale subjects without changing the established rendering of dark products. */
export function adaptivePtouchPhoto(gray: Float32Array, width: number, height: number): Float32Array {
  const standard = clarifyPtouchPhoto(gray, width, height);
  const histogram = new Uint32Array(256);
  let foregroundCount = 0;
  for (const tone of gray) {
    // Exclude near-white background from the subject brightness estimate.
    if (tone >= 245) continue;
    histogram[Math.floor(tone)]++;
    foregroundCount++;
  }
  if (foregroundCount < 16) return standard;
  let cumulative = 0, percentile = 0;
  const rank = Math.floor(foregroundCount * 0.4);
  for (; percentile < histogram.length; percentile++) {
    cumulative += histogram[percentile];
    if (cumulative > rank) break;
  }
  const amount = Math.max(0, Math.min(1, (percentile - 175) / 40));
  if (amount === 0) return standard;

  const tones = Float32Array.from(gray, tone => tone >= 248 ? 255 : lightPhotoTone(tone));
  const horizontal = new Float32Array(gray.length);
  // The printer's rectangular dots require twice the horizontal radius.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -4; dx <= 4; dx++) sum += tones[y * width + Math.max(0, Math.min(width - 1, x + dx))];
      horizontal[y * width + x] = sum / 9;
    }
  }
  return Float32Array.from(standard, (value, index) => {
    if (gray[index] >= 248) return value * (1 - amount) + 255 * amount;
    const x = index % width, y = Math.floor(index / width);
    let sum = 0;
    for (let dy = -2; dy <= 2; dy++) sum += horizontal[Math.max(0, Math.min(height - 1, y + dy)) * width + x];
    // Strengthen dark edges without brightening away pale detail again.
    const enhanced = Math.max(0, Math.min(255, tones[index] + Math.min(0, tones[index] - sum / 5) * 1.2));
    return value * (1 - amount) + enhanced * amount;
  });
}

/** Halftone only the product photo; paired feed dots make square 180-dpi cells. */
export function halftonePtouchPhoto(pixels: LabelPixels, bounds: { x: number; y: number; width: number; height: number }, optimization: PtouchPhotoOptimization = "auto", inverted = false) {
  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(pixels.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(pixels.height, Math.ceil(bounds.y + bounds.height));
  if (right <= left || bottom <= top) return;
  const width = right - left;
  const gray = new Float32Array(width * (bottom - top));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * pixels.width + x) * 4;
      const alpha = pixels.data[i + 3] / 255;
      const luminance = (pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722) * alpha + 255 * (1 - alpha);
      // Optimize the original photo tones, then invert the final print dots.
      gray[(y - top) * width + x - left] = inverted ? 255 - luminance : luminance;
    }
  }
  const clarified = optimization === "standard"
    ? clarifyPtouchPhoto(gray, width, bottom - top)
    : adaptivePtouchPhoto(gray, width, bottom - top);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * pixels.width + x) * 4;
      const threshold = (BAYER[(y % 4) * 4 + (Math.floor(x / 2) % 4)] + 0.5) * 255 / 16;
      const value = clarified[(y - top) * width + x - left] < threshold ? 0 : 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = inverted ? 255 - value : value;
      pixels.data[i + 3] = 255;
    }
  }
}
