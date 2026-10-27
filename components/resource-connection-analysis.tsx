"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";
import { Activity, AlertTriangle, ArrowUpRight, Boxes, CheckCircle2, CircleDollarSign, GitCompareArrows, LoaderCircle, Network, RefreshCw, X } from "lucide-react";
import { Button, cn } from "@/components/ui";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { ResourceTitle } from "@/components/resource-title";
import { connectionAncestors, connectionBuildable, connectionCostReport, connectionQuality, compareConnectionVariants, planConnectionProduction,
  type AnalysisData, type AnalysisIssue, type AnalysisMode } from "@/lib/connection-analysis";
import { loadConnectionAnalysis, loadConnectionDependencies, type DependencyData } from "@/lib/connection-analysis-loader";
import type { ConnectionDiagramResource } from "@/lib/resource-connection-diagram";

export type AnalysisPresentation = { ids: ReadonlySet<string> | null; badges: ReadonlyMap<string, { label: string; warning: boolean }> };
const modes = ["structure", "build", "dependencies", "compare", "cost", "quality"] as const;
const icons = { structure: Network, build: Boxes, dependencies: Activity, compare: GitCompareArrows, cost: CircleDollarSign, quality: AlertTriangle };

export function ConnectionAnalysisTabs({ mode, onChange, canViewStock }: { mode: AnalysisMode; onChange: (mode: AnalysisMode) => void; canViewStock: boolean }) {
  const { t } = useT("resource");
  return <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-5 py-3" role="group" aria-label={t("connectionDiagram.analysis.title")}>
    {modes.filter(value => value !== "build" || canViewStock).map(value => {
      const Icon = icons[value];
      return <button key={value} type="button" aria-pressed={mode === value} onClick={() => onChange(value)}
        className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-focus",
          mode === value ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-muted hover:text-foreground")}>
        <Icon className="size-3.5" aria-hidden="true" />{t(`connectionDiagram.analysis.modes.${value}`)}
      </button>;
    })}
  </div>;
}

export function ResourceConnectionAnalysis({ mode, root, family, focus, canViewStock, onFocus, onPresentation, onClose }: {
  mode: Exclude<AnalysisMode, "structure">; root: ConnectionDiagramResource; family: ConnectionDiagramResource[];
  focus: ConnectionDiagramResource | null; canViewStock: boolean;
  onFocus: (resource: ConnectionDiagramResource | null) => void;
  onPresentation: (presentation: AnalysisPresentation) => void; onClose: () => void;
}) {
  const { t, i18n } = useT("resource");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const [data, setData] = useState<AnalysisData | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [quantities, setQuantities] = useState<ReadonlyMap<string, number>>(() => new Map([[root.id, 1]]));
  const [selectedVariants, setSelectedVariants] = useState<ReadonlySet<string>>(() => new Set(family.map(item => item.id)));
  const [dependencies, setDependencies] = useState<DependencyData | null>(null);
  const [dependenciesBusy, setDependenciesBusy] = useState(false);
  const familyKey = JSON.stringify(family);
  const selected = focus ?? root;

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("resource-bom-changed", refresh);
    window.addEventListener("resource-family-changed", refresh);
    return () => {
      window.removeEventListener("resource-bom-changed", refresh);
      window.removeEventListener("resource-family-changed", refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setFailed(false); setData(null);
    void loadConnectionAnalysis(JSON.parse(familyKey), canViewStock, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setData(result); setUpdatedAt(new Date()); } })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [familyKey, canViewStock, revision]);

  useEffect(() => {
    if (mode !== "dependencies") return;
    const controller = new AbortController();
    setDependencies(null); setDependenciesBusy(true);
    void loadConnectionDependencies(selected, controller.signal)
      .then(result => { if (!controller.signal.aborted) setDependencies(result); })
      .catch(() => { if (!controller.signal.aborted) setDependencies({ resources: [selected], edges: [], incomplete: true }); })
      .finally(() => { if (!controller.signal.aborted) setDependenciesBusy(false); });
    return () => controller.abort();
  }, [mode, selected, revision]);

  const familyIds = useMemo(() => family.map(item => item.id), [family]);
  const plan = useMemo(() => data ? planConnectionProduction(data, quantities) : null, [data, quantities]);
  const capacities = useMemo(() => data && mode === "build" ? new Map(familyIds.map(id => [id, connectionBuildable(data, id)])) : new Map(), [data, familyIds, mode]);
  const comparison = useMemo(() => data ? compareConnectionVariants(data, familyIds.filter(id => selectedVariants.has(id))) : [], [data, familyIds, selectedVariants]);
  const costs = useMemo(() => data ? connectionCostReport(data, selected.id) : null, [data, selected.id]);
  const quality = useMemo(() => data ? connectionQuality(data, familyIds) : [], [data, familyIds]);
  const presentation = useMemo<AnalysisPresentation>(() => {
    const badges = new Map<string, { label: string; warning: boolean }>();
    let ids: Set<string> | null = null;
    if (data) {
      if (mode === "build" && plan) {
        const shortages = plan.rows.filter(row => row.missing === null || row.missing > 0);
        ids = connectionAncestors(data.nodes, shortages.map(row => row.resourceId));
        if (!shortages.length && !onlyIssues) ids = new Set([...plan.rows.map(row => row.resourceId), ...[...quantities].filter(([,q]) => q > 0).map(([id]) => id)]);
        for (const row of plan.rows) badges.set(row.resourceId, { label: row.missing === null ? t("connectionDiagram.analysis.unknown") : row.missing > 0
          ? t("connectionDiagram.analysis.missingCount", { count: number.format(row.missing) })
          : row.toBuild > 0 ? t("connectionDiagram.analysis.buildCount", { count: number.format(row.toBuild) })
          : t("connectionDiagram.analysis.covered"), warning: row.missing === null || row.missing > 0 });
      } else if (mode === "dependencies" && dependencies) {
        ids = new Set(dependencies.resources.map(item => item.id));
        dependencies.resources.filter(item => item.id !== selected.id).forEach(item => badges.set(item.id, { label: t("connectionDiagram.analysis.affected"), warning: false }));
      } else if (mode === "compare") {
        ids = new Set([...selectedVariants]);
        comparison.filter(row => !onlyIssues || row.different || row.unknown).forEach(row => row.cells.forEach(cell => cell.forEach(item => {
          ids!.add(item.resourceId); badges.set(item.resourceId, { label: t(`connectionDiagram.analysis.${row.unknown ? "unknown" : row.different ? "different" : "common"}`), warning: row.unknown || row.different });
        })));
      } else if (mode === "cost" && costs) {
        ids = new Set([selected.id, ...costs.rows.map(row => row.resourceId)]);
        costs.rows.forEach(row => badges.set(row.resourceId, { label: costs.currency && row.known ? new Intl.NumberFormat(locale, { style: "currency", currency: costs.currency }).format(row.amount / 100) + (row.complete ? "" : " *") : "—", warning: !row.complete }));
      } else if (mode === "quality") {
        ids = connectionAncestors(data.nodes, quality.map(issue => issue.resourceId));
        quality.forEach(issue => badges.set(issue.resourceId, { label: t(`connectionDiagram.analysis.issues.${issue.code}`), warning: true }));
      }
    }
    if (data && focus && ids && (mode === "build" || mode === "quality" || mode === "compare")) {
      const branch = connectionAncestors(data.nodes, [focus.id]);
      ids = new Set([...ids].filter(id => branch.has(id)));
      ids.add(focus.id);
    }
    return { ids, badges };
  }, [data, mode, plan, dependencies, selected.id, focus, quantities, comparison, selectedVariants, costs, quality, onlyIssues, locale, number, t]);
  useEffect(() => { onPresentation(presentation); }, [onPresentation, presentation]);

  const lookup = (id: string): ConnectionDiagramResource => data?.nodes.get(id)?.resource ?? family.find(item => item.id === id) ?? { id, name: id };
  const focusButton = (item: ConnectionDiagramResource) => <button type="button" className="text-left font-medium text-foreground hover:text-brand hover:underline" onClick={() => onFocus(item)}><ResourceTitle resource={item} /></button>;
  const issueList = (issues: AnalysisIssue[]) => <ul className="space-y-2">{issues.map((issue, index) => <li key={`${issue.code}:${issue.resourceId}:${index}`} className="rounded-lg border border-warning-border bg-warning-soft p-3 text-xs">
    {focusButton(lookup(issue.resourceId))}<p className="mt-1 text-muted-strong">{t(`connectionDiagram.analysis.issues.${issue.code}`)}</p>
    {issue.relatedId ? <p className="mt-1 text-muted">{lookup(issue.relatedId).name}</p> : null}
  </li>)}</ul>;
  const money = (amount: number) => costs?.currency ? new Intl.NumberFormat(locale, { style: "currency", currency: costs.currency }).format(amount / 100) : "—";
  const incomplete = data && (data.truncated || [...data.nodes.values()].some(node => node.components === null));
  const tableClass = "w-full text-left text-xs [&_th]:pb-2 [&_th]:font-medium [&_th]:text-muted [&_td]:border-t [&_td]:border-border [&_td]:py-2.5 [&_td]:pr-2";

  return <aside className="order-first min-w-0 border-b border-border bg-surface xl:order-last xl:border-b-0 xl:border-l" aria-label={t("connectionDiagram.analysis.title")}>
    <div className="flex items-start justify-between gap-2 border-b border-border p-4">
      <div><h3 className="text-sm font-semibold">{t(`connectionDiagram.analysis.modes.${mode}`)}</h3><p className="mt-1 text-xs leading-5 text-muted">{t(`connectionDiagram.analysis.descriptions.${mode}`)}</p></div>
      <button type="button" onClick={onClose} aria-label={t("connectionDiagram.analysis.close")} className="rounded-lg p-1.5 text-muted hover:bg-surface-muted"><X className="size-4" /></button>
    </div>
    <div className="max-h-[850px] space-y-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>{updatedAt ? t("connectionDiagram.analysis.updated", { time: updatedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) }) : t("connectionDiagram.analysis.loading")}</span>
        <button type="button" onClick={() => setRevision(value => value + 1)} disabled={busy} aria-label={t("connectionDiagram.analysis.refresh")} className="rounded-lg p-1.5 hover:bg-surface-muted disabled:opacity-40"><RefreshCw className={cn("size-3.5", busy && "animate-spin")} /></button>
      </div>
      {focus ? <div className="flex items-center gap-2 rounded-lg bg-brand-soft p-2 text-xs text-brand"><span className="min-w-0 flex-1">{t("connectionDiagram.analysis.focus")}: <ResourceTitle resource={focus} /></span><Link href={`/inventory/${focus.id}`} aria-label={t("connectionDiagram.openItem", { name: focus.name })} className="shrink-0 rounded p-1 hover:bg-surface-muted"><ArrowUpRight className="size-3.5" /></Link><button type="button" aria-label={t("connectionDiagram.analysis.clearFocus")} onClick={() => onFocus(null)}><X className="size-3.5" /></button></div> : null}
      {busy ? <p role="status" className="flex items-center gap-2 py-5 text-xs text-muted"><LoaderCircle className="size-4 animate-spin" />{t("connectionDiagram.analysis.loading")}</p> : null}
      {failed ? <p role="alert" className="text-sm text-danger">{t("connectionDiagram.analysis.failed")}</p> : null}
      {incomplete ? <p className="rounded-lg bg-warning-soft p-3 text-xs leading-5 text-warning">{t("connectionDiagram.analysis.incomplete")}</p> : null}
      {data && !busy ? <>
        {(mode === "build" || mode === "compare") ? <label className="flex items-center gap-2 text-xs text-muted-strong"><input type="checkbox" checked={onlyIssues} onChange={event => setOnlyIssues(event.target.checked)} />{t("connectionDiagram.analysis.onlyIssues")}</label> : null}
        {mode === "build" && plan ? <>
          <div className="space-y-3">{family.map(item => <label key={item.id} className="flex items-center gap-3 text-xs">
            <span className="min-w-0 flex-1"><span className="block font-medium"><ResourceTitle resource={item} /></span><span className="mt-1 block text-muted">{t("connectionDiagram.analysis.capacity", { count: capacities.get(item.id) === null ? "—" : (capacities.get(item.id) === 1_000_000 ? "≥ " : "") + number.format(capacities.get(item.id) ?? 0) })}</span></span>
            <input aria-label={t("connectionDiagram.analysis.quantityFor", { name: item.name })} className="w-20 rounded-lg border border-border bg-surface px-2 py-2 text-right" type="number" min={0} max={1_000_000} step={1} value={quantities.get(item.id) ?? 0}
              onChange={event => setQuantities(previous => new Map(previous).set(item.id, Math.min(1_000_000, Math.max(0, Math.floor(Number(event.target.value) || 0)))))} />
          </label>)}</div>
          <details className="text-[11px] leading-5 text-muted"><summary className="cursor-pointer font-semibold">{t("connectionDiagram.analysis.basis")}</summary><p className="mt-1">{t("connectionDiagram.analysis.planBasis")}</p></details>
          <div role="status" className={cn("rounded-xl p-3", plan.feasible ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
            <p className="flex items-center gap-2 text-sm font-semibold">{plan.feasible ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}{t(`connectionDiagram.analysis.${![...quantities.values()].some(q => q > 0) ? "enterPlan" : !plan.complete ? "planIncomplete" : plan.feasible ? "planReady" : "planShort"}`)}</p>
            {plan.shortages.length ? <p className="mt-1 text-xs">{t("connectionDiagram.analysis.shortageCount", { count: plan.shortages.length })}</p> : null}
          </div>
          <div className="overflow-x-auto"><table className={tableClass}><thead><tr><th>{t("connectionDiagram.analysis.part")}</th><th>{t("connectionDiagram.analysis.required")}</th><th>{t("connectionDiagram.analysis.available")}</th><th>{t("connectionDiagram.analysis.missing")}</th></tr></thead><tbody>
            {plan.rows.filter(row => !onlyIssues || row.missing === null || row.missing > 0).map(row => <tr key={row.resourceId} className={cn(focus?.id === row.resourceId && "bg-brand-soft")}><td>{focusButton(lookup(row.resourceId))}<span className="mt-1 block text-[10px] text-muted">{row.unit}{row.reserved ? ` · ${t("connectionDiagram.analysis.reserved", { count: number.format(row.reserved) })}` : ""}{row.toBuild ? ` · ${t("connectionDiagram.analysis.buildCount", { count: number.format(row.toBuild) })}` : ""}</span></td><td>{number.format(row.required)}</td><td>{row.available === null ? "—" : number.format(row.available)}</td><td className={row.missing ? "font-semibold text-danger" : "text-muted"}>{row.missing === null ? "?" : number.format(row.missing)}</td></tr>)}
          </tbody></table></div>
          {plan.issues.length ? issueList(plan.issues) : null}
        </> : null}
        {mode === "dependencies" ? <>
          <p className="text-sm font-semibold"><ResourceTitle resource={selected} /></p>
          {dependenciesBusy ? <p role="status" className="text-xs text-muted">{t("connectionDiagram.analysis.loading")}</p> : dependencies ? <>
            <p className="text-2xl font-semibold">{dependencies.resources.filter(item => item.id !== selected.id).length}<span className="ml-2 text-xs font-normal text-muted">{t("connectionDiagram.analysis.affectedItems")}</span></p>
            <p className="text-[11px] leading-5 text-muted">{t("connectionDiagram.analysis.dependencyScope")}</p>
            {dependencies.incomplete ? <p className="text-xs text-warning">{t("connectionDiagram.analysis.incomplete")}</p> : null}
            <ul className="space-y-2">{dependencies.resources.filter(item => item.id !== selected.id).map(item => <li key={item.id} className="rounded-lg border border-border p-3 text-xs">
              <div className="flex items-start justify-between gap-2">{focusButton(item)}<Link href={`/inventory/${item.id}`} aria-label={t("connectionDiagram.openItem", { name: item.name })}><ArrowUpRight className="size-3.5 text-muted" /></Link></div>
              <p className="mt-1 text-muted">{t(`connectionDiagram.analysis.${dependencies.edges.some(edge => edge.from === selected.id && edge.to === item.id) ? "direct" : "indirect"}`)}</p>
            </li>)}</ul>
            {dependencies.resources.length === 1 && !dependencies.incomplete ? <p className="text-xs text-muted">{t("connectionDiagram.analysis.noParents")}</p> : null}
          </> : null}
        </> : null}
        {mode === "compare" ? <>
          <div className="space-y-2">{family.map(item => <label key={item.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedVariants.has(item.id)} onChange={event => setSelectedVariants(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /><ResourceTitle resource={item} /></label>)}</div>
          {selectedVariants.size < 2 ? <p className="text-xs text-muted">{t("connectionDiagram.analysis.selectTwo")}</p> : <>
            <p className="text-xs text-muted">{t("connectionDiagram.analysis.compareSummary", { common: comparison.filter(row => !row.different && !row.unknown).length, different: comparison.filter(row => row.different).length })}</p>
            <div className="overflow-x-auto"><table className={tableClass}><thead><tr>{family.filter(item => selectedVariants.has(item.id)).map(item => <th key={item.id} className="min-w-36 pr-3"><ResourceTitle resource={item} /></th>)}</tr></thead><tbody>
              {comparison.filter(row => !onlyIssues || row.different || row.unknown).map(row => <tr key={row.key} className={row.different ? "bg-warning-soft/50" : ""}>{family.filter(item => selectedVariants.has(item.id)).map(item => <td key={item.id} className="align-top">
                {data.nodes.get(item.id)?.components == null ? "?" : row.cells.get(item.id)?.map(component => <div key={component.resourceId}>{focusButton(lookup(component.resourceId))}<p className="mt-1 text-muted">{number.format(component.quantityPerAssembly)} {component.unitName ?? ""}</p></div>) ?? "—"}
              </td>)}</tr>)}
            </tbody></table></div>
            <p className="text-[11px] leading-5 text-muted">{t("connectionDiagram.analysis.compareBasis")}</p>
          </>}
        </> : null}
        {mode === "cost" && costs ? <>
          <label className="block text-xs text-muted">{t("connectionDiagram.analysis.costItem")}<select aria-label={t("connectionDiagram.analysis.costItem")} value={selected.id} onChange={event => onFocus(lookup(event.target.value))} className="mt-1.5 w-full rounded-lg border border-border bg-surface p-2 text-foreground">
            {[...data.nodes.values()].map(node => <option key={node.resource.id} value={node.resource.id}>{node.resource.name}{node.resource.subtitle ? ` · ${node.resource.subtitle}` : ""}</option>)}
          </select></label>
          <div className="rounded-xl bg-surface-muted p-3"><p className="text-xs text-muted">{t(`connectionDiagram.analysis.${costs.rows.length ? "componentTotal" : "unitPrice"}`)}</p><p className="mt-1 text-2xl font-semibold">{costs.rows.length ? costs.known ? money(costs.total) : "—" : costs.unitPrice === null ? "—" : money(costs.unitPrice)}</p>{!costs.complete ? <p className="mt-1 text-xs text-warning">{t("connectionDiagram.analysis.costIncomplete")}</p> : null}</div>
          <details className="text-[11px] leading-5 text-muted"><summary className="cursor-pointer font-semibold">{t("connectionDiagram.analysis.basis")}</summary><p className="mt-1">{t("connectionDiagram.analysis.costBasis")}</p></details>
          <ul className="space-y-3">{costs.rows.map(row => <li key={row.resourceId} className="text-xs"><div className="flex items-start justify-between gap-2">{focusButton(lookup(row.resourceId))}<span className="shrink-0 font-semibold">{row.known ? money(row.amount) : "—"}{!row.complete ? " *" : ""}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-brand-solid" style={{ width: `${costs.total > 0 ? Math.max(0, row.amount / costs.total * 100) : 0}%` }} /></div>
            <p className="mt-1 text-[11px] text-muted">{number.format(row.quantity)} × {row.quantity > 0 && row.known ? money(row.amount / row.quantity) : "—"} · {costs.total > 0 ? `${number.format(row.amount / costs.total * 100)} %` : "—"} · {t(`connectionDiagram.analysis.${row.rolledUp ? "rolledUp" : "storedPrice"}`)}</p>
          </li>)}</ul>
          {costs.issues.length ? issueList(costs.issues) : null}
          {family.length > 1 ? <div className="border-t border-border pt-3"><h4 className="mb-2 text-xs font-semibold">{t("connectionDiagram.analysis.variantCosts")}</h4><ul className="space-y-2">{family.map(item => { const report = connectionCostReport(data, item.id); const reference = connectionCostReport(data, root.id); const delta = report.complete && reference.complete && report.currency === reference.currency ? report.total - reference.total : null;
            return <li key={item.id} className="flex justify-between gap-2 text-xs">{focusButton(item)}<span className="shrink-0 text-muted">{report.currency && report.known ? new Intl.NumberFormat(locale, { style: "currency", currency: report.currency }).format(report.total / 100) : "—"}{report.complete ? "" : " *"}{delta !== null && item.id !== root.id ? ` (${delta >= 0 ? "+" : ""}${new Intl.NumberFormat(locale, { style: "currency", currency: report.currency! }).format(delta / 100)})` : ""}</span></li>; })}</ul><p className="mt-2 text-[11px] text-muted">{t("connectionDiagram.analysis.deltaTo", { name: root.name })}</p></div> : null}
        </> : null}
        {mode === "quality" ? <>
          <div className="flex items-center gap-2 text-sm font-semibold">{quality.length || incomplete ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}{t("connectionDiagram.analysis.findings", { count: quality.length })}</div>
          <p className="text-[11px] leading-5 text-muted">{t("connectionDiagram.analysis.qualityBasis")}</p>
          {quality.length ? issueList(quality) : <p className="text-xs text-muted">{t("connectionDiagram.analysis.noFindings")}</p>}
        </> : null}
        <p className="border-t border-border pt-3 text-[11px] leading-5 text-muted">{t("connectionDiagram.analysis.readOnly")}</p>
      </> : null}
      {failed ? <Button variant="secondary" size="sm" onClick={() => setRevision(value => value + 1)}>{t("connectionDiagram.retry")}</Button> : null}
    </div>
  </aside>;
}
