"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";

export function LabelCopyCount({ label, value, onChange, max = 100, disabled = false }: {
  label: string; value: number; onChange: (value: number) => void; max?: number; disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (number: number) => onChange(Math.min(max, Math.max(1, Math.round(number))));
  return <div className="flex shrink-0 items-center gap-2">
    <label htmlFor={id} className="text-xs font-medium text-muted">{label}</label>
    <div className="flex h-10 items-center rounded-xl border border-border bg-surface">
      <button type="button" disabled={disabled || value <= 1} aria-label={`${label} −`} className="grid h-full w-8 place-items-center rounded-l-xl hover:bg-surface-hover disabled:opacity-30" onClick={() => { setDraft(null); commit(value - 1); }}><Minus size={13} /></button>
      <input id={id} type="number" min={1} max={max} step={1} disabled={disabled} value={draft ?? value}
        className="h-full w-12 bg-transparent text-center text-sm tabular-nums outline-none focus:ring-2 focus:ring-inset focus:ring-focus/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        onChange={event => {
          const text = event.target.value; setDraft(text);
          const next = Number(text);
          if (text && Number.isInteger(next) && next >= 1 && next <= max) onChange(next);
        }}
        onBlur={() => { if (draft && Number.isFinite(Number(draft))) commit(Number(draft)); setDraft(null); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
      <button type="button" disabled={disabled || value >= max} aria-label={`${label} +`} className="grid h-full w-8 place-items-center rounded-r-xl hover:bg-surface-hover disabled:opacity-30" onClick={() => { setDraft(null); commit(value + 1); }}><Plus size={13} /></button>
    </div>
  </div>;
}
