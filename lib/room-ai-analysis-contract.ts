import { z } from "zod";

import { roomSurfaceCategorySchema } from "@/lib/room-scene-contract";

export const roomMaterialSchema = z.enum([
  "paint",
  "plaster",
  "concrete",
  "wood",
  "laminate",
  "carpet",
  "tile",
  "stone",
  "metal",
  "glass",
  "fabric",
  "plastic",
  "other",
]);

const colorHexSchema = z
  .string()
  .regex(/^#[0-9A-F]{6}$/, "Expected an uppercase six-digit sRGB color.");

export const roomSurfaceAppearanceSchema = z
  .object({
    surfaceCategory: roomSurfaceCategorySchema,
    colorHex: colorHexSchema,
    colorName: z.string().trim().min(1).max(80),
    material: roomMaterialSchema,
    roughness: z.number().finite().min(0).max(1),
    confidence: z.number().finite().min(0).max(1),
    evidenceKeyframeIds: z.array(z.uuid()).max(4),
  })
  .strict();

export const detectedRoomObjectSuggestionSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1_000),
    colorHex: colorHexSchema.nullable(),
    material: roomMaterialSchema,
    confidence: z.number().finite().min(0).max(1),
    evidence: z.string().trim().min(1).max(500),
    evidenceKeyframeIds: z.array(z.uuid()).min(1).max(4),
    roomPlanCategory: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export const roomAiDetectionSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_000),
    surfaceAppearances: z.array(roomSurfaceAppearanceSchema).max(5),
    objectSuggestions: z.array(detectedRoomObjectSuggestionSchema).max(24),
  })
  .strict();

export const roomObjectSuggestionStatusSchema = z.enum([
  "pending",
  "accepted",
  "dismissed",
]);

export const roomObjectSuggestionSchema = detectedRoomObjectSuggestionSchema
  .omit({ roomPlanCategory: true })
  .extend({
    id: z.uuid(),
    roomObjectId: z.uuid().nullable(),
    status: roomObjectSuggestionStatusSchema,
  })
  .strict();

export const roomAiAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    analyzedAt: z.iso.datetime({ offset: true }),
    model: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(1_000),
    analyzedKeyframeIds: z.array(z.uuid()).min(1).max(8),
    surfaceAppearances: z.array(roomSurfaceAppearanceSchema).max(5),
    objectSuggestions: z.array(roomObjectSuggestionSchema).max(24),
  })
  .strict();

export const roomObjectSuggestionPatchSchema = z
  .object({
    suggestionId: z.uuid(),
    status: roomObjectSuggestionStatusSchema,
  })
  .strict();

export type RoomMaterial = z.infer<typeof roomMaterialSchema>;
export type RoomSurfaceAppearance = z.infer<
  typeof roomSurfaceAppearanceSchema
>;
export type DetectedRoomObjectSuggestion = z.infer<
  typeof detectedRoomObjectSuggestionSchema
>;
export type RoomAiDetection = z.infer<typeof roomAiDetectionSchema>;
export type RoomObjectSuggestion = z.infer<
  typeof roomObjectSuggestionSchema
>;
export type RoomAiAnalysis = z.infer<typeof roomAiAnalysisSchema>;
export type RoomObjectSuggestionPatch = z.infer<
  typeof roomObjectSuggestionPatchSchema
>;
