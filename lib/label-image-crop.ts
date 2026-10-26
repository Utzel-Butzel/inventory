export const DEFAULT_CROP_TOLERANCE = 20;
export const DEFAULT_CROP_PADDING = 2;

type Pixels = { width: number; height: number; data: Uint8ClampedArray };
export type CropBounds = { x: number; y: number; width: number; height: number };

/** Find non-white components, discarding isolated dust but preserving separate product parts. */
export function labelImageCropBounds(image: Pixels, tolerance = DEFAULT_CROP_TOLERANCE, padding = DEFAULT_CROP_PADDING): CropBounds {
  const { width, height, data } = image;
  const full = { x: 0, y: 0, width, height };
  const foreground = new Uint8Array(width * height);
  const threshold = 255 - Math.max(0, Math.min(80, tolerance));
  for (let i = 0; i < foreground.length; i++) {
    const alpha = data[i * 4 + 3] / 255;
    const darkest = Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    foreground[i] = 255 - (255 - darkest) * alpha < threshold ? 1 : 0;
  }
  const components: Array<{ size: number; left: number; top: number; right: number; bottom: number }> = [];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < foreground.length; start++) {
    if (!foreground[start]) continue;
    let head = 0, tail = 1;
    queue[0] = start;
    foreground[start] = 0;
    const part = { size: 0, left: width, top: height, right: 0, bottom: 0 };
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      part.size++;
      part.left = Math.min(part.left, x); part.right = Math.max(part.right, x);
      part.top = Math.min(part.top, y); part.bottom = Math.max(part.bottom, y);
      // Eight neighbours keep thin diagonal edges connected.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (foreground[next]) { foreground[next] = 0; queue[tail++] = next; }
      }
    }
    components.push(part);
  }
  const largest = components.reduce((max, part) => Math.max(max, part.size), 0);
  if (largest < 4) return full;
  const minimumSize = Math.max(3, largest * 0.001);
  let left = width, top = height, right = 0, bottom = 0;
  for (const part of components) {
    if (part.size < minimumSize) continue;
    left = Math.min(left, part.left); right = Math.max(right, part.right + 1);
    top = Math.min(top, part.top); bottom = Math.max(bottom, part.bottom + 1);
  }
  const ratio = Math.max(-10, Math.min(20, padding)) / 100;
  const marginX = (right - left) * ratio, marginY = (bottom - top) * ratio;
  const x = Math.max(0, Math.floor(left - marginX)), y = Math.max(0, Math.floor(top - marginY));
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil(right + marginX)) - x), height: Math.max(1, Math.min(height, Math.ceil(bottom + marginY)) - y) };
}

export function cropLabelImage(image: HTMLImageElement, tolerance: number, padding: number): string {
  const analysis = document.createElement("canvas");
  const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
  analysis.width = Math.max(1, Math.round(image.naturalWidth * scale));
  analysis.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = analysis.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image analysis unavailable");
  context.drawImage(image, 0, 0, analysis.width, analysis.height);
  const bounds = labelImageCropBounds(context.getImageData(0, 0, analysis.width, analysis.height), tolerance, padding);
  const sx = image.naturalWidth / analysis.width, sy = image.naturalHeight / analysis.height;
  const output = document.createElement("canvas");
  const outputScale = Math.min(1, 2048 / Math.max(bounds.width * sx, bounds.height * sy));
  output.width = Math.max(1, Math.round(bounds.width * sx * outputScale));
  output.height = Math.max(1, Math.round(bounds.height * sy * outputScale));
  const target = output.getContext("2d");
  if (!target) throw new Error("Image crop unavailable");
  target.fillStyle = "#fff";
  target.fillRect(0, 0, output.width, output.height);
  target.drawImage(image, bounds.x * sx, bounds.y * sy, bounds.width * sx, bounds.height * sy, 0, 0, output.width, output.height);
  return output.toDataURL("image/png");
}

/** Wait for React's processed image to replace the source before any print capture. */
export async function waitForLabelImageCrops(node: ParentNode): Promise<void> {
  const deadline = Date.now() + 8000;
  while (node.querySelector('[data-label-crop="pending"]')) {
    if (Date.now() >= deadline) throw new Error("Image crop timed out");
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  const failed = node.querySelector('[data-label-crop="error"]');
  if (failed) throw new Error(failed.getAttribute("title") || "Image crop unavailable");
}
