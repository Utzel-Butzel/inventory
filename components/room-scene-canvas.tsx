"use client";

import { Maximize2, ScanSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ClientRoomSceneManifest } from "@/lib/client-types";

type CameraCommand = "reset" | "top";

const surfaceColors: Record<string, number> = {
  wall: 0xdde2e8,
  floor: 0xc7cdd5,
  door: 0xb88964,
  window: 0x8fc5df,
  opening: 0x9ea8b5,
};

const objectColors: Record<string, number> = {
  storage: 0x9b8a75,
  table: 0xb69472,
  chair: 0x8e9a87,
  sofa: 0x8d96ad,
  bed: 0xa9a1bd,
  refrigerator: 0xaeb9c4,
  stairs: 0xa7a094,
};

function normalizedDimensions(
  category: string,
  dimensions: [number, number, number],
) {
  const minimum = category === "floor" ? 0.025 : 0.035;
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
  selectedResourceId,
  onSelectResource,
}: {
  manifest: ClientRoomSceneManifest;
  selectedResourceId: string | null;
  onSelectResource: (resourceId: string) => void;
}) {
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
      setRendererError("3D-Darstellung wird von diesem Browser nicht unterstützt.");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf3f5f7, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "block size-full touch-none";
    renderer.domElement.setAttribute("aria-label", `3D-Modell von ${manifest.room.name}`);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf3f5f7, 18, 55);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.02, 250);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 0.35;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8792a0, 2.25));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(6, 11, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const webRoot = new THREE.Group();
    setMatrix(webRoot, manifest.scan.scene.webFromWorld);
    scene.add(webRoot);

    const modelRoot = new THREE.Group();
    setMatrix(modelRoot, manifest.scan.scene.worldFromModel);
    webRoot.add(modelRoot);

    for (const surface of manifest.scan.scene.surfaces) {
      const dimensions = normalizedDimensions(surface.category, surface.dimensions);
      const geometry = new THREE.BoxGeometry(...dimensions);
      const material = new THREE.MeshStandardMaterial({
        color: surfaceColors[surface.category] ?? 0xcbd1d8,
        roughness: 0.9,
        metalness: 0.02,
        transparent: surface.category === "window" || surface.category === "opening",
        opacity: surface.category === "window" ? 0.28 : surface.category === "opening" ? 0.12 : 1,
        depthWrite: surface.category !== "opening",
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = true;
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

    for (const item of manifest.scan.scene.objects) {
      const dimensions = normalizedDimensions(item.category, item.dimensions);
      const geometry = new THREE.BoxGeometry(...dimensions);
      const material = new THREE.MeshStandardMaterial({
        color: objectColors[item.category] ?? 0xa59b90,
        roughness: 0.78,
        metalness: 0.02,
        transparent: true,
        opacity: 0.76,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      setMatrix(mesh, item.transform);
      modelRoot.add(mesh);
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
    for (const placement of manifest.placements) {
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

    const bounds = manifest.scan.scene.bounds;
    const modelBox = new THREE.Box3(
      new THREE.Vector3(...bounds.min),
      new THREE.Vector3(...bounds.max),
    );
    const modelToWeb = new THREE.Matrix4()
      .fromArray(manifest.scan.scene.webFromWorld)
      .multiply(new THREE.Matrix4().fromArray(manifest.scan.scene.worldFromModel));
    const box = modelBox.clone().applyMatrix4(modelToWeb);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1.5);
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
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      commandRef.current = () => undefined;
      selectionCommandRef.current = () => undefined;
    };
  }, [manifest]);

  return (
    <div ref={hostRef} className="relative size-full overflow-hidden bg-[#f3f5f7]">
      {rendererError ? (
        <div className="absolute inset-0 z-10 grid place-items-center p-8 text-center text-sm text-slate-500">
          {rendererError}
        </div>
      ) : null}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex gap-2">
        <button
          type="button"
          onClick={() => commandRef.current("top")}
          className="pointer-events-auto grid size-9 place-items-center rounded-xl border border-white/70 bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:text-violet-600"
          title="Draufsicht"
          aria-label="Draufsicht"
        >
          <ScanSearch className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => commandRef.current("reset")}
          className="pointer-events-auto grid size-9 place-items-center rounded-xl border border-white/70 bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:text-violet-600"
          title="Ansicht zurücksetzen"
          aria-label="Ansicht zurücksetzen"
        >
          <Maximize2 className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg bg-white/78 px-2.5 py-1.5 text-[10px] font-medium text-slate-500 shadow-sm backdrop-blur">
        Ziehen: drehen · Zwei Finger: verschieben · Scrollen: zoomen
      </div>
    </div>
  );
}
