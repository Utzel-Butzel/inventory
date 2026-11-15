"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ChevronDown, ChevronRight, Eye, EyeOff, Frame, GripVertical, Link, Unlink, WrapText } from "lucide-react";
import { useT } from "next-i18next/client";
import { LabelNumberControl } from "@/components/label-number-control";
import type { LabelAutoLayoutGroup, LabelElement, LabelRowLayout } from "@/lib/label-setup-contract";
import { framePadding, type LayoutBox } from "@/lib/label-layout-engine";
import { layoutChildren, layoutItems, ROOT_FRAME, type LayoutDraft } from "@/lib/label-layout-tree";

type Sizing = "hug" | "fill" | "fixed";
export function LabelSizingControl({ axis, value, mode, allowFill = true, allowHug = true, onMode, onValue }: {
  axis: "width" | "height"; value: number; mode: Sizing; allowFill?: boolean; allowHug?: boolean;
  onMode: (mode: Sizing) => void; onValue: (value: number, record: boolean) => void;
}) {
  const { t } = useT("labels");
  return <div className="min-w-0 space-y-1">
    <LabelNumberControl label={t(axis === "width" ? "designer.width" : "designer.height")} unit="mm" value={value}
      min={0.1} max={1000} step={0.1} disabled={mode !== "fixed"} onChange={onValue} />
    <select aria-label={t(axis === "width" ? "designer.frames.widthSizing" : "designer.frames.heightSizing")}
      value={mode} onChange={event => onMode(event.target.value as Sizing)} className="h-7 w-full rounded border border-border bg-surface px-1 text-[11px]">
      <option value="fixed">{t("designer.frames.fixed")}</option>
      {allowHug ? <option value="hug">{t("designer.frames.hug")}</option> : null}
      {allowFill ? <option value="fill">{t("designer.frames.fill")}</option> : null}
    </select>
  </div>;
}

export function LabelFrameProperties({ frame, root = false, bounds, onChange, onSizing, onDissolve }: {
  frame: LabelAutoLayoutGroup | LabelRowLayout; root?: boolean; bounds: LayoutBox;
  onChange: (patch: Partial<LabelAutoLayoutGroup>, record?: boolean) => void;
  onSizing: (axis: "width" | "height", mode: Sizing) => void; onDissolve?: () => void;
}) {
  const { t } = useT("labels");
  const padding = framePadding(frame);
  const [linked, setLinked] = useState(false);
  const direction = frame.direction ?? "row";
  const crossAlign = frame.align === "middle" ? "center" : frame.align === "top" ? "start" : frame.align === "bottom" ? "end" : frame.align;
  const mainAlign = frame.mainAlign ?? "start";
  return <div className="space-y-4">
    {!root && "name" in frame ? <input aria-label={t("designer.groups.name")} value={frame.name} maxLength={160}
      onChange={event => onChange({ name: event.target.value })}
      onBlur={() => { if (!frame.name.trim()) onChange({ name: t("designer.frames.frame") }); }}
      className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm font-semibold" /> : null}
    <div className="grid grid-cols-2 gap-2">
      <LabelSizingControl axis="width" value={bounds.width} mode={frame.widthSizing ?? "hug"} allowFill={!root}
        onMode={mode => onSizing("width", mode)} onValue={(widthMm, record) => onChange({ widthMm }, record)} />
      <LabelSizingControl axis="height" value={bounds.height} mode={root ? "fixed" : frame.heightSizing ?? "hug"} allowFill={!root} allowHug={!root}
        onMode={mode => onSizing("height", mode)} onValue={(heightMm, record) => onChange({ heightMm }, record)} />
    </div>
    <div className="flex items-center justify-between border-t border-border pt-3">
      <h3 className="text-xs font-semibold">{t("designer.frames.autoLayout")}</h3>
      {onDissolve ? <button type="button" onClick={onDissolve} title={t("designer.frames.removeShortcut")}
        className="rounded p-1 text-xs text-muted hover:bg-surface-hover">{t("designer.groups.ungroup")}</button> : null}
    </div>
    <div className="flex gap-1" role="group" aria-label={t("designer.groups.direction")}>
      {(["row", "column"] as const).map(value => <button type="button" key={value} aria-pressed={direction === value}
        title={t(value === "row" ? "designer.groups.row" : "designer.groups.column")}
        aria-label={t(value === "row" ? "designer.groups.row" : "designer.groups.column")}
        onClick={() => onChange({ direction: value })}
        className={`grid h-8 flex-1 place-items-center rounded border ${direction === value ? "border-brand-border bg-brand-soft text-brand" : "border-border hover:bg-surface-hover"}`}>
        {value === "row" ? <ArrowRight size={16} /> : <ArrowDown size={16} />}
      </button>)}
      <button type="button" aria-pressed={!!frame.wrap} title={t("designer.frames.wrap")} aria-label={t("designer.frames.wrap")}
        onClick={() => onChange({ wrap: !frame.wrap, ...(!frame.wrap ? direction === "row" ? { widthSizing: "fixed", widthMm: bounds.width } : { heightSizing: "fixed", heightMm: bounds.height } : {}) })}
        className={`grid h-8 flex-1 place-items-center rounded border ${frame.wrap ? "border-brand-border bg-brand-soft text-brand" : "border-border hover:bg-surface-hover"}`}><WrapText size={16} /></button>
    </div>
    <div className="flex items-end gap-3">
      <div className="grid size-[76px] shrink-0 grid-cols-3 gap-1 rounded-lg border border-border p-1" role="group" aria-label={t("designer.groups.align")}>
        {Array.from({ length: 9 }, (_, index) => {
          const x = ["start", "center", "end"][index % 3], y = ["start", "center", "end"][Math.floor(index / 3)];
          const main = direction === "row" ? x : y, cross = direction === "row" ? y : x;
          return <button key={index} type="button" aria-label={`${t(`designer.frames.${y}`)} / ${t(`designer.frames.${x}`)}`}
            aria-pressed={(mainAlign === main || mainAlign === "space-between") && crossAlign === cross}
            onClick={() => onChange({ mainAlign: mainAlign === "space-between" ? mainAlign : main as LabelAutoLayoutGroup["mainAlign"], align: cross as LabelAutoLayoutGroup["align"] })}
            className={`grid place-items-center rounded hover:bg-surface-hover ${(mainAlign === main || mainAlign === "space-between") && crossAlign === cross ? "bg-brand-soft text-brand" : "text-muted"}`}><span className="size-1.5 rounded-sm bg-current" /></button>;
        })}
      </div>
      <div className="min-w-0 flex-1">
        <LabelNumberControl label={t("designer.groups.gap")} unit="mm" value={frame.gapMm} min={-1000} max={1000} step={0.1}
          disabled={mainAlign === "space-between"} onChange={(gapMm, record) => onChange({ gapMm }, record)} />
        <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted"><input type="checkbox" checked={mainAlign === "space-between"}
          onChange={event => onChange({ mainAlign: event.target.checked ? "space-between" : "start", ...(event.target.checked ? direction === "row" ? { widthSizing: "fixed", widthMm: bounds.width } : { heightSizing: "fixed", heightMm: bounds.height } : {}) })} />{t("designer.frames.autoGap")}</label>
      </div>
    </div>
    {frame.wrap ? <LabelNumberControl label={t("designer.frames.crossGap")} unit="mm" value={frame.crossGapMm ?? frame.gapMm}
      min={-1000} max={1000} step={0.1} onChange={(crossGapMm, record) => onChange({ crossGapMm }, record)} /> : null}
    <div>
      <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold">{t("designer.groups.padding")}</span>
        <button type="button" aria-pressed={linked} aria-label={t("designer.frames.linkPadding")} onClick={() => setLinked(value => !value)}
          className="rounded p-1 text-muted hover:bg-surface-hover">{linked ? <Link size={13} /> : <Unlink size={13} />}</button></div>
      <div className="grid grid-cols-2 gap-2">
        {(["top", "right", "bottom", "left"] as const).map(side => {
          const key = `padding${side[0].toUpperCase()}${side.slice(1)}Mm` as "paddingTopMm" | "paddingRightMm" | "paddingBottomMm" | "paddingLeftMm";
          return <LabelNumberControl key={side} label={t(`designer.row.${key}`)} value={padding[side]} min={-1000} max={1000} step={0.1}
            onChange={(value, record) => onChange(linked ? { paddingTopMm: value, paddingRightMm: value, paddingBottomMm: value, paddingLeftMm: value } : { [key]: value }, record)} />;
        })}
      </div>
    </div>
  </div>;
}

export function LabelLayoutTree({ setup, selection, elementName, onSelect, onMove, onVisibility }: {
  setup: LayoutDraft; selection: string[]; elementName: (element: LabelElement) => string;
  onSelect: (id: string, additive: boolean) => void; onMove: (ids: string[], parentId: string, index: number) => void;
  onVisibility: (id: string, visible: boolean) => void;
}) {
  const { t } = useT("labels");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const drag = useRef<{ ids: string[]; x: number; y: number; pointerId: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [drop, setDrop] = useState<{ id: string; position: "before" | "after" | "inside" } | null>(null);
  useEffect(() => {
    const targetAt = (event: PointerEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-layout-node]");
      const id = target?.dataset.layoutNode;
      if (!target || !id) return null;
      if (id === ROOT_FRAME) return { id, position: "inside" as const };
      const item = layoutItems(setup).find(item => item.id === id);
      if (!item) return null;
      const rect = target.getBoundingClientRect();
      const fraction = (event.clientY - rect.top) / rect.height;
      const position = item.frame && fraction > 0.25 && fraction < 0.75 ? "inside" as const : fraction < 0.5 ? "before" as const : "after" as const;
      return { id, position };
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4 && !current.active) return;
      current.active = true;
      event.preventDefault();
      setDrop(targetAt(event));
    };
    const finish = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      drag.current = null;
      if (current.active) {
        suppressClick.current = true;
        const target = targetAt(event);
        if (target && event.type !== "pointercancel" && !current.ids.includes(target.id)) {
          const item = layoutItems(setup).find(item => item.id === target.id);
          const parent = target.position === "inside" ? target.id : item?.parentId ?? ROOT_FRAME;
          const siblings = layoutChildren(setup, parent).filter(item => !current.ids.includes(item.id));
          const index = target.position === "inside" ? siblings.length : siblings.findIndex(item => item.id === target.id) + (target.position === "after" ? 1 : 0);
          onMove(current.ids, parent, index);
        }
      }
      setDrop(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
  }, [setup, onMove]);
  const rows = (parent: string, depth: number): React.ReactNode => layoutChildren(setup, parent).map(item => {
    const name = item.frame?.name ?? elementName(item.element!);
    const visible = item.element?.visible ?? item.frame?.visible !== false;
    return <div key={item.id} role="treeitem" aria-selected={selection.includes(item.id)} aria-expanded={item.frame ? !collapsed.has(item.id) : undefined}>
      <div data-layout-node={item.id}
        style={{ paddingLeft: depth * 12 }}
        className={`flex min-h-9 items-center rounded border ${selection.includes(item.id) ? "border-brand-border bg-brand-soft" : "border-transparent hover:bg-surface-hover"} ${drop?.id === item.id ? drop.position === "before" ? "border-t-focus" : drop.position === "after" ? "border-b-focus" : "ring-1 ring-focus" : ""} ${visible ? "" : "opacity-50"}`}>
        {item.frame ? <button type="button" aria-label={t(collapsed.has(item.id) ? "designer.frames.expand" : "designer.frames.collapse")}
          onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}
          className="p-1">{collapsed.has(item.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : <GripVertical size={12} className="mx-1 shrink-0 text-muted" />}
        <button type="button" onPointerDown={event => {
          if (event.button !== 0) return;
          suppressClick.current = false;
          if (!selection.includes(item.id) && !event.shiftKey && !event.metaKey && !event.ctrlKey) onSelect(item.id, false);
          drag.current = { ids: selection.includes(item.id) ? selection : [item.id], x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
        }} onClick={event => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(item.id, event.shiftKey || event.metaKey || event.ctrlKey); }}
          className="flex min-w-0 flex-1 touch-none select-none items-center gap-1.5 py-2 text-left text-xs">
          {item.frame ? <Frame size={13} className="shrink-0" /> : null}<span className="truncate">{name}</span>
        </button>
        <button type="button" aria-label={t("designer.showElement", { element: name })} aria-pressed={visible}
          onClick={() => onVisibility(item.id, !visible)} className="p-1.5 text-muted">{visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
      </div>
      {item.frame && !collapsed.has(item.id) ? <div role="group">{rows(item.id, depth + 1)}</div> : null}
    </div>;
  });
  return <div role="tree" aria-multiselectable="true" aria-label={t("designer.layersTitle")} className="mt-3 space-y-1">
    <button type="button" data-layout-node={ROOT_FRAME} onClick={() => onSelect(ROOT_FRAME, false)}
      className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-semibold ${selection.includes(ROOT_FRAME) ? "bg-brand-soft text-brand" : "hover:bg-surface-hover"}`}>
      <Frame size={14} />{t("designer.frames.labelFrame")}
    </button>
    {rows(ROOT_FRAME, 0)}
  </div>;
}
