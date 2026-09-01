import * as THREE from "three";

import type {
  RoomMaterial,
  RoomSurfaceAppearance,
} from "@/lib/room-ai-analysis-contract";

type FinishTexture = {
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalScale: number;
};

export type RoomFinishTextures = {
  paint: FinishTexture;
  wood: FinishTexture;
  fabric: FinishTexture;
};

/**
 * How a material class reflects, beyond its base roughness.
 *
 * Roughness and metalness alone cannot separate a bolt of upholstery from matte
 * paint or a sealed worktop from raw timber: fabric owes its look to a soft rim
 * highlight and a lacquered surface to a second, much sharper coat. Both are
 * separate lobes in the physical material, so they are described here per class
 * rather than folded into a single roughness number.
 *
 * `envMapIntensity` is deliberately left alone. Only some surfaces come back
 * from the analysis with a detected finish, and scaling the environment here
 * would make those reflect differently from their untouched neighbours.
 */
type RoomFinishResponse = {
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  sheenRoughness: number;
};

const flatResponse: RoomFinishResponse = {
  clearcoat: 0,
  clearcoatRoughness: 0,
  sheen: 0,
  sheenRoughness: 1,
};

const roomFinishResponses: Record<RoomMaterial, RoomFinishResponse> = {
  // Mineral and painted surfaces scatter; there is no second lobe to add.
  paint: flatResponse,
  plaster: flatResponse,
  concrete: flatResponse,
  other: flatResponse,
  // Bare metal and glass are already described by metalness and transmission.
  metal: flatResponse,
  glass: flatResponse,
  // Oiled or varnished timber keeps a broad, soft coat.
  wood: { ...flatResponse, clearcoat: 0.22, clearcoatRoughness: 0.36 },
  // Sheet goods and glazed tile are the sharpest coats in a room.
  laminate: { ...flatResponse, clearcoat: 0.55, clearcoatRoughness: 0.12 },
  tile: { ...flatResponse, clearcoat: 0.58, clearcoatRoughness: 0.1 },
  stone: { ...flatResponse, clearcoat: 0.12, clearcoatRoughness: 0.45 },
  plastic: { ...flatResponse, clearcoat: 0.3, clearcoatRoughness: 0.22 },
  // Upholstery and carpet catch the light at grazing angles.
  fabric: { ...flatResponse, sheen: 0.7, sheenRoughness: 0.78 },
  carpet: { ...flatResponse, sheen: 0.45, sheenRoughness: 0.9 },
};

/**
 * Applies the class response to a material, when it can carry one.
 *
 * Clearcoat and sheen exist only on the physical material, and `sheenColor`
 * defaults to black, which would leave a sheen value inert. Fabric takes a
 * desaturated tint of its own colour so a red sofa keeps a warm highlight
 * instead of a white plastic one.
 */
function applyFinishResponse(
  material: THREE.MeshStandardMaterial,
  appearance: RoomMaterial,
) {
  if (!(material instanceof THREE.MeshPhysicalMaterial)) return;
  const response = roomFinishResponses[appearance] ?? flatResponse;
  material.clearcoat = response.clearcoat;
  material.clearcoatRoughness = response.clearcoatRoughness;
  material.sheen = response.sheen;
  material.sheenRoughness = response.sheenRoughness;
  if (response.sheen > 0) {
    material.sheenColor.copy(material.color).lerp(
      new THREE.Color(0xffffff),
      0.55,
    );
  }
}

/**
 * Roughness to assume for a material class when nothing more specific is known.
 *
 * The analysis returns a measured roughness for surfaces it recognised, and
 * that always wins. This is the fallback for geometry we only know the category
 * of — a sofa and a worktop should not both arrive at the single mid-rough
 * value every prop used to share.
 */
export const roomMaterialBaseRoughness: Record<RoomMaterial, number> = {
  paint: 0.85,
  plaster: 0.92,
  concrete: 0.88,
  wood: 0.55,
  laminate: 0.35,
  carpet: 0.95,
  tile: 0.25,
  stone: 0.6,
  metal: 0.35,
  glass: 0.05,
  fabric: 0.9,
  plastic: 0.45,
  other: 0.7,
};

const materialMetalness = (material: RoomMaterial) => {
  // Metallic-roughness is a material classification, not a generic shine
  // control: bare metal is metallic, while paint, wood, plastic, and glass are
  // dielectrics. Roughness controls how broad their reflections appear.
  if (material === "metal") return 1;
  return 0;
};

/**
 * Describes a material purely from its class.
 *
 * Used for props we can only classify by category, so a fabric sofa, a timber
 * table and a steel appliance separate on roughness, metalness and their second
 * reflection lobe instead of differing only in base colour.
 */
export function applyRoomMaterialClass(
  material: THREE.MeshStandardMaterial,
  materialClass: RoomMaterial,
) {
  material.metalness = materialMetalness(materialClass);
  material.roughness = roomMaterialBaseRoughness[materialClass] ?? 0.7;
  applyFinishResponse(material, materialClass);
  material.needsUpdate = true;
  return material;
}

export function applyDetectedRoomFinish(
  material: THREE.MeshStandardMaterial,
  appearance: Pick<
    RoomSurfaceAppearance,
    "colorHex" | "material" | "roughness"
  >,
  textures: RoomFinishTextures,
) {
  material.color.set(appearance.colorHex);
  material.roughness = appearance.roughness;
  material.metalness = materialMetalness(appearance.material);

  // A color map is multiplied with material.color. The default door map is
  // brown, so keeping it would turn an accepted light-gray paint back into a
  // brown-gray door. Preserve surface relief with neutral normal/roughness
  // maps, while letting the confirmed sRGB color remain authoritative.
  material.map = null;
  material.normalMap = null;
  material.roughnessMap = null;

  const texture = appearance.material === "carpet" || appearance.material === "fabric"
    ? textures.fabric
    : appearance.material === "wood" || appearance.material === "laminate"
      ? textures.wood
      : appearance.material === "paint" ||
          appearance.material === "plaster" ||
          appearance.material === "concrete"
        ? textures.paint
        : null;
  if (texture) {
    material.normalMap = texture.normalMap;
    material.normalScale.set(texture.normalScale, texture.normalScale);
    material.roughnessMap = texture.roughnessMap;
  }

  applyFinishResponse(material, appearance.material);

  material.needsUpdate = true;
  return material;
}
