import "server-only";

import sharp from "sharp";

import {
  inventoryCountCoordinateMaximum,
  inventoryCountResultSchema,
  type InventoryCountResult,
} from "@/lib/inventory-count-contract";

const analysisMaximumDimension = 1_024;
const borderFraction = 0.04;
const minimumComponentCount = 20;
const maximumComponentCount = 500;
const maximumBackgroundVariation = 70;
const minimumForegroundFraction = 0.04;
const maximumForegroundFraction = 0.65;

export const denseComponentCountModelLabel =
  "Local repeated-component segmentation";

type Component = {
  area: number;
  width: number;
  height: number;
  centroidX: number;
  centroidY: number;
};

const histogramMedian = (histogram: Uint32Array, total: number) => {
  const target = Math.floor(total / 2);
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen > target) return value;
  }
  return histogram.length - 1;
};

const histogramPercentile = (
  histogram: Uint32Array,
  total: number,
  percentile: number,
) => {
  const target = Math.floor(total * percentile);
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen > target) return value;
  }
  return histogram.length - 1;
};

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const coefficientOfVariation = (values: readonly number[]) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!mean) return Number.POSITIVE_INFINITY;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance) / mean;
};

const decodeJpegDataUrl = (dataUrl: string) => {
  const prefix = "data:image/jpeg;base64,";
  if (!dataUrl.startsWith(prefix)) return null;
  const encoded = dataUrl.slice(prefix.length);
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/iu.test(encoded)) return null;
  return Buffer.from(encoded, "base64");
};

function findComponents(options: {
  mask: Uint8Array;
  width: number;
  height: number;
}) {
  const { mask, width, height } = options;
  const imageArea = width * height;
  const minimumArea = imageArea * 0.0003;
  const maximumArea = imageArea * 0.05;
  const seen = new Uint8Array(mask.length);
  const components: Component[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minimumX = width;
    let maximumX = 0;
    let minimumY = height;
    let maximumY = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const current = stack.pop();
      if (current === undefined) break;
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      sumX += x;
      sumY += y;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);

      const neighbors = [current - width, current + width];
      if (x > 0) neighbors.push(current - 1);
      if (x + 1 < width) neighbors.push(current + 1);
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          neighbor < mask.length &&
          mask[neighbor] &&
          !seen[neighbor]
        ) {
          seen[neighbor] = 1;
          stack.push(neighbor);
        }
      }
    }

    const touchesImageEdge =
      minimumX === 0 ||
      minimumY === 0 ||
      maximumX === width - 1 ||
      maximumY === height - 1;
    if (
      touchesImageEdge ||
      area < minimumArea ||
      area > maximumArea
    ) {
      continue;
    }
    components.push({
      area,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
      centroidX: sumX / area,
      centroidY: sumY / area,
    });
  }
  return components;
}

export async function countDenseRepeatedInventoryItems(options: {
  imageDataUrl: string;
  itemHint?: string;
  language?: string;
}): Promise<InventoryCountResult | null> {
  const imageBytes = decodeJpegDataUrl(options.imageDataUrl);
  if (!imageBytes) return null;
  const { data, info } = await sharp(imageBytes, {
    failOn: "warning",
    limitInputPixels: 64_000_000,
  })
    .resize({
      width: analysisMaximumDimension,
      height: analysisMaximumDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) return null;

  const borderWidth = Math.max(
    4,
    Math.round(Math.min(info.width, info.height) * borderFraction),
  );
  const redHistogram = new Uint32Array(256);
  const greenHistogram = new Uint32Array(256);
  const blueHistogram = new Uint32Array(256);
  let borderSamples = 0;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      if (
        x >= borderWidth &&
        y >= borderWidth &&
        x < info.width - borderWidth &&
        y < info.height - borderWidth
      ) {
        continue;
      }
      const offset = (y * info.width + x) * info.channels;
      redHistogram[data[offset]] += 1;
      greenHistogram[data[offset + 1]] += 1;
      blueHistogram[data[offset + 2]] += 1;
      borderSamples += 1;
    }
  }
  const background = [
    histogramMedian(redHistogram, borderSamples),
    histogramMedian(greenHistogram, borderSamples),
    histogramMedian(blueHistogram, borderSamples),
  ];
  const distanceHistogram = new Uint32Array(443);
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      if (
        x >= borderWidth &&
        y >= borderWidth &&
        x < info.width - borderWidth &&
        y < info.height - borderWidth
      ) {
        continue;
      }
      const offset = (y * info.width + x) * info.channels;
      const distance = Math.min(
        442,
        Math.round(
          Math.hypot(
            data[offset] - background[0],
            data[offset + 1] - background[1],
            data[offset + 2] - background[2],
          ),
        ),
      );
      distanceHistogram[distance] += 1;
    }
  }
  const backgroundVariation = histogramPercentile(
    distanceHistogram,
    borderSamples,
    0.9,
  );
  if (backgroundVariation > maximumBackgroundVariation) return null;

  const foregroundThreshold = Math.max(48, backgroundVariation * 1.8);
  const mask = new Uint8Array(info.width * info.height);
  let foregroundPixels = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * info.channels;
    const distance = Math.hypot(
      data[offset] - background[0],
      data[offset + 1] - background[1],
      data[offset + 2] - background[2],
    );
    if (distance > foregroundThreshold) {
      mask[index] = 1;
      foregroundPixels += 1;
    }
  }
  const foregroundFraction = foregroundPixels / mask.length;
  if (
    foregroundFraction < minimumForegroundFraction ||
    foregroundFraction > maximumForegroundFraction
  ) {
    return null;
  }

  const candidates = findComponents({
    mask,
    width: info.width,
    height: info.height,
  });
  if (
    candidates.length < minimumComponentCount ||
    candidates.length > maximumComponentCount
  ) {
    return null;
  }

  const medianArea = median(candidates.map((component) => component.area));
  const medianWidth = median(candidates.map((component) => component.width));
  const medianHeight = median(candidates.map((component) => component.height));
  const components = candidates.filter(
    (component) =>
      component.area >= medianArea * 0.55 &&
      component.area <= medianArea * 1.8 &&
      component.width >= medianWidth * 0.65 &&
      component.width <= medianWidth * 1.5 &&
      component.height >= medianHeight * 0.65 &&
      component.height <= medianHeight * 1.5,
  );
  if (
    components.length < minimumComponentCount ||
    components.length / candidates.length < 0.9
  ) {
    return null;
  }

  const areaVariation = coefficientOfVariation(
    components.map((component) => component.area),
  );
  const widthVariation = coefficientOfVariation(
    components.map((component) => component.width),
  );
  const heightVariation = coefficientOfVariation(
    components.map((component) => component.height),
  );
  if (
    areaVariation > 0.25 ||
    widthVariation > 0.25 ||
    heightVariation > 0.25
  ) {
    return null;
  }

  components.sort(
    (left, right) =>
      left.centroidY - right.centroidY || left.centroidX - right.centroidX,
  );
  const markers = components.map((component) => ({
    x: Math.round(
      (component.centroidX / info.width) * inventoryCountCoordinateMaximum,
    ),
    y: Math.round(
      (component.centroidY / info.height) * inventoryCountCoordinateMaximum,
    ),
  }));
  const averageVariation =
    (areaVariation + widthVariation + heightVariation) / 3;
  const confidence = Math.min(
    0.95,
    Math.max(
      0.7,
      0.92 - averageVariation * 0.5 - backgroundVariation / 1_000,
    ),
  );
  const language = options.language?.trim() || "English";
  const isGerman = /^(de|german|deutsch)(?:\b|[-_])/iu.test(language);
  const detectedItem =
    options.itemHint?.trim().slice(0, 240) ||
    (isGerman ? "wiederholte Teile" : "repeated parts");

  return inventoryCountResultSchema.parse({
    count: markers.length,
    confidence,
    detectedItem,
    isExact: false,
    explanation: isGerman
      ? `Die lokale Segmentierung hat ${markers.length} klar getrennte, ähnlich große Teile erkannt.`
      : `Local segmentation found ${markers.length} clearly separated, similarly sized parts.`,
    warnings: [
      isGerman
        ? "Die lokale Serienerkennung eignet sich nur für getrennte Teile auf einem gleichmäßigen Hintergrund; bitte die Markierungen prüfen."
        : "Local repeated-part detection is intended for separated items on a uniform background; review the markers.",
    ],
    markers,
  });
}
