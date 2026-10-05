"use client";

import type { ReactNode } from "react";

export function StockActionPanel({ action, busy, children }: {
  action: string;
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <section id="stock-action-panel" role="tabpanel" aria-labelledby={`stock-action-${action}`}
      aria-busy={busy} tabIndex={0} className="mt-5 space-y-4 border-t border-border pt-5">
      {children}
    </section>
  );
}
