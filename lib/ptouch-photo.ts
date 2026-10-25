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

/** Halftone only the product photo; paired feed dots make square 180-dpi cells. */
export function halftonePtouchPhoto(pixels: LabelPixels, bounds: { x: number; y: number; width: number; height: number }) {
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
      gray[(y - top) * width + x - left] = (pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722) * alpha + 255 * (1 - alpha);
    }
  }
  const clarified = clarifyPtouchPhoto(gray, width, bottom - top);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * pixels.width + x) * 4;
      const threshold = (BAYER[(y % 4) * 4 + (Math.floor(x / 2) % 4)] + 0.5) * 255 / 16;
      const value = clarified[(y - top) * width + x - left] < threshold ? 0 : 255;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
  }
}
