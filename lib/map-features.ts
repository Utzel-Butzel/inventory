import type { ResourceMapFeature } from "@/db/schema";

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
