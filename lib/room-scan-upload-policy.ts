import type { RoomScanAssetKind } from "@/db/schema";

export const roomScanAssetMimeTypes = {
  world_map: "application/vnd.apple.arkit.world-map",
  model_usdz: "model/vnd.usdz+zip",
  guide_image: "image/jpeg",
} as const satisfies Record<RoomScanAssetKind, string>;

export const roomScanAssetMimeType = (kind: RoomScanAssetKind) =>
  roomScanAssetMimeTypes[kind];

export const roomScanAssetContentDisposition = (name: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

export const roomScanWriteReceipt = (id: string, replayed: boolean) => ({
  id,
  replayed,
});

type ExistingRoomScan = {
  id: string;
  roomResourceId: string;
};

export async function reconcileFailedRoomScanCreation(options: {
  scanId: string;
  roomResourceId: string;
  findScan: (scanId: string) => Promise<ExistingRoomScan | null>;
  cleanupUncommittedAssets: () => Promise<void>;
}) {
  let existing: ExistingRoomScan | null;
  try {
    existing = await options.findScan(options.scanId);
  } catch {
    // A failed COMMIT acknowledgement is ambiguous. If the follow-up read also
    // fails, preserving possible committed assets is safer than corrupting a
    // successfully committed scan. Unreferenced files can be reaped later.
    return { kind: "unknown" } as const;
  }

  if (existing?.roomResourceId === options.roomResourceId) {
    return { kind: "committed", scanId: existing.id } as const;
  }

  await options.cleanupUncommittedAssets();
  return { kind: "not-committed" } as const;
}
