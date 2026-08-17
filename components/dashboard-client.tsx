"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { useT } from "next-i18next/client";
import {
  AlertTriangle,
  ArrowRight,
  BoxIcon,
  Layers3,
  MapPin,
  PackagePlus,
  RefreshCw,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, Skeleton } from "@/components/ui";

type DashboardStats = {
  resources: number;
  units: number;
  valueCents: number;
  available: number;
  attention: number;
  byType: Array<{ type: string; value: number }>;
};

type Resource = {
  id: string;
  name: string;
  type: string;
  status: string;
  sku: string | null;
  quantity: number;
  location: string | null;
  updatedAt: string;
  cover: { url: string; altText?: string; name?: string } | null;
};

type ResourcesResponse = {
  resources: Resource[];
  pagination: { total: number };
};

const typeColors = ["#635bff", "#3b82f6", "#16a374", "#e99b2d", "#a66dd4", "#e2647f"];

const humanize = (value: string) =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

function DashboardLoading() {
  return (
    <div className="space-y-6">
      <Card className="grid overflow-hidden sm:grid-cols-2 xl:grid-cols-4 [&>div:not(:last-child)]:border-b [&>div]:border-border sm:[&>div:nth-child(odd)]:border-r sm:[&>div:nth-child(n+3)]:border-b-0 xl:[&>div]:border-b-0 xl:[&>div:not(:last-child)]:border-r">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-5 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-32" />
          </div>
        ))}
      </Card>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(290px,0.8fr)]">
        <Card className="p-5">
          <Skeleton className="h-5 w-36" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="size-11 rounded-xl" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-7 h-3 w-full" />
          <Skeleton className="mt-5 h-3 w-4/5" />
          <Skeleton className="mt-5 h-3 w-3/5" />
        </Card>
      </div>
    </div>
  );
}

export function DashboardClient() {
  const { t, i18n } = useT("dashboard");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [statsResponse, resourcesResponse] = await Promise.all([
        fetch("/api/v1/stats", { signal, cache: "no-store" }),
        fetch("/api/v1/resources?page=1&pageSize=6", {
          signal,
          cache: "no-store",
        }),
      ]);
      if (!statsResponse.ok || !resourcesResponse.ok) {
        throw new Error(t("errors.load"));
      }
      const statsPayload = (await statsResponse.json()) as { stats: DashboardStats };
      const resourcesPayload = (await resourcesResponse.json()) as ResourcesResponse;
      setStats(statsPayload.stats);
      setResources(resourcesPayload.resources);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("errors.load"),
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard]);

  const compactNumber = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }),
    [locale],
  );
  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }),
    [locale],
  );
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const hour = new Date().getHours();
  const greeting =
    hour < 12
      ? t("greeting.morning")
      : hour < 18
        ? t("greeting.afternoon")
        : t("greeting.evening");
  const availability = stats?.resources
    ? Math.round((stats.available / stats.resources) * 100)
    : 0;
  const maxTypeValue = useMemo(
    () => Math.max(1, ...(stats?.byType.map((item) => item.value) ?? [1])),
    [stats],
  );
  const typeLabel = (value: string) =>
    t(`types.${value}`, { defaultValue: humanize(value) });
  const typeGroupLabel = (value: string) =>
    t(`typeGroups.${value}`, { defaultValue: humanize(value) });
  const statusLabel = (value: string) =>
    t(`statuses.${value}`, { defaultValue: humanize(value) });
  const statusBadge = (status: string) => {
    if (status === "available") {
      return <Badge tone="success">{statusLabel(status)}</Badge>;
    }
    if (status === "maintenance") {
      return <Badge tone="warning">{statusLabel(status)}</Badge>;
    }
    if (status === "in-use") {
      return <Badge tone="brand">{statusLabel(status)}</Badge>;
    }
    return <Badge>{statusLabel(status)}</Badge>;
  };
  const relativeDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("relative.recently");
    const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
    if (minutes < 2) return t("relative.justNow");
    if (minutes < 60) return t("relative.minutesAgo", { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("relative.hoursAgo", { count: hours });
    const days = Math.round(hours / 24);
    if (days < 7) return t("relative.daysAgo", { count: days });
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(date);
  };

  return (
    <div className="mx-auto max-w-[1540px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-9">
      <div className="mb-7">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-foreground sm:text-[32px]">
          {greeting}
        </h1>
      </div>

      {loading ? <DashboardLoading /> : null}

      {!loading && error ? (
        <Card className="border-danger-border bg-danger-soft">
          <EmptyState
            icon={<AlertTriangle className="size-5 text-danger" aria-hidden="true" />}
            title={t("errors.title")}
            description={t("errors.description", { error })}
            action={
              <Button variant="secondary" onClick={() => void loadDashboard()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                {t("actions.retry")}
              </Button>
            }
          />
        </Card>
      ) : null}

      {!loading && !error && stats ? (
        <div className="space-y-5">
          <Card className="grid overflow-hidden sm:grid-cols-2 xl:grid-cols-4 [&>div:not(:last-child)]:border-b [&>div]:border-border sm:[&>div:nth-child(odd)]:border-r sm:[&>div:nth-child(n+3)]:border-b-0 xl:[&>div]:border-b-0 xl:[&>div:not(:last-child)]:border-r">
            {[
              {
                id: "items",
                label: t("metrics.items.label"),
                value: compactNumber.format(stats.resources),
                detail: t("metrics.items.detail", {
                  count: stats.units,
                  value: compactNumber.format(stats.units),
                }),
              },
              {
                id: "value",
                label: t("metrics.value.label"),
                value: money.format(stats.valueCents / 100),
                detail: t("metrics.value.detail"),
              },
              {
                id: "available",
                label: t("metrics.available.label"),
                value: compactNumber.format(stats.available),
                detail: stats.resources
                  ? t("metrics.available.detail", {
                      value: percent.format(availability / 100),
                    })
                  : t("metrics.available.empty"),
              },
              {
                id: "attention",
                label: t("metrics.attention.label"),
                value: compactNumber.format(stats.attention),
                detail: t("metrics.attention.detail", {
                  count: stats.attention,
                  value: integer.format(stats.attention),
                }),
              },
            ].map((metric) => (
              <div key={metric.id} className="p-5">
                <p className="text-[12px] font-medium text-muted">
                  {metric.label}
                </p>
                <p className="mt-3 truncate text-[27px] font-semibold tracking-[-0.03em] text-foreground">
                  {metric.value}
                </p>
                <p className="mt-1 text-[11px] text-muted">{metric.detail}</p>
              </div>
            ))}
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("recent.title")}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {t("recent.subtitle")}
                  </p>
                </div>
                <Link
                  href="/inventory"
                  className="group flex items-center gap-1 text-[12px] font-semibold text-brand hover:text-brand-strong"
                >
                  {t("actions.viewAll")}
                  <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </div>

              {resources.length ? (
                <div className="divide-y divide-border">
                  {resources.map((resource) => (
                    <Link
                      key={resource.id}
                      href={`/inventory/${resource.id}`}
                      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-surface-subtle sm:grid-cols-[minmax(0,1fr)_110px_100px] sm:px-6"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-surface-muted bg-cover bg-center text-muted"
                          style={
                            resource.cover?.url
                              ? { backgroundImage: `url(${JSON.stringify(resource.cover.url)})` }
                              : undefined
                          }
                          role={resource.cover?.url ? "img" : undefined}
                          aria-label={resource.cover?.url ? resource.cover.altText || resource.name : undefined}
                        >
                          {!resource.cover?.url ? <BoxIcon className="size-[18px]" aria-hidden="true" /> : null}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-foreground transition group-hover:text-brand">
                            {resource.name}
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted">
                            <span>{typeLabel(resource.type)}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {t("recent.quantity", {
                                count: resource.quantity,
                                value: integer.format(resource.quantity),
                              })}
                            </span>
                            {resource.location ? (
                              <>
                                <span className="hidden sm:inline" aria-hidden="true">·</span>
                                <span className="hidden min-w-0 items-center gap-1 truncate sm:flex">
                                  <MapPin className="size-2.5 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{resource.location}</span>
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="hidden sm:block">{statusBadge(resource.status)}</div>
                      <span className="text-right text-[10px] text-muted">
                        {relativeDate(resource.updatedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="min-h-64"
                  icon={<PackagePlus className="size-5" aria-hidden="true" />}
                  title={t("recent.empty.title")}
                  description={t("recent.empty.description")}
                />
              )}
            </Card>

            <div>
              <Card className="p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {t("mix.title")}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {t("mix.subtitle")}
                    </p>
                  </div>
                  <span className="grid size-8 place-items-center rounded-xl bg-surface-muted text-muted">
                    <Layers3 className="size-4" aria-hidden="true" />
                  </span>
                </div>
                {stats.byType.length ? (
                  <div className="mt-6 space-y-4">
                    {stats.byType.slice(0, 6).map((item, index) => (
                      <div key={item.type}>
                        <div className="mb-1.5 flex items-center justify-between text-[11px]">
                          <span className="font-medium text-muted">
                            {typeGroupLabel(item.type)}
                          </span>
                          <span className="tabular-nums text-muted">
                            {integer.format(item.value)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full rounded-full transition-[width] duration-700"
                            style={{
                              width: `${Math.max(5, (item.value / maxTypeValue) * 100)}%`,
                              backgroundColor: typeColors[index % typeColors.length],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-6 rounded-xl bg-surface-subtle p-4 text-center text-[12px] text-muted">
                    {t("mix.empty")}
                  </p>
                )}
              </Card>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
