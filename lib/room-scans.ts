import "server-only";

import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import {
  media,
  resources,
  resourceSpatialPlacements,
  roomScanAssets,
  roomScans,
  type RoomScanAssetKind,
} from "@/db/schema";
import { db } from "@/lib/db";
import type {
  RoomScene,
  SpatialPlacementInput,
} from "@/lib/room-scene-contract";
import type { StoredBinaryAsset } from "@/lib/storage";

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

export async function listRoomScans(options: { activeOnly?: boolean } = {}) {
  const activeOnly = options.activeOnly ?? true;
  const rows = await db
    .select({ scan: roomScans, room: resources })
    .from(roomScans)
    .innerJoin(resources, eq(resources.id, roomScans.roomResourceId))
    .where(activeOnly ? eq(roomScans.status, "active") : undefined)
    .orderBy(desc(roomScans.capturedAt));

  if (!rows.length) return { scans: [] };
  const scanIds = rows.map(({ scan }) => scan.id);
  const [assetRows, placementCounts] = await Promise.all([
    db
      .select()
      .from(roomScanAssets)
      .where(inArray(roomScanAssets.roomScanId, scanIds))
      .orderBy(asc(roomScanAssets.kind)),
    db
      .select({ roomScanId: resourceSpatialPlacements.roomScanId, value: count() })
      .from(resourceSpatialPlacements)
      .where(inArray(resourceSpatialPlacements.roomScanId, scanIds))
      .groupBy(resourceSpatialPlacements.roomScanId),
  ]);

  return {
    scans: rows.map(({ scan, room }) => ({
      id: scan.id,
      roomResourceId: room.id,
      roomName: room.name,
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
    })),
  };
}

export async function getRoomScene(scanId: string) {
  const [row] = await db
    .select({ scan: roomScans, room: resources })
    .from(roomScans)
    .innerJoin(resources, eq(resources.id, roomScans.roomResourceId))
    .where(eq(roomScans.id, scanId))
    .limit(1);
  if (!row) return null;

  const [assetRows, placementRows] = await Promise.all([
    db
      .select()
      .from(roomScanAssets)
      .where(eq(roomScanAssets.roomScanId, scanId))
      .orderBy(asc(roomScanAssets.kind)),
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
    scan: {
      id: row.scan.id,
      revision: row.scan.revision,
      status: row.scan.status,
      scene: row.scan.scene,
      capturedAt: row.scan.capturedAt,
      deviceModel: row.scan.deviceModel,
      assets: assetRows.map(serializeAsset),
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

export async function findRoomScan(scanId: string) {
  const [scan] = await db
    .select()
    .from(roomScans)
    .where(eq(roomScans.id, scanId))
    .limit(1);
  return scan ?? null;
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
}) {
  const existing = await findRoomScan(options.id);
  if (existing) {
    if (existing.roomResourceId !== options.roomResourceId) {
      throw new Error("That scan identifier belongs to another room.");
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
        id: roomScans.id,
        roomResourceId: roomScans.roomResourceId,
      })
      .from(roomScans)
      .where(eq(roomScans.id, options.id))
      .limit(1);
    if (lockedExisting) {
      if (lockedExisting.roomResourceId !== options.roomResourceId) {
        throw new Error("That scan identifier belongs to another room.");
      }
      return { kind: "existing", scanId: lockedExisting.id } as const;
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
