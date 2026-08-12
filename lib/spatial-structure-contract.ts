import { z } from "zod";

const localCoordinate = z.number().finite().min(-10_000).max(10_000);

export const localReferencePositionSchema = z.tuple([
  localCoordinate,
  localCoordinate,
  localCoordinate,
]);

export const spatialGeoreferenceSourceSchema = z.enum([
  "gps",
  "manual",
  "qr-marker",
  "app-clip",
  "other",
]);

export const spatialReferencePointSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120).optional(),
    localPosition: localReferencePositionSchema,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    altitude: z.number().finite().min(-12_000).max(100_000).optional(),
  })
  .strict();

/**
 * Georeferences one ARKit coordinate space. `headingDegrees` is the bearing of
 * AR local -Z, measured clockwise from true north. The geographic coordinate
 * belongs to `localReferencePosition`, which defaults to the AR origin.
 */
export const spatialGeoreferenceSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    altitude: z.number().finite().min(-12_000).max(100_000).optional(),
    headingDegrees: z.number().finite().min(0).lt(360),
    horizontalAccuracy: z.number().finite().min(0).max(100_000).optional(),
    verticalAccuracy: z.number().finite().min(0).max(100_000).optional(),
    capturedAt: z.iso.datetime({ offset: true }),
    source: spatialGeoreferenceSourceSchema,
    localReferencePosition: localReferencePositionSchema
      .optional()
      .default([0, 0, 0]),
    referencePoints: z.array(spatialReferencePointSchema).max(64).optional(),
    entryMarkerCode: z.string().trim().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.referencePoints?.map((point) => point.id) ?? [];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["referencePoints"],
        message: "Reference point identifiers must be unique.",
      });
    }
  });

const structureNameSchema = z.string().trim().min(1).max(240);
const structureDescriptionSchema = z.string().trim().max(10_000);

export const spatialStructureCreateSchema = z
  .object({
    id: z.uuid().optional(),
    name: structureNameSchema,
    description: structureDescriptionSchema.optional().default(""),
    georeference: spatialGeoreferenceSchema.nullable().optional().default(null),
  })
  .strict();

export const spatialStructurePatchSchema = z
  .object({
    name: structureNameSchema.optional(),
    description: structureDescriptionSchema.optional(),
    georeference: spatialGeoreferenceSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one structure change.",
  });

export const roomScanSpatialMetadataSchema = z
  .object({
    structureId: z.uuid().optional(),
    structureName: structureNameSchema.optional(),
    coordinateSpaceId: z.uuid().optional(),
    floorIdentifier: z.string().trim().min(1).max(120).optional(),
    floorIndex: z.number().int().min(-1_000).max(10_000).optional(),
    roomIdentifier: z.string().trim().min(1).max(120).optional(),
    georeference: spatialGeoreferenceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const groupedMetadataPresent =
      value.structureName !== undefined ||
      value.coordinateSpaceId !== undefined ||
      value.floorIdentifier !== undefined ||
      value.floorIndex !== undefined ||
      value.roomIdentifier !== undefined ||
      value.georeference !== undefined;
    if (groupedMetadataPresent && value.structureId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["structureId"],
        message: "A structureId is required when spatial grouping metadata is provided.",
      });
    }
  });

export type LocalReferencePosition = z.infer<
  typeof localReferencePositionSchema
>;
export type SpatialReferencePoint = z.infer<typeof spatialReferencePointSchema>;
export type SpatialGeoreference = z.infer<typeof spatialGeoreferenceSchema>;
export type RoomScanSpatialMetadata = z.infer<
  typeof roomScanSpatialMetadataSchema
>;
export type SpatialStructureCreate = z.infer<
  typeof spatialStructureCreateSchema
>;
export type SpatialStructurePatch = z.infer<typeof spatialStructurePatchSchema>;

/**
 * Tolerances for deciding whether two uploads describe the same geographic
 * transform for one ARKit coordinate space. They are intentionally much
 * smaller than normal indoor GPS/compass measurement error while still
 * allowing harmless serialization drift and equivalent reference positions.
 */
export const spatialGeoreferenceFrameTolerance = {
  horizontalMeters: 0.02,
  verticalMeters: 0.01,
  headingDegrees: 0.01,
} as const;

const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const RADIANS_PER_DEGREE = Math.PI / 180;

const approximatelyEqual = (left: number, right: number, tolerance: number) =>
  Math.abs(left - right) <= tolerance;

const optionalApproximatelyEqual = (
  left: number | undefined,
  right: number | undefined,
  tolerance: number,
) =>
  left === undefined || right === undefined
    ? left === right
    : approximatelyEqual(left, right, tolerance);

const headingDistance = (left: number, right: number) => {
  const difference = Math.abs(left - right) % 360;
  return Math.min(difference, 360 - difference);
};

const canonicalArkitOrigin = (anchor: SpatialGeoreference) => {
  const [referenceX, referenceY, referenceZ] =
    anchor.localReferencePosition ?? [0, 0, 0];
  const heading = anchor.headingDegrees * RADIANS_PER_DEGREE;
  const east = -referenceX * Math.cos(heading) + referenceZ * Math.sin(heading);
  const north = referenceX * Math.sin(heading) + referenceZ * Math.cos(heading);
  const longitudeScale = Math.max(
    Math.abs(Math.cos(anchor.latitude * RADIANS_PER_DEGREE)),
    1e-8,
  );
  return {
    latitude:
      anchor.latitude +
      (north / EARTH_RADIUS_METERS) * DEGREES_PER_RADIAN,
    longitude:
      anchor.longitude +
      (east / (EARTH_RADIUS_METERS * longitudeScale)) * DEGREES_PER_RADIAN,
    altitude:
      anchor.altitude === undefined ? undefined : anchor.altitude - referenceY,
  };
};

const horizontalDistanceMeters = (
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) => {
  const latitudeDifference =
    (right.latitude - left.latitude) * RADIANS_PER_DEGREE;
  const rawLongitudeDifference =
    (right.longitude - left.longitude) * RADIANS_PER_DEGREE;
  const longitudeDifference = Math.atan2(
    Math.sin(rawLongitudeDifference),
    Math.cos(rawLongitudeDifference),
  );
  const leftLatitude = left.latitude * RADIANS_PER_DEGREE;
  const rightLatitude = right.latitude * RADIANS_PER_DEGREE;
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.asin(Math.min(1, Math.sqrt(haversine)))
  );
};

/**
 * Compares the fields that define the local-ARKit-to-geographic transform.
 * Provenance such as accuracy, capture time, source, marker labels, and extra
 * reference points does not change that transform; the first upload remains
 * the canonical metadata stored for the coordinate space.
 */
export const spatialGeoreferenceFramesApproximatelyEqual = (
  left: SpatialGeoreference,
  right: SpatialGeoreference,
) => {
  const leftOrigin = canonicalArkitOrigin(left);
  const rightOrigin = canonicalArkitOrigin(right);
  return (
    horizontalDistanceMeters(leftOrigin, rightOrigin) <=
      spatialGeoreferenceFrameTolerance.horizontalMeters &&
    optionalApproximatelyEqual(
      leftOrigin.altitude,
      rightOrigin.altitude,
      spatialGeoreferenceFrameTolerance.verticalMeters,
    ) &&
    headingDistance(left.headingDegrees, right.headingDegrees) <=
      spatialGeoreferenceFrameTolerance.headingDegrees
  );
};

export type SpatialBounds = {
  min: [number, number, number];
  max: [number, number, number];
};

export const mergeSpatialBounds = (
  bounds: Array<SpatialBounds | null | undefined>,
): SpatialBounds | null => {
  const present = bounds.filter((item): item is SpatialBounds => item !== null && item !== undefined);
  if (!present.length) return null;
  return {
    min: [
      Math.min(...present.map((item) => item.min[0])),
      Math.min(...present.map((item) => item.min[1])),
      Math.min(...present.map((item) => item.min[2])),
    ],
    max: [
      Math.max(...present.map((item) => item.max[0])),
      Math.max(...present.map((item) => item.max[1])),
      Math.max(...present.map((item) => item.max[2])),
    ],
  };
};

/** Transforms every corner of a model-space AABB into a world-space AABB. */
export const transformSpatialBounds = (
  bounds: SpatialBounds,
  columnMajorMatrix: readonly number[],
): SpatialBounds | null => {
  if (
    columnMajorMatrix.length !== 16 ||
    !columnMajorMatrix.every(Number.isFinite)
  ) {
    return null;
  }
  const transformed = [bounds.min[0], bounds.max[0]].flatMap((x) =>
    [bounds.min[1], bounds.max[1]].flatMap((y) =>
      [bounds.min[2], bounds.max[2]].map((z) => {
        const point = [x, y, z, 1] as const;
        const result = [0, 1, 2, 3].map((row) =>
          point.reduce(
            (value, coordinate, column) =>
              value + columnMajorMatrix[column * 4 + row]! * coordinate,
            0,
          ),
        );
        const divisor = Math.abs(result[3]!) > 1e-12 ? result[3]! : 1;
        return [
          result[0]! / divisor,
          result[1]! / divisor,
          result[2]! / divisor,
        ] as [number, number, number];
      }),
    ),
  );
  if (!transformed.flat().every(Number.isFinite)) return null;
  return mergeSpatialBounds(
    transformed.map((point) => ({ min: point, max: point })),
  );
};

/**
 * Local bounds may only be merged when every frame explicitly names the same
 * ARKit coordinate space. Null/legacy ids are deliberately never assumed to
 * be compatible.
 */
export const sharedCoordinateSpaceBounds = (
  frames: Array<{
    coordinateSpaceId: string | null;
    bounds: SpatialBounds;
  }>,
): { coordinateSpaceId: string; bounds: SpatialBounds } | null => {
  if (!frames.length || frames.some((frame) => frame.coordinateSpaceId === null)) {
    return null;
  }
  const coordinateSpaceIds = new Set(
    frames.map((frame) => frame.coordinateSpaceId as string),
  );
  if (coordinateSpaceIds.size !== 1) return null;
  return {
    coordinateSpaceId: frames[0]!.coordinateSpaceId as string,
    bounds: mergeSpatialBounds(frames.map((frame) => frame.bounds))!,
  };
};
