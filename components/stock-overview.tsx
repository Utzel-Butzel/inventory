"use client";

import type { TFunction } from "i18next";
import { OrganizationLink as Link } from "@/components/organization-routing";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Clock3,
  Package,
  RefreshCw,
  Search,
  TrendingDown,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { ResponsiveMediaImage } from "@/components/responsive-media-image";

type StockFilter = "all" | "low" | "out" | "healthy" | "incoming";
type StockState = "low" | "out" | "healthy";

type StockItem = {
  resourceId: string;
  name: string;
  type: string;
  cover: {
    id?: string;
    url: string;
    altText: string;
    width?: number | null;
    height?: number | null;
  } | null;
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

const filterLabelKeys: Record<StockFilter, string> = {
  all: "overview.filters.all",
  low: "overview.filters.low",
  out: "overview.filters.out",
  healthy: "overview.filters.healthy",
  incoming: "overview.filters.incoming",
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

function StockItemVisual({ item, state }: { item: StockItem; state: StockState }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageUrl = item.cover?.url;

  if (imageUrl && imageUrl !== failedUrl) {
    return (
      <span className="block size-12 shrink-0 overflow-hidden rounded-xl bg-surface-muted ring-1 ring-inset ring-border">
        <ResponsiveMediaImage
          media={item.cover!}
          alt={item.cover?.altText || item.name}
          widths={[96, 192]}
          sizes="48px"
          onError={() => setFailedUrl(imageUrl)}
          className="size-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-xl",
        state === "out"
          ? "bg-danger-soft text-danger"
          : state === "low"
            ? "bg-warning-soft text-warning"
            : "bg-surface-muted text-muted",
      )}
    >
      {state === "healthy" ? (
        <Package className="size-5" aria-hidden="true" />
      ) : (
        <TrendingDown className="size-5" aria-hidden="true" />
      )}
    </span>
  );
}

function titleCase(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stockValueLabel(value: string, t: TFunction) {
  return t(`overview.values.${value}`, { defaultValue: titleCase(value) });
}

function formatQuantity(
  value: number,
  unitName: string,
  numberFormat: Intl.NumberFormat,
) {
  const quantity = numberFormat.format(value);
  return unitName ? `${quantity} ${unitName}` : quantity;
}

function formatUsage(
  value: number | null,
  unitName: string,
  numberFormat: Intl.NumberFormat,
  t: TFunction,
) {
  if (value === null || value <= 0) return t("overview.usage.none");
  return t("overview.usage.perDay", {
    value: numberFormat.format(value),
    unit: unitName || t("overview.usage.units"),
  });
}

function formatDate(value: string | null, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function getErrorMessage(payload: unknown, t: TFunction) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return t("overview.errors.load");
}

function Runway({ item, compact = false }: { item: StockItem; compact?: boolean }) {
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const days = item.daysUntilStockout;
  const predictedDate = formatDate(item.predictedStockoutAt, locale);

  if (item.quantity <= 0) {
    return (
      <div className={cn("flex items-center gap-2", compact && "justify-between")}>
        <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-danger">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {t("overview.runway.outNow")}
        </span>
        {predictedDate ? (
          <span className="text-[12px] text-danger">
            {t("overview.runway.since", { date: predictedDate })}
          </span>
        ) : null}
      </div>
    );
  }

  if (days === null || !Number.isFinite(days)) {
    return (
      <div className={cn(compact && "flex items-center justify-between")}>
        <p className="text-[14px] font-medium text-muted">
          {t("overview.runway.notForecast")}
        </p>
        {!compact ? (
          <p className="mt-0.5 text-[12px] text-muted">
            {t("overview.runway.addUsage")}
          </p>
        ) : null}
      </div>
    );
  }

  const roundedDays = Math.max(0, Math.ceil(days));
  const urgent = days <= 7;
  const warning = days > 7 && days <= 30;
  const label =
    days < 1
      ? t("overview.runway.lessThanDay")
      : t("overview.runway.days", { count: roundedDays });
  const color = urgent ? "text-danger" : warning ? "text-warning" : "text-success";
  const dot = urgent ? "bg-danger" : warning ? "bg-warning" : "bg-success";

  return (
    <div className={cn(compact && "flex items-center justify-between gap-3")}>
      <p className={cn("flex items-center gap-1.5 text-[14px] font-semibold", color)}>
        <span className={cn("size-1.5 rounded-full", dot)} />
        {label}
      </p>
      {predictedDate ? (
        <p className={cn("text-[12px] text-muted", !compact && "mt-0.5")}>
          {t("overview.runway.runsOut", { date: predictedDate })}
        </p>
      ) : null}
    </div>
  );
}

function StockStatus({ item }: { item: StockItem }) {
  const { t, i18n } = useT("stock");
  const numberFormat = useMemo(
    () =>
      new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language ?? "en", {
        maximumFractionDigits: 1,
      }),
    [i18n.language, i18n.resolvedLanguage],
  );
  const state = itemState(item);
  if (state === "out") {
    return (
      <div>
        <Badge tone="danger">{t("overview.status.out")}</Badge>
        <p className="mt-1 text-[12px] font-medium text-danger">
          {t("overview.status.replenishNow")}
        </p>
      </div>
    );
  }
  if (state === "low") {
    const shortage =
      item.minimumStock === null ? null : Math.max(0, item.minimumStock - item.quantity);
    return (
      <div>
        <Badge tone="warning">{t("overview.status.low")}</Badge>
        <p className="mt-1 text-[12px] font-medium text-warning">
          {shortage && shortage > 0
            ? t("overview.status.belowMinimum", {
                quantity: numberFormat.format(shortage),
              })
            : t("overview.status.reorderSuggested")}
        </p>
      </div>
    );
  }
  return <Badge tone="success">{t("overview.status.healthy")}</Badge>;
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
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const compactNumber = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    [locale],
  );
  const [items, setItems] = useState<StockItem[]>([]);
  const [apiMetrics, setApiMetrics] = useState<StockMetrics>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [dueCounts, setDueCounts] = useState<DueInventoryCount[]>([]);

  const loadStock = useCallback(async (options?: { signal?: AbortSignal }) => {
    setLoading(true);
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
      if (!response.ok || !payload) throw new Error(getErrorMessage(payload, t));
      if (!Array.isArray(payload.items)) {
        throw new Error(t("overview.errors.unexpectedResponse"));
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
      setError(
        loadError instanceof Error ? loadError.message : t("overview.errors.load"),
      );
    } finally {
      if (!options?.signal?.aborted) {
        setLoading(false);
      }
    }
  }, [t]);

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
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
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
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery);
      })
      .sort((left, right) => {
        const priority: Record<StockState, number> = { out: 0, low: 1, healthy: 2 };
        const stateDifference = priority[itemState(left)] - priority[itemState(right)];
        if (stateDifference) return stateDifference;
        const leftDays = left.daysUntilStockout ?? Number.POSITIVE_INFINITY;
        const rightDays = right.daysUntilStockout ?? Number.POSITIVE_INFINITY;
        return leftDays - rightDays || left.name.localeCompare(right.name, locale);
      });
  }, [filter, items, locale, query]);

  const needsAttention = metrics.low + metrics.out;

  return (
    <div className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-foreground sm:text-[30px]">
          {t("overview.title")}
        </h1>
      </div>

      {loading ? <StockLoading /> : null}

      {!loading && error ? (
        <Card className="border-danger-border bg-danger-soft">
          <EmptyState
            icon={<AlertTriangle className="size-5 text-danger" aria-hidden="true" />}
            title={t("overview.empty.unavailableTitle")}
            description={error}
            action={
              <Button variant="secondary" onClick={() => void loadStock()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                {t("overview.actions.tryAgain")}
              </Button>
            }
          />
        </Card>
      ) : null}

      {!loading && !error ? (
        <div className="space-y-5">
          <section
            className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-5"
            aria-label={t("overview.title")}
          >
            {[
              {
                label: t("overview.metrics.trackedItems"),
                value: compactNumber.format(metrics.trackedItems),
                detail: t("overview.metrics.unitsOnHand", {
                  count: metrics.totalQuantity,
                  value: compactNumber.format(metrics.totalQuantity),
                }),
                valueClass: "text-foreground",
              },
              {
                label: t("overview.metrics.incoming"),
                value: compactNumber.format(metrics.totalOnOrder),
                detail: t("overview.metrics.itemsOnOrder", {
                  count: metrics.incomingItems,
                  value: compactNumber.format(metrics.incomingItems),
                }),
                valueClass: "text-foreground",
              },
              {
                label: t("overview.metrics.healthyStock"),
                value: compactNumber.format(metrics.healthy),
                detail: t("overview.metrics.aboveThresholds"),
                valueClass: "text-foreground",
              },
              {
                label: t("overview.metrics.lowStock"),
                value: compactNumber.format(metrics.low),
                detail: t("overview.metrics.reorderSuggestions", {
                  count: metrics.reorderSuggested,
                  value: compactNumber.format(metrics.reorderSuggested),
                }),
                valueClass: "text-warning",
              },
              {
                label: t("overview.metrics.outOfStock"),
                value: compactNumber.format(metrics.out),
                detail: metrics.out
                  ? t("overview.metrics.immediateAction")
                  : t("overview.metrics.nothingBlocked"),
                valueClass: "text-danger",
              },
            ].map((metric) => (
              <div key={metric.label} className="bg-surface p-4 sm:p-5">
                <p className="text-xs font-medium text-muted">{metric.label}</p>
                <p className={cn("mt-3 text-2xl font-semibold tabular-nums", metric.valueClass)}>
                  {metric.value}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">{metric.detail}</p>
              </div>
            ))}
          </section>

          {needsAttention > 0 ? (
            <Card
              className={cn(
                "flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5",
                metrics.out ? "border-danger-border" : "border-warning-border",
              )}
            >
              <div className="flex items-start gap-3">
                <span className={metrics.out ? "text-danger" : "text-warning"}>
                  <AlertTriangle className="size-[18px]" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {t("overview.attention.title", {
                      count: needsAttention,
                      value: compactNumber.format(needsAttention),
                    })}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {metrics.out
                      ? t("overview.attention.outAndLow", {
                          out: compactNumber.format(metrics.out),
                          outCount: metrics.out,
                          low: compactNumber.format(metrics.low),
                          lowCount: metrics.low,
                        })
                      : t("overview.attention.lowOnly")}
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFilter(metrics.out ? "out" : "low")}
                className="self-start sm:self-auto"
              >
                {metrics.out
                  ? t("overview.attention.viewOut")
                  : t("overview.attention.viewLow")}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </Card>
          ) : null}

          {dueCounts.length ? (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3.5 sm:px-5">
                <CalendarClock className="size-4 text-muted" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {t("overview.counts.due", {
                      count: dueCounts.length,
                      value: compactNumber.format(dueCounts.length),
                    })}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {t("overview.counts.description")}
                  </p>
                </div>
              </div>
              <div className="divide-y divide-border">
                {dueCounts.slice(0, 8).map((item) => (
                  <Link
                    key={item.resourceId}
                    href={`/inventory/${item.resourceId}/stock`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-hover sm:px-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {item.name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {t("overview.counts.schedule", {
                          count: item.intervalDays,
                          interval: compactNumber.format(item.intervalDays),
                          date:
                            formatDate(item.nextDueAt, locale) ??
                            t("overview.counts.now"),
                        })}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-brand">
                      {t("overview.counts.action", {
                        quantity: compactNumber.format(item.quantity),
                      })}
                    </span>
                    <ChevronRight className="size-4 text-muted" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div className="border-b border-border p-3 sm:p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <label className="relative min-w-0 flex-1 xl:max-w-md">
                  <span className="sr-only">{t("overview.search.label")}</span>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("overview.search.placeholder")}
                    className="h-10 w-full rounded-xl border border-border bg-surface-subtle pl-10 pr-10 text-[15px] text-foreground outline-none transition placeholder:text-muted focus:border-focus focus:bg-surface focus:ring-3 focus:ring-focus/10"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-muted-strong"
                      aria-label={t("overview.search.clear")}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </label>

                <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1 sm:flex">
                  {(Object.keys(filterLabelKeys) as StockFilter[]).map((value) => {
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
                          "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition",
                          filter === value
                            ? "bg-surface text-foreground shadow-sm"
                            : "text-muted hover:text-foreground",
                        )}
                      >
                        {t(filterLabelKeys[value])}
                        <span className={cn("tabular-nums", filter === value ? "text-brand" : "text-muted")}>
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
                title={t("overview.empty.noStockTitle")}
                description={t("overview.empty.noStockDescription")}
                action={
                  <Link
                    href="/inventory"
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground shadow-sm transition hover:bg-surface-hover"
                  >
                    {t("overview.actions.browseInventory")}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                }
              />
            ) : filteredItems.length === 0 ? (
              <EmptyState
                icon={<Search className="size-5" aria-hidden="true" />}
                title={t("overview.empty.noMatchesTitle")}
                description={t("overview.empty.noMatchesDescription")}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    {t("overview.actions.clearFilters")}
                  </Button>
                }
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[960px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-surface-subtle text-[12px] font-semibold uppercase tracking-[0.09em] text-muted">
                        <th className="px-5 py-3">{t("overview.table.item")}</th>
                        <th className="px-4 py-3">{t("overview.table.onHand")}</th>
                        <th className="px-4 py-3">{t("overview.table.incoming")}</th>
                        <th className="px-4 py-3">{t("overview.table.minimum")}</th>
                        <th className="px-4 py-3">{t("overview.table.dailyUsage")}</th>
                        <th className="px-4 py-3">{t("overview.table.runway")}</th>
                        <th className="px-4 py-3">{t("overview.table.status")}</th>
                        <th className="w-14 px-4 py-3">
                          <span className="sr-only">{t("overview.table.open")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredItems.map((item) => {
                        const state = itemState(item);
                        return (
                          <tr
                            key={item.resourceId}
                            className={cn(
                              "group transition hover:bg-surface-hover",
                              state === "out" && "bg-danger-soft",
                              state === "low" && "bg-warning-soft",
                            )}
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <StockItemVisual item={item} state={state} />
                                <div className="min-w-0">
                                  <Link href={`/inventory/${item.resourceId}/stock`} className="block max-w-[260px] truncate text-[15px] font-semibold text-foreground transition hover:text-brand">
                                    {item.name}
                                  </Link>
                                  <p className="mt-0.5 text-[12px] text-muted">
                                    {stockValueLabel(item.type, t)} ·{" "}
                                    {stockValueLabel(item.trackingMode, t)}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <p className={cn("text-[15px] font-semibold tabular-nums", state === "out" ? "text-danger" : "text-foreground")}>
                                {formatQuantity(item.quantity, item.unitName, compactNumber)}
                              </p>
                            </td>
                            <td className="px-4 py-4">
                              {item.onOrder > 0 ? (
                                <div>
                                  <p className="text-[14px] font-semibold tabular-nums text-info">
                                    +{formatQuantity(item.onOrder, item.unitName, compactNumber)}
                                  </p>
                                  <p className="mt-0.5 text-[12px] text-muted">
                                    {formatDate(item.nextExpectedAt, locale)
                                      ? t("overview.table.expected", {
                                          date: formatDate(item.nextExpectedAt, locale),
                                        })
                                      : t("overview.table.projected", {
                                          quantity: formatQuantity(
                                            item.projectedQuantity,
                                            item.unitName,
                                            compactNumber,
                                          ),
                                        })}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-[14px] text-muted">—</span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-[14px] font-medium tabular-nums text-muted">
                              {item.minimumStock === null
                                ? t("overview.table.notSet")
                                : formatQuantity(
                                    item.minimumStock,
                                    item.unitName,
                                    compactNumber,
                                  )}
                            </td>
                            <td className="px-4 py-4 text-[14px] font-medium text-muted">
                              {formatUsage(
                                item.averageDailyUsage,
                                item.unitName,
                                compactNumber,
                                t,
                              )}
                            </td>
                            <td className="px-4 py-4"><Runway item={item} /></td>
                            <td className="px-4 py-4"><StockStatus item={item} /></td>
                            <td className="px-4 py-4">
                              <Link
                                href={`/inventory/${item.resourceId}/stock`}
                                aria-label={t("overview.table.openFor", {
                                  name: item.name,
                                })}
                                className="grid size-8 place-items-center rounded-lg text-muted transition group-hover:bg-brand-soft group-hover:text-brand"
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

                <div className="divide-y divide-border lg:hidden">
                  {filteredItems.map((item) => {
                    const state = itemState(item);
                    return (
                      <Link
                        key={item.resourceId}
                        href={`/inventory/${item.resourceId}/stock`}
                        className={cn(
                          "group block p-4 transition hover:bg-surface-hover sm:p-5",
                          state === "out" && "bg-danger-soft",
                          state === "low" && "bg-warning-soft",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <StockItemVisual item={item} state={state} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="truncate text-[15px] font-semibold text-foreground">{item.name}</h3>
                                <p className="mt-0.5 text-[12px] text-muted">
                                  {stockValueLabel(item.type, t)} ·{" "}
                                  {stockValueLabel(item.trackingMode, t)}
                                </p>
                              </div>
                              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-surface/80 p-3 ring-1 ring-inset ring-border">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                                  {t("overview.table.onHand")}
                                </p>
                                <p className={cn("mt-1 text-[15px] font-semibold tabular-nums", state === "out" ? "text-danger" : "text-foreground")}>
                                  {formatQuantity(item.quantity, item.unitName, compactNumber)}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                                  {t("overview.table.minimum")}
                                </p>
                                <p className="mt-1 text-[15px] font-semibold tabular-nums text-muted-strong">
                                  {item.minimumStock === null
                                    ? t("overview.table.notSet")
                                    : formatQuantity(
                                        item.minimumStock,
                                        item.unitName,
                                        compactNumber,
                                      )}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                                  {t("overview.table.incoming")}
                                </p>
                                <p className="mt-1 text-[15px] font-semibold tabular-nums text-info">
                                  {item.onOrder > 0
                                    ? `+${formatQuantity(
                                        item.onOrder,
                                        item.unitName,
                                        compactNumber,
                                      )}`
                                    : "—"}
                                </p>
                              </div>
                              <div className="col-span-2 border-t border-border pt-3">
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                                  {t("overview.table.estimatedRunway")}
                                </p>
                                <Runway item={item} compact />
                              </div>
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-3">
                              <StockStatus item={item} />
                              <span className="flex items-center gap-1 text-[12px] font-medium text-muted">
                                <Clock3 className="size-3" aria-hidden="true" />
                                {formatUsage(
                                  item.averageDailyUsage,
                                  item.unitName,
                                  compactNumber,
                                  t,
                                )}
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
              <div className="flex flex-col gap-2 border-t border-border bg-surface-subtle px-4 py-3 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <span>
                  {t("overview.footer.showing", {
                    shown: compactNumber.format(filteredItems.length),
                    total: compactNumber.format(metrics.trackedItems),
                  })}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  {t("overview.footer.runwayBasis")}
                </span>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
