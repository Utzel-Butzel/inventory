import { z } from "zod";

import {
  inventoryCountCoordinateMaximum,
  inventoryCountResultSchema,
  type InventoryCountResult,
} from "@/lib/inventory-count-contract";

const normalizedBoxSchema = z
  .tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ])
  .readonly();

export const replicateSam3OutputSchema = z
  .object({
    orig_img_h: z.number().int().positive(),
    orig_img_w: z.number().int().positive(),
    pred_boxes: z.array(normalizedBoxSchema),
    pred_scores: z.array(z.number().finite()),
  })
  .passthrough();

export type ReplicateSam3Output = z.infer<typeof replicateSam3OutputSchema>;

const groundingDinoDetectionSchema = z
  .object({
    bbox: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
    label: z.string().trim().min(1).max(240),
    confidence: z.number().finite(),
  })
  .passthrough();

export const replicateGroundingDinoOutputSchema = z
  .object({
    detections: z.array(groundingDinoDetectionSchema),
  })
  .passthrough();

const yoloWorldDetectionSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    confidence: z.number().finite(),
    box: z
      .object({
        x1: z.number().finite(),
        y1: z.number().finite(),
        x2: z.number().finite(),
        y2: z.number().finite(),
      })
      .strict(),
  })
  .passthrough();

export const replicateYoloWorldOutputSchema = z
  .object({
    json_str: z.string().min(1),
  })
  .passthrough();

export const replicateSam2OutputSchema = z
  .object({
    individual_masks: z.array(z.string().url()).max(500),
  })
  .passthrough();

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function normalizeReplicateCountPrompt(itemHint?: string) {
  const normalized = itemHint
    ?.trim()
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || "physical parts";
}

export function createInventoryCountResultFromSam3(options: {
  output: unknown;
  itemHint?: string;
  prompt: string;
  maxMasks: number;
  language: string;
}): InventoryCountResult {
  const output = replicateSam3OutputSchema.parse(options.output);
  if (output.pred_boxes.length !== output.pred_scores.length) {
    throw new Error("SAM 3 returned mismatched boxes and confidence scores.");
  }

  const markers = output.pred_boxes.map(([left, top, width, height]) => {
    // The Replicate wrapper returns normalized [left, top, width, height]
    // boxes. Allow tiny floating-point overshoots, but reject malformed boxes.
    if (
      left < -0.02 ||
      top < -0.02 ||
      width <= 0 ||
      height <= 0 ||
      left > 1.02 ||
      top > 1.02 ||
      width > 1.02 ||
      height > 1.02 ||
      left + width > 1.02 ||
      top + height > 1.02
    ) {
      throw new Error("SAM 3 returned an invalid normalized bounding box.");
    }
    return {
      x: Math.round(
        clamp(left + width / 2, 0, 1) * inventoryCountCoordinateMaximum,
      ),
      y: Math.round(
        clamp(top + height / 2, 0, 1) * inventoryCountCoordinateMaximum,
      ),
    };
  });

  const count = markers.length;
  const confidence = count
    ? output.pred_scores.reduce((sum, score) => sum + clamp(score, 0, 1), 0) /
      count
    : 0;
  const isGerman = /^(de|german|deutsch)(?:\b|[-_])/iu.test(
    options.language.trim(),
  );
  const warnings: string[] = [];
  if (count >= options.maxMasks) {
    warnings.push(
      isGerman
        ? `Das Modelllimit von ${options.maxMasks} Treffern wurde erreicht; im Foto könnten weitere Teile liegen.`
        : `The model limit of ${options.maxMasks} detections was reached; the photo may contain more pieces.`,
    );
  }
  if (count > 0 && confidence < 0.65) {
    warnings.push(
      isGerman
        ? "Einige Treffer haben eine niedrige Modellkonfidenz und sollten geprüft werden."
        : "Some detections have low model confidence and should be checked.",
    );
  }

  const detectedItem =
    options.itemHint?.trim().slice(0, 240) || options.prompt.slice(0, 240);
  return inventoryCountResultSchema.parse({
    count,
    confidence,
    detectedItem,
    // A single zero-shot pass cannot prove that occluded or tiny pieces were
    // found exhaustively. The clients already let users correct the quantity.
    isExact: false,
    explanation: isGerman
      ? count
        ? `SAM 3 hat ${count} sichtbare passende Teile segmentiert.`
        : "SAM 3 hat keine sichtbaren passenden Teile segmentiert."
      : count
        ? `SAM 3 segmented ${count} visible matching pieces.`
        : "SAM 3 did not segment any visible matching pieces.",
    warnings,
    markers,
  });
}

export function createInventoryCountResultFromGroundingDino(options: {
  output: unknown;
  itemHint?: string;
  prompt: string;
  imageWidth: number;
  imageHeight: number;
  language: string;
}): InventoryCountResult {
  const output = replicateGroundingDinoOutputSchema.parse(options.output);
  if (
    !Number.isInteger(options.imageWidth) ||
    !Number.isInteger(options.imageHeight) ||
    options.imageWidth <= 0 ||
    options.imageHeight <= 0
  ) {
    throw new Error("Grounding DINO requires valid input image dimensions.");
  }

  const markers = output.detections.map(({ bbox }) => {
    const [left, top, right, bottom] = bbox;
    if (
      left < -2 ||
      top < -2 ||
      right <= left ||
      bottom <= top ||
      right > options.imageWidth + 2 ||
      bottom > options.imageHeight + 2
    ) {
      throw new Error("Grounding DINO returned an invalid pixel bounding box.");
    }
    return {
      x: Math.round(
        clamp((left + right) / 2 / options.imageWidth, 0, 1) *
          inventoryCountCoordinateMaximum,
      ),
      y: Math.round(
        clamp((top + bottom) / 2 / options.imageHeight, 0, 1) *
          inventoryCountCoordinateMaximum,
      ),
    };
  });

  const count = markers.length;
  const confidence = count
    ? output.detections.reduce(
        (sum, detection) => sum + clamp(detection.confidence, 0, 1),
        0,
      ) / count
    : 0;
  const isGerman = /^(de|german|deutsch)(?:\b|[-_])/iu.test(
    options.language.trim(),
  );
  const warnings: string[] = [];
  if (count > 0 && confidence < 0.65) {
    warnings.push(
      isGerman
        ? "Einige Treffer haben eine niedrige Modellkonfidenz und sollten geprüft werden."
        : "Some detections have low model confidence and should be checked.",
    );
  }

  const detectedItem =
    options.itemHint?.trim().slice(0, 240) ||
    output.detections[0]?.label ||
    options.prompt.slice(0, 240);
  return inventoryCountResultSchema.parse({
    count,
    confidence,
    detectedItem,
    isExact: false,
    explanation: isGerman
      ? count
        ? `Grounding DINO hat ${count} sichtbare passende Teile erkannt.`
        : "Grounding DINO hat keine sichtbaren passenden Teile erkannt."
      : count
        ? `Grounding DINO detected ${count} visible matching pieces.`
        : "Grounding DINO did not detect any visible matching pieces.",
    warnings,
    markers,
  });
}

export function createInventoryCountResultFromYoloWorld(options: {
  output: unknown;
  itemHint?: string;
  prompt: string;
  imageWidth: number;
  imageHeight: number;
  language: string;
}): InventoryCountResult {
  const output = replicateYoloWorldOutputSchema.parse(options.output);
  const detections = z
    .array(yoloWorldDetectionSchema)
    .parse(JSON.parse(output.json_str));
  const result = createInventoryCountResultFromGroundingDino({
    output: {
      detections: detections.map((detection) => ({
        bbox: [
          detection.box.x1,
          detection.box.y1,
          detection.box.x2,
          detection.box.y2,
        ],
        label: detection.name,
        confidence: detection.confidence,
      })),
    },
    itemHint: options.itemHint,
    prompt: options.prompt,
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
    language: options.language,
  });
  const isGerman = /^(de|german|deutsch)(?:\b|[-_])/iu.test(
    options.language.trim(),
  );
  return inventoryCountResultSchema.parse({
    ...result,
    explanation: isGerman
      ? result.count
        ? `YOLO World hat ${result.count} sichtbare passende Teile erkannt.`
        : "YOLO World hat keine sichtbaren passenden Teile erkannt."
      : result.count
        ? `YOLO World detected ${result.count} visible matching pieces.`
        : "YOLO World did not detect any visible matching pieces.",
  });
}

export function createInventoryCountResultFromSam2(options: {
  centroids: ReadonlyArray<{ x: number; y: number }>;
  itemHint?: string;
  prompt: string;
  language: string;
}): InventoryCountResult {
  const isGerman = /^(de|german|deutsch)(?:\b|[-_])/iu.test(
    options.language.trim(),
  );
  const markers = options.centroids.map(({ x, y }) => ({
    x: Math.round(clamp(x, 0, 1) * inventoryCountCoordinateMaximum),
    y: Math.round(clamp(y, 0, 1) * inventoryCountCoordinateMaximum),
  }));
  const count = markers.length;
  return inventoryCountResultSchema.parse({
    count,
    confidence: count ? 0.5 : 0,
    detectedItem:
      options.itemHint?.trim().slice(0, 240) || options.prompt.slice(0, 240),
    isExact: false,
    explanation: isGerman
      ? `SAM 2 hat ${count} eigenständige sichtbare Masken erzeugt.`
      : `SAM 2 generated ${count} distinct visible masks.`,
    warnings: [
      isGerman
        ? "SAM 2 wertet den Artikeltext nicht aus und kann Hintergrundobjekte oder Teilflächen mitzählen."
        : "SAM 2 does not use the item text and may count background objects or object parts.",
    ],
    markers,
  });
}
