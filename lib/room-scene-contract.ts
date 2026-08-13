import { z } from "zod";

const finiteCoordinate = z.number().finite().min(-10_000).max(10_000);
const dimension = z.number().finite().min(0).max(100);

export const spatialVector3Schema = z.tuple([
  finiteCoordinate,
  finiteCoordinate,
  finiteCoordinate,
]);

export const spatialQuaternionSchema = z
  .tuple([
    z.number().finite().min(-1).max(1),
    z.number().finite().min(-1).max(1),
    z.number().finite().min(-1).max(1),
    z.number().finite().min(-1).max(1),
  ])
  .refine(
    ([x, y, zValue, w]) => {
      const squaredLength = x * x + y * y + zValue * zValue + w * w;
      return Math.abs(squaredLength - 1) < 0.1;
    },
    "Quaternion must be normalized.",
  );

export const spatialMatrix4Schema = z
  .array(finiteCoordinate)
  .length(16)
  .refine(
    (matrix) =>
      Math.abs(matrix[3] ?? 1) <= 0.001 &&
      Math.abs(matrix[7] ?? 1) <= 0.001 &&
      Math.abs(matrix[11] ?? 1) <= 0.001 &&
      Math.abs((matrix[15] ?? 0) - 1) <= 0.001,
    "Expected a column-major affine 4x4 transform.",
  );

const dimensionsSchema = z.tuple([dimension, dimension, dimension]);

const roomSurfacePolygonSchema = z.preprocess(
  (value) => (Array.isArray(value) && value.length === 0 ? undefined : value),
  z.array(spatialVector3Schema).min(3).max(1_024).optional(),
);

export const roomSurfaceCategorySchema = z.enum([
  "wall",
  "floor",
  "door",
  "window",
  "opening",
]);

export const roomSurfaceSchema = z.object({
  id: z.uuid(),
  category: roomSurfaceCategorySchema,
  dimensions: dimensionsSchema,
  transform: spatialMatrix4Schema,
  // RoomPlan can return an empty array when it has no non-rectangular outline.
  // Treat that the same as an omitted optional polygon so older app builds can
  // still upload the surface's measured dimensions and transform.
  polygonCorners: roomSurfacePolygonSchema,
  confidence: z.enum(["low", "medium", "high"]),
});

export const spatialMatricesApproximatelyEqual = (
  left: readonly number[],
  right: readonly number[],
  epsilon = 1e-6,
) =>
  left.length === 16 &&
  right.length === 16 &&
  left.every(
    (value, index) =>
      Number.isFinite(value) &&
      Number.isFinite(right[index]) &&
      Math.abs(value - right[index]!) <= epsilon,
  );

export const roomObjectSchema = z.object({
  id: z.uuid(),
  category: z.string().trim().min(1).max(80),
  dimensions: dimensionsSchema,
  transform: spatialMatrix4Schema,
  confidence: z.enum(["low", "medium", "high"]),
});

export const roomSceneSchema = z
  .object({
    schemaVersion: z.literal(1),
    coordinateSystem: z.literal("arkit-right-handed-y-up"),
    units: z.literal("meter"),
    matrixOrder: z.literal("column-major"),
    worldFromModel: spatialMatrix4Schema,
    webFromWorld: spatialMatrix4Schema,
    bounds: z.object({
      min: spatialVector3Schema,
      max: spatialVector3Schema,
    }),
    surfaces: z.array(roomSurfaceSchema).max(4_096),
    objects: z.array(roomObjectSchema).max(2_048),
  })
  .refine(
    ({ bounds }) => bounds.min.every((value, index) => value <= bounds.max[index]!),
    { message: "Scene bounds are inverted.", path: ["bounds"] },
  );

export const photoLocalizationEvidenceSchema = z
  .object({
    matchedKeyframeId: z.uuid(),
    distance: z.number().finite().min(0).max(1_000_000),
    confidence: z.number().finite().min(0).max(1),
    cameraPositionError: z.number().finite().min(0).max(100).optional(),
  })
  .strict();

export const spatialPlacementInputSchema = z
  .object({
    position: spatialVector3Schema,
    orientation: spatialQuaternionSchema,
    extent: dimensionsSchema.optional(),
    confidence: z.number().finite().min(0).max(1),
    method: z.enum(["scene-depth", "mesh-raycast", "plane-raycast", "manual"]),
    anchorIdentifier: z.uuid().optional(),
    capturedAt: z.iso.datetime({ offset: true }),
    localizationEvidence: photoLocalizationEvidenceSchema.optional(),
  })
  .strict();

export const roomLayoutTransformPatchSchema = z
  .object({
    transform: spatialMatrix4Schema.nullable(),
  })
  .strict();

export type SpatialVector3 = z.infer<typeof spatialVector3Schema>;
export type SpatialQuaternion = z.infer<typeof spatialQuaternionSchema>;
export type SpatialMatrix4 = z.infer<typeof spatialMatrix4Schema>;
export type RoomSurface = z.infer<typeof roomSurfaceSchema>;
export type RoomObject = z.infer<typeof roomObjectSchema>;
export type RoomScene = z.infer<typeof roomSceneSchema>;
export type SpatialPlacementInput = z.infer<typeof spatialPlacementInputSchema>;
export type RoomLayoutTransformPatch = z.infer<
  typeof roomLayoutTransformPatchSchema
>;
export type PhotoLocalizationEvidence = z.infer<
  typeof photoLocalizationEvidenceSchema
>;

export const identitySpatialMatrix: SpatialMatrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
