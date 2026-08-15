"use client";

import {
  OrganizationLink as Link,
  useOrganizationReadOnly,
} from "@/components/organization-routing";
import { useT } from "next-i18next/client";
import {
  ArrowRight,
  Box,
  Camera,
  Car,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Columns3,
  Grid2X2,
  Layers3,
  List,
  MapPin,
  PackageOpen,
  Plus,
  Search,
  Shirt,
  Sparkles,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchJson, type ClientResource } from "@/lib/client-types";

type Pagination = { page: number; pageSize: number; total: number; pages: number };
type View = "grid" | "table";

type InventoryTypeOption = { key: string; label: string };

const fallbackTypeKeys = [
  "tool",
  "object",
  "furniture",
  "vehicle",
  "place",
  "clothing",
  "person",
  "project",
  "other",
] as const;

const builtInTypeKeys = new Set<string>(fallbackTypeKeys);

const statusStyles: Record<string, string> = {
  available: "bg-success-soft text-success ring-success-border",
  "in-use": "bg-info-soft text-info ring-info-border",
  maintenance: "bg-warning-soft text-warning ring-warning-border",
  archived: "bg-surface-muted text-muted ring-border-strong/40",
};

const typeIcons = {
  tool: Wrench,
  object: Box,
  furniture: Columns3,
  vehicle: Car,
  place: MapPin,
  clothing: Shirt,
  person: CircleUserRound,
  project: Layers3,
  other: PackageOpen,
} as const;

const formatValue = (cents: number | null, currency: string, locale: string) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(cents / 100);

function ResourceVisual({ resource }: { resource: ClientResource }) {
  const Icon = typeIcons[resource.type as keyof typeof typeIcons] ?? Box;
  if (resource.cover?.url) {
    return (
      // Stored images use an authenticated same-origin route and cannot use next/image.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resource.cover.url}
        alt={resource.cover.altText || resource.name}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-success-soft to-surface-muted text-muted">
      <Icon size={42} strokeWidth={1.35} />
    </div>
  );
}

export function InventoryClient({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const { t, i18n } = useT("inventory");
  const isReadOnly = useOrganizationReadOnly();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const normalizedInitialQuery = initialQuery.trim();
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 24,
    total: 0,
    pages: 1,
  });
  const [query, setQuery] = useState(normalizedInitialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedInitialQuery);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>("grid");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventoryTypes, setInventoryTypes] = useState<InventoryTypeOption[]>([]);

  useEffect(() => {
    setQuery(normalizedInitialQuery);
    setDebouncedQuery(normalizedInitialQuery);
    setPage(1);
  }, [normalizedInitialQuery]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ types: InventoryTypeOption[] }>("/api/v1/inventory-types", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((result) => setInventoryTypes(result.types))
      .catch(() => {
        // Keep built-in fallbacks available if type metadata cannot be loaded.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError(null);
    const search = new URLSearchParams({
      page: String(page),
      pageSize: "24",
      type,
      status,
    });
    if (debouncedQuery) search.set("q", debouncedQuery);
    try {
      const result = await fetchJson<{
        resources: ClientResource[];
        pagination: Pagination;
      }>(`/api/v1/resources?${search}`);
      setResources(result.resources);
      setPagination(result.pagination);
    } catch {
      setError(t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, page, status, t, type]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const activeFilters = useMemo(
    () => Number(type !== "all") + Number(status !== "all") + Number(Boolean(query)),
    [query, status, type],
  );
  const typeOptions = useMemo<InventoryTypeOption[]>(
    () =>
      inventoryTypes.length
        ? inventoryTypes.map((option) => ({
            ...option,
            label: builtInTypeKeys.has(option.key)
              ? t(`types.${option.key}`, { defaultValue: option.label })
              : option.label,
          }))
        : fallbackTypeKeys.map((key) => ({ key, label: t(`types.${key}`) })),
    [inventoryTypes, t],
  );
  const typeLabel = (key: string) => {
    if (builtInTypeKeys.has(key)) {
      return t(`typeSingular.${key}`, { defaultValue: key });
    }
    return inventoryTypes.find((option) => option.key === key)?.label ?? key;
  };
  const statusLabel = (value: string) =>
    t(`statuses.${value}`, { defaultValue: value.replaceAll("-", " ") });

  const clearFilters = () => {
    setQuery("");
    setType("all");
    setStatus("all");
    setPage(1);
  };

  return (
    <div className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-success">
            <Warehouse size={14} /> {t("list.eyebrow")}
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
            {t("list.title")}
          </h1>
        </div>
        {!isReadOnly ? <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/batch"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-muted-strong shadow-sm transition hover:border-border-strong hover:bg-surface-subtle"
          >
            <Camera size={16} /> {t("actions.batchCapture")}
          </Link>
          <Link
            href="/inventory/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong shadow-sm transition hover:bg-success"
          >
            <Plus size={16} /> {t("actions.addItem")}
          </Link>
        </div> : null}
      </div>

      <section className="mb-5 rounded-2xl border border-border/80 bg-surface p-3 shadow-[var(--shadow-sm)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("search.label")}</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              className="h-11 w-full rounded-xl border border-border bg-surface-subtle/70 pl-10 pr-10 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-success focus:bg-surface focus:ring-4 focus:ring-success-border"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-muted-strong"
                aria-label={t("search.clear")}
              >
                <X size={15} />
              </button>
            ) : null}
          </label>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              className="h-11 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-muted-strong outline-none focus:border-success focus:ring-4 focus:ring-success-border"
              aria-label={t("filters.typeLabel")}
            >
              <option value="all">{t("filters.allTypes")}</option>
              {typeOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-11 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-muted-strong outline-none focus:border-success focus:ring-4 focus:ring-success-border"
              aria-label={t("filters.statusLabel")}
            >
              <option value="all">{t("filters.allStatuses")}</option>
              <option value="available">{t("statuses.available")}</option>
              <option value="in-use">{t("statuses.in-use")}</option>
              <option value="maintenance">{t("statuses.maintenance")}</option>
              <option value="archived">{t("statuses.archived")}</option>
            </select>
          </div>
          <div className="hidden h-7 w-px bg-surface-hover lg:block" />
          <div className="flex items-center justify-between gap-2">
            {activeFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="px-2 text-xs font-semibold text-muted hover:text-foreground"
              >
                {t("filters.clearActive", {
                  count: activeFilters,
                  value: integer.format(activeFilters),
                })}
              </button>
            ) : (
              <span className="px-2 text-xs font-medium text-muted">
                {t("filters.records", {
                  count: pagination.total,
                  value: integer.format(pagination.total),
                })}
              </span>
            )}
            <div className="flex rounded-xl bg-surface-muted p-1">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                  view === "grid" ? "bg-surface text-foreground shadow-sm" : "text-muted"
                }`}
                aria-label={t("views.grid")}
              >
                <Grid2X2 size={16} />
              </button>
              <button
                type="button"
                onClick={() => setView("table")}
                className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                  view === "table" ? "bg-surface text-foreground shadow-sm" : "text-muted"
                }`}
                aria-label={t("views.table")}
              >
                <List size={17} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="mb-5 rounded-2xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          className={`grid gap-4 ${view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : "grid-cols-1"}`}
          aria-label={t("loading")}
        >
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-72 animate-pulse rounded-2xl border border-border bg-surface"
            />
          ))}
        </div>
      ) : resources.length === 0 ? (
        <div className="flex min-h-[440px] flex-col items-center justify-center rounded-3xl border border-dashed border-border-strong bg-surface px-6 text-center">
          <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-success-soft text-success">
            {activeFilters ? <Search size={27} /> : <PackageOpen size={28} />}
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {activeFilters ? t("empty.filteredTitle") : t("empty.title")}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">
            {activeFilters
              ? t("empty.filteredDescription")
              : t("empty.description")}
          </p>
          {activeFilters || !isReadOnly ? <div className="mt-5 flex gap-2">
            {activeFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-muted-strong"
              >
                {t("filters.clear")}
              </button>
            ) : (
              <>
                <Link
                  href="/inventory/new"
                  className="rounded-xl bg-strong px-4 py-2 text-sm font-semibold text-on-strong"
                >
                  {t("actions.addAnItem")}
                </Link>
                <Link
                  href="/batch"
                  className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-muted-strong"
                >
                  {t("actions.batchCapture")}
                </Link>
              </>
            )}
          </div> : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {resources.map((resource) => (
            <Link
              key={resource.id}
              href={`/inventory/${resource.id}`}
              className="group overflow-hidden rounded-2xl border border-border/90 bg-surface shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
            >
              <div className="relative aspect-square overflow-hidden bg-surface-muted">
                <ResourceVisual resource={resource} />
                <span
                  className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}
                >
                  {statusLabel(resource.status)}
                </span>
                {resource.aiMetadata?.generatedFields?.length ? (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
                    <Sparkles size={11} /> {t("item.aiEnriched")}
                  </span>
                ) : null}
              </div>
              <div className="p-4">
                <div className="mb-1 flex items-start justify-between gap-3">
                  <h2 className="line-clamp-1 font-semibold tracking-[-0.01em] text-foreground">
                    {resource.name}
                  </h2>
                  <ArrowRight
                    size={16}
                    className="mt-0.5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-muted-strong"
                  />
                </div>
                <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted">
                  {resource.description || t("item.noDescription")}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
                  <div className="flex min-w-0 items-center gap-1.5 text-muted">
                    <MapPin size={13} className="shrink-0" />
                    <span className="truncate">
                      {resource.location || t("item.noLocation")}
                    </span>
                  </div>
                  <span className="ml-3 shrink-0 font-semibold text-muted-strong">
                    {formatValue(resource.valueCents, resource.currency, locale)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(280px,2fr)_140px_120px_minmax(160px,1fr)_110px_36px] gap-4 border-b border-border bg-surface-subtle/80 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted lg:grid">
            <span>{t("table.item")}</span>
            <span>{t("table.status")}</span>
            <span>{t("table.sku")}</span>
            <span>{t("table.location")}</span>
            <span>{t("table.value")}</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {resources.map((resource) => (
              <Link
                key={resource.id}
                href={`/inventory/${resource.id}`}
                className="group grid gap-3 px-4 py-3 transition hover:bg-surface-subtle lg:grid-cols-[minmax(280px,2fr)_140px_120px_minmax(160px,1fr)_110px_36px] lg:items-center lg:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                    <ResourceVisual resource={resource} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{resource.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">
                      {typeLabel(resource.type)} · {t("item.units", {
                        count: resource.quantity,
                        value: integer.format(resource.quantity),
                      })}
                    </div>
                  </div>
                </div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}>
                  {statusLabel(resource.status)}
                </span>
                <span className="truncate font-mono text-xs text-muted">{resource.sku || "—"}</span>
                <span className="truncate text-xs text-muted">{resource.location || "—"}</span>
                <span className="text-xs font-semibold text-muted-strong">
                  {formatValue(resource.valueCents, resource.currency, locale)}
                </span>
                <ArrowRight size={16} className="hidden text-muted transition group-hover:translate-x-0.5 group-hover:text-muted-strong lg:block" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {!loading && pagination.pages > 1 ? (
        <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
          <p className="text-xs text-muted">
            {t("pagination.summary", {
              count: pagination.total,
              page: integer.format(pagination.page),
              pages: integer.format(pagination.pages),
              total: integer.format(pagination.total),
            })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-muted-strong disabled:opacity-40"
            >
              <ChevronLeft size={15} /> {t("pagination.previous")}
            </button>
            <button
              type="button"
              disabled={page >= pagination.pages}
              onClick={() => setPage((value) => Math.min(pagination.pages, value + 1))}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-muted-strong disabled:opacity-40"
            >
              {t("pagination.next")} <ChevronRight size={15} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
