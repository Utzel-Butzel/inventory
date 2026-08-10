"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  BoxIcon,
  CircleCheck,
  CircleDollarSign,
  Layers3,
  MapPin,
  PackagePlus,
  RefreshCw,
  Sparkles,
  UploadCloud,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";

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

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const money = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const typeLabels: Record<string, string> = {
  place: "Places",
  person: "People",
  vehicle: "Vehicles",
  tool: "Tools",
  project: "Projects",
  clothing: "Clothing",
  furniture: "Furniture",
  object: "Objects",
  other: "Other",
};

const typeColors = ["#635bff", "#3b82f6", "#16a374", "#e99b2d", "#a66dd4", "#e2647f"];

function statusBadge(status: string) {
  if (status === "available") return <Badge tone="success">Available</Badge>;
  if (status === "maintenance") return <Badge tone="warning">Maintenance</Badge>;
  if (status === "in-use") return <Badge tone="brand">In use</Badge>;
  return <Badge>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-8 rounded-xl" />
            </div>
            <Skeleton className="mt-7 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
      </div>
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
        throw new Error("The dashboard data could not be loaded.");
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
          : "The dashboard data could not be loaded.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboard(controller.signal);
    return () => controller.abort();
  }, [loadDashboard]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const availability = stats?.resources
    ? Math.round((stats.available / stats.resources) * 100)
    : 0;
  const maxTypeValue = useMemo(
    () => Math.max(1, ...(stats?.byType.map((item) => item.value) ?? [1])),
    [stats],
  );

  return (
    <div className="mx-auto max-w-[1540px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-9">
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="animate-fade-up">
          <div className="mb-2 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-[#20a36d] ring-4 ring-[#20a36d]/10" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#78808a]">
              Workspace overview
            </p>
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-[#1e2126] sm:text-[32px]">
            {greeting}
          </h1>
          <p className="mt-1.5 text-sm text-[#747b86]">
            Here’s what’s happening across your inventory.
          </p>
        </div>
        <div className="flex animate-fade-up gap-2 animation-delay-1">
          <Link
            href="/batch"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dfe2e7] bg-white px-3.5 text-[13px] font-semibold text-[#3e4249] shadow-sm transition hover:border-[#cfd3da] hover:bg-[#fafafa]"
          >
            <UploadCloud className="size-4 text-[#777e89]" aria-hidden="true" />
            Batch upload
          </Link>
          <Link
            href="/inventory/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#635bff] px-3.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#5147f5]"
          >
            <PackagePlus className="size-4" aria-hidden="true" />
            Add item
          </Link>
        </div>
      </div>

      {loading ? <DashboardLoading /> : null}

      {!loading && error ? (
        <Card className="border-[#efd6d9] bg-[#fffafa]">
          <EmptyState
            icon={<AlertTriangle className="size-5 text-[#c34755]" aria-hidden="true" />}
            title="Dashboard data is unavailable"
            description={`${error} Make sure Postgres is running and the database has been migrated.`}
            action={
              <Button variant="secondary" onClick={() => void loadDashboard()}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            }
          />
        </Card>
      ) : null}

      {!loading && !error && stats ? (
        <div className="space-y-5 animate-fade-up animation-delay-1">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Inventory items",
                value: compactNumber.format(stats.resources),
                detail: `${compactNumber.format(stats.units)} total units`,
                icon: Boxes,
                iconClass: "bg-[#eeedff] text-[#635bff]",
              },
              {
                label: "Tracked value",
                value: money.format(stats.valueCents / 100),
                detail: "Across all inventory",
                icon: CircleDollarSign,
                iconClass: "bg-[#e8f7f0] text-[#138a5b]",
              },
              {
                label: "Available now",
                value: compactNumber.format(stats.available),
                detail: stats.resources ? `${availability}% of all items` : "No items yet",
                icon: CircleCheck,
                iconClass: "bg-[#eaf4ff] text-[#357bc2]",
              },
              {
                label: "Needs attention",
                value: compactNumber.format(stats.attention),
                detail: stats.attention === 1 ? "1 maintenance item" : `${stats.attention} maintenance items`,
                icon: AlertTriangle,
                iconClass: "bg-[#fff2e2] text-[#bd680c]",
              },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <Card
                  key={metric.label}
                  className="group p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[#d8dbe1] hover:shadow-[var(--shadow-md)]"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-medium text-[#707782]">
                      {metric.label}
                    </p>
                    <span className={cn("grid size-8 place-items-center rounded-xl", metric.iconClass)}>
                      <Icon className="size-4" strokeWidth={2} aria-hidden="true" />
                    </span>
                  </div>
                  <p className="mt-5 truncate text-[27px] font-semibold tracking-[-0.04em] text-[#24272c]">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-[11px] text-[#9298a2]">{metric.detail}</p>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#eceef1] px-5 py-4 sm:px-6">
                <div>
                  <h2 className="text-sm font-semibold text-[#2c3036]">Recent inventory</h2>
                  <p className="mt-0.5 text-[11px] text-[#8b919b]">Latest additions and updates</p>
                </div>
                <Link
                  href="/inventory"
                  className="group flex items-center gap-1 text-[12px] font-semibold text-[#625ae6] hover:text-[#4e46cd]"
                >
                  View all
                  <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </div>

              {resources.length ? (
                <div className="divide-y divide-[#eff0f2]">
                  {resources.map((resource) => (
                    <Link
                      key={resource.id}
                      href={`/inventory/${resource.id}`}
                      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition hover:bg-[#fafbfc] sm:grid-cols-[minmax(0,1fr)_110px_100px] sm:px-6"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#e5e7eb] bg-[#f1f3f5] bg-cover bg-center text-[#9298a2]"
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
                          <p className="truncate text-[13px] font-semibold text-[#33373d] transition group-hover:text-[#5147d9]">
                            {resource.name}
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-[#9298a2]">
                            <span className="capitalize">{resource.type}</span>
                            <span aria-hidden="true">·</span>
                            <span>Qty {resource.quantity}</span>
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
                      <span className="text-right text-[10px] text-[#9aa0a9]">
                        {relativeDate(resource.updatedAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  className="min-h-[330px]"
                  icon={<PackagePlus className="size-5" aria-hidden="true" />}
                  title="Your inventory is ready"
                  description="Add your first item manually, or upload a group of images and let AI do the repetitive work."
                  action={
                    <Link
                      href="/inventory/new"
                      className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#635bff] px-3.5 text-[12px] font-semibold text-white shadow-sm hover:bg-[#5147f5]"
                    >
                      <PlusIcon />
                      Add first item
                    </Link>
                  }
                />
              )}
            </Card>

            <div className="space-y-5">
              <Card className="p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[#2c3036]">Inventory mix</h2>
                    <p className="mt-0.5 text-[11px] text-[#8b919b]">Items by type</p>
                  </div>
                  <span className="grid size-8 place-items-center rounded-xl bg-[#f1f2f5] text-[#777e89]">
                    <Layers3 className="size-4" aria-hidden="true" />
                  </span>
                </div>
                {stats.byType.length ? (
                  <div className="mt-6 space-y-4">
                    {stats.byType.slice(0, 6).map((item, index) => (
                      <div key={item.type}>
                        <div className="mb-1.5 flex items-center justify-between text-[11px]">
                          <span className="font-medium text-[#5d646f]">
                            {typeLabels[item.type] ?? item.type}
                          </span>
                          <span className="tabular-nums text-[#9399a3]">{item.value}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#eef0f2]">
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
                  <p className="mt-6 rounded-xl bg-[#f8f9fa] p-4 text-center text-[12px] text-[#8b919b]">
                    Item types will appear here.
                  </p>
                )}
              </Card>

              <Card className="relative overflow-hidden border-[#dedcff] bg-gradient-to-br from-[#f7f6ff] to-white p-5 sm:p-6">
                <div className="absolute -right-12 -top-14 size-32 rounded-full bg-[#635bff]/10 blur-2xl" />
                <span className="relative grid size-9 place-items-center rounded-xl bg-[#635bff] text-white shadow-[0_6px_16px_rgba(99,91,255,0.22)]">
                  <Sparkles className="size-4" aria-hidden="true" />
                </span>
                <h2 className="relative mt-4 text-sm font-semibold text-[#322f66]">Turn photos into records</h2>
                <p className="relative mt-1.5 text-[12px] leading-5 text-[#706d91]">
                  Upload images in batches, then generate titles, details, tags, and polished covers with AI.
                </p>
                <Link
                  href="/batch"
                  className="relative mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#574fd4] hover:text-[#443cbd]"
                >
                  Open batch studio
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Card>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlusIcon() {
  return <PackagePlus className="size-3.5" aria-hidden="true" />;
}
