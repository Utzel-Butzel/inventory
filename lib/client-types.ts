import type {
  ApiTokenRecord,
  MediaRecord,
  ResourceRecord,
} from "@/db/schema";
import type {
  RoomScene,
  SpatialQuaternion,
  SpatialVector3,
} from "@/lib/room-scene-contract";
import type { SpatialGeoreference } from "@/lib/spatial-georeference";

export type ClientMedia = Omit<MediaRecord, "createdAt"> & {
  createdAt: string;
};

export type ClientResource = Omit<
  ResourceRecord,
  "createdAt" | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
  media: ClientMedia[];
  cover: ClientMedia | null;
};

export type ClientContentLanguage = {
  code: string;
  label: string;
  isDefault: boolean;
  autoTranslate: boolean;
};

export type ClientResourceLocalization = {
  languageCode: string;
  defaultLanguageCode: string;
  isDefault: boolean;
  translatedFields: string[];
  fallbackFields: string[];
  availableLanguages: ClientContentLanguage[];
};

export type ClientApiToken = Omit<
  ApiTokenRecord,
  "tokenHash" | "revokedAt" | "createdAt" | "expiresAt" | "lastUsedAt"
> & {
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export type ClientRoomScanAsset = {
  id: string;
  kind: "world_map" | "model_usdz" | "structure_model" | "guide_image";
  name: string;
  mimeType: string;
  size: number;
  checksumSha256: string;
  url: string;
  createdAt: string;
};

export type ClientRoomScanSummary = {
  id: string;
  roomResourceId: string;
  roomName: string;
  revision: number;
  status: "active" | "superseded";
  capturedAt: string;
  deviceModel: string | null;
  createdAt: string;
  updatedAt: string;
  placementCount: number;
  assets: ClientRoomScanAsset[];
  structureId?: string | null;
  structureName?: string | null;
  floorIdentifier?: string | null;
  floorIndex?: number | null;
  roomIdentifier?: string | null;
  coordinateSpaceId?: string | null;
  georeference?: SpatialGeoreference | null;
};

export type ClientRoomPlacement = {
  id: string;
  resource: {
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
    location: string | null;
    cover: { id: string; url: string; altText: string } | null;
  };
  position: SpatialVector3;
  orientation: SpatialQuaternion;
  extent: SpatialVector3 | null;
  confidence: number;
  method: "scene-depth" | "mesh-raycast" | "plane-raycast" | "manual";
  anchorIdentifier: string | null;
  capturedAt: string;
  updatedAt: string;
};

export type ClientRoomSceneScan = {
  id: string;
  revision: number;
  status: "active" | "superseded";
  scene: RoomScene;
  capturedAt: string;
  deviceModel: string | null;
  assets: ClientRoomScanAsset[];
  structureId?: string | null;
  structureName?: string | null;
  floorIdentifier?: string | null;
  floorIndex?: number | null;
  roomIdentifier?: string | null;
  coordinateSpaceId?: string | null;
  georeference?: SpatialGeoreference | null;
};

export type ClientRoomSceneManifest = {
  room: { id: string; name: string; description: string };
  scan: ClientRoomSceneScan;
  placements: ClientRoomPlacement[];
  structureId?: string | null;
  structureName?: string | null;
  floorIdentifier?: string | null;
  floorIndex?: number | null;
  roomIdentifier?: string | null;
  coordinateSpaceId?: string | null;
  georeference?: SpatialGeoreference | null;
};

export type ClientSpatialStructureBounds = {
  min: SpatialVector3;
  max: SpatialVector3;
};

export type ClientSpatialStructureSummary = {
  id: string;
  name: string;
  description: string;
  georeference: SpatialGeoreference | null;
  floorCount: number;
  roomCount: number;
  activeScanCount: number;
  coordinateSpaceCount?: number;
  boundsCoordinateSpaceId?: string | null;
  boundsGeoreference?: SpatialGeoreference | null;
  bounds: ClientSpatialStructureBounds | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientSpatialStructureRoom = {
  roomIdentifier: string | null;
  roomResourceId: string;
  roomName: string;
  coordinateSpaceId?: string | null;
  georeference?: SpatialGeoreference | null;
  scan: ClientRoomSceneScan | null;
  placements: ClientRoomPlacement[];
};

export type ClientSpatialStructureFloor = {
  identifier: string | null;
  index: number | null;
  roomCount: number;
  bounds?: ClientSpatialStructureBounds | null;
  rooms: ClientSpatialStructureRoom[];
};

export type ClientSpatialStructureDetail = ClientSpatialStructureSummary & {
  floors: ClientSpatialStructureFloor[];
};

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const text = await response.text();
  let payload: (T & { error?: string }) | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as T & { error?: string };
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (HTTP ${response.status}).`);
  }
  return payload as T;
}
