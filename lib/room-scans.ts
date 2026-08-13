import "server-only";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import {
  media,
  resources,
  resourceSpatialPlacements,
  roomScanAssets,
  roomScanKeyframes,
  roomScans,
  spatialCoordinateSpaces,
  spatialStructures,
  type RoomScanAssetKind,
} from "@/db/schema";
import { db } from "@/lib/db";
import type {
  RoomScene,
  SpatialPlacementInput,
} from "@/lib/room-scene-contract";
import type { RoomKeyframeInput } from "@/lib/room-keyframe-contract";
import { spatialMatricesApproximatelyEqual } from "@/lib/room-scene-contract";
import {
  RoomScanSpatialConflictError,
  roomScanMatchesReplayIdentity,
  roomScanWorldMapChecksumMatches,
  type ExistingRoomScanReplayIdentity,
  type RoomScanReplayRequest,
} from "@/lib/room-scan-upload-policy";
import type { StoredBinaryAsset } from "@/lib/storage";
import {
  spatialGeoreferenceFramesApproximatelyEqual,
  type RoomScanSpatialMetadata,
} from "@/lib/spatial-structure-contract";

const assetUrl = (scanId: string, kind: RoomScanAssetKind) =>
  `/api/v1/room-scans/${encodeURIComponent(scanId)}/assets/${kind}`;

const serializeAsset = (asset: typeof roomScanAssets.$inferSelect) => ({
  id: asset.id,
  kind: asset.kind,
  name: asset.name,
  mimeType: asset.mimeType,
  size: asset.size,
  checksumSha256: asset.checksumSha256,
  url: assetUrl(asset.roomScanId, asset.kind),
  createdAt: asset.createdAt,
});

const keyframeUrl = (scanId: string, keyframeId: string) =>
  `/api/v1/room-scans/${encodeURIComponent(scanId)}/keyframes/${encodeURIComponent(keyframeId)}`;

const serializeKeyframe = (frame: typeof roomScanKeyframes.$inferSelect) => ({
  id: frame.id,
  capturedAt: frame.capturedAt,
  timestamp: frame.frameTimestamp,
  cameraTransform: frame.cameraTransform,
  intrinsics: frame.intrinsics,
  width: frame.imageWidth,
  height: frame.imageHeight,
  orientation: frame.orientation,
  quality: frame.quality,
  featureDescriptor: frame.featureDescriptor,
  mimeType: frame.mimeType,
  size: frame.size,
  checksumSha256: frame.checksumSha256,
  url: keyframeUrl(frame.roomScanId, frame.id),
});

export async function listRoomScans(options: { activeOnly?: boolean } = {}) {
  const activeOnly = options.activeOnly ?? true;
  const rows = await db
    .select({
      scan: roomScans,
      room: resources,
      structure: spatialStructures,
      coordinateSpace: spatialCoordinateSpaces,
    })
    .from(roomScans)
    .innerJoin(resources, eq(resources.id, roomScans.roomResourceId))
    .leftJoin(spatialStructures, eq(spatialStructures.id, roomScans.structureId))
    .leftJoin(
      spatialCoordinateSpaces,
      eq(spatialCoordinateSpaces.id, roomScans.coordinateSpaceId),
    )
    .where(activeOnly ? eq(roomScans.status, "active") : undefined)
    .orderBy(desc(roomScans.capturedAt));

  if (!rows.length) return { scans: [] };
  const scanIds = rows.map(({ scan }) => scan.id);
  const [assetRows, keyframeRows, placementCounts] = await Promise.all([
    db
      .select()
      .from(roomScanAssets)
      .where(inArray(roomScanAssets.roomScanId, scanIds))
      .orderBy(asc(roomScanAssets.kind)),
    db
      .select()
      .from(roomScanKeyframes)
      .where(inArray(roomScanKeyframes.roomScanId, scanIds))
      .orderBy(asc(roomScanKeyframes.frameTimestamp)),
    db
      .select({ roomScanId: resourceSpatialPlacements.roomScanId, value: count() })
      .from(resourceSpatialPlacements)
      .where(inArray(resourceSpatialPlacements.roomScanId, scanIds))
      .groupBy(resourceSpatialPlacements.roomScanId),
  ]);

  return {
    scans: rows.map(({ scan, room, structure, coordinateSpace }) => ({
      id: scan.id,
      roomResourceId: room.id,
      roomName: room.name,
      structureId: scan.structureId,
      structureName: structure?.name ?? null,
      coordinateSpaceId: scan.coordinateSpaceId,
      floorIdentifier: scan.floorIdentifier,
      floorIndex: scan.floorIndex,
      roomIdentifier: scan.roomIdentifier,
      georeference: coordinateSpace?.georeference ?? null,
      revision: scan.revision,
      status: scan.status,
      capturedAt: scan.capturedAt,
      deviceModel: scan.deviceModel,
      createdAt: scan.createdAt,
      updatedAt: scan.updatedAt,
      placementCount:
        placementCounts.find((item) => item.roomScanId === scan.id)?.value ?? 0,
      assets: assetRows
        .filter((asset) => asset.roomScanId === scan.id)
        .map(serializeAsset),
      keyframes: keyframeRows
        .filter((frame) => frame.roomScanId === scan.id)
        .map(serializeKeyframe),
    })),
  };
}

export async function getRoomScene(scanId: string) {
  const [row] = await db
    .select({
      scan: roomScans,
      room: resources,
      structure: spatialStructures,
      coordinateSpace: spatialCoordinateSpaces,
    })
    .from(roomScans)
    .innerJoin(resources, eq(resources.id, roomScans.roomResourceId))
    .leftJoin(spatialStructures, eq(spatialStructures.id, roomScans.structureId))
    .leftJoin(
      spatialCoordinateSpaces,
      eq(spatialCoordinateSpaces.id, roomScans.coordinateSpaceId),
    )
    .where(eq(roomScans.id, scanId))
    .limit(1);
  if (!row) return null;

  const [assetRows, keyframeRows, placementRows] = await Promise.all([
    db
      .select()
      .from(roomScanAssets)
      .where(eq(roomScanAssets.roomScanId, scanId))
      .orderBy(asc(roomScanAssets.kind)),
    db
      .select()
      .from(roomScanKeyframes)
      .where(eq(roomScanKeyframes.roomScanId, scanId))
      .orderBy(asc(roomScanKeyframes.frameTimestamp)),
    db
      .select({ placement: resourceSpatialPlacements, resource: resources })
      .from(resourceSpatialPlacements)
      .innerJoin(resources, eq(resources.id, resourceSpatialPlacements.resourceId))
      .where(eq(resourceSpatialPlacements.roomScanId, scanId))
      .orderBy(asc(resources.name)),
  ]);

  const resourceIds = placementRows.map(({ resource }) => resource.id);
  const coverRows = resourceIds.length
    ? await db
        .select()
        .from(media)
        .where(and(inArray(media.resourceId, resourceIds), eq(media.kind, "image")))
        .orderBy(asc(media.position))
    : [];

  return {
    room: {
      id: row.room.id,
      name: row.room.name,
      description: row.room.description,
    },
    structureId: row.scan.structureId,
    structureName: row.structure?.name ?? null,
    coordinateSpaceId: row.scan.coordinateSpaceId,
    floorIdentifier: row.scan.floorIdentifier,
    floorIndex: row.scan.floorIndex,
    roomIdentifier: row.scan.roomIdentifier,
    georeference: row.coordinateSpace?.georeference ?? null,
    scan: {
      id: row.scan.id,
      structureId: row.scan.structureId,
      structureName: row.structure?.name ?? null,
      coordinateSpaceId: row.scan.coordinateSpaceId,
      floorIdentifier: row.scan.floorIdentifier,
      floorIndex: row.scan.floorIndex,
      roomIdentifier: row.scan.roomIdentifier,
      georeference: row.coordinateSpace?.georeference ?? null,
      revision: row.scan.revision,
      status: row.scan.status,
      scene: row.scan.scene,
      capturedAt: row.scan.capturedAt,
      deviceModel: row.scan.deviceModel,
      assets: assetRows.map(serializeAsset),
      keyframes: keyframeRows.map(serializeKeyframe),
    },
    placements: placementRows.map(({ placement, resource }) => {
      const cover = coverRows.find((item) => item.resourceId === resource.id) ?? null;
      return {
        id: placement.id,
        resource: {
          id: resource.id,
          name: resource.name,
          description: resource.description,
          type: resource.type,
          status: resource.status,
          location: resource.location,
          cover: cover
            ? {
                id: cover.id,
                url: cover.url,
                altText: cover.altText,
              }
            : null,
        },
        position: [
          placement.positionX,
          placement.positionY,
          placement.positionZ,
        ],
        orientation: [
          placement.quaternionX,
          placement.quaternionY,
          placement.quaternionZ,
          placement.quaternionW,
        ],
        extent:
          placement.extentX === null ||
          placement.extentY === null ||
          placement.extentZ === null
            ? null
            : [placement.extentX, placement.extentY, placement.extentZ],
        confidence: placement.confidence,
        method: placement.method,
        anchorIdentifier: placement.anchorIdentifier,
        localizationEvidence: placement.localizationEvidence,
        capturedAt: placement.capturedAt,
        updatedAt: placement.updatedAt,
      };
    }),
  };
}

export async function getRoomScanAsset(
  scanId: string,
  kind: RoomScanAssetKind,
) {
  const [asset] = await db
    .select()
    .from(roomScanAssets)
    .where(
      and(eq(roomScanAssets.roomScanId, scanId), eq(roomScanAssets.kind, kind)),
    )
    .limit(1);
  return asset ?? null;
}

export async function replaceRoomScanAsset(options: {
  scanId: string;
  kind: "textured_mesh" | "gaussian_splat";
  stored: StoredBinaryAsset;
}) {
  return db.transaction(async (transaction) => {
    const locked = await transaction.execute(
      sql`select ${roomScans.id} from ${roomScans} where ${roomScans.id} = ${options.scanId} for update`,
    );
    if (locked.length === 0) return { kind: "scan-not-found" } as const;

    const [previous] = await transaction
      .select()
      .from(roomScanAssets)
      .where(
        and(
          eq(roomScanAssets.roomScanId, options.scanId),
          eq(roomScanAssets.kind, options.kind),
        ),
      )
      .limit(1);
    const [asset] = await transaction
      .insert(roomScanAssets)
      .values({
        roomScanId: options.scanId,
        kind: options.kind,
        storageKey: options.stored.storageKey,
        storageUrl: options.stored.url,
        name: options.stored.name,
        mimeType: options.stored.mimeType,
        size: options.stored.size,
        checksumSha256: options.stored.checksumSha256,
      })
      .onConflictDoUpdate({
        target: [roomScanAssets.roomScanId, roomScanAssets.kind],
        set: {
          storageKey: options.stored.storageKey,
          storageUrl: options.stored.url,
          name: options.stored.name,
          mimeType: options.stored.mimeType,
          size: options.stored.size,
          checksumSha256: options.stored.checksumSha256,
          createdAt: new Date(),
        },
      })
      .returning();
    return { kind: "ok", asset, previous: previous ?? null } as const;
  });
}

export async function getRoomScanKeyframe(scanId: string, keyframeId: string) {
  const [frame] = await db
    .select()
    .from(roomScanKeyframes)
    .where(
      and(
        eq(roomScanKeyframes.roomScanId, scanId),
        eq(roomScanKeyframes.id, keyframeId),
      ),
    )
    .limit(1);
  return frame ?? null;
}

export async function findRoomScan(scanId: string) {
  const [scan] = await db
    .select()
    .from(roomScans)
    .where(eq(roomScans.id, scanId))
    .limit(1);
  return scan ?? null;
}

export async function findRoomScanReplayIdentity(
  scanId: string,
): Promise<ExistingRoomScanReplayIdentity | null> {
  const [row] = await db
    .select({
      scan: roomScans,
      coordinateSpaceGeoreference: spatialCoordinateSpaces.georeference,
    })
    .from(roomScans)
    .leftJoin(
      spatialCoordinateSpaces,
      eq(spatialCoordinateSpaces.id, roomScans.coordinateSpaceId),
    )
    .where(eq(roomScans.id, scanId))
    .limit(1);
  if (!row) return null;
  const [assets, keyframes] = await Promise.all([
    db
      .select({
        kind: roomScanAssets.kind,
        checksumSha256: roomScanAssets.checksumSha256,
      })
      .from(roomScanAssets)
      .where(eq(roomScanAssets.roomScanId, scanId)),
    db
      .select()
      .from(roomScanKeyframes)
      .where(eq(roomScanKeyframes.roomScanId, scanId)),
  ]);
  return {
    ...row.scan,
    coordinateSpaceGeoreference: row.coordinateSpaceGeoreference ?? null,
    assets,
    keyframes: keyframes.map((frame) => ({
      id: frame.id,
      capturedAt: frame.capturedAt,
      timestamp: frame.frameTimestamp,
      cameraTransform: frame.cameraTransform,
      intrinsics: frame.intrinsics,
      width: frame.imageWidth,
      height: frame.imageHeight,
      orientation: frame.orientation as RoomKeyframeInput["orientation"],
      quality: frame.quality,
      featureDescriptor: frame.featureDescriptor,
      checksumSha256: frame.checksumSha256,
    })),
  };
}

export async function createRoomScan(options: {
  id: string;
  roomResourceId: string;
  scene: RoomScene;
  capturedAt: Date;
  deviceModel?: string;
  actor: string;
  assets: Array<{
    kind: RoomScanAssetKind;
    stored: StoredBinaryAsset;
  }>;
  keyframes?: Array<{
    metadata: RoomKeyframeInput;
    stored: StoredBinaryAsset;
  }>;
  spatial?: RoomScanSpatialMetadata;
}) {
  const replayRequest: RoomScanReplayRequest = {
    roomResourceId: options.roomResourceId,
    scene: options.scene,
    capturedAt: options.capturedAt,
    deviceModel: options.deviceModel,
    spatial: options.spatial,
    assets: options.assets.map(({ kind, stored }) => ({
      kind,
      checksumSha256: stored.checksumSha256,
    })),
    keyframes: (options.keyframes ?? []).map(({ metadata, stored }) => ({
      id: metadata.id,
      capturedAt: new Date(metadata.capturedAt),
      timestamp: metadata.timestamp,
      cameraTransform: metadata.cameraTransform,
      intrinsics: metadata.intrinsics,
      width: metadata.width,
      height: metadata.height,
      orientation: metadata.orientation,
      quality: metadata.quality,
      featureDescriptor: metadata.featureDescriptor,
      checksumSha256: stored.checksumSha256,
    })),
  };
  const existing = await findRoomScanReplayIdentity(options.id);
  if (existing) {
    if (!roomScanMatchesReplayIdentity(existing, replayRequest)) {
      throw new Error("That scan identifier belongs to a different upload payload.");
    }
    return { kind: "existing", scanId: existing.id } as const;
  }

  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select ${resources.id} from ${resources} where ${resources.id} = ${options.roomResourceId} for update`,
    );
    // The first idempotency check happens before files are stored. Repeat it
    // under the room lock so two simultaneous uploads for the same scan do not
    // race into a duplicate insert and leave the loser's files orphaned.
    const [lockedExisting] = await transaction
      .select({
        scan: roomScans,
        coordinateSpaceGeoreference: spatialCoordinateSpaces.georeference,
      })
      .from(roomScans)
      .leftJoin(
        spatialCoordinateSpaces,
        eq(spatialCoordinateSpaces.id, roomScans.coordinateSpaceId),
      )
      .where(eq(roomScans.id, options.id))
      .limit(1);
    if (lockedExisting) {
      const [existingAssets, existingKeyframes] = await Promise.all([
        transaction
          .select({
            kind: roomScanAssets.kind,
            checksumSha256: roomScanAssets.checksumSha256,
          })
          .from(roomScanAssets)
          .where(eq(roomScanAssets.roomScanId, options.id)),
        transaction
          .select()
          .from(roomScanKeyframes)
          .where(eq(roomScanKeyframes.roomScanId, options.id)),
      ]);
      if (
        !roomScanMatchesReplayIdentity(
          {
            ...lockedExisting.scan,
            coordinateSpaceGeoreference:
              lockedExisting.coordinateSpaceGeoreference ?? null,
            assets: existingAssets,
            keyframes: existingKeyframes.map((frame) => ({
              id: frame.id,
              capturedAt: frame.capturedAt,
              timestamp: frame.frameTimestamp,
              cameraTransform: frame.cameraTransform,
              intrinsics: frame.intrinsics,
              width: frame.imageWidth,
              height: frame.imageHeight,
              orientation: frame.orientation as RoomKeyframeInput["orientation"],
              quality: frame.quality,
              featureDescriptor: frame.featureDescriptor,
              checksumSha256: frame.checksumSha256,
            })),
          },
          replayRequest,
        )
      ) {
        throw new Error("That scan identifier belongs to a different upload payload.");
      }
      return { kind: "existing", scanId: lockedExisting.scan.id } as const;
    }

    const [room] = await transaction
      .select()
      .from(resources)
      .where(eq(resources.id, options.roomResourceId))
      .limit(1);
    if (!room) throw new Error("Room resource not found.");
    if (room.type !== "place") {
      throw new Error("Room scans can only be attached to place resources.");
    }

    let structureId: string | null = null;
    let coordinateSpaceId: string | null = null;
    if (options.spatial?.structureId) {
      structureId = options.spatial.structureId;
      let [existingStructure] = await transaction
        .select()
        .from(spatialStructures)
        .where(eq(spatialStructures.id, structureId))
        .limit(1);
      if (!existingStructure) {
        await transaction
          .insert(spatialStructures)
          .values({
            id: structureId,
            name: options.spatial.structureName ?? "Untitled structure",
            georeference: options.spatial.georeference ?? null,
            createdBy: options.actor,
            updatedBy: options.actor,
          })
          .onConflictDoNothing({ target: spatialStructures.id });
        [existingStructure] = await transaction
          .select()
          .from(spatialStructures)
          .where(eq(spatialStructures.id, structureId))
          .limit(1);
      }
      if (!existingStructure) {
        throw new Error("Unable to resolve the spatial structure.");
      }
      if (!existingStructure.georeference && options.spatial.georeference) {
        await transaction
          .update(spatialStructures)
          .set({
            georeference: options.spatial.georeference,
            updatedBy: options.actor,
            updatedAt: new Date(),
          })
          .where(eq(spatialStructures.id, structureId));
      }

      // A grouped upload without an explicit coordinate-space id is isolated
      // to this scan. That is safer than assuming separately captured rooms
      // share an AR origin and rotation.
      coordinateSpaceId = options.spatial.coordinateSpaceId ?? options.id;
      let [existingSpace] = await transaction
        .select()
        .from(spatialCoordinateSpaces)
        .where(eq(spatialCoordinateSpaces.id, coordinateSpaceId))
        .limit(1);
      if (!existingSpace) {
        await transaction
          .insert(spatialCoordinateSpaces)
          .values({
            id: coordinateSpaceId,
            structureId,
            georeference: options.spatial.georeference ?? null,
            createdBy: options.actor,
            updatedBy: options.actor,
          })
          .onConflictDoNothing({ target: spatialCoordinateSpaces.id });
        [existingSpace] = await transaction
          .select()
          .from(spatialCoordinateSpaces)
          .where(eq(spatialCoordinateSpaces.id, coordinateSpaceId))
          .limit(1);
        if (!existingSpace) {
          throw new Error("Unable to resolve the coordinate space.");
        }
      }
      // Serialize grouped uploads through the coordinate-space row. The web
      // viewer and map both rely on one immutable frame definition for every
      // room in a shared AR coordinate space.
      await transaction.execute(
        sql`select ${spatialCoordinateSpaces.id} from ${spatialCoordinateSpaces} where ${spatialCoordinateSpaces.id} = ${coordinateSpaceId} for update`,
      );
      [existingSpace] = await transaction
        .select()
        .from(spatialCoordinateSpaces)
        .where(eq(spatialCoordinateSpaces.id, coordinateSpaceId))
        .limit(1);
      if (!existingSpace) {
        throw new Error("Unable to resolve the coordinate space.");
      }
      if (existingSpace.structureId !== structureId) {
        throw new Error("That coordinate space belongs to another structure.");
      }
      if (
        existingSpace.georeference &&
        options.spatial.georeference &&
        !spatialGeoreferenceFramesApproximatelyEqual(
          existingSpace.georeference,
          options.spatial.georeference,
        )
      ) {
        throw new RoomScanSpatialConflictError(
          "georeference",
          "That coordinate space already has a different georeference.",
        );
      }
      if (!existingSpace.georeference && options.spatial.georeference) {
        await transaction
          .update(spatialCoordinateSpaces)
          .set({
            georeference: options.spatial.georeference,
            updatedBy: options.actor,
            updatedAt: new Date(),
          })
          .where(eq(spatialCoordinateSpaces.id, coordinateSpaceId));
      }

      const [existingCoordinateScene] = await transaction
        .select({ scene: roomScans.scene })
        .from(roomScans)
        .where(eq(roomScans.coordinateSpaceId, coordinateSpaceId))
        .limit(1);
      if (
        existingCoordinateScene &&
        !spatialMatricesApproximatelyEqual(
          existingCoordinateScene.scene.webFromWorld,
          options.scene.webFromWorld,
        )
      ) {
        throw new RoomScanSpatialConflictError(
          "web-from-world",
          "That coordinate space already has a different webFromWorld transform.",
        );
      }

      // A coordinate-space id identifies one archived ARWorldMap snapshot.
      // The current iOS batch deliberately uploads byte-identical map data for
      // every room in that snapshot, giving the server a stronger frame guard
      // than today's identity webFromWorld matrix alone.
      const incomingWorldMap = options.assets.find(
        ({ kind }) => kind === "world_map",
      );
      const [existingWorldMap] = await transaction
        .select({ checksumSha256: roomScanAssets.checksumSha256 })
        .from(roomScanAssets)
        .innerJoin(roomScans, eq(roomScans.id, roomScanAssets.roomScanId))
        .where(
          and(
            eq(roomScans.coordinateSpaceId, coordinateSpaceId),
            eq(roomScanAssets.kind, "world_map"),
          ),
        )
        .limit(1);
      if (
        !roomScanWorldMapChecksumMatches(
          existingWorldMap?.checksumSha256,
          incomingWorldMap?.stored.checksumSha256,
        )
      ) {
        throw new RoomScanSpatialConflictError(
          "world-map",
          "That coordinate space already has a different ARWorldMap snapshot.",
        );
      }
    }

    const [{ highestRevision }] = await transaction
      .select({
        highestRevision: sql<number>`coalesce(max(${roomScans.revision}), 0)::int`,
      })
      .from(roomScans)
      .where(eq(roomScans.roomResourceId, room.id));
    const revision = Number(highestRevision ?? 0) + 1;

    await transaction
      .update(roomScans)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(
        and(
          eq(roomScans.roomResourceId, room.id),
          eq(roomScans.status, "active"),
        ),
      );
    await transaction.insert(roomScans).values({
      id: options.id,
      roomResourceId: room.id,
      structureId,
      coordinateSpaceId,
      floorIdentifier: options.spatial?.floorIdentifier,
      floorIndex: options.spatial?.floorIndex,
      roomIdentifier: options.spatial?.roomIdentifier,
      revision,
      status: "active",
      scene: options.scene,
      capturedAt: options.capturedAt,
      deviceModel: options.deviceModel,
      createdBy: options.actor,
    });
    if (options.assets.length) {
      await transaction.insert(roomScanAssets).values(
        options.assets.map(({ kind, stored }) => ({
          roomScanId: options.id,
          kind,
          storageKey: stored.storageKey,
          storageUrl: stored.url,
          name: stored.name,
          mimeType: stored.mimeType,
          size: stored.size,
          checksumSha256: stored.checksumSha256,
        })),
      );
    }
    if (options.keyframes?.length) {
      await transaction.insert(roomScanKeyframes).values(
        options.keyframes.map(({ metadata, stored }) => ({
          id: metadata.id,
          roomScanId: options.id,
          capturedAt: new Date(metadata.capturedAt),
          frameTimestamp: metadata.timestamp,
          cameraTransform: metadata.cameraTransform,
          intrinsics: metadata.intrinsics,
          imageWidth: metadata.width,
          imageHeight: metadata.height,
          orientation: metadata.orientation,
          quality: metadata.quality,
          featureDescriptor: metadata.featureDescriptor ?? null,
          storageKey: stored.storageKey,
          storageUrl: stored.url,
          name: stored.name,
          mimeType: stored.mimeType,
          size: stored.size,
          checksumSha256: stored.checksumSha256,
        })),
      );
    }
    return { kind: "created", scanId: options.id } as const;
  });
}

export async function upsertSpatialPlacement(options: {
  scanId: string;
  resourceId: string;
  placement: SpatialPlacementInput;
  actor: string;
}) {
  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(roomScans)
      .where(eq(roomScans.id, options.scanId))
      .limit(1);
    if (!candidate) return { kind: "scan-not-found" } as const;

    // Room scans and placements take the same resource-row lock. A rescan can
    // therefore never supersede a scan between the active check and the upsert.
    await transaction.execute(
      sql`select ${resources.id} from ${resources} where ${resources.id} = ${candidate.roomResourceId} for update`,
    );
    const [scan] = await transaction
      .select()
      .from(roomScans)
      .where(eq(roomScans.id, options.scanId))
      .limit(1);
    if (!scan) return { kind: "scan-not-found" } as const;
    if (scan.status !== "active") return { kind: "scan-superseded" } as const;

    const [resource] = await transaction
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.id, options.resourceId))
      .limit(1);
    if (!resource) return { kind: "resource-not-found" } as const;

    if (options.placement.localizationEvidence) {
      const [matchedFrame] = await transaction
        .select({ id: roomScanKeyframes.id })
        .from(roomScanKeyframes)
        .where(
          and(
            eq(
              roomScanKeyframes.id,
              options.placement.localizationEvidence.matchedKeyframeId,
            ),
            eq(roomScanKeyframes.roomScanId, scan.id),
          ),
        )
        .limit(1);
      if (!matchedFrame) return { kind: "keyframe-not-found" } as const;
    }

    const [x, y, zValue] = options.placement.position;
    const [qx, qy, qz, qw] = options.placement.orientation;
    const [extentX, extentY, extentZ] = options.placement.extent ?? [null, null, null];
    const values = {
      resourceId: resource.id,
      roomScanId: scan.id,
      positionX: x,
      positionY: y,
      positionZ: zValue,
      quaternionX: qx,
      quaternionY: qy,
      quaternionZ: qz,
      quaternionW: qw,
      extentX,
      extentY,
      extentZ,
      confidence: options.placement.confidence,
      method: options.placement.method,
      anchorIdentifier: options.placement.anchorIdentifier,
      localizationEvidence: options.placement.localizationEvidence,
      capturedAt: new Date(options.placement.capturedAt),
      updatedBy: options.actor,
      updatedAt: new Date(),
    };

    const [placement] = await transaction
      .insert(resourceSpatialPlacements)
      .values(values)
      .onConflictDoUpdate({
        target: resourceSpatialPlacements.resourceId,
        set: values,
      })
      .returning();
    return { kind: "ok", placement } as const;
  });
}

export async function deleteSpatialPlacement(resourceId: string, scanId: string) {
  const [deleted] = await db
    .delete(resourceSpatialPlacements)
    .where(
      and(
        eq(resourceSpatialPlacements.resourceId, resourceId),
        eq(resourceSpatialPlacements.roomScanId, scanId),
      ),
    )
    .returning();
  return deleted ?? null;
}
