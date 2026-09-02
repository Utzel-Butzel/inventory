import "server-only";

import { eq, sql } from "drizzle-orm";

import { media, roomScanAssets, roomScanKeyframes } from "@/db/schema";
import { db } from "@/lib/db";

export type StorageUsageGroup = {
  bytes: number;
  fileCount: number;
};

export type OrganizationStorageUsage = {
  total: StorageUsageGroup;
  inventoryMedia: StorageUsageGroup;
  roomScanAssets: StorageUsageGroup;
  roomScanKeyframes: StorageUsageGroup;
};

const normalizeUsage = (row?: { bytes: string; fileCount: number }) => ({
  bytes: Number(row?.bytes ?? 0),
  fileCount: row?.fileCount ?? 0,
});

export async function getOrganizationStorageUsage(
  organizationId: string,
): Promise<OrganizationStorageUsage> {
  const [mediaRows, assetRows, keyframeRows] = await Promise.all([
    db
      .select({
        bytes: sql<string>`coalesce(sum(${media.size}), 0)::text`,
        fileCount: sql<number>`count(*)::int`,
      })
      .from(media)
      .where(eq(media.organizationId, organizationId)),
    db
      .select({
        bytes: sql<string>`coalesce(sum(${roomScanAssets.size}), 0)::text`,
        fileCount: sql<number>`count(*)::int`,
      })
      .from(roomScanAssets)
      .where(eq(roomScanAssets.organizationId, organizationId)),
    db
      .select({
        bytes: sql<string>`coalesce(sum(${roomScanKeyframes.size}), 0)::text`,
        fileCount: sql<number>`count(*)::int`,
      })
      .from(roomScanKeyframes)
      .where(eq(roomScanKeyframes.organizationId, organizationId)),
  ]);

  const inventoryMedia = normalizeUsage(mediaRows[0]);
  const roomScanAssetsUsage = normalizeUsage(assetRows[0]);
  const roomScanKeyframesUsage = normalizeUsage(keyframeRows[0]);

  return {
    total: {
      bytes:
        inventoryMedia.bytes +
        roomScanAssetsUsage.bytes +
        roomScanKeyframesUsage.bytes,
      fileCount:
        inventoryMedia.fileCount +
        roomScanAssetsUsage.fileCount +
        roomScanKeyframesUsage.fileCount,
    },
    inventoryMedia,
    roomScanAssets: roomScanAssetsUsage,
    roomScanKeyframes: roomScanKeyframesUsage,
  };
}
