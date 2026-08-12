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
