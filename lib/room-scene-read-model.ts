import type {
  media,
  resources,
  resourceSpatialPlacements,
  roomScanAssets,
  roomScanKeyframes,
  roomScans,
  spatialCoordinateSpaces,
  spatialStructures,
} from "@/db/schema";

type RoomScanRow = typeof roomScans.$inferSelect;
type ResourceRow = typeof resources.$inferSelect;
type StructureRow = typeof spatialStructures.$inferSelect;
type CoordinateSpaceRow = typeof spatialCoordinateSpaces.$inferSelect;
type RoomScanAssetRow = typeof roomScanAssets.$inferSelect;
type RoomScanKeyframeRow = typeof roomScanKeyframes.$inferSelect;
type PlacementRow = typeof resourceSpatialPlacements.$inferSelect;
type MediaRow = typeof media.$inferSelect;

export type RoomSceneReadRow = {
  scan: RoomScanRow;
  room: ResourceRow;
  structure: StructureRow | null;
  coordinateSpace: CoordinateSpaceRow | null;
};

export type RoomScenePlacementReadRow = {
  placement: PlacementRow;
  resource: ResourceRow;
};

const appendByKey = <T>(index: Map<string, T[]>, key: string, value: T) => {
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
};

export const serializeRoomScanAsset = (asset: RoomScanAssetRow) => ({
  id: asset.id,
  kind: asset.kind,
  name: asset.name,
  mimeType: asset.mimeType,
  size: asset.size,
  checksumSha256: asset.checksumSha256,
  url: `/api/v1/room-scans/${encodeURIComponent(asset.roomScanId)}/assets/${asset.kind}`,
  createdAt: asset.createdAt,
});

export const serializeRoomScanKeyframe = (frame: RoomScanKeyframeRow) => ({
  id: frame.id,
  capturedAt: frame.capturedAt,
  timestamp: frame.frameTimestamp,
  cameraTransform: frame.cameraTransform,
  intrinsics: frame.intrinsics,
  width: frame.imageWidth,
  height: frame.imageHeight,
  orientation: frame.orientation,
  quality: frame.quality,
  mimeType: frame.mimeType,
  size: frame.size,
  checksumSha256: frame.checksumSha256,
  url: `/api/v1/room-scans/${encodeURIComponent(frame.roomScanId)}/keyframes/${encodeURIComponent(frame.id)}`,
});

/**
 * Builds room-scene manifests from rows fetched in batches. The indexes keep
 * assets and placements isolated by scan without repeating a query (or a full
 * array scan) for every room in a structure.
 */
export function assembleRoomSceneManifests(
  rows: readonly RoomSceneReadRow[],
  assetRows: readonly RoomScanAssetRow[],
  keyframeRows: readonly RoomScanKeyframeRow[],
  placementRows: readonly RoomScenePlacementReadRow[],
  coverRows: readonly MediaRow[],
) {
  const assetsByScan = new Map<string, RoomScanAssetRow[]>();
  for (const asset of assetRows) {
    appendByKey(assetsByScan, asset.roomScanId, asset);
  }

  const placementsByScan = new Map<string, RoomScenePlacementReadRow[]>();
  for (const placement of placementRows) {
    appendByKey(
      placementsByScan,
      placement.placement.roomScanId,
      placement,
    );
  }

  const keyframesByScan = new Map<string, RoomScanKeyframeRow[]>();
  for (const keyframe of keyframeRows) {
    appendByKey(keyframesByScan, keyframe.roomScanId, keyframe);
  }

  // coverRows are ordered by media position by the caller. Preserve the first
  // image per resource, matching the single-room read behavior.
  const coverByResource = new Map<string, MediaRow>();
  for (const cover of coverRows) {
    if (!coverByResource.has(cover.resourceId)) {
      coverByResource.set(cover.resourceId, cover);
    }
  }

  return rows.map(({ scan, room, structure, coordinateSpace }) => ({
    room: {
      id: room.id,
      name: room.name,
      description: room.description,
    },
    structureId: scan.structureId,
    structureName: structure?.name ?? null,
    coordinateSpaceId: scan.coordinateSpaceId,
    floorIdentifier: scan.floorIdentifier,
    floorIndex: scan.floorIndex,
    roomIdentifier: scan.roomIdentifier,
    georeference: coordinateSpace?.georeference ?? null,
    scan: {
      id: scan.id,
      structureId: scan.structureId,
      structureName: structure?.name ?? null,
      coordinateSpaceId: scan.coordinateSpaceId,
      floorIdentifier: scan.floorIdentifier,
      floorIndex: scan.floorIndex,
      roomIdentifier: scan.roomIdentifier,
      georeference: coordinateSpace?.georeference ?? null,
      layoutTransform: scan.layoutTransform,
      revision: scan.revision,
      status: scan.status,
      scene: scan.scene,
      capturedAt: scan.capturedAt,
      deviceModel: scan.deviceModel,
      assets: (assetsByScan.get(scan.id) ?? []).map(serializeRoomScanAsset),
      keyframes: (keyframesByScan.get(scan.id) ?? []).map(
        serializeRoomScanKeyframe,
      ),
    },
    placements: (placementsByScan.get(scan.id) ?? []).map(
      ({ placement, resource }) => {
        const cover = coverByResource.get(resource.id) ?? null;
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
      },
    ),
  }));
}
