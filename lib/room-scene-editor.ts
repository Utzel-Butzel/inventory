import { z } from "zod";
import {
  identitySpatialMatrix,
  roomSceneSchema,
  spatialMatrix4Schema,
  type RoomScene,
  type RoomSurface,
  type SpatialMatrix4,
  type SpatialVector3,
} from "@/lib/room-scene-contract";
import { roomObjectAppearanceSchema } from "@/lib/room-furniture-catalog";
import { automaticRoomFurnitureVariant, roomFurnitureLibraryVersion } from "@/lib/room-furniture-catalog";
import { spatialGeoreferenceSchema } from "@/lib/spatial-structure-contract";
import { invertSpatialMatrix } from "@/lib/room-floor-layout";
import { transformSpatialPoint } from "@/lib/spatial-georeference";

const size = z.number().finite().min(0.8).max(50);
export const roomEditSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("regenerate"), revision: z.number().int().positive() }).strict(),
  z
    .object({
      action: z.literal("object"),
      revision: z.number().int().positive(),
      objectId: z.uuid(),
      appearance: roomObjectAppearanceSchema,
      transform: spatialMatrix4Schema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("anchor"),
      revision: z.number().int().positive(),
      anchor: spatialGeoreferenceSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("replace"),
      revision: z.number().int().positive(),
      scene: roomSceneSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("split"),
      revision: z.number().int().positive(),
      axis: z.enum(["x", "z"]),
      position: z.number().finite(),
      name: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      action: z.literal("add"),
      revision: z.number().int().positive(),
      name: z.string().trim().min(1).max(240),
      width: size,
      depth: size,
      height: z.number().finite().min(1.8).max(10),
    })
    .strict(),
]);
export const manualRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    width: size,
    depth: size,
    height: z.number().finite().min(1.8).max(10),
  })
  .strict();
export type RoomEdit = z.infer<typeof roomEditSchema>;

/** Rebuild presentation from the measured ARKit shell and object boxes, preserving edits and scan identity. */
export function regenerateRoomPresentation(scene: RoomScene, now = new Date().toISOString()): RoomScene {
  return roomSceneSchema.parse({
    ...scene,
    objects: scene.objects.map(object => {
      const variant = automaticRoomFurnitureVariant(object.category, object.dimensions);
      const measured = { ...object };
      delete measured.generatedModel;
      return { ...measured, ...(variant ? { generatedModel: { variant, libraryVersion: roomFurnitureLibraryVersion } } : {}) };
    }),
    presentation: { libraryVersion: roomFurnitureLibraryVersion, regeneratedAt: now, generation: (scene.presentation?.generation ?? 0) + 1 },
  });
}

export function roomSceneCenterPosition(
  scene: RoomScene,
  layoutTransform?: SpatialMatrix4 | null,
): SpatialVector3 {
  const center = scene.bounds.min.map(
    (value, axis) => (value + scene.bounds.max[axis]!) / 2,
  ) as SpatialVector3;
  return transformSpatialPoint(layoutTransform ?? scene.worldFromModel, center);
}

export function rectangularRoomScene(
  width: number,
  depth: number,
  height: number,
  createId: () => string,
): RoomScene {
  const surface = (
    dimensions: SpatialVector3,
    position: SpatialVector3,
    turn = 0,
    floor = false,
  ): RoomSurface => {
    const c = Math.cos(turn),
      s = Math.sin(turn);
    const transform = floor
      ? [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, ...position, 1]
      : [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, ...position, 1];
    return {
      id: createId(),
      category: floor ? "floor" : "wall",
      dimensions,
      transform,
      confidence: "high",
    };
  };
  return roomSceneSchema.parse({
    schemaVersion: 1,
    coordinateSystem: "arkit-right-handed-y-up",
    units: "meter",
    matrixOrder: "column-major",
    worldFromModel: [...identitySpatialMatrix],
    webFromWorld: [...identitySpatialMatrix],
    bounds: {
      min: [-width / 2, 0, -depth / 2],
      max: [width / 2, height, depth / 2],
    },
    surfaces: [
      surface([width, depth, 0], [0, 0, 0], 0, true),
      surface([width, height, 0], [0, height / 2, -depth / 2]),
      surface([width, height, 0], [0, height / 2, depth / 2]),
      surface([depth, height, 0], [-width / 2, height / 2, 0], Math.PI / 2),
      surface([depth, height, 0], [width / 2, height / 2, 0], Math.PI / 2),
    ],
    objects: [],
  });
}

function surfaceCorners(surface: RoomSurface): SpatialVector3[] {
  if (surface.polygonCorners) return surface.polygonCorners;
  const axes = surface.dimensions
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => {
    const point: SpatialVector3 = [0, 0, 0];
    point[axes[0]!.i] = (a! * axes[0]!.v) / 2;
    point[axes[1]!.i] = (b! * axes[1]!.v) / 2;
    return point;
  });
}

/** Clips in model space, then recenters in each surface's own plane. */
function clipSurface(
  surface: RoomSurface,
  axis: number,
  cut: number,
  side: -1 | 1,
): RoomSurface | null {
  const inverse = invertSpatialMatrix(surface.transform);
  if (!inverse) throw new Error("invalid-transform");
  const points = surfaceCorners(surface).map((p) =>
    transformSpatialPoint(surface.transform, p),
  );
  const clipped: SpatialVector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    const da = (a[axis]! - cut) * side,
      db = (b[axis]! - cut) * side;
    if (da >= -1e-7) clipped.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      clipped.push(a.map((v, j) => v + (b[j]! - v) * t) as SpatialVector3);
    }
  }
  if (clipped.length < 3) return null;
  const local = clipped.map((p) => transformSpatialPoint(inverse, p));
  const min = [0, 1, 2].map((a) => Math.min(...local.map((p) => p[a]!)));
  const max = [0, 1, 2].map((a) => Math.max(...local.map((p) => p[a]!)));
  const dimensions = max.map((v, a) => v - min[a]!) as SpatialVector3;
  if (dimensions.filter((v) => v > 1e-5).length < 2) return null;
  const center = min.map((v, a) => (v + max[a]!) / 2) as SpatialVector3;
  const worldCenter = transformSpatialPoint(surface.transform, center);
  const transform = [...surface.transform];
  transform.splice(12, 3, ...worldCenter);
  return {
    ...surface,
    dimensions,
    transform,
    polygonCorners: local.map(
      (p) => p.map((v, a) => v - center[a]!) as SpatialVector3,
    ),
  };
}

export function splitRoomScene(
  scene: RoomScene,
  axisName: "x" | "z",
  cut: number,
  createId: () => string,
): [RoomScene, RoomScene] {
  const axis = axisName === "x" ? 0 : 2;
  if (
    cut - scene.bounds.min[axis]! < 0.8 ||
    scene.bounds.max[axis]! - cut < 0.8
  )
    throw new Error("split-too-small");
  // A partition through a measured object is almost always accidental.
  for (const object of scene.objects) {
    const half = object.dimensions.reduce(
      (sum, d, a) => sum + (Math.abs(object.transform[a * 4 + axis]!) * d) / 2,
      0,
    );
    const center = object.transform[12 + axis]!;
    if (center - half < cut - 0.01 && center + half > cut + 0.01)
      throw new Error("split-crosses-furniture");
  }
  const other = axis === 0 ? 2 : 0;
  const intervals: Array<[number, number]> = [];
  for (const floor of scene.surfaces.filter((s) => s.category === "floor")) {
    const polygon = surfaceCorners(floor).map((p) =>
      transformSpatialPoint(floor.transform, p),
    );
    const crossings: number[] = [];
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!;
      if (
        (a[axis]! <= cut && b[axis]! > cut) ||
        (b[axis]! <= cut && a[axis]! > cut)
      ) {
        crossings.push(
          a[other]! +
            ((b[other]! - a[other]!) * (cut - a[axis]!)) /
              (b[axis]! - a[axis]!),
        );
      }
    });
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2)
      if (crossings[i + 1]! - crossings[i]! > 0.01)
        intervals.push([crossings[i]!, crossings[i + 1]!]);
  }
  // Adjacent floor tiles share one partition; gaps between floor islands stay open.
  const spans: Array<[number, number]> = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const previous = spans.at(-1);
    if (previous && interval[0] <= previous[1] + 0.01)
      previous[1] = Math.max(previous[1], interval[1]);
    else spans.push([...interval]);
  }
  return ([-1, 1] as const).map((side) => {
    const result = structuredClone(scene);
    result.bounds[side === -1 ? "max" : "min"][axis] = cut;
    result.surfaces = scene.surfaces.flatMap((s) => {
      const clipped = clipSurface(s, axis, cut, side);
      return clipped
        ? [{ ...clipped, id: side === 1 ? createId() : s.id }]
        : [];
    });
    if (!result.surfaces.some((s) => s.category === "floor"))
      throw new Error("split-missing-floor");
    for (const [start, end] of spans) {
      const center: SpatialVector3 = [
        0,
        (scene.bounds.min[1] + scene.bounds.max[1]) / 2,
        0,
      ];
      center[axis] = cut;
      center[other] = (start + end) / 2;
      const transform =
        axis === 0
          ? [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, ...center, 1]
          : [...identitySpatialMatrix.slice(0, 12), ...center, 1];
      result.surfaces.push({
        id: createId(),
        category: "wall",
        confidence: "high",
        dimensions: [
          end - start,
          scene.bounds.max[1] - scene.bounds.min[1],
          0.1,
        ],
        transform,
      });
    }
    result.objects = result.objects.filter((o) =>
      side === -1
        ? o.transform[12 + axis]! < cut
        : o.transform[12 + axis]! >= cut,
    );
    result.editedAt = new Date().toISOString();
    return roomSceneSchema.parse(result);
  }) as [RoomScene, RoomScene];
}
