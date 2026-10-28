"use client";

import { useState } from "react";
import { useT } from "next-i18next/client";
import type { Bulk3dInput, ImagePoint } from "@/lib/inventory-bulk-3d";

export type Bulk3dMarks = Bulk3dInput["marks"];
export const emptyBulk3dMarks = (): Bulk3dMarks => ({ pile: [], table: [], edges: [] });

export function Bulk3dAnnotations({ src, marks, onChange, disabled }: {
  src: string; marks: Bulk3dMarks; onChange: (marks: Bulk3dMarks) => void; disabled: boolean;
}) {
  const { t } = useT("counting");
  const [tool, setTool] = useState<"pile" | "edges" | "table">("pile");
  const [pending, setPending] = useState<ImagePoint | null>(null);
  const [cursor, setCursor] = useState<ImagePoint>([.5, .5]);
  function add(point: ImagePoint) {
    if (disabled) return;
    if (tool === "edges") {
      if (marks.edges.length >= 20) return;
      if (!pending) setPending(point);
      else { onChange({ ...marks, edges: [...marks.edges, [pending, point]] }); setPending(null); }
    } else if (marks[tool].length < (tool === "table" ? 3 : 20)) onChange({ ...marks, [tool]: [...marks[tool], point] });
  }
  return <div className="space-y-3">
    <p className="text-xs font-semibold">{t("threeD.markTitle")}</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("threeD.markTitle")}>
      {(["pile", "edges", "table"] as const).map((key) => <button type="button" key={key} disabled={disabled} aria-pressed={tool === key}
        onClick={() => { setTool(key); setPending(null); }}
        className={`rounded-lg border px-3 py-2 text-xs disabled:opacity-50 ${tool === key ? "border-brand-border bg-brand-soft text-brand" : "border-border text-muted-strong"}`}>
        {t(`threeD.markTools.${key}`)} ({marks[key].length})
      </button>)}
    </div>
    <p className="text-xs leading-5 text-muted-strong" aria-live="polite">{t(`threeD.markHelp.${tool}`)} {pending ? t("threeD.markSecond") : ""}</p>
    <div className="relative mx-auto w-full max-w-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={t("threeD.markPhoto")} className="block h-auto w-full rounded-xl" />
      <svg className="absolute inset-0 h-full w-full touch-manipulation rounded-xl focus:outline-2 focus:outline-brand" viewBox="0 0 1 1" preserveAspectRatio="none"
        role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={t("threeD.markKeyboard")}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          const box = event.currentTarget.getBoundingClientRect();
          const point: ImagePoint = [Math.max(0, Math.min(1, (event.clientX-box.left)/box.width)), Math.max(0, Math.min(1, (event.clientY-box.top)/box.height))];
          setCursor(point); add(point);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const step = event.shiftKey ? .05 : .01;
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault(); setCursor(([x, y]) => [Math.max(0, Math.min(1, x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))), Math.max(0, Math.min(1, y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0)))]);
          } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); add(cursor); }
        }}>
        <polygon points={marks.pile.map((p) => p.join(",")).join(" ")} fill="#ffb000" fillOpacity=".12" stroke="#ffb000" strokeWidth=".003" />
        {marks.pile.map(([x, y], i) => <circle key={`p-${i}`} cx={x} cy={y} r=".005" fill="#ffb000" />)}
        {marks.edges.map(([a, b], i) => <line key={`e-${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#00ff88" strokeWidth=".004" />)}
        {marks.table.map(([x, y], i) => <g key={`t-${i}`}><circle cx={x} cy={y} r=".009" fill="#339dff" stroke="white" strokeWidth=".002" /><text x={x+.012} y={y+.005} fontSize=".024" fill="white">{i+1}</text></g>)}
        {pending ? <circle cx={pending[0]} cy={pending[1]} r=".006" fill="#00ff88" /> : null}
        <path d={`M ${cursor[0]-.012} ${cursor[1]} H ${cursor[0]+.012} M ${cursor[0]} ${cursor[1]-.012} V ${cursor[1]+.012}`} stroke="white" strokeWidth=".002" />
      </svg>
    </div>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={disabled || (!pending && marks[tool].length === 0)} onClick={() => {
        if (pending) setPending(null); else onChange({ ...marks, [tool]: marks[tool].slice(0, -1) });
      }} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{t("threeD.undo")}</button>
      <button type="button" disabled={disabled} onClick={() => { setPending(null); onChange(emptyBulk3dMarks()); }} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{t("threeD.clearMarks")}</button>
    </div>
  </div>;
}
