import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  applyDetectedRoomFinish,
  applyRoomMaterialClass,
  roomMaterialBaseRoughness,
} from "../components/room-scene-materials.ts";

const finishTexture = () => ({
  normalMap: new THREE.Texture(),
  roughnessMap: new THREE.Texture(),
  normalScale: 0.2,
});
const textures = {
  paint: finishTexture(),
  wood: finishTexture(),
  fabric: finishTexture(),
};

test("gives upholstery a sheen that is actually visible", () => {
  // sheenColor defaults to black, so a sheen value on its own does nothing.
  const material = applyRoomMaterialClass(
    new THREE.MeshPhysicalMaterial({ color: 0x8792a8 }),
    "fabric",
  );
  assert.ok(material.sheen > 0);
  assert.ok(material.sheenColor.getHex() !== 0x000000);
  // And it keeps the fabric's own hue rather than going white plastic.
  assert.ok(material.sheenColor.b > material.sheenColor.r);
});

test("treats metal as metal and gives it no extra lobe", () => {
  const material = applyRoomMaterialClass(
    new THREE.MeshPhysicalMaterial({ color: 0xaeb7bd }),
    "metal",
  );
  assert.equal(material.metalness, 1);
  assert.equal(material.sheen, 0);
  assert.equal(material.clearcoat, 0);
});

test("separates a sealed sheet from raw timber", () => {
  const wood = applyRoomMaterialClass(new THREE.MeshPhysicalMaterial(), "wood");
  const laminate = applyRoomMaterialClass(
    new THREE.MeshPhysicalMaterial(),
    "laminate",
  );
  assert.ok(laminate.clearcoat > wood.clearcoat);
  // The sheet's coat is the sharper of the two.
  assert.ok(laminate.clearcoatRoughness < wood.clearcoatRoughness);
  assert.ok(laminate.roughness < wood.roughness);
});

test("spreads props across the roughness range instead of one value", () => {
  const distinct = new Set(Object.values(roomMaterialBaseRoughness));
  assert.ok(distinct.size >= 8);
  assert.ok(roomMaterialBaseRoughness.fabric > roomMaterialBaseRoughness.wood);
  assert.ok(roomMaterialBaseRoughness.wood > roomMaterialBaseRoughness.tile);
});

test("leaves a non-physical material alone rather than throwing", () => {
  const material = new THREE.MeshStandardMaterial();
  applyRoomMaterialClass(material, "fabric");
  // Class roughness and metalness still apply; the extra lobes cannot.
  assert.equal(material.roughness, roomMaterialBaseRoughness.fabric);
  assert.equal(material.sheen, undefined);
});

test("lets a measured roughness win over the class default", () => {
  const material = applyDetectedRoomFinish(
    new THREE.MeshPhysicalMaterial(),
    { colorHex: "#8792a8", material: "fabric", roughness: 0.61 },
    textures,
  );
  assert.equal(material.roughness, 0.61);
  assert.notEqual(material.roughness, roomMaterialBaseRoughness.fabric);
  // The class response still comes along with it.
  assert.ok(material.sheen > 0);
});

test("drops the stale colour map when a finish is confirmed", () => {
  const material = applyDetectedRoomFinish(
    new THREE.MeshPhysicalMaterial({ map: new THREE.Texture() }),
    { colorHex: "#d5d2cc", material: "paint", roughness: 0.9 },
    textures,
  );
  assert.equal(material.map, null);
  assert.equal(material.normalMap, textures.paint.normalMap);
});
