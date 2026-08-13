"use client";

import { Maximize2, ScanSearch } from "lucide-react";
import { useT } from "next-i18next/client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ClientRoomSceneManifest } from "@/lib/client-types";
import { createRoomObjectModel } from "@/components/room-object-models";

type CameraCommand = "reset" | "top";

type RoomSurface =
  ClientRoomSceneManifest["scan"]["scene"]["surfaces"][number];

type SurfaceRect = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

type WallAperture = {
  rect: SurfaceRect;
};

const objectColors: Record<string, number> = {
  storage: 0xb79a72,
  table: 0xc19566,
  chair: 0xa98768,
  sofa: 0x8792a8,
  bed: 0xad9fbb,
  refrigerator: 0xc2cbd1,
  stove: 0x747e86,
  oven: 0x737b82,
  dishwasher: 0xaab5bd,
  "washer-dryer": 0xb5bec4,
  sink: 0xd2d0c9,
  toilet: 0xd9d7d0,
  bathtub: 0xd7d4cc,
  fireplace: 0x9c7d68,
  television: 0x555c65,
  stairs: 0x9f9788,
};

type TexturePattern = "plaster" | "grain" | "speckle";

function textureNoise(x: number, y: number, seed: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43_758.5453;
  return value - Math.floor(value);
}

function patternValue(pattern: TexturePattern, x: number, y: number, seed: number) {
  const fine = textureNoise(x, y, seed) * 2 - 1;
  const broad = textureNoise(Math.floor(x / 9), Math.floor(y / 9), seed + 17) * 2 - 1;

  if (pattern === "grain") {
    const grain = Math.sin(x * 0.38 + Math.sin(y * 0.09 + seed) * 2.4);
    return grain * 0.68 + fine * 0.2 + broad * 0.12;
  }
  if (pattern === "plaster") {
    return fine * 0.36 + broad * 0.64;
  }
  return fine * 0.7 + broad * 0.3;
}

function createProceduralTexture({
  base,
  variation,
  pattern,
  seed,
  repeat,
  colorSpace = false,
  anisotropy,
}: {
  base: readonly [number, number, number];
  variation: number;
  pattern: TexturePattern;
  seed: number;
  repeat: readonly [number, number];
  colorSpace?: boolean;
  anisotropy: number;
}) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = Math.round(patternValue(pattern, x, y, seed) * variation);
      const index = (y * size + x) * 4;
      data[index] = THREE.MathUtils.clamp(base[0] + offset, 0, 255);
      data[index + 1] = THREE.MathUtils.clamp(base[1] + offset, 0, 255);
      data[index + 2] = THREE.MathUtils.clamp(base[2] + offset, 0, 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = anisotropy;
  if (colorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function normalizedDimensions(
  category: string,
  dimensions: [number, number, number],
) {
  const minimum =
    category === "floor"
      ? 0.025
      : category === "door"
        ? 0.065
        : category === "window"
          ? 0.045
          : 0.035;
  return dimensions.map((value) => Math.max(value, minimum)) as [
    number,
    number,
    number,
  ];
}

function setMatrix(object: THREE.Object3D, values: number[]) {
  object.matrixAutoUpdate = false;
  object.matrix.fromArray(values);
  object.matrixWorldNeedsUpdate = true;
}

function subtractRect(source: SurfaceRect, cutout: SurfaceRect) {
  const overlap = {
    left: Math.max(source.left, cutout.left),
    right: Math.min(source.right, cutout.right),
    bottom: Math.max(source.bottom, cutout.bottom),
    top: Math.min(source.top, cutout.top),
  };
  if (overlap.right - overlap.left <= 0.001 || overlap.top - overlap.bottom <= 0.001) {
    return [source];
  }

  const pieces: SurfaceRect[] = [];
  if (overlap.left - source.left > 0.001) {
    pieces.push({
      left: source.left,
      right: overlap.left,
      bottom: source.bottom,
      top: source.top,
    });
  }
  if (source.right - overlap.right > 0.001) {
    pieces.push({
      left: overlap.right,
      right: source.right,
      bottom: source.bottom,
      top: source.top,
    });
  }
  if (overlap.bottom - source.bottom > 0.001) {
    pieces.push({
      left: overlap.left,
      right: overlap.right,
      bottom: source.bottom,
      top: overlap.bottom,
    });
  }
  if (source.top - overlap.top > 0.001) {
    pieces.push({
      left: overlap.left,
      right: overlap.right,
      bottom: overlap.top,
      top: source.top,
    });
  }
  return pieces;
}

/**
 * RoomPlan reports doors, windows, and openings as separate surfaces that sit
 * on a wall plane. Associate each one with its closest compatible wall so the
 * wall can be built around it instead of behind it.
 */
function wallApertures(surfaces: RoomSurface[]) {
  const walls = surfaces.filter((surface) => surface.category === "wall");
  const apertures = surfaces.filter((surface) =>
    ["door", "window", "opening"].includes(surface.category),
  );
  const matches = new Map<string, WallAperture[]>();

  for (const aperture of apertures) {
    const apertureWidth = Math.max(aperture.dimensions[0], 0.04);
    const apertureHeight = Math.max(aperture.dimensions[1], 0.04);
    let best:
      | { wall: RoomSurface; rect: SurfaceRect; score: number }
      | undefined;

    for (const wall of walls) {
      const wallWidth = Math.max(wall.dimensions[0], 0.04);
      const wallHeight = Math.max(wall.dimensions[1], 0.04);
      const wallFromAperture = new THREE.Matrix4()
        .fromArray(wall.transform)
        .invert()
        .multiply(new THREE.Matrix4().fromArray(aperture.transform));
      const apertureNormal = new THREE.Vector3(0, 0, 1).transformDirection(
        wallFromAperture,
      );
      const normalAlignment = Math.abs(apertureNormal.z);
      if (normalAlignment < 0.82) continue;

      const corners = [
        new THREE.Vector3(-apertureWidth / 2, -apertureHeight / 2, 0),
        new THREE.Vector3(apertureWidth / 2, -apertureHeight / 2, 0),
        new THREE.Vector3(apertureWidth / 2, apertureHeight / 2, 0),
        new THREE.Vector3(-apertureWidth / 2, apertureHeight / 2, 0),
      ].map((corner) => corner.applyMatrix4(wallFromAperture));
      const planeDistance = Math.max(...corners.map((corner) => Math.abs(corner.z)));
      if (planeDistance > 0.24) continue;

      const projected = {
        left: Math.min(...corners.map((corner) => corner.x)),
        right: Math.max(...corners.map((corner) => corner.x)),
        bottom: Math.min(...corners.map((corner) => corner.y)),
        top: Math.max(...corners.map((corner) => corner.y)),
      };
      const wallBounds = {
        left: -wallWidth / 2,
        right: wallWidth / 2,
        bottom: -wallHeight / 2,
        top: wallHeight / 2,
      };
      const outside =
        Math.max(0, wallBounds.left - projected.left) +
        Math.max(0, projected.right - wallBounds.right) +
        Math.max(0, wallBounds.bottom - projected.bottom) +
        Math.max(0, projected.top - wallBounds.top);
      const overlapWidth =
        Math.min(projected.right, wallBounds.right) -
        Math.max(projected.left, wallBounds.left);
      const overlapHeight =
        Math.min(projected.top, wallBounds.top) -
        Math.max(projected.bottom, wallBounds.bottom);
      if (overlapWidth < 0.04 || overlapHeight < 0.04) continue;

      const cutoutPadding = 0.012;
      const rect = {
        left: Math.max(wallBounds.left, projected.left - cutoutPadding),
        right: Math.min(wallBounds.right, projected.right + cutoutPadding),
        bottom: Math.max(wallBounds.bottom, projected.bottom - cutoutPadding),
        top: Math.min(wallBounds.top, projected.top + cutoutPadding),
      };
      const score = planeDistance * 5 + (1 - normalAlignment) * 2 + outside * 3;
      if (!best || score < best.score) best = { wall, rect, score };
    }

    if (best) {
      const wallMatches = matches.get(best.wall.id) ?? [];
      wallMatches.push({ rect: best.rect });
      matches.set(best.wall.id, wallMatches);
    }
  }

  return matches;
}

export function RoomSceneCanvas({
  manifest,
  linkedManifests = [],
  selectedResourceId,
  onSelectResource,
}: {
  manifest: ClientRoomSceneManifest;
  linkedManifests?: ClientRoomSceneManifest[];
  selectedResourceId: string | null;
  onSelectResource: (resourceId: string) => void;
}) {
  const { t, i18n } = useT("spatial");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const hostRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<(command: CameraCommand) => void>(() => undefined);
  const selectionCommandRef = useRef<(resourceId: string | null) => void>(
    () => undefined,
  );
  const selectedResourceRef = useRef(selectedResourceId);
  const onSelectRef = useRef(onSelectResource);
  const [rendererError, setRendererError] = useState<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelectResource;
  }, [onSelectResource]);

  useEffect(() => {
    selectedResourceRef.current = selectedResourceId;
    selectionCommandRef.current(selectedResourceId);
  }, [selectedResourceId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setRendererError(null);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setRendererError(t("canvas.unsupported"));
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf3f5f7, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "block size-full touch-none";
    renderer.domElement.setAttribute(
      "aria-label",
      linkedManifests.length
        ? t("canvas.aria.multiple", {
            room: manifest.room.name,
            count: linkedManifests.length,
            value: integer.format(linkedManifests.length),
          })
        : t("canvas.aria.single", { room: manifest.room.name }),
    );
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf3f5f7, 18, 55);
    const roomEnvironment = new RoomEnvironment();
    const environmentGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = environmentGenerator.fromScene(roomEnvironment, 0.035);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.82;
    roomEnvironment.dispose();
    environmentGenerator.dispose();

    const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    const wallColorMap = createProceduralTexture({
      base: [242, 239, 233],
      variation: 7,
      pattern: "plaster",
      seed: 11,
      repeat: [5, 5],
      colorSpace: true,
      anisotropy,
    });
    const wallBumpMap = createProceduralTexture({
      base: [128, 128, 128],
      variation: 34,
      pattern: "plaster",
      seed: 29,
      repeat: [6, 6],
      anisotropy,
    });
    const floorColorMap = createProceduralTexture({
      base: [112, 91, 69],
      variation: 15,
      pattern: "grain",
      seed: 43,
      repeat: [6, 4],
      colorSpace: true,
      anisotropy,
    });
    const floorBumpMap = createProceduralTexture({
      base: [128, 128, 128],
      variation: 25,
      pattern: "grain",
      seed: 47,
      repeat: [6, 4],
      anisotropy,
    });
    const doorColorMap = createProceduralTexture({
      base: [177, 137, 96],
      variation: 18,
      pattern: "grain",
      seed: 59,
      repeat: [4, 2],
      colorSpace: true,
      anisotropy,
    });
    const objectColorMap = createProceduralTexture({
      base: [246, 242, 235],
      variation: 9,
      pattern: "speckle",
      seed: 71,
      repeat: [3, 3],
      colorSpace: true,
      anisotropy,
    });
    const objectBumpMap = createProceduralTexture({
      base: [128, 128, 128],
      variation: 22,
      pattern: "speckle",
      seed: 83,
      repeat: [4, 4],
      anisotropy,
    });
    const materialTextures = [
      wallColorMap,
      wallBumpMap,
      floorColorMap,
      floorBumpMap,
      doorColorMap,
      objectColorMap,
      objectBumpMap,
    ];

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wallColorMap,
      bumpMap: wallBumpMap,
      bumpScale: 0.012,
      roughness: 0.96,
      metalness: 0,
    });
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0xe4d8ca,
      map: floorColorMap,
      bumpMap: floorBumpMap,
      bumpScale: 0.008,
      roughness: 0.76,
      metalness: 0.01,
    });
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: doorColorMap,
      bumpMap: floorBumpMap,
      bumpScale: 0.007,
      roughness: 0.68,
      metalness: 0.01,
    });
    const doorDetailMaterial = new THREE.MeshStandardMaterial({
      color: 0xc08d5d,
      map: doorColorMap,
      roughness: 0.76,
      metalness: 0,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0ece4,
      map: wallColorMap,
      bumpMap: wallBumpMap,
      bumpScale: 0.006,
      roughness: 0.78,
      metalness: 0,
    });
    const windowFrameMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7eaeb,
      roughness: 0.5,
      metalness: 0.06,
    });
    const hardwareMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9a56f,
      roughness: 0.27,
      metalness: 0.82,
    });
    const windowMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x82b4c8,
      roughness: 0.12,
      metalness: 0,
      transmission: 0.42,
      transparent: true,
      opacity: 0.46,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const openingMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9d4ca,
      map: wallColorMap,
      roughness: 0.86,
      metalness: 0,
    });
    const objectMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const objectMaterial = (category: string) => {
      const cached = objectMaterials.get(category);
      if (cached) return cached;
      const material = new THREE.MeshStandardMaterial({
        color: objectColors[category] ?? 0xb09b84,
        map: objectColorMap,
        bumpMap: objectBumpMap,
        bumpScale: 0.006,
        roughness: 0.7,
        metalness: 0.025,
      });
      objectMaterials.set(category, material);
      return material;
    };
    const objectLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xe8e1d6,
      map: objectColorMap,
      bumpMap: objectBumpMap,
      bumpScale: 0.004,
      roughness: 0.72,
      metalness: 0.01,
    });
    const objectDarkMaterial = new THREE.MeshStandardMaterial({
      color: 0x30363d,
      roughness: 0.52,
      metalness: 0.12,
    });
    const objectMetalMaterial = new THREE.MeshStandardMaterial({
      color: 0xaeb7bd,
      roughness: 0.3,
      metalness: 0.72,
    });
    const objectGlassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x263947,
      roughness: 0.16,
      metalness: 0.12,
      transparent: true,
      opacity: 0.82,
    });
    const objectCeramicMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0efeb,
      roughness: 0.3,
      metalness: 0.02,
    });
    const objectWaterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x69abc1,
      roughness: 0.12,
      transmission: 0.24,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const objectWarmMaterial = new THREE.MeshStandardMaterial({
      color: 0xc87543,
      emissive: 0x6b2410,
      emissiveIntensity: 0.18,
      roughness: 0.68,
      metalness: 0,
    });
    const camera = new THREE.PerspectiveCamera(48, 1, 0.02, 250);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 0.35;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = true;

    const ambientLight = new THREE.HemisphereLight(0xfffaf1, 0x66758a, 1.45);
    scene.add(ambientLight);

    const sun = new THREE.DirectionalLight(0xfff1dc, 3.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.025;

    const fillLight = new THREE.DirectionalLight(0xdcecff, 1.15);
    const rimLight = new THREE.DirectionalLight(0xffe2c2, 0.7);
    scene.add(sun, sun.target, fillLight, fillLight.target, rimLight, rimLight.target);

    const visibleManifests = [manifest, ...linkedManifests];
    const webRoot = new THREE.Group();
    setMatrix(webRoot, manifest.scan.scene.webFromWorld);
    scene.add(webRoot);

    const addBox = ({
      parent,
      size,
      position = [0, 0, 0],
      material,
      castShadow = false,
      receiveShadow = true,
    }: {
      parent: THREE.Object3D;
      size: readonly [number, number, number];
      position?: readonly [number, number, number];
      material: THREE.Material;
      castShadow?: boolean;
      receiveShadow?: boolean;
    }) => {
      const geometry = new THREE.BoxGeometry(
        Math.max(size[0], 0.002),
        Math.max(size[1], 0.002),
        Math.max(size[2], 0.002),
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      return mesh;
    };

    const makeWallNode = (surface: RoomSurface, apertures: WallAperture[]) => {
      const [width, height, depth] = normalizedDimensions(
        surface.category,
        surface.dimensions,
      );
      let pieces: SurfaceRect[] = [
        {
          left: -width / 2,
          right: width / 2,
          bottom: -height / 2,
          top: height / 2,
        },
      ];
      for (const aperture of apertures) {
        pieces = pieces.flatMap((piece) => subtractRect(piece, aperture.rect));
      }

      const wall = new THREE.Group();
      setMatrix(wall, surface.transform);
      for (const piece of pieces) {
        addBox({
          parent: wall,
          size: [piece.right - piece.left, piece.top - piece.bottom, depth],
          position: [
            (piece.left + piece.right) / 2,
            (piece.bottom + piece.top) / 2,
            0,
          ],
          material: wallMaterial,
        });
      }
      return wall;
    };

    const makeDoorNode = (surface: RoomSurface) => {
      const [width, height, measuredDepth] = normalizedDimensions(
        surface.category,
        surface.dimensions,
      );
      const door = new THREE.Group();
      setMatrix(door, surface.transform);

      const frameWidth = THREE.MathUtils.clamp(
        Math.min(width, height) * 0.075,
        0.035,
        0.085,
      );
      const frameDepth = Math.max(measuredDepth, 0.1);
      const gap = Math.min(0.012, width * 0.025);
      const panelWidth = Math.max(width - frameWidth * 2 - gap * 2, 0.025);
      const panelHeight = Math.max(height - frameWidth - gap * 2, 0.025);
      const panelDepth = THREE.MathUtils.clamp(measuredDepth * 0.72, 0.035, 0.055);

      addBox({
        parent: door,
        size: [frameWidth, height, frameDepth],
        position: [-width / 2 + frameWidth / 2, 0, 0],
        material: trimMaterial,
        castShadow: true,
      });
      addBox({
        parent: door,
        size: [frameWidth, height, frameDepth],
        position: [width / 2 - frameWidth / 2, 0, 0],
        material: trimMaterial,
        castShadow: true,
      });
      addBox({
        parent: door,
        size: [width - frameWidth * 2, frameWidth, frameDepth],
        position: [0, height / 2 - frameWidth / 2, 0],
        material: trimMaterial,
        castShadow: true,
      });
      addBox({
        parent: door,
        size: [panelWidth, panelHeight, panelDepth],
        position: [0, -frameWidth / 2, 0],
        material: doorMaterial,
        castShadow: true,
      });

      if (panelWidth > 0.32 && panelHeight > 0.75) {
        const detailDepth = 0.009;
        const detailWidth = panelWidth * 0.68;
        const detailHeight = panelHeight * 0.28;
        for (const zDirection of [-1, 1]) {
          for (const y of [-panelHeight * 0.22, panelHeight * 0.2]) {
            addBox({
              parent: door,
              size: [detailWidth, detailHeight, detailDepth],
              position: [
                0,
                y - frameWidth / 2,
                zDirection * (panelDepth / 2 + detailDepth / 2),
              ],
              material: doorDetailMaterial,
              castShadow: true,
            });
          }
        }
      }

      if (panelWidth > 0.24 && panelHeight > 0.5) {
        const handleX = panelWidth * 0.34;
        const handleY = -height / 2 + Math.min(1, height * 0.48);
        const rosetteRadius = THREE.MathUtils.clamp(width * 0.032, 0.018, 0.032);
        for (const zDirection of [-1, 1]) {
          const rosette = new THREE.Mesh(
            new THREE.CylinderGeometry(
              rosetteRadius,
              rosetteRadius,
              0.014,
              20,
            ),
            hardwareMaterial,
          );
          rosette.position.set(
            handleX,
            handleY,
            zDirection * (panelDepth / 2 + 0.009),
          );
          rosette.rotation.x = Math.PI / 2;
          rosette.castShadow = true;
          door.add(rosette);
          addBox({
            parent: door,
            size: [rosetteRadius * 2.6, rosetteRadius * 0.48, 0.018],
            position: [
              handleX - rosetteRadius * 0.8,
              handleY,
              zDirection * (panelDepth / 2 + 0.022),
            ],
            material: hardwareMaterial,
            castShadow: true,
          });
        }
      }
      return door;
    };

    const makeWindowNode = (surface: RoomSurface) => {
      const [width, height, measuredDepth] = normalizedDimensions(
        surface.category,
        surface.dimensions,
      );
      const window = new THREE.Group();
      setMatrix(window, surface.transform);

      const frameWidth = THREE.MathUtils.clamp(
        Math.min(width, height) * 0.085,
        0.032,
        0.075,
      );
      const frameDepth = Math.max(measuredDepth, 0.085);
      const glassWidth = Math.max(width - frameWidth * 2, 0.02);
      const glassHeight = Math.max(height - frameWidth * 2, 0.02);

      addBox({
        parent: window,
        size: [glassWidth, glassHeight, 0.012],
        material: windowMaterial,
        receiveShadow: false,
      });
      for (const x of [-width / 2 + frameWidth / 2, width / 2 - frameWidth / 2]) {
        addBox({
          parent: window,
          size: [frameWidth, height, frameDepth],
          position: [x, 0, 0],
          material: windowFrameMaterial,
          castShadow: true,
        });
      }
      for (const y of [
        -height / 2 + frameWidth / 2,
        height / 2 - frameWidth / 2,
      ]) {
        addBox({
          parent: window,
          size: [width - frameWidth * 2, frameWidth, frameDepth],
          position: [0, y, 0],
          material: windowFrameMaterial,
          castShadow: true,
        });
      }
      if (glassWidth > 0.68) {
        addBox({
          parent: window,
          size: [frameWidth * 0.58, glassHeight, frameDepth * 0.82],
          material: windowFrameMaterial,
          castShadow: true,
        });
      }
      if (glassHeight > 1.05) {
        addBox({
          parent: window,
          size: [glassWidth, frameWidth * 0.58, frameDepth * 0.82],
          material: windowFrameMaterial,
          castShadow: true,
        });
      }
      addBox({
        parent: window,
        size: [width + 0.08, 0.032, frameDepth + 0.12],
        position: [0, -height / 2 + 0.012, 0.025],
        material: trimMaterial,
        castShadow: true,
      });
      return window;
    };

    const makeOpeningNode = (surface: RoomSurface) => {
      const [width, height, measuredDepth] = normalizedDimensions(
        surface.category,
        surface.dimensions,
      );
      const opening = new THREE.Group();
      setMatrix(opening, surface.transform);
      const trimWidth = THREE.MathUtils.clamp(
        Math.min(width, height) * 0.045,
        0.025,
        0.06,
      );
      const trimDepth = Math.max(measuredDepth, 0.075);
      for (const x of [-width / 2 + trimWidth / 2, width / 2 - trimWidth / 2]) {
        addBox({
          parent: opening,
          size: [trimWidth, height, trimDepth],
          position: [x, 0, 0],
          material: openingMaterial,
        });
      }
      addBox({
        parent: opening,
        size: [width - trimWidth * 2, trimWidth, trimDepth],
        position: [0, height / 2 - trimWidth / 2, 0],
        material: openingMaterial,
      });
      return opening;
    };

    for (const roomManifest of visibleManifests) {
      const modelRoot = new THREE.Group();
      setMatrix(modelRoot, roomManifest.scan.scene.worldFromModel);
      webRoot.add(modelRoot);

      const aperturesByWall = wallApertures(roomManifest.scan.scene.surfaces);

      for (const surface of roomManifest.scan.scene.surfaces) {
        if (surface.category === "wall") {
          modelRoot.add(makeWallNode(surface, aperturesByWall.get(surface.id) ?? []));
        } else if (surface.category === "door") {
          modelRoot.add(makeDoorNode(surface));
        } else if (surface.category === "window") {
          modelRoot.add(makeWindowNode(surface));
        } else if (surface.category === "opening") {
          modelRoot.add(makeOpeningNode(surface));
        } else {
          const dimensions = normalizedDimensions(surface.category, surface.dimensions);
          const geometry = new THREE.BoxGeometry(...dimensions);
          const mesh = new THREE.Mesh(geometry, floorMaterial);
          mesh.receiveShadow = true;
          setMatrix(mesh, surface.transform);
          modelRoot.add(mesh);
        }
      }

      for (const item of roomManifest.scan.scene.objects) {
        const dimensions = normalizedDimensions(item.category, item.dimensions);
        const objectModel = createRoomObjectModel({
          category: item.category,
          dimensions,
          materials: {
            primary: objectMaterial(item.category),
            light: objectLightMaterial,
            dark: objectDarkMaterial,
            metal: objectMetalMaterial,
            glass: objectGlassMaterial,
            ceramic: objectCeramicMaterial,
            water: objectWaterMaterial,
            warm: objectWarmMaterial,
          },
        });
        setMatrix(objectModel, item.transform);
        modelRoot.add(objectModel);
      }
    }

    const markerMeshes: THREE.Object3D[] = [];
    const markerStyles = new Map<
      string,
      {
        dot: THREE.Mesh;
        dotMaterial: THREE.MeshStandardMaterial;
        stemMaterial: THREE.MeshBasicMaterial;
        halo: THREE.Mesh;
      }
    >();
    for (const placement of visibleManifests.flatMap((item) => item.placements)) {
      const marker = new THREE.Group();
      marker.position.fromArray(placement.position);
      marker.userData.resourceId = placement.resource.id;

      const stemMaterial = new THREE.MeshBasicMaterial({
        color: 0x635bff,
        depthTest: false,
      });
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.16, 10),
        stemMaterial,
      );
      stem.position.y = 0.08;
      stem.renderOrder = 20;
      stem.userData.resourceId = placement.resource.id;
      marker.add(stem);

      const dotMaterial = new THREE.MeshStandardMaterial({
        color: 0x766fff,
        emissive: 0x241f83,
        emissiveIntensity: 0.25,
        roughness: 0.42,
        depthTest: false,
      });
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.058, 20, 14),
        dotMaterial,
      );
      dot.position.y = 0.18;
      dot.castShadow = true;
      dot.renderOrder = 20;
      dot.userData.resourceId = placement.resource.id;
      marker.add(dot);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.09, 0.125, 32),
        new THREE.MeshBasicMaterial({
          color: 0xffa05c,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
          depthTest: false,
        }),
      );
      halo.position.y = 0.18;
      halo.rotation.x = -Math.PI / 2;
      halo.renderOrder = 20;
      halo.visible = false;
      halo.userData.resourceId = placement.resource.id;
      marker.add(halo);

      markerMeshes.push(marker, ...marker.children);
      markerStyles.set(placement.resource.id, {
        dot,
        dotMaterial,
        stemMaterial,
        halo,
      });
      webRoot.add(marker);
    }

    const applySelection = (resourceId: string | null) => {
      for (const [id, style] of markerStyles) {
        const selected = id === resourceId;
        style.dot.scale.setScalar(selected ? 1.3 : 1);
        style.dotMaterial.color.setHex(selected ? 0xff8a36 : 0x766fff);
        style.dotMaterial.emissive.setHex(selected ? 0x8a2f00 : 0x241f83);
        style.stemMaterial.color.setHex(selected ? 0xf97316 : 0x635bff);
        style.halo.visible = selected;
      }
    };
    selectionCommandRef.current = applySelection;
    applySelection(selectedResourceRef.current);

    const box = visibleManifests.reduce((combined, roomManifest) => {
      const bounds = roomManifest.scan.scene.bounds;
      const modelBox = new THREE.Box3(
        new THREE.Vector3(...bounds.min),
        new THREE.Vector3(...bounds.max),
      );
      const modelToWeb = new THREE.Matrix4()
        .fromArray(manifest.scan.scene.webFromWorld)
        .multiply(new THREE.Matrix4().fromArray(roomManifest.scan.scene.worldFromModel));
      return combined.union(modelBox.applyMatrix4(modelToWeb));
    }, new THREE.Box3());
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1.5);
    sun.position.copy(center).add(new THREE.Vector3(radius * 1.25, radius * 2.4, radius * 1.15));
    sun.target.position.copy(center);
    fillLight.position
      .copy(center)
      .add(new THREE.Vector3(-radius * 1.6, radius * 1.1, -radius * 0.9));
    fillLight.target.position.copy(center);
    rimLight.position
      .copy(center)
      .add(new THREE.Vector3(radius * 0.25, radius * 1.4, -radius * 1.8));
    rimLight.target.position.copy(center);

    const shadowExtent = radius * 1.45;
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    sun.shadow.camera.near = Math.max(0.1, radius * 0.05);
    sun.shadow.camera.far = radius * 6;
    sun.shadow.camera.updateProjectionMatrix();
    const gridSize = Math.max(10, Math.ceil(Math.max(size.x, size.z) * 1.8));
    const grid = new THREE.GridHelper(gridSize, Math.max(10, gridSize * 2), 0xb5bcc6, 0xd8dde3);
    grid.position.set(center.x, box.min.y - 0.025, center.z);
    scene.add(grid);

    const resetCamera = () => {
      controls.target.copy(center);
      camera.up.set(0, 1, 0);
      camera.position.copy(
        center.clone().add(new THREE.Vector3(radius * 1.25, radius * 0.9, radius * 1.35)),
      );
      camera.near = Math.max(0.02, radius / 500);
      camera.far = Math.max(100, radius * 30);
      camera.updateProjectionMatrix();
      controls.update();
    };
    commandRef.current = (command) => {
      if (command === "top") {
        controls.target.copy(center);
        camera.up.set(0, 0, -1);
        camera.position.set(center.x, center.y + radius * 2.2, center.z + 0.001);
        camera.lookAt(center);
        controls.update();
      } else {
        resetCamera();
      }
    };
    resetCamera();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pointerStart) return;
      const travel = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      );
      pointerStart = null;
      if (travel > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(markerMeshes, true).find((intersection) => {
        let candidate: THREE.Object3D | null = intersection.object;
        while (candidate && !candidate.userData.resourceId) candidate = candidate.parent;
        return Boolean(candidate?.userData.resourceId);
      });
      if (!hit) return;
      let candidate: THREE.Object3D | null = hit.object;
      while (candidate && !candidate.userData.resourceId) candidate = candidate.parent;
      if (typeof candidate?.userData.resourceId === "string") {
        onSelectRef.current(candidate.userData.resourceId);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let animationFrame = 0;
    const draw = () => {
      animationFrame = requestAnimationFrame(draw);
      controls.update();
      renderer.render(scene, camera);
    };
    draw();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      const materials = new Set<THREE.Material>([
        wallMaterial,
        floorMaterial,
        doorMaterial,
        doorDetailMaterial,
        trimMaterial,
        windowFrameMaterial,
        hardwareMaterial,
        windowMaterial,
        openingMaterial,
        objectLightMaterial,
        objectDarkMaterial,
        objectMetalMaterial,
        objectGlassMaterial,
        objectCeramicMaterial,
        objectWaterMaterial,
        objectWarmMaterial,
        ...objectMaterials.values(),
      ]);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const meshMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          meshMaterials.forEach((material) => materials.add(material));
        }
      });
      materials.forEach((material) => material.dispose());
      materialTextures.forEach((texture) => texture.dispose());
      environmentTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      commandRef.current = () => undefined;
      selectionCommandRef.current = () => undefined;
    };
  }, [integer, linkedManifests, manifest, t]);

  return (
    <div ref={hostRef} className="relative size-full overflow-hidden bg-surface-muted">
      {rendererError ? (
        <div className="absolute inset-0 z-10 grid place-items-center p-8 text-center text-sm text-muted">
          {rendererError}
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex gap-2">
        <button
          type="button"
          onClick={() => commandRef.current("top")}
          className="pointer-events-auto grid size-9 place-items-center rounded-xl border border-border bg-surface/90 text-muted shadow-sm backdrop-blur transition hover:text-brand"
          title={t("canvas.topView")}
          aria-label={t("canvas.topView")}
        >
          <ScanSearch className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => commandRef.current("reset")}
          className="pointer-events-auto grid size-9 place-items-center rounded-xl border border-border bg-surface/90 text-muted shadow-sm backdrop-blur transition hover:text-brand"
          title={t("canvas.resetView")}
          aria-label={t("canvas.resetView")}
        >
          <Maximize2 className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg bg-surface/78 px-2.5 py-1.5 text-[10px] font-medium text-muted shadow-sm backdrop-blur">
        {t("canvas.controlsHint")}
      </div>
    </div>
  );
}
