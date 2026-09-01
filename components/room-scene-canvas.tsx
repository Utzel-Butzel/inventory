"use client";

import {
  Aperture,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpFromLine,
  Camera,
  Cuboid,
  Footprints,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Maximize2,
  Move3d,
  Rotate3d,
  ScanSearch,
  Sparkles,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import Image from "next/image";
import { useT } from "next-i18next/client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { ProgressiveLightMap } from "three/examples/jsm/misc/ProgressiveLightMap.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";

import type { ClientRoomSceneManifest } from "@/lib/client-types";
import type { RoomMapViewport } from "@/components/room-layout-map-canvas";
import {
  createAiPrimitiveObjectModel,
  createRoomObjectModel,
  isRecognizableAiPrimitiveModel,
} from "@/components/room-object-models";
import {
  applyDetectedRoomFinish,
  applyRoomMaterialClass,
} from "@/components/room-scene-materials";
import { cn } from "@/components/ui";
import type {
  RoomMaterial,
  RoomObjectSuggestion,
  RoomWindowDetails,
} from "@/lib/room-ai-analysis-contract";
import { estimatedRoomObjectModelCategory } from "@/lib/room-ai-estimated-placement";
import type { RoomLightMapBake } from "@/lib/room-lightmap-baker";
import {
  azimuthDegrees,
  roomAmbientBounceFraction,
  roomFillLightColor,
  roomFillRadianceForKey,
  roomKeyLightColor,
  roomKeyPanelPlacement,
  roomKeyRadianceForPanel,
  resolveRoomKeyAzimuth,
} from "@/lib/room-lighting-rig";
import type { SpatialMatrix4 } from "@/lib/room-scene-contract";
import {
  applyMetricSurfaceUvs,
  floorTextureTilesPerMetre,
  wallTextureTilesPerMetre,
} from "@/lib/room-surface-uvs";
import { resolveRoomWindowPaneGrid } from "@/lib/room-window-details";
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
type WalkAction =
  | "forward"
  | "backward"
  | "left"
  | "right"
  | "jump"
  | "crouch";
type LayoutTool = "translate" | "rotate";
type RoomSceneLayoutEditing = {
  selectedScanId: string | null;
  transforms: Record<string, SpatialMatrix4>;
  onSelectRoom: (scanId: string) => void;
  onChangeTransform: (scanId: string, transform: SpatialMatrix4) => void;
};
type LightingMode = "live" | "progressive" | "realistic" | "rendering";
type LightingStatus = "idle" | "generating" | "ready";
const progressiveQualityPresets = [
  {
    id: "fast",
    sampleTarget: 60,
    lightCount: 4,
    atlasResolution: 1024,
    shadowResolution: 512,
  },
  {
    id: "balanced",
    sampleTarget: 120,
    lightCount: 6,
    atlasResolution: 1024,
    shadowResolution: 1024,
  },
  {
    id: "high",
    sampleTarget: 240,
    lightCount: 8,
    atlasResolution: 2048,
    shadowResolution: 1024,
  },
  {
    id: "ultra",
    sampleTarget: 360,
    lightCount: 10,
    atlasResolution: 2048,
    shadowResolution: 2048,
  },
] as const;
type GpuPathTracer = import("three-gpu-pathtracer").WebGLPathTracer;
type CameraSnapshot = {
  scanId: string;
  navigationMode: NavigationMode;
  mapBackground: boolean;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  up: [number, number, number];
  target: [number, number, number];
};
type AssetLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "partial"
  | "error"
  | "too-large";

type RoomSurface =
  ClientRoomSceneManifest["scan"]["scene"]["surfaces"][number];

const emptyLinkedManifests: ClientRoomSceneManifest[] = [];

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

/**
 * What each detected object is most likely made of.
 *
 * RoomPlan gives us a category but no material, and category is a good enough
 * proxy: seating is upholstered, casework is timber, white goods are steel,
 * sanitaryware is glazed. This drives roughness, metalness and the clearcoat or
 * sheen lobe, which is what separates these props from each other far more than
 * their base colour does.
 */
const objectMaterialClasses: Record<string, RoomMaterial> = {
  storage: "wood",
  table: "wood",
  chair: "wood",
  stairs: "wood",
  sofa: "fabric",
  bed: "fabric",
  refrigerator: "metal",
  stove: "metal",
  oven: "metal",
  dishwasher: "metal",
  "washer-dryer": "metal",
  sink: "metal",
  toilet: "tile",
  bathtub: "tile",
  fireplace: "stone",
  television: "plastic",
};

const sceneThemePalettes = {
  light: {
    background: 0xe7ebef,
    gridCenter: 0xb5bcc6,
    grid: 0xd8dde3,
  },
  dark: {
    background: 0x111419,
    gridCenter: 0x3b424d,
    grid: 0x252b34,
  },
} as const;

let rectAreaLightUniformsInitialized = false;

function ensureRectAreaLightUniforms() {
  if (rectAreaLightUniformsInitialized) return;
  RectAreaLightUniformsLib.init();
  rectAreaLightUniformsInitialized = true;
}

function createPathTraceDenoiseMaterial() {
  return new THREE.ShaderMaterial({
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      map: { value: null as THREE.Texture | null },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;

      float sampleLuminance(vec3 color) {
        return dot(color, vec3(0.2126, 0.7152, 0.0722));
      }

      void main() {
        vec2 texel = 1.0 / vec2(textureSize(map, 0));
        vec4 samples[9];
        int sampleIndex = 0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            samples[sampleIndex] = texture2D(map, vUv + vec2(float(x), float(y)) * texel);
            sampleIndex++;
          }
        }

        for (int left = 0; left < 9; left++) {
          for (int right = left + 1; right < 9; right++) {
            if (sampleLuminance(samples[right].rgb) < sampleLuminance(samples[left].rgb)) {
              vec4 swapped = samples[left];
              samples[left] = samples[right];
              samples[right] = swapped;
            }
          }
        }

        gl_FragColor = (samples[3] + samples[4] + samples[5]) / 3.0;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <premultiplied_alpha_fragment>
      }
    `,
  });
}

type TexturePattern = "plaster" | "grain" | "speckle";

type ProceduralMaterialTextures = {
  colorMap: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

const proceduralTextureSize = 256;

function textureNoise(x: number, y: number, seed: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43_758.5453;
  return value - Math.floor(value);
}

function smoothTextureNoise(
  x: number,
  y: number,
  seed: number,
  scale: number,
) {
  const cellCount = Math.max(
    1,
    Math.round(proceduralTextureSize / scale),
  );
  const scaledX = (x / proceduralTextureSize) * cellCount;
  const scaledY = (y / proceduralTextureSize) * cellCount;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const tx = scaledX - x0;
  const ty = scaledY - y0;
  const fadeX = tx * tx * (3 - 2 * tx);
  const fadeY = ty * ty * (3 - 2 * ty);
  const sample = (sampleX: number, sampleY: number) =>
    textureNoise(
      (sampleX + cellCount) % cellCount,
      (sampleY + cellCount) % cellCount,
      seed,
    );
  const top = THREE.MathUtils.lerp(
    sample(x0, y0),
    sample(x0 + 1, y0),
    fadeX,
  );
  const bottom = THREE.MathUtils.lerp(
    sample(x0, y0 + 1),
    sample(x0 + 1, y0 + 1),
    fadeX,
  );
  return THREE.MathUtils.lerp(top, bottom, fadeY) * 2 - 1;
}

function patternValue(pattern: TexturePattern, x: number, y: number, seed: number) {
  const fine = smoothTextureNoise(x, y, seed, 2.5);
  const medium = smoothTextureNoise(x, y, seed + 13, 9);
  const broad = smoothTextureNoise(x, y, seed + 29, 34);

  if (pattern === "grain") {
    const warp = smoothTextureNoise(x, y, seed + 47, 42) * 5;
    const fiber = Math.sin(
      (y + warp) * (Math.PI * 2 * 24 / proceduralTextureSize) + medium * 1.25,
    );
    const plankPosition = ((x + seed * 11) % 64 + 64) % 64;
    const seamDistance = Math.min(plankPosition, 64 - plankPosition);
    const seam = seamDistance < 1.15 ? -1 + seamDistance / 1.15 : 0;
    return THREE.MathUtils.clamp(
      broad * 0.5 + medium * 0.25 + fiber * 0.16 + fine * 0.06 + seam * 0.2,
      -1,
      1,
    );
  }
  if (pattern === "plaster") {
    return broad * 0.58 + medium * 0.3 + fine * 0.12;
  }
  return medium * 0.52 + fine * 0.3 + broad * 0.18;
}

function configuredDataTexture(
  data: Uint8Array,
  size: number,
  repeat: readonly [number, number],
  anisotropy: number,
  colorSpace = false,
) {
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

function createProceduralMaterialTextures({
  base,
  variation,
  pattern,
  seed,
  repeat,
  anisotropy,
  roughness,
  normalStrength,
}: {
  base: readonly [number, number, number];
  variation: number;
  pattern: TexturePattern;
  seed: number;
  repeat: readonly [number, number];
  anisotropy: number;
  roughness: number;
  normalStrength: number;
}): ProceduralMaterialTextures {
  const size = proceduralTextureSize;
  const heights = new Float32Array(size * size);
  const colorData = new Uint8Array(size * size * 4);
  const normalData = new Uint8Array(size * size * 4);
  const roughnessData = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = patternValue(pattern, x, y, seed);
      heights[y * size + x] = value;
      const offset = Math.round(value * variation);
      const index = (y * size + x) * 4;
      colorData[index] = THREE.MathUtils.clamp(base[0] + offset, 0, 255);
      colorData[index + 1] = THREE.MathUtils.clamp(base[1] + offset, 0, 255);
      colorData[index + 2] = THREE.MathUtils.clamp(base[2] + offset, 0, 255);
      colorData[index + 3] = 255;

      const microVariation = textureNoise(x, y, seed + 83) * 2 - 1;
      const roughnessByte = Math.round(
        THREE.MathUtils.clamp(
          roughness + value * 0.035 + microVariation * 0.018,
          0.04,
          1,
        ) * 255,
      );
      roughnessData[index] = roughnessByte;
      roughnessData[index + 1] = roughnessByte;
      roughnessData[index + 2] = roughnessByte;
      roughnessData[index + 3] = 255;
    }
  }

  const heightAt = (x: number, y: number) =>
    heights[((y + size) % size) * size + ((x + size) % size)] ?? 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * normalStrength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * normalStrength;
      const inverseLength = 1 / Math.hypot(dx, dy, 1);
      const index = (y * size + x) * 4;
      normalData[index] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255);
      normalData[index + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255);
      normalData[index + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
      normalData[index + 3] = 255;
    }
  }

  return {
    colorMap: configuredDataTexture(colorData, size, repeat, anisotropy, true),
    normalMap: configuredDataTexture(normalData, size, repeat, anisotropy),
    roughnessMap: configuredDataTexture(
      roughnessData,
      size,
      repeat,
      anisotropy,
    ),
  };
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

function linoleumReflectionShader(
  textureWidth: number,
  textureHeight: number,
  opacity: number,
) {
  return {
    name: "LinoleumPlanarReflection",
    uniforms: {
      color: { value: new THREE.Color(0x353a3d) },
      opacity: { value: opacity },
      tDiffuse: { value: null },
      texelSize: {
        value: new THREE.Vector2(1 / textureWidth, 1 / textureHeight),
      },
      textureMatrix: { value: new THREE.Matrix4() },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vUv;

      #include <common>
      #include <logdepthbuf_pars_vertex>

      void main() {
        vUv = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      uniform sampler2D tDiffuse;
      uniform vec2 texelSize;
      varying vec4 vUv;

      #include <logdepthbuf_pars_fragment>

      void main() {
        #include <logdepthbuf_fragment>

        vec2 uv = vUv.xy / max(vUv.w, 0.00001);
        vec2 blur = texelSize * 2.25;
        vec3 reflection = texture2D(tDiffuse, uv).rgb * 0.28;
        reflection += texture2D(tDiffuse, uv + vec2( blur.x, 0.0)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv + vec2(-blur.x, 0.0)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv + vec2(0.0,  blur.y)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv + vec2(0.0, -blur.y)).rgb * 0.12;
        reflection += texture2D(tDiffuse, uv + vec2( blur.x,  blur.y)).rgb * 0.06;
        reflection += texture2D(tDiffuse, uv + vec2(-blur.x,  blur.y)).rgb * 0.06;
        reflection += texture2D(tDiffuse, uv + vec2( blur.x, -blur.y)).rgb * 0.06;
        reflection += texture2D(tDiffuse, uv + vec2(-blur.x, -blur.y)).rgb * 0.06;
        reflection = mix(reflection, color, 0.04);

        // A constant-alpha mirror layer obscures the diffuse lightmap and its
        // contact shadows. Let only the brighter reflected energy contribute;
        // dark reflections remain almost transparent so baked and progressive
        // floor shadows retain their contrast beneath the specular layer.
        float reflectionLuminance = dot(
          reflection,
          vec3(0.2126, 0.7152, 0.0722)
        );
        float reflectionAlpha = opacity * mix(
          0.12,
          1.0,
          smoothstep(0.05, 0.72, reflectionLuminance)
        );
        gl_FragColor = vec4(reflection, reflectionAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
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
  linkedManifests = emptyLinkedManifests,
  selectedResourceId,
  previewObjectSuggestionId = null,
  editableObjectSuggestionId = null,
  onSelectResource,
  onSelectObjectSuggestion,
  onChangeObjectSuggestionPlacement,
  layoutEditing = null,
  mapBackground = false,
  mapViewport = null,
}: {
  manifest: ClientRoomSceneManifest;
  linkedManifests?: ClientRoomSceneManifest[];
  selectedResourceId: string | null;
  previewObjectSuggestionId?: string | null;
  editableObjectSuggestionId?: string | null;
  onSelectResource: (resourceId: string) => void;
  onSelectObjectSuggestion?: (suggestionId: string | null) => void;
  onChangeObjectSuggestionPlacement?: (
    suggestionId: string,
    position: [number, number, number],
    rotationYDegrees: number,
  ) => void;
  layoutEditing?: RoomSceneLayoutEditing | null;
  mapBackground?: boolean;
  mapViewport?: RoomMapViewport | null;
}) {
  const { t, i18n } = useT("spatial");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const hostRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<(command: CameraCommand) => void>(() => undefined);
  const selectionCommandRef = useRef<(resourceId: string | null) => void>(
    () => undefined,
  );
  const suggestionPreviewCommandRef = useRef<
    (suggestionId: string | null) => void
  >(() => undefined);
  const suggestionEditSelectionCommandRef = useRef<
    (suggestionId: string | null) => void
  >(() => undefined);
  const suggestionEditToolCommandRef = useRef<(tool: LayoutTool) => void>(
    () => undefined,
  );
  const keyframeCommandRef = useRef<
    (visible: boolean, selectedId: string | null) => void
  >(() => undefined);
  const walkCommandRef = useRef<
    (action: WalkAction, active: boolean) => void
  >(() => undefined);
  const walkThroughWallsRef = useRef(false);
  const layoutSelectionCommandRef = useRef<(scanId: string | null) => void>(
    () => undefined,
  );
  const layoutToolCommandRef = useRef<(tool: LayoutTool) => void>(
    () => undefined,
  );
  const layoutTransformsCommandRef = useRef<
    (transforms: Record<string, SpatialMatrix4>) => void
  >(() => undefined);
  const selectedResourceRef = useRef(selectedResourceId);
  const layoutToolRef = useRef<LayoutTool>("translate");
  const suggestionEditToolRef = useRef<LayoutTool>("translate");
  const previewSuggestionRef = useRef(previewObjectSuggestionId);
  const editableSuggestionRef = useRef(editableObjectSuggestionId);
  const cameraSnapshotRef = useRef<CameraSnapshot | null>(null);
  const keyframesVisibleRef = useRef(false);
  const selectedKeyframeRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelectResource);
  const onSelectObjectSuggestionRef = useRef(onSelectObjectSuggestion);
  const onChangeObjectSuggestionPlacementRef = useRef(
    onChangeObjectSuggestionPlacement,
  );
  const selectedLayoutScanRef = useRef(layoutEditing?.selectedScanId ?? null);
  const layoutTransformsRef = useRef(layoutEditing?.transforms ?? null);
  const onSelectLayoutRoomRef = useRef(layoutEditing?.onSelectRoom);
  const onChangeLayoutTransformRef = useRef(layoutEditing?.onChangeTransform);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [sceneMode, setSceneMode] = useState<SceneMode>("roomplan");
  const [lightingMode, setLightingMode] = useState<LightingMode>("live");
  const [progressiveQuality, setProgressiveQuality] = useState(2);
  // Furniture belongs in the atlas: it is what casts the contact shadows the
  // cutaway is read for. The toggle keeps the faster shell-only bake available.
  const [bakeRoomOnly, setBakeRoomOnly] = useState(false);
  const [slowHighQualityBake, setSlowHighQualityBake] = useState(false);
  const [lightingStatus, setLightingStatus] = useState<LightingStatus>("idle");
  const [lightingProgress, setLightingProgress] = useState(0);
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("orbit");
  const [walkThroughWalls, setWalkThroughWalls] = useState(false);
  const [layoutTool, setLayoutTool] = useState<LayoutTool>("translate");
  const [suggestionEditTool, setSuggestionEditTool] = useState<LayoutTool>("translate");
  const [assetLoadState, setAssetLoadState] = useState<AssetLoadState>("idle");
  const [showKeyframes, setShowKeyframes] = useState(false);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const progressiveQualityPreset =
    progressiveQualityPresets[progressiveQuality] ??
    progressiveQualityPresets[2];
  const isLayoutEditing = Boolean(layoutEditing);
  const layoutEditTransforms = layoutEditing?.transforms ?? null;
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
  const selectLightingMode = (mode: LightingMode) => {
    if (mode === lightingMode) return;
    if (mode !== "live") setSceneMode("roomplan");
    setLightingProgress(0);
    setLightingStatus(mode === "live" ? "idle" : "generating");
    setLightingMode(mode);
  };

  useEffect(() => {
    onSelectRef.current = onSelectResource;
  }, [onSelectResource]);

  useEffect(() => {
    onSelectObjectSuggestionRef.current = onSelectObjectSuggestion;
    onChangeObjectSuggestionPlacementRef.current =
      onChangeObjectSuggestionPlacement;
  }, [onChangeObjectSuggestionPlacement, onSelectObjectSuggestion]);

  useEffect(() => {
    walkThroughWallsRef.current = walkThroughWalls;
  }, [walkThroughWalls]);

  useEffect(() => {
    selectedResourceRef.current = selectedResourceId;
    selectionCommandRef.current(selectedResourceId);
  }, [selectedResourceId]);

  useEffect(() => {
    previewSuggestionRef.current = previewObjectSuggestionId;
    suggestionPreviewCommandRef.current(previewObjectSuggestionId);
  }, [previewObjectSuggestionId]);

  useEffect(() => {
    editableSuggestionRef.current = editableObjectSuggestionId;
    suggestionEditSelectionCommandRef.current(editableObjectSuggestionId);
  }, [editableObjectSuggestionId]);

  useEffect(() => {
    suggestionEditToolRef.current = suggestionEditTool;
    suggestionEditToolCommandRef.current(suggestionEditTool);
  }, [suggestionEditTool]);

  useEffect(() => {
    selectedLayoutScanRef.current = layoutEditing?.selectedScanId ?? null;
    layoutTransformsRef.current = layoutEditTransforms;
    onSelectLayoutRoomRef.current = layoutEditing?.onSelectRoom;
    onChangeLayoutTransformRef.current = layoutEditing?.onChangeTransform;
    layoutSelectionCommandRef.current(layoutEditing?.selectedScanId ?? null);
    if (layoutEditTransforms) {
      layoutTransformsCommandRef.current(layoutEditTransforms);
    }
  }, [
    layoutEditing?.onChangeTransform,
    layoutEditing?.onSelectRoom,
    layoutEditing?.selectedScanId,
    layoutEditTransforms,
  ]);

  useEffect(() => {
    layoutToolRef.current = layoutTool;
    layoutToolCommandRef.current(layoutTool);
  }, [layoutTool]);

  useEffect(() => {
    if (!isLayoutEditing) return;
    setNavigationMode("orbit");
    setSceneMode("roomplan");
    setLightingMode("live");
    setLightingStatus("idle");
    setLightingProgress(0);
  }, [isLayoutEditing]);

  useEffect(() => {
    if (!editableObjectSuggestionId) return;
    setNavigationMode("orbit");
    setSceneMode("roomplan");
    setLightingMode("live");
    setLightingStatus("idle");
    setLightingProgress(0);
  }, [editableObjectSuggestionId]);

  useEffect(() => {
    if (!mapBackground) return;
    setNavigationMode("orbit");
    setLightingMode("live");
    setLightingStatus("idle");
    setLightingProgress(0);
  }, [mapBackground]);

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
    const progressiveLighting = lightingMode === "progressive";
    const rayTracedLighting =
      lightingMode === "realistic" || lightingMode === "rendering";

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: mapBackground });
    } catch {
      setRendererError(t("canvas.unsupported"));
      return;
    }

    const darkModePreference = window.matchMedia("(prefers-color-scheme: dark)");
    const usesDarkMode = () => {
      const selectedTheme = document.documentElement.dataset.theme;
      return selectedTheme === "dark" ||
        (selectedTheme !== "light" && darkModePreference.matches);
    };
    let sceneUsesDarkMode = usesDarkMode();
    const initialScenePalette = sceneThemePalettes[
      sceneUsesDarkMode ? "dark" : "light"
    ];

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(initialScenePalette.background, mapBackground ? 0 : 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Realistic uses the Khronos neutral transform. AgX's filmic toe is what
    // was closing up the corners of a baked interior and pulling the colour out
    // of them; neutral keeps mid-tones and hue while still rolling off the
    // window highlight. Rendering keeps AgX, Live keeps ACES.
    renderer.toneMapping = lightingMode === "realistic"
      ? THREE.NeutralToneMapping
      : rayTracedLighting
        ? THREE.AgXToneMapping
        : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = lightingMode === "realistic"
      ? 1
      : rayTracedLighting
        ? 1.12
        : progressiveLighting
          ? 0.98
          : 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = progressiveLighting
      ? THREE.PCFSoftShadowMap
      : THREE.VSMShadowMap;
    ensureRectAreaLightUniforms();
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
    let disposed = false;
    if (rayTracedLighting) {
      scene.background = new THREE.Color(initialScenePalette.background);
    }
    const sceneFog = new THREE.Fog(initialScenePalette.background, 18, 55);
    scene.fog = mapBackground ? null : sceneFog;
    const roomEnvironment = new RoomEnvironment();
    const environmentGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = environmentGenerator.fromScene(roomEnvironment, 0.035);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.4;
    roomEnvironment.dispose();
    environmentGenerator.dispose();

    const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    const wallTextures = createProceduralMaterialTextures({
      // Architectural white paint is not a perfect reflector. Keeping its
      // diffuse albedo below pure white preserves highlight and bounce headroom.
      base: [228, 226, 222],
      variation: 3,
      pattern: "plaster",
      seed: 11,
      repeat: [7, 7],
      anisotropy,
      roughness: 0.98,
      normalStrength: 0.12,
    });
    const floorTextures = createProceduralMaterialTextures({
      // Charcoal linoleum has a very fine, nearly isotropic filler pattern.
      // Avoid wood grain so broad reflected shapes remain visually coherent.
      base: [45, 49, 51],
      variation: 3,
      pattern: "speckle",
      seed: 43,
      repeat: [6, 6],
      anisotropy,
      roughness: 0.78,
      normalStrength: 0.06,
    });
    const doorTextures = createProceduralMaterialTextures({
      base: [165, 128, 92],
      variation: 7,
      pattern: "grain",
      seed: 59,
      repeat: [2, 3],
      anisotropy,
      roughness: 0.9,
      normalStrength: 0.2,
    });
    const objectTextures = createProceduralMaterialTextures({
      base: [226, 224, 220],
      variation: 3,
      pattern: "speckle",
      seed: 71,
      repeat: [5, 5],
      anisotropy,
      roughness: 0.94,
      normalStrength: 0.16,
    });
    const { colorMap: wallColorMap, normalMap: wallNormalMap, roughnessMap: wallRoughnessMap } = wallTextures;
    const { colorMap: floorColorMap, normalMap: floorNormalMap, roughnessMap: floorRoughnessMap } = floorTextures;
    const { colorMap: doorColorMap, normalMap: doorNormalMap, roughnessMap: doorRoughnessMap } = doorTextures;
    const { colorMap: objectColorMap, normalMap: objectNormalMap, roughnessMap: objectRoughnessMap } = objectTextures;
    const materialTextures = [
      ...Object.values(wallTextures),
      ...Object.values(floorTextures),
      ...Object.values(doorTextures),
      ...Object.values(objectTextures),
    ];

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: wallColorMap,
      normalMap: wallNormalMap,
      normalScale: new THREE.Vector2(0.06, 0.06),
      roughnessMap: wallRoughnessMap,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.18,
    });
    const floorMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: floorColorMap,
      normalMap: floorNormalMap,
      normalScale: new THREE.Vector2(0.08, 0.08),
      roughnessMap: floorRoughnessMap,
      // The base lobe stays satin while a restrained clear coat gives sealed
      // linoleum the soft, slightly mirrored reflection seen at grazing angles.
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.38,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1,
    });
    const doorMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: doorColorMap,
      normalMap: doorNormalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: doorRoughnessMap,
      roughness: 0.84,
      metalness: 0,
      envMapIntensity: 0.5,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0ece4,
      map: wallColorMap,
      normalMap: wallNormalMap,
      normalScale: new THREE.Vector2(0.14, 0.14),
      roughnessMap: wallRoughnessMap,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.24,
    });
    const windowFrameMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7eaeb,
      roughness: 0.46,
      metalness: 0,
      envMapIntensity: 0.7,
    });
    const hardwareMaterial = new THREE.MeshStandardMaterial({
      color: 0xb9a56f,
      roughness: 0.3,
      metalness: 1,
      envMapIntensity: 1.35,
    });
    const windowMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd5e8ef,
      roughness: 0.045,
      metalness: 0,
      transmission: 0.96,
      thickness: 0.006,
      ior: 1.5,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      envMapIntensity: 1.25,
    });
    const openingMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9d4ca,
      map: wallColorMap,
      normalMap: wallNormalMap,
      normalScale: new THREE.Vector2(0.14, 0.14),
      roughnessMap: wallRoughnessMap,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.24,
    });
    const objectMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const objectMaterial = (category: string) => {
      const cached = objectMaterials.get(category);
      if (cached) return cached;
      const material = new THREE.MeshPhysicalMaterial({
        color: objectColors[category] ?? 0xb09b84,
        map: objectColorMap,
        normalMap: objectNormalMap,
        normalScale: new THREE.Vector2(0.22, 0.22),
        roughnessMap: objectRoughnessMap,
        // Every opaque prop takes its diffuse light from the atlas and has the
        // environment's irradiance term suppressed, so this controls the
        // specular response alone. Leaving it near unity lets Fresnel and
        // roughness decide how reflective each class looks instead of a
        // hand-picked number, which is what kept props reading as flat paper.
        envMapIntensity: 0.9,
      });
      applyRoomMaterialClass(material, objectMaterialClasses[category] ?? "wood");
      objectMaterials.set(category, material);
      return material;
    };
    const aiMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const detectedFinishTextures = {
      paint: {
        normalMap: wallNormalMap,
        roughnessMap: wallRoughnessMap,
        normalScale: 0.18,
      },
      wood: {
        normalMap: doorNormalMap,
        roughnessMap: doorRoughnessMap,
        normalScale: 0.25,
      },
      fabric: {
        normalMap: objectNormalMap,
        roughnessMap: objectRoughnessMap,
        normalScale: 0.32,
      },
    };
    const finishForSurface = (
      roomManifest: ClientRoomSceneManifest,
      category: RoomSurface["category"],
      fallback: THREE.MeshStandardMaterial,
    ) => {
      // The architectural viewer intentionally presents a consistent dark
      // linoleum floor. Detected finishes remain authoritative for walls,
      // doors, windows, and openings, but must not turn this floor back into
      // the former brown wood material.
      if (category === "floor") return floorMaterial;
      const appearance = roomManifest.scan.aiAnalysis?.surfaceAppearances.find(
        (candidate) =>
          candidate.status === "accepted" &&
          candidate.surfaceCategory === category,
      );
      if (!appearance) return fallback;
      const key = `${roomManifest.scan.id}:surface:${category}`;
      const cached = aiMaterials.get(key);
      if (cached) return cached;
      const material = applyDetectedRoomFinish(
        fallback.clone(),
        appearance,
        detectedFinishTextures,
      );
      aiMaterials.set(key, material);
      return material;
    };
    const finishForObject = (
      roomManifest: ClientRoomSceneManifest,
      objectId: string,
      category: string,
    ) => {
      const fallback = objectMaterial(category);
      const suggestion = roomManifest.scan.aiAnalysis?.objectSuggestions.find(
        (candidate) =>
          candidate.status === "accepted" && candidate.roomObjectId === objectId,
      );
      if (!suggestion) return fallback;
      const key = `${roomManifest.scan.id}:object:${objectId}`;
      const cached = aiMaterials.get(key);
      if (cached) return cached;
      const material = applyDetectedRoomFinish(
        fallback.clone(),
        {
          colorHex:
            suggestion.colorHex ?? `#${fallback.color.getHexString().toUpperCase()}`,
          material: suggestion.material,
          roughness: suggestion.material === "metal" ? 0.32 : 0.7,
        },
        detectedFinishTextures,
      );
      aiMaterials.set(key, material);
      return material;
    };
    const finishForSuggestion = (
      roomManifest: ClientRoomSceneManifest,
      suggestion: RoomObjectSuggestion,
      category: string,
    ) => {
      const fallback = objectMaterial(category);
      const key = `${roomManifest.scan.id}:suggestion:${suggestion.id}`;
      const cached = aiMaterials.get(key);
      if (cached) return cached;
      const material = applyDetectedRoomFinish(
        fallback.clone(),
        {
          colorHex:
            suggestion.colorHex ?? `#${fallback.color.getHexString().toUpperCase()}`,
          material: suggestion.material,
          roughness: suggestion.material === "metal" ? 0.32 : 0.7,
        },
        detectedFinishTextures,
      );
      aiMaterials.set(key, material);
      return material;
    };
    const acceptedSuggestionForObject = (
      roomManifest: ClientRoomSceneManifest,
      objectId: string,
    ) => roomManifest.scan.aiAnalysis?.objectSuggestions.find(
      (candidate) =>
        candidate.status === "accepted" && candidate.roomObjectId === objectId,
    );
    const objectLightMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe8e1d6,
      map: objectColorMap,
      normalMap: objectNormalMap,
      normalScale: new THREE.Vector2(0.2, 0.2),
      roughnessMap: objectRoughnessMap,
      roughness: 0.72,
      metalness: 0,
      // Painted panel: a faint coat, not a gloss.
      clearcoat: 0.16,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.85,
    });
    const objectDarkMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x30363d,
      roughness: 0.46,
      metalness: 0,
      clearcoat: 0.28,
      clearcoatRoughness: 0.26,
      envMapIntensity: 1,
    });
    const objectMetalMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xaeb7bd,
      // Brushed appliance steel, not chrome: the anisotropy of a real brushed
      // finish is beyond a single roughness value, so keep the lobe broad
      // enough that it reads as satin rather than a mirror.
      roughness: 0.38,
      metalness: 1,
      envMapIntensity: 1.15,
    });
    const objectGlassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x263947,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.88,
      thickness: 0.012,
      ior: 1.5,
      transparent: true,
      opacity: 1,
      envMapIntensity: 1.4,
    });
    const objectCeramicMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf0efeb,
      roughness: 0.26,
      metalness: 0,
      clearcoat: 0.18,
      clearcoatRoughness: 0.22,
      envMapIntensity: 0.8,
    });
    const objectWaterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x69abc1,
      roughness: 0.12,
      transmission: 0.24,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      ior: 1.333,
      thickness: 0.018,
      envMapIntensity: 1.15,
    });
    const objectWarmMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xc87543,
      map: objectColorMap,
      normalMap: objectNormalMap,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughnessMap: objectRoughnessMap,
      roughness: 0.62,
      metalness: 0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.85,
    });
    const createSuggestionModel = (
      roomManifest: ClientRoomSceneManifest,
      suggestion: RoomObjectSuggestion,
      category: string,
      dimensions: readonly [number, number, number],
    ) => suggestion.primitiveModel && isRecognizableAiPrimitiveModel({
      category,
      model: suggestion.primitiveModel,
    })
      ? createAiPrimitiveObjectModel({
          category,
          dimensions,
          model: suggestion.primitiveModel,
        })
      : createRoomObjectModel({
          category,
          dimensions,
          materials: {
            primary: finishForSuggestion(roomManifest, suggestion, category),
            light: objectLightMaterial,
            dark: objectDarkMaterial,
            metal: objectMetalMaterial,
            glass: objectGlassMaterial,
            ceramic: objectCeramicMaterial,
            water: objectWaterMaterial,
            warm: objectWarmMaterial,
          },
        });
    const camera = new THREE.PerspectiveCamera(
      navigationMode === "walk" ? 56 : 48,
      1,
      0.02,
      250,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = navigationMode === "orbit";
    // Keep orbit movement locked to the pointer. Damping intentionally trails
    // user input over multiple frames, which makes the camera feel delayed.
    controls.enableDamping = false;
    controls.minDistance = 0.35;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = true;

    // Live keeps the original, intentionally simple architectural rig: cool
    // sky, warm ground bounce, one soft sun, and one quiet cool fill. The
    // ray-traced modes disable these and use their scene-wide softbox instead.
    const skyLight = new THREE.HemisphereLight(0xdcecff, 0x6c5847, 0.62);
    scene.add(skyLight);
    const liveSun = new THREE.DirectionalLight(0xffe7c7, 2.35);
    liveSun.castShadow = true;
    liveSun.shadow.mapSize.set(2048, 2048);
    liveSun.shadow.bias = -0.00008;
    liveSun.shadow.normalBias = 0.006;
    liveSun.shadow.radius = 4;
    liveSun.shadow.blurSamples = 16;
    liveSun.shadow.intensity = 0.96;
    const liveFillLight = new THREE.DirectionalLight(0xc9ddf2, 0.28);
    if (lightingMode === "live") {
      scene.add(
        liveSun,
        liveSun.target,
        liveFillLight,
        liveFillLight.target,
      );
    }
    // Realistic mode enables this only after the softbox bake. Keeping the
    // fill out of the path tracer preserves physically traced occlusion while
    // the finished raster view receives neutral, orientation-independent fill.
    const ambientFillLight = new THREE.AmbientLight(0xf4f1eb, 0);
    scene.add(ambientFillLight);

    const webRoot = new THREE.Group();
    setMatrix(webRoot, manifest.scan.scene.webFromWorld);
    scene.add(webRoot);
    const assetAbortController = new AbortController();
    const roomPlanRoots = new Map<string, THREE.Object3D>();
    const roomArchitectureRoots = new Map<string, THREE.Object3D>();
    const reflectiveFloorMeshes: THREE.Mesh[] = [];
    const roomWorldRoots = new Map<string, THREE.Group>();
    const roomWorldDeltas = new Map<string, THREE.Matrix4>();
    const capturedRoomTransforms = new Map<string, THREE.Matrix4>();
    const suggestionPreviews = new Map<
      string,
      { current: THREE.Object3D | null; preview: THREE.Object3D }
    >();
    const estimatedSuggestionModels = new Map<string, THREE.Object3D>();
    const estimatedSuggestionMeshes: THREE.Object3D[] = [];
    const wallColliderMeshes: THREE.Mesh[] = [];
    const bakeOnlyObjects: THREE.Object3D[] = [];
    const floorReflectors: Reflector[] = [];
    const splatMaterials = new Set<THREE.ShaderMaterial>();
    let progressiveLightMap: ProgressiveLightMap | null = null;
    const progressiveLights: THREE.DirectionalLight[] = [];
    let progressiveLightMapSamples = 0;
    const progressiveLightMapSampleTarget =
      progressiveQualityPreset.sampleTarget;
    let pathTracer: GpuPathTracer | null = null;
    let lightMapBake: RoomLightMapBake | null = null;
    let pathTraceDenoiseQuad: FullScreenQuad | null = null;
    let restartPathTracingForTheme: () => void = () => undefined;
    const layoutTransformForManifest = (
      roomManifest: ClientRoomSceneManifest,
    ) => layoutTransformsRef.current?.[roomManifest.scan.id]
      ?? roomManifest.scan.layoutTransform
      ?? roomManifest.scan.scene.worldFromModel;

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
      const width = Math.max(size[0], 0.002);
      const height = Math.max(size[1], 0.002);
      const depth = Math.max(size[2], 0.002);
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      return mesh;
    };

    const unbakedWallMaterials = new Map<
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial
    >();
    const unbakedWallMaterial = (source: THREE.MeshStandardMaterial) => {
      const cached = unbakedWallMaterials.get(source);
      if (cached) return cached;
      const material = source.clone();
      // Exterior faces and thin edge caps are lit by the neutral ambient fill,
      // not by an interior lightmap. Suppress tiny repeated normals that turn a
      // 35 mm cap into high-contrast stripes at overview distances.
      material.normalMap = null;
      material.normalScale.setScalar(0);
      material.roughnessMap = null;
      material.roughness = Math.max(material.roughness, 0.94);
      material.envMapIntensity = 0;
      unbakedWallMaterials.set(source, material);
      return material;
    };

    const addWallPlane = ({
      baked,
      height,
      material,
      normalSign,
      parent,
      position,
      width,
    }: {
      baked: boolean;
      height: number;
      material: THREE.MeshStandardMaterial;
      normalSign: -1 | 1;
      parent: THREE.Object3D;
      position: readonly [number, number, number];
      width: number;
    }) => {
      const geometry = new THREE.PlaneGeometry(width, height);
      if (normalSign < 0) geometry.rotateY(Math.PI);
      // Project after the flip so positions and normals are final, and offset
      // into wall space so neighbouring pieces share one continuous pattern.
      applyMetricSurfaceUvs(geometry, {
        offset: position,
        textureRepeat: wallColorMap.repeat,
        tilesPerMetre: wallTextureTilesPerMetre,
      });
      const mesh = new THREE.Mesh(
        geometry,
        baked ? material : unbakedWallMaterial(material),
      );
      mesh.position.set(...position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (baked) {
        mesh.userData.roomLightMapTexelScale = 1.35;
      } else {
        mesh.userData.roomLightMapExclude = true;
      }
      parent.add(mesh);
      return mesh;
    };

    /**
     * Which side of a planar surface faces out of the room, in surface space.
     * A wall's local +Z is not guaranteed to point outside, so resolve it
     * against the room centre.
     */
    const surfaceOutwardSign = (
      surface: RoomSurface,
      roomCenterInModel: THREE.Vector3,
    ): -1 | 1 => {
      const surfaceMatrix = new THREE.Matrix4().fromArray(surface.transform);
      const surfaceCenter = new THREE.Vector3().setFromMatrixPosition(
        surfaceMatrix,
      );
      const localPositiveNormal = new THREE.Vector3(0, 0, 1)
        .transformDirection(surfaceMatrix);
      return localPositiveNormal.dot(
        surfaceCenter.clone().sub(roomCenterInModel),
      ) >= 0
        ? 1
        : -1;
    };

    const makeWallNode = (
      surface: RoomSurface,
      apertures: WallAperture[],
      material: THREE.MeshStandardMaterial,
      roomCenterInModel: THREE.Vector3,
    ) => {
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
      // A wall's local +Z is not guaranteed to point outside. Resolve the two
      // sides against the room center, then bake only the inward-facing plane.
      const surfaceMatrix = new THREE.Matrix4().fromArray(surface.transform);
      const surfaceCenter = new THREE.Vector3().setFromMatrixPosition(
        surfaceMatrix,
      );
      const localPositiveNormal = new THREE.Vector3(0, 0, 1)
        .transformDirection(surfaceMatrix);
      const positiveIsOutward = localPositiveNormal.dot(
        surfaceCenter.clone().sub(roomCenterInModel),
      ) >= 0;
      const outwardSign: -1 | 1 = positiveIsOutward ? 1 : -1;
      const inwardSign: -1 | 1 = outwardSign === 1 ? -1 : 1;
      material.userData.roomDirectionalLightMapStrength = 0.08;
      // RoomPlan surfaces can differ by a few millimetres at their measured
      // floor junction. Hide the wall's horizontal bottom cap inside the floor
      // so it cannot appear as a bright, lightmapped skirting strip.
      const floorOverlap = 0.035;
      const boundaryInset = 0.002;
      const hasOnlyEnclosedApertures = apertures.length > 0 && apertures.every(
        ({ rect }) =>
          rect.left > -width / 2 + boundaryInset &&
          rect.right < width / 2 - boundaryInset &&
          rect.bottom > -height / 2 + boundaryInset &&
          rect.top < height / 2 - boundaryInset,
      );

      if (hasOnlyEnclosedApertures) {
        // A window used to split its wall into four independent BoxGeometry
        // meshes. That also split the baked lightmap into four unrelated UV
        // charts, making small sampling differences appear as a ruler-straight
        // brightness seam beside the opening. An extruded shape keeps both
        // room-facing wall regions in one continuous chart. Beveling remains
        // disabled so the measured RoomPlan surface stays exact.
        const shape = new THREE.Shape();
        shape.moveTo(-width / 2, -height / 2 - floorOverlap);
        shape.lineTo(width / 2, -height / 2 - floorOverlap);
        shape.lineTo(width / 2, height / 2);
        shape.lineTo(-width / 2, height / 2);
        shape.closePath();
        for (const { rect } of apertures) {
          const hole = new THREE.Path();
          hole.moveTo(rect.left, rect.bottom);
          hole.lineTo(rect.left, rect.top);
          hole.lineTo(rect.right, rect.top);
          hole.lineTo(rect.right, rect.bottom);
          hole.closePath();
          shape.holes.push(hole);
        }
        const geometry = new THREE.ExtrudeGeometry(shape, {
          bevelEnabled: false,
          depth,
          steps: 1,
        });
        geometry.translate(0, 0, -depth / 2);
        geometry.computeVertexNormals();
        applyMetricSurfaceUvs(geometry, {
          textureRepeat: wallColorMap.repeat,
          tilesPerMetre: wallTextureTilesPerMetre,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.roomLightMapTexelScale = 1.35;
        wall.add(mesh);
      }

      for (const piece of pieces) {
        const touchesFloor = piece.bottom <= -height / 2 + boundaryInset;
        const pieceBottom = touchesFloor
          ? piece.bottom - floorOverlap
          : piece.bottom;
        const pieceWidth = piece.right - piece.left;
        const pieceHeight = piece.top - pieceBottom;
        const pieceCenterX = (piece.left + piece.right) / 2;
        const pieceCenterY = (pieceBottom + piece.top) / 2;
        if (!hasOnlyEnclosedApertures) {
          addWallPlane({
            baked: true,
            height: pieceHeight,
            material,
            normalSign: inwardSign,
            parent: wall,
            position: [pieceCenterX, pieceCenterY, inwardSign * depth / 2],
            width: pieceWidth,
          });
          addWallPlane({
            baked: false,
            height: pieceHeight,
            material,
            normalSign: outwardSign,
            parent: wall,
            position: [pieceCenterX, pieceCenterY, outwardSign * depth / 2],
            width: pieceWidth,
          });

          if (piece.top >= height / 2 - boundaryInset) {
            const capGeometry = new THREE.PlaneGeometry(pieceWidth, depth);
            capGeometry.rotateX(-Math.PI / 2);
            applyMetricSurfaceUvs(capGeometry, {
              offset: [pieceCenterX, piece.top, 0],
              textureRepeat: wallColorMap.repeat,
              tilesPerMetre: wallTextureTilesPerMetre,
            });
            const cap = new THREE.Mesh(
              capGeometry,
              unbakedWallMaterial(material),
            );
            cap.position.set(pieceCenterX, piece.top, 0);
            cap.castShadow = true;
            cap.receiveShadow = true;
            cap.userData.roomLightMapExclude = true;
            wall.add(cap);
          }
        }

        const pieceMesh = addBox({
          parent: wall,
          size: [pieceWidth, pieceHeight, depth],
          position: [
            pieceCenterX,
            pieceCenterY,
            0,
          ],
          material,
          castShadow: true,
        });
        // Rendering uses the separated planes/caps above. Retain the boxed
        // piece solely because the walk-mode collision system is intentionally
        // box based.
        pieceMesh.visible = false;
        wallColliderMeshes.push(pieceMesh);
      }
      return wall;
    };

    const makeDoorNode = (
      surface: RoomSurface,
      panelMaterial: THREE.MeshStandardMaterial,
    ) => {
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
          material: panelMaterial,
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
              material: panelMaterial,
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

    const makeWindowNode = (
      surface: RoomSurface,
      glassMaterial: THREE.Material,
      frameMaterial: THREE.Material,
      details: RoomWindowDetails | null,
    ) => {
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

      const glassPane = addBox({
        parent: window,
        size: [glassWidth, glassHeight, 0.012],
        material: glassMaterial,
        receiveShadow: false,
      });
      // Clear glazing is hidden from the bake. A 12 mm pane costs two
      // transmissive traversals per shadow ray and is the main reason the sun
      // never reached the floor; it is also a large noise source for a surface
      // that transmits almost everything. The runtime render still draws it.
      glassPane.userData.roomBakeHidden = true;
      wallColliderMeshes.push(glassPane);
      for (const x of [-width / 2 + frameWidth / 2, width / 2 - frameWidth / 2]) {
        addBox({
          parent: window,
          size: [frameWidth, height, frameDepth],
          position: [x, 0, 0],
          material: frameMaterial,
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
          material: frameMaterial,
          castShadow: true,
        });
      }
      const paneGrid = resolveRoomWindowPaneGrid(
        details,
        [glassWidth, glassHeight],
      );
      for (let column = 1; column < paneGrid.columns; column += 1) {
        addBox({
          parent: window,
          size: [frameWidth * 0.58, glassHeight, frameDepth * 0.82],
          position: [
            -glassWidth / 2 + (glassWidth * column) / paneGrid.columns,
            0,
            0,
          ],
          material: frameMaterial,
          castShadow: true,
        });
      }
      for (let row = 1; row < paneGrid.rows; row += 1) {
        addBox({
          parent: window,
          size: [glassWidth, frameWidth * 0.58, frameDepth * 0.82],
          position: [
            0,
            -glassHeight / 2 + (glassHeight * row) / paneGrid.rows,
            0,
          ],
          material: frameMaterial,
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

    const makeOpeningNode = (
      surface: RoomSurface,
      material: THREE.MeshStandardMaterial,
    ) => {
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
      // An opening's reveal is plaster continuing round the corner from the
      // wall, so it has to tile at the wall's density rather than fitting a
      // whole texture into a strip a few centimetres wide.
      const addOpeningTrim = (
        size: readonly [number, number, number],
        position: readonly [number, number, number],
      ) => {
        const mesh = addBox({ parent: opening, size, position, material });
        applyMetricSurfaceUvs(mesh.geometry, {
          offset: position,
          textureRepeat: wallColorMap.repeat,
          tilesPerMetre: wallTextureTilesPerMetre,
        });
        return mesh;
      };
      for (const x of [-width / 2 + trimWidth / 2, width / 2 - trimWidth / 2]) {
        addOpeningTrim([trimWidth, height, trimDepth], [x, 0, 0]);
      }
      addOpeningTrim(
        [width - trimWidth * 2, trimWidth, trimDepth],
        [0, height / 2 - trimWidth / 2, 0],
      );
      return opening;
    };

    for (const roomManifest of visibleManifests) {
      const capturedModelTransform = new THREE.Matrix4().fromArray(
        roomManifest.scan.scene.worldFromModel,
      );
      const layoutModelTransform = new THREE.Matrix4().fromArray(
        layoutTransformForManifest(roomManifest),
      );
      const worldDelta = layoutModelTransform
        .clone()
        .multiply(capturedModelTransform.clone().invert());
      const roomWorldRoot = new THREE.Group();
      roomWorldRoot.userData.roomScanId = roomManifest.scan.id;
      setMatrix(roomWorldRoot, worldDelta.toArray());
      if (isLayoutEditing) {
        roomWorldRoot.matrix.decompose(
          roomWorldRoot.position,
          roomWorldRoot.quaternion,
          roomWorldRoot.scale,
        );
        roomWorldRoot.matrixAutoUpdate = true;
      }
      webRoot.add(roomWorldRoot);
      roomWorldRoots.set(roomManifest.scan.id, roomWorldRoot);
      roomWorldDeltas.set(roomManifest.scan.id, worldDelta);
      capturedRoomTransforms.set(roomManifest.scan.id, capturedModelTransform);

      const modelRoot = new THREE.Group();
      setMatrix(modelRoot, roomManifest.scan.scene.worldFromModel);
      modelRoot.userData.roomScanId = roomManifest.scan.id;
      roomWorldRoot.add(modelRoot);
      roomPlanRoots.set(roomManifest.scan.id, modelRoot);

      // Keep architectural receivers separate from furniture. This lets the
      // lightmap bake spend its complete atlas on the room shell while props
      // retain ordinary runtime PBR shading and their original UVs.
      const architectureRoot = new THREE.Group();
      architectureRoot.userData.roomLightMapArchitecture = true;
      modelRoot.add(architectureRoot);
      roomArchitectureRoots.set(roomManifest.scan.id, architectureRoot);

      const aperturesByWall = wallApertures(roomManifest.scan.scene.surfaces);
      const roomCenterInModel = new THREE.Box3(
        new THREE.Vector3(...roomManifest.scan.scene.bounds.min),
        new THREE.Vector3(...roomManifest.scan.scene.bounds.max),
      ).getCenter(new THREE.Vector3());

      for (const surface of roomManifest.scan.scene.surfaces) {
        if (surface.category === "wall") {
          const wallNode = makeWallNode(
            surface,
            aperturesByWall.get(surface.id) ?? [],
            finishForSurface(roomManifest, "wall", wallMaterial),
            roomCenterInModel,
          );
          // The cutaway hides whichever parts of the shell stand between the
          // camera and the room. Storing the outward axis in surface space
          // keeps that test valid after a layout transform moves the group.
          wallNode.userData.roomWallOutward = [
            0,
            0,
            surfaceOutwardSign(surface, roomCenterInModel),
          ];
          architectureRoot.add(wallNode);
        } else if (surface.category === "door") {
          const doorNode = makeDoorNode(
            surface,
            finishForSurface(roomManifest, "door", doorMaterial),
          );
          // Apertures sit in the plane of their wall, so the same outward test
          // takes them out of the cutaway together with it.
          doorNode.userData.roomWallOutward = [
            0,
            0,
            surfaceOutwardSign(surface, roomCenterInModel),
          ];
          architectureRoot.add(doorNode);
        } else if (surface.category === "window") {
          const acceptedWindowAppearance = roomManifest.scan.aiAnalysis
            ?.surfaceAppearances.find(
              (candidate) =>
                candidate.status === "accepted" &&
                candidate.surfaceCategory === "window",
            );
          const windowNode = makeWindowNode(
            surface,
            windowMaterial,
            finishForSurface(roomManifest, "window", windowFrameMaterial),
            acceptedWindowAppearance?.windowDetails ?? null,
          );
          // The bake rig puts the sun outside the largest window so daylight
          // enters the sealed room the way it does in the real one.
          windowNode.userData.roomWindowArea =
            Math.max(surface.dimensions[0], 0) * Math.max(surface.dimensions[1], 0);
          windowNode.userData.roomWallOutward = [
            0,
            0,
            surfaceOutwardSign(surface, roomCenterInModel),
          ];
          architectureRoot.add(windowNode);
        } else if (surface.category === "opening") {
          const openingNode = makeOpeningNode(
            surface,
            finishForSurface(roomManifest, "opening", openingMaterial),
          );
          openingNode.userData.roomWallOutward = [
            0,
            0,
            surfaceOutwardSign(surface, roomCenterInModel),
          ];
          architectureRoot.add(openingNode);
        } else {
          const dimensions = normalizedDimensions(surface.category, surface.dimensions);
          const geometry = new THREE.BoxGeometry(...dimensions);
          applyMetricSurfaceUvs(geometry, {
            textureRepeat: floorColorMap.repeat,
            tilesPerMetre: floorTextureTilesPerMetre,
          });
          const material = finishForSurface(
            roomManifest,
            "floor",
            floorMaterial,
          );
          const mesh = new THREE.Mesh(geometry, material);
          // Contact shadows are stored on the receiving floor, not on the
          // chair/table UVs. Give floor charts extra atlas area so furniture
          // feet remain several texels wide instead of collapsing to a blur.
          mesh.userData.roomLightMapTexelScale = 1.6;
          mesh.receiveShadow = true;
          setMatrix(mesh, surface.transform);
          architectureRoot.add(mesh);
          // Smooth linoleum receives the stable room reflection probe.
          if (material.roughness <= 0.8) reflectiveFloorMeshes.push(mesh);

          if (
            !rayTracedLighting &&
            roomManifest.scan.id === manifest.scan.id
          ) {
            const reflectionWidth = Math.min(
              1024,
              Math.max(512, Math.round(host.clientWidth * 0.65)),
            );
            const reflectionHeight = Math.min(
              1024,
              Math.max(512, Math.round(host.clientHeight * 0.65)),
            );
            const reflector = new Reflector(
              new THREE.PlaneGeometry(dimensions[0], dimensions[2]),
              {
                clipBias: 0.002,
                color: 0x353a3d,
                multisample: 2,
                shader: linoleumReflectionShader(
                  reflectionWidth,
                  reflectionHeight,
                  progressiveLighting ? 0.06 : 0.035,
                ),
                textureHeight: reflectionHeight,
                textureWidth: reflectionWidth,
              },
            );
            const reflectionMatrix = new THREE.Matrix4().fromArray(
              surface.transform,
            );
            const reflectionNormal = new THREE.Vector3(0, 1, 0)
              .transformDirection(reflectionMatrix);
            const reflectionOrigin = new THREE.Vector3().setFromMatrixPosition(
              reflectionMatrix,
            );
            const roomwardDirection = roomCenterInModel
              .clone()
              .sub(reflectionOrigin);
            const roomwardSign =
              reflectionNormal.dot(roomwardDirection) >= 0 ? 1 : -1;
            reflectionMatrix.multiply(
              new THREE.Matrix4().makeTranslation(
                0,
                roomwardSign * (dimensions[1] * 0.5 + 0.0025),
                0,
              ),
            );
            // PlaneGeometry lies in XY with a +Z normal. Rotate it into the
            // floor's local XZ plane and face the side selected above.
            reflectionMatrix.multiply(
              new THREE.Matrix4().makeRotationX(
                roomwardSign > 0 ? -Math.PI / 2 : Math.PI / 2,
              ),
            );
            setMatrix(reflector, reflectionMatrix.toArray());
            reflector.renderOrder = 5_000;
            const reflectorMaterial = reflector.material as THREE.ShaderMaterial;
            reflectorMaterial.transparent = true;
            reflectorMaterial.depthWrite = false;
            reflectorMaterial.polygonOffset = true;
            reflectorMaterial.polygonOffsetFactor = -1;
            reflectorMaterial.polygonOffsetUnits = -1;
            const renderReflection = reflector.onBeforeRender.bind(reflector);
            reflector.onBeforeRender = (
              activeRenderer,
              activeScene,
              activeCamera,
              activeGeometry,
              activeMaterial,
              activeGroup,
            ) => {
              // The virtual reflection camera sits below this plane. Hide the
              // thick RoomPlan floor box only for that off-screen pass so it
              // cannot occlude all furniture before the reflected rays reach it.
              const floorVisible = mesh.visible;
              mesh.visible = false;
              try {
                renderReflection(
                  activeRenderer,
                  activeScene,
                  activeCamera,
                  activeGeometry,
                  activeMaterial,
                  activeGroup,
                );
              } finally {
                mesh.visible = floorVisible;
              }
            };
            architectureRoot.add(reflector);
            floorReflectors.push(reflector);
          }
        }
      }

      for (const item of roomManifest.scan.scene.objects) {
        const dimensions = normalizedDimensions(item.category, item.dimensions);
        const acceptedSuggestion = acceptedSuggestionForObject(
          roomManifest,
          item.id,
        );
        const objectModel = acceptedSuggestion
          ? createSuggestionModel(
              roomManifest,
              acceptedSuggestion,
              item.category,
              dimensions,
            )
          : createRoomObjectModel({
              category: item.category,
              dimensions,
              materials: {
                primary: finishForObject(roomManifest, item.id, item.category),
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

        const previewSuggestion = roomManifest.scan.aiAnalysis?.objectSuggestions.find(
          (candidate) =>
            candidate.status === "pending" && candidate.roomObjectId === item.id,
        );
        if (previewSuggestion) {
          const previewModel = createSuggestionModel(
            roomManifest,
            previewSuggestion,
            item.category,
            dimensions,
          );
          previewModel.visible = false;
          setMatrix(previewModel, item.transform);
          modelRoot.add(previewModel);
          suggestionPreviews.set(previewSuggestion.id, {
            current: objectModel,
            preview: previewModel,
          });
        }
      }

      for (const suggestion of roomManifest.scan.aiAnalysis?.objectSuggestions ?? []) {
        if (
          suggestion.roomObjectId ||
          !suggestion.estimatedPlacement ||
          suggestion.status === "dismissed"
        ) {
          continue;
        }
        const category = estimatedRoomObjectModelCategory(suggestion);
        const estimatedModel = createSuggestionModel(
          roomManifest,
          suggestion,
          category,
          suggestion.estimatedPlacement.dimensions,
        );
        estimatedModel.position.fromArray(suggestion.estimatedPlacement.position);
        estimatedModel.rotation.y = THREE.MathUtils.degToRad(
          suggestion.estimatedPlacement.rotationYDegrees,
        );
        estimatedModel.userData.aiSuggestionId = suggestion.id;
        estimatedModel.userData.roomScanId = roomManifest.scan.id;
        modelRoot.add(estimatedModel);
        if (suggestion.status === "accepted") {
          estimatedSuggestionModels.set(suggestion.id, estimatedModel);
          estimatedSuggestionMeshes.push(estimatedModel);
        } else {
          estimatedModel.visible = false;
          suggestionPreviews.set(suggestion.id, {
            current: null,
            preview: estimatedModel,
          });
        }
      }
    }

    let activeSuggestionPreview: string | null = null;
    const applySuggestionPreview = (suggestionId: string | null) => {
      if (activeSuggestionPreview) {
        const previous = suggestionPreviews.get(activeSuggestionPreview);
        if (previous) {
          if (previous.current) previous.current.visible = true;
          previous.preview.visible = false;
        }
      }
      activeSuggestionPreview = suggestionId;
      if (!suggestionId) return;
      const next = suggestionPreviews.get(suggestionId);
      if (!next) return;
      if (next.current) next.current.visible = false;
      next.preview.visible = true;
    };
    suggestionPreviewCommandRef.current = applySuggestionPreview;
    applySuggestionPreview(previewSuggestionRef.current);

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

    const transformControls = isLayoutEditing
      ? new TransformControls(camera, renderer.domElement)
      : null;
    const transformHelper = transformControls?.getHelper() ?? null;
    if (transformControls && transformHelper) {
      transformControls.setSpace("world");
      transformControls.setSize(0.82);
      transformControls.setColors(0xe34b4b, 0x4fbf72, 0x3979e8, 0xffa33b);
      scene.add(transformHelper);

      const configureLayoutTool = (tool: LayoutTool) => {
        transformControls.setMode(tool);
        const translating = tool === "translate";
        transformControls.showX = translating;
        transformControls.showY = !translating;
        transformControls.showZ = translating;
        transformControls.showXY = false;
        transformControls.showYZ = false;
        transformControls.showXZ = translating;
        transformControls.showE = false;
        transformControls.showXYZE = false;
      };
      const attachLayoutRoom = (scanId: string | null) => {
        const roomRoot = scanId ? roomWorldRoots.get(scanId) : null;
        if (!roomRoot) {
          transformControls.detach();
          return;
        }
        roomRoot.updateMatrixWorld(true);
        transformControls.attach(roomRoot);
      };
      const applyLayoutTransforms = (
        transforms: Record<string, SpatialMatrix4>,
      ) => {
        layoutTransformsRef.current = transforms;
        for (const roomManifest of visibleManifests) {
          const scanId = roomManifest.scan.id;
          const roomRoot = roomWorldRoots.get(scanId);
          const capturedTransform = capturedRoomTransforms.get(scanId);
          if (!roomRoot || !capturedTransform) continue;
          const layoutTransform = transforms[scanId]
            ?? roomManifest.scan.layoutTransform
            ?? roomManifest.scan.scene.worldFromModel;
          const worldDelta = new THREE.Matrix4()
            .fromArray(layoutTransform)
            .multiply(capturedTransform.clone().invert());
          roomRoot.matrix.copy(worldDelta);
          roomRoot.matrix.decompose(
            roomRoot.position,
            roomRoot.quaternion,
            roomRoot.scale,
          );
          roomRoot.matrixAutoUpdate = true;
          roomRoot.updateMatrix();
          roomRoot.updateMatrixWorld(true);
          roomWorldDeltas.set(scanId, worldDelta);
        }
        renderer.shadowMap.needsUpdate = true;
      };
      const commitLayoutTransform = () => {
        const roomRoot = transformControls.object;
        const scanId = roomRoot?.userData.roomScanId;
        const capturedTransform = typeof scanId === "string"
          ? capturedRoomTransforms.get(scanId)
          : null;
        if (!roomRoot || typeof scanId !== "string" || !capturedTransform) return;
        roomRoot.updateMatrix();
        const layoutTransform = new THREE.Matrix4()
          .copy(roomRoot.matrix)
          .multiply(capturedTransform)
          .toArray() as SpatialMatrix4;
        if (layoutTransform.every(Number.isFinite)) {
          onChangeLayoutTransformRef.current?.(scanId, layoutTransform);
        }
      };
      const onTransformDraggingChanged = (event: { value: unknown }) => {
        controls.enabled =
          !mapBackground && navigationMode === "orbit" && !Boolean(event.value);
      };
      const onTransformObjectChange = () => {
        renderer.shadowMap.needsUpdate = true;
      };
      transformControls.addEventListener(
        "dragging-changed",
        onTransformDraggingChanged,
      );
      transformControls.addEventListener("objectChange", onTransformObjectChange);
      transformControls.addEventListener("mouseUp", commitLayoutTransform);
      layoutSelectionCommandRef.current = attachLayoutRoom;
      layoutToolCommandRef.current = configureLayoutTool;
      layoutTransformsCommandRef.current = applyLayoutTransforms;
      configureLayoutTool(layoutToolRef.current);
      attachLayoutRoom(selectedLayoutScanRef.current);
    }

    const estimatedTransformControls = !isLayoutEditing
      ? new TransformControls(camera, renderer.domElement)
      : null;
    const estimatedTransformHelper = estimatedTransformControls?.getHelper() ?? null;
    if (estimatedTransformControls && estimatedTransformHelper) {
      estimatedTransformControls.setSize(0.72);
      estimatedTransformControls.setTranslationSnap(0.025);
      estimatedTransformControls.setRotationSnap(THREE.MathUtils.degToRad(5));
      estimatedTransformControls.setColors(0xe34b4b, 0x4fbf72, 0x3979e8, 0xffa33b);
      scene.add(estimatedTransformHelper);

      const configureSuggestionEditTool = (tool: LayoutTool) => {
        estimatedTransformControls.setMode(tool);
        estimatedTransformControls.setSpace(tool === "translate" ? "world" : "local");
        const translating = tool === "translate";
        estimatedTransformControls.showX = translating;
        estimatedTransformControls.showY = true;
        estimatedTransformControls.showZ = translating;
        estimatedTransformControls.showXY = false;
        estimatedTransformControls.showYZ = false;
        estimatedTransformControls.showXZ = false;
        estimatedTransformControls.showE = false;
        estimatedTransformControls.showXYZE = false;
      };
      const attachEstimatedSuggestion = (suggestionId: string | null) => {
        const object = suggestionId
          ? estimatedSuggestionModels.get(suggestionId)
          : null;
        if (object) estimatedTransformControls.attach(object);
        else estimatedTransformControls.detach();
      };
      const commitEstimatedSuggestion = () => {
        const object = estimatedTransformControls.object;
        const suggestionId = object?.userData.aiSuggestionId;
        if (!object || typeof suggestionId !== "string") return;
        const degrees = THREE.MathUtils.radToDeg(object.rotation.y);
        const normalizedDegrees = ((degrees + 180) % 360 + 360) % 360 - 180;
        onChangeObjectSuggestionPlacementRef.current?.(
          suggestionId,
          object.position.toArray() as [number, number, number],
          normalizedDegrees,
        );
      };
      const onEstimatedDraggingChanged = (event: { value: unknown }) => {
        controls.enabled = navigationMode === "orbit" && !Boolean(event.value);
      };
      const onEstimatedObjectChange = () => {
        renderer.shadowMap.needsUpdate = true;
      };
      estimatedTransformControls.addEventListener(
        "dragging-changed",
        onEstimatedDraggingChanged,
      );
      estimatedTransformControls.addEventListener(
        "objectChange",
        onEstimatedObjectChange,
      );
      estimatedTransformControls.addEventListener(
        "mouseUp",
        commitEstimatedSuggestion,
      );
      suggestionEditSelectionCommandRef.current = attachEstimatedSuggestion;
      suggestionEditToolCommandRef.current = configureSuggestionEditTool;
      configureSuggestionEditTool(suggestionEditToolRef.current);
      attachEstimatedSuggestion(editableSuggestionRef.current);
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
      renderer.shadowMap.needsUpdate = true;
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
          layoutTransformForManifest(roomManifest),
        ));
      return modelBox.applyMatrix4(modelToWeb);
    };
    const roomBoundsById = new Map(
      visibleManifests.map((roomManifest) => [
        roomManifest.scan.id,
        boundsForManifest(roomManifest),
      ] as const),
    );
    const primaryBox = roomBoundsById.get(manifest.scan.id)
      ?? boundsForManifest(manifest);
    const box = [...roomBoundsById.values()].reduce((combined, roomBounds) => {
      return combined.union(roomBounds);
    }, new THREE.Box3());
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1.5);
    const webFromWorld = new THREE.Matrix4().fromArray(
      manifest.scan.scene.webFromWorld,
    );

    const daylightAreaLights: THREE.RectAreaLight[] = [];
    let jitterProgressiveLights = () => undefined;

    if (lightingMode === "live") {
      liveSun.position
        .copy(center)
        .add(new THREE.Vector3(radius * 1.25, radius * 2.4, radius * 1.15));
      liveSun.target.position.copy(center);
      liveFillLight.position
        .copy(center)
        .add(new THREE.Vector3(-radius * 1.6, radius * 1.1, -radius * 0.9));
      liveFillLight.target.position.copy(center);

      // Fit the one directional shadow map tightly to the visible room. This
      // is the original Live setup: predictable, inexpensive, and free of the
      // overlapping gradients produced by the later multi-window light rig.
      liveSun.updateMatrixWorld(true);
      liveSun.target.updateMatrixWorld(true);
      const shadowCamera = liveSun.shadow.camera;
      shadowCamera.position.copy(liveSun.position);
      shadowCamera.lookAt(liveSun.target.position);
      shadowCamera.updateMatrixWorld(true);
      const lightSpaceBounds = new THREE.Box3().makeEmpty();
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            lightSpaceBounds.expandByPoint(
              new THREE.Vector3(x, y, z).applyMatrix4(
                shadowCamera.matrixWorldInverse,
              ),
            );
          }
        }
      }
      const shadowMargin = THREE.MathUtils.clamp(radius * 0.08, 0.3, 1.25);
      shadowCamera.left = lightSpaceBounds.min.x - shadowMargin;
      shadowCamera.right = lightSpaceBounds.max.x + shadowMargin;
      shadowCamera.bottom = lightSpaceBounds.min.y - shadowMargin;
      shadowCamera.top = lightSpaceBounds.max.y + shadowMargin;
      shadowCamera.near = Math.max(
        0.1,
        -lightSpaceBounds.max.z - shadowMargin,
      );
      shadowCamera.far = Math.max(
        shadowCamera.near + 1,
        -lightSpaceBounds.min.z + shadowMargin,
      );
      shadowCamera.updateProjectionMatrix();

      const shadowWorldSize = Math.max(
        shadowCamera.right - shadowCamera.left,
        shadowCamera.top - shadowCamera.bottom,
      );
      const shadowWorldUnitsPerTexel =
        shadowWorldSize / liveSun.shadow.mapSize.x;
      liveSun.shadow.radius = THREE.MathUtils.clamp(
        0.055 / shadowWorldUnitsPerTexel,
        2.5,
        7,
      );
      liveSun.shadow.normalBias = THREE.MathUtils.clamp(
        shadowWorldUnitsPerTexel * 0.75,
        0.0025,
        0.018,
      );
    }

    // The camera's default orbit azimuth. The key is placed away from it so
    // the cutaway keeps a lit side and a shaded side instead of flattening.
    const defaultCameraAzimuth = azimuthDegrees(1.25, 1.35);
    let bakeKeyAzimuth = defaultCameraAzimuth;

    if (lightingMode === "realistic") {
      scene.updateMatrixWorld(true);
      // Light should arrive from the side the room's own daylight comes from,
      // so take the key's azimuth from the largest window.
      let widestWindowArea = 0;
      let windowAzimuth: number | null = null;
      for (const root of roomArchitectureRoots.values()) {
        root.traverse((object) => {
          const area = Number(object.userData.roomWindowArea) || 0;
          if (area <= widestWindowArea) return;
          const outward = object
            .getWorldPosition(new THREE.Vector3())
            .sub(center);
          outward.y = 0;
          if (outward.lengthSq() < 1e-6) return;
          widestWindowArea = area;
          windowAzimuth = azimuthDegrees(outward.x, outward.z);
        });
      }
      bakeKeyAzimuth = resolveRoomKeyAzimuth({
        cameraAzimuth: defaultCameraAzimuth,
        windowAzimuth,
      });

      // The key: one warm source on a diagonal, 46 degrees above the horizon,
      // hung under the ceiling so the sealed shell cannot block it.
      const ceilingHeight = box.max.y;
      const keyPlacement = roomKeyPanelPlacement({
        ceilingClearance: ceilingHeight - 0.16,
        centerHeight: center.y,
        maximumHorizontal: Math.max(Math.min(size.x, size.z) * 0.42, 0.4),
      });
      const keyAzimuthRadians = (bakeKeyAzimuth * Math.PI) / 180;
      const keyPosition = new THREE.Vector3(
        center.x + Math.sin(keyAzimuthRadians) * keyPlacement.horizontal,
        center.y + keyPlacement.rise,
        center.z + Math.cos(keyAzimuthRadians) * keyPlacement.horizontal,
      );
      // Panel size is what sets penumbra width. A source spanning most of the
      // room subtends a huge solid angle and smears every contact shadow, so
      // keep it compact enough to leave shadows legible.
      const keyWidth = Math.max(Math.min(size.x, size.z) * 0.26, 0.75);
      const keyLight = new THREE.RectAreaLight(
        roomKeyLightColor,
        roomKeyRadianceForPanel({
          distance: keyPlacement.distance,
          height: keyWidth,
          width: keyWidth,
        }),
        keyWidth,
        keyWidth,
      );
      keyLight.position.copy(keyPosition);
      // RectAreaLight emits along local -Z, so point local +Z back at the panel
      // to send its light toward the room.
      keyLight.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        keyPosition.clone().sub(center).normalize(),
      );
      daylightAreaLights.push(keyLight);

      // A sealed room needs its ceiling before the bake can be trusted: it is
      // what stops daylight escaping upward and what returns the bounce that
      // fills the upper corners. The camera never sees it, so it exists only
      // for the tracer.
      const ceilingMaterial = new THREE.MeshStandardMaterial({
        color: 0xf2efe9,
        metalness: 0,
        roughness: 0.95,
        side: THREE.DoubleSide,
      });
      const ceiling = new THREE.Mesh(
        new THREE.BoxGeometry(size.x + 0.4, 0.08, size.z + 0.4),
        ceilingMaterial,
      );
      ceiling.position.set(center.x, ceilingHeight + 0.04, center.z);
      ceiling.userData.roomLightMapExclude = true;

      // The fill is a broad, cool source hung just under that ceiling. Sizing
      // it from the room and solving its radiance for the target ratio keeps
      // the key-to-fill balance the same in a cupboard and in a hall.
      const fillWidth = Math.max(size.x * 0.86, 1);
      const fillDepth = Math.max(size.z * 0.86, 1);
      const fillDistance = Math.max(ceilingHeight - box.min.y, 1);
      const fillLight = new THREE.RectAreaLight(
        roomFillLightColor,
        roomFillRadianceForKey({
          distance: fillDistance,
          height: fillDepth,
          width: fillWidth,
        }),
        fillWidth,
        fillDepth,
      );
      fillLight.position.set(center.x, ceilingHeight - 0.06, center.z);
      // RectAreaLight emits along local -Z; aim it at the floor.
      fillLight.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0),
      );
      daylightAreaLights.push(fillLight);

      for (const object of [keyLight, ceiling, fillLight]) {
        object.visible = false;
        scene.add(object);
        bakeOnlyObjects.push(object);
      }
      scene.updateMatrixWorld(true);
    }

    if (lightingMode === "rendering") {
      const softbox = new THREE.RectAreaLight(
        0xfff8ef,
        7,
        Math.max(1.5, size.x * 0.62),
        Math.max(1.5, size.z * 0.62),
      );
      softbox.position.set(
        center.x,
        box.max.y + Math.max(0.9, size.y * 0.32),
        center.z,
      );
      // RectAreaLight emits along local -Z. A moderately sized overhead source
      // keeps the overview evenly lit while retaining legible penumbrae.
      softbox.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0),
      );
      scene.add(softbox);
      daylightAreaLights.push(softbox);
    }

    if (progressiveLighting) {
      const geometryUsage = new Map<THREE.BufferGeometry, number>();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometryUsage.set(
          object.geometry,
          (geometryUsage.get(object.geometry) ?? 0) + 1,
        );
      });
      const replacedGeometryUsage = new Map<THREE.BufferGeometry, number>();
      const temporaryUvs: Array<{
        geometry: THREE.BufferGeometry;
        uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
      }> = [];
      const progressiveMeshes: THREE.Mesh[] = [];

      for (const root of roomPlanRoots.values()) {
        root.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.visible) return;
          const material = object.material;
          if (
            Array.isArray(material) ||
            material.transparent ||
            material.opacity < 0.999 ||
            !(
              material instanceof THREE.MeshStandardMaterial ||
              material instanceof THREE.MeshPhongMaterial ||
              material instanceof THREE.MeshLambertMaterial
            )
          ) {
            return;
          }
          const sourceGeometry = object.geometry;
          if (
            !sourceGeometry.getAttribute("uv") ||
            !sourceGeometry.getAttribute("normal")
          ) {
            return;
          }

          // ProgressiveLightMap copies uv0 into uv1. RoomPlan boxes reuse the
          // same uv0 square on every side, which would make unrelated faces
          // overwrite one another. Give every triangle unique temporary UVs,
          // let the addon copy those into uv1, then restore the texture UVs.
          const geometry = sourceGeometry.index
            ? sourceGeometry.toNonIndexed()
            : sourceGeometry.clone();
          const originalUv = geometry.getAttribute("uv").clone();
          const position = geometry.getAttribute("position");
          const triangleCount = Math.floor(position.count / 3);
          if (triangleCount > 2) {
            const columns = Math.ceil(Math.sqrt(triangleCount));
            const rows = Math.ceil(triangleCount / columns);
            const margin = 0.08;
            const atlasUv = new Float32Array(position.count * 2);
            for (let triangle = 0; triangle < triangleCount; triangle += 1) {
              const column = triangle % columns;
              const row = Math.floor(triangle / columns);
              const uvOffset = triangle * 6;
              atlasUv[uvOffset] = (column + margin) / columns;
              atlasUv[uvOffset + 1] = (row + margin) / rows;
              atlasUv[uvOffset + 2] = (column + 1 - margin) / columns;
              atlasUv[uvOffset + 3] = (row + margin) / rows;
              atlasUv[uvOffset + 4] = (column + margin) / columns;
              atlasUv[uvOffset + 5] = (row + 1 - margin) / rows;
            }
            geometry.setAttribute(
              "uv",
              new THREE.BufferAttribute(atlasUv, 2),
            );
          }
          object.geometry = geometry;
          temporaryUvs.push({ geometry, uv: originalUv });
          progressiveMeshes.push(object);
          replacedGeometryUsage.set(
            sourceGeometry,
            (replacedGeometryUsage.get(sourceGeometry) ?? 0) + 1,
          );
        });
      }

      for (const [geometry, replacements] of replacedGeometryUsage) {
        if (replacements === geometryUsage.get(geometry)) geometry.dispose();
      }

      if (progressiveMeshes.length > 0) {
        const lightCount = progressiveQualityPreset.lightCount;
        const progressiveShadowResolution = Math.min(
          progressiveQualityPreset.shadowResolution,
          renderer.capabilities.maxTextureSize,
        );
        const progressiveAtlasResolution = Math.min(
          progressiveQualityPreset.atlasResolution,
          renderer.capabilities.maxTextureSize,
        );
        const shadowExtent = Math.max(radius * 1.08, 1.5);
        const lightTarget = new THREE.Object3D();
        lightTarget.position.copy(center);
        lightTarget.updateMatrixWorld(true);
        for (let index = 0; index < lightCount; index += 1) {
          const light = new THREE.DirectionalLight(
            0xfff2df,
            Math.PI / lightCount,
          );
          light.target = lightTarget;
          light.castShadow = true;
          light.shadow.mapSize.set(
            progressiveShadowResolution,
            progressiveShadowResolution,
          );
          light.shadow.bias = -0.00004;
          light.shadow.normalBias = THREE.MathUtils.clamp(
            radius / 1400,
            0.0015,
            0.007,
          );
          light.shadow.camera.left = -shadowExtent;
          light.shadow.camera.right = shadowExtent;
          light.shadow.camera.bottom = -shadowExtent;
          light.shadow.camera.top = shadowExtent;
          light.shadow.camera.near = 0.08;
          light.shadow.camera.far = Math.max(12, radius * 8);
          light.shadow.camera.updateProjectionMatrix();
          progressiveLights.push(light);
        }

        progressiveLightMap = new ProgressiveLightMap(
          renderer,
          progressiveAtlasResolution,
        );
        progressiveLightMap.addObjectsToLightMap([
          ...progressiveLights,
          ...progressiveMeshes,
        ]);
        for (const { geometry, uv } of temporaryUvs) {
          geometry.setAttribute("uv", uv);
          geometry.getAttribute("uv").needsUpdate = true;
        }
        for (const mesh of progressiveMeshes) {
          const material = mesh.material;
          if (Array.isArray(material)) continue;
          if (
            material instanceof THREE.MeshStandardMaterial ||
            material instanceof THREE.MeshPhongMaterial ||
            material instanceof THREE.MeshLambertMaterial
          ) {
            material.lightMapIntensity = 1.18;
            material.needsUpdate = true;
          }
        }

        const keyDirection = new THREE.Vector3(1.25, 2.4, 1.15).normalize();
        const keyTangent = new THREE.Vector3()
          .crossVectors(keyDirection, new THREE.Vector3(0, 1, 0))
          .normalize();
        const keyBitangent = new THREE.Vector3()
          .crossVectors(keyDirection, keyTangent)
          .normalize();
        jitterProgressiveLights = () => {
          for (let index = 0; index < progressiveLights.length; index += 1) {
            const sequence =
              progressiveLightMapSamples * progressiveLights.length + index;
            const sampleX = textureNoise(sequence + 1, index + 3, 71);
            const sampleY = textureNoise(sequence + 5, index + 11, 97);
            const light = progressiveLights[index]!;
            if (sequence % 8 === 0) {
              // One eighth of the samples cover the upper hemisphere. This is
              // not multi-bounce GI, but it creates a stable occluded sky-fill
              // layer while preserving stronger furniture-shadow contrast.
              const height = THREE.MathUtils.lerp(0.18, 1, sampleY);
              const horizontal = Math.sqrt(Math.max(0, 1 - height * height));
              const azimuth = sampleX * Math.PI * 2;
              light.position.copy(center).addScaledVector(
                new THREE.Vector3(
                  Math.cos(azimuth) * horizontal,
                  height,
                  Math.sin(azimuth) * horizontal,
                ),
                radius * 3,
              );
              light.color.setHex(0xdcecff);
            } else {
              // Jitter the main source over a compact virtual softbox. The
              // accumulated visibility produces smooth but readable shadows.
              const diskRadius = Math.sqrt(sampleX) * radius * 0.21;
              const angle = sampleY * Math.PI * 2;
              light.position
                .copy(center)
                .addScaledVector(keyDirection, radius * 3)
                .addScaledVector(
                  keyTangent,
                  Math.cos(angle) * diskRadius,
                )
                .addScaledVector(
                  keyBitangent,
                  Math.sin(angle) * diskRadius,
                );
              light.color.setHex(0xfff2df);
            }
            light.updateMatrixWorld(true);
            light.shadow.needsUpdate = true;
          }
        };
      } else {
        setLightingProgress(100);
        setLightingStatus("ready");
      }
    }

    // Bake the already-lit room into a compact irradiance probe. This captures
    // the directional colour of light reflected by the floor, walls, and large
    // objects, then reduces the cubemap to nine spherical-harmonic coefficients.
    // Unlike an ordinary ambient light, the result can make upward-facing areas
    // warmer than walls facing the open sky, with no per-frame cubemap cost.
    let bounceProbe: THREE.LightProbe | null = null;
    const bakeDiffuseBounce = () => {
      const probeResolution = 32;
      const bounceTarget = new THREE.WebGLCubeRenderTarget(probeResolution, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
      });
      const probeCamera = new THREE.CubeCamera(
        Math.max(0.04, radius / 500),
        Math.max(20, radius * 6),
        bounceTarget,
      );
      probeCamera.position.copy(center);
      probeCamera.position.y = THREE.MathUtils.clamp(
        box.min.y + Math.min(1.45, size.y * 0.55),
        box.min.y + 0.2,
        box.max.y - 0.2,
      );

      const previousClearColor = renderer.getClearColor(new THREE.Color());
      const previousClearAlpha = renderer.getClearAlpha();
      const previousToneMapping = renderer.toneMapping;
      const previousFog = scene.fog;
      const previousKeyframeVisibility = keyframeRoot.visible;
      const markerVisibility = markerMeshes.map((marker) => marker.visible);

      // Black outside the room prevents the light probe from baking the light
      // or dark application theme into the model. Fog, overlays, and tone
      // mapping are presentation effects and should not become indirect light.
      renderer.setClearColor(0x000000, 1);
      renderer.toneMapping = THREE.NoToneMapping;
      scene.fog = null;
      keyframeRoot.visible = false;
      markerMeshes.forEach((marker) => {
        marker.visible = false;
      });

      try {
        try {
          probeCamera.update(renderer, scene);
        } finally {
          renderer.setClearColor(previousClearColor, previousClearAlpha);
          renderer.toneMapping = previousToneMapping;
          scene.fog = previousFog;
          keyframeRoot.visible = previousKeyframeVisibility;
          markerMeshes.forEach((marker, index) => {
            marker.visible = markerVisibility[index] ?? true;
          });
        }

        // A synchronous read is appropriate for this tiny one-time bake and
        // avoids an asynchronous WebGL readback surviving React Strict Mode's
        // development-only effect cleanup. The coordinate mapping mirrors
        // Three.js's LightProbeGenerator for WebGL cube render targets.
        const sh = new THREE.SphericalHarmonics3();
        const coefficients = sh.coefficients;
        const pixels = new Uint8Array(
          probeResolution * probeResolution * 4,
        );
        const direction = new THREE.Vector3();
        const coordinate = new THREE.Vector3();
        const basis = new Array<number>(9).fill(0);
        const pixelSize = 2 / probeResolution;
        const coordinateFlip =
          renderer.coordinateSystem === THREE.WebGLCoordinateSystem ? -1 : 1;
        let totalWeight = 0;
        let capturedEnergy = 0;

        for (let face = 0; face < 6; face += 1) {
          renderer.readRenderTargetPixels(
            bounceTarget,
            0,
            0,
            probeResolution,
            probeResolution,
            pixels,
            face,
          );
          for (let index = 0; index < pixels.length; index += 4) {
            const red = (pixels[index] ?? 0) / 255;
            const green = (pixels[index + 1] ?? 0) / 255;
            const blue = (pixels[index + 2] ?? 0) / 255;
            capturedEnergy += red + green + blue;

            const pixelIndex = index / 4;
            const column =
              (1 - (pixelIndex % probeResolution + 0.5) * pixelSize) *
              coordinateFlip;
            const row =
              1 -
              (Math.floor(pixelIndex / probeResolution) + 0.5) * pixelSize;
            switch (face) {
              case 0:
                coordinate.set(
                  -coordinateFlip,
                  row,
                  column * coordinateFlip,
                );
                break;
              case 1:
                coordinate.set(
                  coordinateFlip,
                  row,
                  -column * coordinateFlip,
                );
                break;
              case 2:
                coordinate.set(column, 1, -row);
                break;
              case 3:
                coordinate.set(column, -1, row);
                break;
              case 4:
                coordinate.set(column, row, 1);
                break;
              default:
                coordinate.set(-column, row, -1);
            }

            const lengthSquared = coordinate.lengthSq();
            const weight = 4 / (Math.sqrt(lengthSquared) * lengthSquared);
            totalWeight += weight;
            direction.copy(coordinate).normalize();
            THREE.SphericalHarmonics3.getBasisAt(direction, basis);
            for (let coefficient = 0; coefficient < 9; coefficient += 1) {
              coefficients[coefficient]!.x +=
                basis[coefficient]! * red * weight;
              coefficients[coefficient]!.y +=
                basis[coefficient]! * green * weight;
              coefficients[coefficient]!.z +=
                basis[coefficient]! * blue * weight;
            }
          }
        }

        if (capturedEnergy <= 0.001) return;
        const normalization = (4 * Math.PI) / totalWeight;
        coefficients.forEach((coefficient) => {
          coefficient.multiplyScalar(normalization);
        });
        const generatedProbe = new THREE.LightProbe(sh, 0.68);

        // Match the original Live balance after the one-time probe capture.
        bounceProbe = generatedProbe;
        scene.add(generatedProbe);
        skyLight.intensity = 0.32;
        liveFillLight.intensity = 0.1;
        scene.environmentIntensity = 0.32;
      } catch {
        // Retain the original sky/sun/fill rig if cubemap readback is
        // unavailable on a particular GPU.
      } finally {
        bounceTarget.dispose();
      }
    };
    if (lightingMode === "live") {
      bakeDiffuseBounce();
    } else if (lightingMode === "realistic") {
      // Realistic hides its whole rig from the raster pass, which would leave
      // the room black for the length of the bake. A hemisphere preview keeps
      // the cutaway readable and navigable meanwhile; the path tracer ignores
      // hemisphere and ambient lights, so none of this reaches the atlas.
      // applyFinishedLighting swaps it for the baked presentation.
      skyLight.intensity = 0.5;
      ambientFillLight.intensity = 0.12;
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.3;
    } else if (rayTracedLighting) {
      // Rendering gets its fill from the traced bounces of the overhead
      // softbox, so it starts with nothing else.
      skyLight.intensity = 0;
      ambientFillLight.intensity = 0;
      scene.environment = null;
      scene.environmentIntensity = 0;
    } else {
      // ProgressiveLightMap owns the direct diffuse lighting. Retain only a
      // quiet sky/environment layer for unwrapped transparent materials and
      // view-dependent reflections.
      skyLight.intensity = 0.1;
      ambientFillLight.intensity = 0;
      scene.environmentIntensity = 0.08;
    }

    const gridSize = Math.max(10, Math.ceil(Math.max(size.x, size.z) * 1.8));
    const createGrid = (darkMode: boolean) => {
      const palette = sceneThemePalettes[darkMode ? "dark" : "light"];
      const helper = new THREE.GridHelper(
        gridSize,
        Math.max(10, gridSize * 2),
        palette.gridCenter,
        palette.grid,
      );
      helper.position.set(center.x, box.min.y - 0.025, center.z);
      return helper;
    };
    const disposeGrid = (helper: THREE.GridHelper) => {
      helper.geometry.dispose();
      const gridMaterials = Array.isArray(helper.material)
        ? helper.material
        : [helper.material];
      gridMaterials.forEach((material) => material.dispose());
    };
    let grid = createGrid(sceneUsesDarkMode);
    grid.visible = !mapBackground;
    scene.add(grid);
    if (rayTracedLighting) {
      grid.visible = false;
      keyframeRoot.visible = false;
      markerMeshes.forEach((marker) => {
        marker.visible = false;
      });
    }

    const applySceneTheme = () => {
      const darkMode = usesDarkMode();
      const palette = sceneThemePalettes[darkMode ? "dark" : "light"];
      renderer.setClearColor(palette.background, mapBackground ? 0 : 1);
      sceneFog.color.setHex(palette.background);
      if (scene.background instanceof THREE.Color) {
        scene.background.setHex(palette.background);
        pathTracer?.updateEnvironment();
        restartPathTracingForTheme();
      }
      if (darkMode === sceneUsesDarkMode) return;

      sceneUsesDarkMode = darkMode;
      scene.remove(grid);
      disposeGrid(grid);
      grid = createGrid(darkMode);
      grid.visible = !mapBackground && !rayTracedLighting;
      scene.add(grid);
    };
    const themeObserver = new MutationObserver(applySceneTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    darkModePreference.addEventListener("change", applySceneTheme);

    webRoot.updateMatrixWorld(true);
    const playerRadius = 0.2;
    const standingEyeHeight = 1.62;
    const crouchingEyeHeight = 1.02;
    const jumpVelocity = 3.25;
    const gravity = 9.81;
    const collisionBoxes = wallColliderMeshes.map((mesh) =>
      new THREE.Box3().setFromObject(mesh).expandByScalar(playerRadius),
    );
    const walkFloorY = primaryBox.min.y;
    const pressedKeys = new Set<string>();
    const virtualKeys = new Set<string>();
    let walkYaw = 0;
    let walkPitch = 0;
    let currentEyeHeight = standingEyeHeight;
    let verticalOffset = 0;
    let verticalVelocity = 0;
    let jumpRequested = false;

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
      currentEyeHeight = standingEyeHeight;
      verticalOffset = 0;
      verticalVelocity = 0;
      jumpRequested = false;
      camera.position.set(
        walkStart.x,
        walkFloorY + standingEyeHeight,
        walkStart.z,
      );
      walkYaw = 0;
      walkPitch = 0;
      applyWalkRotation();
      camera.near = 0.02;
      camera.far = Math.max(100, radius * 30);
      camera.updateProjectionMatrix();
    };

    const applyMapCamera = () => {
      if (!mapBackground || !mapViewport) return false;
      const mapCenter = new THREE.Vector3(...mapViewport.center)
        .applyMatrix4(webFromWorld);
      mapCenter.y = box.min.y;
      const heading = THREE.MathUtils.degToRad(mapViewport.headingDegrees);
      const north = new THREE.Vector3(
        -Math.sin(heading),
        0,
        -Math.cos(heading),
      ).transformDirection(webFromWorld);
      north.y = 0;
      if (north.lengthSq() < 1e-8) north.set(0, 0, -1);
      else north.normalize();
      const viewportHeight = Math.max(1, host.clientHeight);
      const distance = Math.max(
        size.y + 0.5,
        (mapViewport.metersPerPixel * viewportHeight) /
          (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))),
      );
      controls.target.copy(mapCenter);
      camera.up.copy(north);
      camera.position.set(mapCenter.x, mapCenter.y + distance, mapCenter.z);
      camera.near = Math.max(0.01, distance / 2_000);
      camera.far = Math.max(100, distance + radius * 30);
      camera.lookAt(mapCenter);
      camera.updateProjectionMatrix();
      controls.enabled = false;
      controls.update();
      return true;
    };

    const resetCamera = () => {
      if (applyMapCamera()) return;
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
      if (mapBackground) {
        applyMapCamera();
      } else if (command === "top" && navigationMode === "orbit") {
        controls.target.copy(center);
        camera.up.set(0, 0, -1);
        camera.position.set(center.x, center.y + radius * 2.2, center.z + 0.001);
        camera.lookAt(center);
        controls.update();
      } else {
        resetCamera();
      }
    };
    const previousCamera = cameraSnapshotRef.current;
    if (
      previousCamera?.scanId === manifest.scan.id &&
      previousCamera.navigationMode === navigationMode &&
      previousCamera.mapBackground === mapBackground
    ) {
      camera.position.fromArray(previousCamera.position);
      camera.quaternion.fromArray(previousCamera.quaternion);
      camera.up.fromArray(previousCamera.up);
      camera.near = Math.max(0.02, radius / 500);
      camera.far = Math.max(100, radius * 30);
      camera.updateProjectionMatrix();
      if (navigationMode === "walk") {
        controls.enabled = false;
        const rotation = new THREE.Euler().setFromQuaternion(
          camera.quaternion,
          "YXZ",
        );
        walkYaw = rotation.y;
        walkPitch = rotation.x;
      } else {
        controls.enabled = true;
        controls.target.fromArray(previousCamera.target);
        controls.update();
      }
    } else {
      resetCamera();
    }
    if (lightingMode === "rendering") controls.enabled = false;

    // Keep screen-space occlusion confined to short-range grounding. The broad
    // shadow and colour separation comes from the single Live sun and the
    // compact bounce probe above.
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(
      renderer.getPixelRatio(),
      lightingMode === "live" ? 1.5 : 2,
    ));
    composer.addPass(new RenderPass(scene, camera));
    const ambientOcclusionPass = new GTAOPass(scene, camera, 1, 1);
    ambientOcclusionPass.enabled =
      lightingMode === "live" || progressiveLighting;
    ambientOcclusionPass.output = GTAOPass.OUTPUT.Default;
    ambientOcclusionPass.blendIntensity = lightingMode === "live"
      ? 0.72
      : progressiveLighting
        ? 0.58
        : 0.5;
    ambientOcclusionPass.setSceneClipBox(
      box.clone().expandByScalar(THREE.MathUtils.clamp(radius * 0.05, 0.2, 0.8)),
    );
    ambientOcclusionPass.updateGtaoMaterial({
      radius: THREE.MathUtils.clamp(radius * 0.045, 0.18, 0.5),
      distanceExponent: 1.5,
      thickness: 0.82,
      distanceFallOff: 1,
      scale: 1,
      samples: lightingMode === "live" ? 24 : 32,
      screenSpaceRadius: false,
    });
    ambientOcclusionPass.updatePdMaterial({
      lumaPhi: 5,
      depthPhi: 2,
      normalPhi: 3,
      radius: 4,
      radiusExponent: 2,
      rings: 2,
      samples: lightingMode === "live" ? 12 : 16,
    });
    composer.addPass(ambientOcclusionPass);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // The cutaway drops whichever parts of the shell stand between the camera
    // and the room. It runs only in Realistic orbit views: from inside a walk
    // the outward test already keeps every wall, and Live is unchanged.
    const cutawayEnabled =
      lightingMode === "realistic" && navigationMode === "orbit" && !mapBackground;
    const cutawayNormal = new THREE.Vector3();
    const cutawaySurfaceCenter = new THREE.Vector3();
    const cutawayToCamera = new THREE.Vector3();
    const cutawayNodes: Array<{ node: THREE.Object3D; outward: number[] }> = [];
    if (cutawayEnabled) {
      for (const root of roomArchitectureRoots.values()) {
        root.traverse((object) => {
          const outward = object.userData.roomWallOutward as number[] | undefined;
          if (outward) cutawayNodes.push({ node: object, outward });
        });
      }
    }
    // Hiding a wall also removes it from the bake: the receiver collector and
    // the tracer's BVH builder both walk only visible objects, so a cutaway
    // applied first leaves the room open on two sides, lets the fill escape and
    // drops the bounce those walls owe the rest of the room. Wait for the bake
    // to capture the scene, then cut away.
    let sceneCapturedForBake = lightingMode !== "realistic";
    const updateCutaway = () => {
      if (!cutawayEnabled || !sceneCapturedForBake) return;
      for (const { node, outward } of cutawayNodes) {
        cutawayNormal
          .fromArray(outward)
          .transformDirection(node.matrixWorld)
          .normalize();
        node.getWorldPosition(cutawaySurfaceCenter);
        cutawayToCamera
          .copy(camera.position)
          .sub(cutawaySurfaceCenter)
          .normalize();
        // Standing on a surface's outward side means looking at its back. Keep
        // a small tolerance so a wall seen edge-on does not flicker away.
        node.visible = cutawayNormal.dot(cutawayToCamera) < 0.16;
      }
    };

    let pathTracingReady = false;
    let pathTracingFailed = false;
    let pathTracingFinished = false;
    let pathTracingStartedAt: number | null = null;
    let pathTracingLastStatusAt = 0;
    let lightMapActiveElapsed = 0;
    let lightMapLastFrameAt: number | null = null;
    let roomReflectionTarget: THREE.WebGLRenderTarget | null = null;
    // Realistic has no planar mirror on the floor — Live gets one from a
    // Reflector — so its sealed linoleum has to read as reflective from the
    // probe alone. Tightening both lobes only here keeps Live's floor, which
    // already composites a real reflection, from doubling up.
    const floorGloss = lightingMode === "realistic"
      ? { clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 1.15, roughness: 0.34 }
      : { clearcoat: 0.38, clearcoatRoughness: 0.22, envMapIntensity: 1, roughness: 0.5 };
    const enableStableFloorSheen = (environmentMap: THREE.Texture) => {
      for (const mesh of reflectiveFloorMeshes) {
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          // An explicit room probe makes the reflection visible together with
          // the baked diffuse atlas without applying an environment to walls.
          material.envMap = environmentMap;
          material.roughness = Math.min(material.roughness, floorGloss.roughness);
          // A broken-up normal scatters the reflection into noise, which is
          // what stops a floor reading as a reflective surface at all.
          material.normalScale.setScalar(Math.min(material.normalScale.x, 0.06));
          material.envMapIntensity = floorGloss.envMapIntensity;
          if (material instanceof THREE.MeshPhysicalMaterial) {
            material.clearcoat = floorGloss.clearcoat;
            material.clearcoatRoughness = floorGloss.clearcoatRoughness;
          }
          material.needsUpdate = true;
        }
      }
    };
    const captureLocalReflectionProbe = () => {
      // 128 px per face could not resolve the window or a wall corner, so the
      // floor mirrored an indistinct smear. This is captured once, so the extra
      // resolution costs nothing at steady state.
      const cubeTarget = new THREE.WebGLCubeRenderTarget(256, {
        colorSpace: THREE.LinearSRGBColorSpace,
        generateMipmaps: true,
        magFilter: THREE.LinearFilter,
        minFilter: THREE.LinearMipmapLinearFilter,
        type: THREE.HalfFloatType,
      });
      const cubeCamera = new THREE.CubeCamera(
        Math.max(0.03, radius / 500),
        Math.max(20, radius * 8),
        cubeTarget,
      );
      const probeCenter = primaryBox.getCenter(new THREE.Vector3());
      const probeSize = primaryBox.getSize(new THREE.Vector3());
      cubeCamera.position.set(
        probeCenter.x,
        primaryBox.min.y + THREE.MathUtils.clamp(
          probeSize.y * 0.48,
          0.9,
          1.55,
        ),
        probeCenter.z,
      );
      scene.add(cubeCamera);

      const hiddenDuringCapture = [
        keyframeRoot,
        photoPose,
        ...floorReflectors,
        ...markerMeshes.filter((object) => object instanceof THREE.Group),
        ...(transformHelper ? [transformHelper] : []),
      ];
      const hiddenVisibility = hiddenDuringCapture.map((object) => object.visible);
      const previousTarget = renderer.getRenderTarget();
      const previousToneMapping = renderer.toneMapping;
      const previousBackground = scene.background;
      const previousEnvironment = scene.environment;
      const previousEnvironmentIntensity = scene.environmentIntensity;
      const previousXr = renderer.xr.enabled;
      try {
        hiddenDuringCapture.forEach((object) => {
          object.visible = false;
        });
        scene.background = new THREE.Color(0xdce8f2);
        scene.environment = null;
        scene.environmentIntensity = 0;
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.xr.enabled = false;
        cubeCamera.update(renderer, scene);

        const generator = new THREE.PMREMGenerator(renderer);
        try {
          const generated = generator.fromCubemap(cubeTarget.texture);
          roomReflectionTarget?.dispose();
          roomReflectionTarget = generated;
          return generated.texture;
        } finally {
          generator.dispose();
        }
      } catch {
        return environmentTarget.texture;
      } finally {
        hiddenDuringCapture.forEach((object, index) => {
          object.visible = hiddenVisibility[index] ?? false;
        });
        renderer.setRenderTarget(previousTarget);
        renderer.toneMapping = previousToneMapping;
        renderer.xr.enabled = previousXr;
        scene.background = previousBackground;
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousEnvironmentIntensity;
        scene.remove(cubeCamera);
        cubeTarget.dispose();
      }
    };
    const applyFinishedLighting = () => {
      // The atlas owns every diffuse bounce in the room, so the environment is
      // kept purely for reflections: lightmapped materials scale its irradiance
      // term to zero and keep only its specular one. Restoring a flat ambient
      // here instead is what used to give the finished bake its washed-out,
      // evenly lit look.
      scene.environment = environmentTarget.texture;
      scene.environmentIntensity = 0.34;
      skyLight.intensity = 0;
      // A small ambient keeps the surfaces the atlas cannot receive — glass,
      // polished metal, splats — from reading as black cut-outs.
      ambientFillLight.intensity = roomAmbientBounceFraction;
      enableStableFloorSheen(captureLocalReflectionProbe());
    };
    if (lightingMode === "live") {
      // Capture the furnished room once. This adds stable, softly blurred
      // object reflections without the edge popping of screen-space mirrors.
      enableStableFloorSheen(captureLocalReflectionProbe());
    }
    const onBakeVisibilityChange = () => {
      // Break the active-time interval whenever the page is hidden or shown so
      // background throttling can never consume the five-minute bake budget.
      lightMapLastFrameAt = null;
    };
    document.addEventListener("visibilitychange", onBakeVisibilityChange);
    // Convergence normally decides when a bake stops; the sample and duration
    // figures below are ceilings for a bake that refuses to settle. The
    // tolerance is the mean relative change the atlas may still show between
    // two checks eight samples apart, which is well above the Monte Carlo
    // noise floor at these counts and below what survives the denoiser.
    const realisticBakePreset = slowHighQualityBake
      ? {
          bounces: 8,
          convergenceTolerance: 0.003,
          denoisePasses: 3,
          duration: 300_000,
          minimumSamples: 80,
          resolution: 1_536,
          samples: 512,
          transmissiveBounces: 4,
        }
      : {
          bounces: 5,
          convergenceTolerance: 0.006,
          denoisePasses: 4,
          duration: 60_000,
          minimumSamples: 32,
          // Furniture shares the atlas with the shell, so the default bake
          // needs the extra texels to keep contact shadows several wide.
          resolution: 1_024,
          // The wider a-trous filter cleans a far noisier atlas than the old
          // two-pass one did, so the ceiling can come down and the bake can
          // hand back control sooner.
          samples: 120,
          // Window glass is a slab: its two faces alone consume two traversals,
          // so a smaller budget stops the sun at the pane it should pass.
          transmissiveBounces: 4,
        };
    const pathTracingDuration =
      lightingMode === "rendering" ? 10_000 : realisticBakePreset.duration;
    const pathTracingSampleTarget =
      lightingMode === "rendering" ? 2_048 : realisticBakePreset.samples;
    const lightMapSampleFloor = realisticBakePreset.minimumSamples;
    const restartPathTracing = () => {
      if (!pathTracer || !pathTracingReady) return;
      pathTracer.updateCamera();
      pathTracingStartedAt = null;
      lightMapActiveElapsed = 0;
      lightMapLastFrameAt = null;
      pathTracingFinished = false;
      setLightingProgress(14);
      setLightingStatus("generating");
    };
    restartPathTracingForTheme = restartPathTracing;
    // Realistic mode renders from camera-independent lightmaps. Only the
    // one-off Rendering mode owns a view-space accumulation buffer.
    const onControlsChange = () => undefined;
    controls.addEventListener("change", onControlsChange);

    const initializePathTracer = async () => {
      if (!rayTracedLighting) return;
      setLightingProgress(2);
      try {
        if (disposed) return;
        if (lightingMode === "realistic") {
          const {
            createRoomLightMapBake,
            createRoomLightMapCacheKey,
          } = await import("@/lib/room-lightmap-baker");
          if (disposed) return;
          const cacheKey = createRoomLightMapCacheKey({
            // The rig is part of the result, so a different key direction has
            // to miss the cache.
            keyAzimuth: Math.round(bakeKeyAzimuth * 10) / 10,
            version:
              40 +
              (bakeRoomOnly ? 1 : 0) +
              (slowHighQualityBake ? 2 : 0),
            rooms: visibleManifests.map((roomManifest) => ({
              analysis: roomManifest.scan.aiAnalysis,
              id: roomManifest.scan.id,
              layoutTransform: layoutTransformForManifest(roomManifest),
              scene: roomManifest.scan.scene,
            })),
          });
          const bakeHiddenObjects: THREE.Object3D[] = [];
          for (const root of roomPlanRoots.values()) {
            root.traverse((object) => {
              if (object.userData.roomBakeHidden === true) {
                bakeHiddenObjects.push(object);
              }
            });
          }
          const bake = await createRoomLightMapBake({
            bakeHiddenObjects,
            bakeOnlyObjects,
            bounces: realisticBakePreset.bounces,
            cacheKey,
            convergenceTolerance: realisticBakePreset.convergenceTolerance,
            denoisePasses: realisticBakePreset.denoisePasses,
            onProgress: (progress) => {
              if (!disposed) setLightingProgress(progress);
            },
            renderer,
            resolution: Math.min(
              realisticBakePreset.resolution,
              renderer.capabilities.maxTextureSize,
            ),
            roots: bakeRoomOnly
              ? roomArchitectureRoots.values()
              : roomPlanRoots.values(),
            scene,
            transmissiveBounces: realisticBakePreset.transmissiveBounces,
          });
          if (disposed) {
            bake.dispose();
            return;
          }
          lightMapBake = bake;
          // The tracer has its own BVH now, so the cutaway is free to hide
          // walls without changing what was baked.
          sceneCapturedForBake = true;
          renderer.shadowMap.enabled = false;
          pathTracingReady = true;
          pathTracingStartedAt = performance.now();
          setLightingProgress(bake.cached ? 100 : 20);
          if (bake.cached) {
            pathTracingFinished = true;
            daylightAreaLights.forEach((light) => {
              light.intensity = 0;
            });
            // Add neutral ambient fill and the local floor reflection probe.
            applyFinishedLighting();
            setLightingStatus("ready");
          }
          return;
        }

        const { WebGLPathTracer } = await import("three-gpu-pathtracer");
        if (disposed) return;

        const tracer = new WebGLPathTracer(renderer);
        pathTracer = tracer;
        tracer.bounces = lightingMode === "rendering" ? 10 : 8;
        tracer.transmissiveBounces = 4;
        tracer.filterGlossyFactor = 0.85;
        tracer.multipleImportanceSampling = true;
        tracer.tiles.set(2, 2);
        tracer.renderScale = lightingMode === "rendering" ? 0.65 : 0.5;
        tracer.renderDelay = 0;
        tracer.minSamples = 1;
        tracer.fadeDuration = 180;
        tracer.dynamicLowRes = true;
        tracer.lowResScale = 0.2;
        tracer.rasterizeScene = false;
        tracer.textureSize.set(1024, 1024);
        pathTraceDenoiseQuad = new FullScreenQuad(
          createPathTraceDenoiseMaterial(),
        );

        scene.fog = null;
        // Rendering uses the same overhead softbox as the bake. Its deeper
        // traced bounces provide the ambient component without a photographic
        // environment or its visible studio lamps.
        scene.environment = null;
        scene.environmentIntensity = 0;
        tracer.setScene(scene, camera, {
          onProgress: (progress) => {
            if (!disposed) {
              setLightingProgress(Math.max(2, Math.round(progress * 12)));
            }
          },
        });
        if (disposed) {
          tracer.dispose();
          return;
        }

        renderer.shadowMap.enabled = false;
        pathTracingReady = true;
        pathTracingStartedAt = performance.now();
        setLightingProgress(14);
      } catch (error) {
        pathTracingFailed = true;
        // Nothing is baking any more, so the cutaway must not stay disabled.
        sceneCapturedForBake = true;
        setLightingProgress(100);
        setLightingStatus("ready");
        console.warn("Ray-traced room rendering is unavailable; using the raster fallback.", error);
      }
    };

    const inputKey = (event: KeyboardEvent) =>
      event.code === "Space" ? "space" : event.key.toLowerCase();
    const walkKey = (key: string) =>
      [
        "w",
        "a",
        "s",
        "d",
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "space",
        "shift",
        "control",
        "c",
      ].includes(key);
    const interactiveTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(target.closest("button, input, select, textarea, [contenteditable='true']"));
    const onKeyDown = (event: KeyboardEvent) => {
      const key = inputKey(event);
      if (navigationMode !== "walk" || !walkKey(key)) return;
      if (
        interactiveTarget(event.target) &&
        document.pointerLockElement !== renderer.domElement
      ) return;
      event.preventDefault();
      if (key === "space" && !event.repeat) jumpRequested = true;
      pressedKeys.add(key);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(inputKey(event));
    };
    const virtualKey = {
      forward: "w",
      backward: "s",
      left: "a",
      right: "d",
      crouch: "c",
    } as const;
    walkCommandRef.current = (action, active) => {
      if (action === "jump") {
        if (active) jumpRequested = true;
        return;
      }
      if (active) virtualKeys.add(virtualKey[action]);
      else virtualKeys.delete(virtualKey[action]);
    };
    const onWindowBlur = () => {
      pressedKeys.clear();
      virtualKeys.clear();
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
    window.addEventListener("blur", onWindowBlur);
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
      if (isLayoutEditing) {
        const roomHit = raycaster.intersectObjects(
          [...roomPlanRoots.values()],
          true,
        )[0];
        let roomCandidate: THREE.Object3D | null = roomHit?.object ?? null;
        while (roomCandidate && !roomCandidate.userData.roomScanId) {
          roomCandidate = roomCandidate.parent;
        }
        if (typeof roomCandidate?.userData.roomScanId === "string") {
          const scanId = roomCandidate.userData.roomScanId;
          selectedLayoutScanRef.current = scanId;
          layoutSelectionCommandRef.current(scanId);
          onSelectLayoutRoomRef.current?.(scanId);
        }
        return;
      }
      const estimatedHit = raycaster
        .intersectObjects(estimatedSuggestionMeshes, true)
        .find((intersection) => {
          let candidate: THREE.Object3D | null = intersection.object;
          while (candidate && !candidate.userData.aiSuggestionId) {
            candidate = candidate.parent;
          }
          return Boolean(candidate?.userData.aiSuggestionId);
        });
      if (estimatedHit) {
        let candidate: THREE.Object3D | null = estimatedHit.object;
        while (candidate && !candidate.userData.aiSuggestionId) {
          candidate = candidate.parent;
        }
        if (typeof candidate?.userData.aiSuggestionId === "string") {
          onSelectObjectSuggestionRef.current?.(
            candidate.userData.aiSuggestionId,
          );
          return;
        }
      }
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
      composer.setSize(width, height);
      splatMaterials.forEach((material) => {
        material.uniforms.viewportHeight!.value = height * renderer.getPixelRatio();
      });
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      applyMapCamera();
      if (pathTracer && pathTracingReady) restartPathTracing();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    void initializePathTracer();

    let animationFrame = 0;
    let shadowMapSettled = false;
    const timer = new THREE.Timer();
    timer.connect(document);
    const draw = (timestamp?: number) => {
      const frameTimestamp = timestamp ?? performance.now();
      timer.update(frameTimestamp);
      const delta = Math.min(timer.getDelta(), 0.05);
      if (navigationMode === "walk") {
        const active = (key: string) => pressedKeys.has(key) || virtualKeys.has(key);
        const crouching = active("shift") || active("control") || active("c");
        currentEyeHeight = THREE.MathUtils.damp(
          currentEyeHeight,
          crouching ? crouchingEyeHeight : standingEyeHeight,
          14,
          delta,
        );
        if (jumpRequested) {
          if (verticalOffset <= 0.001) verticalVelocity = jumpVelocity;
          jumpRequested = false;
        }
        if (verticalOffset > 0 || verticalVelocity > 0) {
          verticalVelocity -= gravity * delta;
          verticalOffset += verticalVelocity * delta;
          if (verticalOffset <= 0) {
            verticalOffset = 0;
            verticalVelocity = 0;
          }
        }
        const cameraHeight = walkFloorY + currentEyeHeight + verticalOffset;
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
            !walkThroughWallsRef.current &&
            collisionBoxes.some((bounds) => bounds.containsPoint(position));
          const candidate = camera.position.clone().add(movement);
          candidate.y = cameraHeight;
          if (!blocked(candidate)) {
            camera.position.copy(candidate);
          } else {
            const xOnly = camera.position.clone();
            xOnly.x += movement.x;
            xOnly.y = cameraHeight;
            if (!blocked(xOnly)) camera.position.x = xOnly.x;
            const zOnly = camera.position.clone();
            zOnly.z += movement.z;
            zOnly.y = cameraHeight;
            if (!blocked(zOnly)) camera.position.z = zOnly.z;
          }
        }
        camera.position.y = cameraHeight;
      } else if (lightingMode !== "rendering") {
        controls.update();
      }
      updateCutaway();

      if (
        lightingMode === "realistic" &&
        pathTracingReady &&
        lightMapBake
      ) {
        if (!pathTracingFinished) {
          const frameGap = lightMapLastFrameAt === null
            ? 0
            : frameTimestamp - lightMapLastFrameAt;
          lightMapLastFrameAt = frameTimestamp;
          // Wall time is only a safety net now, and it has to keep counting
          // when the page reports itself hidden: embedded and backgrounded
          // views still render, and gating on visibility there left the bake
          // running forever. Convergence, not the clock, normally ends it.
          if (frameGap >= 0) {
            lightMapActiveElapsed += Math.min(frameGap, 1_000);
          }
          lightMapBake.renderSample();
          const elapsed = lightMapActiveElapsed;
          const tracingProgress = Math.min(
            100,
            20 + Math.max(
              elapsed / pathTracingDuration,
              lightMapBake.samples / pathTracingSampleTarget,
            ) * 80,
          );
          const finished =
            // Stop as soon as more samples stop changing the atlas. The sample
            // and wall-clock ceilings below only bound a pathological bake.
            lightMapBake.converged ||
            lightMapBake.samples >= pathTracingSampleTarget ||
            (
              elapsed >= pathTracingDuration &&
              lightMapBake.samples >= lightMapSampleFloor
            );
          if (finished || frameTimestamp - pathTracingLastStatusAt >= 200) {
            pathTracingLastStatusAt = frameTimestamp;
            setLightingProgress(
              finished ? 100 : Math.min(99, Math.round(tracingProgress)),
            );
          }
          if (finished) {
            lightMapBake.finish();
            pathTracingFinished = true;
            daylightAreaLights.forEach((light) => {
              light.intensity = 0;
            });
            // Lightmaps contain direct and bounced diffuse irradiance. The
            // finished-lighting helper preserves that result while restoring
            // restrained exterior fill and view-dependent reflections.
            applyFinishedLighting();
            setLightingStatus("ready");
          }
        }
        composer.render(delta);
      } else if (progressiveLighting && progressiveLightMap) {
        if (progressiveLightMapSamples < progressiveLightMapSampleTarget) {
          jitterProgressiveLights();
          progressiveLightMap.update(
            camera,
            progressiveLightMapSamples + 1,
            true,
          );
          progressiveLightMapSamples += 1;
          const finished =
            progressiveLightMapSamples >= progressiveLightMapSampleTarget;
          if (finished || progressiveLightMapSamples % 3 === 0) {
            const progress = Math.min(
              100,
              Math.round(
                (progressiveLightMapSamples / progressiveLightMapSampleTarget) *
                  100,
              ),
            );
            setLightingProgress(progress);
            if (finished) {
              enableStableFloorSheen(captureLocalReflectionProbe());
              setLightingStatus("ready");
            }
          }
        }
        composer.render(delta);
      } else if (rayTracedLighting && pathTracingReady && pathTracer) {
        if (!pathTracingFinished) {
          pathTracingStartedAt ??= frameTimestamp;
          pathTracer.renderSample();
          const elapsed = frameTimestamp - pathTracingStartedAt;
          const tracingProgress = Math.min(
            100,
            14 + Math.max(
              elapsed / pathTracingDuration,
              pathTracer.samples / pathTracingSampleTarget,
            ) * 86,
          );
          const finished =
            elapsed >= pathTracingDuration ||
            pathTracer.samples >= pathTracingSampleTarget;
          if (finished || frameTimestamp - pathTracingLastStatusAt >= 200) {
            pathTracingLastStatusAt = frameTimestamp;
            setLightingProgress(finished ? 100 : Math.round(tracingProgress));
          }
          if (finished) {
            pathTracingFinished = true;
            if (pathTraceDenoiseQuad) {
              const denoiseMaterial = pathTraceDenoiseQuad.material as
                THREE.ShaderMaterial;
              denoiseMaterial.uniforms.map!.value = pathTracer.target.texture;
              renderer.setRenderTarget(null);
              pathTraceDenoiseQuad.render(renderer);
            }
            setLightingStatus("ready");
            if (lightingMode === "rendering") return;
          }
        }
      } else {
        composer.render(delta);
      }

      if (lightingMode === "live" && !shadowMapSettled) {
        // The room and original Live sun are static. Cache the one VSM shadow
        // map after its first render; selections request a refresh.
        renderer.shadowMap.autoUpdate = false;
        shadowMapSettled = true;
      } else if (pathTracingFailed && lightingMode === "rendering") {
        return;
      }
      animationFrame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cameraSnapshotRef.current = {
        scanId: manifest.scan.id,
        navigationMode,
        mapBackground,
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        up: camera.up.toArray(),
        target: controls.target.toArray(),
      };
      disposed = true;
      assetAbortController.abort();
      photoRequestController?.abort();
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      themeObserver.disconnect();
      darkModePreference.removeEventListener("change", applySceneTheme);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onBakeVisibilityChange);
      document.removeEventListener("mousemove", onMouseMove);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      if (transformControls && transformHelper) {
        transformControls.detach();
        scene.remove(transformHelper);
        transformControls.dispose();
      }
      if (estimatedTransformControls && estimatedTransformHelper) {
        estimatedTransformControls.detach();
        scene.remove(estimatedTransformHelper);
        estimatedTransformControls.dispose();
      }
      controls.removeEventListener("change", onControlsChange);
      controls.dispose();
      lightMapBake?.dispose();
      lightMapBake = null;
      progressiveLightMap?.dispose();
      progressiveLightMap = null;
      progressiveLights.forEach((light) => light.shadow.dispose());
      floorReflectors.forEach((reflector) => reflector.dispose());
      pathTracer?.dispose();
      pathTracer = null;
      if (pathTraceDenoiseQuad) {
        pathTraceDenoiseQuad.material.dispose();
        pathTraceDenoiseQuad.dispose();
        pathTraceDenoiseQuad = null;
      }
      const materials = new Set<THREE.Material>([
        wallMaterial,
        floorMaterial,
        doorMaterial,
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
      if (bounceProbe) scene.remove(bounceProbe);
      roomReflectionTarget?.dispose();
      environmentTarget.dispose();
      timer.dispose();
      ambientOcclusionPass.dispose();
      ambientOcclusionPass.gtaoMaterial.dispose();
      ambientOcclusionPass.blendMaterial.dispose();
      outputPass.dispose();
      composer.dispose();
      liveSun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      commandRef.current = () => undefined;
      selectionCommandRef.current = () => undefined;
      suggestionPreviewCommandRef.current = () => undefined;
      suggestionEditSelectionCommandRef.current = () => undefined;
      suggestionEditToolCommandRef.current = () => undefined;
      keyframeCommandRef.current = () => undefined;
      walkCommandRef.current = () => undefined;
      layoutSelectionCommandRef.current = () => undefined;
      layoutToolCommandRef.current = () => undefined;
      layoutTransformsCommandRef.current = () => undefined;
    };
  }, [
    bakeRoomOnly,
    integer,
    isLayoutEditing,
    lightingMode,
    manifest,
    mapBackground,
    mapViewport,
    navigationMode,
    progressiveQualityPreset,
    sceneMode,
    slowHighQualityBake,
    t,
    visibleKeyframes,
    visibleManifests,
  ]);

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative size-full overflow-hidden",
        mapBackground ? "bg-transparent" : "bg-surface-muted",
      )}
    >
      {rendererError ? (
        <div className="absolute inset-0 z-10 grid place-items-center p-8 text-center text-sm text-muted">
          {rendererError}
        </div>
      ) : null}
      <div
        className={cn(
          "pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-2",
          navigationMode === "walk"
            ? "max-w-[calc(100%_-_11rem)]"
            : "max-w-[calc(100%_-_7rem)]",
        )}
      >
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
          {!isLayoutEditing && availableModes.textured_mesh ? (
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
          {!isLayoutEditing && availableModes.gaussian_splat ? (
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
              <ScanSearch className="size-3.5" aria-hidden="true" />
              {t("canvas.modes.splat")}
            </button>
          ) : null}
        </div>

        {!isLayoutEditing && !mapBackground ? (
          <div
            className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-surface/92 p-1 shadow-sm backdrop-blur"
            role="group"
            aria-label={t("canvas.lighting.label")}
          >
          <button
            type="button"
            onClick={() => selectLightingMode("live")}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
              lightingMode === "live"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            title={t("canvas.lighting.liveDescription")}
            aria-pressed={lightingMode === "live"}
          >
            <Sun className="size-3.5" aria-hidden="true" />
            {t("canvas.lighting.live")}
          </button>
          <button
            type="button"
            onClick={() => selectLightingMode("progressive")}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
              lightingMode === "progressive"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            title={t("canvas.lighting.progressiveDescription")}
            aria-pressed={lightingMode === "progressive"}
          >
            <Layers3 className="size-3.5" aria-hidden="true" />
            {t("canvas.lighting.progressive")}
          </button>
          <button
            type="button"
            onClick={() => selectLightingMode("realistic")}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
              lightingMode === "realistic"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            title={t("canvas.lighting.realisticDescription")}
            aria-pressed={lightingMode === "realistic"}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            {t("canvas.lighting.realistic")}
          </button>
          <button
            type="button"
            onClick={() => selectLightingMode("rendering")}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[10px] font-semibold transition",
              lightingMode === "rendering"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            title={t("canvas.lighting.renderingDescription")}
            aria-pressed={lightingMode === "rendering"}
          >
            <Aperture className="size-3.5" aria-hidden="true" />
            {t("canvas.lighting.rendering")}
          </button>
          </div>
        ) : null}

        {!isLayoutEditing &&
        !mapBackground &&
        lightingMode === "progressive" ? (
          <label
            className="pointer-events-auto grid w-64 gap-1.5 rounded-lg border border-border bg-surface/92 px-3 py-2 text-[10px] font-semibold text-muted shadow-sm backdrop-blur"
            title={t("canvas.lighting.progressiveQualityDescription")}
          >
            <span className="flex items-center justify-between gap-3">
              <span>{t("canvas.lighting.progressiveQuality")}</span>
              <span className="text-foreground">
                {t(
                  `canvas.lighting.progressiveQualityLevels.${progressiveQualityPreset.id}`,
                )}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={progressiveQualityPresets.length - 1}
              step={1}
              value={progressiveQuality}
              onChange={(event) => {
                const quality = THREE.MathUtils.clamp(
                  Number(event.target.value),
                  0,
                  progressiveQualityPresets.length - 1,
                );
                setProgressiveQuality(quality);
                setLightingProgress(0);
                setLightingStatus("generating");
              }}
              aria-label={t("canvas.lighting.progressiveQuality")}
              aria-valuetext={t(
                `canvas.lighting.progressiveQualityLevels.${progressiveQualityPreset.id}`,
              )}
              className="h-4 w-full cursor-pointer accent-brand-solid"
            />
          </label>
        ) : null}

        {!isLayoutEditing && !mapBackground && lightingMode === "realistic" ? (
          <div className="pointer-events-auto flex w-fit flex-wrap items-center gap-2">
            <label
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface/92 px-2.5 py-2 text-[10px] font-semibold text-muted shadow-sm backdrop-blur"
              title={t("canvas.lighting.roomOnlyDescription")}
            >
              <input
                type="checkbox"
                checked={bakeRoomOnly}
                onChange={(event) => {
                  setBakeRoomOnly(event.target.checked);
                  setLightingProgress(0);
                  setLightingStatus("generating");
                }}
                className="size-3.5 accent-brand-solid"
              />
              {t("canvas.lighting.roomOnly")}
            </label>
            <label
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface/92 px-2.5 py-2 text-[10px] font-semibold text-muted shadow-sm backdrop-blur"
              title={t("canvas.lighting.slowDescription")}
            >
              <input
                type="checkbox"
                checked={slowHighQualityBake}
                onChange={(event) => {
                  setSlowHighQualityBake(event.target.checked);
                  setLightingProgress(0);
                  setLightingStatus("generating");
                }}
                className="size-3.5 accent-brand-solid"
              />
              {t("canvas.lighting.slow")}
            </label>
          </div>
        ) : null}

        {!isLayoutEditing && !mapBackground && lightingMode !== "live" ? (
          <div
            className="pointer-events-none min-w-48 rounded-lg border border-border bg-surface/92 px-2.5 py-2 text-[10px] font-medium text-muted shadow-sm backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-1.5">
              {lightingStatus === "generating" ? (
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-3 text-brand" aria-hidden="true" />
              )}
              <span>
                {lightingMode === "progressive"
                  ? lightingStatus === "generating"
                    ? t("canvas.lighting.progressiveBaking", {
                        progress: lightingProgress,
                      })
                    : t("canvas.lighting.progressiveReady")
                  : lightingMode === "realistic"
                  ? lightingStatus === "generating"
                    ? t("canvas.lighting.baking", {
                        progress: lightingProgress,
                      })
                    : t("canvas.lighting.baked")
                  : lightingStatus === "generating"
                    ? t("canvas.lighting.renderingProgress", {
                        progress: lightingProgress,
                      })
                    : t("canvas.lighting.rendered")}
              </span>
            </div>
            {lightingStatus === "generating" ? (
              <div
                className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={lightingProgress}
              >
                <div
                  className="h-full rounded-full bg-brand-solid transition-[width]"
                  style={{ width: `${lightingProgress}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

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

        {!isLayoutEditing && visibleKeyframes.length ? (
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
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          {!isLayoutEditing && !mapBackground ? (
            <button
              type="button"
              onClick={() => setNavigationMode((current) =>
                current === "walk" ? "orbit" : "walk")}
              disabled={lightingMode === "rendering"}
              className={cn(
                "pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[10px] font-semibold shadow-sm backdrop-blur transition disabled:cursor-not-allowed disabled:opacity-50",
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
          ) : null}
          {navigationMode === "orbit" ? (
            <button
              type="button"
              onClick={() => commandRef.current("top")}
              disabled={lightingMode === "rendering"}
              className="pointer-events-auto grid size-9 place-items-center rounded-xl border border-border bg-surface/90 text-muted shadow-sm backdrop-blur transition hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
              title={t("canvas.topView")}
              aria-label={t("canvas.topView")}
            >
              <ScanSearch className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => commandRef.current("reset")}
            disabled={lightingMode === "rendering"}
            className="pointer-events-auto grid size-9 place-items-center rounded-xl border border-border bg-surface/90 text-muted shadow-sm backdrop-blur transition hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
            title={t("canvas.resetView")}
            aria-label={t("canvas.resetView")}
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </button>
        </div>
        {!mapBackground && navigationMode === "walk" ? (
          <label className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-surface/90 px-3 text-[10px] font-semibold text-muted shadow-sm backdrop-blur">
            <input
              type="checkbox"
              checked={walkThroughWalls}
              onChange={(event) => setWalkThroughWalls(event.target.checked)}
              className="size-3.5 accent-brand-solid"
            />
            {t("canvas.walk.throughWalls")}
          </label>
        ) : null}
      </div>
      {editableObjectSuggestionId && !isLayoutEditing ? (
        <div
          className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-xl border border-border bg-surface/92 p-1 shadow-lg backdrop-blur"
          role="group"
          aria-label={t("rooms.ai.editEstimate")}
        >
          <button
            type="button"
            onClick={() => setSuggestionEditTool("translate")}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold transition",
              suggestionEditTool === "translate"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            aria-pressed={suggestionEditTool === "translate"}
          >
            <Move3d className="size-3.5" aria-hidden="true" />
            {t("rooms.layout.move")}
          </button>
          <button
            type="button"
            onClick={() => setSuggestionEditTool("rotate")}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold transition",
              suggestionEditTool === "rotate"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            aria-pressed={suggestionEditTool === "rotate"}
          >
            <Rotate3d className="size-3.5" aria-hidden="true" />
            {t("rooms.layout.rotate")}
          </button>
          <button
            type="button"
            onClick={() => onSelectObjectSuggestion?.(null)}
            className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
            aria-label={t("rooms.ai.finishMoving")}
            title={t("rooms.ai.finishMoving")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {isLayoutEditing ? (
        <div
          className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-xl border border-border bg-surface/92 p-1 shadow-lg backdrop-blur"
          role="group"
          aria-label={t("rooms.layout.gizmoLabel")}
        >
          <button
            type="button"
            onClick={() => setLayoutTool("translate")}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold transition",
              layoutTool === "translate"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            title={t("rooms.layout.moveTool")}
            aria-label={t("rooms.layout.moveTool")}
            aria-pressed={layoutTool === "translate"}
          >
            <Move3d className="size-3.5" aria-hidden="true" />
            {t("rooms.layout.move")}
          </button>
          <button
            type="button"
            onClick={() => setLayoutTool("rotate")}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-semibold transition",
              layoutTool === "rotate"
                ? "bg-brand-solid text-on-brand"
                : "text-muted hover:bg-surface-hover hover:text-foreground",
            )}
            title={t("rooms.layout.rotateTool")}
            aria-label={t("rooms.layout.rotateTool")}
            aria-pressed={layoutTool === "rotate"}
          >
            <Rotate3d className="size-3.5" aria-hidden="true" />
            {t("rooms.layout.rotate")}
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          "pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg bg-surface/78 px-2.5 py-1.5 text-[10px] font-medium text-muted shadow-sm backdrop-blur",
          navigationMode === "walk" && "max-w-[calc(100%_-_13rem)]",
        )}
      >
        {mapBackground
          ? t("canvas.mapBackgroundHint")
          : isLayoutEditing
          ? t("rooms.layout.gizmoHint")
          : editableObjectSuggestionId
          ? t("rooms.ai.estimateGizmoHint")
          : navigationMode === "walk"
          ? t("canvas.walk.hint")
          : t("canvas.controlsHint")}
      </div>
      {!mapBackground && navigationMode === "walk" ? (
        <div className="absolute bottom-3 right-3 z-10 flex items-end gap-2 sm:hidden">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onPointerDown={() => walkCommandRef.current("jump", true)}
              onPointerUp={() => walkCommandRef.current("jump", false)}
              onPointerCancel={() => walkCommandRef.current("jump", false)}
              className="grid size-11 touch-none place-items-center rounded-xl border border-border bg-surface/90 text-foreground shadow-lg backdrop-blur"
              aria-label={t("canvas.walk.jump")}
              title={t("canvas.walk.jump")}
            >
              <ArrowUpFromLine className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onPointerDown={() => walkCommandRef.current("crouch", true)}
              onPointerUp={() => walkCommandRef.current("crouch", false)}
              onPointerCancel={() => walkCommandRef.current("crouch", false)}
              onPointerLeave={() => walkCommandRef.current("crouch", false)}
              className="grid size-11 touch-none place-items-center rounded-xl border border-border bg-surface/90 text-foreground shadow-lg backdrop-blur"
              aria-label={t("canvas.walk.crouch")}
              title={t("canvas.walk.crouch")}
            >
              <ArrowDownToLine className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
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
