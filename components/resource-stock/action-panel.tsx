"use client";

import type { ReactNode } from "react";

export function StockActionPanel({ label, busy, children }: {
  label: string;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <section id="stock-action-panel" role="region" aria-label={label}
      aria-busy={busy} tabIndex={0} className="mt-5 space-y-4 border-t border-border pt-5">
      {children}
    </section>
  );
}
