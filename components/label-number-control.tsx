"use client";

import { useId, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

/** Number input, stepper, presets and slider sharing one bounded value.
 * A drag or typing session is one undo step, not dozens of intermediate edits. */
export function LabelNumberControl({ label, value, min, max, step, unit, onChange, presets, sliderMax }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (value: number, record: boolean) => void;
  presets?: number[]; sliderMax?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const recorded = useRef(false);
  const commit = (next: number, grouped = false) => {
    if (!Number.isFinite(next)) return;
    const bounded = Math.round(Math.min(max, Math.max(min, next)) * 10000) / 10000;
    if (Math.abs(bounded - value) < 0.00001) return;
    onChange(bounded, !grouped || !recorded.current);
    if (grouped) recorded.current = true;
  };
  const finish = () => { setDraft(null); recorded.current = false; };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="text-[11px] font-semibold text-muted">{label}</label>
      <div className="mt-1 flex h-9 items-center overflow-hidden rounded-lg border border-border bg-surface focus-within:border-focus">
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={event => commit(value - step * (event.shiftKey ? 10 : 1))} className="grid h-full w-7 shrink-0 place-items-center hover:bg-surface-hover disabled:opacity-30"><Minus size={12} /></button>
        <input id={id} type="number" min={min} max={max} step={step} list={presets ? `${id}-presets` : undefined}
          value={draft ?? Number(value.toFixed(2))}
          className="h-full w-full min-w-0 bg-transparent px-1 text-center text-xs tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          onFocus={() => { recorded.current = false; }}
          onChange={event => {
            const text = event.target.value;
            setDraft(text);
            const next = Number(text);
            if (text !== "" && next >= min && next <= max) commit(next, true);
          }}
          onBlur={() => { if (draft !== null && draft !== "") commit(Number(draft), true); finish(); }}
          onKeyDown={event => {
            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); event.currentTarget.blur(); }
          }} />
        {unit ? <span className="text-[10px] text-muted">{unit}</span> : null}
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={event => commit(value + step * (event.shiftKey ? 10 : 1))} className="grid h-full w-7 shrink-0 place-items-center hover:bg-surface-hover disabled:opacity-30"><Plus size={12} /></button>
      </div>
      {presets ? <datalist id={`${id}-presets`}>{presets.map(size => <option key={size} value={size} />)}</datalist> : null}
      <input type="range" aria-label={label} min={min} max={Math.max(value, sliderMax ?? max)} step={step} value={value}
        className="mt-2 h-1 w-full cursor-pointer accent-[var(--color-brand-solid)]"
        onPointerDown={() => { recorded.current = false; }}
        onPointerUp={() => { recorded.current = false; }}
        onPointerCancel={() => { recorded.current = false; }}
        onKeyUp={() => { recorded.current = false; }}
        onBlur={() => { recorded.current = false; }}
        onChange={event => commit(Number(event.target.value), true)} />
    </div>
  );
}
