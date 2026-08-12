"use client";

import {
  ArrowDownToLine,
  Boxes,
  Link2,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type InventoryType = {
  key: string;
  label: string;
  canContain: boolean;
};

type RelationType = {
  key: string;
  label: string;
  inverseLabel: string;
  allowManual: boolean;
  archivedAt: string | null;
};

type RelationResource = Pick<ClientResource, "id" | "name" | "type" | "status">;

type Relation = {
  id: string;
  sourceResourceId: string;
  targetResourceId: string;
  relationTypeKey: string;
  origin: "manual" | "spatial";
  createdAt: string;
  source: RelationResource | null;
  target: RelationResource | null;
  relationType: RelationType | null;
};

type ResourceListResponse = {
  resources: ClientResource[];
  pagination: { pages: number };
};

async function loadEveryResource() {
  const first = await fetchJson<ResourceListResponse>(
    "/api/v1/resources?page=1&pageSize=100",
    { cache: "no-store" },
  );
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, first.pagination.pages - 1) }, (_, index) =>
      fetchJson<ResourceListResponse>(
        `/api/v1/resources?page=${index + 2}&pageSize=100`,
        { cache: "no-store" },
      ),
    ),
  );
  return [first, ...remaining].flatMap((page) => page.resources);
}

export function ResourceRelationsManager({
  resourceId,
  canEdit,
}: {
  resourceId: string;
  canEdit: boolean;
}) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [types, setTypes] = useState<InventoryType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [parentId, setParentId] = useState("");
  const [relatedId, setRelatedId] = useState("");
  const [relationTypeKey, setRelationTypeKey] = useState("related");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [relationResponse, loadedResources, typeResponse, relationTypeResponse] =
        await Promise.all([
          fetchJson<{ relations: Relation[] }>(
            `/api/v1/resources/${resourceId}/relations`,
            { cache: "no-store" },
          ),
          loadEveryResource(),
          fetchJson<{ types: InventoryType[] }>("/api/v1/inventory-types", {
            cache: "no-store",
          }),
          fetchJson<{ relationTypes: RelationType[] }>("/api/v1/relation-types", {
            cache: "no-store",
          }),
        ]);
      setRelations(relationResponse.relations);
      setResources(loadedResources.filter((resource) => resource.id !== resourceId));
      setTypes(typeResponse.types);
      setRelationTypes(
        relationTypeResponse.relationTypes.filter(
          (relationType) => relationType.allowManual && relationType.key !== "contains",
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load relationships.");
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const containerTypes = useMemo(
    () => new Set(types.filter((type) => type.canContain).map((type) => type.key)),
    [types],
  );
  const possibleParents = resources.filter((resource) => containerTypes.has(resource.type));
  const parents = relations.filter(
    (relation) =>
      relation.relationTypeKey === "contains" &&
      relation.targetResourceId === resourceId,
  );
  const children = relations.filter(
    (relation) =>
      relation.relationTypeKey === "contains" &&
      relation.sourceResourceId === resourceId,
  );
  const others = relations.filter((relation) => relation.relationTypeKey !== "contains");

  async function addRelation(payload: {
    sourceResourceId: string;
    targetResourceId: string;
    relationTypeKey: string;
  }) {
    setSaving(true);
    setError(null);
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setParentId("");
      setRelatedId("");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save relationship.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRelation(relation: Relation) {
    setSaving(true);
    setError(null);
    try {
      await fetchJson(
        `/api/v1/relations/${relation.id}?resourceId=${encodeURIComponent(resourceId)}`,
        { method: "DELETE" },
      );
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove relationship.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-8 sm:px-6 lg:px-8">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-600 text-white">
              <Link2 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-950">Placement & relationships</h2>
              <p className="mt-1 text-sm text-slate-600">
                Map outlines assign the most specific containing item automatically. Manual placements stay pinned.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Refresh relationships"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error ? (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <MapPin className="size-4 text-emerald-600" /> Located in
            </h3>
            <div className="mt-3 space-y-2">
              {parents.length ? parents.map((relation) => (
                <RelationRow
                  key={relation.id}
                  relation={relation}
                  resource={relation.source}
                  label={relation.relationType?.inverseLabel ?? "Located in"}
                  saving={saving}
                  onRemove={canEdit ? removeRelation : undefined}
                />
              )) : (
                <EmptyState
                  icon={<MapPin className="size-5" />}
                  title="No parent assigned"
                  description="Draw this item inside a container outline, or choose a parent manually."
                />
              )}
            </div>
            {canEdit ? (
              <div className="mt-3 flex gap-2">
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Choose a room, furniture item, or container…</option>
                  {possibleParents.map((resource) => (
                    <option key={resource.id} value={resource.id}>{resource.name} · {resource.type}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  disabled={!parentId || saving}
                  onClick={() => void addRelation({
                    sourceResourceId: parentId,
                    targetResourceId: resourceId,
                    relationTypeKey: "contains",
                  })}
                >
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Add
                </Button>
              </div>
            ) : null}
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Boxes className="size-4 text-violet-600" /> Contains
            </h3>
            <div className="mt-3 space-y-2">
              {children.length ? children.map((relation) => (
                <RelationRow
                  key={relation.id}
                  relation={relation}
                  resource={relation.target}
                  label={relation.relationType?.label ?? "Contains"}
                  saving={saving}
                  onRemove={canEdit ? removeRelation : undefined}
                />
              )) : (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-600">
                  No contained items yet.
                </p>
              )}
            </div>
          </div>
        </div>

        <details className="border-t border-slate-200 px-5 py-4 sm:px-6">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Other relationships ({others.length})
          </summary>
          <div className="mt-4 space-y-2">
            {others.map((relation) => {
              const outgoing = relation.sourceResourceId === resourceId;
              return (
                <RelationRow
                  key={relation.id}
                  relation={relation}
                  resource={outgoing ? relation.target : relation.source}
                  label={outgoing
                    ? relation.relationType?.label ?? relation.relationTypeKey
                    : relation.relationType?.inverseLabel ?? relation.relationTypeKey}
                  saving={saving}
                  onRemove={canEdit ? removeRelation : undefined}
                />
              );
            })}
          </div>
          {canEdit ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[170px_minmax(0,1fr)_auto]">
              <select
                value={relationTypeKey}
                onChange={(event) => setRelationTypeKey(event.target.value)}
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                {relationTypes.map((relationType) => (
                  <option key={relationType.key} value={relationType.key}>{relationType.label}</option>
                ))}
              </select>
              <select
                value={relatedId}
                onChange={(event) => setRelatedId(event.target.value)}
                className="h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">Choose another inventory item…</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>{resource.name} · {resource.type}</option>
                ))}
              </select>
              <Button
                type="button"
                disabled={!relatedId || !relationTypeKey || saving}
                onClick={() => void addRelation({
                  sourceResourceId: resourceId,
                  targetResourceId: relatedId,
                  relationTypeKey,
                })}
              >
                <Plus className="size-4" /> Link
              </Button>
            </div>
          ) : null}
        </details>
      </Card>
    </section>
  );
}

function RelationRow({
  relation,
  resource,
  label,
  saving,
  onRemove,
}: {
  relation: Relation;
  resource: RelationResource | null;
  label: string;
  saving: boolean;
  onRemove?: (relation: Relation) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <ArrowDownToLine className="size-4 shrink-0 text-slate-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">{resource?.name ?? "Missing item"}</p>
        <p className="mt-0.5 text-[10px] text-slate-600">{label} · {resource?.type ?? "unknown"}</p>
      </div>
      {relation.origin === "spatial" ? (
        <Badge tone="brand"><Sparkles className="mr-1 size-3" /> Automatic</Badge>
      ) : (
        <Badge>Manual</Badge>
      )}
      {relation.origin === "manual" && onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(relation)}
          disabled={saving}
          className="grid size-8 place-items-center rounded-lg text-slate-600 hover:bg-red-50 hover:text-red-600"
          aria-label={`Remove relationship with ${resource?.name ?? "item"}`}
        >
          <Trash2 className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
