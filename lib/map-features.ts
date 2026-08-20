import type { ResourceMapCoordinate, ResourceMapFeature } from "@/db/schema";

type MapResource = { id: string };

export function isRenderableMapCoordinate(
  coordinate: unknown,
): coordinate is ResourceMapCoordinate {
  return Array.isArray(coordinate)
    && coordinate.length === 2
    && coordinate.every((value) => typeof value === "number" && Number.isFinite(value))
    && coordinate[0] >= -180
    && coordinate[0] <= 180
    && coordinate[1] >= -90
    && coordinate[1] <= 90;
}

export function isRenderableMapFeature(
  feature: unknown,
): feature is ResourceMapFeature {
  if (!feature || typeof feature !== "object") return false;

  const candidate = feature as Partial<ResourceMapFeature>;
  if (candidate.type === "point") {
    return isRenderableMapCoordinate(candidate.coordinates);
  }

  if (candidate.type !== "polygon" || !Array.isArray(candidate.coordinates)) {
    return false;
  }
  if (
    candidate.coordinates.length < 4
    || !candidate.coordinates.every(isRenderableMapCoordinate)
  ) {
    return false;
  }

  const first = candidate.coordinates[0];
  const last = candidate.coordinates.at(-1);
  return Boolean(first && last && first[0] === last[0] && first[1] === last[1]);
}

export function displayedMapCoordinates(
  resources: MapResource[],
  featuresByResource: Record<string, ResourceMapFeature[]>,
) {
  return resources.flatMap((resource) =>
    (featuresByResource[resource.id] ?? []).flatMap((feature) => {
      if (!isRenderableMapFeature(feature)) return [];
      return feature.type === "point" ? [feature.coordinates] : feature.coordinates;
    }),
  );
}

export function positionFromMapFeatures(features: ResourceMapFeature[]) {
  const point = features.find((feature) => feature.type === "point");
  if (point?.type === "point") {
    return { gpsLongitude: point.coordinates[0], gpsLatitude: point.coordinates[1] };
  }

  const polygon = features.find((feature) => feature.type === "polygon");
  if (polygon?.type !== "polygon" || polygon.coordinates.length < 4) {
    return { gpsLongitude: null, gpsLatitude: null };
  }

  const vertices = polygon.coordinates.slice(0, -1);
  const sum = vertices.reduce(
    (total, coordinate) => ({
      longitude: total.longitude + coordinate[0],
      latitude: total.latitude + coordinate[1],
    }),
    { longitude: 0, latitude: 0 },
  );
  return {
    gpsLongitude: sum.longitude / vertices.length,
    gpsLatitude: sum.latitude / vertices.length,
  };
}
