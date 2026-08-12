import type {
  ResourceMapCoordinate,
  ResourceMapFeature,
} from "@/db/schema";

type SpatialTarget = {
  mapFeatures: ResourceMapFeature[];
  gpsLatitude: number | null;
  gpsLongitude: number | null;
};

export function spatialFeaturePoints(target: SpatialTarget) {
  const point = target.mapFeatures.find((feature) => feature.type === "point");
  if (point?.type === "point") {
    return [{ point: point.coordinates, featureId: point.id }];
  }

  const polygon = target.mapFeatures.find((feature) => feature.type === "polygon");
  if (polygon?.type === "polygon") {
    return polygon.coordinates.slice(0, -1).map((coordinate) => ({
      point: coordinate,
      featureId: polygon.id,
    }));
  }

  if (
    target.gpsLatitude === null ||
    target.gpsLongitude === null ||
    !Number.isFinite(target.gpsLatitude) ||
    !Number.isFinite(target.gpsLongitude)
  ) {
    return [];
  }

  return [{
    point: [target.gpsLongitude, target.gpsLatitude] as ResourceMapCoordinate,
    featureId: null,
  }];
}

function pointOnSegment(
  point: ResourceMapCoordinate,
  start: ResourceMapCoordinate,
  end: ResourceMapCoordinate,
) {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) -
    (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > 1e-10) return false;
  const dot =
    (point[0] - start[0]) * (end[0] - start[0]) +
    (point[1] - start[1]) * (end[1] - start[1]);
  if (dot < 0) return false;
  const squaredLength =
    (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  if (squaredLength === 0) {
    return point[0] === start[0] && point[1] === start[1];
  }
  return dot <= squaredLength;
}

export function polygonCoversPoint(
  polygon: ResourceMapCoordinate[],
  point: ResourceMapCoordinate,
) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const start = polygon[previous]!;
    const end = polygon[index]!;
    if (pointOnSegment(point, start, end)) return true;
    if (
      (start[1] > point[1]) !== (end[1] > point[1]) &&
      point[0] <
        ((end[0] - start[0]) * (point[1] - start[1])) /
          (end[1] - start[1]) +
          start[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function spatialTargetIsInside(
  polygon: ResourceMapCoordinate[],
  target: SpatialTarget,
) {
  const points = spatialFeaturePoints(target);
  return (
    points.length > 0 &&
    points.every(({ point }) => polygonCoversPoint(polygon, point))
  );
}
