"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Package,
  PackageMinus,
  PackageX,
  QrCode,
  RefreshCw,
  Search,
  ShoppingCart,
  TrendingDown,
  Warehouse,
  Workflow,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { StockSectionNav } from "@/components/stock-section-nav";

type StockFilter = "all" | "low" | "out" | "healthy" | "incoming";
type StockState = "low" | "out" | "healthy";

type StockItem = {
  resourceId: string;
  name: string;
  type: string;
  quantity: number;
  onOrder: number;
  projectedQuantity: number;
  nextExpectedAt: string | null;
  minimumStock: number | null;
  trackingMode: string;
  averageDailyUsage: number | null;
  daysUntilStockout: number | null;
  predictedStockoutAt: string | null;
  reorderSuggested: boolean;
  unitName: string;
};

type StockMetrics = {
  trackedItems?: number;
  totalQuantity?: number;
  lowStock?: number;
  outOfStock?: number;
  healthy?: number;
  reorderSuggested?: number;
  totalOnOrder?: number;
  incomingItems?: number;
};

type StockPayload = {
  items: StockItem[];
  metrics?: Record<string, unknown>;
  aggregate?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  error?: string;
  [key: string]: unknown;
};

type DueInventoryCount = {
  resourceId: string;
  name: string;
  type: string;
  quantity: number;
  intervalDays: number;
  nextDueAt: string;
  lastCompletedAt: string | null;
};

const compactNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});

const filterLabels: Record<StockFilter, string> = {
  all: "All stock",
  low: "Low stock",
  out: "Out of stock",
  healthy: "Healthy",
  incoming: "Incoming",
};

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function readMetric(payload: StockPayload, keys: string[]) {
  const sources: Array<Record<string, unknown>> = [
    payload.metrics ?? {},
    payload.aggregate ?? {},
    payload.summary ?? {},
    payload,
  ];
  for (const source of sources) {
    for (const key of keys) {
      const value = finiteNumber(source[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function normalizeMetrics(payload: StockPayload): StockMetrics {
  return {
    trackedItems: readMetric(payload, ["trackedItems", "totalItems", "itemCount"]),
    totalQuantity: readMetric(payload, ["totalQuantity", "totalUnits", "onHand"]),
    lowStock: readMetric(payload, ["lowStock", "lowStockItems", "lowCount"]),
    outOfStock: readMetric(payload, ["outOfStock", "outOfStockItems", "outCount"]),
    healthy: readMetric(payload, ["healthy", "healthyItems", "healthyCount"]),
    reorderSuggested: readMetric(payload, [
      "reorderSuggested",
      "reorderSuggestedItems",
      "reorderCount",
    ]),
    totalOnOrder: readMetric(payload, ["totalOnOrder", "incomingQuantity"]),
    incomingItems: readMetric(payload, ["incomingItems", "itemsOnOrder"]),
  };
}

function itemState(item: StockItem): StockState {
  if (item.quantity <= 0) return "out";
  if (
    item.reorderSuggested ||
    (item.minimumStock !== null && item.quantity <= item.minimumStock)
  ) {
    return "low";
  }
  return "healthy";
}

function titleCase(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatQuantity(value: number, unitName: string) {
  const quantity = compactNumber.format(value);
  return unitName ? `${quantity} ${unitName}` : quantity;
}

function formatUsage(value: number | null, unitName: string) {
  if (value === null || value <= 0) return "No usage data";
  return `${compactNumber.format(value)} ${unitName || "units"}/day`;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function getErrorMessage(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return "Stock data could not be loaded.";
}

function Runway({ item, compact = false }: { item: StockItem; compact?: boolean }) {
  const days = item.daysUntilStockout;
  const predictedDate = formatDate(item.predictedStockoutAt);

  if (item.quantity <= 0) {
    return (
      <div className={cn("flex items-center gap-2", compact && "justify-between")}>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#b83243]">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          Out now
        </span>
        {predictedDate ? (
          <span className="text-[10px] text-[#a06b72]">Since {predictedDate}</span>
        ) : null}
      </div>
    );
  }

  if (days === null || !Number.isFinite(days)) {
    return (
      <div className={cn(compact && "flex items-center justify-between")}>
        <p className="text-[12px] font-medium text-[#68707c]">Not forecast</p>
        {!compact ? (
          <p className="mt-0.5 text-[10px] text-[#9aa0aa]">Add usage to calculate runway</p>
        ) : null}
      </div>
    );
  }

  const roundedDays = Math.max(0, Math.ceil(days));
  const urgent = days <= 7;
  const warning = days > 7 && days <= 30;
  const label = days < 1 ? "Less than a day" : `${roundedDays} ${roundedDays === 1 ? "day" : "days"}`;
  const color = urgent ? "text-[#b83243]" : warning ? "text-[#9b5300]" : "text-[#11734d]";
  const dot = urgent ? "bg-[#dd5262]" : warning ? "bg-[#e99b2d]" : "bg-[#20a36d]";

  return (
    <div className={cn(compact && "flex items-center justify-between gap-3")}>
      <p className={cn("flex items-center gap-1.5 text-[12px] font-semibold", color)}>
        <span className={cn("size-1.5 rounded-full", dot)} />
        {label}
      </p>
      {predictedDate ? (
        <p className={cn("text-[10px] text-[#9298a2]", !compact && "mt-0.5")}>Runs out {predictedDate}</p>
      ) : null}
    </div>
  );
}

function StockStatus({ item }: { item: StockItem }) {
  const state = itemState(item);
  if (state === "out") {
    return (
      <div>
        <Badge tone="danger">Out of stock</Badge>
        <p className="mt-1 text-[10px] font-medium text-[#b05b66]">Replenish now</p>
      </div>
    );
  }
  if (state === "low") {
    const shortage =
      item.minimumStock === null ? null : Math.max(0, item.minimumStock - item.quantity);
    return (
      <div>
        <Badge tone="warning">Low stock</Badge>
        <p className="mt-1 text-[10px] font-medium text-[#9b6a30]">
          {shortage && shortage > 0
            ? `${compactNumber.format(shortage)} below minimum`
            : "Reorder suggested"}
        </p>
      </div>
    );
  }
  return <Badge tone="success">Healthy</Badge>;
}

function StockLoading() {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="size-9 rounded-xl" />
            </div>
            <Skeleton className="mt-7 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
      </div>
      <Card className="p-3 sm:p-5">
        <Skeleton className="h-11 w-full rounded-xl" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </Card>
    </div>
  );
}

export function StockOverview() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [apiMetrics, setApiMetrics] = useState<StockMetrics>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [dueCounts, setDueCounts] = useState<DueInventoryCount[]>([]);

  const loadStock = useCallback(async (options?: { quiet?: boolean; signal?: AbortSignal }) => {
    if (options?.quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [response, dueResponse] = await Promise.all([
        fetch("/api/v1/stock", {
          cache: "no-store",
          signal: options?.signal,
        }),
        fetch("/api/v1/inventory-counts/due", {
          cache: "no-store",
          signal: options?.signal,
        }).catch(() => null),
      ]);
      const payload = (await response.json().catch(() => null)) as StockPayload | null;
      if (!response.ok || !payload) throw new Error(getErrorMessage(payload));
      if (!Array.isArray(payload.items)) {
        throw new Error("The stock service returned an unexpected response.");
      }
      setItems(payload.items);
      setApiMetrics(normalizeMetrics(payload));
      if (dueResponse?.ok) {
        const duePayload = (await dueResponse.json().catch(() => null)) as
          | { due?: DueInventoryCount[] }
          | null;
        setDueCounts(Array.isArray(duePayload?.due) ? duePayload.due : []);
      } else {
        setDueCounts([]);
      }
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Stock data could not be loaded.");
    } finally {
      if (!options?.signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStock({ signal: controller.signal });
    return () => controller.abort();
  }, [loadStock]);

  const derived = useMemo(() => {
    const counts = { low: 0, out: 0, healthy: 0 };
    let totalQuantity = 0;
    let reorderSuggested = 0;
    let totalOnOrder = 0;
    let incomingItems = 0;

    for (const item of items) {
      counts[itemState(item)] += 1;
      totalQuantity += item.quantity;
      if (item.reorderSuggested) reorderSuggested += 1;
      totalOnOrder += item.onOrder ?? 0;
      if ((item.onOrder ?? 0) > 0) incomingItems += 1;
    }

    return {
      ...counts,
      totalQuantity,
      reorderSuggested,
      totalOnOrder,
      incomingItems,
      trackedItems: items.length,
    };
  }, [items]);

  const metrics = {
    trackedItems: apiMetrics.trackedItems ?? derived.trackedItems,
    totalQuantity: apiMetrics.totalQuantity ?? derived.totalQuantity,
    low: apiMetrics.lowStock ?? derived.low,
    out: apiMetrics.outOfStock ?? derived.out,
    healthy: apiMetrics.healthy ?? derived.healthy,
    reorderSuggested: apiMetrics.reorderSuggested ?? derived.reorderSuggested,
    totalOnOrder: apiMetrics.totalOnOrder ?? derived.totalOnOrder,
    incomingItems: apiMetrics.incomingItems ?? derived.incomingItems,
  };

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return items
      .filter((item) =>
        filter === "all"
          ? true
          : filter === "incoming"
            ? (item.onOrder ?? 0) > 0
            : itemState(item) === filter,
      )
      .filter((item) => {
        if (!normalizedQuery) return true;
        return [item.name, item.type, item.trackingMode, item.unitName]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        const priority: Record<StockState, number> = { out: 0, low: 1, healthy: 2 };
        const stateDifference = priority[itemState(left)] - priority[itemState(right)];
        if (stateDifference) return stateDifference;
        const leftDays = left.daysUntilStockout ?? Number.POSITIVE_INFINITY;
        const rightDays = right.daysUntilStockout ?? Number.POSITIVE_INFINITY;
        return leftDays - rightDays || left.name.localeCompare(right.name);
      });
  }, [filter, items, query]);

  const needsAttention = metrics.low + metrics.out;

  return (
    <div className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <StockSectionNav />
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="animate-fade-up">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#78808a]">
            <Warehouse className="size-3.5 text-[#635bff]" aria-hidden="true" />
            Stock planning
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-[#1e2126] sm:text-[32px]">
            Stock health, at a glance.
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#747b86]">
            See what is running low, understand available runway, and replenish before work stops.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/stock/scan"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#635bff] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5147f5]"
          >
            <QrCode className="size-4" aria-hidden="true" />
            Scan code
          </Link>
          <Link
            href="/stock/workflows"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe2e7] bg-white px-4 text-sm font-semibold text-[#282b31] shadow-sm transition hover:bg-[#fafafa]"
          >
            <Workflow className="size-4" aria-hidden="true" />
            Scan workflows
          </Link>
          <Button
            variant="secondary"
            onClick={() => void loadStock({ quiet: true })}
            disabled={loading || refreshing}
            aria-label={refreshing ? "Refreshing stock" : "Refresh stock"}
            className="px-3 sm:px-4"
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
            <span className="hidden sm:inline">
              {refreshing ? "Refreshing…" : "Refresh stock"}
            </span>
          </Button>
        </div>
      </div>

      {loading ? <StockLoading /> : null}

      {!loading && error ? (
        <Card className="border-[#efd6d9] bg-[#fffafa]">
          <EmptyState
            icon={<AlertTriangle className="size-5 text-[#c34755]" aria-hidden="true" />}
            title="Stock overview is unavailable"
            description={error}
            action={
              <Button variant="secondary" onClick={() => void loadStock()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            }
          />
        </Card>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-5 animate-fade-up animation-delay-1">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                label: "Tracked items",
                value: compactNumber.format(metrics.trackedItems),
                detail: `${compactNumber.format(metrics.totalQuantity)} units on hand`,
                icon: Boxes,
                iconClass: "bg-[#eeedff] text-[#635bff]",
              },
              {
                label: "Incoming",
                value: compactNumber.format(metrics.totalOnOrder),
                detail: `${compactNumber.format(metrics.incomingItems)} items on order`,
                icon: ShoppingCart,
                iconClass: "bg-[#eaf4ff] text-[#2670b8]",
              },
              {
                label: "Healthy stock",
                value: compactNumber.format(metrics.healthy),
                detail: "Above reorder thresholds",
                icon: CheckCircle2,
                iconClass: "bg-[#e8f7f0] text-[#138a5b]",
              },
              {
                label: "Low stock",
                value: compactNumber.format(metrics.low),
                detail: `${compactNumber.format(metrics.reorderSuggested)} reorder suggestions`,
                icon: PackageMinus,
                iconClass: "bg-[#fff2e2] text-[#b56b0c]",
              },
              {
                label: "Out of stock",
                value: compactNumber.format(metrics.out),
                detail: metrics.out ? "Immediate action needed" : "Nothing blocked",
                icon: PackageX,
                iconClass: "bg-[#fff0f2] text-[#c34755]",
              },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <Card key={metric.label} className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-semibold text-[#68707c]">{metric.label}</p>
                    <span className={cn("grid size-9 place-items-center rounded-xl", metric.iconClass)}>
                      <Icon className="size-[17px]" aria-hidden="true" />
                    </span>
                  </div>
                  <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-[#24272c]">{metric.value}</p>
                  <p className="mt-1 text-[11px] text-[#8c929c]">{metric.detail}</p>
                </Card>
              );
            })}
          </div>

          {needsAttention > 0 ? (
            <Card
              className={cn(
                "flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5",
                metrics.out
                  ? "border-[#efcfd3] bg-[linear-gradient(100deg,#fff7f8,#fff)]"
                  : "border-[#f0ddbd] bg-[linear-gradient(100deg,#fffaf2,#fff)]",
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl",
                    metrics.out ? "bg-[#fff0f2] text-[#c34755]" : "bg-[#fff2e2] text-[#b56b0c]",
                  )}
                >
                  <AlertTriangle className="size-[18px]" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-[#292c31]">
                    {needsAttention} {needsAttention === 1 ? "item needs" : "items need"} attention
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-[#737984]">
                    {metrics.out
                      ? `${metrics.out} ${metrics.out === 1 ? "item is" : "items are"} out of stock and ${metrics.low} ${metrics.low === 1 ? "is" : "are"} below the desired level.`
                      : "These items have reached their minimum level or are forecast to run out soon."}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFilter(metrics.out ? "out" : "low")}
                className="self-start sm:self-auto"
              >
                {metrics.out ? "View out of stock" : "View low stock"}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </Card>
          ) : null}

          {dueCounts.length ? (
            <Card className="overflow-hidden border-[#d8d4ff]">
              <div className="flex items-center gap-3 border-b border-[#e8e6ff] bg-[#f8f7ff] px-4 py-3.5 sm:px-5">
                <span className="grid size-9 place-items-center rounded-xl bg-[#eeedff] text-[#635bff]">
                  <CalendarClock className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#30343a]">
                    {dueCounts.length} physical {dueCounts.length === 1 ? "count is" : "counts are"} due
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#777e89]">
                    Open an item to reconcile its actual quantity.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-[#eceef1]">
                {dueCounts.slice(0, 8).map((item) => (
                  <Link
                    key={item.resourceId}
                    href={`/inventory/${item.resourceId}/stock`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-[#fafbfc] sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#34383e]">
                        {item.name}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#9298a2]">
                        Every {item.intervalDays} days · due {formatDate(item.nextDueAt) ?? "now"}
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-[#635bff]">
                      Count {compactNumber.format(item.quantity)}
                    </span>
                    <ChevronRight className="size-4 text-[#a0a5ae]" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div className="border-b border-[#e8eaed] p-3 sm:p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <label className="relative min-w-0 flex-1 xl:max-w-md">
                  <span className="sr-only">Search stock</span>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9298a2]" aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search item, type, tracking mode…"
                    className="h-10 w-full rounded-xl border border-[#dfe2e7] bg-[#f8f9fa] pl-10 pr-10 text-[13px] text-[#33373d] outline-none transition placeholder:text-[#989ea8] focus:border-[#776fff] focus:bg-white focus:ring-3 focus:ring-[#635bff]/10"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[#989ea8] transition hover:bg-[#eceef1] hover:text-[#555c67]"
                      aria-label="Clear search"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </label>

                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f0f2f4] p-1 sm:flex">
                  {(Object.keys(filterLabels) as StockFilter[]).map((value) => {
                    const count =
                      value === "all"
                        ? metrics.trackedItems
                        : value === "incoming"
                          ? metrics.incomingItems
                        : value === "low"
                          ? metrics.low
                          : value === "out"
                            ? metrics.out
                            : metrics.healthy;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFilter(value)}
                        aria-pressed={filter === value}
                        className={cn(
                          "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition",
                          filter === value
                            ? "bg-white text-[#34383e] shadow-sm"
                            : "text-[#727984] hover:text-[#34383e]",
                        )}
                      >
                        {filterLabels[value]}
                        <span className={cn("tabular-nums", filter === value ? "text-[#635bff]" : "text-[#a0a5ae]")}>
                          {compactNumber.format(count)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {items.length === 0 ? (
              <EmptyState
                icon={<Package className="size-5" aria-hidden="true" />}
                title="No stock is being tracked yet"
                description="Configure stock tracking on an inventory item to see quantities, thresholds, and runway here."
                action={
                  <Link
                    href="/inventory"
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dfe2e7] bg-white px-4 text-sm font-semibold text-[#282b31] shadow-sm transition hover:bg-[#fafafa]"
                  >
                    Browse inventory
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                }
              />
            ) : filteredItems.length === 0 ? (
              <EmptyState
                icon={<Search className="size-5" aria-hidden="true" />}
                title="No stock matches these filters"
                description="Try a different search or return to the complete stock list."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[960px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[#eceef1] bg-[#fafbfc] text-[10px] font-semibold uppercase tracking-[0.09em] text-[#949aa4]">
                        <th className="px-5 py-3">Item</th>
                        <th className="px-4 py-3">On hand</th>
                        <th className="px-4 py-3">Incoming</th>
                        <th className="px-4 py-3">Minimum</th>
                        <th className="px-4 py-3">Daily usage</th>
                        <th className="px-4 py-3">Runway</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="w-14 px-4 py-3"><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#eceef1]">
                      {filteredItems.map((item) => {
                        const state = itemState(item);
                        return (
                          <tr
                            key={item.resourceId}
                            className={cn(
                              "group transition hover:bg-[#fafbfc]",
                              state === "out" && "bg-[#fffafa]",
                              state === "low" && "bg-[#fffdf9]",
                            )}
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <span
                                  className={cn(
                                    "grid size-9 shrink-0 place-items-center rounded-xl",
                                    state === "out"
                                      ? "bg-[#fff0f2] text-[#c34755]"
                                      : state === "low"
                                        ? "bg-[#fff2e2] text-[#b56b0c]"
                                        : "bg-[#f0f2f4] text-[#6c737e]",
                                  )}
                                >
                                  {state === "healthy" ? <Package className="size-4" aria-hidden="true" /> : <TrendingDown className="size-4" aria-hidden="true" />}
                                </span>
                                <div className="min-w-0">
                                  <Link href={`/inventory/${item.resourceId}/stock`} className="block max-w-[260px] truncate text-[13px] font-semibold text-[#30343a] transition hover:text-[#635bff]">
                                    {item.name}
                                  </Link>
                                  <p className="mt-0.5 text-[10px] text-[#9298a2]">{titleCase(item.type)} · {titleCase(item.trackingMode)}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <p className={cn("text-[13px] font-semibold tabular-nums", state === "out" ? "text-[#b83243]" : "text-[#30343a]")}>
                                {formatQuantity(item.quantity, item.unitName)}
                              </p>
                            </td>
                            <td className="px-4 py-4">
                              {item.onOrder > 0 ? (
                                <div>
                                  <p className="text-[12px] font-semibold tabular-nums text-[#2670b8]">
                                    +{formatQuantity(item.onOrder, item.unitName)}
                                  </p>
                                  <p className="mt-0.5 text-[10px] text-[#9298a2]">
                                    {formatDate(item.nextExpectedAt)
                                      ? `Expected ${formatDate(item.nextExpectedAt)}`
                                      : `Projected ${formatQuantity(item.projectedQuantity, item.unitName)}`}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-[12px] text-[#b0b5bd]">—</span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-[12px] font-medium tabular-nums text-[#68707c]">
                              {item.minimumStock === null ? "Not set" : formatQuantity(item.minimumStock, item.unitName)}
                            </td>
                            <td className="px-4 py-4 text-[12px] font-medium text-[#68707c]">
                              {formatUsage(item.averageDailyUsage, item.unitName)}
                            </td>
                            <td className="px-4 py-4"><Runway item={item} /></td>
                            <td className="px-4 py-4"><StockStatus item={item} /></td>
                            <td className="px-4 py-4">
                              <Link
                                href={`/inventory/${item.resourceId}/stock`}
                                aria-label={`Open stock settings for ${item.name}`}
                                className="grid size-8 place-items-center rounded-lg text-[#a0a5ae] transition group-hover:bg-[#eeedff] group-hover:text-[#635bff]"
                              >
                                <ChevronRight className="size-4" aria-hidden="true" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-[#e8eaed] lg:hidden">
                  {filteredItems.map((item) => {
                    const state = itemState(item);
                    return (
                      <Link
                        key={item.resourceId}
                        href={`/inventory/${item.resourceId}/stock`}
                        className={cn(
                          "group block p-4 transition hover:bg-[#fafbfc] sm:p-5",
                          state === "out" && "bg-[#fffafa]",
                          state === "low" && "bg-[#fffdf9]",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "grid size-10 shrink-0 place-items-center rounded-xl",
                              state === "out"
                                ? "bg-[#fff0f2] text-[#c34755]"
                                : state === "low"
                                  ? "bg-[#fff2e2] text-[#b56b0c]"
                                  : "bg-[#f0f2f4] text-[#6c737e]",
                            )}
                          >
                            <Package className="size-[18px]" aria-hidden="true" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="truncate text-[13px] font-semibold text-[#30343a]">{item.name}</h3>
                                <p className="mt-0.5 text-[10px] text-[#9298a2]">{titleCase(item.type)} · {titleCase(item.trackingMode)}</p>
                              </div>
                              <ChevronRight className="mt-0.5 size-4 shrink-0 text-[#a0a5ae] transition group-hover:translate-x-0.5 group-hover:text-[#635bff]" aria-hidden="true" />
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-white/80 p-3 ring-1 ring-inset ring-[#e8eaed]">
                              <div>
                                <p className="text-[9px] font-semibold uppercase tracking-wider text-[#9aa0aa]">On hand</p>
                                <p className={cn("mt-1 text-[13px] font-semibold tabular-nums", state === "out" ? "text-[#b83243]" : "text-[#30343a]")}>
                                  {formatQuantity(item.quantity, item.unitName)}
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] font-semibold uppercase tracking-wider text-[#9aa0aa]">Minimum</p>
                                <p className="mt-1 text-[13px] font-semibold tabular-nums text-[#4d535c]">
                                  {item.minimumStock === null ? "Not set" : formatQuantity(item.minimumStock, item.unitName)}
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] font-semibold uppercase tracking-wider text-[#9aa0aa]">Incoming</p>
                                <p className="mt-1 text-[13px] font-semibold tabular-nums text-[#2670b8]">
                                  {item.onOrder > 0 ? `+${formatQuantity(item.onOrder, item.unitName)}` : "—"}
                                </p>
                              </div>
                              <div className="col-span-2 border-t border-[#eceef1] pt-3">
                                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#9aa0aa]">Estimated runway</p>
                                <Runway item={item} compact />
                              </div>
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3">
                              <StockStatus item={item} />
                              <span className="flex items-center gap-1 text-[10px] font-medium text-[#9298a2]">
                                <Clock3 className="size-3" aria-hidden="true" />
                                {formatUsage(item.averageDailyUsage, item.unitName)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}

            {filteredItems.length ? (
              <div className="flex flex-col gap-2 border-t border-[#e8eaed] bg-[#fafbfc] px-4 py-3 text-[11px] text-[#858c96] sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <span>
                  Showing {filteredItems.length} of {metrics.trackedItems} tracked items
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  Runway is based on average daily usage
                </span>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
