import { z } from "zod";

/**
 * Marker coordinates use an integer 0...1000 grid so clients can position
 * them independently of the displayed image size.
 */
export const inventoryCountCoordinateMaximum = 1_000;

export const inventoryCountMarkerSchema = z
  .object({
    x: z.number().int().min(0).max(inventoryCountCoordinateMaximum),
    y: z.number().int().min(0).max(inventoryCountCoordinateMaximum),
  })
  .strict();

export const inventoryCountResultSchema = z
  .object({
    count: z.number().int().min(0).max(1_000_000),
    confidence: z.number().min(0).max(1),
    detectedItem: z.string().trim().min(1).max(240),
    isExact: z.boolean(),
    explanation: z.string().trim().min(1).max(1_000),
    warnings: z.array(z.string().trim().min(1).max(240)).max(10),
    markers: z.array(inventoryCountMarkerSchema),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.markers.length !== result.count) {
      context.addIssue({
        code: "custom",
        path: ["markers"],
        message: "markers must contain exactly one point for every counted item",
      });
    }
  });

export type InventoryCountMarker = z.infer<typeof inventoryCountMarkerSchema>;
export type InventoryCountResult = z.infer<typeof inventoryCountResultSchema>;
