import assert from "node:assert/strict";
import test from "node:test";

import {
  azimuthDegrees,
  azimuthSeparationDegrees,
  rectAreaAxialIrradiance,
  resolveRoomKeyAzimuth,
  roomFillRadianceForKey,
  roomKeyLightDirection,
  roomKeyLightElevationDegrees,
  roomKeyLightCameraSeparationDegrees,
  roomKeyFloorIrradiance,
  roomKeyLightIrradiance,
  roomKeyPanelPlacement,
  roomKeyRadianceForPanel,
  roomKeyToFillRatio,
} from "../lib/room-lighting-rig.ts";

test("keeps the key light inside the architectural elevation band", () => {
  assert.ok(roomKeyLightElevationDegrees >= 35);
  assert.ok(roomKeyLightElevationDegrees <= 55);
});

test("targets a photographic key-to-fill ratio", () => {
  assert.ok(roomKeyToFillRatio >= 2);
  assert.ok(roomKeyToFillRatio <= 3);
});

test("points the key above the horizon at the configured elevation", () => {
  const [x, y, z] = roomKeyLightDirection(140);
  const horizontal = Math.hypot(x, z);
  const elevation = Math.atan2(y, horizontal) * (180 / Math.PI);
  assert.ok(Math.abs(elevation - roomKeyLightElevationDegrees) < 1e-9);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9);
  assert.ok(Math.abs(azimuthDegrees(x, z) - 140) < 1e-9);
});

test("separates the key from the viewing direction", () => {
  const cameraAzimuth = azimuthDegrees(1.25, 1.35);
  // A window on the same side as the camera must still be pushed away from it.
  const alignedWindow = resolveRoomKeyAzimuth({
    cameraAzimuth,
    windowAzimuth: cameraAzimuth + 4,
  });
  assert.ok(
    azimuthSeparationDegrees(alignedWindow, cameraAzimuth) >=
      roomKeyLightCameraSeparationDegrees - 1e-9,
  );
  // The rotation keeps the key on the side the window already leans toward.
  assert.ok(
    azimuthSeparationDegrees(
      alignedWindow,
      cameraAzimuth + roomKeyLightCameraSeparationDegrees,
    ) < 1e-9,
  );
  const behindWindow = resolveRoomKeyAzimuth({
    cameraAzimuth,
    windowAzimuth: cameraAzimuth - 4,
  });
  assert.ok(
    azimuthSeparationDegrees(
      behindWindow,
      cameraAzimuth - roomKeyLightCameraSeparationDegrees,
    ) < 1e-9,
  );
});

test("keeps a window azimuth that is already off-camera", () => {
  const cameraAzimuth = 40;
  const resolved = resolveRoomKeyAzimuth({ cameraAzimuth, windowAzimuth: 200 });
  assert.equal(resolved, 200);
});

test("falls back to a diagonal key when the room has no window", () => {
  const cameraAzimuth = 40;
  const resolved = resolveRoomKeyAzimuth({ cameraAzimuth });
  assert.ok(
    azimuthSeparationDegrees(resolved, cameraAzimuth) >=
      roomKeyLightCameraSeparationDegrees,
  );
});

test("sizes the fill so it lands at the requested ratio below the key", () => {
  const geometry = { distance: 1.4, height: 4.2, width: 5.1 };
  const radiance = roomFillRadianceForKey(geometry);
  const irradiance = rectAreaAxialIrradiance({ ...geometry, radiance });
  // Both sides of the ratio are irradiance on the same horizontal surface.
  const ratio = roomKeyFloorIrradiance() / irradiance;
  assert.ok(Math.abs(ratio - roomKeyToFillRatio) < 1e-9);
  assert.ok(ratio >= 2 - 1e-9 && ratio <= 3 + 1e-9);
});

test("measures the key against the floor, not the beam", () => {
  // A light 46 degrees up delivers noticeably less than its beam figure.
  assert.ok(roomKeyFloorIrradiance() < 0.75 * roomKeyLightIrradiance);
  assert.ok(roomKeyFloorIrradiance() > 0.65 * roomKeyLightIrradiance);
});

test("sizes the key panel to deliver the rig's irradiance", () => {
  const geometry = { distance: 3.2, height: 5.1, width: 5.1 };
  const radiance = roomKeyRadianceForPanel(geometry);
  const irradiance = rectAreaAxialIrradiance({ ...geometry, radiance });
  assert.ok(Math.abs(irradiance - roomKeyLightIrradiance) < 1e-9);
});

test("keeps key and fill in the target ratio at their own working distances", () => {
  // The two sources sit at different distances and sizes, so the ratio has to
  // survive being solved independently for each.
  const keyRadiance = roomKeyRadianceForPanel({
    distance: 3.2,
    height: 5.1,
    width: 5.1,
  });
  const keyIrradiance = rectAreaAxialIrradiance({
    distance: 3.2,
    height: 5.1,
    radiance: keyRadiance,
    width: 5.1,
  });
  const fillGeometry = { distance: 2.8, height: 4.3, width: 5.2 };
  const fillIrradiance = rectAreaAxialIrradiance({
    ...fillGeometry,
    radiance: roomFillRadianceForKey(fillGeometry),
  });
  const ratio = (keyIrradiance * Math.sin((46 * Math.PI) / 180)) / fillIrradiance;
  assert.ok(ratio >= 2 - 1e-9 && ratio <= 3 + 1e-9);
});

test("hangs the key panel inside the shell at the specified elevation", () => {
  // A 2.8 m room: the panel must clear the furniture but stay under the roof.
  const placement = roomKeyPanelPlacement({
    ceilingClearance: 2.64,
    centerHeight: 1.4,
    maximumHorizontal: 2.1,
  });
  assert.ok(Math.abs(placement.elevation - roomKeyLightElevationDegrees) < 1e-9);
  assert.ok(placement.rise > 0 && placement.rise <= 2.64 - 1.4 + 1e-9);
  assert.ok(placement.horizontal <= 2.1 + 1e-9);
});

test("keeps the key elevation in band when the room is too shallow", () => {
  // Clamping the offset must lower the panel, never tilt it out of the band.
  const placement = roomKeyPanelPlacement({
    ceilingClearance: 3.4,
    centerHeight: 1.2,
    maximumHorizontal: 0.5,
  });
  assert.ok(Math.abs(placement.elevation - roomKeyLightElevationDegrees) < 1e-9);
  assert.equal(placement.horizontal, 0.5);
  assert.ok(placement.rise < 3.4 - 1.2);
  assert.ok(placement.elevation >= 35 && placement.elevation <= 55);
});

test("configuration factor approaches a full hemisphere for a large source", () => {
  const irradiance = rectAreaAxialIrradiance({
    distance: 0.01,
    height: 400,
    radiance: 1,
    width: 400,
  });
  // A Lambertian emitter covering the hemisphere delivers PI * radiance.
  assert.ok(Math.abs(irradiance - Math.PI) < 1e-3);
});
