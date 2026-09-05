import { z } from "zod";

export const roomFurnitureVariantSchema = z.enum([
  "wardrobe",
  "bookcase",
  "shelving",
  "sideboard",
  "drawers",
  "table",
  "chair",
  "sofa",
  "bed",
]);
export type RoomFurnitureVariant = z.infer<typeof roomFurnitureVariantSchema>;
export const roomFurnitureVariants = roomFurnitureVariantSchema.options;

export const roomObjectAppearanceSchema = z
  .object({
    variant: roomFurnitureVariantSchema.nullable().default(null),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .default(null),
  })
  .strict();
