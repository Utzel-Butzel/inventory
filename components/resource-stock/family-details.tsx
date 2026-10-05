"use client";

import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { fetchJson } from "@/lib/client-types";
import { formatDate } from "@/lib/client-formatters";
import { StockLocationsManager } from "@/components/stock-locations-manager";
import { Button } from "@/components/ui";
import { BuildMovementDetails } from "./build-movement-details";
import { movementLabelKeys } from "./model";
import type { MovementType, StockData } from "./types";

export type StockDetailTab = "movements" | "units" | "locations";
export function FamilyStockDetails({ members, tab }: { members: Array<{ id: string; name: string }>; tab: StockDetailTab }) {
  const { t, i18n } = useT("stock");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const ids = members.slice(page * 20, (page + 1) * 20).map((member) => member.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setFailed(false); setData([]);
    const pending = ids.split(",").filter(Boolean);
    const loaded: StockData[] = [];
    const worker = async () => {
      while (pending.length && !controller.signal.aborted) {
        try { loaded.push(await fetchJson<StockData>(`/api/v1/resources/${pending.shift()!}/stock`, { signal: controller.signal, cache: "no-store" })); }
        catch { if (!controller.signal.aborted) setFailed(true); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker)).then(() => {
      if (!controller.signal.aborted) { setData(loaded); setLoading(false); }
    });
    return () => controller.abort();
  }, [ids, retry]);
  const movements = data.flatMap((stock) => stock.movements.map((movement) => ({ ...movement, resource: stock.resource }))).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const units = data.flatMap((stock) => stock.units.map((unit) => ({ ...unit, resource: stock.resource })));
  return <div className="space-y-3">
    <p className="text-xs text-muted">{t("workspace.familyReadOnly")}</p>
    {members.length > 20 ? <div className="flex items-center gap-3"><Button size="sm" variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>{t("workspace.previous")}</Button><span>{page + 1} / {Math.ceil(members.length / 20)}</span><Button size="sm" variant="secondary" disabled={(page + 1) * 20 >= members.length} onClick={() => setPage(page + 1)}>{t("workspace.next")}</Button></div> : null}
    {failed ? <p role="alert" className="text-sm text-danger">{t("workspace.partialLoad")} <button onClick={() => setRetry(retry + 1)} className="underline">{t("workspace.retry")}</button></p> : null}
    {loading ? <p role="status" className="p-5 text-sm text-muted">{t("workspace.loading")}</p> : <>
      {tab === "movements" ? <div className="divide-y divide-border rounded-xl border border-border bg-surface">{movements.length ? movements.map((movement) => <div key={movement.id} className="flex items-start justify-between gap-4 p-4"><div><Link href={`/inventory/${movement.resource.id}/stock`} className="text-sm font-semibold text-brand">{movement.resource.name}</Link><p className="mt-1 text-xs text-muted">{movement.assemblyBuildId ? t(movement.delta > 0 ? "workspace.assemblyCompleted" : "workspace.assemblyConsumed") : movement.reason || t(movementLabelKeys[movement.type as MovementType] ?? "resource.movements.stockUpdate")} · {formatDate(movement.occurredAt, i18n.language, true)}</p>{movement.assemblyBuildId && movement.delta > 0 ? <BuildMovementDetails resourceId={movement.resource.id} buildId={movement.assemblyBuildId} /> : null}</div><span className="font-semibold tabular-nums">{movement.delta > 0 ? "+" : ""}{movement.delta}</span></div>) : <p className="p-5 text-sm text-muted">{t("workspace.emptyMovements")}</p>}</div> : null}
      {tab === "units" ? <div className="divide-y divide-border rounded-xl border border-border bg-surface">{units.length ? units.map((unit) => <Link key={unit.id} href={`/inventory/${unit.resource.id}/stock?unit=${unit.id}`} className="flex justify-between gap-4 p-4 hover:bg-surface-hover"><span><span className="block text-sm font-medium">{unit.code}</span><span className="text-xs text-muted">{unit.resource.name}</span></span><span className="text-xs text-muted">{unit.location ?? "—"}</span></Link>) : <p className="p-5 text-sm text-muted">{t("workspace.emptyUnits")}</p>}</div> : null}
      {tab === "locations" ? data.map((stock) => <LocationDetails key={stock.resource.id} resourceId={stock.resource.id} name={stock.resource.name} quantity={stock.resource.quantity} />) : null}
    </>}
  </div>;
}
function LocationDetails({ resourceId, name, quantity }: { resourceId: string; name: string; quantity: number }) {
  const [open, setOpen] = useState(false);
  return <details className="rounded-xl border border-border bg-surface p-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">{name} · {quantity}</summary>
    {open ? <StockLocationsManager resourceId={resourceId} canEdit={false} /> : null}
  </details>;
}
