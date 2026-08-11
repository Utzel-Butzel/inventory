"use client";

import Link from "next/link";
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
  Sheet,
  Search,
  Shirt,
  Sparkles,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CsvImportExport } from "@/components/csv-import-export";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type Pagination = { page: number; pageSize: number; total: number; pages: number };
type View = "grid" | "table";

type InventoryTypeOption = { key: string; label: string };

const fallbackTypeOptions: InventoryTypeOption[] = [
  { key: "tool", label: "Tools" },
  { key: "object", label: "Objects" },
  { key: "furniture", label: "Furniture" },
  { key: "vehicle", label: "Vehicles" },
  { key: "place", label: "Places" },
  { key: "clothing", label: "Clothing" },
  { key: "person", label: "People" },
  { key: "project", label: "Projects" },
  { key: "other", label: "Other" },
];

const statusStyles: Record<string, string> = {
  available: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  "in-use": "bg-blue-50 text-blue-700 ring-blue-600/15",
  maintenance: "bg-amber-50 text-amber-800 ring-amber-600/20",
  archived: "bg-slate-100 text-slate-600 ring-slate-500/15",
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

const formatValue = (cents: number | null, currency: string) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat(undefined, {
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
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#e1faf0,transparent_46%),linear-gradient(135deg,#f4f7f5,#e7ece9)] text-slate-400">
      <Icon size={42} strokeWidth={1.35} />
    </div>
  );
}

export function InventoryClient({ canWrite = false }: { canWrite?: boolean }) {
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: 24,
    total: 0,
    pages: 1,
  });
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>("grid");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inventoryTypes, setInventoryTypes] = useState<InventoryTypeOption[]>(
    fallbackTypeOptions,
  );

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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load inventory.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, page, status, type]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const activeFilters = useMemo(
    () => Number(type !== "all") + Number(status !== "all") + Number(Boolean(query)),
    [query, status, type],
  );

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
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            <Warehouse size={14} /> Inventory library
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
            Everything, findable.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Search every tool, object, space and kit. Add media, enrich records with AI,
            and keep the physical world organized.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/batch"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Camera size={16} /> Batch capture
          </Link>
          <Link
            href="/inventory/new"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900"
          >
            <Plus size={16} /> Add item
          </Link>
        </div>
      </div>

      <section className="mb-5 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search inventory</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, description, SKU, tag or location…"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/70 pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label="Clear search"
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
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
              aria-label="Filter by type"
            >
              <option value="all">All types</option>
              {inventoryTypes.map((option) => (
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
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="available">Available</option>
              <option value="in-use">In use</option>
              <option value="maintenance">Maintenance</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="hidden h-7 w-px bg-slate-200 lg:block" />
          <div className="flex items-center justify-between gap-2">
            {activeFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="px-2 text-xs font-semibold text-slate-500 hover:text-slate-950"
              >
                Clear {activeFilters} {activeFilters === 1 ? "filter" : "filters"}
              </button>
            ) : (
              <span className="px-2 text-xs font-medium text-slate-400">
                {pagination.total} records
              </span>
            )}
            <div className="flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                  view === "grid" ? "bg-white text-slate-950 shadow-sm" : "text-slate-400"
                }`}
                aria-label="Grid view"
              >
                <Grid2X2 size={16} />
              </button>
              <button
                type="button"
                onClick={() => setView("table")}
                className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                  view === "table" ? "bg-white text-slate-950 shadow-sm" : "text-slate-400"
                }`}
                aria-label="Table view"
              >
                <List size={17} />
              </button>
            </div>
          </div>
        </div>
      </section>

      <details className="group mb-5 rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-700 marker:content-none">
          <Sheet size={16} className="text-emerald-700" aria-hidden="true" />
          CSV import and export
          <span className="ml-auto text-xs font-medium text-slate-400 group-open:hidden">
            Open
          </span>
        </summary>
        <div className="border-t border-slate-100 p-3">
          <CsvImportExport
            allowImport={canWrite}
            inventoryTypeKeys={inventoryTypes.map((option) => option.key)}
            onImported={() => void loadResources()}
          />
        </div>
      </details>

      {error ? (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          className={`grid gap-4 ${view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : "grid-cols-1"}`}
          aria-label="Loading inventory"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white"
            />
          ))}
        </div>
      ) : resources.length === 0 ? (
        <div className="flex min-h-[440px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 text-center">
          <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
            {activeFilters ? <Search size={27} /> : <PackageOpen size={28} />}
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">
            {activeFilters ? "No matching items" : "Your inventory is ready"}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            {activeFilters
              ? "Try a broader search or clear the active filters."
              : "Add your first record manually, or use batch capture to photograph and catalogue it with AI."}
          </p>
          <div className="mt-5 flex gap-2">
            {activeFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Clear filters
              </button>
            ) : (
              <>
                <Link
                  href="/inventory/new"
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
                >
                  Add an item
                </Link>
                <Link
                  href="/batch"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Batch capture
                </Link>
              </>
            )}
          </div>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {resources.map((resource) => (
            <Link
              key={resource.id}
              href={`/inventory/${resource.id}`}
              className="group overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_12px_35px_rgba(15,23,42,0.08)]"
            >
              <div className="relative aspect-square overflow-hidden bg-slate-100">
                <ResourceVisual resource={resource} />
                <span
                  className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}
                >
                  {resource.status.replace("-", " ")}
                </span>
                {resource.aiMetadata?.generatedFields?.length ? (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur">
                    <Sparkles size={11} /> AI enriched
                  </span>
                ) : null}
              </div>
              <div className="p-4">
                <div className="mb-1 flex items-start justify-between gap-3">
                  <h2 className="line-clamp-1 font-semibold tracking-[-0.01em] text-slate-950">
                    {resource.name}
                  </h2>
                  <ArrowRight
                    size={16}
                    className="mt-0.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-700"
                  />
                </div>
                <p className="line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">
                  {resource.description || "No description yet."}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                  <div className="flex min-w-0 items-center gap-1.5 text-slate-500">
                    <MapPin size={13} className="shrink-0" />
                    <span className="truncate">{resource.location || "No location"}</span>
                  </div>
                  <span className="ml-3 shrink-0 font-semibold text-slate-800">
                    {formatValue(resource.valueCents, resource.currency)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="hidden grid-cols-[minmax(280px,2fr)_140px_120px_minmax(160px,1fr)_110px_36px] gap-4 border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:grid">
            <span>Item</span><span>Status</span><span>SKU</span><span>Location</span><span>Value</span><span />
          </div>
          <div className="divide-y divide-slate-100">
            {resources.map((resource) => (
              <Link
                key={resource.id}
                href={`/inventory/${resource.id}`}
                className="group grid gap-3 px-4 py-3 transition hover:bg-slate-50 lg:grid-cols-[minmax(280px,2fr)_140px_120px_minmax(160px,1fr)_110px_36px] lg:items-center lg:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                    <ResourceVisual resource={resource} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{resource.name}</div>
                    <div className="mt-0.5 truncate text-xs capitalize text-slate-400">{resource.type} · {resource.quantity} unit{resource.quantity === 1 ? "" : "s"}</div>
                  </div>
                </div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}>
                  {resource.status.replace("-", " ")}
                </span>
                <span className="truncate font-mono text-xs text-slate-500">{resource.sku || "—"}</span>
                <span className="truncate text-xs text-slate-500">{resource.location || "—"}</span>
                <span className="text-xs font-semibold text-slate-800">{formatValue(resource.valueCents, resource.currency)}</span>
                <ArrowRight size={16} className="hidden text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-800 lg:block" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {!loading && pagination.pages > 1 ? (
        <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-5">
          <p className="text-xs text-slate-500">
            Page {pagination.page} of {pagination.pages} · {pagination.total} items
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"
            >
              <ChevronLeft size={15} /> Previous
            </button>
            <button
              type="button"
              disabled={page >= pagination.pages}
              onClick={() => setPage((value) => Math.min(pagination.pages, value + 1))}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
