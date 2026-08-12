"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
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
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ResourceMapCoordinate,
  ResourceMapFeature,
} from "@/db/schema";
import { fetchJson, type ClientResource } from "@/lib/client-types";
import type { MapBasemap, MapDrawMode } from "@/components/inventory-map-canvas";

const InventoryMapCanvas = dynamic(
  () => import("@/components/inventory-map-canvas").then((module) => module.InventoryMapCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 grid place-items-center bg-[#e8ebee] text-slate-500">
        <LoaderCircle className="animate-spin" />
      </div>
    ),
  },
);

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

const resourceTypes = [
  "tool",
  "object",
  "furniture",
  "vehicle",
  "place",
  "clothing",
  "person",
  "project",
  "other",
];

const inputClass =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:bg-slate-50 disabled:text-slate-400";

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
  const [newLayer, setNewLayer] = useState("Location");
  const [batchForm, setBatchForm] = useState<BatchForm>(emptyBatchForm);
  const [applyLocation, setApplyLocation] = useState(false);
  const isEditing = canEdit && editMode;

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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load map data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const displayed = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return resources;
    return resources.filter((resource) =>
      `${resource.name} ${resource.location ?? ""} ${resource.tags.join(" ")}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [query, resources]);

  const activeResource = resources.find((resource) => resource.id === activeResourceId) ?? null;
  const activeFeatures = useMemo(
    () => activeResourceId ? featuresByResource[activeResourceId] ?? [] : [],
    [activeResourceId, featuresByResource],
  );
  const activeFeature = activeFeatures.find((feature) => feature.id === activeFeatureId) ?? null;
  const locatedCount = resources.filter(
    (resource) => (featuresByResource[resource.id] ?? []).length > 0,
  ).length;

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
      layer: newLayer.trim() || "Location",
      description: "",
      coordinates: coordinate,
    };
    markChanged(activeResourceId, [...activeFeatures, feature]);
    setActiveFeatureId(feature.id);
    setDrawMode("idle");
    setNotice("Point placed. Save the map changes when you are ready.");
  };

  const finishPolygon = useCallback(() => {
    if (!activeResourceId || !isEditing) return;
    if (polygonDraft.length < 3) {
      setError("A polygon needs at least three points.");
      return;
    }
    const first = polygonDraft[0]!;
    const feature: ResourceMapFeature = {
      id: crypto.randomUUID(),
      type: "polygon",
      layer: newLayer.trim() || "Area",
      description: "",
      coordinates: [...polygonDraft, [first[0], first[1]]],
    };
    markChanged(activeResourceId, [...activeFeatures, feature]);
    setActiveFeatureId(feature.id);
    setPolygonDraft([]);
    setDrawMode("idle");
    setNotice("Outline added. Drag orange corners or click green handles to refine it.");
  }, [activeFeatures, activeResourceId, isEditing, markChanged, newLayer, polygonDraft]);

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
    if (failed) setError(`${failed} map change${failed === 1 ? "" : "s"} could not be saved.`);
    else setNotice(`${saved.length} map change${saved.length === 1 ? "" : "s"} saved.`);
    setSaving(false);
  }, [dirtyIds, drafts, featuresByResource, isEditing]);

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
      setError("Choose at least one quick edit.");
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
      setNotice(`${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} updated.`);
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : "Unable to update selection.");
    } finally {
      setBatchSaving(false);
    }
  };

  const leaveEditMode = () => {
    if (dirtyIds.length) {
      setError("Save your map changes before returning to the map view.");
      return;
    }
    cancelDrawing();
    setMultiSelect(false);
    setSelectedIds(activeResourceId ? [activeResourceId] : []);
    setEditMode(false);
  };

  if (loading) {
    return (
      <div className="grid min-h-[calc(100vh-68px)] place-items-center text-slate-400">
        <LoaderCircle className="animate-spin" />
      </div>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-68px)] flex-col px-3 py-4 sm:px-5 lg:px-6">
      <header className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-600">
            <MapPin size={13} /> Spatial inventory
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-3xl">
            {isEditing ? "Edit locations" : "Locations"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {locatedCount} of {resources.length} items positioned · points, rooms and object outlines
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirtyIds.length ? (
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
              {dirtyIds.length} unsaved
            </span>
          ) : null}
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => setMultiSelect((current) => !current)}
                className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition ${multiSelect ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                <ListChecks size={15} /> {multiSelect ? "Multi-select on" : "Multi-select"}
              </button>
              <button
                type="button"
                onClick={leaveEditMode}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <Eye size={15} /> Ansicht
              </button>
              <button
                type="button"
                onClick={() => void saveAllGeometry()}
                disabled={!dirtyIds.length || saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#635bff] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#5147f5] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />}
                Save map changes
              </button>
            </>
          ) : canEdit ? (
            <button
              type="button"
              onClick={() => setEditMode(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#635bff] px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-[#5147f5]"
            >
              <PenTool size={15} /> Bearbeiten
            </button>
          ) : (
            <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">Read only</span>
          )}
        </div>
      </header>

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
          <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
          <span className="inline-flex items-center gap-2"><Check size={14} />{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ) : null}

      <div className="grid min-h-[720px] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_50px_rgba(15,23,42,0.07)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-100 p-3">
            <label className="relative block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find items, locations or tags…" className={`${inputClass} pl-9`} />
            </label>
            {isEditing ? (
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>{selectedIds.length} selected</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setSelectedIds(displayed.map((resource) => resource.id)); setMultiSelect(true); }} className="font-semibold text-violet-600 hover:text-violet-800">Select results</button>
                  {selectedIds.length ? <button type="button" onClick={() => { setSelectedIds([]); setActiveResourceId(null); }} className="font-semibold text-slate-500 hover:text-slate-800">Clear</button> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="max-h-[270px] min-h-[160px] overflow-y-auto border-b border-slate-100 p-2 scrollbar-thin lg:max-h-[32vh]">
            {displayed.map((resource) => {
              const selected = selectedIds.includes(resource.id);
              const features = featuresByResource[resource.id] ?? [];
              return (
                <button
                  key={resource.id}
                  type="button"
                  onClick={(event) => selectResource(resource.id, event.shiftKey || event.metaKey || event.ctrlKey)}
                  className={`mb-1 flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition ${activeResourceId === resource.id ? "bg-violet-50 ring-1 ring-inset ring-violet-200" : selected ? "bg-slate-50" : "hover:bg-slate-50"}`}
                >
                  {isEditing ? <span className={`grid size-5 shrink-0 place-items-center rounded-md border ${selected ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white text-transparent"}`}><Check size={12} /></span> : null}
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-slate-400">
                    {resource.cover?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resource.cover.url} alt="" className="h-full w-full object-cover" />
                    ) : <Box size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">{resource.name}</span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-slate-400">
                      {features.some((feature) => feature.type === "polygon") ? <Shapes size={10} /> : features.length ? <MapPin size={10} /> : <CircleDot size={10} />}
                      {features.length ? `${features.length} map feature${features.length === 1 ? "" : "s"}` : "Not positioned"}
                      {resource.location ? ` · ${resource.location}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {!displayed.length ? <p className="px-3 py-8 text-center text-xs text-slate-400">No matching inventory items.</p> : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
            {activeResource ? (
              <div className="space-y-4">
                <section>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{activeResource.name}</p>
                      <p className="text-[10px] text-slate-400">{activeResource.type} · {activeResource.status}</p>
                    </div>
                    <Link href={`/inventory/${activeResource.id}`} className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">Open item</Link>
                  </div>

                  {isEditing ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Draw geometry</p>
                      <input value={newLayer} onChange={(event) => setNewLayer(event.target.value)} placeholder="Layer, e.g. Workshop" className={inputClass} />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => startDrawing("point")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${drawMode === "point" ? "bg-violet-600 text-white" : "border border-slate-200 bg-white text-slate-700"}`}><MapPin size={14} /> Place point</button>
                        <button type="button" onClick={() => startDrawing("polygon")} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${drawMode === "polygon" ? "bg-orange-500 text-white" : "border border-slate-200 bg-white text-slate-700"}`}><PenTool size={14} /> Draw outline</button>
                      </div>
                      {drawMode !== "idle" ? (
                        <div className="mt-2 rounded-lg bg-white p-2 text-[10px] leading-4 text-slate-500 ring-1 ring-slate-200">
                          {drawMode === "point" ? "Click the map to place a point." : `Click corners on the map · ${polygonDraft.length} point${polygonDraft.length === 1 ? "" : "s"}`}
                          <div className="mt-1.5 flex gap-2">
                            {drawMode === "polygon" ? <button type="button" onClick={finishPolygon} disabled={polygonDraft.length < 3} className="font-semibold text-orange-600 disabled:opacity-40">Finish polygon</button> : null}
                            <button type="button" onClick={cancelDrawing} className="font-semibold text-slate-500">Cancel</button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                {activeFeatures.length ? (
                  <section>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Map features</p>
                    <div className="space-y-1">
                      {activeFeatures.map((feature, index) => (
                        <button key={feature.id} type="button" onClick={() => setActiveFeatureId(feature.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${activeFeatureId === feature.id ? "bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>
                          {feature.type === "point" ? <MapPin size={13} /> : <Shapes size={13} />}
                          <span className="min-w-0 flex-1 truncate">{feature.layer}</span>
                          <span className="text-[10px] text-slate-400">{index + 1}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {activeFeature && isEditing ? (
                  <section className="rounded-xl border border-orange-200 bg-orange-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700">Edit {activeFeature.type}</p>
                      <button type="button" onClick={deleteActiveFeature} className="text-rose-600" aria-label="Delete map feature"><Trash2 size={14} /></button>
                    </div>
                    <label className="block text-[10px] font-semibold text-slate-600">Layer<input value={activeFeature.layer} onChange={(event) => updateActiveFeature({ layer: event.target.value })} className={`${inputClass} mt-1`} /></label>
                    <label className="mt-2 block text-[10px] font-semibold text-slate-600">Description<textarea value={activeFeature.description} onChange={(event) => updateActiveFeature({ description: event.target.value })} rows={2} className={`${inputClass} mt-1 h-auto py-2`} /></label>
                    <p className="mt-2 text-[10px] leading-4 text-slate-500">Drag orange handles · click green handles to add a corner · Alt/Option-click orange handles to remove one.</p>
                  </section>
                ) : null}

                {isEditing && selectedIds.length ? (
                  <section className="border-t border-slate-100 pt-4">
                    <div className="mb-2 flex items-center gap-2"><MousePointer2 size={13} className="text-violet-600" /><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Quick edit · {selectedIds.length} selected</p></div>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={batchForm.status} onChange={(event) => setBatchForm((current) => ({ ...current, status: event.target.value }))} className={inputClass}><option value="">Keep status</option><option value="available">Available</option><option value="in-use">In use</option><option value="maintenance">Maintenance</option><option value="archived">Archived</option></select>
                      <select value={batchForm.type} onChange={(event) => setBatchForm((current) => ({ ...current, type: event.target.value }))} className={inputClass}><option value="">Keep type</option>{resourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                      <select value={batchForm.priority} onChange={(event) => setBatchForm((current) => ({ ...current, priority: event.target.value }))} className={`${inputClass} col-span-2`}><option value="">Keep priority</option>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>Priority {priority}</option>)}</select>
                      <input value={batchForm.addTags} onChange={(event) => setBatchForm((current) => ({ ...current, addTags: event.target.value }))} placeholder="Add tags…" className={`${inputClass} col-span-2`} />
                      <label className="col-span-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] font-semibold text-slate-600"><input type="checkbox" checked={applyLocation} onChange={(event) => setApplyLocation(event.target.checked)} className="accent-violet-600" /> Change location label</label>
                      {applyLocation ? <input value={batchForm.location} onChange={(event) => setBatchForm((current) => ({ ...current, location: event.target.value }))} placeholder="Workshop · Shelf A3 (empty clears)" className={`${inputClass} col-span-2`} /> : null}
                    </div>
                    <button type="button" onClick={() => void applyBatch()} disabled={batchSaving} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-xs font-semibold text-white disabled:opacity-50">{batchSaving ? <LoaderCircle size={14} className="animate-spin" /> : <ListChecks size={14} />}Apply to selection</button>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="grid h-full min-h-40 place-items-center px-6 text-center text-xs leading-5 text-slate-400">Select an item in the list or on the map.</div>
            )}
          </div>
        </aside>

        <section className="relative min-h-[560px] overflow-hidden bg-[#e7eaed]">
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
            onSelectResource={selectResource}
            onSelectFeature={setActiveFeatureId}
            onPlacePoint={addPoint}
            onAddPolygonPoint={(coordinate) => setPolygonDraft((current) => [...current, coordinate])}
            onChangeFeatures={markChanged}
          />

          <div className="absolute left-3 top-3 z-10 flex rounded-xl border border-white/80 bg-white/95 p-1 shadow-lg backdrop-blur">
            <button type="button" onClick={() => setBasemap("streets")} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ${basemap === "streets" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}><MapIcon size={13} /> Map</button>
            <button type="button" onClick={() => setBasemap("satellite")} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ${basemap === "satellite" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}><Satellite size={13} /> Satellite</button>
          </div>
          {isEditing && drawMode !== "idle" ? (
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-white/80 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur">
              {drawMode === "point" ? "Click once to place the item" : `${polygonDraft.length} corners · Enter to finish · Esc to cancel`}
            </div>
          ) : null}
          {isEditing ? (
            <div className="pointer-events-none absolute bottom-3 right-3 z-10 hidden rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] text-slate-500 shadow sm:block">
              Shift-click to add to selection · P point · G polygon · ⌘/Ctrl+S save
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
