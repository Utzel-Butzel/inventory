"use client";

import { useId, useRef, useState } from "react";
import { MoveHorizontal } from "lucide-react";

/** Compact numeric property editor. Each typing or scrubbing session is one undo step. */
export function LabelNumberControl({ label, value, min, max, step, unit, onChange, presets, disabled = false }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (value: number, record: boolean) => void;
  presets?: number[]; disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const recorded = useRef(false);
  const initial = useRef(value);
  const drag = useRef<{ x: number; value: number } | null>(null);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const commit = (next: number) => {
    if (disabled || !Number.isFinite(next)) return;
    const bounded = Math.round(Math.min(max, Math.max(min, next)) * 10000) / 10000;
    if (Math.abs(bounded - value) < 0.00001) return;
    onChange(bounded, !recorded.current);
    recorded.current = true;
  };
  const parse = (text: string) => text.trim() === "" ? NaN : Number(text.replace(",", "."));
  const begin = () => { initial.current = value; recorded.current = false; cancelled.current = false; };
  const multiplier = (event: { shiftKey: boolean; altKey: boolean }) => event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
  return (
    <div className={`min-w-0 ${disabled ? "opacity-50" : ""}`}>
      <label htmlFor={id} className="text-[11px] font-semibold text-muted">{label}</label>
      <div className="mt-1 flex h-9 items-center overflow-hidden rounded-lg border border-border bg-surface focus-within:border-focus">
        <button type="button" disabled={disabled} aria-label={label} tabIndex={-1}
          className="grid h-full w-7 shrink-0 touch-none cursor-ew-resize place-items-center text-muted hover:bg-surface-hover disabled:cursor-default"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            input.current?.blur();
            begin();
            drag.current = { x: event.clientX, value };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!drag.current) return;
            const delta = event.clientX - drag.current.x;
            drag.current.x = event.clientX;
            drag.current.value = Math.min(max, Math.max(min, drag.current.value + delta * step * multiplier(event)));
            commit(drag.current.value);
          }}
          onPointerUp={event => {
            drag.current = null; recorded.current = false;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { if (drag.current) commit(initial.current); drag.current = null; recorded.current = false; }}
          onLostPointerCapture={() => { drag.current = null; recorded.current = false; }}
        ><MoveHorizontal size={13} aria-hidden="true" /></button>
        <input ref={input} id={id} type="text" inputMode="decimal" role="spinbutton" disabled={disabled}
          aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
          list={presets ? `${id}-presets` : undefined} value={draft ?? Number(value.toFixed(4))}
          className="h-full w-full min-w-0 bg-transparent px-1 text-xs tabular-nums outline-none"
          onFocus={event => { begin(); event.currentTarget.select(); }}
          onChange={event => {
            const text = event.target.value;
            setDraft(text);
            const next = parse(text);
            if (next >= min && next <= max) commit(next);
          }}
          onBlur={() => {
            if (!cancelled.current && draft !== null) commit(parse(draft));
            setDraft(null); recorded.current = false;
          }}
          onKeyDown={event => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault(); event.stopPropagation();
              setDraft(null);
              commit(value + (event.key === "ArrowUp" ? 1 : -1) * step * multiplier(event));
            }
            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === "Escape") {
              event.preventDefault(); event.stopPropagation(); cancelled.current = true;
              commit(initial.current); setDraft(null); event.currentTarget.blur();
            }
          }} />
        {unit ? <span className="pointer-events-none pr-2 text-[10px] text-muted">{unit}</span> : null}
      </div>
      {presets ? <datalist id={`${id}-presets`}>{presets.map(size => <option key={size} value={size} />)}</datalist> : null}
    </div>
  );
}
