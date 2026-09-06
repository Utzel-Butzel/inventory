import type { RoomScene, RoomSurface, SpatialVector3 } from "@/lib/room-scene-contract";
import { roomSceneSchema } from "@/lib/room-scene-contract";
import { invertSpatialMatrix, multiplySpatialMatrices } from "@/lib/room-floor-layout";
import { transformSpatialPoint } from "@/lib/spatial-georeference";

const apertureCategories = new Set(["door", "window", "opening"]);

/** Match an aperture to one wall in the original scan, before moving either. */
export function roomSurfaceParentWall(scene: RoomScene, aperture: RoomSurface) {
  if (!apertureCategories.has(aperture.category)) return null;
  let best: { id: string; distance: number } | null = null;
  for (const wall of scene.surfaces) {
    if (wall.category !== "wall") continue;
    const inverse = invertSpatialMatrix(wall.transform);
    if (!inverse) continue;
    const local = multiplySpatialMatrices(inverse, aperture.transform);
    if (Math.abs(local[10]!) < 0.9) continue;
    const distance = Math.abs(local[14]!);
    if (distance > 0.2 || Math.abs(local[12]!) > wall.dimensions[0] / 2 + 0.05 ||
        Math.abs(local[13]!) > wall.dimensions[1] / 2 + 0.05) continue;
    if (!best || distance < best.distance) best = { id: wall.id, distance };
  }
  return best?.id ?? null;
}

export function resizeRoomSurface(surface: RoomSurface, dimensions: SpatialVector3): RoomSurface {
  return {
    ...surface, dimensions,
    ...(surface.polygonCorners ? { polygonCorners: surface.polygonCorners.map(point =>
      point.map((value, axis) => surface.dimensions[axis]! > 1e-8
        ? value * dimensions[axis]! / surface.dimensions[axis]! : value) as SpatialVector3,
    ) } : {}),
  };
}

export function applyRoomSurfaceEdit(scene: RoomScene, surface: RoomSurface): RoomScene {
  const previous = scene.surfaces.find(item => item.id === surface.id);
  if (!previous) throw new Error("surface-not-found");
  if (surface.category !== previous.category) throw new Error("surface-category-changed");
  if (surface.dimensions.filter(value => value >= 0.05).length < 2)
    throw new Error("surface-too-small");
  const inverse = invertSpatialMatrix(previous.transform);
  if (!inverse || !invertSpatialMatrix(surface.transform)) throw new Error("invalid-transform");
  const geometryChanged = JSON.stringify([previous.dimensions, previous.transform, previous.polygonCorners]) !==
    JSON.stringify([surface.dimensions, surface.transform, surface.polygonCorners]);
  const delta = multiplySpatialMatrices(surface.transform, inverse);
  const surfaces = scene.surfaces.map(item => {
    if (item.id === surface.id) return surface;
    if (previous.category === "wall" && roomSurfaceParentWall(scene, item) === previous.id)
      return { ...item, transform: multiplySpatialMatrices(delta, item.transform) };
    return item;
  });
  if (!geometryChanged) return roomSceneSchema.parse({ ...scene, surfaces });
  // Include furniture and all measured polygon corners; a moved wall must not
  // leave camera fitting, navigation or the lighting rig with stale bounds.
  const points: SpatialVector3[] = [];
  for (const item of [...surfaces, ...scene.objects]) {
    const corners = "polygonCorners" in item && item.polygonCorners
      ? item.polygonCorners
      : [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z =>
          [x * item.dimensions[0] / 2, y * item.dimensions[1] / 2, z * item.dimensions[2] / 2] as SpatialVector3)));
    points.push(...corners.map(point => transformSpatialPoint(item.transform, point)));
  }
  return roomSceneSchema.parse({ ...scene, surfaces, bounds: {
    min: [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]!))),
    max: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]!))),
  } });
}
