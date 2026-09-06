"use client";
import { useState } from "react";
import { useT } from "next-i18next/client";
import { Save } from "lucide-react";
import type { ClientRoomSceneManifest } from "@/lib/client-types";
import type { RoomScene, RoomSurface, SpatialVector3 } from "@/lib/room-scene-contract";
import type { RoomEdit } from "@/lib/room-scene-editor";
import { roomMaterialSchema } from "@/lib/room-material-contract";
import { applyRoomSurfaceEdit, resizeRoomSurface } from "@/lib/room-surface-editor";
import { roomMaterialBaseRoughness } from "@/components/room-scene-materials";

const inputClass = "w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground";
export function RoomSurfaceEditor({ manifest, busy, onPreview, onSave }: {
  manifest: ClientRoomSceneManifest;
  busy: boolean;
  onPreview: (scene: RoomScene | null) => void;
  onSave: (edit: RoomEdit) => Promise<void>;
}) {
  const { t } = useT("spatial");
  const [selected, setSelected] = useState(manifest.scan.scene.surfaces.find(s => s.category === "wall")?.id ?? "");
  const [draft, setDraft] = useState<RoomSurface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const surface = draft ?? manifest.scan.scene.surfaces.find(s => s.id === selected);
  const change = (next: RoomSurface) => {
    try {
      const scene = applyRoomSurfaceEdit(manifest.scan.scene, next);
      setDraft(next); setError(null); onPreview(scene);
    } catch { setError(t("editor.architecture.invalid")); }
  };
  const number = (label: string, value: number, min: number, max: number, onChange: (value: number) => void, step = 0.01) => (
    <label className="block space-y-1 text-xs text-muted">
      <span>{label}</span><input className={inputClass} type="number" value={Math.round(value * 1000) / 1000} min={min} max={max} step={step}
        onChange={event => { const n = event.target.valueAsNumber; if (Number.isFinite(n) && n >= min && n <= max) onChange(n); }} />
    </label>
  );
  const detected = manifest.scan.aiAnalysis?.surfaceAppearances.find(s => s.status === "accepted" && s.surfaceCategory === surface?.category);
  const finish = surface?.appearance ?? (detected ? { colorHex: detected.colorHex, material: detected.material, roughness: detected.roughness } : {
    colorHex: surface?.category === "door" ? "#b99570" : "#e5e3df",
    material: surface?.category === "door" ? "wood" as const : "paint" as const,
    roughness: surface?.category === "door" ? 0.55 : 0.85,
  });
  return <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
    <p className="text-xs text-muted">{t("editor.architecture.hint")}</p>
    <label className="block space-y-1 text-xs text-muted"><span>{t("editor.architecture.surface")}</span>
      <select className={inputClass} value={selected} onChange={event => { setSelected(event.target.value); setDraft(null); setError(null); onPreview(null); }}>
        {manifest.scan.scene.surfaces.map((item, index) => <option key={item.id} value={item.id}>{t(`rooms.ai.surfaces.${item.category}`)} {index + 1} · {item.dimensions.slice(0, 2).map(n => n.toFixed(2)).join(" × ")} m</option>)}
      </select>
    </label>
    {surface ? <>
      <div className="grid grid-cols-2 gap-2">
        {surface.dimensions.map((value, axis) => <div key={axis}>
          {number(t(`editor.architecture.${axis === 0 ? "width" : axis === 1 ? "height" : "thickness"}`), value, axis === 2 ? 0 : 0.05, 100, n => {
            const dimensions = [...surface.dimensions] as SpatialVector3; dimensions[axis] = n;
            change(resizeRoomSurface(surface, dimensions));
          })}
        </div>)}
      </div>
      <div className="grid grid-cols-3 gap-2">{["X", "Y", "Z"].map((label, axis) => <div key={label}>
        {number(`${label} (m)`, surface.transform[12 + axis]!, -10000, 10000, n => {
          const transform = [...surface.transform]; transform[12 + axis] = n; change({ ...surface, transform });
        })}
      </div>)}</div>
      {surface.category !== "floor" ? number(t("editor.rotation"), Math.atan2(surface.transform[8]!, surface.transform[0]!) * 180 / Math.PI, -180, 180, n => {
        // Rotate the existing basis about world Y, preserving any scan tilt/scale.
        const delta = n * Math.PI / 180 - Math.atan2(surface.transform[8]!, surface.transform[0]!);
        const c = Math.cos(delta), s = Math.sin(delta), transform = [...surface.transform];
        for (const offset of [0, 4, 8]) { transform[offset] = c * surface.transform[offset]! + s * surface.transform[offset + 2]!; transform[offset + 2] = -s * surface.transform[offset]! + c * surface.transform[offset + 2]!; }
        change({ ...surface, transform });
      }, 1) : null}
      <label className="flex items-center justify-between text-xs text-muted">{t("editor.color")}
        <input type="color" aria-label={t("editor.color")} value={finish.colorHex} onChange={event => change({ ...surface, appearance: { ...finish, colorHex: event.target.value } })} />
      </label>
      <label className="block space-y-1 text-xs text-muted"><span>{t("editor.architecture.material")}</span>
        <select className={inputClass} value={finish.material} onChange={event => {
          const material = roomMaterialSchema.parse(event.target.value);
          change({ ...surface, appearance: { ...finish, material, roughness: roomMaterialBaseRoughness[material] } });
        }}>{roomMaterialSchema.options.map(material => <option key={material} value={material}>{t(`rooms.ai.materials.${material}`)}</option>)}</select>
      </label>
      {number(t("editor.architecture.roughness"), finish.roughness, 0, 1, roughness => change({ ...surface, appearance: { ...finish, roughness } }), 0.05)}
      {surface.category === "window" ? <p className="text-[11px] text-muted">{t("editor.architecture.windowHint")}</p> : null}
      <button type="button" className="text-xs text-brand" onClick={() => change({ ...surface, appearance: null })}>{t("editor.architecture.resetFinish")}</button>
      {error ? <p role="alert" className="text-xs text-error">{error}</p> : null}
      <button type="button" disabled={busy || !draft || Boolean(error)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-xs font-semibold text-on-brand disabled:opacity-40"
        onClick={() => void onSave({ action: "surface", revision: manifest.scan.revision, surface })}><Save className="size-3.5" />{t("editor.save")}</button>
      <button type="button" className="text-xs text-muted" onClick={() => { setDraft(null); setError(null); onPreview(null); }}>{t("editor.cancel")}</button>
    </> : null}
  </fieldset>;
}
