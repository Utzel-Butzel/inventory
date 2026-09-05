import type { SpatialMatrix4, SpatialVector3 } from "@/lib/room-scene-contract";
import { transformSpatialPoint } from "@/lib/spatial-georeference";
export type RoomWalkCollider = {
  inverse: SpatialMatrix4;
  min: SpatialVector3;
  max: SpatialVector3;
};
export function roomWalkBodyCollides(
  position: SpatialVector3,
  eyeHeight: number,
  radius: number,
  colliders: readonly RoomWalkCollider[],
) {
  const bottom: SpatialVector3 = [
    position[0],
    position[1] - eyeHeight + 0.12,
    position[2],
  ];
  const top: SpatialVector3 = [position[0], position[1] + 0.1, position[2]];
  return colliders.some((c) => {
    const a = transformSpatialPoint(c.inverse, bottom),
      b = transformSpatialPoint(c.inverse, top);
    return [0, 1, 2].every((axis) => {
      const padding =
        radius * Math.hypot(c.inverse[axis]!, c.inverse[8 + axis]!);
      return (
        Math.max(a[axis]!, b[axis]!) + padding > c.min[axis]! &&
        Math.min(a[axis]!, b[axis]!) - padding < c.max[axis]!
      );
    });
  });
}
export function roomWalkPointOnFloor(
  point: SpatialVector3,
  polygons: readonly SpatialVector3[][],
) {
  return polygons.some((polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!,
        b = polygon[j]!;
      if (
        a[2] > point[2] !== b[2] > point[2] &&
        point[0] < ((b[0] - a[0]) * (point[2] - a[2])) / (b[2] - a[2]) + a[0]
      )
        inside = !inside;
    }
    return inside;
  });
}
