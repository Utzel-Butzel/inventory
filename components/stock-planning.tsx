"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";
import { ArrowRight, CalendarClock, RefreshCw, Settings2, TrendingDown } from "lucide-react";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { Badge, Button, Card } from "@/components/ui";
import { Input } from "@/components/form-controls";
import { ResourceTitle } from "@/components/resource-title";
import { fetchJson } from "@/lib/client-types";
import {
  DEFAULT_PLANNING_OPTIONS, PLANNING_STATUS_PRIORITY, planStock,
  type PlanningInput, type PlanningOptions, type PlanningStatus, type StockPlan,
} from "@/lib/stock-planning";

type Payload = { generatedAt: string; items: PlanningInput[] };
const tones = { critical: "danger", order: "warning", soon: "brand", review: "neutral", healthy: "success" } as const;
const statuses: PlanningStatus[] = ["critical", "order", "soon", "review", "healthy"];

function Projection({ item }: { item: StockPlan }) {
  const { t } = useT("stock");
  const max = Math.max(1, item.safetyStock, ...item.timeline.map((point) => point.quantity));
  const min = Math.min(0, ...item.timeline.map((point) => point.quantity));
  const y = (quantity: number) => 12 + (max - quantity) / (max - min) * 100;
  const points = item.timeline.map((point) => `${12 + point.day / 180 * 576},${y(point.quantity)}`).join(" ");
  return <figure className="rounded-xl bg-surface-muted p-4">
    <figcaption className="mb-2 text-xs font-medium text-muted">{t("planning.chartTitle")}</figcaption>
    <svg viewBox="0 0 600 142" role="img" aria-label={t("planning.chartLabel")} className="w-full">
      <line x1="12" y1={y(0)} x2="588" y2={y(0)} stroke="currentColor" className="text-muted" strokeWidth="1" />
      <line x1="12" y1={y(item.safetyStock)} x2="588" y2={y(item.safetyStock)} stroke="currentColor" className="text-warning" strokeDasharray="5 5" />
      <polyline points={points} fill="none" stroke="currentColor" className={item.status === "critical" ? "text-danger" : "text-brand"} strokeWidth="2.5" />
      {[0, 30, 60, 90, 120, 150, 180].map((day) => <text key={day} x={12 + day / 180 * 576} y="137" textAnchor={day === 0 ? "start" : day === 180 ? "end" : "middle"} fill="currentColor" className="text-muted" fontSize="11">{day}</text>)}
    </svg>
    <p className="text-xs text-muted">{t("planning.chartLegend")}</p>
  </figure>;
}

export function StockPlanning() {
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlanningStatus | "all">("all");
  const [sort, setSort] = useState("priority");
  const [page, setPage] = useState(0);
  const [options, setOptions] = useState<PlanningOptions>(DEFAULT_PLANNING_OPTIONS);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
  useEffect(() => {
    const controller = new AbortController();
    fetchJson<Payload>("/api/v1/stock/forecast", { cache: "no-store", signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setPayload(data); setError(false); } })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const plans = useMemo(() => payload ? payload.items.map((item) => planStock(item, new Date(payload.generatedAt), options)) : [], [payload, options]);
  const filtered = useMemo(() => plans.filter((item) => (filter === "all" || item.status === filter)
    && `${item.name} ${item.subtitle} ${item.sku ?? ""}`.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, locale)
      : sort === "stockout" ? (a.stockoutDay ?? Infinity) - (b.stockoutDay ?? Infinity)
      : PLANNING_STATUS_PRIORITY[a.status] - PLANNING_STATUS_PRIORITY[b.status]
        || (a.reorderInDays ?? Infinity) - (b.reorderInDays ?? Infinity)) || a.name.localeCompare(b.name, locale)), [plans, filter, query, locale, sort]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 20) - 1));
  const updateOption = (key: keyof PlanningOptions, value: string) => { setOptions((current) => ({ ...current, [key]: Number(value) })); setPage(0); };
  return <main className="app-page mx-auto w-full max-w-[1540px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 flex items-center gap-2 text-sm font-medium text-brand"><TrendingDown className="size-4" />{t("planning.eyebrow")}</p><h1 className="text-3xl font-semibold tracking-tight">{t("planning.title")}</h1><p className="mt-2 max-w-2xl text-sm text-muted">{t("planning.description")}</p></div>
      <Button variant="secondary" disabled={loading} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}><RefreshCw className="size-4" />{t("planning.refresh")}</Button>
    </header>
    <Card className="p-5">
      <div className="flex flex-wrap items-end gap-5">
        <label className="grid gap-2 text-sm font-medium">{t("planning.safetyDays")}<select className="rounded-lg border border-border bg-surface p-2" value={options.safetyDays} onChange={(event) => updateOption("safetyDays", event.target.value)}>{[0, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{t("planning.days", { value: days })}</option>)}</select></label>
        <label className="grid gap-2 text-sm font-medium">{t("planning.coverageDays")}<select className="rounded-lg border border-border bg-surface p-2" value={options.coverageDays} onChange={(event) => updateOption("coverageDays", event.target.value)}>{[14, 30, 60, 90].map((days) => <option key={days} value={days}>{t("planning.days", { value: days })}</option>)}</select></label>
        <label className="grid gap-2 text-sm font-medium">{t("planning.demandScenario")}<select className="rounded-lg border border-border bg-surface p-2" value={options.demandMultiplier} onChange={(event) => updateOption("demandMultiplier", event.target.value)}>{[0.5, 1, 1.5, 2].map((value) => <option key={value} value={value}>{value * 100}%</option>)}</select></label>
        <p className="max-w-lg text-xs leading-relaxed text-muted">{t("planning.scenarioHint")}</p>
      </div>
    </Card>
    {loading && <p role="status" className="text-sm text-muted">{t("planning.loading")}</p>}
    {error && !loading && <Card className="border-danger-border p-6"><p role="alert">{t("planning.error")}</p></Card>}
    {payload && !error && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label={t("planning.filter")}>
        {statuses.map((status) => <button type="button" key={status} aria-pressed={filter === status} onClick={() => { setFilter(filter === status ? "all" : status); setPage(0); }} className={`rounded-2xl border bg-surface p-4 text-left transition hover:border-brand ${filter === status ? "border-brand ring-1 ring-brand" : "border-border"}`}><Badge tone={tones[status]}>{t(`planning.status.${status}`)}</Badge><p className="mt-3 text-3xl font-semibold tabular-nums">{plans.filter((item) => item.status === status).length}</p><p className="mt-1 text-xs text-muted">{t(`planning.statusHint.${status}`)}</p></button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="min-w-48 flex-1" aria-label={t("planning.search")} placeholder={t("planning.search")} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
        <label className="flex items-center gap-2 text-sm text-muted">{t("planning.sort")}<select className="rounded-lg border border-border bg-surface p-2 text-foreground" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}>{["priority", "stockout", "name"].map((value) => <option key={value} value={value}>{t(`planning.sorts.${value}`)}</option>)}</select></label>
        {filter !== "all" && <Button variant="ghost" onClick={() => { setFilter("all"); setPage(0); }}>{t("planning.showAll")}</Button>}
      </div>
      <p className="text-xs text-muted" aria-live="polite">{t("planning.results", { count: filtered.length, total: plans.length })} · {t("planning.updated", { date: date(payload.generatedAt) })}</p>
      {filtered.length === 0 && <Card className="p-8 text-center"><p className="font-medium">{t(plans.length ? "planning.noMatches" : "planning.empty")}</p><p className="mt-2 text-sm text-muted">{t(plans.length ? "planning.noMatchesHint" : "planning.emptyHint")}</p></Card>}
      <div className="space-y-3">
        {filtered.slice(currentPage * 20, currentPage * 20 + 20).map((item) => <Card key={item.resourceId} className="overflow-hidden">
          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(180px,1.3fr)_minmax(0,2fr)_minmax(170px,1fr)]">
            <div><div className="mb-2 flex flex-wrap gap-2"><Badge tone={tones[item.status]}>{t(`planning.status.${item.status}`)}</Badge><span className="text-xs text-muted">{t(`planning.confidence.${item.confidence}`)}</span></div><Link href={`/inventory/${item.resourceId}/stock`} className="font-semibold hover:text-brand"><ResourceTitle resource={item} /></Link>{item.sku && <p className="mt-1 text-xs text-muted">{item.sku}</p>}<p className="mt-2 text-sm">{t("planning.onHand", { value: number.format(item.quantity), unit: item.unitName })}</p>{item.overdueQuantity > 0 && <p className="mt-1 text-xs font-medium text-warning">{t("planning.overdueShort", { value: number.format(item.overdueQuantity) })}</p>}{item.undatedQuantity > 0 && <p className="mt-1 text-xs text-warning">{t("planning.undatedShort", { value: number.format(item.undatedQuantity) })}</p>}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted">{t("planning.runout")}</dt><dd className="mt-1 font-semibold">{item.stockoutAt ? date(item.stockoutAt) : item.dailyUsage > 0 ? t("planning.beyondHorizon") : t("planning.unknown")}</dd><dd className="mt-1 text-xs text-muted">{item.stockoutDay !== null ? t("planning.days", { value: Math.floor(item.stockoutDay) }) : t("planning.withDeliveries")}</dd></div>
              <div><dt className="text-xs text-muted">{t("planning.orderBy")}</dt><dd className="mt-1 font-semibold">{item.reorderInDays === 0 ? t("planning.today") : item.reorderAt ? date(item.reorderAt) : item.leadTimeKnown && item.dailyUsage > 0 ? t("planning.notYet") : t("planning.unknown")}</dd><dd className="mt-1 text-xs text-muted">{item.leadTimeKnown ? t("planning.leadTime", { value: item.leadTimeDays }) : t("planning.missingLeadTime")}</dd></div>
              <div><dt className="text-xs text-muted">{t("planning.dailyUsage")}</dt><dd className="mt-1 font-semibold">{item.dailyUsage > 0 ? `${number.format(item.dailyUsage)} ${item.unitName}` : t("planning.unknown")}</dd><dd className="mt-1 text-xs text-muted">{t("planning.incoming", { value: number.format(item.onOrder) })}</dd></div>
            </dl>
            <div className="space-y-2"><p className="text-sm font-medium">{t(`planning.action.${item.status}`)}</p>{item.suggestedQuantity > 0 && <p className="text-sm text-muted">{t("planning.suggestion", { value: number.format(item.suggestedQuantity), unit: item.unitName })}{item.purchaseUnitName ? ` (${number.format(item.suggestedPurchaseQuantity)} ${item.purchaseUnitName})` : ""}</p>}<Link href={`/operations/purchases?resourceId=${item.resourceId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">{t("planning.purchases")}<ArrowRight className="size-4" /></Link></div>
          </div>
          <details className="border-t border-border">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-muted">{t("planning.details")}</summary>
            <div className="grid gap-5 px-5 pb-5 lg:grid-cols-2">
              {item.dailyUsage > 0 ? <Projection item={item} /> : <div className="rounded-xl bg-surface-muted p-5 text-sm text-muted">{t("planning.noHistory")}</div>}
              <div className="space-y-3 text-sm text-muted">
                <p>{t("planning.evidence", { days: Math.floor(item.observedDays), events: item.demandDays, average: number.format(item.averageDailyUsage), recent: number.format(item.recentDailyUsage), unit: item.unitName })}</p>
                <p>{t("planning.threshold", { minimum: number.format(item.minimumStock), safety: number.format(item.safetyStock), unit: item.unitName })}</p>
                {item.confidence === "low" && <p className="text-warning">{t("planning.lowConfidence")}</p>}
                {!item.leadTimeKnown && <p className="text-warning">{t("planning.missingLeadTimeHint")}</p>}
                {item.overdueQuantity > 0 && <p className="text-warning">{t("planning.overdue", { value: number.format(item.overdueQuantity), unit: item.unitName })}</p>}
                {item.undatedQuantity > 0 && <p className="text-warning">{t("planning.undated", { value: number.format(item.undatedQuantity), unit: item.unitName })}</p>}
                {item.nextExpectedAt && <p className="flex items-center gap-2"><CalendarClock className="size-4" />{t("planning.nextDelivery", { date: date(item.nextExpectedAt) })}</p>}
                <Link href={`/inventory/${item.resourceId}/stock/settings`} className="inline-flex items-center gap-2 font-medium text-brand hover:underline"><Settings2 className="size-4" />{t("planning.settings")}</Link>
              </div>
            </div>
          </details>
        </Card>)}
      </div>
      {filtered.length > 20 && <nav aria-label={t("planning.pagination")} className="flex items-center justify-center gap-4"><Button variant="secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("planning.previous")}</Button><span className="text-sm">{currentPage + 1} / {Math.ceil(filtered.length / 20)}</span><Button variant="secondary" disabled={(currentPage + 1) * 20 >= filtered.length} onClick={() => setPage(currentPage + 1)}>{t("planning.next")}</Button></nav>}
    </>}
    <details className="rounded-xl border border-border p-5 text-sm text-muted"><summary className="cursor-pointer font-medium text-foreground">{t("planning.methodTitle")}</summary><div className="mt-3 max-w-4xl space-y-3 leading-relaxed"><p>{t("planning.methodDemand")}</p><p>{t("planning.methodOrders")}</p><p>{t("planning.methodLimits")}</p></div></details>
  </main>;
}
