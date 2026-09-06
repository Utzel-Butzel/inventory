import * as THREE from "three";
import type { RoomScene } from "@/lib/room-scene-contract";
import {
  roomFillLightColor, roomFillRadianceForKey, roomKeyLightColor,
  roomKeyPanelPlacement, roomKeyRadianceForPanel, resolveRoomKeyAzimuth,
  roomKeyFloorIrradiance, roomKeyToFillRatio, roomKeyLightIrradiance, roomKeyLightDirection,
} from "@/lib/room-lighting-rig";

export const roomLightingVersion = "room-lighting-v5";
export const roomDisplayExposure = 1;
export const roomDisplayToneMapping = THREE.NeutralToneMapping;
export const roomReflectionIntensity = 0.25;

/** Build in scan coordinates. Neighbouring rooms and the camera never size or rotate this rig. */
export function createRoomLightingRig(room: RoomScene, fillBalance = 1) {
  const bounds = new THREE.Box3(new THREE.Vector3(...room.bounds.min), new THREE.Vector3(...room.bounds.max));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const widestWindow = room.surfaces.filter(s => s.category === "window")
    .sort((a, b) => b.dimensions[0] * b.dimensions[1] - a.dimensions[0] * a.dimensions[1] || a.id.localeCompare(b.id))[0];
  const direction = widestWindow ? new THREE.Vector3(...widestWindow.transform.slice(12, 15)).sub(center) : null;
  const keyAzimuth = resolveRoomKeyAzimuth({ cameraAzimuth: 43, windowAzimuth:
    direction && Math.hypot(direction.x, direction.z) > 1e-6 ? Math.atan2(direction.x, direction.z) * 180 / Math.PI : null });
  const placement = roomKeyPanelPlacement({ ceilingClearance: bounds.max.y - 0.16, centerHeight: center.y,
    maximumHorizontal: Math.max(0.12, Math.min(size.x, size.z) * 0.32) });
  const angle = keyAzimuth * Math.PI / 180;
  const keyWidth = Math.max(0.2, Math.min(size.x, size.z) * 0.26);
  const key = new THREE.RectAreaLight(roomKeyLightColor,
    roomKeyRadianceForPanel({ distance: placement.distance, width: keyWidth, height: keyWidth }), keyWidth, keyWidth);
  key.position.set(center.x + Math.sin(angle) * placement.horizontal, center.y + placement.rise, center.z + Math.cos(angle) * placement.horizontal);
  key.lookAt(center);
  key.name = "Room daylight";
  const fillWidth = Math.max(0.2, size.x * 0.86), fillDepth = Math.max(0.2, size.z * 0.86);
  const fill = new THREE.RectAreaLight(roomFillLightColor,
    roomFillRadianceForKey({ distance: Math.max(0.2, size.y - 0.06), width: fillWidth, height: fillDepth }) * fillBalance,
    fillWidth, fillDepth);
  fill.position.set(center.x, bounds.max.y - 0.06, center.z);
  fill.lookAt(center.x, bounds.min.y, center.z);
  fill.name = "Room sky fill";
  const group = new THREE.Group(); group.name = "Room lighting"; group.add(key, fill);
  // Trace the actual floor outline so an L-shaped room does not roof its neighbour.
  // The caller supplies the floor geometry; this rig itself has no architecture.
  return { group, lights: [key, fill], keyAzimuth };
}

/** Raster lights do not shadow area emitters. Use a distance-independent daylight
 * approximation once for the whole view, so neighbours cannot add unoccluded fill. */
export function createRoomLiveLighting(fillBalance = 1) {
  const group = new THREE.Group();
  // Interior area emitters attenuate and are occluded; the unattenuated
  // raster daylight is calibrated against the same neutral wall reference.
  const rasterDaylightScale = 0.2;
  const key = new THREE.DirectionalLight(roomKeyLightColor, roomKeyLightIrradiance * rasterDaylightScale);
  key.position.fromArray(roomKeyLightDirection(127));
  const fill = new THREE.HemisphereLight(roomFillLightColor, 0xb9b2a7,
    roomKeyFloorIrradiance() / roomKeyToFillRatio * fillBalance * rasterDaylightScale);
  group.add(key, key.target, fill);
  return group;
}
