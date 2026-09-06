import { roomMaterialSchema } from "@/lib/room-material-contract";
import { z } from "zod";
import { roomFurnitureVariantSchema } from "@/lib/room-furniture-catalog";

import {
  roomSurfaceCategorySchema,
  spatialVector3Schema,
} from "@/lib/room-scene-contract";

export const maximumRoomAnalysisKeyframes = 24;
export const maximumRoomObjectSuggestions = 48;
export const maximumRoomPhotoBatchSize = 8;

export { roomMaterialSchema } from "@/lib/room-material-contract";

export const roomWindowTypeSchema = z.enum([
  "fixed",
  "casement",
  "tilt-turn",
  "sliding",
  "sash",
  "other",
  "unknown",
]);

export const roomWindowDetailsSchema = z
  .object({
    type: roomWindowTypeSchema,
    hasMuntins: z.boolean().nullable(),
    paneColumns: z.number().int().min(1).max(8).nullable(),
    paneRows: z.number().int().min(1).max(8).nullable(),
    confidence: z.number().finite().min(0).max(1),
  })
  .strict();

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

const normalizedImageBoundsSchema = z
  .array(z.number().int().min(0).max(1_000))
  .length(4);

export const roomObjectImageEvidenceSchema = z
  .object({
    keyframeId: z.uuid(),
    bounds: normalizedImageBoundsSchema,
    visibility: z.enum(["clear", "partial", "occluded"]),
    confidence: z.number().finite().min(0).max(1),
  })
  .strict();

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

// Keep the persisted schema backward-compatible with early one-part recipes,
// but require new generations to contain enough structure to describe a
// recognizable object instead of a colored replacement cuboid.
export const detectedRoomPrimitiveModelSchema = roomPrimitiveModelSchema
  .extend({
    parts: z.array(roomPrimitivePartSchema).min(6).max(32),
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
    evidenceKeyframeIds: z.array(z.uuid()).min(1).max(4),
    windowDetails: roomWindowDetailsSchema.nullable(),
  })
  .strict();

export const roomAiReviewStatusSchema = z.enum([
  "pending",
  "accepted",
  "dismissed",
]);

export const roomEstimatedObjectPlacementSchema = z
  .object({
    position: spatialVector3Schema,
    rotationYDegrees: z.number().finite().min(-180).max(180),
    dimensions: z.tuple([
      z.number().finite().min(0.02).max(5),
      z.number().finite().min(0.02).max(5),
      z.number().finite().min(0.02).max(5),
    ]),
  })
  .strict();

export const roomSurfaceAppearanceSchema = detectedRoomSurfaceAppearanceSchema
  .omit({ evidenceKeyframeIds: true })
  .extend({
    id: z.uuid(),
    status: roomAiReviewStatusSchema,
    // Early analyses could contain an empty evidence list. Keep them
    // reviewable while requiring evidence for every new model response.
    evidenceKeyframeIds: z.array(z.uuid()).max(4).default([]),
    windowDetails: roomWindowDetailsSchema.nullable().default(null),
  })
  .strict();

const detectedRoomObjectCoreSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1_000),
    colorHex: colorHexSchema.nullable(),
    material: roomMaterialSchema,
    confidence: z.number().finite().min(0).max(1),
    evidence: z.string().trim().min(1).max(500),
    evidenceKeyframeIds: z.array(z.uuid()).min(1).max(4),
    imageEvidence: z.array(roomObjectImageEvidenceSchema).min(1).max(4),
    roomPlanCategory: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export const detectedRoomObjectObservationSchema = detectedRoomObjectCoreSchema;

export const detectedRoomObjectSuggestionSchema = detectedRoomObjectCoreSchema
  .extend({
    roomPlanObjectId: z.uuid().nullable(),
    modelVariant: roomFurnitureVariantSchema.nullable().default(null),
    primitiveModel: detectedRoomPrimitiveModelSchema.nullable(),
  })
  .strict();

export const roomPhotoDetectionSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_000),
    surfaceAppearances: z.array(detectedRoomSurfaceAppearanceSchema).max(5),
    objectSuggestions: z
      .array(detectedRoomObjectObservationSchema)
      .max(maximumRoomObjectSuggestions),
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

// All generated fields are required in strict Structured Outputs; persisted older analyses may omit the model.
export const roomAiGenerationSchema = roomAiDetectionSchema.extend({
  objectSuggestions: z.array(detectedRoomObjectSuggestionSchema.extend({ modelVariant: roomFurnitureVariantSchema.nullable() })).max(maximumRoomObjectSuggestions),
}).strict();

export const roomObjectSuggestionSchema = detectedRoomObjectSuggestionSchema
  .omit({ roomPlanCategory: true, roomPlanObjectId: true })
  .extend({
    id: z.uuid(),
    roomObjectId: z.uuid().nullable(),
    imageEvidence: z.array(roomObjectImageEvidenceSchema).max(4).default([]),
    primitiveModel: roomPrimitiveModelSchema.nullable().default(null),
    estimatedPlacement: roomEstimatedObjectPlacementSchema.nullable().default(null),
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
  z
    .object({
      target: z.literal("object-placement"),
      id: z.uuid(),
      position: spatialVector3Schema,
      rotationYDegrees: z.number().finite().min(-180).max(180),
    })
    .strict(),
]);

export type RoomMaterial = z.infer<typeof roomMaterialSchema>;
export type RoomWindowType = z.infer<typeof roomWindowTypeSchema>;
export type RoomWindowDetails = z.infer<typeof roomWindowDetailsSchema>;
export type RoomObjectImageEvidence = z.infer<
  typeof roomObjectImageEvidenceSchema
>;
export type RoomPrimitivePart = z.infer<typeof roomPrimitivePartSchema>;
export type RoomPrimitiveModel = z.infer<typeof roomPrimitiveModelSchema>;
export type RoomEstimatedObjectPlacement = z.infer<
  typeof roomEstimatedObjectPlacementSchema
>;
export type DetectedRoomSurfaceAppearance = z.infer<
  typeof detectedRoomSurfaceAppearanceSchema
>;
export type RoomSurfaceAppearance = z.infer<
  typeof roomSurfaceAppearanceSchema
>;
export type DetectedRoomObjectSuggestion = z.infer<
  typeof detectedRoomObjectSuggestionSchema
>;
export type RoomPhotoDetection = z.infer<typeof roomPhotoDetectionSchema>;
export type RoomAiDetection = z.infer<typeof roomAiDetectionSchema>;
export type RoomObjectSuggestion = z.infer<
  typeof roomObjectSuggestionSchema
>;
export type RoomAiAnalysis = z.infer<typeof roomAiAnalysisSchema>;
export type RoomAiReviewStatus = z.infer<typeof roomAiReviewStatusSchema>;
export type RoomAiReviewPatch = z.infer<typeof roomAiReviewPatchSchema>;
