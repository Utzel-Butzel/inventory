"use client";

import { useState } from "react";
import { useT } from "next-i18next/client";
import { fetchJson } from "@/lib/client-types";

type Build = { id: string; components: Array<{ resourceId: string | null; name?: string; resourceName?: string; quantityConsumed?: number; quantity?: number }> };
export function BuildMovementDetails({ resourceId, buildId }: { resourceId: string; buildId: string }) {
  const { t } = useT("stock");
  const [build, setBuild] = useState<Build | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    if (build || loading) return;
    setLoading(true); setError(false);
    try {
      const result = await fetchJson<{ builds: Build[] }>(`/api/v1/resources/${resourceId}/stock/builds?limit=100`);
      const match = result.builds.find((entry) => entry.id === buildId);
      if (!match) throw new Error("Build unavailable");
      setBuild(match);
    } catch { setError(true); }
    finally { setLoading(false); }
  }
  return <details className="mt-2" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer text-xs font-medium text-brand">{t("workspace.consumedComponents")}</summary>
    {loading ? <p className="mt-2 text-xs text-muted">{t("workspace.loading")}</p> : null}
    {error ? <button type="button" onClick={() => void load()} className="mt-2 text-xs text-danger">{t("workspace.retry")}</button> : null}
    {build ? <ul className="mt-2 space-y-1 text-xs text-muted">{build.components.map((component, index) => <li key={`${component.resourceId}-${index}`}>{component.quantityConsumed ?? component.quantity ?? 0} × {component.name ?? component.resourceName ?? "—"}</li>)}</ul> : null}
  </details>;
}
