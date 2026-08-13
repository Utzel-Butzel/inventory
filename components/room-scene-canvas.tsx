"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Cuboid,
  Footprints,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  ScanSearch,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import Image from "next/image";
import { useT } from "next-i18next/client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ClientRoomSceneManifest } from "@/lib/client-types";
import { createRoomObjectModel } from "@/components/room-object-models";
import { cn } from "@/components/ui";
import {
  hasPlyHeader,
  maximumGaussianSplatBytes,
  maximumGaussianSplatPoints,
  maximumTexturedMeshBytes,
  parseSampledGaussianSplat,
  roomKeyframeDisplayOrientation,
  sampleRoomKeyframes,
  selectPhotorealAssetBudget,
  type SampledGaussianSplat,
  type RoomCameraKeyframe,
  type RoomPhotorealAssetKind,
  validateEmbeddedGlb,
} from "@/lib/room-scene-visualization";

type CameraCommand = "reset" | "top";
type SceneMode = "roomplan" | RoomPhotorealAssetKind;
type NavigationMode = "orbit" | "walk";
type AssetLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "partial"
  | "error"
  | "too-large";

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

type LocatedRoomCameraKeyframe = RoomCameraKeyframe & { roomScanId: string };

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

type RoomSceneAsset = ClientRoomSceneManifest["scan"]["assets"][number];

const keyframesForManifest = (manifest: ClientRoomSceneManifest) =>
  (manifest.scan.keyframes ?? []).map((frame) => ({
    ...frame,
    roomScanId: manifest.scan.id,
  }));

const photorealAsset = (
  manifest: ClientRoomSceneManifest,
  kind: RoomPhotorealAssetKind,
) => manifest.scan.assets.find((asset) => String(asset.kind) === kind);

function keyframeFrustumGeometry(frame: RoomCameraKeyframe) {
  const depth = 0.22;
  const fx = Math.max(frame.intrinsics[0] ?? 1, 1);
  const fy = Math.max(frame.intrinsics[4] ?? 1, 1);
  const cx = frame.intrinsics[6] ?? frame.width / 2;
  const cy = frame.intrinsics[7] ?? frame.height / 2;
  const corner = (u: number, v: number) =>
    new THREE.Vector3(
      ((u - cx) / fx) * depth,
      -((v - cy) / fy) * depth,
      -depth,
    );
  const corners = [
    corner(0, 0),
    corner(frame.width, 0),
    corner(frame.width, frame.height),
    corner(0, frame.height),
  ];
  const origin = new THREE.Vector3();
  const points: THREE.Vector3[] = [];
  for (const item of corners) points.push(origin, item);
  for (let index = 0; index < corners.length; index += 1) {
    points.push(corners[index]!, corners[(index + 1) % corners.length]!);
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

function createSampledSplatGeometry(sampled: SampledGaussianSplat) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(sampled.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(sampled.colors, 3));
  geometry.setAttribute("splatOpacity", new THREE.BufferAttribute(sampled.opacity, 1));
  geometry.setAttribute("splatScale", new THREE.BufferAttribute(sampled.scale, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createSplatMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      viewportHeight: { value: 720 },
    },
    vertexShader: `
      attribute float splatOpacity;
      attribute float splatScale;
      varying vec3 vColor;
      varying float vOpacity;
      uniform float viewportHeight;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(
          splatScale * viewportHeight / max(0.01, -viewPosition.z),
          1.25,
          28.0
        );
        vColor = color;
        vOpacity = splatOpacity;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radiusSquared = dot(centered, centered);
        if (radiusSquared > 0.25) discard;
        float gaussian = exp(-radiusSquared * 15.0);
        gl_FragColor = vec4(vColor, gaussian * vOpacity);
      }
    `,
  });
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
  const keyframeCommandRef = useRef<
    (visible: boolean, selectedId: string | null) => void
  >(() => undefined);
  const walkCommandRef = useRef<
    (direction: "forward" | "backward" | "left" | "right", active: boolean) => void
  >(() => undefined);
  const selectedResourceRef = useRef(selectedResourceId);
  const keyframesVisibleRef = useRef(false);
  const selectedKeyframeRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelectResource);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("roomplan");
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit");
  const [assetLoadState, setAssetLoadState] = useState<AssetLoadState>("idle");
  const [showKeyframes, setShowKeyframes] = useState(false);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const visibleManifests = useMemo(
    () => [manifest, ...linkedManifests],
    [linkedManifests, manifest],
  );
  const visibleKeyframes = useMemo(
    () => sampleRoomKeyframes(visibleManifests.flatMap(keyframesForManifest)),
    [visibleManifests],
  );
  const selectedKeyframe = visibleKeyframes.find(
    (frame) => frame.id === selectedKeyframeId,
  ) ?? null;
  const selectedKeyframeDisplay = selectedKeyframe
    ? roomKeyframeDisplayOrientation(selectedKeyframe.orientation)
    : null;
  const availableModes = useMemo(
    () => ({
      textured_mesh: visibleManifests.some((item) =>
        Boolean(photorealAsset(item, "textured_mesh")),
      ),
      gaussian_splat: visibleManifests.some((item) =>
        Boolean(photorealAsset(item, "gaussian_splat")),
      ),
    }),
    [visibleManifests],
  );

  useEffect(() => {
    onSelectRef.current = onSelectResource;
  }, [onSelectResource]);

  useEffect(() => {
    selectedResourceRef.current = selectedResourceId;
    selectionCommandRef.current(selectedResourceId);
  }, [selectedResourceId]);

  useEffect(() => {
    if (sceneMode !== "roomplan" && !availableModes[sceneMode]) {
      setSceneMode("roomplan");
    }
  }, [availableModes, sceneMode]);

  useEffect(() => {
    keyframesVisibleRef.current = showKeyframes;
    selectedKeyframeRef.current = selectedKeyframeId;
    if (
      selectedKeyframeId &&
      !visibleKeyframes.some((frame) => frame.id === selectedKeyframeId)
    ) {
      setSelectedKeyframeId(null);
      return;
    }
    keyframeCommandRef.current(showKeyframes, selectedKeyframeId);
  }, [selectedKeyframeId, showKeyframes, visibleKeyframes]);

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
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      "aria-label",
      visibleManifests.length > 1
        ? t("canvas.aria.multiple", {
            room: manifest.room.name,
            count: visibleManifests.length - 1,
            value: integer.format(visibleManifests.length - 1),
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
    controls.enabled = navigationMode === "orbit";
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

    const webRoot = new THREE.Group();
    setMatrix(webRoot, manifest.scan.scene.webFromWorld);
    scene.add(webRoot);
    const assetAbortController = new AbortController();
    const roomPlanRoots = new Map<string, THREE.Object3D>();
    const roomWorldRoots = new Map<string, THREE.Group>();
    const roomWorldDeltas = new Map<string, THREE.Matrix4>();
    const wallColliderMeshes: THREE.Mesh[] = [];
    const splatMaterials = new Set<THREE.ShaderMaterial>();
    let disposed = false;

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
        wallColliderMeshes.push(addBox({
          parent: wall,
          size: [piece.right - piece.left, piece.top - piece.bottom, depth],
          position: [
            (piece.left + piece.right) / 2,
            (piece.bottom + piece.top) / 2,
            0,
          ],
          material: wallMaterial,
        }));
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
      if (navigationMode !== "walk") {
        addBox({
          parent: door,
          size: [panelWidth, panelHeight, panelDepth],
          position: [0, -frameWidth / 2, 0],
          material: doorMaterial,
          castShadow: true,
        });
      }

      if (navigationMode !== "walk" && panelWidth > 0.32 && panelHeight > 0.75) {
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

      if (navigationMode !== "walk" && panelWidth > 0.24 && panelHeight > 0.5) {
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

      wallColliderMeshes.push(addBox({
        parent: window,
        size: [glassWidth, glassHeight, 0.012],
        material: windowMaterial,
        receiveShadow: false,
      }));
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
      const capturedModelTransform = new THREE.Matrix4().fromArray(
        roomManifest.scan.scene.worldFromModel,
      );
      const layoutModelTransform = new THREE.Matrix4().fromArray(
        roomManifest.scan.layoutTransform ??
          roomManifest.scan.scene.worldFromModel,
      );
      const worldDelta = layoutModelTransform
        .clone()
        .multiply(capturedModelTransform.clone().invert());
      const roomWorldRoot = new THREE.Group();
      setMatrix(roomWorldRoot, worldDelta.toArray());
      webRoot.add(roomWorldRoot);
      roomWorldRoots.set(roomManifest.scan.id, roomWorldRoot);
      roomWorldDeltas.set(roomManifest.scan.id, worldDelta);

      const modelRoot = new THREE.Group();
      setMatrix(modelRoot, roomManifest.scan.scene.worldFromModel);
      roomWorldRoot.add(modelRoot);
      roomPlanRoots.set(roomManifest.scan.id, modelRoot);

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

    const loadPhotorealAsset = async (
      roomManifest: ClientRoomSceneManifest,
      asset: RoomSceneAsset,
      mode: RoomPhotorealAssetKind,
    ) => {
      const limit = mode === "textured_mesh"
        ? maximumTexturedMeshBytes
        : maximumGaussianSplatBytes;
      if (asset.size > limit) throw new RangeError("asset-too-large");

      const response = await fetch(asset.url, {
        cache: "force-cache",
        credentials: "same-origin",
        signal: assetAbortController.signal,
      });
      if (!response.ok) {
        throw new Error(`Room asset request failed (HTTP ${response.status}).`);
      }
      const advertisedSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(advertisedSize) && advertisedSize > limit) {
        throw new RangeError("asset-too-large");
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > limit) throw new RangeError("asset-too-large");

      let object: THREE.Object3D;
      if (mode === "textured_mesh") {
        const validation = validateEmbeddedGlb(bytes);
        if (!validation.valid) throw new Error(validation.error);
        const { GLTFLoader } = await import(
          "three/examples/jsm/loaders/GLTFLoader.js"
        );
        const gltf = await new GLTFLoader().parseAsync(bytes, "");
        object = gltf.scene;
        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = false;
            child.receiveShadow = true;
          }
        });
      } else {
        if (!hasPlyHeader(bytes)) throw new Error("The point cloud is not PLY.");
        const sampled = parseSampledGaussianSplat(
          bytes,
          maximumGaussianSplatPoints,
        );
        const geometry = createSampledSplatGeometry(sampled);
        const material = createSplatMaterial();
        splatMaterials.add(material);
        object = new THREE.Points(geometry, material);
        object.frustumCulled = true;
      }

      if (disposed) {
        object.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
            child.geometry.dispose();
          }
        });
        return false;
      }
      object.userData.photorealAsset = mode;
      object.userData.roomScanId = roomManifest.scan.id;
      (roomWorldRoots.get(roomManifest.scan.id) ?? webRoot).add(object);
      roomPlanRoots.get(roomManifest.scan.id)!.visible = false;
      return true;
    };

    if (sceneMode === "roomplan") {
      setAssetLoadState("idle");
    } else {
      const assets = visibleManifests.flatMap((roomManifest) => {
        const asset = photorealAsset(roomManifest, sceneMode);
        return asset ? [{ roomManifest, asset }] : [];
      });
      const limit = sceneMode === "textured_mesh"
        ? maximumTexturedMeshBytes
        : maximumGaussianSplatBytes;
      const budget = selectPhotorealAssetBudget(
        assets.map(({ asset }) => asset),
        limit,
      );
      const selectedAssets = new Set(budget.selected);
      const loadable = assets.filter(({ asset }) => selectedAssets.has(asset));
      setAssetLoadState(loadable.length ? "loading" : "too-large");
      if (loadable.length) {
        // Decode sequentially. A linked floor may contain several 80 MB
        // derivatives, and concurrent GLTF/image decoding can multiply memory.
        void (async () => {
          const results: PromiseSettledResult<boolean>[] = [];
          for (const { roomManifest, asset } of loadable) {
            try {
              results.push({
                status: "fulfilled",
                value: await loadPhotorealAsset(roomManifest, asset, sceneMode),
              });
            } catch (reason) {
              results.push({ status: "rejected", reason });
            }
          }
          if (disposed) return;
          const loaded = results.some(
            (result) => result.status === "fulfilled" && result.value,
          );
          const tooLarge = results.some(
            (result) =>
              result.status === "rejected" && result.reason instanceof RangeError,
          );
          const incomplete = budget.skipped > 0 || results.some(
            (result) => result.status === "rejected",
          );
          setAssetLoadState(
            loaded
              ? incomplete
                ? "partial"
                : "ready"
              : tooLarge
                ? "too-large"
                : "error",
          );
        })();
      }
    }

    const keyframeRoot = new THREE.Group();
    keyframeRoot.visible = keyframesVisibleRef.current;
    webRoot.add(keyframeRoot);
    const keyframeMeshes: THREE.Object3D[] = [];
    const keyframeStyles = new Map<
      string,
      { line: THREE.LineBasicMaterial; body: THREE.MeshBasicMaterial }
    >();
    for (const frame of visibleKeyframes) {
      const pose = new THREE.Group();
      const poseTransform = (roomWorldDeltas.get(frame.roomScanId) ?? new THREE.Matrix4())
        .clone()
        .multiply(new THREE.Matrix4().fromArray(frame.cameraTransform));
      setMatrix(pose, poseTransform.toArray());
      pose.userData.keyframeId = frame.id;

      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x15a4b8,
        transparent: true,
        opacity: 0.72,
        depthTest: false,
      });
      const frustum = new THREE.LineSegments(
        keyframeFrustumGeometry(frame),
        lineMaterial,
      );
      frustum.renderOrder = 25;
      frustum.userData.keyframeId = frame.id;
      pose.add(frustum);

      const bodyMaterial = new THREE.MeshBasicMaterial({
        color: 0x137b8a,
        depthTest: false,
      });
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.052, 0.035, 0.024),
        bodyMaterial,
      );
      body.renderOrder = 25;
      body.userData.keyframeId = frame.id;
      pose.add(body);

      keyframeStyles.set(frame.id, {
        line: lineMaterial,
        body: bodyMaterial,
      });
      keyframeMeshes.push(pose, frustum, body);
      keyframeRoot.add(pose);
    }

    const photoPose = new THREE.Group();
    photoPose.visible = false;
    const photoPlaneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      depthTest: true,
    });
    const photoPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      photoPlaneMaterial,
    );
    photoPlane.position.z = -0.34;
    photoPlane.renderOrder = 18;
    photoPose.add(photoPlane);
    webRoot.add(photoPose);

    let photoRequestController: AbortController | null = null;
    let photoTexture: THREE.Texture | null = null;
    let photoBitmap: ImageBitmap | null = null;
    let loadedPhotoFrameId: string | null = null;
    let photoGeneration = 0;
    const loadPhotoPlane = async (frame: LocatedRoomCameraKeyframe) => {
      photoRequestController?.abort();
      const request = new AbortController();
      photoRequestController = request;
      const generation = ++photoGeneration;
      try {
        const response = await fetch(frame.url, {
          cache: "force-cache",
          credentials: "same-origin",
          signal: request.signal,
        });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!blob.type.startsWith("image/jpeg") || blob.size > 8 * 1024 * 1024) return;
        // ImageBitmap uploads ignore THREE.Texture.flipY. Flip here so the
        // native camera raster aligns with PlaneGeometry's WebGL UV origin;
        // its stored orientation is intentionally only used by the 2D preview.
        const bitmap = await createImageBitmap(blob, {
          imageOrientation: "flipY",
        });
        if (disposed || generation !== photoGeneration) {
          bitmap.close();
          return;
        }
        photoTexture?.dispose();
        photoBitmap?.close();
        photoBitmap = bitmap;
        photoTexture = new THREE.Texture(bitmap);
        photoTexture.colorSpace = THREE.SRGBColorSpace;
        photoTexture.minFilter = THREE.LinearMipmapLinearFilter;
        photoTexture.magFilter = THREE.LinearFilter;
        photoTexture.generateMipmaps = true;
        photoTexture.needsUpdate = true;
        photoPlaneMaterial.map = photoTexture;
        photoPlaneMaterial.needsUpdate = true;
        loadedPhotoFrameId = frame.id;
        photoPose.visible = keyframeRoot.visible;
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          photoPose.visible = false;
        }
      }
    };

    const applyKeyframeSelection = (
      visible: boolean,
      selectedId: string | null,
    ) => {
      keyframeRoot.visible = visible;
      for (const [id, style] of keyframeStyles) {
        const selected = id === selectedId;
        style.line.color.setHex(selected ? 0xff7a2f : 0x15a4b8);
        style.line.opacity = selected ? 1 : 0.72;
        style.body.color.setHex(selected ? 0xff7a2f : 0x137b8a);
      }
      const frame = visibleKeyframes.find((item) => item.id === selectedId);
      photoPose.visible = Boolean(
        visible && frame && photoPlaneMaterial.map && loadedPhotoFrameId === frame.id,
      );
      if (!visible || !frame) {
        photoRequestController?.abort();
        photoGeneration += 1;
        return;
      }
      const photoTransform = (roomWorldDeltas.get(frame.roomScanId) ?? new THREE.Matrix4())
        .clone()
        .multiply(new THREE.Matrix4().fromArray(frame.cameraTransform));
      setMatrix(photoPose, photoTransform.toArray());
      const depth = 0.34;
      const fx = Math.max(frame.intrinsics[0] ?? 1, 1);
      const fy = Math.max(frame.intrinsics[4] ?? 1, 1);
      const cx = frame.intrinsics[6] ?? frame.width / 2;
      const cy = frame.intrinsics[7] ?? frame.height / 2;
      const planeWidth = (frame.width / fx) * depth;
      const planeHeight = (frame.height / fy) * depth;
      // ARKit intrinsics describe the native camera raster. Keep that raster
      // unrotated on the 3D plane so every texel follows the pinhole projection;
      // `orientation` is applied only by the separate 2D preview below.
      // Preserve a potentially off-center principal point instead of centering
      // a merely aspect-correct rectangle in front of the camera.
      photoPlane.position.set(
        ((frame.width / 2 - cx) / fx) * depth,
        ((cy - frame.height / 2) / fy) * depth,
        -depth,
      );
      photoPlane.scale.set(planeWidth, planeHeight, 1);
      if (loadedPhotoFrameId !== frame.id) void loadPhotoPlane(frame);
    };
    keyframeCommandRef.current = applyKeyframeSelection;
    applyKeyframeSelection(
      keyframesVisibleRef.current,
      selectedKeyframeRef.current,
    );

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
    for (const roomManifest of visibleManifests) {
      for (const placement of roomManifest.placements) {
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
        (roomWorldRoots.get(roomManifest.scan.id) ?? webRoot).add(marker);
      }
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

    const boundsForManifest = (roomManifest: ClientRoomSceneManifest) => {
      const bounds = roomManifest.scan.scene.bounds;
      const modelBox = new THREE.Box3(
        new THREE.Vector3(...bounds.min),
        new THREE.Vector3(...bounds.max),
      );
      const modelToWeb = new THREE.Matrix4()
        .fromArray(manifest.scan.scene.webFromWorld)
        .multiply(new THREE.Matrix4().fromArray(
          roomManifest.scan.layoutTransform ??
            roomManifest.scan.scene.worldFromModel,
        ));
      return modelBox.applyMatrix4(modelToWeb);
    };
    const primaryBox = boundsForManifest(manifest);
    const box = visibleManifests.reduce((combined, roomManifest) => {
      return combined.union(boundsForManifest(roomManifest));
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

    webRoot.updateMatrixWorld(true);
    const playerRadius = 0.2;
    const eyeHeight = 1.62;
    const collisionBoxes = wallColliderMeshes.map((mesh) =>
      new THREE.Box3().setFromObject(mesh).expandByScalar(playerRadius),
    );
    const walkFloorY = primaryBox.min.y;
    const pressedKeys = new Set<string>();
    const virtualKeys = new Set<string>();
    let walkYaw = 0;
    let walkPitch = 0;

    const applyWalkRotation = () => {
      camera.rotation.order = "YXZ";
      camera.rotation.y = walkYaw;
      camera.rotation.x = walkPitch;
      camera.rotation.z = 0;
    };
    const resetWalkCamera = () => {
      controls.enabled = false;
      camera.up.set(0, 1, 0);
      const walkStart = primaryBox.getCenter(new THREE.Vector3());
      camera.position.set(walkStart.x, walkFloorY + eyeHeight, walkStart.z);
      walkYaw = 0;
      walkPitch = 0;
      applyWalkRotation();
      camera.near = 0.02;
      camera.far = Math.max(100, radius * 30);
      camera.updateProjectionMatrix();
    };

    const resetCamera = () => {
      if (navigationMode === "walk") {
        resetWalkCamera();
        return;
      }
      controls.enabled = true;
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
      if (command === "top" && navigationMode === "orbit") {
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

    const movementKey = (key: string) =>
      ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(
        key.toLowerCase(),
      );
    const onKeyDown = (event: KeyboardEvent) => {
      if (navigationMode !== "walk" || !movementKey(event.key)) return;
      event.preventDefault();
      pressedKeys.add(event.key.toLowerCase());
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.key.toLowerCase());
    };
    const virtualKey = {
      forward: "w",
      backward: "s",
      left: "a",
      right: "d",
    } as const;
    walkCommandRef.current = (direction, active) => {
      if (active) virtualKeys.add(virtualKey[direction]);
      else virtualKeys.delete(virtualKey[direction]);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (
        navigationMode !== "walk" ||
        document.pointerLockElement !== renderer.domElement
      ) return;
      walkYaw -= event.movementX * 0.0022;
      walkPitch = THREE.MathUtils.clamp(
        walkPitch - event.movementY * 0.0018,
        -Math.PI * 0.46,
        Math.PI * 0.46,
      );
      applyWalkRotation();
    };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0.065;
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;
    let touchLook: { id: number; x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (navigationMode === "walk") {
        renderer.domElement.focus({ preventScroll: true });
        if (event.pointerType === "mouse") {
          void renderer.domElement.requestPointerLock?.();
        } else {
          touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
          renderer.domElement.setPointerCapture(event.pointerId);
        }
      }
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (
        navigationMode !== "walk" ||
        !touchLook ||
        touchLook.id !== event.pointerId
      ) return;
      walkYaw -= (event.clientX - touchLook.x) * 0.006;
      walkPitch = THREE.MathUtils.clamp(
        walkPitch - (event.clientY - touchLook.y) * 0.005,
        -Math.PI * 0.46,
        Math.PI * 0.46,
      );
      touchLook = { id: event.pointerId, x: event.clientX, y: event.clientY };
      applyWalkRotation();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (touchLook?.id === event.pointerId) touchLook = null;
      if (!pointerStart) return;
      const travel = Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      );
      pointerStart = null;
      if (navigationMode === "walk") return;
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
      if (hit) {
        let candidate: THREE.Object3D | null = hit.object;
        while (candidate && !candidate.userData.resourceId) candidate = candidate.parent;
        if (typeof candidate?.userData.resourceId === "string") {
          onSelectRef.current(candidate.userData.resourceId);
          return;
        }
      }
      if (!keyframeRoot.visible) return;
      const frameHit = raycaster
        .intersectObjects(keyframeMeshes, true)
        .find((intersection) => {
          let candidate: THREE.Object3D | null = intersection.object;
          while (candidate && !candidate.userData.keyframeId) {
            candidate = candidate.parent;
          }
          return Boolean(candidate?.userData.keyframeId);
        });
      if (frameHit) {
        let candidate: THREE.Object3D | null = frameHit.object;
        while (candidate && !candidate.userData.keyframeId) candidate = candidate.parent;
        if (typeof candidate?.userData.keyframeId === "string") {
          setSelectedKeyframeId(candidate.userData.keyframeId);
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      splatMaterials.forEach((material) => {
        material.uniforms.viewportHeight!.value = height * renderer.getPixelRatio();
      });
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let animationFrame = 0;
    const clock = new THREE.Clock();
    const draw = () => {
      animationFrame = requestAnimationFrame(draw);
      const delta = Math.min(clock.getDelta(), 0.05);
      if (navigationMode === "walk") {
        const active = (key: string) => pressedKeys.has(key) || virtualKeys.has(key);
        const forwardAmount = Number(active("w") || active("arrowup")) -
          Number(active("s") || active("arrowdown"));
        const sideAmount = Number(active("d") || active("arrowright")) -
          Number(active("a") || active("arrowleft"));
        if (forwardAmount || sideAmount) {
          const forward = new THREE.Vector3(-Math.sin(walkYaw), 0, -Math.cos(walkYaw));
          const right = new THREE.Vector3(Math.cos(walkYaw), 0, -Math.sin(walkYaw));
          const movement = forward
            .multiplyScalar(forwardAmount)
            .add(right.multiplyScalar(sideAmount))
            .normalize()
            .multiplyScalar(delta * 2.1);
          const blocked = (position: THREE.Vector3) =>
            collisionBoxes.some((bounds) => bounds.containsPoint(position));
          const candidate = camera.position.clone().add(movement);
          candidate.y = walkFloorY + eyeHeight;
          if (!blocked(candidate)) {
            camera.position.copy(candidate);
          } else {
            const xOnly = camera.position.clone();
            xOnly.x += movement.x;
            if (!blocked(xOnly)) camera.position.x = xOnly.x;
            const zOnly = camera.position.clone();
            zOnly.z += movement.z;
            if (!blocked(zOnly)) camera.position.z = zOnly.z;
          }
        }
        camera.position.y = walkFloorY + eyeHeight;
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
    };
    draw();

    return () => {
      disposed = true;
      assetAbortController.abort();
      photoRequestController?.abort();
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
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
      const textures = new Set<THREE.Texture>(materialTextures);
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments ||
          object instanceof THREE.Points
        ) {
          object.geometry.dispose();
          const meshMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          meshMaterials.forEach((material) => {
            materials.add(material);
            Object.values(material).forEach((value) => {
              if (value instanceof THREE.Texture) textures.add(value);
            });
          });
        }
      });
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      photoBitmap?.close();
      environmentTarget.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      commandRef.current = () => undefined;
      selectionCommandRef.current = () => undefined;
      keyframeCommandRef.current = () => undefined;
      walkCommandRef.current = () => undefined;
    };
  }, [integer, manifest, navigationMode, sceneMode, t, visibleKeyframes, visibleManifests]);

  return (
    <div ref={hostRef} className="relative size-full overflow-hidden bg-surface-muted">
      {rendererError ? (
        <div className="absolute inset-0 z-10 grid place-items-center p-8 text-center text-sm text-muted">
          {rendererError}
        </div>
      ) : null}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%_-_7rem)] flex-col items-start gap-2">
        <div
          className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-surface/92 p-1 shadow-sm backdrop-blur"
          role="group"
          aria-label={t("canvas.visualMode")}
        >
          <button
            type="button"
            onClick={() => setSceneMode("roomplan")}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
              sceneMode === "roomplan"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            aria-pressed={sceneMode === "roomplan"}
          >
            <Cuboid className="size-3.5" aria-hidden="true" />
            {t("canvas.modes.roomplan")}
          </button>
          {availableModes.textured_mesh ? (
            <button
              type="button"
              onClick={() => setSceneMode("textured_mesh")}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
                sceneMode === "textured_mesh"
                  ? "bg-brand-solid text-on-brand"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
              aria-pressed={sceneMode === "textured_mesh"}
            >
              <ImageIcon className="size-3.5" aria-hidden="true" />
              {t("canvas.modes.textured")}
            </button>
          ) : null}
          {availableModes.gaussian_splat ? (
            <button
              type="button"
              onClick={() => setSceneMode("gaussian_splat")}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
                sceneMode === "gaussian_splat"
                  ? "bg-brand-solid text-on-brand"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
              aria-pressed={sceneMode === "gaussian_splat"}
            >
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("canvas.modes.splat")}
            </button>
          ) : null}
        </div>

        {sceneMode !== "roomplan" && assetLoadState !== "ready" ? (
          <div
            className={cn(
              "pointer-events-none inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium shadow-sm backdrop-blur",
              assetLoadState === "loading"
                ? "border-border bg-surface/90 text-muted"
                : "border-warning-border bg-warning-soft/95 text-warning-strong",
            )}
            role="status"
          >
            {assetLoadState === "loading" ? (
              <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <TriangleAlert className="size-3" aria-hidden="true" />
            )}
            {assetLoadState === "loading"
              ? t("canvas.asset.loading")
              : assetLoadState === "too-large"
                ? t("canvas.asset.tooLarge")
                : assetLoadState === "partial"
                  ? t("canvas.asset.partial")
                : t("canvas.asset.failed")}
          </div>
        ) : null}

        {visibleKeyframes.length ? (
          <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-xl border border-border bg-surface/92 p-1 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => setShowKeyframes((current) => !current)}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
                showKeyframes
                  ? "bg-brand-soft text-brand-strong"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
              aria-pressed={showKeyframes}
            >
              <Camera className="size-3.5" aria-hidden="true" />
              {t("canvas.keyframes.toggle", {
                count: visibleKeyframes.length,
                value: integer.format(visibleKeyframes.length),
              })}
            </button>
            {showKeyframes ? (
              <select
                value={selectedKeyframeId ?? ""}
                onChange={(event) => setSelectedKeyframeId(event.target.value || null)}
                className="h-8 min-w-0 max-w-44 rounded-lg border-0 bg-surface-muted px-2 text-[10px] font-medium text-foreground outline-none focus:ring-2 focus:ring-focus/30"
                aria-label={t("canvas.keyframes.select")}
              >
                <option value="">{t("canvas.keyframes.select")}</option>
                {visibleKeyframes.map((frame, index) => (
                  <option key={frame.id} value={frame.id}>
                    {t("canvas.keyframes.option", {
                      index: integer.format(index + 1),
                      quality: integer.format(Math.round(frame.quality * 100)),
                    })}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex gap-2">
        <button
          type="button"
          onClick={() => setNavigationMode((current) =>
            current === "walk" ? "orbit" : "walk")}
          className={cn(
            "pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[10px] font-semibold shadow-sm backdrop-blur transition",
            navigationMode === "walk"
              ? "border-brand-border bg-brand-solid text-on-brand"
              : "border-border bg-surface/90 text-muted hover:text-brand",
          )}
          title={t("canvas.walk.toggle")}
          aria-label={t("canvas.walk.toggle")}
          aria-pressed={navigationMode === "walk"}
        >
          <Footprints className="size-3.5" aria-hidden="true" />
          {navigationMode === "walk"
            ? t("canvas.walk.exit")
            : t("canvas.walk.enter")}
        </button>
        {navigationMode === "orbit" ? (
          <button
            type="button"
            onClick={() => commandRef.current("top")}
            className="pointer-events-auto grid size-9 place-items-center rounded-xl border border-border bg-surface/90 text-muted shadow-sm backdrop-blur transition hover:text-brand"
            title={t("canvas.topView")}
            aria-label={t("canvas.topView")}
          >
            <ScanSearch className="size-4" aria-hidden="true" />
          </button>
        ) : null}
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
        {navigationMode === "walk"
          ? t("canvas.walk.hint")
          : t("canvas.controlsHint")}
      </div>
      {navigationMode === "walk" ? (
        <div className="absolute bottom-3 right-3 z-10 grid grid-cols-3 gap-1 sm:hidden">
          <span />
          <button
            type="button"
            onPointerDown={() => walkCommandRef.current("forward", true)}
            onPointerUp={() => walkCommandRef.current("forward", false)}
            onPointerCancel={() => walkCommandRef.current("forward", false)}
            onPointerLeave={() => walkCommandRef.current("forward", false)}
            className="grid size-11 touch-none place-items-center rounded-xl border border-border bg-surface/90 text-foreground shadow-lg backdrop-blur"
            aria-label={t("canvas.walk.forward")}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
          <span />
          <button
            type="button"
            onPointerDown={() => walkCommandRef.current("left", true)}
            onPointerUp={() => walkCommandRef.current("left", false)}
            onPointerCancel={() => walkCommandRef.current("left", false)}
            onPointerLeave={() => walkCommandRef.current("left", false)}
            className="grid size-11 touch-none place-items-center rounded-xl border border-border bg-surface/90 text-foreground shadow-lg backdrop-blur"
            aria-label={t("canvas.walk.left")}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onPointerDown={() => walkCommandRef.current("backward", true)}
            onPointerUp={() => walkCommandRef.current("backward", false)}
            onPointerCancel={() => walkCommandRef.current("backward", false)}
            onPointerLeave={() => walkCommandRef.current("backward", false)}
            className="grid size-11 touch-none place-items-center rounded-xl border border-border bg-surface/90 text-foreground shadow-lg backdrop-blur"
            aria-label={t("canvas.walk.backward")}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onPointerDown={() => walkCommandRef.current("right", true)}
            onPointerUp={() => walkCommandRef.current("right", false)}
            onPointerCancel={() => walkCommandRef.current("right", false)}
            onPointerLeave={() => walkCommandRef.current("right", false)}
            className="grid size-11 touch-none place-items-center rounded-xl border border-border bg-surface/90 text-foreground shadow-lg backdrop-blur"
            aria-label={t("canvas.walk.right")}
          >
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {showKeyframes && selectedKeyframe ? (
        <div className="absolute bottom-12 right-3 z-10 w-56 overflow-hidden rounded-xl border border-border bg-surface/95 shadow-lg backdrop-blur">
          <div
            className="relative bg-surface-muted"
            style={{
              aspectRatio: selectedKeyframeDisplay?.quarterTurn
                ? selectedKeyframe.height / Math.max(selectedKeyframe.width, 1)
                : selectedKeyframe.width / Math.max(selectedKeyframe.height, 1),
            }}
          >
            <Image
              src={selectedKeyframe.url}
              alt={t("canvas.keyframes.imageAlt", {
                room: manifest.room.name,
              })}
              width={selectedKeyframe.width}
              height={selectedKeyframe.height}
              sizes="224px"
              unoptimized
              className="max-w-none object-contain"
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: selectedKeyframeDisplay?.quarterTurn
                  ? `${(100 * selectedKeyframe.width) / Math.max(selectedKeyframe.height, 1)}%`
                  : "100%",
                height: selectedKeyframeDisplay?.quarterTurn
                  ? `${(100 * selectedKeyframe.height) / Math.max(selectedKeyframe.width, 1)}%`
                  : "100%",
                transform: `translate(-50%, -50%) ${selectedKeyframeDisplay?.transform ?? ""}`,
              }}
            />
            <button
              type="button"
              onClick={() => setSelectedKeyframeId(null)}
              className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-foreground/65 text-background backdrop-blur transition hover:bg-foreground/80"
              aria-label={t("canvas.keyframes.close")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-[10px] text-muted">
            <span>{new Intl.DateTimeFormat(locale, {
              dateStyle: "short",
              timeStyle: "medium",
            }).format(new Date(selectedKeyframe.capturedAt))}</span>
            <span className="shrink-0 font-semibold text-foreground">
              {t("canvas.keyframes.quality", {
                value: integer.format(Math.round(selectedKeyframe.quality * 100)),
              })}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
