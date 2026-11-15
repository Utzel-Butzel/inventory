"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useT } from "next-i18next/client";

/** Compact help, accessible by hover, keyboard focus and touch. */
export function LabelHelp({ children }: { children: ReactNode }) {
  const { t } = useT("labels");
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const close = () => { clearTimeout(timer.current); setPosition(null); };
  const show = () => {
    clearTimeout(timer.current);
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)), ...(rect.top > 220 ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }) });
  };
  const leave = () => { timer.current = setTimeout(() => setPosition(null), 150); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); window.removeEventListener("keydown", escape); };
  }, [position]);
  return <>
    <button ref={button} type="button" aria-label={t("helpLabel")} aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={close} onClick={show} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">
      <Info size={15} aria-hidden="true" />
    </button>
    {position ? createPortal(<div id={id} role="tooltip" style={position} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave} className="fixed z-[100] w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-surface p-3 text-xs font-normal leading-5 text-foreground shadow-lg">{children}</div>, document.body) : null}
  </>;
}
