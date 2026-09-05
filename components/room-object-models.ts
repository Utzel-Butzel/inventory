import * as THREE from "three";
import type { RoomFurnitureVariant } from "@/lib/room-furniture-catalog";
import { automaticRoomFurnitureVariant, roomFurnitureCatalog } from "@/lib/room-furniture-catalog";
import { createBlenderFurnitureModel } from "@/lib/room-furniture-assets";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import type {
  RoomMaterial,
  RoomPrimitiveModel,
} from "@/lib/room-ai-analysis-contract";

export type RoomObjectModelMaterials = {
  primary: THREE.Material;
  light: THREE.Material;
  dark: THREE.Material;
  metal: THREE.Material;
  glass: THREE.Material;
  ceramic: THREE.Material;
  water: THREE.Material;
  warm: THREE.Material;
};

type Vector3Tuple = readonly [number, number, number];

const MIN_PART_SIZE = 0.006;

function scaleBoxTextureUvs(
  geometry: THREE.BoxGeometry,
  size: Vector3Tuple,
) {
  const uv = geometry.getAttribute("uv");
  const index = geometry.getIndex();
  if (!uv || !index) return;

  // BoxGeometry maps every face to 0..1, which made a 5 cm chair leg and a
  // two-metre sofa repeat the same texture equally often. Scale each face by
  // its physical side lengths; the shared texture repeat now means repeats per
  // metre and keeps wood/fabric relief consistent across furniture sizes.
  const faceScale: ReadonlyArray<readonly [number, number]> = [
    [size[2], size[1]],
    [size[2], size[1]],
    [size[0], size[2]],
    [size[0], size[2]],
    [size[0], size[1]],
    [size[0], size[1]],
  ];
  geometry.groups.forEach((group, face) => {
    const [uScale, vScale] = faceScale[face] ?? [1, 1];
    const scaledVertices = new Set<number>();
    for (let offset = group.start; offset < group.start + group.count; offset += 1) {
      const vertex = index.getX(offset);
      if (scaledVertices.has(vertex)) continue;
      scaledVertices.add(vertex);
      uv.setXY(vertex, uv.getX(vertex) * uScale, uv.getY(vertex) * vScale);
    }
  });
  uv.needsUpdate = true;
}

function prioritizeFurnitureLightMap(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.userData.roomLightMapTexelScale = 1.35;
    }
  });
}

const floorAnchoredObjectCategories = new Set([
  "bathtub",
  "bed",
  "chair",
  "dishwasher",
  "fireplace",
  "oven",
  "refrigerator",
  "sink",
  "sofa",
  "stairs",
  "storage",
  "stove",
  "table",
  "toilet",
  "washer-dryer",
]);

const minimumAiPartsByCategory: Record<string, number> = {
  bed: 4,
  chair: 5,
  sofa: 5,
  storage: 3,
  table: 3,
};

const primitiveMaterialColors: Record<RoomMaterial, string> = {
  paint: "#D8D4CC",
  plaster: "#D7D2C8",
  concrete: "#999B99",
  wood: "#9A6B42",
  laminate: "#AF865E",
  carpet: "#77736D",
  tile: "#D4D2CB",
  stone: "#99958D",
  metal: "#A8B0B5",
  glass: "#B8D7DF",
  fabric: "#77736D",
  plastic: "#C7C4BD",
  other: "#AAA69E",
};

const primitiveMaterialRoughness: Record<RoomMaterial, number> = {
  paint: 0.72,
  plaster: 0.92,
  concrete: 0.9,
  wood: 0.72,
  laminate: 0.52,
  carpet: 0.98,
  tile: 0.34,
  stone: 0.72,
  metal: 0.28,
  glass: 0.12,
  fabric: 0.96,
  plastic: 0.48,
  other: 0.72,
};

function primitiveMaterial(
  colorHex: string | null,
  material: RoomMaterial,
) {
  const color = new THREE.Color(colorHex ?? primitiveMaterialColors[material]);
  if (material === "glass") {
    return new THREE.MeshPhysicalMaterial({
      color,
      roughness: primitiveMaterialRoughness[material],
      metalness: 0,
      transparent: true,
      opacity: 0.62,
      transmission: 0.3,
      thickness: 0.025,
      side: THREE.DoubleSide,
      envMapIntensity: 1.15,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: primitiveMaterialRoughness[material],
    metalness: material === "metal" ? 1 : 0,
    envMapIntensity: material === "metal" ? 1.25 : 0.55,
  });
}

function fitContentToDimensions(
  content: THREE.Group,
  dimensions: Vector3Tuple,
) {
  const bounds = new THREE.Box3().setFromObject(content);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const fit = new THREE.Vector3(
    size.x > dimensions[0] ? dimensions[0] / size.x : 1,
    size.y > dimensions[1] ? dimensions[1] / size.y : 1,
    size.z > dimensions[2] ? dimensions[2] / size.z : 1,
  );
  content.scale.copy(fit);
  content.position.set(-center.x * fit.x, -center.y * fit.y, -center.z * fit.z);
}

function fitAiContentToDimensions(
  content: THREE.Group,
  dimensions: Vector3Tuple,
  category: string,
) {
  const bounds = new THREE.Box3().setFromObject(content);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const padding = 0.96;
  const scale = Math.min(
    1,
    size.x > 0 ? (dimensions[0] * padding) / size.x : 1,
    size.y > 0 ? (dimensions[1] * padding) / size.y : 1,
    size.z > 0 ? (dimensions[2] * padding) / size.z : 1,
  );
  content.scale.setScalar(scale);
  content.position.x = -center.x * scale;
  content.position.z = -center.z * scale;
  content.position.y = floorAnchoredObjectCategories.has(
    category.trim().toLocaleLowerCase(),
  )
    ? -dimensions[1] / 2 - bounds.min.y * scale
    : -center.y * scale;
}

export function isRecognizableAiPrimitiveModel({
  category,
  model,
}: {
  category: string;
  model: RoomPrimitiveModel;
}) {
  const normalizedCategory = category.trim().toLocaleLowerCase();
  const minimumParts = minimumAiPartsByCategory[normalizedCategory] ?? 3;
  if (model.parts.length < minimumParts) return false;

  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const part of model.parts) {
    for (let axis = 0; axis < 3; axis += 1) {
      const halfSize = part.size[axis]! / 2;
      minimum[axis] = Math.min(
        minimum[axis]!,
        part.position[axis]! - halfSize,
      );
      maximum[axis] = Math.max(
        maximum[axis]!,
        part.position[axis]! + halfSize,
      );
    }
  }
  const span = maximum.map((value, axis) => value - minimum[axis]!);
  const minimumDepth = normalizedCategory === "television" ? 0.03 : 0.12;
  if (span[0]! < 0.25 || span[1]! < 0.3 || span[2]! < minimumDepth) {
    return false;
  }
  return (
    !floorAnchoredObjectCategories.has(normalizedCategory) ||
    minimum[1]! <= -0.25
  );
}

function box(
  root: THREE.Object3D,
  material: THREE.Material,
  size: Vector3Tuple,
  position: Vector3Tuple = [0, 0, 0],
  rotation: Vector3Tuple = [0, 0, 0],
) {
  const width = Math.max(size[0], MIN_PART_SIZE);
  const height = Math.max(size[1], MIN_PART_SIZE);
  const depth = Math.max(size[2], MIN_PART_SIZE);
  const geometry = new THREE.BoxGeometry(width, height, depth);
  scaleBoxTextureUvs(geometry, [width, height, depth]);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function cylinder(
  root: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  height: number,
  position: Vector3Tuple = [0, 0, 0],
  rotation: Vector3Tuple = [0, 0, 0],
  radiusTop = radius,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      Math.max(radiusTop, MIN_PART_SIZE / 2),
      Math.max(radius, MIN_PART_SIZE / 2),
      Math.max(height, MIN_PART_SIZE),
      16,
    ),
    material,
  );
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function sphere(
  root: THREE.Object3D,
  material: THREE.Material,
  scale: Vector3Tuple,
  position: Vector3Tuple = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), material);
  mesh.scale.set(
    Math.max(scale[0], MIN_PART_SIZE),
    Math.max(scale[1], MIN_PART_SIZE),
    Math.max(scale[2], MIN_PART_SIZE),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function torus(
  root: THREE.Object3D,
  material: THREE.Material,
  radius: number,
  tube: number,
  position: Vector3Tuple = [0, 0, 0],
  rotation: Vector3Tuple = [0, 0, 0],
  scale: Vector3Tuple = [1, 1, 1],
) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(
      Math.max(radius, MIN_PART_SIZE),
      Math.max(tube, MIN_PART_SIZE / 2),
      8,
      24,
    ),
    material,
  );
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function makeStorage(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const footHeight = height * 0.055;
  box(root, materials.primary, [width * 0.94, height * 0.88, depth * 0.9], [0, footHeight * 0.6, -depth * 0.025]);
  const doorGap = width * 0.012;
  const doorWidth = width * 0.45;
  for (const x of [-doorWidth / 2 - doorGap, doorWidth / 2 + doorGap]) {
    box(root, materials.light, [doorWidth, height * 0.78, depth * 0.035], [x, height * 0.035, depth * 0.44]);
    box(root, materials.metal, [width * 0.018, height * 0.18, depth * 0.035], [x < 0 ? -doorGap * 1.8 : doorGap * 1.8, height * 0.04, depth * 0.475]);
  }
  const footSize = Math.min(width, depth) * 0.09;
  for (const x of [-width * 0.38, width * 0.38]) {
    for (const z of [-depth * 0.34, depth * 0.34]) {
      box(root, materials.dark, [footSize, footHeight, footSize], [x, -height / 2 + footHeight / 2, z]);
    }
  }
}

function makeShelves(root: THREE.Group, [w, h, d]: Vector3Tuple, materials: RoomObjectModelMaterials, open = false) {
  const panel = Math.min(0.035, w * 0.045, h * 0.035);
  const material = open ? materials.metal : materials.primary;
  for (const x of [-w / 2 + panel / 2, w / 2 - panel / 2]) {
    if (open) {
      for (const z of [-d / 2 + panel / 2, d / 2 - panel / 2]) box(root, material, [panel, h, panel], [x, 0, z]);
    } else box(root, material, [panel, h, d], [x, 0, 0]);
  }
  if (!open) box(root, materials.dark, [w - panel * 2, h, panel / 2], [0, 0, -d / 2 + panel / 4]);
  const shelves = Math.max(2, Math.min(7, Math.round(h / 0.35)));
  for (let i = 0; i <= shelves; i++) {
    box(root, material, [w - panel * 2, panel, d - panel], [0, -h / 2 + panel / 2 + i * (h - panel) / shelves, 0]);
  }
  if (!open && w > 1.1) box(root, material, [panel, h - panel * 2, d - panel], [0, 0, 0]);
}

function makeDrawers(root: THREE.Group, [w, h, d]: Vector3Tuple, materials: RoomObjectModelMaterials) {
  // Separate carcass panels keep the recess between fronts visible.
  const p = Math.min(0.035, w * 0.04);
  for (const x of [-w / 2 + p / 2, w / 2 - p / 2]) box(root, materials.primary, [p, h, d], [x, 0, 0]);
  for (const y of [-h / 2 + p / 2, h / 2 - p / 2]) box(root, materials.primary, [w, p, d], [0, y, 0]);
  box(root, materials.dark, [w - p * 2, h - p * 2, p], [0, 0, -d / 2 + p / 2]);
  const count = Math.max(2, Math.min(6, Math.round(h / 0.25)));
  const dh = (h - p * 2) / count;
  for (let i = 0; i < count; i++) {
    const y = -h / 2 + p + dh * (i + 0.5);
    box(root, materials.light, [w - p * 2, dh - 0.009, p], [0, y, d / 2 - p / 2]);
    box(root, materials.metal, [w * 0.26, 0.014, 0.022], [0, y + dh * 0.2, d / 2 + 0.011]);
  }
}

function makeTable(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const topHeight = Math.max(height * 0.1, 0.035);
  box(root, materials.primary, [width, topHeight, depth], [0, height / 2 - topHeight / 2, 0]);
  const legWidth = Math.min(width, depth) * 0.105;
  const legHeight = height - topHeight;
  for (const x of [-width * 0.39, width * 0.39]) {
    for (const z of [-depth * 0.37, depth * 0.37]) {
      box(root, materials.primary, [legWidth, legHeight, legWidth], [x, -topHeight / 2, z]);
    }
  }
}

function makeChair(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const seatY = -height * 0.08;
  const seatHeight = height * 0.09;
  box(root, materials.primary, [width * 0.9, seatHeight, depth * 0.82], [0, seatY, depth * 0.04]);
  const legWidth = Math.min(width, depth) * 0.095;
  const legHeight = seatY + height / 2 - seatHeight / 2;
  for (const x of [-width * 0.36, width * 0.36]) {
    for (const z of [-depth * 0.3, depth * 0.3]) {
      box(root, materials.primary, [legWidth, legHeight, legWidth], [x, -height / 2 + legHeight / 2, z]);
    }
  }
  const backHeight = height / 2 - seatY;
  const backZ = -depth * 0.38;
  for (const x of [-width * 0.36, width * 0.36]) {
    box(root, materials.primary, [legWidth, backHeight, legWidth], [x, seatY + backHeight / 2, backZ]);
  }
  box(root, materials.primary, [width * 0.82, height * 0.16, depth * 0.085], [0, height * 0.38, backZ]);
  box(root, materials.light, [width * 0.68, height * 0.18, depth * 0.075], [0, height * 0.18, backZ + depth * 0.012]);
}

function makeSofa(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.primary, [width * 0.96, height * 0.3, depth * 0.88], [0, -height * 0.3, 0]);
  box(root, materials.primary, [width * 0.9, height * 0.66, depth * 0.18], [0, height * 0.12, -depth * 0.38], [-0.08, 0, 0]);
  for (const x of [-width * 0.44, width * 0.44]) {
    box(root, materials.primary, [width * 0.11, height * 0.48, depth * 0.82], [x, -height * 0.08, depth * 0.02]);
  }
  const cushionCount = width / Math.max(depth, 0.01) > 2.35 ? 3 : 2;
  const cushionWidth = (width * 0.74) / cushionCount;
  for (let index = 0; index < cushionCount; index += 1) {
    const x = -width * 0.37 + cushionWidth / 2 + index * cushionWidth;
    box(root, materials.light, [cushionWidth * 0.92, height * 0.11, depth * 0.58], [x, -height * 0.08, depth * 0.08], [-0.06, 0, 0]);
    box(root, materials.light, [cushionWidth * 0.9, height * 0.38, depth * 0.12], [x, height * 0.17, -depth * 0.25], [-0.12, 0, 0]);
  }
  for (const x of [-width * 0.37, width * 0.37]) {
    box(root, materials.dark, [width * 0.05, height * 0.08, depth * 0.08], [x, -height * 0.46, 0]);
  }
}

function makeBed(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const frameHeight = height * 0.22;
  box(root, materials.primary, [width * 0.98, frameHeight, depth * 0.94], [0, -height / 2 + frameHeight / 2, depth * 0.02]);
  const mattressHeight = height * 0.34;
  box(root, materials.light, [width * 0.92, mattressHeight, depth * 0.84], [0, -height / 2 + frameHeight + mattressHeight / 2, depth * 0.04]);
  box(root, materials.primary, [width, height * 0.78, depth * 0.09], [0, height * 0.08, -depth * 0.45]);
  const pillowWidth = width * 0.36;
  for (const x of [-width * 0.22, width * 0.22]) {
    sphere(root, materials.ceramic, [pillowWidth, height * 0.2, depth * 0.2], [x, height * 0.12, -depth * 0.28]);
  }
  box(root, materials.warm, [width * 0.86, height * 0.08, depth * 0.45], [0, height * 0.07, depth * 0.2]);
}

function makeRefrigerator(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.primary, [width * 0.96, height * 0.96, depth * 0.92], [0, 0, -depth * 0.02]);
  const frontZ = depth * 0.455;
  box(root, materials.light, [width * 0.9, height * 0.59, depth * 0.035], [0, height * 0.175, frontZ]);
  box(root, materials.light, [width * 0.9, height * 0.3, depth * 0.035], [0, -height * 0.31, frontZ]);
  box(root, materials.dark, [width * 0.84, height * 0.012, depth * 0.025], [0, -height * 0.13, frontZ + depth * 0.02]);
  box(root, materials.metal, [width * 0.035, height * 0.23, depth * 0.035], [width * 0.36, height * 0.15, frontZ + depth * 0.025]);
  box(root, materials.metal, [width * 0.035, height * 0.13, depth * 0.035], [width * 0.36, -height * 0.29, frontZ + depth * 0.025]);
}

function addCooktop(
  root: THREE.Group,
  width: number,
  height: number,
  depth: number,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.dark, [width * 0.94, height * 0.035, depth * 0.92], [0, height / 2 - height * 0.025, 0]);
  const burnerRadius = Math.min(width, depth) * 0.13;
  for (const x of [-width * 0.24, width * 0.24]) {
    for (const z of [-depth * 0.23, depth * 0.23]) {
      cylinder(root, materials.metal, burnerRadius, height * 0.018, [x, height / 2, z]);
      cylinder(root, materials.dark, burnerRadius * 0.62, height * 0.022, [x, height / 2 + height * 0.012, z]);
    }
  }
}

function addOvenFront(
  root: THREE.Group,
  width: number,
  height: number,
  depth: number,
  materials: RoomObjectModelMaterials,
  verticalOffset = 0,
) {
  const frontZ = depth * 0.48;
  box(root, materials.dark, [width * 0.76, height * 0.46, depth * 0.025], [0, verticalOffset - height * 0.12, frontZ]);
  box(root, materials.glass, [width * 0.64, height * 0.31, depth * 0.018], [0, verticalOffset - height * 0.11, frontZ + depth * 0.018]);
  box(root, materials.metal, [width * 0.65, height * 0.035, depth * 0.055], [0, verticalOffset + height * 0.17, frontZ + depth * 0.04]);
  for (const x of [-width * 0.26, 0, width * 0.26]) {
    cylinder(root, materials.metal, Math.min(width, height) * 0.035, depth * 0.04, [x, verticalOffset + height * 0.31, frontZ + depth * 0.035], [Math.PI / 2, 0, 0]);
  }
}

function makeStove(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.primary, [width * 0.96, height * 0.94, depth * 0.92], [0, -height * 0.02, -depth * 0.02]);
  addCooktop(root, width, height, depth, materials);
  addOvenFront(root, width, height, depth, materials, -height * 0.04);
}

function makeOven(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.primary, [width * 0.96, height * 0.96, depth * 0.9], [0, 0, -depth * 0.025]);
  addOvenFront(root, width, height, depth, materials);
}

function makeDishwasher(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.primary, [width * 0.96, height * 0.95, depth * 0.92], [0, -height * 0.015, -depth * 0.02]);
  const frontZ = depth * 0.455;
  box(root, materials.light, [width * 0.88, height * 0.77, depth * 0.035], [0, -height * 0.04, frontZ]);
  box(root, materials.dark, [width * 0.86, height * 0.11, depth * 0.04], [0, height * 0.38, frontZ + depth * 0.01]);
  box(root, materials.metal, [width * 0.56, height * 0.035, depth * 0.055], [0, height * 0.29, frontZ + depth * 0.045]);
  cylinder(root, materials.warm, width * 0.016, depth * 0.025, [width * 0.33, height * 0.38, frontZ + depth * 0.035], [Math.PI / 2, 0, 0]);
}

function makeWasherDryer(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.primary, [width * 0.96, height * 0.95, depth * 0.92], [0, -height * 0.015, -depth * 0.02]);
  const frontZ = depth * 0.47;
  const portholeRadius = Math.min(width, height) * 0.27;
  cylinder(root, materials.glass, portholeRadius * 0.82, depth * 0.035, [0, -height * 0.1, frontZ + depth * 0.012], [Math.PI / 2, 0, 0]);
  torus(root, materials.dark, portholeRadius, portholeRadius * 0.13, [0, -height * 0.1, frontZ + depth * 0.035]);
  box(root, materials.light, [width * 0.9, height * 0.15, depth * 0.035], [0, height * 0.36, frontZ]);
  cylinder(root, materials.dark, width * 0.065, depth * 0.04, [width * 0.27, height * 0.36, frontZ + depth * 0.035], [Math.PI / 2, 0, 0]);
  box(root, materials.dark, [width * 0.22, height * 0.045, depth * 0.025], [-width * 0.2, height * 0.36, frontZ + depth * 0.025]);
}

function makeSink(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const counterHeight = height * 0.09;
  box(root, materials.light, [width, counterHeight, depth], [0, height / 2 - counterHeight / 2, 0]);
  box(root, materials.primary, [width * 0.9, height * 0.78, depth * 0.82], [0, -height * 0.08, -depth * 0.03]);
  const basinWidth = width * 0.58;
  const basinDepth = depth * 0.5;
  sphere(root, materials.metal, [basinWidth, height * 0.14, basinDepth], [0, height * 0.46, depth * 0.02]);
  sphere(root, materials.dark, [basinWidth * 0.82, height * 0.1, basinDepth * 0.8], [0, height * 0.475, depth * 0.02]);
  const faucetRadius = Math.min(width, depth) * 0.025;
  cylinder(root, materials.metal, faucetRadius, height * 0.24, [0, height * 0.55, -depth * 0.34]);
  cylinder(root, materials.metal, faucetRadius, depth * 0.25, [0, height * 0.65, -depth * 0.23], [Math.PI / 2, 0, 0]);
}

function makeToilet(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const bowlY = -height * 0.18;
  cylinder(root, materials.ceramic, width * 0.25, height * 0.34, [0, -height * 0.32, depth * 0.08], [0, 0, 0], width * 0.35);
  sphere(root, materials.ceramic, [width * 0.88, height * 0.35, depth * 0.58], [0, bowlY, depth * 0.08]);
  torus(root, materials.light, width * 0.32, width * 0.06, [0, bowlY + height * 0.13, depth * 0.08], [Math.PI / 2, 0, 0], [1, depth / Math.max(width, 0.01) * 0.8, 1]);
  box(root, materials.ceramic, [width * 0.78, height * 0.47, depth * 0.28], [0, height * 0.25, -depth * 0.32]);
  box(root, materials.light, [width * 0.72, height * 0.045, depth * 0.26], [0, height * 0.5, -depth * 0.32]);
  cylinder(root, materials.metal, width * 0.025, width * 0.02, [width * 0.22, height * 0.52, -depth * 0.32]);
}

function makeBathtub(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.ceramic, [width, height * 0.74, depth], [0, -height * 0.13, 0]);
  const rim = Math.min(width, depth) * 0.075;
  const topY = height * 0.34;
  box(root, materials.ceramic, [width, height * 0.1, rim], [0, topY, -depth / 2 + rim / 2]);
  box(root, materials.ceramic, [width, height * 0.1, rim], [0, topY, depth / 2 - rim / 2]);
  box(root, materials.ceramic, [rim, height * 0.1, depth - rim * 2], [-width / 2 + rim / 2, topY, 0]);
  box(root, materials.ceramic, [rim, height * 0.1, depth - rim * 2], [width / 2 - rim / 2, topY, 0]);
  box(root, materials.water, [width - rim * 2.2, height * 0.025, depth - rim * 2.2], [0, topY - height * 0.075, 0]);
  for (const x of [-width * 0.08, width * 0.08]) {
    cylinder(root, materials.metal, rim * 0.16, height * 0.14, [x, height * 0.47, -depth * 0.37]);
  }
}

function makeFireplace(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  box(root, materials.primary, [width, height * 0.14, depth], [0, -height * 0.43, depth * 0.03]);
  box(root, materials.primary, [width * 0.2, height * 0.72, depth * 0.88], [-width * 0.39, -height * 0.02, -depth * 0.02]);
  box(root, materials.primary, [width * 0.2, height * 0.72, depth * 0.88], [width * 0.39, -height * 0.02, -depth * 0.02]);
  box(root, materials.primary, [width * 0.62, height * 0.18, depth * 0.88], [0, height * 0.25, -depth * 0.02]);
  box(root, materials.dark, [width * 0.57, height * 0.48, depth * 0.04], [0, -height * 0.12, depth * 0.45]);
  for (const x of [-width * 0.16, 0, width * 0.16]) {
    sphere(root, materials.warm, [width * 0.17, height * 0.2, depth * 0.05], [x, -height * 0.22, depth * 0.48]);
  }
  box(root, materials.light, [width * 1.08, height * 0.1, depth * 1.02], [0, height * 0.42, 0]);
}

function makeTelevision(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const screenHeight = height * 0.76;
  const screenY = height * 0.09;
  box(root, materials.dark, [width, screenHeight, depth * 0.34], [0, screenY, 0]);
  box(root, materials.glass, [width * 0.94, screenHeight * 0.9, depth * 0.035], [0, screenY, depth * 0.19]);
  box(root, materials.metal, [width * 0.08, height * 0.2, depth * 0.12], [0, -height * 0.34, 0]);
  box(root, materials.dark, [width * 0.42, height * 0.045, depth * 0.72], [0, -height * 0.46, depth * 0.02]);
}

function makeStairs(
  root: THREE.Group,
  [width, height, depth]: Vector3Tuple,
  materials: RoomObjectModelMaterials,
) {
  const stepCount = THREE.MathUtils.clamp(Math.round(depth / 0.24), 3, 12);
  const stepDepth = depth / stepCount;
  for (let index = 0; index < stepCount; index += 1) {
    const stepHeight = (height * (index + 1)) / stepCount;
    box(
      root,
      materials.primary,
      [width, stepHeight, stepDepth * 1.02],
      [
        0,
        -height / 2 + stepHeight / 2,
        depth / 2 - stepDepth * (index + 0.5),
      ],
    );
    box(
      root,
      materials.light,
      [width * 0.98, height * 0.025, stepDepth * 0.94],
      [
        0,
        -height / 2 + stepHeight + height * 0.012,
        depth / 2 - stepDepth * (index + 0.5),
      ],
    );
  }
}

export function createAiPrimitiveObjectModel({
  category,
  dimensions,
  model,
}: {
  category: string;
  dimensions: Vector3Tuple;
  model: RoomPrimitiveModel;
}) {
  const root = new THREE.Group();
  const content = new THREE.Group();
  const materials = new Map<string, THREE.Material>();
  root.userData.aiGenerated = true;
  root.userData.modelLabel = model.label;
  root.add(content);

  for (const part of model.parts) {
    const size: Vector3Tuple = [
      Math.max(part.size[0] * dimensions[0], MIN_PART_SIZE),
      Math.max(part.size[1] * dimensions[1], MIN_PART_SIZE),
      Math.max(part.size[2] * dimensions[2], MIN_PART_SIZE),
    ];
    const position: Vector3Tuple = [
      part.position[0] * dimensions[0],
      part.position[1] * dimensions[1],
      part.position[2] * dimensions[2],
    ];
    const rotation: Vector3Tuple = [
      THREE.MathUtils.degToRad(part.rotationDegrees[0]),
      THREE.MathUtils.degToRad(part.rotationDegrees[1]),
      THREE.MathUtils.degToRad(part.rotationDegrees[2]),
    ];
    const materialKey = `${part.colorHex ?? "default"}:${part.material}`;
    let material = materials.get(materialKey);
    if (!material) {
      material = primitiveMaterial(part.colorHex, part.material);
      materials.set(materialKey, material);
    }

    let geometry: THREE.BufferGeometry;
    if (part.primitive === "box") {
      geometry = new RoundedBoxGeometry(
        size[0],
        size[1],
        size[2],
        2,
        Math.min(Math.min(size[0], size[1], size[2]) * 0.08, 0.025),
      );
    } else if (part.primitive === "cylinder") {
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    } else {
      geometry = new THREE.SphereGeometry(0.5, 20, 14);
    }

    const mesh = new THREE.Mesh(geometry, material);
    if (part.primitive !== "box") mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    content.add(mesh);
  }

  fitAiContentToDimensions(content, dimensions, category);
  prioritizeFurnitureLightMap(root);
  return root;
}

export function createRoomObjectModel({
  variant,
  color,
  category,
  dimensions,
  materials,
}: {
  category: string;
  dimensions: Vector3Tuple;
  materials: RoomObjectModelMaterials;
  variant?: RoomFurnitureVariant | null;
  color?: string | null;
}) {
  const model = createBlenderFurnitureModel(variant ?? automaticRoomFurnitureVariant(category, dimensions), dimensions, color);
  if (model) return model;
  const root = new THREE.Group();
  const content = new THREE.Group();
  root.add(content);
  const builders: Record<
    string,
    (root: THREE.Group, dimensions: Vector3Tuple, materials: RoomObjectModelMaterials) => void
  > = {
    storage: makeStorage,
    wardrobe: makeStorage,
    sideboard: makeStorage,
    drawers: makeDrawers,
    bookcase: (root, size, material) => makeShelves(root, size, material),
    shelving: (root, size, material) => makeShelves(root, size, material, true),
    table: makeTable,
    chair: makeChair,
    sofa: makeSofa,
    bed: makeBed,
    refrigerator: makeRefrigerator,
    stove: makeStove,
    oven: makeOven,
    dishwasher: makeDishwasher,
    "washer-dryer": makeWasherDryer,
    sink: makeSink,
    toilet: makeToilet,
    bathtub: makeBathtub,
    fireplace: makeFireplace,
    television: makeTelevision,
    stairs: makeStairs,
  };
  const builder = builders[variant ?? category] ?? builders[variant ? roomFurnitureCatalog[variant].category : category];
  if (builder) {
    builder(content, dimensions, materials);
  } else {
    box(content, materials.primary, dimensions);
  }

  // RoomPlan's transform is centered on its measured bounding box. Keep every
  // decorative detail within that box and recenter the finished model so it is
  // a drop-in replacement for the former placeholder cuboid.
  fitContentToDimensions(content, dimensions);
  prioritizeFurnitureLightMap(root);
  return root;
}
