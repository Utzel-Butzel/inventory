"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";
import { OrganizationLink as Link } from "@/components/organization-routing";
import type { FamilyStock } from "@/components/family-stock-summary";
import { Button } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import { inputClass } from "./fields";

export type StockBomPreview = {
  resource: { id: string; name: string; quantity: number; trackingMode: "bulk" | "serialized" };
  buildableQuantity: number;
  existingResourceId?: string | null;
  components: Array<{ slotKey: string; name: string; choices: Array<{ resourceId: string; name: string }> }>;
};
export type VirtualStockSelection = { primaryId: string; configuration: Record<string, string>; preview: StockBomPreview };

export function StockVariantOverview({ family, resourceId, revision, allSelected, virtualSelected, detailTab, onSelect, onCurrent, onAll, onVirtual }: {
  family: FamilyStock;
  resourceId: string;
  revision: number;
  allSelected: boolean;
  virtualSelected: boolean;
  detailTab: string;
  onSelect: (id: string) => void;
  onCurrent: () => void;
  onAll: () => void;
  onVirtual: (selection: VirtualStockSelection) => void;
}) {
  const { t } = useT("stock");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [base, setBase] = useState<StockBomPreview | null>(null);
  const [buildable, setBuildable] = useState<Record<string, number | null>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const members = useMemo(() => family.variants.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())), [family.variants, query]);
  const visible = useMemo(() => members.slice(page * 20, page * 20 + 20), [members, page]);
  const ids = visible.map((member) => member.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<StockBomPreview>(`/api/v1/resources/${family.primary.id}/bom`, { signal: controller.signal, cache: "no-store" })
      .then(setBase).catch(() => { if (!controller.signal.aborted) setBase(null); });
    return () => controller.abort();
  }, [family.primary.id, revision]);
  useEffect(() => {
    const controller = new AbortController();
    const pending = ids.split(",").filter(Boolean);
    // Bound requests to visible rows and four concurrent requests, never combinations.
    const worker = async () => {
      while (pending.length && !controller.signal.aborted) {
        const id = pending.shift()!;
        try {
          const bom = await fetchJson<StockBomPreview>(`/api/v1/resources/${id}/bom`, { signal: controller.signal, cache: "no-store" });
          if (!controller.signal.aborted) setBuildable((previous) => ({ ...previous, [id]: bom.components.length ? bom.buildableQuantity : null }));
        } catch { if (!controller.signal.aborted) setBuildable((previous) => ({ ...previous, [id]: null })); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
    return () => controller.abort();
  }, [ids, revision]);
  const groups = base?.components.filter((component) => component.choices.length > 1) ?? [];
  if (!family.variants.length && !groups.length) return null;
  const chooseConfiguration = async () => {
    setResolving(true); setError(null);
    const configuration = Object.fromEntries(groups.map((group) => [group.slotKey, choices[group.slotKey]]));
    try {
      const preview = await fetchJson<StockBomPreview>(`/api/v1/resources/${family.primary.id}/assembly-configuration?selection=${encodeURIComponent(JSON.stringify(configuration))}`);
      if (preview.existingResourceId === resourceId) onCurrent();
      else if (preview.existingResourceId) onSelect(preview.existingResourceId);
      else onVirtual({ primaryId: family.primary.id, configuration, preview });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("workspace.loadError")); }
    finally { setResolving(false); }
  };
  return <section className="mb-5 overflow-hidden rounded-2xl border border-border bg-surface" aria-label={t("workspace.variants")}>
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><h2 className="font-semibold">{t("workspace.variants")}</h2><p className="mt-1 text-xs text-muted">{t("workspace.total", { count: family.summary.totalQuantity })}</p></div>
      <Button variant={allSelected ? "primary" : "secondary"} size="sm" onClick={onAll} aria-pressed={allSelected}>{t("workspace.allVariants")}</Button>
    </div>
    {family.variants.length > 6 ? <div className="px-4 pb-3"><input type="search" className={inputClass} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={t("workspace.searchVariants")} aria-label={t("workspace.searchVariants")} /></div> : null}
    {family.variants.length ? <table className="w-full text-sm">
      <thead className="border-y border-border bg-surface-subtle text-xs text-muted"><tr><th scope="col" className="px-4 py-2 text-left">{t("workspace.variant")}</th><th scope="col" className="px-4 py-2 text-right">{t("resource.metrics.available")}</th><th scope="col" className="px-4 py-2 text-right">{t("workspace.buildable")}</th></tr></thead>
      <tbody>{visible.map((member) => <tr key={member.id} className={!allSelected && !virtualSelected && member.id === resourceId ? "bg-brand-soft text-brand" : "border-b border-border hover:bg-surface-hover"}>
        <th scope="row" className="text-left font-medium"><Link href={`/inventory/${member.id}/stock?tab=${detailTab}`} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onSelect(member.id); }} aria-current={!allSelected && !virtualSelected && member.id === resourceId ? "true" : undefined} className="block px-4 py-3">{member.name}</Link></th>
        <td className="px-4 py-3 text-right tabular-nums">{member.quantity}</td><td className="px-4 py-3 text-right tabular-nums">{buildable[member.id] ?? "—"}</td>
      </tr>)}</tbody>
    </table> : null}
    {!visible.length && query ? <p className="p-4 text-sm text-muted">{t("workspace.noMatches")}</p> : null}
    {members.length > 20 ? <div className="flex items-center justify-end gap-3 p-3"><Button size="sm" variant="secondary" disabled={!page} onClick={() => setPage(page - 1)}>{t("workspace.previous")}</Button><span>{page + 1} / {Math.ceil(members.length / 20)}</span><Button size="sm" variant="secondary" disabled={(page + 1) * 20 >= members.length} onClick={() => setPage(page + 1)}>{t("workspace.next")}</Button></div> : null}
    <p className="px-4 py-3 text-xs text-muted">{t("workspace.sharedComponents")}</p>
    {family.summary.primaryQuantity !== 0 ? <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-warning-soft px-4 py-3 text-sm"><span>{t("workspace.unassigned", { count: family.summary.primaryQuantity })}</span><Link href={`/inventory/${family.primary.id}/stock?unitView=1`} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onSelect(family.primary.id); }} className="font-semibold underline">{t("workspace.review")}</Link></div> : null}
    {groups.length ? <details className="border-t border-border p-4" open={virtualSelected || !family.variants.length}>
      <summary className="cursor-pointer text-sm font-semibold">{t("workspace.chooseConfiguration")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{groups.map((group) => <label key={group.slotKey} className="text-xs font-medium">{group.name}<select value={choices[group.slotKey] ?? ""} className={`${inputClass} mt-1`} onChange={(event) => setChoices((previous) => ({ ...previous, [group.slotKey]: event.target.value }))}><option value="">{t("workspace.choose")}</option>{group.choices.map((choice) => <option key={choice.resourceId} value={choice.resourceId}>{choice.name}</option>)}</select></label>)}</div>
      <p className="my-3 text-xs text-muted">{t("workspace.virtualHelp")}</p>
      <Button size="sm" disabled={resolving || groups.some((group) => !choices[group.slotKey])} onClick={() => void chooseConfiguration()}>{t("workspace.selectConfiguration")}</Button>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </details> : null}
  </section>;
}
