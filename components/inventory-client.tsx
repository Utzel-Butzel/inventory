"use client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { useT } from "next-i18next/client";
import {
  ArrowRight,
  Box,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  CodeXml,
  Columns3,
  Grid2X2,
  Layers3,
  List,
  ListChecks,
  LoaderCircle,
  MapPin,
  PackageOpen,
  Search,
  Shirt,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchJson, type ClientResource } from "@/lib/client-types";
import {
  INVENTORY_PAGE_SIZE_OPTIONS,
  normalizeInventoryPageSize,
  type InventoryPageSize,
} from "@/lib/inventory-pagination";
import { markdownToPlainText } from "@/lib/simple-markdown";

type Pagination = { page: number; pageSize: number; total: number; pages: number };
type View = "grid" | "table";
type BatchForm = {
  status: string;
  type: string;
  priority: string;
  location: string;
  addTags: string;
};

type InventoryTypeOption = { key: string; label: string };

const MAX_BATCH_SELECTION = 100;

const emptyBatchForm: BatchForm = {
  status: "",
  type: "",
  priority: "",
  location: "",
  addTags: "",
};

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
        className="h-full w-full object-cover"
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
  initialPageSize,
  developerMode = false,
}: {
  initialQuery?: string;
  initialPageSize?: number;
  developerMode?: boolean;
}) {
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const normalizedInitialQuery = initialQuery.trim();
  const normalizedInitialPageSize = normalizeInventoryPageSize(initialPageSize);
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: normalizedInitialPageSize,
    total: 0,
    pages: 1,
  });
  const [query, setQuery] = useState(normalizedInitialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedInitialQuery);
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<InventoryPageSize>(
    normalizedInitialPageSize,
  );
  const [view, setView] = useState<View>("grid");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inventoryTypes, setInventoryTypes] = useState<InventoryTypeOption[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchForm, setBatchForm] = useState<BatchForm>(emptyBatchForm);
  const [applyLocation, setApplyLocation] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);

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
      pageSize: String(pageSize),
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
  }, [debouncedQuery, page, pageSize, status, t, type]);

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
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pageIds = useMemo(() => resources.map((resource) => resource.id), [resources]);
  const pageIsSelected =
    pageIds.length > 0 && pageIds.every((resourceId) => selectedSet.has(resourceId));

  const clearFilters = () => {
    setQuery("");
    setType("all");
    setStatus("all");
    setPage(1);
  };

  const clearSelection = () => {
    setError(null);
    setSelectedIds([]);
    setBatchForm(emptyBatchForm);
    setApplyLocation(false);
  };

  const toggleSelectionMode = () => {
    if (selectionMode) clearSelection();
    setSelectionMode(!selectionMode);
    setError(null);
    setNotice(null);
  };

  const toggleResourceSelection = (resourceId: string) => {
    if (selectedSet.has(resourceId)) {
      setError(null);
      setSelectedIds((current) => current.filter((id) => id !== resourceId));
      return;
    }
    if (selectedIds.length >= MAX_BATCH_SELECTION) {
      setError(
        t("batchSelection.errors.limit", {
          max: integer.format(MAX_BATCH_SELECTION),
        }),
      );
      return;
    }
    setError(null);
    setSelectedIds((current) => [...current, resourceId]);
  };

  const togglePageSelection = () => {
    if (pageIsSelected) {
      const currentPageIds = new Set(pageIds);
      setError(null);
      setSelectedIds((current) => current.filter((id) => !currentPageIds.has(id)));
      return;
    }
    const additions = pageIds.filter((id) => !selectedSet.has(id));
    const remainingCapacity = MAX_BATCH_SELECTION - selectedIds.length;
    if (remainingCapacity <= 0) {
      setError(
        t("batchSelection.errors.limit", {
          max: integer.format(MAX_BATCH_SELECTION),
        }),
      );
      return;
    }
    const selectedAdditions = additions.slice(0, remainingCapacity);
    setSelectedIds((current) => [...current, ...selectedAdditions]);
    setError(
      selectedAdditions.length < additions.length
        ? t("batchSelection.errors.limit", {
            max: integer.format(MAX_BATCH_SELECTION),
          })
        : null,
    );
  };

  const applyBatch = async () => {
    if (!selectedIds.length) return;
    const changes: Record<string, unknown> = {};
    if (batchForm.status) changes.status = batchForm.status;
    if (batchForm.type) changes.type = batchForm.type;
    if (batchForm.priority) changes.priority = Number(batchForm.priority);
    if (applyLocation) changes.location = batchForm.location.trim() || null;
    const addTags = batchForm.addTags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    if (!Object.keys(changes).length && !addTags.length) {
      setError(t("batchSelection.errors.noChanges"));
      return;
    }

    const selectedCount = selectedIds.length;
    setBatchSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson<{ updated: number; ids: string[] }>("/api/v1/resources/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, changes, addTags }),
      });
      clearSelection();
      setSelectionMode(false);
      await loadResources();
      setNotice(
        t("batchSelection.notices.updated", {
          count: selectedCount,
          value: integer.format(selectedCount),
        }),
      );
    } catch {
      setError(t("batchSelection.errors.update"));
    } finally {
      setBatchSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-7">
        <h1 className="text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
          {t("list.title")}
        </h1>
      </div>

      <section className="mb-5 rounded-xl border border-border bg-surface p-3">
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
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${
                selectionMode
                  ? "border-success-border bg-success-soft text-success"
                  : "border-border bg-surface text-muted-strong hover:bg-surface-hover"
              }`}
              aria-label={
                selectionMode
                  ? t("batchSelection.finish")
                  : t("batchSelection.start")
              }
              aria-pressed={selectionMode}
            >
              <ListChecks size={16} />
              <span className="hidden sm:inline">
                {selectionMode
                  ? t("batchSelection.finish")
                  : t("batchSelection.start")}
              </span>
            </button>
            <div className="flex rounded-xl bg-surface-muted p-1">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                  view === "grid" ? "bg-surface text-foreground shadow-sm" : "text-muted"
                }`}
                aria-label={t("views.grid")}
                aria-pressed={view === "grid"}
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
                aria-pressed={view === "table"}
              >
                <List size={17} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="mb-5 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="mb-5 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          {notice}
        </div>
      ) : null}

      {selectionMode ? (
        <section className="mb-5 rounded-xl border border-success-border bg-success-soft/60 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={togglePageSelection}
                disabled={
                  !pageIds.length ||
                  loading ||
                  (!pageIsSelected && selectedIds.length >= MAX_BATCH_SELECTION)
                }
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-success-border bg-surface px-3 text-xs font-semibold text-success disabled:opacity-40"
              >
                <span
                  className={`grid size-4 place-items-center rounded border ${
                    pageIsSelected
                      ? "border-success bg-success text-on-brand"
                      : "border-border-strong bg-surface"
                  }`}
                  aria-hidden="true"
                >
                  {pageIsSelected ? <Check size={11} /> : null}
                </span>
                {pageIsSelected
                  ? t("batchSelection.deselectPage")
                  : selectedIds.length >= MAX_BATCH_SELECTION
                    ? t("batchSelection.limitReached", {
                        max: integer.format(MAX_BATCH_SELECTION),
                      })
                    : t("batchSelection.selectPage")}
              </button>
              <span className="text-xs font-semibold text-muted-strong" aria-live="polite">
                {t("batchSelection.selected", {
                  count: selectedIds.length,
                  value: integer.format(selectedIds.length),
                })}
              </span>
            </div>
            {selectedIds.length ? (
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs font-semibold text-muted hover:text-foreground"
              >
                {t("batchSelection.clear")}
              </button>
            ) : null}
          </div>

          {selectedIds.length ? (
            <form
              className="mt-4 border-t border-success-border pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void applyBatch();
              }}
            >
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("batchSelection.title")}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {t("batchSelection.description")}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-semibold text-muted-strong">
                  {t("batchSelection.fields.status")}
                  <select
                    value={batchForm.status}
                    onChange={(event) =>
                      setBatchForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none focus:border-success focus:ring-4 focus:ring-success-border"
                  >
                    <option value="">{t("batchSelection.keepStatus")}</option>
                    <option value="available">{t("statuses.available")}</option>
                    <option value="in-use">{t("statuses.in-use")}</option>
                    <option value="maintenance">{t("statuses.maintenance")}</option>
                    <option value="archived">{t("statuses.archived")}</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-muted-strong">
                  {t("batchSelection.fields.type")}
                  <select
                    value={batchForm.type}
                    onChange={(event) =>
                      setBatchForm((current) => ({
                        ...current,
                        type: event.target.value,
                      }))
                    }
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none focus:border-success focus:ring-4 focus:ring-success-border"
                  >
                    <option value="">{t("batchSelection.keepType")}</option>
                    {typeOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-muted-strong">
                  {t("batchSelection.fields.priority")}
                  <select
                    value={batchForm.priority}
                    onChange={(event) =>
                      setBatchForm((current) => ({
                        ...current,
                        priority: event.target.value,
                      }))
                    }
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none focus:border-success focus:ring-4 focus:ring-success-border"
                  >
                    <option value="">{t("batchSelection.keepPriority")}</option>
                    {[1, 2, 3, 4, 5].map((priority) => (
                      <option key={priority} value={priority}>
                        {t("batchSelection.priority", {
                          value: integer.format(priority),
                        })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-muted-strong sm:col-span-2">
                  {t("batchSelection.fields.tags")}
                  <input
                    value={batchForm.addTags}
                    onChange={(event) =>
                      setBatchForm((current) => ({
                        ...current,
                        addTags: event.target.value,
                      }))
                    }
                    placeholder={t("batchSelection.addTagsPlaceholder")}
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none placeholder:text-muted focus:border-success focus:ring-4 focus:ring-success-border"
                  />
                </label>
                <div className="text-xs font-semibold text-muted-strong">
                  <span>{t("batchSelection.fields.location")}</span>
                  <label className="mt-1.5 flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3">
                    <input
                      type="checkbox"
                      checked={applyLocation}
                      onChange={(event) => setApplyLocation(event.target.checked)}
                      className="size-4 accent-brand-solid"
                    />
                    {t("batchSelection.changeLocation")}
                  </label>
                </div>
                {applyLocation ? (
                  <label className="text-xs font-semibold text-muted-strong sm:col-span-2 lg:col-span-3">
                    {t("batchSelection.locationValue")}
                    <input
                      value={batchForm.location}
                      onChange={(event) =>
                        setBatchForm((current) => ({
                          ...current,
                          location: event.target.value,
                        }))
                      }
                      placeholder={t("batchSelection.locationPlaceholder")}
                      className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none placeholder:text-muted focus:border-success focus:ring-4 focus:ring-success-border"
                    />
                  </label>
                ) : null}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={batchSaving}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-xs font-semibold text-on-strong disabled:opacity-50"
                >
                  {batchSaving ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <ListChecks size={15} />
                  )}
                  {batchSaving
                    ? t("batchSelection.applying")
                    : t("batchSelection.apply")}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <div
          className={`grid gap-4 ${view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : "grid-cols-1"}`}
          aria-label={t("loading")}
        >
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-72 animate-pulse rounded-xl border border-border bg-surface"
            />
          ))}
        </div>
      ) : resources.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface px-6 py-8 text-center">
          <div className="mb-3 grid size-10 place-items-center rounded-lg bg-surface-subtle text-muted">
            {activeFilters ? <Search size={20} /> : <PackageOpen size={20} />}
          </div>
          <h2 className="text-base font-semibold text-foreground">
            {activeFilters ? t("empty.filteredTitle") : t("empty.title")}
          </h2>
          <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-muted">
            {activeFilters
              ? t("empty.filteredDescription")
              : t("empty.description")}
          </p>
          {activeFilters ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-muted-strong"
              >
                {t("filters.clear")}
              </button>
            </div>
          ) : null}
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {resources.map((resource) => {
            const selected = selectedSet.has(resource.id);
            const content = (
              <>
                <div className="relative aspect-square overflow-hidden bg-surface-muted">
                  <ResourceVisual resource={resource} />
                  <span
                    className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}
                  >
                    {statusLabel(resource.status)}
                  </span>
                  {selectionMode ? (
                    <span
                      className={`absolute right-3 top-3 grid size-7 place-items-center rounded-lg border shadow-sm ${
                        selected
                          ? "border-success bg-success text-on-brand"
                          : "border-border-strong bg-surface/95 text-transparent"
                      }`}
                      aria-hidden="true"
                    >
                      <Check size={16} />
                    </span>
                  ) : null}
                </div>
                <div className="p-4 text-left">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <h2 className="line-clamp-1 font-semibold tracking-[-0.01em] text-foreground">
                      {resource.name}
                    </h2>
                    {!selectionMode ? (
                      <ArrowRight
                        size={16}
                        className="mt-0.5 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-muted-strong"
                      />
                    ) : null}
                  </div>
                  <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted">
                    {markdownToPlainText(resource.description) ||
                      t("item.noDescription")}
                  </p>
                  {developerMode ? (
                    <div className="mt-3 flex min-w-0 items-center gap-2 rounded-lg border border-brand-border bg-brand-soft/60 px-2.5 py-2 text-[10px] text-brand">
                      <CodeXml className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="shrink-0 font-semibold">GET</span>
                      <code className="truncate font-mono">
                        /api/v1/resources/{resource.id}
                      </code>
                    </div>
                  ) : null}
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
              </>
            );
            const cardClass = `group block w-full overflow-hidden rounded-xl border bg-surface transition-colors ${
              selected
                ? "border-success ring-2 ring-success-border"
                : "border-border hover:border-border-strong"
            }`;
            return selectionMode ? (
              <button
                key={resource.id}
                type="button"
                onClick={() => toggleResourceSelection(resource.id)}
                className={cardClass}
                aria-label={
                  selected
                    ? t("batchSelection.itemDeselect", { name: resource.name })
                    : t("batchSelection.itemSelect", { name: resource.name })
                }
                aria-pressed={selected}
              >
                {content}
              </button>
            ) : (
              <Link
                key={resource.id}
                href={`/inventory/${resource.id}`}
                className={cardClass}
              >
                {content}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(280px,2fr)_140px_120px_minmax(160px,1fr)_110px_36px] gap-4 border-b border-border bg-surface-subtle/80 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted lg:grid">
            <span>{t("table.item")}</span>
            <span>{t("table.status")}</span>
            <span>{t("table.sku")}</span>
            <span>{t("table.location")}</span>
            <span>{t("table.value")}</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {resources.map((resource) => {
              const selected = selectedSet.has(resource.id);
              const content = (
                <>
                  <div className="flex min-w-0 items-center gap-3">
                    {selectionMode ? (
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-md border ${
                          selected
                            ? "border-success bg-success text-on-brand"
                            : "border-border-strong bg-surface text-transparent"
                        }`}
                        aria-hidden="true"
                      >
                        <Check size={12} />
                      </span>
                    ) : null}
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
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
                      {developerMode ? (
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-brand">
                          <CodeXml className="size-3 shrink-0" aria-hidden="true" />
                          <span className="shrink-0 font-semibold">GET</span>
                          <code className="truncate font-mono">
                            /api/v1/resources/{resource.id}
                          </code>
                        </div>
                      ) : null}
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
                  {!selectionMode ? (
                    <ArrowRight size={16} className="hidden text-muted transition group-hover:translate-x-0.5 group-hover:text-muted-strong lg:block" />
                  ) : (
                    <span className="hidden lg:block" />
                  )}
                </>
              );
              const rowClass = `group grid w-full gap-3 px-4 py-3 text-left transition lg:grid-cols-[minmax(280px,2fr)_140px_120px_minmax(160px,1fr)_110px_36px] lg:items-center lg:gap-4 ${
                selected ? "bg-success-soft/70" : "hover:bg-surface-subtle"
              }`;
              return selectionMode ? (
                <button
                  key={resource.id}
                  type="button"
                  onClick={() => toggleResourceSelection(resource.id)}
                  className={rowClass}
                  aria-label={
                    selected
                      ? t("batchSelection.itemDeselect", { name: resource.name })
                      : t("batchSelection.itemSelect", { name: resource.name })
                  }
                  aria-pressed={selected}
                >
                  {content}
                </button>
              ) : (
                <Link
                  key={resource.id}
                  href={`/inventory/${resource.id}`}
                  className={rowClass}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {!loading && resources.length > 0 ? (
        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">
            {t("pagination.summary", {
              count: pagination.total,
              page: integer.format(pagination.page),
              pages: integer.format(pagination.pages),
              total: integer.format(pagination.total),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-muted-strong">
              <span>{t("pagination.pageSize")}</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(
                    normalizeInventoryPageSize(Number(event.target.value)),
                  );
                  setPage(1);
                }}
                className="cursor-pointer bg-transparent font-semibold outline-none"
                aria-label={t("pagination.pageSize")}
              >
                {INVENTORY_PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            {pagination.pages > 1 ? (
              <>
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
                  onClick={() =>
                    setPage((value) => Math.min(pagination.pages, value + 1))
                  }
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-border bg-surface px-3 text-xs font-semibold text-muted-strong disabled:opacity-40"
                >
                  {t("pagination.next")} <ChevronRight size={15} />
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
