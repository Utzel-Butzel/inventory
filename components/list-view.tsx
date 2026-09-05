"use client";

import { ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, Filter, Grid2X2, List, Plus, RotateCcw, Save, Search, Settings2, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "next-i18next/client";
import { useOrganizationId, useOrganizationSlug } from "@/components/organization-routing";
import { Alert, Button, cn } from "@/components/ui";
import { createListViewConfig, listViewCollectionSchema, orderListItems, restoreListView, sameListView, type ListViewCollection, type ListViewConfig } from "@/lib/list-view-contract";

const emptyCollection: ListViewCollection = { views: [], defaultId: null };

export function useListView(scope: string, initial: Partial<ListViewConfig> = {}) {
  const organization = useOrganizationSlug();
  const organizationId = useOrganizationId();
  const { t } = useT("common");
  const initialKey = JSON.stringify(initial);
  const defaults = useMemo(() => createListViewConfig(JSON.parse(initialKey)), [initialKey]);
  const owner = useRef(organization + ":" + scope);
  const [config, setConfig] = useState(defaults);
  const [collection, setCollection] = useState<ListViewCollection>(emptyCollection);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const interacted = useRef(false);
  const generation = useRef(0);
  const savingRef = useRef(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    ++generation.current;
    if (owner.current !== organization + ":" + scope) {
      owner.current = organization + ":" + scope;
      interacted.current = false;
      setConfig(defaults);
      setNotice(null);
    }
    setLoading(true);
    setCanSave(false);
    setError(null);
    setCollection(emptyCollection);
    setActiveId(null);
    setRevision(0);
    void fetch("/api/v1/user/list-views?scope=" + encodeURIComponent(scope), { cache: "no-store", signal: controller.signal, headers: organizationId ? { "X-Organization-ID": organizationId } : {} })
      .then(async (response) => {
        if (!response.ok) throw new Error("load");
        const result = await response.json();
        const saved = listViewCollectionSchema.parse(result.collection);
        if (controller.signal.aborted) return;
        setCollection(saved);
        setRevision(result.revision);
        setCanSave(result.canSave);
        const defaultView = saved.views.find((view) => view.id === saved.defaultId);
        if (defaultView && !interacted.current) {
          setConfig({ ...restoreListView(defaultView.config, defaults), ...(defaults.query ? { query: defaults.query } : {}) });
          setActiveId(defaultView.id);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setError(t("listView.errors.load")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organization, organizationId, scope, reload, t, defaults]);

  const patch = useCallback((value: Partial<ListViewConfig>) => {
    interacted.current = true;
    setConfig((current) => ({ ...current, ...value }));
    setNotice(null);
  }, []);
  const setFilter = useCallback((key: string, value: string) => {
    interacted.current = true;
    setConfig((current) => ({ ...current, filters: { ...current.filters, [key]: value } }));
    setNotice(null);
  }, []);
  const select = (id: string | null) => {
    interacted.current = true;
    const saved = collection.views.find((view) => view.id === id);
    setConfig(saved ? restoreListView(saved.config, defaults) : defaults);
    setActiveId(id);
    setNotice(null);
  };
  const active = collection.views.find((view) => view.id === activeId);
  const dirty = !sameListView(config, active?.config ?? defaults);

  const persist = async (next: ListViewCollection, nextId = activeId) => {
    if (savingRef.current || loading || !canSave) return false;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    const currentGeneration = generation.current;
    try {
      const response = await fetch("/api/v1/user/list-views", {
        method: "PUT", headers: { "Content-Type": "application/json", ...(organizationId ? { "X-Organization-ID": organizationId } : {}) },
        body: JSON.stringify({ scope, revision, collection: next }),
      });
      if (response.status === 409) throw new Error("conflict");
      if (!response.ok) throw new Error("save");
      const result = await response.json();
      if (generation.current !== currentGeneration) return false;
      setCollection(listViewCollectionSchema.parse(result.collection));
      setRevision(result.revision);
      setActiveId(nextId);
      setNotice(t("listView.saved"));
      return true;
    } catch (saveError) {
      if (generation.current === currentGeneration) setError(t(saveError instanceof Error && saveError.message === "conflict" ? "listView.errors.conflict" : "listView.errors.save"));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const save = async (name: string, asNew: boolean) => {
    name = name.trim();
    const id = !asNew && active ? active.id : crypto.randomUUID();
    if (!name || name.length > 80 || collection.views.some((view) => view.id !== id && view.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(t("listView.errors.name")); return false;
    }
    if (asNew && collection.views.length >= 30) { setError(t("listView.errors.limit")); return false; }
    const saved = { id, name, config };
    return persist({ ...collection, views: collection.views.some((view) => view.id === id) ? collection.views.map((view) => view.id === id ? saved : view) : [...collection.views, saved] }, id);
  };
  return {
    config, patch, setFilter, collection, active, dirty, loading, saving, canSave, error, notice,
    select, save,
    refresh: () => setReload((value) => value + 1),
    setDefault: () => persist({ ...collection, defaultId: collection.defaultId === activeId ? null : activeId }),
    remove: async () => {
      if (!activeId) return false;
      const success = await persist({ views: collection.views.filter((view) => view.id !== activeId), defaultId: collection.defaultId === activeId ? null : collection.defaultId }, null);
      if (success) setConfig(defaults);
      return success;
    },
    resetFilters: () => patch({ query: "", filters: Object.fromEntries(Object.keys(config.filters).map((key) => [key, "all"])) }),
  };
}

export type ListViewController = ReturnType<typeof useListView>;
export type ListViewOption = { value: string; label: string };
export type ListViewFilter = { key: string; label: string; options: ListViewOption[] };

/** Shared adapter for client-loaded administrative collections. */
export function useCollectionView<T>(scope: string, items: readonly T[], options: {
  search: (item: T) => string;
  sorts: Array<ListViewOption & { get: (item: T) => string | number | null | undefined }>;
  filters?: Array<ListViewFilter & { get: (item: T) => string | string[] }>;
}) {
  const { i18n } = useT("common");
  const list = useListView(scope, {
    sort: options.sorts[0]?.value ?? "default",
    filters: Object.fromEntries((options.filters ?? []).map((filter) => [filter.key, "all"])),
  });
  const query = list.config.query.trim().toLocaleLowerCase(i18n.language);
  const visibleItems = orderListItems(items.filter((item) => {
    if (query && !options.search(item).toLocaleLowerCase(i18n.language).includes(query)) return false;
    return (options.filters ?? []).every((filter) => {
      const selected = list.config.filters[filter.key];
      if (!selected || selected === "all") return true;
      const value = filter.get(item);
      return Array.isArray(value) ? value.includes(selected) : value === selected;
    });
  }), list.config, Object.fromEntries(options.sorts.map((sort) => [sort.value, sort.get])), i18n.language);
  return { list, visibleItems, sorts: options.sorts, filters: options.filters };
}

export function CollectionViewToolbar<T>({ collection }: { collection: ReturnType<typeof useCollectionView<T>> }) {
  const { t } = useT("common");
  return <>
    <ListViewToolbar list={collection.list} sorts={collection.sorts} filters={collection.filters} total={collection.visibleItems.length} />
    {!collection.visibleItems.length && (collection.list.config.query || Object.values(collection.list.config.filters).some((value) => value !== "all")) ?
      <p role="status" className="px-4 py-6 text-center text-sm text-muted">{t("listView.noResults")} · {t("listView.noResultsHint")}</p> : null}
  </>;
}
const controlClass = "h-9 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus";
const summaryClass = "inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-muted-strong transition hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden";
const panelClass = "absolute left-3 right-3 top-full z-30 mt-2 max-h-[70dvh] overflow-y-auto w-auto sm:left-0 sm:right-auto sm:w-72 max-w-[calc(100vw-3rem)] space-y-3 rounded-xl border border-border bg-surface p-4 shadow-xl";

export function ListViewToolbar({ list, filters = [], sorts, searchPlaceholder, total, layouts = false, pageSizes, columns, actions, loadedOnly = false }: {
  list: ListViewController;
  filters?: ListViewFilter[];
  sorts: ListViewOption[];
  searchPlaceholder?: string;
  total?: number;
  layouts?: boolean;
  pageSizes?: readonly number[];
  columns?: ListViewOption[];
  actions?: ReactNode;
  loadedOnly?: boolean;
}) {
  const { t } = useT("common");
  const [editing, setEditing] = useState<"new" | "manage" | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const root = useRef<HTMLElement>(null);
  const { config } = list;
  const activeFilters = filters.filter((filter) => config.filters[filter.key] && config.filters[filter.key] !== "all");
  const orderedColumns = columns ? (config.columns.length ? config.columns.map((key) => columns.find((column) => column.value === key)).filter((column): column is ListViewOption => Boolean(column)) : columns) : [];

  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      root.current?.querySelectorAll("details[open]").forEach((detail) => {
        if (event instanceof KeyboardEvent || !detail.contains(event.target as Node)) {
          detail.removeAttribute("open");
          if (event instanceof KeyboardEvent) detail.querySelector("summary")?.focus();
        }
      });
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, []);

  return (
    <section ref={root} aria-label={t("listView.toolbar")} className="relative mb-4 min-w-0 rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label={t("listView.views")}>
          <button type="button" disabled={list.saving} onClick={() => { list.select(null); setEditing(null); }} aria-pressed={!list.active} className={cn("inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold", !list.active ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-hover")}><List size={14} />{t("listView.all")}</button>
          {list.collection.views.map((view) => <button key={view.id} type="button" disabled={list.saving} onClick={() => { list.select(view.id); setEditing(null); }} aria-pressed={list.active?.id === view.id} className={cn("inline-flex max-w-64 shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold", list.active?.id === view.id ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-hover")}>
            {view.id === list.collection.defaultId ? <Star size={12} fill="currentColor" /> : <Bookmark size={12} />}<span className="truncate">{view.name}</span>{list.active?.id === view.id && list.dirty ? <span aria-label={t("listView.modified")}>•</span> : null}
          </button>)}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {list.active ? <button type="button" disabled={list.saving || !list.canSave} className={summaryClass} onClick={() => { setName(list.active!.name); setEditing(editing === "manage" ? null : "manage"); setConfirmDelete(false); }}><Settings2 size={14} />{t("listView.manage")}</button> : null}
          {list.active && list.dirty ? <button type="button" disabled={list.saving || !list.canSave} className={summaryClass} onClick={() => void list.save(list.active!.name, false)}><Save size={14} />{t("listView.save")}</button> : null}
          <button type="button" disabled={list.loading || list.saving || !list.canSave} onClick={() => { setName(""); setEditing(editing === "new" ? null : "new"); }} className={cn(summaryClass, "disabled:opacity-40")}><Plus size={14} />{t("listView.saveAs")}</button>
        </div>
      </div>
      {editing ? <form className="flex flex-wrap items-end gap-2 border-b border-border bg-surface-subtle p-3" onSubmit={async (event) => { event.preventDefault(); if (await list.save(name, editing === "new")) setEditing(null); }}>
        <label className="min-w-40 flex-1 text-xs font-semibold text-muted-strong">{t("listView.name")}<input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("listView.namePlaceholder")} className={cn(controlClass, "mt-1 block w-full")} /></label>
        <Button size="sm" type="submit" disabled={list.saving || !name.trim()}><Save size={14} />{t("listView.save")}</Button>
        {editing === "manage" ? <>
          <Button size="sm" variant="secondary" disabled={list.saving} onClick={() => void list.setDefault()}><Star size={14} />{t(list.collection.defaultId === list.active?.id ? "listView.unsetDefault" : "listView.setDefault")}</Button>
          <Button size="sm" variant="secondary" disabled={list.saving} onClick={async () => { if (!confirmDelete) { setConfirmDelete(true); return; } if (await list.remove()) setEditing(null); }}>{t(confirmDelete ? "listView.confirmDelete" : "listView.delete")}</Button>
        </> : null}
        <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>{t("listView.cancel")}</Button>
      </form> : null}
      <div className="flex flex-wrap items-center gap-2 p-3">
        <label className="relative min-w-40 flex-1 sm:max-w-sm"><span className="sr-only">{t("listView.search")}</span><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input type="search" maxLength={500} value={config.query} onChange={(event) => list.patch({ query: event.target.value })} placeholder={searchPlaceholder ?? t("listView.searchPlaceholder")} className={cn(controlClass, "w-full bg-surface-subtle pl-9 pr-8 [&::-webkit-search-cancel-button]:appearance-none")} />{config.query ? <button type="button" onClick={() => list.patch({ query: "" })} aria-label={t("listView.clearSearch")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted"><X size={13} /></button> : null}</label>
        {filters.length ? <details className="static sm:relative"><summary className={summaryClass}><Filter size={14} />{t("listView.filter")}{activeFilters.length ? <span className="rounded bg-brand-soft px-1.5 text-brand">{activeFilters.length}</span> : null}<ChevronDown size={12} /></summary><div className={panelClass}>{filters.map((filter) => <label key={filter.key} className="block text-xs font-semibold text-muted-strong">{filter.label}<select value={config.filters[filter.key] ?? "all"} onChange={(event) => list.setFilter(filter.key, event.target.value)} className={cn(controlClass, "mt-1.5 w-full")}><option value="all">{t("listView.any")}</option>{filter.options.filter((option) => option.value !== "all").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div></details> : null}
        <details className="static sm:relative"><summary className={summaryClass}>{config.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{t("listView.sort")}<ChevronDown size={12} /></summary><div className={panelClass}><label className="block text-xs font-semibold text-muted-strong">{t("listView.sortBy")}<select value={config.sort} onChange={(event) => list.patch({ sort: event.target.value })} className={cn(controlClass, "mt-1.5 w-full")}>{sorts.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}</select></label><label className="block text-xs font-semibold text-muted-strong">{t("listView.direction")}<select value={config.direction} onChange={(event) => list.patch({ direction: event.target.value as "asc" | "desc" })} className={cn(controlClass, "mt-1.5 w-full")}><option value="asc">{t("listView.ascending")}</option><option value="desc">{t("listView.descending")}</option></select></label></div></details>
        <details className="static sm:relative"><summary className={summaryClass}><Settings2 size={14} />{t("listView.arrange")}<ChevronDown size={12} /></summary><div className={panelClass}>
          {layouts ? <div className="flex gap-2">{(["table", "grid"] as const).map((layout) => <button key={layout} type="button" aria-pressed={config.layout === layout} className={cn(summaryClass, config.layout === layout && "border-brand text-brand")} onClick={() => list.patch({ layout })}>{layout === "grid" ? <Grid2X2 size={14} /> : <List size={14} />}{t("listView." + layout)}</button>)}</div> : null}
          <label className="block text-xs font-semibold text-muted-strong">{t("listView.density")}<select value={config.density} onChange={(event) => list.patch({ density: event.target.value as ListViewConfig["density"] })} className={cn(controlClass, "mt-1.5 w-full")}><option value="comfortable">{t("listView.comfortable")}</option><option value="compact">{t("listView.compact")}</option></select></label>
          {pageSizes ? <label className="block text-xs font-semibold text-muted-strong">{t("listView.pageSize")}<select value={config.pageSize} onChange={(event) => list.patch({ pageSize: Number(event.target.value) })} className={cn(controlClass, "mt-1.5 w-full")}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label> : null}
          {columns ? <div><p className="mb-2 text-xs font-semibold text-muted-strong">{t("listView.columns")}</p>{[...orderedColumns, ...columns.filter((column) => !orderedColumns.includes(column))].map((column) => <div key={column.value} className="flex items-center gap-2 py-1"><label className="flex flex-1 items-center gap-2 text-xs"><input type="checkbox" checked={orderedColumns.includes(column)} disabled={column === columns[0]} onChange={(event) => list.patch({ columns: event.target.checked ? [...orderedColumns.map((entry) => entry.value), column.value] : orderedColumns.filter((entry) => entry !== column).map((entry) => entry.value) })} />{column.label}</label>{orderedColumns.includes(column) ? <><button type="button" disabled={orderedColumns.indexOf(column) <= 1} aria-label={t("listView.moveLeft", { name: column.label })} className="p-1 disabled:opacity-25" onClick={() => { const next = orderedColumns.map((entry) => entry.value); const index = next.indexOf(column.value); [next[index - 1], next[index]] = [next[index], next[index - 1]]; list.patch({ columns: next }); }}><ArrowUp size={13} /></button><button type="button" disabled={column === columns[0] || orderedColumns.indexOf(column) === orderedColumns.length - 1} aria-label={t("listView.moveRight", { name: column.label })} className="p-1 disabled:opacity-25" onClick={() => { const next = orderedColumns.map((entry) => entry.value); const index = next.indexOf(column.value); [next[index + 1], next[index]] = [next[index], next[index + 1]]; list.patch({ columns: next }); }}><ArrowDown size={13} /></button></> : null}</div>)}</div> : null}
        </div></details>
        {actions}
        {total !== undefined ? <span aria-live="polite" className="ml-auto text-xs text-muted">{t(loadedOnly ? "listView.loadedResults" : "listView.results", { count: total })}</span> : null}
      </div>
      {activeFilters.length || config.query || list.dirty ? <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        {activeFilters.map((filter) => <button type="button" key={filter.key} onClick={() => list.setFilter(filter.key, "all")} aria-label={t("listView.removeFilter", { name: filter.label })} className="inline-flex items-center gap-2 rounded-md bg-brand-soft px-2 py-1 text-xs text-brand">{filter.label}: {filter.options.find((option) => option.value === config.filters[filter.key])?.label ?? config.filters[filter.key]}<X size={12} /></button>)}
        {activeFilters.length || config.query ? <button type="button" onClick={list.resetFilters} className="text-xs text-muted hover:text-foreground">{t("listView.clearFilters")}</button> : null}
        {list.dirty ? <button type="button" className="ml-auto inline-flex items-center gap-1 text-xs text-muted" onClick={() => list.select(list.active?.id ?? null)}><RotateCcw size={12} />{t("listView.reset")}</button> : null}
      </div> : null}
      {list.error ? <div className="px-3 pb-3"><Alert tone="danger">{list.error}<button type="button" onClick={list.refresh} className="ml-2 underline">{t("listView.reload")}</button></Alert></div> : null}
      {list.notice ? <p role="status" className="flex items-center gap-1.5 px-3 pb-3 text-xs text-success"><Check size={13} />{list.notice}</p> : null}
      {!list.loading && !list.canSave && !list.error ? <p className="px-3 pb-3 text-xs text-muted">{t("listView.readOnly")}</p> : null}
    </section>
  );
}

export function ListViewResults({ list, children, className }: { list: ListViewController; children: ReactNode; className?: string }) {
  return <div data-list-density={list.config.density} className={cn("list-view-results min-w-0", className)}>{children}</div>;
}
