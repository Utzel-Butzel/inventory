import { z } from "zod";

import { roomSurfaceCategorySchema } from "@/lib/room-scene-contract";

export const maximumRoomAnalysisKeyframes = 16;
export const maximumRoomObjectSuggestions = 48;

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

// OpenAI strict Structured Outputs cannot represent tuple-form JSON Schema
// items. Fixed-length homogeneous arrays preserve the vector contract while
// allowing zodTextFormat() to build the room-analysis response format.
const normalizedPositionSchema = z
  .array(z.number().finite().min(-0.75).max(0.75))
  .length(3);

const normalizedSizeSchema = z
  .array(z.number().finite().min(0.01).max(1.5))
  .length(3);

const rotationDegreesSchema = z
  .array(z.number().finite().min(-180).max(180))
  .length(3);

export const roomPrimitivePartSchema = z
  .object({
    primitive: z.enum(["box", "cylinder", "sphere"]),
    position: normalizedPositionSchema,
    size: normalizedSizeSchema,
    rotationDegrees: rotationDegreesSchema,
    colorHex: colorHexSchema.nullable(),
    material: roomMaterialSchema,
  })
  .strict();

export const roomPrimitiveModelSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    parts: z.array(roomPrimitivePartSchema).min(1).max(32),
  })
  .strict();

export const detectedRoomSurfaceAppearanceSchema = z
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

export const roomAiReviewStatusSchema = z.enum([
  "pending",
  "accepted",
  "dismissed",
]);

export const roomSurfaceAppearanceSchema = detectedRoomSurfaceAppearanceSchema
  .extend({
    id: z.uuid(),
    status: roomAiReviewStatusSchema,
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
    primitiveModel: roomPrimitiveModelSchema.nullable(),
  })
  .strict();

export const roomAiDetectionSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_000),
    surfaceAppearances: z.array(detectedRoomSurfaceAppearanceSchema).max(5),
    objectSuggestions: z
      .array(detectedRoomObjectSuggestionSchema)
      .max(maximumRoomObjectSuggestions),
  })
  .strict();

export const roomObjectSuggestionSchema = detectedRoomObjectSuggestionSchema
  .omit({ roomPlanCategory: true })
  .extend({
    id: z.uuid(),
    roomObjectId: z.uuid().nullable(),
    primitiveModel: roomPrimitiveModelSchema.nullable().default(null),
    status: roomAiReviewStatusSchema,
  })
  .strict();

export const roomAiAnalysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    analyzedAt: z.iso.datetime({ offset: true }),
    model: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(1_000),
    analyzedKeyframeIds: z
      .array(z.uuid())
      .min(1)
      .max(maximumRoomAnalysisKeyframes),
    surfaceAppearances: z.array(roomSurfaceAppearanceSchema).max(5),
    objectSuggestions: z
      .array(roomObjectSuggestionSchema)
      .max(maximumRoomObjectSuggestions),
  })
  .strict();

export const roomAiReviewPatchSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("surface"),
      id: z.uuid(),
      status: roomAiReviewStatusSchema,
    })
    .strict(),
  z
    .object({
      target: z.literal("object"),
      id: z.uuid(),
      status: roomAiReviewStatusSchema,
    })
    .strict(),
]);

export type RoomMaterial = z.infer<typeof roomMaterialSchema>;
export type RoomPrimitivePart = z.infer<typeof roomPrimitivePartSchema>;
export type RoomPrimitiveModel = z.infer<typeof roomPrimitiveModelSchema>;
export type DetectedRoomSurfaceAppearance = z.infer<
  typeof detectedRoomSurfaceAppearanceSchema
>;
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
export type RoomAiReviewStatus = z.infer<typeof roomAiReviewStatusSchema>;
export type RoomAiReviewPatch = z.infer<typeof roomAiReviewPatchSchema>;
