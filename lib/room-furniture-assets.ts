import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  roomFurnitureLibraryUrl,
  roomFurnitureLibraryVersion,
  roomFurnitureVariants,
  type RoomFurnitureVariant,
} from "@/lib/room-furniture-catalog";

const templates = new Map<RoomFurnitureVariant, THREE.Object3D>();
let loading: Promise<void> | null = null;
export function isRoomFurnitureLibraryLoaded() {
  return templates.size === roomFurnitureVariants.length;
}
export function loadRoomFurnitureLibrary() {
  loading ??= (async () => {
    const response = await fetch(roomFurnitureLibraryUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("furniture-library-unavailable");
    const gltf = await new GLTFLoader().parseAsync(
      await response.arrayBuffer(),
      "",
    );
    const loaded = new Map<RoomFurnitureVariant, THREE.Object3D>();
    for (const variant of roomFurnitureVariants) {
      const object = gltf.scene.children.find(
        (node) => node.userData.variant === variant,
      );
      if (!object) throw new Error(`furniture-model-missing:${variant}`);
      loaded.set(variant, object);
    }
    loaded.forEach((object, variant) => templates.set(variant, object));
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Independent buffers/materials let each room dispose and lightmap its own meshes. */
export function instantiateRoomFurniture(
  template: THREE.Object3D,
  dimensions: readonly number[],
  color?: string | null,
) {
  const content = template.clone(true);
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  content.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry = node.geometry.clone();
    const clone = (original: THREE.Material) => {
      let material = materials.get(original);
      if (!material) {
        material = original.clone();
        // Canvas cleanup disposes textures too; never share them with the template.
        for (const [key, value] of Object.entries(material)) {
          if (!(value instanceof THREE.Texture)) continue;
          let texture = textures.get(value);
          if (!texture) {
            texture = value.clone();
            texture.needsUpdate = true;
            textures.set(value, texture);
          }
          Object.assign(material, { [key]: texture });
        }
        if (
          color &&
          original.userData.inventoryTintable &&
          material instanceof THREE.MeshStandardMaterial
        ) {
          material.color.set(color);
          // Tint uses the existing grain/weave as relief, keeping metal and ceramics intact.
          // v2 uses neutral albedo maps; no brown tint or exposure compensation.
        }
        materials.set(original, material);
      }
      return material;
    };
    node.material = Array.isArray(node.material)
      ? node.material.map(clone)
      : clone(node.material);
    node.castShadow = true;
    node.receiveShadow = true;
    node.userData.roomLightMapTexelScale = 1.35;
  });
  const bounds = new THREE.Box3().setFromObject(content);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = new THREE.Vector3(
    ...(dimensions.map(
      (value, axis) =>
        Math.max(0.02, value) / Math.max(0.001, size.getComponent(axis)),
    ) as [number, number, number]),
  );
  content.scale.multiply(scale);
  content.position.sub(center.multiply(scale));
  const root = new THREE.Group();
  root.add(content);
  root.userData.furnitureLibrary = roomFurnitureLibraryVersion;
  root.userData.furnitureVariant = template.userData.variant;
  return root;
}

export function createBlenderFurnitureModel(
  variant: RoomFurnitureVariant | null | undefined,
  dimensions: readonly number[],
  color?: string | null,
) {
  const template = variant ? templates.get(variant) : null;
  return template
    ? instantiateRoomFurniture(template, dimensions, color)
    : null;
}
