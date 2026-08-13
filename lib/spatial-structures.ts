import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  media,
  resources,
  resourceSpatialPlacements,
  roomScanAssets,
  roomScanKeyframes,
  roomScans,
  spatialCoordinateSpaces,
  spatialStructures,
} from "@/db/schema";
import { db } from "@/lib/db";
import { assembleRoomSceneManifests } from "@/lib/room-scene-read-model";
import {
  sharedCoordinateSpaceBounds,
  transformSpatialBounds,
  type SpatialGeoreference,
  type SpatialStructureCreate,
  type SpatialStructurePatch,
} from "@/lib/spatial-structure-contract";

const compatibleBounds = (
  scans: Array<{
    coordinateSpaceId: string | null;
    scene: {
      bounds: { min: [number, number, number]; max: [number, number, number] };
      worldFromModel: number[];
    };
  }>,
) =>
  sharedCoordinateSpaceBounds(
    scans.flatMap((scan) => {
      const bounds = transformSpatialBounds(
        scan.scene.bounds,
        scan.scene.worldFromModel,
      );
      return bounds
        ? [{ coordinateSpaceId: scan.coordinateSpaceId, bounds }]
        : [];
    }),
  )?.bounds ?? null;

export async function listSpatialStructures(organizationId: string) {
  const structures = await db
    .select()
    .from(spatialStructures)
    .where(eq(spatialStructures.organizationId, organizationId))
    .orderBy(asc(spatialStructures.name), asc(spatialStructures.id));
  if (!structures.length) return [];

  const ids = structures.map((structure) => structure.id);
  const [scanRows, coordinateSpaceRows] = await Promise.all([
    db
      .select({
        structureId: roomScans.structureId,
        floorIdentifier: roomScans.floorIdentifier,
        floorIndex: roomScans.floorIndex,
        roomResourceId: roomScans.roomResourceId,
        coordinateSpaceId: roomScans.coordinateSpaceId,
        scene: roomScans.scene,
      })
      .from(roomScans)
      .where(
        and(
          eq(roomScans.organizationId, organizationId),
          inArray(roomScans.structureId, ids),
          eq(roomScans.status, "active"),
        ),
      ),
    db
      .select()
      .from(spatialCoordinateSpaces)
      .where(
        and(
          eq(spatialCoordinateSpaces.organizationId, organizationId),
          inArray(spatialCoordinateSpaces.structureId, ids),
        ),
      ),
  ]);

  return structures.map((structure) => {
    const scans = scanRows.filter((scan) => scan.structureId === structure.id);
    const activeCoordinateSpaceIds = [
      ...new Set(
        scans
          .map((scan) => scan.coordinateSpaceId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const boundsCoordinateSpaceId =
      activeCoordinateSpaceIds.length === 1 ? activeCoordinateSpaceIds[0]! : null;
    const boundsGeoreference = boundsCoordinateSpaceId
      ? coordinateSpaceRows.find((space) => space.id === boundsCoordinateSpaceId)
          ?.georeference ?? null
      : null;
    const floors = new Set(
      scans.map((scan) => {
        const index = scan.floorIndex ?? 0;
        const identifier =
          scan.floorIdentifier ??
          (scan.floorIndex === null ? "unassigned" : `floor-${index}`);
        return `${index}\u0000${identifier}`;
      }),
    );
    return {
      id: structure.id,
      name: structure.name,
      description: structure.description,
      georeference: structure.georeference,
      floorCount: floors.size,
      roomCount: new Set(scans.map((scan) => scan.roomResourceId)).size,
      activeScanCount: scans.length,
      coordinateSpaceCount: activeCoordinateSpaceIds.length,
      bounds: compatibleBounds(scans),
      boundsCoordinateSpaceId,
      boundsGeoreference,
      createdAt: structure.createdAt,
      updatedAt: structure.updatedAt,
    };
  });
}

export async function getSpatialStructure(
  organizationId: string,
  structureId: string,
) {
  const [structure] = await db
    .select()
    .from(spatialStructures)
    .where(
      and(
        eq(spatialStructures.organizationId, organizationId),
        eq(spatialStructures.id, structureId),
      ),
    )
    .limit(1);
  if (!structure) return null;

  const [scanRows, coordinateSpaces] = await Promise.all([
    db
      .select({
        scan: roomScans,
        room: resources,
        structure: spatialStructures,
        coordinateSpace: spatialCoordinateSpaces,
      })
      .from(roomScans)
      .innerJoin(
        resources,
        and(
          eq(resources.id, roomScans.roomResourceId),
          eq(resources.organizationId, organizationId),
        ),
      )
      .leftJoin(
        spatialStructures,
        and(
          eq(spatialStructures.id, roomScans.structureId),
          eq(spatialStructures.organizationId, organizationId),
        ),
      )
      .leftJoin(
        spatialCoordinateSpaces,
        and(
          eq(spatialCoordinateSpaces.id, roomScans.coordinateSpaceId),
          eq(spatialCoordinateSpaces.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(roomScans.organizationId, organizationId),
          eq(roomScans.structureId, structureId),
          eq(roomScans.status, "active"),
        ),
      )
      .orderBy(
        asc(roomScans.floorIndex),
        asc(roomScans.floorIdentifier),
        asc(resources.name),
      ),
    db
      .select()
      .from(spatialCoordinateSpaces)
      .where(
        and(
          eq(spatialCoordinateSpaces.organizationId, organizationId),
          eq(spatialCoordinateSpaces.structureId, structureId),
        ),
      )
      .orderBy(asc(spatialCoordinateSpaces.createdAt)),
  ]);

  const scanIds = scanRows.map(({ scan }) => scan.id);
  const [assetRows, keyframeRows, placementRows] = scanIds.length
    ? await Promise.all([
        db
          .select()
          .from(roomScanAssets)
          .where(
            and(
              eq(roomScanAssets.organizationId, organizationId),
              inArray(roomScanAssets.roomScanId, scanIds),
            ),
          )
          .orderBy(asc(roomScanAssets.kind)),
        db
          .select()
          .from(roomScanKeyframes)
          .where(
            and(
              eq(roomScanKeyframes.organizationId, organizationId),
              inArray(roomScanKeyframes.roomScanId, scanIds),
            ),
          )
          .orderBy(asc(roomScanKeyframes.frameTimestamp)),
        db
          .select({ placement: resourceSpatialPlacements, resource: resources })
          .from(resourceSpatialPlacements)
          .innerJoin(
            resources,
            and(
              eq(resources.id, resourceSpatialPlacements.resourceId),
              eq(resources.organizationId, organizationId),
            ),
          )
          .where(
            and(
              eq(resourceSpatialPlacements.organizationId, organizationId),
              inArray(resourceSpatialPlacements.roomScanId, scanIds),
            ),
          )
          .orderBy(asc(resources.name)),
      ])
    : [[], [], []];
  const placementResourceIds = [
    ...new Set(placementRows.map(({ resource }) => resource.id)),
  ];
  const coverRows = placementResourceIds.length
    ? await db
        .select()
        .from(media)
        .where(
          and(
            eq(media.organizationId, organizationId),
            inArray(media.resourceId, placementResourceIds),
            eq(media.kind, "image"),
          ),
        )
        .orderBy(asc(media.position))
    : [];
  const scenes = assembleRoomSceneManifests(
    scanRows,
    assetRows,
    keyframeRows,
    placementRows,
    coverRows,
  );
  const rooms = scenes.map((manifest) => {
    const { scan, room } = manifest;
    return {
      roomIdentifier: scan.roomIdentifier ?? scan.id,
      roomResourceId: room.id,
      roomName: room.name,
      coordinateSpaceId: scan.coordinateSpaceId,
      georeference: scan.georeference,
      scan,
      placements: manifest.placements,
    };
  });

  const floorKeys: Array<{ identifier: string; index: number }> = [];
  for (const { scan } of scenes) {
    const floorIndex = scan.floorIndex ?? 0;
    const floorIdentifier =
      scan.floorIdentifier ??
      (scan.floorIndex === null ? "unassigned" : `floor-${floorIndex}`);
    if (
      floorKeys.some(
        (floor) =>
          floor.identifier === floorIdentifier && floor.index === floorIndex,
      )
    ) {
      continue;
    }
    floorKeys.push({
      identifier: floorIdentifier,
      index: floorIndex,
    });
  }

  const activeCoordinateSpaceIds = [
    ...new Set(
      scenes
        .map(({ scan }) => scan.coordinateSpaceId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const boundsCoordinateSpaceId =
    activeCoordinateSpaceIds.length === 1 ? activeCoordinateSpaceIds[0]! : null;
  const summary = {
    id: structure.id,
    name: structure.name,
    description: structure.description,
    georeference: structure.georeference,
    floorCount: floorKeys.length,
    roomCount: new Set(scenes.map(({ room }) => room.id)).size,
    activeScanCount: scenes.length,
    coordinateSpaceCount: activeCoordinateSpaceIds.length,
    bounds: compatibleBounds(scenes.map(({ scan }) => scan)),
    boundsCoordinateSpaceId,
    boundsGeoreference: boundsCoordinateSpaceId
      ? coordinateSpaces.find((space) => space.id === boundsCoordinateSpaceId)
          ?.georeference ?? null
      : null,
    createdAt: structure.createdAt,
    updatedAt: structure.updatedAt,
  };

  return {
    ...summary,
    coordinateSpaces: coordinateSpaces.map((space) => ({
      id: space.id,
      georeference: space.georeference,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
    })),
    floors: floorKeys.map((floor) => {
      const floorRooms = rooms.filter((_, index) => {
        const scan = scenes[index]!.scan;
        const scanFloorIndex = scan.floorIndex ?? 0;
        const scanFloorIdentifier =
          scan.floorIdentifier ??
          (scan.floorIndex === null ? "unassigned" : `floor-${scanFloorIndex}`);
        return (
          scanFloorIdentifier === floor.identifier && scanFloorIndex === floor.index
        );
      });
      return {
        identifier: floor.identifier,
        index: floor.index,
        roomCount: floorRooms.length,
        bounds: compatibleBounds(
          scenes
            .map(({ scan }) => scan)
            .filter(
              (scan) =>
                (scan.floorIdentifier ??
                  (scan.floorIndex === null
                    ? "unassigned"
                    : `floor-${scan.floorIndex ?? 0}`)) === floor.identifier &&
                (scan.floorIndex ?? 0) === floor.index,
            ),
        ),
        rooms: floorRooms,
      };
    }),
  };
}

export async function createSpatialStructure(
  organizationId: string,
  input: SpatialStructureCreate,
  actor: string,
) {
  const [created] = await db
    .insert(spatialStructures)
    .values({
      organizationId,
      id: input.id,
      name: input.name,
      description: input.description,
      georeference: input.georeference,
      createdBy: actor,
      updatedBy: actor,
    })
    .returning();
  return created;
}

export async function updateSpatialStructure(
  organizationId: string,
  structureId: string,
  input: SpatialStructurePatch,
  actor: string,
) {
  const values: {
    name?: string;
    description?: string;
    georeference?: SpatialGeoreference | null;
    updatedBy: string;
    updatedAt: Date;
  } = {
    updatedBy: actor,
    updatedAt: new Date(),
  };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.georeference !== undefined) values.georeference = input.georeference;

  const [updated] = await db
    .update(spatialStructures)
    .set(values)
    .where(
      and(
        eq(spatialStructures.organizationId, organizationId),
        eq(spatialStructures.id, structureId),
      ),
    )
    .returning();
  return updated ?? null;
}

export const spatialStructureHttpError = (
  error: unknown,
  fallback: string,
) => {
  const constraint =
    typeof error === "object" && error !== null && "constraint_name" in error
      ? String((error as { constraint_name?: unknown }).constraint_name ?? "")
      : "";
  if (constraint.includes("spatial_structures_pkey")) {
    return { status: 409, message: "That spatial structure already exists." };
  }
  return {
    status: 500,
    message: fallback,
  };
};
