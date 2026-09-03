"use client";

import { Box, Download, LoaderCircle, Rotate3d } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type UsdzModelViewerLabels = {
  loading: string;
  unavailable: string;
  viewInAr: string;
  download: string;
  interaction: string;
};

const quickLookIcon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8'%3E%3Cpath d='m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z'/%3E%3Cpath d='m4.4 7.7 7.6 4.2 7.6-4.2M12 12v9'/%3E%3C/svg%3E";

function disposeObject(root: import("three").Object3D) {
  root.traverse((object) => {
    const mesh = object as import("three").Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (
          value &&
          typeof value === "object" &&
          "isTexture" in value &&
          typeof (value as import("three").Texture).dispose === "function"
        ) {
          (value as import("three").Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

export function UsdzModelViewer({
  src,
  name,
  labels,
  className = "",
}: {
  src: string;
  name: string;
  labels: UsdzModelViewerLabels;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [supportsQuickLook, setSupportsQuickLook] = useState(false);

  useEffect(() => {
    const anchor = document.createElement("a");
    setSupportsQuickLook(
      typeof anchor.relList.supports === "function" &&
        anchor.relList.supports("ar"),
    );
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let active = true;
    let frame = 0;
    let renderer: import("three").WebGLRenderer | null = null;
    let controls: import("three/addons/controls/OrbitControls.js").OrbitControls | null =
      null;
    let model: import("three").Object3D | null = null;
    let environmentTarget: import("three").WebGLRenderTarget | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const abortController = new AbortController();

    setStatus("loading");

    void (async () => {
      try {
        const [THREE, { OrbitControls }, { RoomEnvironment }, { USDLoader }] =
          await Promise.all([
            import("three"),
            import("three/addons/controls/OrbitControls.js"),
            import("three/addons/environments/RoomEnvironment.js"),
            import("three/addons/loaders/USDLoader.js"),
          ]);
        if (!active) return;

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.className = "block size-full touch-none";
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute("aria-label", labels.interaction);
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1_000);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.8;
        controls.screenSpacePanning = true;

        scene.add(new THREE.HemisphereLight(0xffffff, 0x667080, 2.3));
        const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
        keyLight.position.set(4, 6, 5);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xc8ddff, 1.4);
        fillLight.position.set(-4, 2, -3);
        scene.add(fillLight);

        const roomEnvironment = new RoomEnvironment();
        const environmentGenerator = new THREE.PMREMGenerator(renderer);
        environmentTarget = environmentGenerator.fromScene(roomEnvironment, 0.04);
        scene.environment = environmentTarget.texture;
        roomEnvironment.dispose();
        environmentGenerator.dispose();

        const response = await fetch(src, {
          cache: "no-store",
          credentials: "same-origin",
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Unable to load USDZ (HTTP ${response.status}).`);
        }
        const bytes = await response.arrayBuffer();
        if (!active) return;

        const loader = new USDLoader();
        const parsed = await new Promise<import("three").Group>((resolve, reject) => {
          loader.parse(
            bytes,
            new URL(".", response.url || new URL(src, window.location.href)).href,
            resolve,
            reject,
          );
        });
        if (!active) {
          disposeObject(parsed);
          return;
        }
        model = parsed;
        scene.add(model);

        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty()) throw new Error("The USDZ model is empty.");
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        parsed.position.sub(center);
        const radius = Math.max(size.x, size.y, size.z) / 2;
        const distance = Math.max(radius / Math.tan(THREE.MathUtils.degToRad(20)), 1);
        camera.near = Math.max(distance / 1_000, 0.001);
        camera.far = Math.max(distance * 100, 100);
        camera.position.set(distance * 0.82, distance * 0.55, distance * 0.95);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.minDistance = Math.max(radius * 0.35, 0.01);
        controls.maxDistance = Math.max(distance * 8, 10);
        controls.update();

        const resize = () => {
          if (!renderer || !active) return;
          const width = Math.max(host.clientWidth, 1);
          const height = Math.max(host.clientHeight, 1);
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        resize();

        const render = () => {
          if (!active || !renderer || !controls) return;
          controls.update();
          renderer.render(scene, camera);
          frame = window.requestAnimationFrame(render);
        };
        setStatus("ready");
        render();
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === "AbortError")) {
          setStatus("error");
        }
      }
    })();

    return () => {
      active = false;
      abortController.abort();
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      controls?.dispose();
      if (model) disposeObject(model);
      environmentTarget?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  }, [labels.interaction, src]);

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border bg-surface-subtle ${className}`}
    >
      <div className="relative aspect-square min-h-56 bg-[radial-gradient(circle_at_50%_35%,var(--color-surface),var(--color-surface-muted))]">
        <div ref={hostRef} className="absolute inset-0" />
        {status === "loading" ? (
          <div className="absolute inset-0 grid place-items-center text-center text-xs text-muted" role="status">
            <span>
              <LoaderCircle className="mx-auto mb-2 size-5 animate-spin" aria-hidden="true" />
              {labels.loading}
            </span>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="absolute inset-0 grid place-items-center px-5 text-center text-xs leading-5 text-muted">
            <span>
              <Box className="mx-auto mb-2 size-8" strokeWidth={1.4} aria-hidden="true" />
              {labels.unavailable}
            </span>
          </div>
        ) : null}
        {status === "ready" ? (
          <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[11px] font-semibold text-muted shadow-sm">
            <Rotate3d className="size-3.5" aria-hidden="true" /> 3D
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {name}
        </span>
        {supportsQuickLook ? (
          <a
            href={src}
            rel="ar"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand-border bg-brand-soft px-2.5 text-[12px] font-semibold text-brand"
          >
            {/* Quick Look requires an image inside its rel=ar link. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={quickLookIcon} alt="" className="size-3.5" aria-hidden="true" />
            {labels.viewInAr}
          </a>
        ) : null}
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          download={name}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-subtle px-2.5 text-[12px] font-semibold text-muted-strong transition hover:border-border-strong"
        >
          <Download className="size-3.5" aria-hidden="true" />
          {labels.download}
        </a>
      </div>
    </div>
  );
}
