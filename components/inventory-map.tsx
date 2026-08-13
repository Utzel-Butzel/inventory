"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useT } from "next-i18next/client";
import {
  Box,
  Check,
  CircleDot,
  Eye,
  ListChecks,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  MousePointer2,
  PenTool,
  Save,
  Satellite,
  Search,
  Shapes,
  Building2,
  Layers3,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ResourceMapCoordinate,
  ResourceMapFeature,
} from "@/db/schema";
import {
  fetchJson,
  type ClientResource,
  type ClientSpatialStructureDetail,
  type ClientSpatialStructureSummary,
} from "@/lib/client-types";
import {
  floorIdentifier,
  spatialStructureMapFeatures,
  type SpatialMapFeatureProperties,
} from "@/lib/spatial-map-features";
import type { MapBasemap, MapDrawMode } from "@/components/inventory-map-canvas";

const InventoryMapCanvas = dynamic(
  () => import("@/components/inventory-map-canvas").then((module) => module.InventoryMapCanvas),
  {
    ssr: false,
    loading: () => <InventoryMapLoading />,
  },
);

function InventoryMapLoading() {
  const { t } = useT("spatial");
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-surface-muted text-muted"
      role="status"
      aria-label={t("map.loading")}
    >
      <LoaderCircle className="animate-spin" aria-hidden="true" />
    </div>
  );
}

type ResourceListResponse = {
  resources: ClientResource[];
  pagination: { page: number; pages: number; total: number };
};

type BatchForm = {
  status: string;
  type: string;
  priority: string;
  location: string;
  addTags: string;
};

const emptyBatchForm: BatchForm = {
  status: "",
  type: "",
  priority: "",
  location: "",
  addTags: "",
};

type InventoryTypeOption = { key: string; label: string };

const fallbackResourceTypes: InventoryTypeOption[] = [
  "tool",
  "object",
  "furniture",
  "vehicle",
  "place",
  "clothing",
  "person",
  "project",
  "other",
].map((key) => ({ key, label: key }));

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle disabled:text-muted";

function legacyFeatures(resource: ClientResource): ResourceMapFeature[] {
  if (resource.mapFeatures.length) return resource.mapFeatures;
  if (resource.gpsLatitude === null || resource.gpsLongitude === null) return [];
  return [
    {
      id: `legacy-${resource.id}`,
      type: "point",
      layer: "Location",
      description: "",
      coordinates: [resource.gpsLongitude, resource.gpsLatitude],
    },
  ];
}

async function loadEveryResource() {
  const first = await fetchJson<ResourceListResponse>("/api/v1/resources?pageSize=100&page=1");
  if (first.pagination.pages <= 1) return first.resources;
  const remaining = await Promise.all(
    Array.from({ length: first.pagination.pages - 1 }, (_, index) =>
      fetchJson<ResourceListResponse>(`/api/v1/resources?pageSize=100&page=${index + 2}`),
    ),
  );
  return [first, ...remaining].flatMap((result) => result.resources);
}

export function InventoryMap({ canEdit }: { canEdit: boolean }) {
  const { t, i18n } = useT("spatial");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ResourceMapFeature[]>>({});
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [drawMode, setDrawMode] = useState<MapDrawMode>("idle");
  const [basemap, setBasemap] = useState<MapBasemap>("streets");
  const [polygonDraft, setPolygonDraft] = useState<ResourceMapCoordinate[]>([]);
  const [newLayer, setNewLayer] = useState("");
  const [batchForm, setBatchForm] = useState<BatchForm>(emptyBatchForm);
  const [applyLocation, setApplyLocation] = useState(false);
  const [resourceTypes, setResourceTypes] = useState<InventoryTypeOption[]>(
    fallbackResourceTypes,
  );
  const [structures, setStructures] = useState<ClientSpatialStructureSummary[]>([]);
  const [structureDetail, setStructureDetail] = useState<ClientSpatialStructureDetail | null>(null);
  const [activeStructureId, setActiveStructureId] = useState<string | null>(null);
  const [activeFloorIdentifier, setActiveFloorIdentifier] = useState<string | null>(null);
  const isEditing = canEdit && editMode;

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ types: InventoryTypeOption[] }>("/api/v1/inventory-types", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((result) => setResourceTypes(result.types))
      .catch(() => {
        // The map remains usable with the built-in fallback types.
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setActiveStructureId(params.get("structure"));
    setActiveFloorIdentifier(params.get("floor"));
  }, []);

  const updateSpatialUrl = useCallback((structureId: string | null, floor: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (structureId) params.set("structure", structureId);
    else params.delete("structure");
    if (floor) params.set("floor", floor);
    else params.delete("floor");
    const suffix = params.toString();
    window.history.replaceState(null, "", suffix ? `/map?${suffix}` : "/map");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ structures: ClientSpatialStructureSummary[] }>(
      "/api/v1/spatial-structures",
      { cache: "no-store", signal: controller.signal },
    )
      .then(({ structures: loaded }) => setStructures(loaded))
      .catch(() => {
        // Older servers simply keep the existing item-only map.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeStructureId) {
      setStructureDetail(null);
      setActiveFloorIdentifier(null);
      return;
    }
    const controller = new AbortController();
    void fetchJson<{ structure: ClientSpatialStructureDetail }>(
      `/api/v1/spatial-structures/${encodeURIComponent(activeStructureId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(({ structure }) => {
        setStructureDetail(structure);
        setActiveFloorIdentifier((current) =>
          structure.floors.some((floor) => floorIdentifier(floor.identifier, floor.index) === current)
            ? current
            : structure.floors[0]
              ? floorIdentifier(structure.floors[0].identifier, structure.floors[0].index)
              : null,
        );
      })
      .catch(() => setStructureDetail(null));
    return () => controller.abort();
  }, [activeStructureId]);

  const featuresByResource = useMemo(
    () =>
      Object.fromEntries(
        resources.map((resource) => [
          resource.id,
          drafts[resource.id] ?? legacyFeatures(resource),
        ]),
      ) as Record<string, ResourceMapFeature[]>,
    [drafts, resources],
  );

  const reload = useCallback(async (preserveSelection = false) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadEveryResource();
      setResources(loaded);
      if (!preserveSelection) {
        const requestedId = new URLSearchParams(window.location.search).get("resource");
        const first = loaded.find((resource) => resource.id === requestedId)
          ?? loaded.find((resource) => legacyFeatures(resource).length)
          ?? loaded[0];
        setSelectedIds(first ? [first.id] : []);
        setActiveResourceId(first?.id ?? null);
        setActiveFeatureId(first ? legacyFeatures(first)[0]?.id ?? null : null);
      }
    } catch {
      setError(t("map.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const displayed = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return resources;
    return resources.filter((resource) =>
      `${resource.name} ${resource.location ?? ""} ${resource.tags.join(" ")}`
        .toLocaleLowerCase(locale)
        .includes(normalized),
    );
  }, [locale, query, resources]);

  const activeResource = resources.find((resource) => resource.id === activeResourceId) ?? null;
  const activeFeatures = useMemo(
    () => activeResourceId ? featuresByResource[activeResourceId] ?? [] : [],
    [activeResourceId, featuresByResource],
  );
  const activeFeature = activeFeatures.find((feature) => feature.id === activeFeatureId) ?? null;
  const locatedCount = resources.filter(
    (resource) => (featuresByResource[resource.id] ?? []).length > 0,
  ).length;
  const spatialFeatures = useMemo(
    () => spatialStructureMapFeatures(structures, structureDetail, {
      activeStructureId,
      activeFloorIdentifier,
    }),
    [activeFloorIdentifier, activeStructureId, structureDetail, structures],
  );

  const selectSpatialFeature = useCallback((feature: SpatialMapFeatureProperties) => {
    setActiveStructureId(feature.structureId);
    if (feature.floorIdentifier) setActiveFloorIdentifier(feature.floorIdentifier);
    if (feature.resourceId) {
      setActiveResourceId(feature.resourceId);
      setSelectedIds([feature.resourceId]);
    }
    updateSpatialUrl(feature.structureId, feature.floorIdentifier ?? null);
  }, [updateSpatialUrl]);

  useEffect(() => {
    if (!activeResourceId) {
      setActiveFeatureId(null);
      return;
    }
    if (!activeFeatures.some((feature) => feature.id === activeFeatureId)) {
      setActiveFeatureId(activeFeatures[0]?.id ?? null);
    }
  }, [activeFeatureId, activeFeatures, activeResourceId]);

  const markChanged = useCallback((resourceId: string, features: ResourceMapFeature[]) => {
    if (!isEditing) return;
    setDrafts((current) => ({ ...current, [resourceId]: features }));
    setDirtyIds((current) => current.includes(resourceId) ? current : [...current, resourceId]);
  }, [isEditing]);

  const selectResource = useCallback((resourceId: string, additive: boolean) => {
    const shouldAdd = isEditing && (multiSelect || additive);
    setSelectedIds((current) => {
      if (!shouldAdd) return [resourceId];
      return current.includes(resourceId)
        ? current.filter((id) => id !== resourceId)
        : [...current, resourceId];
    });
    setActiveResourceId(resourceId);
    setDrawMode("idle");
    setPolygonDraft([]);
  }, [isEditing, multiSelect]);

  const startDrawing = useCallback((mode: Exclude<MapDrawMode, "idle">) => {
    if (!isEditing || !activeResourceId) return;
    setError(null);
    setPolygonDraft([]);
    setDrawMode(mode);
  }, [activeResourceId, isEditing]);

  const addPoint = (coordinate: ResourceMapCoordinate) => {
    if (!activeResourceId || !isEditing) return;
    const feature: ResourceMapFeature = {
      id: crypto.randomUUID(),
      type: "point",
      layer: newLayer.trim() || t("map.defaultLayers.location"),
      description: "",
      coordinates: coordinate,
    };
    markChanged(activeResourceId, [...activeFeatures, feature]);
    setActiveFeatureId(feature.id);
    setDrawMode("idle");
    setNotice(t("map.notices.pointPlaced"));
  };

  const finishPolygon = useCallback(() => {
    if (!activeResourceId || !isEditing) return;
    if (polygonDraft.length < 3) {
      setError(t("map.errors.polygonPoints"));
      return;
    }
    const first = polygonDraft[0]!;
    const feature: ResourceMapFeature = {
      id: crypto.randomUUID(),
      type: "polygon",
      layer: newLayer.trim() || t("map.defaultLayers.area"),
      description: "",
      coordinates: [...polygonDraft, [first[0], first[1]]],
    };
    markChanged(activeResourceId, [...activeFeatures, feature]);
    setActiveFeatureId(feature.id);
    setPolygonDraft([]);
    setDrawMode("idle");
    setNotice(t("map.notices.outlineAdded"));
  }, [activeFeatures, activeResourceId, isEditing, markChanged, newLayer, polygonDraft, t]);

  const cancelDrawing = useCallback(() => {
    setPolygonDraft([]);
    setDrawMode("idle");
  }, []);

  const saveAllGeometry = useCallback(async () => {
    if (!dirtyIds.length || !isEditing) return;
    setSaving(true);
    setError(null);
    const pendingIds = [...dirtyIds];
    const results = await Promise.allSettled(
      pendingIds.map(async (id) => {
        const response = await fetchJson<{ resource: ClientResource }>(
          `/api/v1/resources/${id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mapFeatures: drafts[id] ?? featuresByResource[id] ?? [] }),
          },
        );
        return { id, resource: response.resource };
      }),
    );
    const saved = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    setResources((current) => current.map((resource) =>
      saved.find((item) => item.id === resource.id)?.resource ?? resource,
    ));
    setDirtyIds((current) => current.filter((id) => !saved.some((item) => item.id === id)));
    setDrafts((current) => {
      const next = { ...current };
      for (const item of saved) delete next[item.id];
      return next;
    });
    const failed = results.length - saved.length;
    if (failed) {
      setError(t("map.errors.save", { count: failed, value: integer.format(failed) }));
    } else {
      setNotice(t("map.notices.saved", {
        count: saved.length,
        value: integer.format(saved.length),
      }));
    }
    setSaving(false);
  }, [dirtyIds, drafts, featuresByResource, integer, isEditing, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEditing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveAllGeometry();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key.toLowerCase() === "p") startDrawing("point");
      if (event.key.toLowerCase() === "g") startDrawing("polygon");
      if (event.key === "Enter" && drawMode === "polygon") finishPolygon();
      if (event.key === "Escape") cancelDrawing();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelDrawing, drawMode, finishPolygon, isEditing, saveAllGeometry, startDrawing]);

  const deleteActiveFeature = () => {
    if (!isEditing || !activeResourceId || !activeFeature) return;
    markChanged(
      activeResourceId,
      activeFeatures.filter((feature) => feature.id !== activeFeature.id),
    );
    setActiveFeatureId(null);
  };

  const updateActiveFeature = (changes: Partial<Pick<ResourceMapFeature, "layer" | "description">>) => {
    if (!isEditing || !activeResourceId || !activeFeature) return;
    markChanged(
      activeResourceId,
      activeFeatures.map((feature) =>
        feature.id === activeFeature.id ? { ...feature, ...changes } : feature,
      ),
    );
  };

  const applyBatch = async () => {
    if (!isEditing || !selectedIds.length) return;
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
      setError(t("map.errors.quickEditRequired"));
      return;
    }

    setBatchSaving(true);
    setError(null);
    try {
      await fetchJson("/api/v1/resources/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, changes, addTags }),
      });
      setResources((current) => current.map((resource) => {
        if (!selectedIds.includes(resource.id)) return resource;
        return {
          ...resource,
          ...changes,
          tags: Array.from(new Set([...resource.tags, ...addTags])),
          updatedAt: new Date().toISOString(),
        } as ClientResource;
      }));
      setBatchForm(emptyBatchForm);
      setApplyLocation(false);
      setNotice(t("map.notices.updated", {
        count: selectedIds.length,
        value: integer.format(selectedIds.length),
      }));
    } catch {
      setError(t("map.errors.batch"));
    } finally {
      setBatchSaving(false);
    }
  };

  const leaveEditMode = () => {
    if (dirtyIds.length) {
      setError(t("map.errors.saveBeforeView"));
      return;
    }
    cancelDrawing();
    setMultiSelect(false);
    setSelectedIds(activeResourceId ? [activeResourceId] : []);
    setEditMode(false);
  };

  if (loading) {
    return (
      <div
        className="grid min-h-[calc(100vh-68px)] place-items-center text-muted"
        role="status"
        aria-label={t("map.loading")}
      >
        <LoaderCircle className="animate-spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-68px)] flex-col px-3 py-4 sm:px-5 lg:px-6">
      <header className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
            <MapPin size={13} /> {t("map.eyebrow")}
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
            {t(isEditing ? "map.title.edit" : "map.title.view")}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {t("map.summary.positioned", {
              located: integer.format(locatedCount),
              total: integer.format(resources.length),
            })}
            {" · "}
            {structures.length
              ? t("map.summary.structures", {
                  count: structures.length,
                  value: integer.format(structures.length),
                })
              : t("map.summary.features")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirtyIds.length ? (
            <span className="rounded-full bg-warning-soft px-3 py-1.5 text-xs font-semibold text-warning ring-1 ring-warning-border">
              {t("map.changes.unsaved", {
                count: dirtyIds.length,
                value: integer.format(dirtyIds.length),
              })}
            </span>
          ) : null}
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => setMultiSelect((current) => !current)}
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition ${multiSelect ? "border-brand-border bg-brand-soft text-brand" : "border-border bg-surface text-muted hover:bg-surface-hover"}`}
              >
                <ListChecks size={15} /> {t(multiSelect ? "map.actions.multiSelectOn" : "map.actions.multiSelect")}
              </button>
              <button
                type="button"
                onClick={leaveEditMode}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-xs font-semibold text-muted transition hover:bg-surface-hover"
              >
                <Eye size={15} /> {t("map.actions.view")}
              </button>
              <button
                type="button"
                onClick={() => void saveAllGeometry()}
                disabled={!dirtyIds.length || saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
                {t("map.actions.save")}
              </button>
            </>
          ) : canEdit ? (
            <button
              type="button"
              onClick={() => setEditMode(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover"
            >
              <PenTool size={15} /> {t("map.actions.edit")}
            </button>
          ) : (
            <span className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-muted">{t("map.actions.readOnly")}</span>
          )}
        </div>
      </header>

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft px-3.5 py-2.5 text-xs text-danger">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label={t("map.actions.dismissError")}><X size={14} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-success-border bg-success-soft px-3.5 py-2.5 text-xs text-success">
          <span className="inline-flex items-center gap-2"><Check size={14} />{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label={t("map.actions.dismissNotice")}><X size={14} /></button>
        </div>
      ) : null}

      <div className="grid min-h-[720px] flex-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-md)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-surface lg:border-b-0 lg:border-r">
          <div className="border-b border-border p-3">
            <label className="relative block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("map.search.placeholder")} className={`${inputClass} pl-9`} />
            </label>
            {isEditing ? (
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                <span>{t("map.selection.selected", {
                  count: selectedIds.length,
                  value: integer.format(selectedIds.length),
                })}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setSelectedIds(displayed.map((resource) => resource.id)); setMultiSelect(true); }} className="font-semibold text-brand hover:text-brand-strong">{t("map.selection.selectResults")}</button>
                  {selectedIds.length ? <button type="button" onClick={() => { setSelectedIds([]); setActiveResourceId(null); }} className="font-semibold text-muted hover:text-foreground">{t("map.selection.clear")}</button> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="max-h-[270px] min-h-[160px] overflow-y-auto border-b border-border p-2 scrollbar-thin lg:max-h-[32vh]">
            {displayed.map((resource) => {
              const selected = selectedIds.includes(resource.id);
              const features = featuresByResource[resource.id] ?? [];
              return (
                <button
                  key={resource.id}
                  type="button"
                  onClick={(event) => selectResource(resource.id, event.shiftKey || event.metaKey || event.ctrlKey)}
                  className={`mb-1 flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition ${activeResourceId === resource.id ? "bg-brand-soft ring-1 ring-inset ring-brand-border" : selected ? "bg-surface-subtle" : "hover:bg-surface-hover"}`}
                >
                  {isEditing ? <span className={`grid size-5 shrink-0 place-items-center rounded-md border ${selected ? "border-brand-solid bg-brand-solid text-on-brand" : "border-border-strong bg-surface text-transparent"}`}><Check size={12} /></span> : null}
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-muted text-muted">
                    {resource.cover?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resource.cover.url} alt="" className="h-full w-full object-cover" />
                    ) : <Box size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">{resource.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted">
                      {features.some((feature) => feature.type === "polygon") ? <Shapes size={10} /> : features.length ? <MapPin size={10} /> : <CircleDot size={10} />}
                      {features.length
                        ? t("map.resource.features", {
                            count: features.length,
                            value: integer.format(features.length),
                          })
                        : t("map.resource.notPositioned")}
                      {resource.location ? ` · ${resource.location}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {!displayed.length ? <p className="px-3 py-8 text-center text-xs text-muted">{t("map.search.noMatches")}</p> : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
            {activeResource ? (
              <div className="space-y-4">
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{activeResource.name}</p>
                      <p className="text-[10px] text-muted">
                        {t(`map.types.${activeResource.type}`, { defaultValue: activeResource.type })}
                        {" · "}
                        {t(`map.statuses.${activeResource.status}`, { defaultValue: activeResource.status })}
                      </p>
                    </div>
                    <Link href={`/inventory/${activeResource.id}`} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted hover:bg-surface-hover">{t("map.resource.open")}</Link>
                  </div>

                  {isEditing ? (
                    <div className="rounded-xl border border-border bg-surface-subtle p-2.5">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{t("map.draw.title")}</p>
                      <input value={newLayer} onChange={(event) => setNewLayer(event.target.value)} placeholder={t("map.draw.layerPlaceholder")} className={inputClass} />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => startDrawing("point")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${drawMode === "point" ? "bg-brand-solid text-on-brand" : "border border-border bg-surface text-muted-strong"}`}><MapPin size={14} /> {t("map.draw.placePoint")}</button>
                        <button type="button" onClick={() => startDrawing("polygon")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${drawMode === "polygon" ? "bg-warning text-on-strong" : "border border-border bg-surface text-muted-strong"}`}><PenTool size={14} /> {t("map.draw.drawOutline")}</button>
                      </div>
                      {drawMode !== "idle" ? (
                        <div className="mt-2 rounded-lg bg-surface p-2 text-[10px] leading-4 text-muted ring-1 ring-border">
                          {drawMode === "point"
                            ? t("map.draw.pointHint")
                            : t("map.draw.polygonHint", {
                                count: polygonDraft.length,
                                value: integer.format(polygonDraft.length),
                              })}
                          <div className="mt-1.5 flex gap-2">
                            {drawMode === "polygon" ? <button type="button" onClick={finishPolygon} disabled={polygonDraft.length < 3} className="font-semibold text-warning disabled:opacity-40">{t("map.draw.finishPolygon")}</button> : null}
                            <button type="button" onClick={cancelDrawing} className="font-semibold text-muted">{t("map.draw.cancel")}</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                {activeFeatures.length ? (
                  <section>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{t("map.features.title")}</p>
                    <div className="space-y-1">
                      {activeFeatures.map((feature, index) => (
                        <button key={feature.id} type="button" onClick={() => setActiveFeatureId(feature.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${activeFeatureId === feature.id ? "bg-brand-soft text-brand ring-1 ring-inset ring-brand-border" : "bg-surface-subtle text-muted hover:bg-surface-hover"}`}>
                          {feature.type === "point" ? <MapPin size={13} /> : <Shapes size={13} />}
                          <span className="min-w-0 flex-1 truncate">
                            {feature.id.startsWith("legacy-") && feature.layer === "Location"
                              ? t("map.defaultLayers.location")
                              : feature.layer}
                          </span>
                          <span className="text-[10px] text-muted">{integer.format(index + 1)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeFeature && isEditing ? (
                  <section className="rounded-xl border border-warning-border bg-warning-soft p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-warning">
                        {t("map.features.edit", {
                          type: t(`map.features.types.${activeFeature.type}`),
                        })}
                      </p>
                      <button type="button" onClick={deleteActiveFeature} className="text-danger" aria-label={t("map.features.delete")}><Trash2 size={14} /></button>
                    </div>
                    <label className="block text-[10px] font-semibold text-muted">{t("map.features.layer")}<input value={activeFeature.layer} onChange={(event) => updateActiveFeature({ layer: event.target.value })} className={`${inputClass} mt-1`} /></label>
                    <label className="mt-2 block text-[10px] font-semibold text-muted">{t("map.features.description")}<textarea value={activeFeature.description} onChange={(event) => updateActiveFeature({ description: event.target.value })} rows={2} className={`${inputClass} mt-1 h-auto py-2`} /></label>
                    <p className="mt-2 text-[10px] leading-4 text-muted">{t("map.features.editHint")}</p>
                  </section>
                ) : null}

                {isEditing && selectedIds.length ? (
                  <section className="border-t border-border pt-4">
                    <div className="mb-2 flex items-center gap-2"><MousePointer2 size={13} className="text-brand" /><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{t("map.quickEdit.title", { count: selectedIds.length, value: integer.format(selectedIds.length) })}</p></div>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={batchForm.status} onChange={(event) => setBatchForm((current) => ({ ...current, status: event.target.value }))} className={inputClass}><option value="">{t("map.quickEdit.keepStatus")}</option><option value="available">{t("map.statuses.available")}</option><option value="in-use">{t("map.statuses.in-use")}</option><option value="maintenance">{t("map.statuses.maintenance")}</option><option value="archived">{t("map.statuses.archived")}</option></select>
                      <select value={batchForm.type} onChange={(event) => setBatchForm((current) => ({ ...current, type: event.target.value }))} className={inputClass}><option value="">{t("map.quickEdit.keepType")}</option>{resourceTypes.map((type) => <option key={type.key} value={type.key}>{t(`map.types.${type.key}`, { defaultValue: type.label })}</option>)}</select>
                      <select value={batchForm.priority} onChange={(event) => setBatchForm((current) => ({ ...current, priority: event.target.value }))} className={`${inputClass} col-span-2`}><option value="">{t("map.quickEdit.keepPriority")}</option>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>{t("map.quickEdit.priority", { value: integer.format(priority) })}</option>)}</select>
                      <input value={batchForm.addTags} onChange={(event) => setBatchForm((current) => ({ ...current, addTags: event.target.value }))} placeholder={t("map.quickEdit.addTags")} className={`${inputClass} col-span-2`} />
                      <label className="col-span-2 flex items-center gap-2 rounded-lg bg-surface-subtle px-2.5 py-2 text-[10px] font-semibold text-muted"><input type="checkbox" checked={applyLocation} onChange={(event) => setApplyLocation(event.target.checked)} className="accent-brand-solid" /> {t("map.quickEdit.changeLocation")}</label>
                      {applyLocation ? <input value={batchForm.location} onChange={(event) => setBatchForm((current) => ({ ...current, location: event.target.value }))} placeholder={t("map.quickEdit.locationPlaceholder")} className={`${inputClass} col-span-2`} /> : null}
                    </div>
                    <button type="button" onClick={() => void applyBatch()} disabled={batchSaving} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-strong text-xs font-semibold text-on-strong disabled:opacity-50">{batchSaving ? <LoaderCircle size={14} className="animate-spin" /> : <ListChecks size={14} />}{t("map.quickEdit.apply")}</button>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="grid h-full min-h-40 place-items-center px-6 text-center text-xs leading-5 text-muted">{t("map.selection.empty")}</div>
            )}
          </div>
        </aside>

        <section className="relative min-h-[560px] overflow-hidden bg-surface-muted">
          <InventoryMapCanvas
            resources={displayed}
            featuresByResource={featuresByResource}
            selectedIds={selectedIds}
            activeResourceId={activeResourceId}
            activeFeatureId={activeFeatureId}
            editable={isEditing}
            drawMode={drawMode}
            basemap={basemap}
            polygonDraft={polygonDraft}
            spatialFeatures={spatialFeatures}
            activeSpatialStructureId={activeStructureId}
            onSelectSpatialFeature={selectSpatialFeature}
            onSelectResource={selectResource}
            onSelectFeature={setActiveFeatureId}
            onPlacePoint={addPoint}
            onAddPolygonPoint={(coordinate) => setPolygonDraft((current) => [...current, coordinate])}
            onChangeFeatures={markChanged}
          />

          {structures.length ? (
            <div className="absolute right-14 top-3 z-10 w-[min(300px,calc(100%-72px))] rounded-xl border border-border bg-surface/95 p-2 shadow-lg backdrop-blur">
              <div className="flex items-center gap-2 px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                <Building2 size={13} className="text-brand" /> {t("map.structures.title")}
              </div>
              <select
                value={activeStructureId ?? ""}
                onChange={(event) => {
                  const value = event.target.value || null;
                  setActiveStructureId(value);
                  setActiveFloorIdentifier(null);
                  updateSpatialUrl(value, null);
                }}
                className="h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-muted-strong outline-none focus:border-focus"
                aria-label={t("map.structures.select")}
              >
                <option value="">{t("map.structures.all")}</option>
                {structures.map((structure) => (
                  <option key={structure.id} value={structure.id}>
                    {structure.name} · {t("map.structures.rooms", {
                      count: structure.roomCount,
                      value: integer.format(structure.roomCount),
                    })}
                  </option>
                ))}
              </select>
              {structureDetail?.floors.length ? (
                <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
                  <Layers3 size={13} className="mx-1 shrink-0 text-muted" />
                  {structureDetail.floors.map((floor) => (
                    <button
                      key={`${floor.identifier ?? "unassigned"}:${floor.index ?? "none"}`}
                      type="button"
                      onClick={() => {
                        const identifier = floorIdentifier(floor.identifier, floor.index);
                        setActiveFloorIdentifier(identifier);
                        updateSpatialUrl(activeStructureId, identifier);
                      }}
                      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${activeFloorIdentifier === floorIdentifier(floor.identifier, floor.index) ? "bg-brand-solid text-on-brand" : "bg-surface-muted text-muted hover:bg-surface-hover"}`}
                    >
                      {floorIdentifier(floor.identifier, floor.index)} · {t("map.structures.rooms", {
                        count: floor.roomCount,
                        value: integer.format(floor.roomCount),
                      })}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeStructureId ? (
                <Link
                  href={`/spaces?structure=${encodeURIComponent(activeStructureId)}${activeFloorIdentifier ? `&floor=${encodeURIComponent(activeFloorIdentifier)}` : ""}`}
                  className="mt-2 flex h-8 items-center justify-center rounded-lg bg-strong text-[10px] font-semibold text-on-strong hover:opacity-90"
                >
                  {t("map.structures.open3d")}
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="absolute left-3 top-3 z-10 flex rounded-xl border border-border bg-surface/95 p-1 shadow-lg backdrop-blur">
            <button type="button" onClick={() => setBasemap("streets")} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ${basemap === "streets" ? "bg-strong text-on-strong" : "text-muted hover:bg-surface-hover"}`}><MapIcon size={13} /> {t("map.basemap.map")}</button>
            <button type="button" onClick={() => setBasemap("satellite")} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ${basemap === "satellite" ? "bg-strong text-on-strong" : "text-muted hover:bg-surface-hover"}`}><Satellite size={13} /> {t("map.basemap.satellite")}</button>
          </div>
          {isEditing && drawMode !== "idle" ? (
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-border-strong bg-strong/90 px-3 py-2 text-xs font-semibold text-on-strong shadow-xl backdrop-blur">
              {drawMode === "point"
                ? t("map.draw.placeOverlay")
                : t("map.draw.polygonOverlay", {
                    count: polygonDraft.length,
                    value: integer.format(polygonDraft.length),
                  })}
            </div>
          ) : null}
          {isEditing ? (
            <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden rounded-lg bg-surface/90 px-2.5 py-1.5 text-[10px] text-muted shadow sm:block">
              {t("map.shortcuts")}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
