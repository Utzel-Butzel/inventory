"use client";

import {
  Boxes,
  ChevronLeft,
  ExternalLink,
  GitBranch,
  Link2,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { InventorySelect } from "@/components/inventory-select";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { Button, cn } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import {
  availableBomQuantityUnits,
  bomQuantityFromDisplay,
  bomQuantityToDisplay,
  normalizeBomQuantityUnit,
  type BomQuantityUnit,
  type BomQuantityUnitConfiguration,
} from "@/lib/bom-quantity-units";
import type {
  ConnectionDiagramBomComponent,
  ConnectionDiagramGraphEdge,
  ConnectionDiagramPayload,
  ConnectionDiagramResource,
} from "@/lib/resource-connection-diagram";

export type ConnectionEditorSelection =
  | {
      type: "node";
      resource: ConnectionDiagramResource;
    }
  | {
      type: "edge";
      edge: ConnectionDiagramGraphEdge;
      firstResource: ConnectionDiagramResource;
      secondResource: ConnectionDiagramResource;
    };

export type ConnectionEditorChangeKind = "bom" | "family" | "relationship";

type EditorAction =
  | "bom"
  | "variant"
  | "contained"
  | "container"
  | "relationship";

type CandidateResource = ConnectionDiagramResource & {
  sku?: string | null;
  cover?: {
    id?: string;
    url: string;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type RelationType = {
  key: string;
  label: string;
  inverseLabel: string;
  allowManual: boolean;
  archivedAt: string | null;
};

type InventoryType = {
  key: string;
  canContain: boolean;
};

type CandidateStock = BomQuantityUnitConfiguration & {
  resourceId: string;
};

const defaultQuantityConfiguration: BomQuantityUnitConfiguration = {
  unitName: "unit",
  purchaseUnitName: null,
  purchaseUnitFactor: null,
};

const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const labelClass = "block text-[13px] font-semibold text-muted-strong";

const actionIcons = {
  bom: Package,
  variant: GitBranch,
  contained: Boxes,
  container: MapPin,
  relationship: Link2,
} satisfies Record<EditorAction, typeof Package>;

const actionTone = {
  bom: "text-warning bg-warning-soft",
  variant: "text-brand bg-brand-soft",
  contained: "text-success bg-success-soft",
  container: "text-success bg-success-soft",
  relationship: "text-info bg-info-soft",
} satisfies Record<EditorAction, string>;

function bomWritePayload(
  components: ConnectionDiagramBomComponent[],
  appended?: {
    resourceId: string;
    quantityPerAssembly: number;
    quantityUnit: BomQuantityUnit;
    note: string;
  },
) {
  const ordered = [...components].sort(
    (left, right) => (left.position ?? 0) - (right.position ?? 0),
  );
  return {
    components: [
      ...ordered.map((component, position) => ({
        ...(component.slotKey ? { slotKey: component.slotKey } : {}),
        resourceId: component.resourceId,
        quantityPerAssembly: component.quantityPerAssembly,
        quantityUnit: component.quantityUnit ?? "base",
        position,
        note: component.note?.trim() || undefined,
      })),
      ...(appended
        ? [
            {
              resourceId: appended.resourceId,
              quantityPerAssembly: appended.quantityPerAssembly,
              quantityUnit: appended.quantityUnit,
              position: ordered.length,
              note: appended.note.trim() || undefined,
            },
          ]
        : []),
    ],
  };
}

export function ResourceConnectionEditorPanel({
  selection,
  rootResourceId,
  canCreate,
  loadPayload,
  onChanged,
  onClose,
}: {
  selection: ConnectionEditorSelection;
  rootResourceId: string;
  canCreate: boolean;
  loadPayload: (resourceId: string) => Promise<ConnectionDiagramPayload>;
  onChanged: (kind: ConnectionEditorChangeKind) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useT("resource");
  const selectionKey =
    selection.type === "node"
      ? `node:${selection.resource.id}`
      : `edge:${selection.edge.key}`;
  const [action, setAction] = useState<EditorAction | null>(null);
  const [payload, setPayload] = useState<ConnectionDiagramPayload | null>(null);
  const [loadingPayload, setLoadingPayload] = useState(false);
  const [candidateMode, setCandidateMode] = useState<"existing" | "new">(
    "existing",
  );
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidates, setCandidates] = useState<CandidateResource[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [searching, setSearching] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [quantityUnit, setQuantityUnit] = useState<BomQuantityUnit>("base");
  const [candidateStock, setCandidateStock] = useState<CandidateStock | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [newName, setNewName] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [relationTypeKey, setRelationTypeKey] = useState("");
  const [containerTypeKeys, setContainerTypeKeys] = useState<Set<string>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edgeQuantities, setEdgeQuantities] = useState<Record<string, string>>(
    {},
  );
  const [edgeQuantityUnits, setEdgeQuantityUnits] = useState<
    Record<string, BomQuantityUnit>
  >({});

  useEffect(() => {
    setAction(null);
    setPayload(null);
    setCandidateMode("existing");
    setCandidateQuery("");
    setCandidates([]);
    setCandidateId("");
    setQuantity("1");
    setQuantityUnit("base");
    setCandidateStock(null);
    setNote("");
    setNewName("");
    setNewSku("");
    setNewBarcode("");
    setError(null);
    setEdgeQuantities({});
    setEdgeQuantityUnits({});
  }, [selectionKey]);

  useEffect(() => {
    let cancelled = false;
    if (selection.type !== "node") return;
    setLoadingPayload(true);
    void loadPayload(selection.resource.id)
      .then((loaded) => {
        if (!cancelled) setPayload(loaded);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("connectionDiagram.editor.errors.loadContext"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPayload(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPayload, selection, selectionKey, t]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<{ relationTypes: RelationType[] }>("/api/v1/relation-types"),
      fetchJson<{ types: InventoryType[] }>("/api/v1/inventory-types"),
    ])
      .then(([relationResponse, typeResponse]) => {
        if (cancelled) return;
        const manual = relationResponse.relationTypes.filter(
          (relationType) =>
            relationType.allowManual &&
            !relationType.archivedAt &&
            relationType.key !== "contains" &&
            relationType.key !== "variant_of",
        );
        setRelationTypes(manual);
        setRelationTypeKey((current) => current || manual[0]?.key || "");
        setContainerTypeKeys(
          new Set(
            typeResponse.types
              .filter((type) => type.canContain)
              .map((type) => type.key),
          ),
        );
      })
      .catch(() => {
        // The selected action will surface a useful error if its metadata is
        // required. BOM and family editing remain available independently.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selection.type !== "node" || !action || candidateMode !== "existing") {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const search = new URLSearchParams({
          page: "1",
          pageSize: "20",
          media: "cover",
        });
        if (candidateQuery.trim()) search.set("q", candidateQuery.trim());
        const response = await fetchJson<{ resources: CandidateResource[] }>(
          `/api/v1/resources?${search}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const existingBomIds = new Set(
          action === "bom"
            ? (payload?.bomComponents ?? []).map(
                (component) => component.resourceId,
              )
            : [],
        );
        const familyIds = new Set([
          payload?.family?.primary.id,
          ...(payload?.family?.variants.map((variant) => variant.id) ?? []),
        ]);
        setCandidates(
          response.resources.filter((candidate) => {
            if (
              candidate.id === selection.resource.id ||
              candidate.status === "archived"
            ) {
              return false;
            }
            if (action === "bom" && existingBomIds.has(candidate.id)) {
              return false;
            }
            if (action === "variant" && familyIds.has(candidate.id)) {
              return false;
            }
            if (action === "container") {
              return containerTypeKeys.has(candidate.type ?? "");
            }
            return true;
          }),
        );
      } catch (searchError) {
        if (!controller.signal.aborted) {
          setError(
            searchError instanceof Error
              ? searchError.message
              : t("connectionDiagram.editor.errors.search"),
          );
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    action,
    candidateMode,
    candidateQuery,
    containerTypeKeys,
    payload,
    selection,
    t,
  ]);

  useEffect(() => {
    if (action !== "bom" || candidateMode !== "existing" || !candidateId) {
      setCandidateStock(null);
      setQuantityUnit("base");
      return;
    }
    const controller = new AbortController();
    setCandidateStock(null);
    setQuantityUnit("base");
    void fetchJson<{ stock: CandidateStock[] }>(
      `/api/v1/resources/stock-summaries?id=${encodeURIComponent(candidateId)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then((response) => {
        if (!controller.signal.aborted) {
          setCandidateStock(response.stock[0] ?? null);
        }
      })
      .catch(() => {
        // The base unit remains usable when stock metadata is unavailable.
      });
    return () => controller.abort();
  }, [action, candidateId, candidateMode]);

  const selectedCandidate = candidates.find(
    (candidate) => candidate.id === candidateId,
  );
  const quantityConfiguration =
    candidateMode === "existing" && candidateStock?.resourceId === candidateId
      ? candidateStock
      : defaultQuantityConfiguration;
  const variantUnavailable =
    payload?.family?.role === "variant" ||
    (payload?.family?.optionGroupCount ?? 0) > 0;
  const selectedCanContain =
    selection.type === "node" &&
    containerTypeKeys.has(selection.resource.type ?? "");
  const canCreateForAction =
    canCreate && action !== "container" && action !== null;

  const selectAction = (nextAction: EditorAction) => {
    setAction(nextAction);
    setCandidateMode("existing");
    setCandidateQuery("");
    setCandidates([]);
    setCandidateId("");
    setQuantity("1");
    setQuantityUnit("base");
    setCandidateStock(null);
    setError(null);
  };

  const notifyChanged = async (kind: ConnectionEditorChangeKind) => {
    window.dispatchEvent(
      new Event(
        kind === "family"
          ? "resource-family-changed"
          : kind === "bom"
            ? "resource-bom-changed"
            : "resource-relations-changed",
      ),
    );
    await onChanged(kind);
  };

  const createStandaloneResource = async () => {
    const response = await fetchJson<{ resource: CandidateResource }>(
      "/api/v1/resources",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      },
    );
    return response.resource;
  };

  const saveNodeConnection = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selection.type !== "node" || !action) return;
    if (action === "variant" && variantUnavailable) {
      setError(t("connectionDiagram.editor.errors.variantUnavailable"));
      return;
    }
    if (action === "contained" && !selectedCanContain) {
      setError(t("connectionDiagram.editor.errors.cannotContain"));
      return;
    }
    if (candidateMode === "new" && !newName.trim()) {
      setError(t("connectionDiagram.editor.errors.nameRequired"));
      return;
    }
    if (candidateMode === "existing" && !candidateId) {
      setError(t("connectionDiagram.editor.errors.itemRequired"));
      return;
    }
    const parsedQuantity = Number(quantity);
    if (
      action === "bom" &&
      (!Number.isInteger(parsedQuantity) || parsedQuantity < 1)
    ) {
      setError(t("connectionDiagram.editor.errors.quantity"));
      return;
    }
    let baseQuantity = parsedQuantity;
    if (action === "bom") {
      try {
        baseQuantity = bomQuantityFromDisplay(
          parsedQuantity,
          quantityUnit,
          quantityConfiguration,
        );
      } catch {
        setError(t("connectionDiagram.editor.errors.quantity"));
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      if (action === "variant" && candidateMode === "new") {
        await fetchJson(`/api/v1/resources/${selection.resource.id}/family`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName.trim(),
            sku: newSku.trim() || null,
            barcode: newBarcode.trim() || null,
          }),
        });
        await notifyChanged("family");
        return;
      }

      const candidate =
        candidateMode === "new"
          ? await createStandaloneResource()
          : selectedCandidate;
      if (!candidate) {
        setError(t("connectionDiagram.editor.errors.itemRequired"));
        return;
      }

      if (action === "bom") {
        const current = await loadPayload(selection.resource.id);
        await fetchJson(`/api/v1/resources/${selection.resource.id}/bom`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            bomWritePayload(current.bomComponents, {
              resourceId: candidate.id,
              quantityPerAssembly: baseQuantity,
              quantityUnit,
              note,
            }),
          ),
        });
        await notifyChanged("bom");
        return;
      }

      if (action === "variant") {
        await fetchJson(`/api/v1/resources/${selection.resource.id}/family`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ existingResourceId: candidate.id }),
        });
        await notifyChanged("family");
        return;
      }

      const relationType =
        action === "contained" || action === "container"
          ? "contains"
          : relationTypeKey;
      if (!relationType) {
        setError(t("connectionDiagram.editor.errors.relationTypeRequired"));
        return;
      }
      await fetchJson(
        `/api/v1/resources/${selection.resource.id}/relations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceResourceId:
              action === "container" ? candidate.id : selection.resource.id,
            targetResourceId:
              action === "container" ? selection.resource.id : candidate.id,
            relationTypeKey: relationType,
          }),
        },
      );
      await notifyChanged("relationship");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("connectionDiagram.editor.errors.save"),
      );
    } finally {
      setSaving(false);
    }
  };

  const updateBomConnection = async (
    assemblyResourceId: string,
    componentResourceId: string,
    nextQuantity?: number,
    nextQuantityUnit?: BomQuantityUnit,
  ) => {
    const current = await loadPayload(assemblyResourceId);
    const components = current.bomComponents
      .filter(
        (component) =>
          nextQuantity !== undefined ||
          component.resourceId !== componentResourceId,
      )
      .map((component) =>
        component.resourceId === componentResourceId &&
        nextQuantity !== undefined
          ? {
              ...component,
              quantityPerAssembly: nextQuantity,
              quantityUnit: nextQuantityUnit ?? "base",
            }
          : component,
      );
    await fetchJson(`/api/v1/resources/${assemblyResourceId}/bom`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bomWritePayload(components)),
    });
  };

  const mutateEdgeConnection = async (
    connection: ConnectionDiagramGraphEdge["connections"][number],
    operation: "update" | "remove",
  ) => {
    setSaving(true);
    setError(null);
    try {
      if (connection.kind === "bom") {
        const descriptor = connection.descriptor;
        const quantityConfiguration =
          descriptor.type === "component" || descriptor.type === "assembly"
            ? {
                unitName: descriptor.unitName ?? "unit",
                purchaseUnitName: descriptor.purchaseUnitName ?? null,
                purchaseUnitFactor: descriptor.purchaseUnitFactor ?? null,
              }
            : defaultQuantityConfiguration;
        const storedQuantityUnit =
          descriptor.type === "component" || descriptor.type === "assembly"
            ? normalizeBomQuantityUnit(
                descriptor.quantity,
                descriptor.quantityUnit,
                quantityConfiguration,
              )
            : "base";
        const selectedQuantityUnit =
          edgeQuantityUnits[connection.canonicalId] ?? storedQuantityUnit;
        const value = Number(
          edgeQuantities[connection.canonicalId] ||
            (descriptor.type === "component" || descriptor.type === "assembly"
              ? bomQuantityToDisplay(
                  descriptor.quantity,
                  selectedQuantityUnit,
                  quantityConfiguration,
                )
              : 1),
        );
        if (
          operation === "update" &&
          (!Number.isInteger(value) || value < 1)
        ) {
          setError(t("connectionDiagram.editor.errors.quantity"));
          return;
        }
        let baseQuantity = value;
        if (operation === "update") {
          try {
            baseQuantity = bomQuantityFromDisplay(
              value,
              selectedQuantityUnit,
              quantityConfiguration,
            );
          } catch {
            setError(t("connectionDiagram.editor.errors.quantity"));
            return;
          }
        }
        if (
          operation === "remove" &&
          !window.confirm(t("connectionDiagram.editor.edge.confirmRemoveBom"))
        ) {
          return;
        }
        await updateBomConnection(
          connection.toResourceId,
          connection.fromResourceId,
          operation === "update" ? baseQuantity : undefined,
          operation === "update" ? selectedQuantityUnit : undefined,
        );
        await notifyChanged("bom");
        return;
      }

      if (connection.kind === "family") {
        if (connection.descriptor.type === "sibling") {
          setError(t("connectionDiagram.editor.errors.openFamilyMember"));
          return;
        }
        if (
          !window.confirm(
            t("connectionDiagram.editor.edge.confirmDetachVariant"),
          )
        ) {
          return;
        }
        await fetchJson(
          `/api/v1/resources/${connection.fromResourceId}/family`,
          { method: "DELETE" },
        );
        await notifyChanged("family");
        return;
      }

      if (
        operation === "remove" &&
        !window.confirm(t("connectionDiagram.editor.edge.confirmRemoveRelation"))
      ) {
        return;
      }
      const relationId = connection.id.replace(/^relation:/, "");
      const authorizationResourceId = [
        connection.fromResourceId,
        connection.toResourceId,
      ].includes(rootResourceId)
        ? rootResourceId
        : connection.toResourceId;
      await fetchJson(
        `/api/v1/relations/${relationId}?resourceId=${encodeURIComponent(authorizationResourceId)}`,
        { method: "DELETE" },
      );
      await notifyChanged("relationship");
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : t("connectionDiagram.editor.errors.save"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (selection.type === "edge") {
    return (
      <EditorShell
        title={t("connectionDiagram.editor.edge.title")}
        description={t("connectionDiagram.editor.edge.between", {
          first: selection.firstResource.name,
          second: selection.secondResource.name,
        })}
        onClose={onClose}
      >
        {error ? <EditorError message={error} onClose={() => setError(null)} /> : null}
        <div className="space-y-3 p-4">
          {selection.edge.connections.map((connection) => {
            const descriptor = connection.descriptor;
            const isSibling = descriptor.type === "sibling";
            const bomDescriptor =
              connection.kind === "bom" &&
              (descriptor.type === "component" || descriptor.type === "assembly")
                ? descriptor
                : null;
            const edgeQuantityConfiguration = bomDescriptor
              ? {
                  unitName: bomDescriptor.unitName ?? "unit",
                  purchaseUnitName: bomDescriptor.purchaseUnitName ?? null,
                  purchaseUnitFactor: bomDescriptor.purchaseUnitFactor ?? null,
                }
              : defaultQuantityConfiguration;
            const storedEdgeQuantityUnit = bomDescriptor
              ? normalizeBomQuantityUnit(
                  bomDescriptor.quantity,
                  bomDescriptor.quantityUnit,
                  edgeQuantityConfiguration,
                )
              : "base";
            const selectedEdgeQuantityUnit =
              edgeQuantityUnits[connection.canonicalId] ??
              storedEdgeQuantityUnit;
            return (
              <div
                key={connection.canonicalId}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      actionTone[
                        connection.kind === "family"
                          ? "variant"
                          : connection.kind === "containment"
                            ? "contained"
                            : connection.kind
                      ],
                    )}
                  >
                    {connection.kind === "family" ? (
                      <GitBranch className="size-4" aria-hidden="true" />
                    ) : connection.kind === "bom" ? (
                      <Package className="size-4" aria-hidden="true" />
                    ) : connection.kind === "containment" ? (
                      <MapPin className="size-4" aria-hidden="true" />
                    ) : (
                      <Link2 className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-foreground">
                      {edgeConnectionLabel(connection, t)}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-4 text-muted">
                      {t(
                        `connectionDiagram.editor.edge.descriptions.${connection.kind}`,
                      )}
                    </p>
                  </div>
                </div>

                {bomDescriptor ? (
                  <div className="mt-3 flex items-end gap-2">
                    <label className={`${labelClass} min-w-0 flex-1`}>
                      {t("connectionDiagram.editor.fields.quantity")}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={
                          edgeQuantities[connection.canonicalId] ??
                          String(
                            bomQuantityToDisplay(
                              bomDescriptor.quantity,
                              selectedEdgeQuantityUnit,
                              edgeQuantityConfiguration,
                            ),
                          )
                        }
                        onChange={(event) =>
                          setEdgeQuantities((current) => ({
                            ...current,
                            [connection.canonicalId]: event.target.value,
                          }))
                        }
                        className={`${inputClass} mt-1.5`}
                      />
                    </label>
                    <label className={`${labelClass} w-32 shrink-0`}>
                      {t("connectionDiagram.editor.fields.quantityUnit")}
                      <select
                        value={selectedEdgeQuantityUnit}
                        onChange={(event) => {
                          const nextUnit = event.target.value as BomQuantityUnit;
                          setEdgeQuantityUnits((current) => ({
                            ...current,
                            [connection.canonicalId]: nextUnit,
                          }));
                          setEdgeQuantities((current) => ({
                            ...current,
                            [connection.canonicalId]: String(
                              bomQuantityToDisplay(
                                bomDescriptor.quantity,
                                nextUnit,
                                edgeQuantityConfiguration,
                              ),
                            ),
                          }));
                        }}
                        className={`${inputClass} mt-1.5`}
                      >
                        {availableBomQuantityUnits(edgeQuantityConfiguration).map(
                          (unit) => (
                            <option key={unit} value={unit}>
                              {unit === "purchase"
                                ? edgeQuantityConfiguration.purchaseUnitName
                                : edgeQuantityConfiguration.unitName}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() =>
                        void mutateEdgeConnection(connection, "update")
                      }
                    >
                      {t("connectionDiagram.editor.actions.apply")}
                    </Button>
                  </div>
                ) : null}

                <Button
                  className="mt-3 w-full"
                  variant="danger"
                  size="sm"
                  disabled={saving || isSibling}
                  onClick={() =>
                    void mutateEdgeConnection(connection, "remove")
                  }
                >
                  {saving ? (
                    <LoaderCircle
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  )}
                  {connection.kind === "family"
                    ? t("connectionDiagram.editor.actions.detach")
                    : t("connectionDiagram.editor.actions.remove")}
                </Button>
                {isSibling ? (
                  <p className="mt-2 text-[12px] leading-4 text-muted">
                    {t("connectionDiagram.editor.edge.siblingHelp")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </EditorShell>
    );
  }

  const selectedResource = selection.resource;
  return (
    <EditorShell
      title={
        action
          ? t(`connectionDiagram.editor.actions.${action}`)
          : t("connectionDiagram.editor.title")
      }
      description={selectedResource.name}
      onBack={action ? () => setAction(null) : undefined}
      onClose={onClose}
      trailing={
        <Link
          href={`/inventory/${selectedResource.id}`}
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground"
          aria-label={t("connectionDiagram.openItem", {
            name: selectedResource.name,
          })}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {error ? <EditorError message={error} onClose={() => setError(null)} /> : null}
      {loadingPayload && !payload ? (
        <div className="flex min-h-36 items-center justify-center gap-2 text-xs text-muted">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {t("connectionDiagram.editor.loadingContext")}
        </div>
      ) : !action ? (
        <div className="space-y-2 p-4">
          <p className="pb-1 text-[13px] leading-5 text-muted">
            {t("connectionDiagram.editor.chooseAction")}
          </p>
          {(
            [
              "bom",
              "variant",
              "contained",
              "container",
              "relationship",
            ] as const
          ).map((candidateAction) => {
            const Icon = actionIcons[candidateAction];
            const disabled =
              (candidateAction === "variant" && variantUnavailable) ||
              (candidateAction === "contained" && !selectedCanContain);
            return (
              <button
                key={candidateAction}
                type="button"
                disabled={disabled}
                onClick={() => selectAction(candidateAction)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition hover:border-border-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-lg",
                    actionTone[candidateAction],
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-foreground">
                    {t(`connectionDiagram.editor.actions.${candidateAction}`)}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-muted">
                    {disabled
                      ? t(
                          `connectionDiagram.editor.unavailable.${candidateAction}`,
                        )
                      : t(
                          `connectionDiagram.editor.actionDescriptions.${candidateAction}`,
                        )}
                  </span>
                </span>
                <Plus className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : (
        <form onSubmit={saveNodeConnection} className="p-4">
          <div className="flex rounded-lg bg-surface-muted p-1">
            <button
              type="button"
              onClick={() => setCandidateMode("existing")}
              className={cn(
                "h-8 flex-1 rounded-md px-2 text-[13px] font-semibold transition",
                candidateMode === "existing"
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              {t("connectionDiagram.editor.modes.existing")}
            </button>
            {canCreateForAction ? (
              <button
                type="button"
                onClick={() => setCandidateMode("new")}
                className={cn(
                  "h-8 flex-1 rounded-md px-2 text-[13px] font-semibold transition",
                  candidateMode === "new"
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted hover:text-foreground",
                )}
              >
                {t("connectionDiagram.editor.modes.new")}
              </button>
            ) : null}
          </div>

          {candidateMode === "existing" ? (
            <div className="mt-4">
              <InventorySelect
                items={candidates}
                selectedIds={candidateId ? [candidateId] : []}
                onSelect={(candidate) => setCandidateId(candidate.id)}
                query={candidateQuery}
                onQueryChange={setCandidateQuery}
                label={t("connectionDiagram.editor.fields.item")}
                placeholder={t(
                  "connectionDiagram.editor.fields.searchPlaceholder",
                )}
                emptyText={t("connectionDiagram.editor.noCandidates")}
                searchingText={t("connectionDiagram.editor.searching")}
                selectedText={t("connectionDiagram.editor.selected")}
                searching={searching}
              />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <label className={labelClass}>
                {t("connectionDiagram.editor.fields.name")}
                <input
                  required
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
              {action === "variant" ? (
                <>
                  <label className={labelClass}>
                    {t("connectionDiagram.editor.fields.sku")}
                    <input
                      value={newSku}
                      onChange={(event) => setNewSku(event.target.value)}
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("connectionDiagram.editor.fields.barcode")}
                    <input
                      value={newBarcode}
                      onChange={(event) => setNewBarcode(event.target.value)}
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                </>
              ) : (
                <p className="rounded-lg bg-info-soft px-3 py-2 text-[12px] leading-4 text-info">
                  {t("connectionDiagram.editor.newItemHelp")}
                </p>
              )}
            </div>
          )}

          {action === "bom" ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-[minmax(0,1fr)_132px] gap-2">
                <label className={labelClass}>
                  {t("connectionDiagram.editor.fields.quantity")}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    className={`${inputClass} mt-1.5`}
                  />
                </label>
                <label className={labelClass}>
                  {t("connectionDiagram.editor.fields.quantityUnit")}
                  <select
                    value={quantityUnit}
                    onChange={(event) =>
                      setQuantityUnit(event.target.value as BomQuantityUnit)
                    }
                    className={`${inputClass} mt-1.5`}
                  >
                    {availableBomQuantityUnits(quantityConfiguration).map(
                      (unit) => (
                        <option key={unit} value={unit}>
                          {unit === "purchase"
                            ? quantityConfiguration.purchaseUnitName
                            : quantityConfiguration.unitName}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {quantityConfiguration.purchaseUnitName &&
              quantityConfiguration.purchaseUnitFactor ? (
                <p className="text-[12px] leading-4 text-muted">
                  {t("connectionDiagram.editor.purchaseUnitConversion", {
                    purchaseUnit: quantityConfiguration.purchaseUnitName,
                    count: quantityConfiguration.purchaseUnitFactor,
                    baseUnit: quantityConfiguration.unitName,
                  })}
                </p>
              ) : null}
              <label className={labelClass}>
                {t("connectionDiagram.editor.fields.note")}
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className={`${inputClass} mt-1.5`}
                />
              </label>
            </div>
          ) : null}

          {action === "relationship" ? (
            <label className={`${labelClass} mt-4`}>
              {t("connectionDiagram.editor.fields.relationType")}
              <select
                value={relationTypeKey}
                onChange={(event) => setRelationTypeKey(event.target.value)}
                className={`${inputClass} mt-1.5`}
              >
                {relationTypes.map((relationType) => (
                  <option key={relationType.key} value={relationType.key}>
                    {relationType.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <Button
            type="submit"
            className="mt-5 w-full"
            disabled={
              saving ||
              (candidateMode === "existing" && !candidateId) ||
              (candidateMode === "new" && !newName.trim())
            }
          >
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            {saving
              ? t("connectionDiagram.editor.actions.saving")
              : t("connectionDiagram.editor.actions.connect")}
          </Button>
        </form>
      )}
    </EditorShell>
  );
}

function EditorShell({
  title,
  description,
  trailing,
  onBack,
  onClose,
  children,
}: {
  title: string;
  description: string;
  trailing?: React.ReactNode;
  onBack?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useT("resource");
  return (
    <aside className="min-h-full border-t border-border bg-surface lg:border-l lg:border-t-0">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground"
            aria-label={t("connectionDiagram.editor.back")}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="truncate text-xs font-semibold text-foreground">
            {title}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-muted">
            {description}
          </p>
        </div>
        {trailing}
        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground"
          aria-label={t("connectionDiagram.editor.close")}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {children}
    </aside>
  );
}

function EditorError({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const { t } = useT("resource");
  return (
    <div className="flex items-start gap-2 border-b border-danger-border bg-danger-soft px-4 py-2.5 text-[13px] leading-4 text-danger">
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("actions.dismissError")}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function edgeConnectionLabel(
  connection: ConnectionDiagramGraphEdge["connections"][number],
  t: ReturnType<typeof useT>["t"],
) {
  if (connection.descriptor.type === "relationship") {
    return connection.descriptor.label;
  }
  if (
    connection.descriptor.type === "component" ||
    connection.descriptor.type === "assembly"
  ) {
    return t("connectionDiagram.editor.edge.bom");
  }
  return t(`connectionDiagram.kinds.${connection.descriptor.type}`);
}
