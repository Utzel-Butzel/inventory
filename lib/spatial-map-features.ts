import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";

import type {
  ClientSpatialStructureDetail,
  ClientSpatialStructureRoom,
  ClientSpatialStructureSummary,
} from "./client-types";
import {
  isSpatialGeoreference,
  localArkitToGeographic,
  localFloorRingToGeoJson,
  roomSceneFootprintToGeoJson,
  type SpatialGeoreference,
} from "@/lib/spatial-georeference";

export type SpatialMapFeatureKind =
  | "structure-marker"
  | "structure-footprint"
  | "room-footprint"
  | "positioned-item";

export type SpatialMapFeatureProperties = {
  spatialKind: SpatialMapFeatureKind;
  structureId: string;
  structureName: string;
  floorIdentifier?: string;
  floorIndex?: number;
  scanId?: string;
  roomName?: string;
  coordinateSpaceId?: string;
  resourceId?: string;
  resourceName?: string;
  selected: boolean;
};

export type SpatialMapFeature = Feature<
  Point | Polygon | MultiPolygon,
  SpatialMapFeatureProperties
>;

export type SpatialStructureMapOptions = {
  activeStructureId?: string | null;
  activeFloorIdentifier?: string | null;
};

function structureAnchorPoint(
  structure: ClientSpatialStructureSummary,
  selected: boolean,
): Feature<Point, SpatialMapFeatureProperties> | null {
  if (!isSpatialGeoreference(structure.georeference)) return null;
  return {
    type: "Feature",
    id: `structure-marker:${structure.id}`,
    properties: {
      spatialKind: "structure-marker",
      structureId: structure.id,
      structureName: structure.name,
      selected,
    },
    geometry: {
      type: "Point",
      coordinates: [
        structure.georeference.longitude,
        structure.georeference.latitude,
        ...(Number.isFinite(structure.georeference.altitude)
          ? [Number(structure.georeference.altitude)]
          : []),
      ],
    },
  };
}

function structureBoundsFootprint(
  structure: ClientSpatialStructureSummary,
  selected: boolean,
): Feature<Polygon, SpatialMapFeatureProperties> | null {
  if (
    !structure.bounds ||
    !structure.boundsCoordinateSpaceId ||
    !isSpatialGeoreference(structure.boundsGeoreference)
  ) return null;
  const { min, max } = structure.bounds;
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
  const feature = localFloorRingToGeoJson(
    [
      [min[0], min[2]],
      [max[0], min[2]],
      [max[0], max[2]],
      [min[0], max[2]],
    ],
    structure.boundsGeoreference,
    {
      spatialKind: "structure-footprint" as const,
      structureId: structure.id,
      structureName: structure.name,
      coordinateSpaceId: structure.boundsCoordinateSpaceId,
      selected,
    },
  );
  feature.id = `structure-footprint:${structure.id}`;
  return feature;
}

/**
 * Selects a georeference that actually belongs to the room's AR frame.
 * Structure-level anchors are only safe for legacy scans without an explicit
 * coordinate-space identifier.
 */
export function roomGeoreference(
  structure: ClientSpatialStructureSummary,
  room: ClientSpatialStructureRoom,
): SpatialGeoreference | null {
  const scanAnchor = room.scan?.georeference ?? room.georeference;
  if (isSpatialGeoreference(scanAnchor)) return scanAnchor;
  const coordinateSpaceId = room.scan?.coordinateSpaceId ?? room.coordinateSpaceId;
  return !coordinateSpaceId && isSpatialGeoreference(structure.georeference)
    ? structure.georeference
    : null;
}

function roomFeatures(
  structure: ClientSpatialStructureDetail,
  room: ClientSpatialStructureRoom,
  floorIdentifier: string,
  floorIndex: number,
  selected: boolean,
): SpatialMapFeature[] {
  const anchor = roomGeoreference(structure, room);
  if (!anchor || !room.scan) return [];
  const coordinateSpaceId = room.scan.coordinateSpaceId ?? room.coordinateSpaceId ?? undefined;
  const baseProperties = {
    structureId: structure.id,
    structureName: structure.name,
    floorIdentifier,
    floorIndex,
    scanId: room.scan.id,
    roomName: room.roomName,
    ...(coordinateSpaceId ? { coordinateSpaceId } : {}),
    selected,
  };
  const footprint = roomSceneFootprintToGeoJson(
    room.scan.scene,
    anchor,
    { spatialKind: "room-footprint" as const, ...baseProperties },
  );
  footprint.id = `room-footprint:${room.scan.id}`;

  const placements: SpatialMapFeature[] = room.placements.map((placement) => {
    const coordinate = localArkitToGeographic(placement.position, anchor);
    return {
      type: "Feature",
      id: `positioned-item:${placement.id}`,
      properties: {
        spatialKind: "positioned-item",
        ...baseProperties,
        resourceId: placement.resource.id,
        resourceName: placement.resource.name,
      },
      geometry: {
        type: "Point",
        coordinates: [
          coordinate.longitude,
          coordinate.latitude,
          ...(coordinate.altitude === undefined ? [] : [coordinate.altitude]),
        ],
      },
    };
  });
  return [footprint, ...placements];
}

export function spatialStructureMapFeatures(
  structures: readonly ClientSpatialStructureSummary[],
  detail: ClientSpatialStructureDetail | null,
  options: SpatialStructureMapOptions = {},
): FeatureCollection<Point | Polygon | MultiPolygon, SpatialMapFeatureProperties> {
  const features: SpatialMapFeature[] = [];
  for (const structure of structures) {
    const selected = structure.id === options.activeStructureId;
    const marker = structureAnchorPoint(structure, selected);
    const footprint = structureBoundsFootprint(structure, selected);
    if (footprint) features.push(footprint);
    if (marker) features.push(marker);
  }

  if (detail && detail.id === options.activeStructureId) {
    const floor = detail.floors.find(
      (candidate) => floorIdentifier(candidate.identifier, candidate.index) === options.activeFloorIdentifier,
    ) ?? detail.floors[0];
    if (floor) {
      for (const room of floor.rooms) {
        features.push(...roomFeatures(
          detail,
          room,
          floorIdentifier(floor.identifier, floor.index),
          floor.index ?? 0,
          true,
        ));
      }
    }
  }

  if (
    detail &&
    detail.id === options.activeStructureId &&
    !features.some(
      (feature) =>
        feature.properties.structureId === detail.id &&
        feature.properties.spatialKind === "structure-marker",
    )
  ) {
    const roomPoint = features.find(
      (feature) =>
        feature.properties.structureId === detail.id &&
        (feature.geometry.type === "Polygon" ||
          feature.geometry.type === "MultiPolygon"),
    );
    if (
      roomPoint?.geometry.type === "Polygon" ||
      roomPoint?.geometry.type === "MultiPolygon"
    ) {
      const rings = roomPoint.geometry.type === "Polygon"
        ? [roomPoint.geometry.coordinates[0] ?? []]
        : roomPoint.geometry.coordinates.map((polygon) => polygon[0] ?? []);
      const vertices = rings.flatMap((ring) =>
        ring.length > 1 ? ring.slice(0, -1) : ring,
      );
      if (vertices.length) {
        const center = vertices.reduce(
          (sum, coordinate) => [sum[0] + coordinate[0], sum[1] + coordinate[1]],
          [0, 0],
        );
        features.push({
          type: "Feature",
          id: `structure-derived-marker:${detail.id}`,
          properties: {
            spatialKind: "structure-marker",
            structureId: detail.id,
            structureName: detail.name,
            selected: true,
          },
          geometry: {
            type: "Point",
            coordinates: [center[0] / vertices.length, center[1] / vertices.length],
          },
        });
      }
    }
  }

  return { type: "FeatureCollection", features };
}

export function floorIdentifier(identifier: string | null, index: number | null) {
  return identifier ?? (index === null ? "Unassigned" : `Floor ${index}`);
}
