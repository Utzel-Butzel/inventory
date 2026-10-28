"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";

export function Bulk3dModel({ src }: { src: string }) {
  const { t } = useT("counting");
  const host = useRef<HTMLDivElement>(null);
  const changeView = useRef<(top: boolean) => void>(() => undefined);
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const controller = new AbortController();
    let active = true;
    let dispose = () => undefined as void;
    setStatus("loading");
    void (async () => {
      try {
        const [THREE, { GLTFLoader }, { OrbitControls }] = await Promise.all([
          import("three"), import("three/addons/loaders/GLTFLoader.js"), import("three/addons/controls/OrbitControls.js"),
        ]);
        const response = await fetch(src, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Model unavailable");
        const bytes = await response.arrayBuffer();
        if (!active) return;
        const manager = new THREE.LoadingManager();
        // Our worker exports embedded vertex colors and geometry only.
        manager.setURLModifier(() => { throw new Error("External model resources are not allowed"); });
        const model = (await new GLTFLoader(manager).parseAsync(bytes, "")).scene;
        const releaseModel = () => model.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
          }
        });
        if (!active) { releaseModel(); return; }
        dispose = releaseModel;
        model.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
            object.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
          }
        });
        const bounds = new THREE.Box3().setFromObject(model);
        if (bounds.isEmpty()) throw new Error("Empty model");
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        model.position.sub(center);
        const radius = Math.max(size.x, size.y, size.z);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        node.appendChild(renderer.domElement);
        const scene = new THREE.Scene(); scene.add(model);
        const camera = new THREE.PerspectiveCamera(40, 1, Math.max(radius / 1000, .0001), radius * 30);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.minDistance = radius * .2; controls.maxDistance = radius * 8;
        const render = () => { if (active) renderer.render(scene, camera); };
        controls.addEventListener("change", render);
        const resize = () => {
          renderer.setSize(Math.max(1, node.clientWidth), Math.max(1, node.clientHeight), false);
          camera.aspect = node.clientWidth / Math.max(1, node.clientHeight); camera.updateProjectionMatrix(); render();
        };
        const observer = new ResizeObserver(resize); observer.observe(node);
        changeView.current = (top) => {
          camera.position.set(top ? 0 : radius, top ? radius * 2 : radius * 1.5, top ? .001 : radius * 1.5);
          controls.target.set(0, 0, 0); camera.lookAt(0, 0, 0); controls.update(); render();
        };
        changeView.current(false); resize(); setStatus("ready");
        dispose = () => { observer.disconnect(); controls.dispose(); releaseModel(); renderer.dispose(); renderer.domElement.remove(); };
      } catch {
        dispose();
        if (active) setStatus("error");
      }
    })();
    return () => { active = false; controller.abort(); changeView.current = () => undefined; dispose(); };
  }, [src]);
  return <div className="space-y-2">
    <div className="relative rounded-xl border border-border bg-surface-subtle">
      <div ref={host} className="h-80 w-full overflow-hidden rounded-xl" role="img" aria-label={t("threeD.modelAlt")} />
      {status !== "ready" ? <p role="status" className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted">{t(status === "error" ? "threeD.modelError" : "threeD.modelLoading")}</p> : null}
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button type="button" disabled={status !== "ready"} onClick={() => changeView.current(false)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-50">{t("threeD.oblique")}</button>
      <button type="button" disabled={status !== "ready"} onClick={() => changeView.current(true)} className="rounded-lg border border-border px-3 py-2 disabled:opacity-50">{t("threeD.top")}</button>
      <a href={src} download="inventory-reconstruction.glb" className="text-brand underline">{t("threeD.download")}</a>
    </div>
    <p className="text-xs text-muted">{t("threeD.modelHelp")}</p>
  </div>;
}
