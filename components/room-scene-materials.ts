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

const materialMetalness = (material: RoomMaterial) => {
  if (material === "metal") return 0.72;
  if (material === "glass") return 0.08;
  return 0.01;
};

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

  material.needsUpdate = true;
  return material;
}
