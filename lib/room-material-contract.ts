import { z } from "zod";

/** Shared by manual finishes and AI suggestions; independent of the scene schema. */
export const roomMaterialSchema = z.enum([
  "paint", "plaster", "concrete", "wood", "laminate", "carpet", "tile",
  "stone", "metal", "glass", "fabric", "plastic", "other",
]);
export const roomSurfaceFinishSchema = z.object({
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  material: roomMaterialSchema,
  roughness: z.number().finite().min(0).max(1),
}).strict();
