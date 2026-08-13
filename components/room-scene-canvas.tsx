"use client";

import { Maximize2, ScanSearch } from "lucide-react";
import { useT } from "next-i18next/client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ClientRoomSceneManifest } from "@/lib/client-types";

type CameraCommand = "reset" | "top";

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
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    const windowMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xaed7e7,
      roughness: 0.18,
      metalness: 0,
      transmission: 0.28,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const openingMaterial = new THREE.MeshStandardMaterial({
      color: 0x9ea8b5,
      roughness: 0.9,
      metalness: 0,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
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
    const surfaceMaterial = (category: string): THREE.Material => {
      if (category === "floor") return floorMaterial;
      if (category === "door") return doorMaterial;
      if (category === "window") return windowMaterial;
      if (category === "opening") return openingMaterial;
      return wallMaterial;
    };

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

    for (const roomManifest of visibleManifests) {
      const modelRoot = new THREE.Group();
      setMatrix(modelRoot, roomManifest.scan.scene.worldFromModel);
      webRoot.add(modelRoot);

      for (const surface of roomManifest.scan.scene.surfaces) {
        const dimensions = normalizedDimensions(surface.category, surface.dimensions);
        const geometry = new THREE.BoxGeometry(...dimensions);
        const mesh = new THREE.Mesh(geometry, surfaceMaterial(surface.category));
        mesh.castShadow = surface.category === "door";
        mesh.receiveShadow = true;
        if (surface.category === "door") mesh.renderOrder = 2;
        setMatrix(mesh, surface.transform);
        modelRoot.add(mesh);

        if (surface.category !== "floor") {
          const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry, 32),
            new THREE.LineBasicMaterial({
              color: surface.category === "window" ? 0x5b9cbd : 0x7f8996,
              transparent: true,
              opacity: 0.28,
            }),
          );
          mesh.add(outline);
        }
      }

      for (const item of roomManifest.scan.scene.objects) {
        const dimensions = normalizedDimensions(item.category, item.dimensions);
        const geometry = new THREE.BoxGeometry(...dimensions);
        const mesh = new THREE.Mesh(geometry, objectMaterial(item.category));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        setMatrix(mesh, item.transform);
        modelRoot.add(mesh);
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
        windowMaterial,
        openingMaterial,
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
