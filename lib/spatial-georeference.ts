import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

import type { RoomScene, SpatialMatrix4, SpatialVector3 } from "./room-scene-contract";
import type { SpatialGeoreference } from "./spatial-structure-contract";

export type { SpatialGeoreference } from "./spatial-structure-contract";

const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const RADIANS_PER_DEGREE = Math.PI / 180;
const MINIMUM_LONGITUDE_SCALE = 1e-8;

/**
 * Geographic anchor for an ARKit world coordinate system.
 *
 * `headingDegrees` is the clockwise bearing from true north of ARKit's local
 * forward axis (`-Z`). Consequently `+X` points to the user's right and `+Y`
 * points up. A heading of zero maps `+X` east and `-Z` north.
 */
export type GeographicCoordinate = {
  latitude: number;
  longitude: number;
  altitude?: number;
};

export type LocalArkitOffset = {
  east: number;
  north: number;
  up: number;
};

export type LocalFloorPoint = readonly [x: number, z: number];

export type SpatialFootprintProperties = {
  structureId: string;
  structureName: string;
  scanId?: string;
  roomName?: string;
  floorIdentifier?: string;
  floorIndex?: number;
};

export function isSpatialGeoreference(value: unknown): value is SpatialGeoreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpatialGeoreference>;
  return (
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude) &&
    Number.isFinite(candidate.headingDegrees) &&
    Math.abs(candidate.latitude!) <= 90 &&
    Math.abs(candidate.longitude!) <= 180
  );
}

export function normalizeHeadingDegrees(headingDegrees: number) {
  return ((headingDegrees % 360) + 360) % 360;
}

export function localArkitOffsetMeters(
  coordinate: readonly [x: number, y: number, z: number],
  headingDegrees: number,
  localReferencePosition: readonly [x: number, y: number, z: number] = [0, 0, 0],
): LocalArkitOffset {
  const heading = normalizeHeadingDegrees(headingDegrees) * RADIANS_PER_DEGREE;
  const [x, y, z] = coordinate;
  const [anchorX, anchorY, anchorZ] = localReferencePosition;
  const dx = x - anchorX;
  const dy = y - anchorY;
  const dz = z - anchorZ;
  const forward = -dz;
  return {
    east: dx * Math.cos(heading) + forward * Math.sin(heading),
    north: -dx * Math.sin(heading) + forward * Math.cos(heading),
    up: dy,
  };
}

/** Converts a short indoor ARKit offset into a WGS84 coordinate. */
export function localArkitToGeographic(
  coordinate: readonly [x: number, y: number, z: number],
  anchor: SpatialGeoreference,
): GeographicCoordinate {
  const offset = localArkitOffsetMeters(
    coordinate,
    anchor.headingDegrees,
    anchor.localReferencePosition ?? [0, 0, 0],
  );
  const anchorLatitudeRadians = anchor.latitude * RADIANS_PER_DEGREE;
  const longitudeScale = Math.max(
    Math.abs(Math.cos(anchorLatitudeRadians)),
    MINIMUM_LONGITUDE_SCALE,
  );
  const latitude =
    anchor.latitude +
    (offset.north / EARTH_RADIUS_METERS) * DEGREES_PER_RADIAN;
  const longitude =
    anchor.longitude +
    (offset.east / (EARTH_RADIUS_METERS * longitudeScale)) * DEGREES_PER_RADIAN;
  const altitude = Number.isFinite(anchor.altitude)
    ? Number(anchor.altitude) + offset.up
    : undefined;
  return { latitude, longitude, ...(altitude === undefined ? {} : { altitude }) };
}

/** Inverse of `localArkitToGeographic` for nearby points. */
export function geographicToLocalArkit(
  coordinate: GeographicCoordinate,
  anchor: SpatialGeoreference,
): SpatialVector3 {
  const anchorLatitudeRadians = anchor.latitude * RADIANS_PER_DEGREE;
  const longitudeScale = Math.max(
    Math.abs(Math.cos(anchorLatitudeRadians)),
    MINIMUM_LONGITUDE_SCALE,
  );
  const east =
    (coordinate.longitude - anchor.longitude) *
    RADIANS_PER_DEGREE *
    EARTH_RADIUS_METERS *
    longitudeScale;
  const north =
    (coordinate.latitude - anchor.latitude) *
    RADIANS_PER_DEGREE *
    EARTH_RADIUS_METERS;
  const heading = normalizeHeadingDegrees(anchor.headingDegrees) * RADIANS_PER_DEGREE;
  const x = east * Math.cos(heading) - north * Math.sin(heading);
  const forward = east * Math.sin(heading) + north * Math.cos(heading);
  const y =
    coordinate.altitude !== undefined && Number.isFinite(anchor.altitude)
      ? coordinate.altitude - Number(anchor.altitude)
      : 0;
  const [anchorX, anchorY, anchorZ] = anchor.localReferencePosition ?? [0, 0, 0];
  return [x + anchorX, y + anchorY, -forward + anchorZ];
}

export function transformSpatialPoint(
  matrix: SpatialMatrix4 | readonly number[],
  coordinate: readonly [number, number, number],
): SpatialVector3 {
  const [x, y, z] = coordinate;
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  const divisor = Math.abs(w) > 1e-12 ? w : 1;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / divisor,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / divisor,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) / divisor,
  ];
}

export function sceneFloorPolygons(scene: RoomScene): SpatialVector3[][] {
  const floorPolygons = scene.surfaces
    .filter((surface) => surface.category === "floor")
    .flatMap((surface) => {
      let localCorners: SpatialVector3[];
      if (surface.polygonCorners && surface.polygonCorners.length >= 3) {
        localCorners = surface.polygonCorners;
      } else {
        // RoomPlan surfaces live in a local XY plane (Z is normally zero for a
        // floor). Picking the two non-zero/largest axes also keeps legacy
        // normalized scenes with XZ floor dimensions working.
        const axes = surface.dimensions
          .map((value, index) => ({ index, value: Math.abs(value) }))
          .sort((left, right) => right.value - left.value)
          .slice(0, 2);
        if (axes.length < 2 || axes[1]!.value <= 0.05) return [];
        const firstHalf = axes[0]!.value / 2;
        const secondHalf = axes[1]!.value / 2;
        localCorners = [
          [-firstHalf, -secondHalf],
          [firstHalf, -secondHalf],
          [firstHalf, secondHalf],
          [-firstHalf, secondHalf],
        ].map(([first, second]) => {
          const point: SpatialVector3 = [0, 0, 0];
          point[axes[0]!.index] = first;
          point[axes[1]!.index] = second;
          return point;
        });
      }
      const worldCorners = localCorners.map((coordinate) =>
        transformSpatialPoint(
          scene.worldFromModel,
          transformSpatialPoint(surface.transform, coordinate),
        ),
      );
      return worldCorners.length >= 3 ? [worldCorners] : [];
    });
  if (floorPolygons.length) return floorPolygons;

  const { min, max } = scene.bounds;
  const y = min[1];
  return [[
    transformSpatialPoint(scene.worldFromModel, [min[0], y, min[2]]),
    transformSpatialPoint(scene.worldFromModel, [max[0], y, min[2]]),
    transformSpatialPoint(scene.worldFromModel, [max[0], y, max[2]]),
    transformSpatialPoint(scene.worldFromModel, [min[0], y, max[2]]),
  ]];
}

function geographicPosition(coordinate: GeographicCoordinate): Position {
  return coordinate.altitude === undefined
    ? [coordinate.longitude, coordinate.latitude]
    : [coordinate.longitude, coordinate.latitude, coordinate.altitude];
}

function closePositions(positions: Position[]) {
  if (!positions.length) return positions;
  const first = positions[0]!;
  const last = positions.at(-1);
  return last && first[0] === last[0] && first[1] === last[1]
    ? positions
    : [...positions, [...first]];
}

export function localFloorRingToGeoJson<P extends object>(
  points: readonly LocalFloorPoint[],
  anchor: SpatialGeoreference,
  properties: P,
): Feature<Polygon, P> {
  const positions = points.map(([x, z]) =>
    geographicPosition(localArkitToGeographic([x, 0, z], anchor)),
  );
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [closePositions(positions)],
    },
  };
}

export function roomSceneFootprintToGeoJson<P extends object>(
  scene: RoomScene,
  anchor: SpatialGeoreference,
  properties: P,
  worldTransform?: SpatialMatrix4 | readonly number[] | null,
): Feature<Polygon | MultiPolygon, P> {
  const rings = sceneFloorPolygons(scene).map((polygon) =>
    closePositions(
      polygon.map((coordinate) =>
        geographicPosition(localArkitToGeographic(
          worldTransform
            ? transformSpatialPoint(worldTransform, coordinate)
            : coordinate,
          anchor,
        )),
      ),
    ),
  );
  const geometry: Polygon | MultiPolygon = rings.length === 1
    ? { type: "Polygon", coordinates: [rings[0]!] }
    : { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
  return {
    type: "Feature",
    properties,
    geometry,
  };
}
