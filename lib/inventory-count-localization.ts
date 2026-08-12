import { z } from "zod";

import {
  inventoryCountCoordinateMaximum,
  inventoryCountResultSchema,
  type InventoryCountMarker,
  type InventoryCountResult,
} from "@/lib/inventory-count-contract";

export const maximumInventoryCountDetections = 500;
export const minimumInventoryCountDetectionConfidence = 0.45;
const maximumInventoryCountPatchAreaRatio = 0.12;
const maximumInventoryCountPatchSideRatio = 0.45;
const minimumOpeningColorDistance = 24;
const minimumOpeningMaterialPixelShare = 0.65;

export const inventoryCountBoxSchema = z
  .object({
    left: z.number().int().min(0).max(inventoryCountCoordinateMaximum),
    top: z.number().int().min(0).max(inventoryCountCoordinateMaximum),
    right: z.number().int().min(0).max(inventoryCountCoordinateMaximum),
    bottom: z.number().int().min(0).max(inventoryCountCoordinateMaximum),
  })
  .strict()
  .superRefine((box, context) => {
    if (box.right <= box.left) {
      context.addIssue({
        code: "custom",
        path: ["right"],
        message: "right must be greater than left",
      });
    }
    if (box.bottom <= box.top) {
      context.addIssue({
        code: "custom",
        path: ["bottom"],
        message: "bottom must be greater than top",
      });
    }
  });

export const inventoryCountDetectionSchema = z
  .object({
    box: inventoryCountBoxSchema,
    anchorBox: inventoryCountBoxSchema,
    visibleOpening: z.boolean(),
    backgroundBox: inventoryCountBoxSchema,
    confidence: z.number().min(0).max(1),
    occluded: z.boolean(),
  })
  .strict()
  .superRefine((detection, context) => {
    const { box, anchorBox, backgroundBox, visibleOpening } = detection;
    if (
      anchorBox.left < box.left ||
      anchorBox.top < box.top ||
      anchorBox.right > box.right ||
      anchorBox.bottom > box.bottom
    ) {
      context.addIssue({
        code: "custom",
        path: ["anchorBox"],
        message: "anchorBox must be fully contained by box",
      });
      return;
    }

    const boxArea = (box.right - box.left) * (box.bottom - box.top);
    const boxWidth = box.right - box.left;
    const boxHeight = box.bottom - box.top;
    const anchorArea =
      (anchorBox.right - anchorBox.left) *
      (anchorBox.bottom - anchorBox.top);
    if (
      anchorArea > boxArea * maximumInventoryCountPatchAreaRatio ||
      anchorBox.right - anchorBox.left >
        boxWidth * maximumInventoryCountPatchSideRatio ||
      anchorBox.bottom - anchorBox.top >
        boxHeight * maximumInventoryCountPatchSideRatio
    ) {
      context.addIssue({
        code: "custom",
        path: ["anchorBox"],
        message: "anchorBox must identify a small visible material patch",
      });
    }

    const backgroundIsInsideTarget =
      backgroundBox.left >= box.left &&
      backgroundBox.top >= box.top &&
      backgroundBox.right <= box.right &&
      backgroundBox.bottom <= box.bottom;
    if (visibleOpening && !backgroundIsInsideTarget) {
      context.addIssue({
        code: "custom",
        path: ["backgroundBox"],
        message:
          "backgroundBox for a visible opening must be fully contained by box",
      });
    }
    if (!visibleOpening && boxIntersectionArea(box, backgroundBox) > 0) {
      context.addIssue({
        code: "custom",
        path: ["backgroundBox"],
        message:
          "backgroundBox without a visible opening must be outside box",
      });
    }

    const backgroundArea =
      (backgroundBox.right - backgroundBox.left) *
      (backgroundBox.bottom - backgroundBox.top);
    if (
      backgroundArea > boxArea * maximumInventoryCountPatchAreaRatio ||
      backgroundBox.right - backgroundBox.left >
        boxWidth * maximumInventoryCountPatchSideRatio ||
      backgroundBox.bottom - backgroundBox.top >
        boxHeight * maximumInventoryCountPatchSideRatio
    ) {
      context.addIssue({
        code: "custom",
        path: ["backgroundBox"],
        message: "backgroundBox must identify a small opening patch",
      });
    }

    if (boxIntersectionArea(anchorBox, backgroundBox) > 0) {
      context.addIssue({
        code: "custom",
        path: ["backgroundBox"],
        message: "backgroundBox must not overlap anchorBox",
      });
    }
  });

export const inventoryCountLocalizationPassSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    detectedItem: z.string().trim().min(1).max(240),
    isExact: z.boolean(),
    explanation: z.string().trim().min(1).max(1_000),
    warnings: z.array(z.string().trim().min(1).max(240)).max(10),
    detections: z
      .array(inventoryCountDetectionSchema)
      .max(maximumInventoryCountDetections),
  })
  .strict();

export type InventoryCountBox = z.infer<typeof inventoryCountBoxSchema>;
export type InventoryCountDetection = z.infer<
  typeof inventoryCountDetectionSchema
>;
export type InventoryCountLocalizationPass = z.infer<
  typeof inventoryCountLocalizationPassSchema
>;

export type InventoryCountRaster = {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
};

const inventoryCountBoxJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    left: {
      type: "integer",
      minimum: 0,
      maximum: inventoryCountCoordinateMaximum,
    },
    top: {
      type: "integer",
      minimum: 0,
      maximum: inventoryCountCoordinateMaximum,
    },
    right: {
      type: "integer",
      minimum: 0,
      maximum: inventoryCountCoordinateMaximum,
    },
    bottom: {
      type: "integer",
      minimum: 0,
      maximum: inventoryCountCoordinateMaximum,
    },
  },
  required: ["left", "top", "right", "bottom"],
} as const;

export const inventoryCountLocalizationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    confidence: { type: "number", minimum: 0, maximum: 1 },
    detectedItem: { type: "string", minLength: 1, maxLength: 240 },
    isExact: { type: "boolean" },
    explanation: { type: "string", minLength: 1, maxLength: 1_000 },
    warnings: {
      type: "array",
      maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    detections: {
      type: "array",
      maxItems: maximumInventoryCountDetections,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          box: inventoryCountBoxJsonSchema,
          anchorBox: inventoryCountBoxJsonSchema,
          visibleOpening: { type: "boolean" },
          backgroundBox: inventoryCountBoxJsonSchema,
          confidence: { type: "number", minimum: 0, maximum: 1 },
          occluded: { type: "boolean" },
        },
        required: [
          "box",
          "anchorBox",
          "visibleOpening",
          "backgroundBox",
          "confidence",
          "occluded",
        ],
      },
    },
  },
  required: [
    "confidence",
    "detectedItem",
    "isExact",
    "explanation",
    "warnings",
    "detections",
  ],
} as const;

const boxCenter = (box: InventoryCountBox) => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2,
});

function boxIntersectionArea(
  first: InventoryCountBox,
  second: InventoryCountBox,
) {
  const width =
    Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height =
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return Math.max(0, width) * Math.max(0, height);
}

const boxArea = (box: InventoryCountBox) =>
  (box.right - box.left) * (box.bottom - box.top);

const intersectionOverUnion = (
  first: InventoryCountBox,
  second: InventoryCountBox,
) => {
  const intersection = boxIntersectionArea(first, second);
  if (!intersection) return 0;
  return intersection / (boxArea(first) + boxArea(second) - intersection);
};

/**
 * Duplicate removal is deliberately conservative. Two real objects may overlap
 * almost completely, so their target boxes alone are not enough: the small,
 * material-bound anchor boxes must also identify effectively the same patch.
 */
export function detectionsAreNearDuplicates(
  first: InventoryCountDetection,
  second: InventoryCountDetection,
) {
  if (intersectionOverUnion(first.box, second.box) < 0.94) return false;

  const firstAnchor = boxCenter(first.anchorBox);
  const secondAnchor = boxCenter(second.anchorBox);
  const anchorDistance = Math.hypot(
    firstAnchor.x - secondAnchor.x,
    firstAnchor.y - secondAnchor.y,
  );
  const smallestTargetDiagonal = Math.min(
    Math.hypot(
      first.box.right - first.box.left,
      first.box.bottom - first.box.top,
    ),
    Math.hypot(
      second.box.right - second.box.left,
      second.box.bottom - second.box.top,
    ),
  );
  const sameAnchorPatch =
    intersectionOverUnion(first.anchorBox, second.anchorBox) >= 0.5;

  return (
    sameAnchorPatch || anchorDistance <= Math.max(4, smallestTargetDiagonal * 0.04)
  );
}

export function markerFromAnchorBox(
  anchorBox: InventoryCountBox,
): InventoryCountMarker {
  const center = boxCenter(anchorBox);
  return {
    x: Math.round(center.x),
    y: Math.round(center.y),
  };
}

export function validateAndDedupeInventoryCountDetections(input: unknown) {
  const parsed = z
    .array(inventoryCountDetectionSchema)
    .max(maximumInventoryCountDetections)
    .parse(input);
  const byConfidence = [...parsed].sort(
    (first, second) => second.confidence - first.confidence,
  );
  const detections: InventoryCountDetection[] = [];
  let removedDuplicates = 0;
  let removedLowConfidence = 0;

  for (const detection of byConfidence) {
    if (detection.confidence < minimumInventoryCountDetectionConfidence) {
      removedLowConfidence += 1;
      continue;
    }
    const marker = markerFromAnchorBox(detection.anchorBox);
    if (
      detections.some((candidate) =>
        detectionsAreNearDuplicates(candidate, detection) ||
        (() => {
          const candidateMarker = markerFromAnchorBox(candidate.anchorBox);
          return (
            Math.abs(candidateMarker.x - marker.x) <= 1 &&
            Math.abs(candidateMarker.y - marker.y) <= 1
          );
        })(),
      )
    ) {
      removedDuplicates += 1;
      continue;
    }
    detections.push(detection);
  }

  detections.sort((first, second) => {
    const firstMarker = markerFromAnchorBox(first.anchorBox);
    const secondMarker = markerFromAnchorBox(second.anchorBox);
    return firstMarker.y - secondMarker.y || firstMarker.x - secondMarker.x;
  });

  return { detections, removedDuplicates, removedLowConfidence };
}

const intersectBoxes = (
  first: InventoryCountBox,
  second: InventoryCountBox,
): InventoryCountBox | null => {
  const intersection = {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  };
  return intersection.right > intersection.left &&
    intersection.bottom > intersection.top
    ? intersection
    : null;
};

const overlapOverSmallerBox = (
  first: InventoryCountBox,
  second: InventoryCountBox,
) =>
  boxIntersectionArea(first, second) /
  Math.max(1, Math.min(boxArea(first), boxArea(second)));

type ReconciledInventoryCountDetections = {
  detections: InventoryCountDetection[];
  removedUnconfirmed: number;
  removedDuplicates: number;
  removedLowConfidence: number;
};

/**
 * A displayed marker must be independently supported by both model passes.
 * The resulting anchor is the intersection of their material patches, so a
 * point accepted by only one pass can never reach the client.
 */
export function reconcileInventoryCountLocalizationPasses(
  localization: InventoryCountLocalizationPass,
  verification: InventoryCountLocalizationPass,
): ReconciledInventoryCountDetections {
  const first = validateAndDedupeInventoryCountDetections(
    localization.detections,
  );
  const second = validateAndDedupeInventoryCountDetections(
    verification.detections,
  );
  const unusedFirst = new Set(first.detections.map((_, index) => index));
  const detections: InventoryCountDetection[] = [];

  for (const verified of second.detections) {
    let best:
      | {
          index: number;
          score: number;
          anchorBox: InventoryCountBox;
          backgroundBox: InventoryCountBox | null;
        }
      | undefined;

    for (const index of unusedFirst) {
      const localized = first.detections[index];
      if (localized.visibleOpening !== verified.visibleOpening) continue;

      const targetOverlap = intersectionOverUnion(localized.box, verified.box);
      if (targetOverlap < 0.35) continue;
      const anchorBox = intersectBoxes(
        localized.anchorBox,
        verified.anchorBox,
      );
      if (!anchorBox) continue;
      const anchorOverlap = overlapOverSmallerBox(
        localized.anchorBox,
        verified.anchorBox,
      );
      if (anchorOverlap < 0.2) continue;

      const backgroundBox = intersectBoxes(
        localized.backgroundBox,
        verified.backgroundBox,
      );
      if (
        !backgroundBox ||
        overlapOverSmallerBox(
          localized.backgroundBox,
          verified.backgroundBox,
        ) < 0.2
      ) {
        continue;
      }

      const score = targetOverlap * 0.4 + anchorOverlap * 0.6;
      if (!best || score > best.score) {
        best = { index, score, anchorBox, backgroundBox };
      }
    }

    if (!best) continue;
    const localized = first.detections[best.index];
    unusedFirst.delete(best.index);
    detections.push(
      inventoryCountDetectionSchema.parse({
        box: verified.box,
        anchorBox: best.anchorBox,
        visibleOpening: verified.visibleOpening,
        backgroundBox: best.backgroundBox,
        confidence: Math.min(localized.confidence, verified.confidence),
        occluded: localized.occluded || verified.occluded,
      }),
    );
  }

  const removedUnconfirmed =
    unusedFirst.size + (second.detections.length - detections.length);
  return {
    detections,
    removedUnconfirmed,
    removedDuplicates:
      first.removedDuplicates + second.removedDuplicates,
    removedLowConfidence:
      first.removedLowConfidence + second.removedLowConfidence,
  };
}

type Rgb = readonly [number, number, number];

type PixelBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const validateRaster = (raster: InventoryCountRaster) => {
  if (
    !Number.isInteger(raster.width) ||
    !Number.isInteger(raster.height) ||
    !Number.isInteger(raster.channels) ||
    raster.width < 1 ||
    raster.height < 1 ||
    raster.channels < 3 ||
    raster.data.length < raster.width * raster.height * raster.channels
  ) {
    throw new Error("Invalid inventory-count raster.");
  }
};

const toPixelBox = (
  box: InventoryCountBox,
  raster: InventoryCountRaster,
): PixelBox => ({
  left: Math.max(
    0,
    Math.min(
      raster.width - 1,
      Math.floor((box.left / inventoryCountCoordinateMaximum) * raster.width),
    ),
  ),
  top: Math.max(
    0,
    Math.min(
      raster.height - 1,
      Math.floor((box.top / inventoryCountCoordinateMaximum) * raster.height),
    ),
  ),
  right: Math.max(
    1,
    Math.min(
      raster.width,
      Math.ceil((box.right / inventoryCountCoordinateMaximum) * raster.width),
    ),
  ),
  bottom: Math.max(
    1,
    Math.min(
      raster.height,
      Math.ceil((box.bottom / inventoryCountCoordinateMaximum) * raster.height),
    ),
  ),
});

const rgbAt = (
  raster: InventoryCountRaster,
  x: number,
  y: number,
): Rgb => {
  const index = (y * raster.width + x) * raster.channels;
  return [raster.data[index], raster.data[index + 1], raster.data[index + 2]];
};

const sampledPixels = (
  raster: InventoryCountRaster,
  box: PixelBox,
  maximumSamples = 4_096,
) => {
  const area = (box.right - box.left) * (box.bottom - box.top);
  const stride = Math.max(1, Math.ceil(Math.sqrt(area / maximumSamples)));
  const pixels: { x: number; y: number; color: Rgb }[] = [];
  for (let y = box.top; y < box.bottom; y += stride) {
    for (let x = box.left; x < box.right; x += stride) {
      pixels.push({ x, y, color: rgbAt(raster, x, y) });
    }
  }
  return pixels;
};

const sampledExteriorPixels = (
  raster: InventoryCountRaster,
  target: PixelBox,
) => {
  const horizontalMargin = Math.max(
    2,
    Math.round((target.right - target.left) * 0.12),
  );
  const verticalMargin = Math.max(
    2,
    Math.round((target.bottom - target.top) * 0.12),
  );
  const expanded: PixelBox = {
    left: Math.max(0, target.left - horizontalMargin),
    top: Math.max(0, target.top - verticalMargin),
    right: Math.min(raster.width, target.right + horizontalMargin),
    bottom: Math.min(raster.height, target.bottom + verticalMargin),
  };
  return sampledPixels(raster, expanded).filter(
    (pixel) =>
      pixel.x < target.left ||
      pixel.x >= target.right ||
      pixel.y < target.top ||
      pixel.y >= target.bottom,
  );
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  values.sort((first, second) => first - second);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
};

const medianColor = (pixels: { color: Rgb }[]): Rgb => [
  median(pixels.map((pixel) => pixel.color[0])),
  median(pixels.map((pixel) => pixel.color[1])),
  median(pixels.map((pixel) => pixel.color[2])),
];

const colorDistance = (first: Rgb, second: Rgb) =>
  Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );

const dominantColor = (pixels: { color: Rgb }[]): Rgb => {
  const buckets = new Map<
    string,
    { count: number; red: number; green: number; blue: number }
  >();
  for (const { color } of pixels) {
    const key = `${Math.floor(color[0] / 32)}:${Math.floor(
      color[1] / 32,
    )}:${Math.floor(color[2] / 32)}`;
    const bucket = buckets.get(key) ?? {
      count: 0,
      red: 0,
      green: 0,
      blue: 0,
    };
    bucket.count += 1;
    bucket.red += color[0];
    bucket.green += color[1];
    bucket.blue += color[2];
    buckets.set(key, bucket);
  }
  const winner = [...buckets.values()].sort(
    (first, second) => second.count - first.count,
  )[0];
  if (!winner) return [0, 0, 0];
  return [
    winner.red / winner.count,
    winner.green / winner.count,
    winner.blue / winner.count,
  ];
};

const markerFromPixel = (
  x: number,
  y: number,
  raster: InventoryCountRaster,
): InventoryCountMarker => ({
  x: Math.max(
    0,
    Math.min(
      inventoryCountCoordinateMaximum,
      Math.round(
        ((x + 0.5) / raster.width) * inventoryCountCoordinateMaximum,
      ),
    ),
  ),
  y: Math.max(
    0,
    Math.min(
      inventoryCountCoordinateMaximum,
      Math.round(
        ((y + 0.5) / raster.height) * inventoryCountCoordinateMaximum,
      ),
    ),
  ),
});

const stablePixelMarker = (
  detection: InventoryCountDetection,
  raster: InventoryCountRaster,
): InventoryCountMarker | null => {
  const anchorBox = toPixelBox(detection.anchorBox, raster);
  const anchorPixels = sampledPixels(raster, anchorBox);
  if (!anchorPixels.length) return null;

  const backgroundPixels = sampledPixels(
    raster,
    toPixelBox(detection.backgroundBox, raster),
  );
  const targetBox = toPixelBox(detection.box, raster);
  if (!backgroundPixels.length) return null;

  const anchorColor = medianColor(anchorPixels);
  const backgroundColor = medianColor(backgroundPixels);
  const anchorBackgroundDistance = colorDistance(anchorColor, backgroundColor);
  if (anchorBackgroundDistance < minimumOpeningColorDistance) return null;

  if (detection.visibleOpening) {
    const exteriorPixels = sampledExteriorPixels(raster, targetBox);
    if (!exteriorPixels.length) return null;
    const exteriorDominantColor = dominantColor(exteriorPixels);
    // The scene visible through a real opening should resemble the immediate
    // exterior more closely than the object's rim/strut. This catches swapped
    // material/hole boxes without trusting the model's semantic field names.
    const backgroundExteriorDistance = colorDistance(
      backgroundColor,
      exteriorDominantColor,
    );
    const anchorExteriorDistance = colorDistance(
      anchorColor,
      exteriorDominantColor,
    );
    if (backgroundExteriorDistance + 8 >= anchorExteriorDistance) return null;
  }

  const materialDistanceThreshold = Math.max(
    minimumOpeningColorDistance * 0.75,
    anchorBackgroundDistance * 0.45,
  );
  const materialPixels = anchorPixels.filter(
    (pixel) =>
      colorDistance(pixel.color, backgroundColor) >= materialDistanceThreshold,
  );
  if (
    materialPixels.length / anchorPixels.length <
    minimumOpeningMaterialPixelShare
  ) {
    return null;
  }

  // Pick the most background-dissimilar real JPEG pixel, with a small bias
  // toward the patch center. The emitted marker therefore cannot fall in the
  // opening even when the agreed anchor rectangle touches its edge.
  const centerX = (anchorBox.left + anchorBox.right - 1) / 2;
  const centerY = (anchorBox.top + anchorBox.bottom - 1) / 2;
  const anchorDiagonal = Math.max(
    1,
    Math.hypot(
      anchorBox.right - anchorBox.left,
      anchorBox.bottom - anchorBox.top,
    ),
  );
  const markerPixel = materialPixels.reduce((best, pixel) => {
    const score =
      colorDistance(pixel.color, backgroundColor) -
      (Math.hypot(pixel.x - centerX, pixel.y - centerY) / anchorDiagonal) * 8;
    const bestScore =
      colorDistance(best.color, backgroundColor) -
      (Math.hypot(best.x - centerX, best.y - centerY) / anchorDiagonal) * 8;
    return score > bestScore ? pixel : best;
  });
  return markerFromPixel(markerPixel.x, markerPixel.y, raster);
};

/**
 * Produces the externally visible result only from cross-pass consensus and
 * checks every anchor against an independently localized background reference
 * in the actual normalized JPEG pixels.
 */
export function createVerifiedInventoryCountResult(
  localizationInput: unknown,
  verificationInput: unknown,
  raster: InventoryCountRaster,
): InventoryCountResult {
  validateRaster(raster);
  const localization = inventoryCountLocalizationPassSchema.parse(
    localizationInput,
  );
  const verification = inventoryCountLocalizationPassSchema.parse(
    verificationInput,
  );
  const reconciled = reconcileInventoryCountLocalizationPasses(
    localization,
    verification,
  );
  const detections: InventoryCountDetection[] = [];
  const markers: InventoryCountMarker[] = [];
  let removedPixelUnverified = 0;

  for (const detection of reconciled.detections) {
    const marker = stablePixelMarker(detection, raster);
    if (!marker) {
      removedPixelUnverified += 1;
      continue;
    }
    detections.push(detection);
    markers.push(marker);
  }

  const removedAny =
    reconciled.removedUnconfirmed > 0 ||
    reconciled.removedDuplicates > 0 ||
    reconciled.removedLowConfidence > 0 ||
    removedPixelUnverified > 0;
  const warnings = [...verification.warnings];
  if (reconciled.removedUnconfirmed > 0) {
    warnings.push(
      "Some localizations were excluded because the two inspections did not independently agree.",
    );
  }
  if (
    reconciled.removedDuplicates > 0 ||
    reconciled.removedLowConfidence > 0
  ) {
    warnings.push(
      "Some uncertain or duplicate localizations were excluded during verification.",
    );
  }
  if (removedPixelUnverified > 0) {
    warnings.push(
      "Some markers were excluded because the material patch could not be separated from its background reference in the image pixels.",
    );
  }
  const minimumDetectionConfidence = detections.length
    ? Math.min(...detections.map((detection) => detection.confidence))
    : 1;

  return inventoryCountResultSchema.parse({
    count: detections.length,
    confidence: Math.min(
      localization.confidence,
      verification.confidence,
      minimumDetectionConfidence,
      removedAny ? 0.7 : 1,
    ),
    detectedItem: verification.detectedItem,
    isExact: localization.isExact && verification.isExact && !removedAny,
    explanation: verification.explanation,
    warnings: warnings.slice(0, 10),
    markers,
  });
}

export function createInventoryCountResult(
  localization: InventoryCountLocalizationPass,
  inputDetections: unknown = localization.detections,
): InventoryCountResult {
  const { detections, removedDuplicates, removedLowConfidence } =
    validateAndDedupeInventoryCountDetections(inputDetections);
  const warnings = [...localization.warnings];
  if (removedDuplicates > 0 || removedLowConfidence > 0) {
    warnings.push(
      "Some uncertain or duplicate localizations were excluded during verification.",
    );
  }
  const minimumDetectionConfidence = detections.length
    ? Math.min(...detections.map((detection) => detection.confidence))
    : 1;
  const removedAny = removedDuplicates > 0 || removedLowConfidence > 0;

  return inventoryCountResultSchema.parse({
    count: detections.length,
    confidence: Math.min(
      localization.confidence,
      minimumDetectionConfidence,
      removedAny ? 0.75 : 1,
    ),
    detectedItem: localization.detectedItem,
    isExact: localization.isExact && !removedAny,
    explanation: localization.explanation,
    warnings: warnings.slice(0, 10),
    markers: detections.map((detection) =>
      markerFromAnchorBox(detection.anchorBox),
    ),
  });
}
