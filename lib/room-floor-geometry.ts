import * as THREE from "three";
import type { RoomSurface } from "@/lib/room-scene-contract";

/** Preserve concave scan/split outlines instead of filling their bounding box. */
export function createRoomFloorGeometry(
  surface: RoomSurface,
): THREE.BufferGeometry {
  if (!surface.polygonCorners)
    return new THREE.BoxGeometry(
      ...surface.dimensions.map((value) => Math.max(0.025, value)),
    );
  const axes = surface.dimensions
    .map((size, axis) => ({ size, axis }))
    .sort((a, b) => b.size - a.size);
  const uAxis = axes[0]!.axis,
    vAxis = axes[1]!.axis,
    thinAxis = axes[2]!.axis;
  const shape = new THREE.Shape(
    surface.polygonCorners.map(
      (point) => new THREE.Vector2(point[uAxis]!, point[vAxis]!),
    ),
  );
  const depth = Math.max(0.025, surface.dimensions[thinAxis]!);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  const u = new THREE.Vector3().setComponent(uAxis, 1),
    v = new THREE.Vector3().setComponent(vAxis, 1);
  const normal = new THREE.Vector3().crossVectors(u, v);
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(u, v, normal));
  const offset = new THREE.Vector3().setComponent(
    thinAxis,
    surface.polygonCorners[0]![thinAxis]!,
  );
  geometry.translate(offset.x, offset.y, offset.z);
  return geometry;
}
