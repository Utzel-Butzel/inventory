"use client";

import {
  Boxes,
  ChevronRight,
  CircleDollarSign,
  CircleDot,
  GitBranch,
  LayoutList,
  Link2,
  LoaderCircle,
  MapPin,
  Network,
  Package,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "next-i18next/client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { ResourceFamilyManager } from "@/components/resource-family-manager";
import { ResponsiveMediaImage } from "@/components/responsive-media-image";
import {
  ResourceConnectionEditorPanel,
  type ConnectionEditorChangeKind,
  type ConnectionEditorSelection,
} from "@/components/resource-connection-editor-panel";
import { Badge, Button, Card, cn } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import {
  bomQuantityToDisplay,
  bomQuantityUnitName,
  normalizeBomQuantityUnit,
} from "@/lib/bom-quantity-units";
import {
  buildConnectionCostStructure,
  buildWavyConnectionPath,
  buildResourceConnectionGraph,
  getConnectionFamilyGroups,
  orderConnectionRows,
  type ConnectionCostStructureItem,
  type ConnectionDiagramBomComponent,
  type ConnectionDiagramBomParent,
  type ConnectionDiagramConnection,
  type ConnectionDiagramFamily,
  type ConnectionDiagramGraphEdge,
  type ConnectionDiagramGraphNode,
  type ConnectionDiagramKind,
  type ConnectionDiagramPayload,
  type ConnectionDiagramRelation,
  type ConnectionDiagramResource,
  type ConnectionUnitCost,
} from "@/lib/resource-connection-diagram";

type PayloadResult = {
  payload: ConnectionDiagramPayload;
  partial: boolean;
};

function displayBomQuantity(
  component: ConnectionDiagramBomComponent | ConnectionDiagramBomParent,
) {
  const configuration = {
    unitName: component.unitName ?? "unit",
    purchaseUnitName: component.purchaseUnitName ?? null,
    purchaseUnitFactor: component.purchaseUnitFactor ?? null,
  };
  const unit = normalizeBomQuantityUnit(
    component.quantityPerAssembly,
    component.quantityUnit,
    configuration,
  );
  return {
    count: bomQuantityToDisplay(
      component.quantityPerAssembly,
      unit,
      configuration,
    ),
    unit: bomQuantityUnitName(unit, configuration),
  };
}

type ConnectionDiagramCover = {
  id: string;
  resourceId: string;
  url: string;
  altText: string;
  width: number | null;
  height: number | null;
};

type ConnectionStockStatus = "out" | "low" | "healthy";

type ConnectionStockSummary = {
  resourceId: string;
  quantity: number;
  minimumStock: number;
  unitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
  status: ConnectionStockStatus;
  priceFlow: ConnectionPriceFlow;
};

type ConnectionPriceFlowDirection = {
  quantity: number;
  amountCents: number;
  movementCount: number;
  pricedMovementCount: number;
};

type ConnectionPriceFlow = {
  currency: string;
  inbound: ConnectionPriceFlowDirection;
  outbound: ConnectionPriceFlowDirection;
  neutral: ConnectionPriceFlowDirection;
  unpricedMovementCount: number;
  estimated: boolean;
};

type DisplayRowItem =
  | { type: "resource"; node: ConnectionDiagramGraphNode }
  | { type: "overflow"; row: number; count: number };

type NodePosition = { x: number; y: number };
type EdgeAnchors = { fromX: number; toX: number };

const NODE_WIDTH = 168;
const NODE_HEIGHT = 152;
const NODE_MEDIA_CENTER_Y = 55;
const COLUMN_GAP = 32;
const ROW_STEP = 244;
const CANVAS_PADDING = 24;
const SAME_ROW_EDGE_GUTTER = 48;
const MIN_CANVAS_WIDTH = 860;
const MIN_CANVAS_HEIGHT = 420;
const MAX_VISIBLE_NODES_PER_ROW = 12;
const MAX_GRAPH_NODES = 45;
const FETCH_BATCH_SIZE = 6;
const DEPTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

const kindColor: Record<ConnectionDiagramKind, string> = {
  family: "var(--color-brand)",
  bom: "var(--color-warning)",
  containment: "var(--color-success)",
  relationship: "var(--color-info)",
};

const stockTone: Record<
  ConnectionStockStatus,
  { badge: string; media: string }
> = {
  out: {
    badge: "bg-danger-soft text-danger ring-danger-border",
    media: "ring-2 ring-danger-border",
  },
  low: {
    badge: "bg-warning-soft text-warning ring-warning-border",
    media: "ring-2 ring-warning-border",
  },
  healthy: {
    badge: "bg-success-soft text-success ring-success-border",
    media: "ring-2 ring-success-border",
  },
};

const kindPriority: Record<ConnectionDiagramKind, number> = {
  family: 0,
  bom: 1,
  containment: 2,
  relationship: 3,
};

const humanize = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

const primaryConnection = (connections: ConnectionDiagramConnection[]) =>
  [...connections].sort(
    (left, right) => kindPriority[left.kind] - kindPriority[right.kind],
  )[0];

const visualEdgeEndpoints = (edge: ConnectionDiagramGraphEdge) => {
  const primary = primaryConnection(edge.connections);
  if (!primary) return null;
  const directed = edge.connections.every(
    (connection) =>
      connection.directed &&
      connection.fromResourceId === edge.connections[0]?.fromResourceId &&
      connection.toResourceId === edge.connections[0]?.toResourceId,
  );
  const hierarchyDown = directed && primary.kind === "bom";
  return {
    primary,
    directed,
    fromId: hierarchyDown
      ? edge.connections[0].toResourceId
      : directed
        ? edge.connections[0].fromResourceId
        : edge.firstResourceId,
    toId: hierarchyDown
      ? edge.connections[0].fromResourceId
      : directed
        ? edge.connections[0].toResourceId
        : edge.secondResourceId,
  };
};

const distributedAnchorX = (index: number, count: number) => {
  if (count < 2) return NODE_WIDTH / 2;
  const span = Math.min(NODE_WIDTH - 56, (count - 1) * 32);
  return NODE_WIDTH / 2 - span / 2 + (span * index) / (count - 1);
};

const buildEdgeAnchorMap = (
  edges: ConnectionDiagramGraphEdge[],
  positions: ReadonlyMap<string, NodePosition>,
) => {
  const routes = edges.flatMap((edge) => {
    const endpoints = visualEdgeEndpoints(edge);
    const from = endpoints ? positions.get(endpoints.fromId) : null;
    const to = endpoints ? positions.get(endpoints.toId) : null;
    return endpoints && from && to ? [{ edge, endpoints, from, to }] : [];
  });
  const anchors = new Map<string, EdgeAnchors>(
    routes.map((route) => [
      route.edge.key,
      {
        fromX: route.from.x + NODE_WIDTH / 2,
        toX: route.to.x + NODE_WIDTH / 2,
      },
    ]),
  );
  const outgoing = new Map<string, typeof routes>();
  const incoming = new Map<string, typeof routes>();
  for (const route of routes) {
    outgoing.set(route.endpoints.fromId, [
      ...(outgoing.get(route.endpoints.fromId) ?? []),
      route,
    ]);
    incoming.set(route.endpoints.toId, [
      ...(incoming.get(route.endpoints.toId) ?? []),
      route,
    ]);
  }
  for (const siblings of outgoing.values()) {
    siblings
      .sort((left, right) => left.to.x - right.to.x)
      .forEach((route, index) => {
        const anchor = anchors.get(route.edge.key);
        if (anchor) {
          anchor.fromX =
            route.from.x + distributedAnchorX(index, siblings.length);
        }
      });
  }
  for (const siblings of incoming.values()) {
    siblings
      .sort((left, right) => left.from.x - right.from.x)
      .forEach((route, index) => {
        const anchor = anchors.get(route.edge.key);
        if (anchor) {
          anchor.toX = route.to.x + distributedAnchorX(index, siblings.length);
        }
      });
  }
  return anchors;
};

const truncateRow = (
  nodes: ConnectionDiagramGraphNode[],
  row: number,
): DisplayRowItem[] => {
  if (nodes.length <= MAX_VISIBLE_NODES_PER_ROW) {
    return nodes.map((node) => ({ type: "resource" as const, node }));
  }
  return [
    ...nodes
      .slice(0, MAX_VISIBLE_NODES_PER_ROW - 1)
      .map((node) => ({ type: "resource" as const, node })),
    {
      type: "overflow" as const,
      row,
      count: nodes.length - (MAX_VISIBLE_NODES_PER_ROW - 1),
    },
  ];
};

const centerRoot = (
  items: DisplayRowItem[],
  rootResourceId: string,
) => {
  const rootIndex = items.findIndex(
    (item) =>
      item.type === "resource" && item.node.resource.id === rootResourceId,
  );
  if (rootIndex < 0 || items.length < 2) return items;
  const root = items[rootIndex];
  const others = items.filter((_, index) => index !== rootIndex);
  const middle = Math.floor(others.length / 2);
  return [...others.slice(0, middle), root, ...others.slice(middle)];
};

const columnPositions = (count: number, canvasWidth: number) => {
  const contentWidth = count * NODE_WIDTH + Math.max(0, count - 1) * COLUMN_GAP;
  const start = (canvasWidth - contentWidth) / 2;
  return Array.from(
    { length: count },
    (_, index) => start + index * (NODE_WIDTH + COLUMN_GAP),
  );
};

async function loadDirectPayload(resourceId: string): Promise<PayloadResult> {
  const results = await Promise.allSettled([
    fetchJson<{ relations: ConnectionDiagramRelation[] }>(
      `/api/v1/resources/${resourceId}/relations`,
      { cache: "no-store" },
    ),
    fetchJson<ConnectionDiagramFamily>(
      `/api/v1/resources/${resourceId}/family`,
      { cache: "no-store" },
    ),
    fetchJson<{
      components: ConnectionDiagramBomComponent[];
      buildableQuantity: number;
    }>(
      `/api/v1/resources/${resourceId}/bom`,
      { cache: "no-store" },
    ),
    fetchJson<{ parents: ConnectionDiagramBomParent[] }>(
      `/api/v1/resources/${resourceId}/bom-parents`,
      { cache: "no-store" },
    ),
  ] as const);
  if (results.every((result) => result.status === "rejected")) {
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw failure?.reason instanceof Error
      ? failure.reason
      : new Error("Unable to load connections.");
  }
  const [relations, family, bom, bomParents] = results;
  return {
    partial: results.some((result) => result.status === "rejected"),
    payload: {
      relations:
        relations.status === "fulfilled" ? relations.value.relations : [],
      family: family.status === "fulfilled" ? family.value : null,
      bomComponents: bom.status === "fulfilled" ? bom.value.components : [],
      bomParents:
        bomParents.status === "fulfilled" ? bomParents.value.parents : [],
      bomBuildableQuantity:
        bom.status === "fulfilled" ? bom.value.buildableQuantity : null,
    },
  };
}

async function loadResourceCovers(resourceIds: string[]) {
  if (!resourceIds.length) return [];
  const search = new URLSearchParams();
  for (const resourceId of resourceIds) search.append("id", resourceId);
  return fetchJson<{ covers: ConnectionDiagramCover[] }>(
    `/api/v1/resources/covers?${search.toString()}`,
    { cache: "no-store" },
  ).then((result) => result.covers);
}

async function loadResourceStock(resourceIds: string[], signal: AbortSignal) {
  if (!resourceIds.length) return [];
  const search = new URLSearchParams();
  for (const resourceId of resourceIds) search.append("id", resourceId);
  return fetchJson<{ stock: ConnectionStockSummary[] }>(
    `/api/v1/resources/stock-summaries?${search.toString()}`,
    { cache: "no-store", signal },
  ).then((result) => result.stock);
}

async function loadResourceCosts(resourceIds: string[], signal: AbortSignal) {
  if (!resourceIds.length) return [];
  const search = new URLSearchParams();
  for (const resourceId of resourceIds) search.append("id", resourceId);
  return fetchJson<{ costs: ConnectionUnitCost[] }>(
    `/api/v1/resources/cost-summaries?${search.toString()}`,
    { cache: "no-store", signal },
  ).then((result) => result.costs);
}

export function ResourceConnectionDiagram({
  resource,
  canEdit,
  canCreate,
  canViewStock,
}: {
  resource: ConnectionDiagramResource;
  canEdit: boolean;
  canCreate: boolean;
  canViewStock: boolean;
}) {
  const { t, i18n } = useT("resource");
  const { t: inventoryT } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const payloadsRef = useRef(new Map<string, ConnectionDiagramPayload>());
  const failedResourcesRef = useRef(new Set<string>());
  const partialRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const [payloadSnapshot, setPayloadSnapshot] = useState<
    ReadonlyMap<string, ConnectionDiagramPayload>
  >(new Map());
  const [coverSnapshot, setCoverSnapshot] = useState<
    ReadonlyMap<string, ConnectionDiagramCover>
  >(new Map());
  const [stockSnapshot, setStockSnapshot] = useState<
    ReadonlyMap<string, ConnectionStockSummary>
  >(new Map());
  const [costSnapshot, setCostSnapshot] = useState<
    ReadonlyMap<string, ConnectionUnitCost>
  >(new Map());
  const [depth, setDepth] = useState(3);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<"graph" | "list" | "family">("graph");
  const [editorSelection, setEditorSelection] =
    useState<ConnectionEditorSelection | null>(null);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [listRemoveError, setListRemoveError] = useState<string | null>(null);
  const [showStock, setShowStock] = useState(false);
  const [showPriceFlow, setShowPriceFlow] = useState(false);
  const [showCostStructure, setShowCostStructure] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);

  const load = useCallback(
    async (requestedDepth: number, refresh = false) => {
      const requestSequence = ++requestSequenceRef.current;
      if (refresh) {
        payloadsRef.current = new Map();
        failedResourcesRef.current = new Set();
        partialRef.current = false;
      }
      setLoading(true);
      setError(null);
      try {
        if (!payloadsRef.current.has(resource.id)) {
          const rootResult = await loadDirectPayload(resource.id);
          payloadsRef.current.set(resource.id, rootResult.payload);
          partialRef.current ||= rootResult.partial;
        }

        while (requestSequence === requestSequenceRef.current) {
          const graph = buildResourceConnectionGraph({
            root: resource,
            depth: requestedDepth,
            payloads: payloadsRef.current,
            maxNodes: MAX_GRAPH_NODES,
          });
          partialRef.current ||= graph.truncated;
          const missing = graph.nodes
            .filter(
              (node) =>
                node.depth < requestedDepth &&
                !payloadsRef.current.has(node.resource.id) &&
                !failedResourcesRef.current.has(node.resource.id),
            )
            .slice(0, FETCH_BATCH_SIZE);
          if (!missing.length) break;
          await Promise.all(
            missing.map(async (node) => {
              try {
                const result = await loadDirectPayload(node.resource.id);
                payloadsRef.current.set(node.resource.id, result.payload);
                partialRef.current ||= result.partial;
              } catch {
                failedResourcesRef.current.add(node.resource.id);
                partialRef.current = true;
              }
            }),
          );
        }
        if (requestSequence !== requestSequenceRef.current) return;
        const visibleGraph = buildResourceConnectionGraph({
          root: resource,
          depth: requestedDepth,
          payloads: payloadsRef.current,
          maxNodes: MAX_GRAPH_NODES,
        });
        try {
          const covers = await loadResourceCovers(
            visibleGraph.nodes.map((node) => node.resource.id),
          );
          if (requestSequence !== requestSequenceRef.current) return;
          setCoverSnapshot(
            new Map(covers.map((cover) => [cover.resourceId, cover])),
          );
        } catch {
          // Covers are visual enhancements; connection data remains usable if
          // their lightweight lookup is temporarily unavailable.
        }
        setPartial(partialRef.current);
        setPayloadSnapshot(new Map(payloadsRef.current));
      } catch (loadError) {
        if (requestSequence !== requestSequenceRef.current) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("connectionDiagram.errors.load"),
        );
      } finally {
        if (requestSequence === requestSequenceRef.current) setLoading(false);
      }
    },
    [resource, t],
  );

  const getPayload = useCallback(async (resourceId: string) => {
    const cached = payloadsRef.current.get(resourceId);
    if (cached) return cached;
    const result = await loadDirectPayload(resourceId);
    payloadsRef.current.set(resourceId, result.payload);
    partialRef.current ||= result.partial;
    setPartial(partialRef.current);
    setPayloadSnapshot(new Map(payloadsRef.current));
    return result.payload;
  }, []);

  useEffect(() => {
    void load(depth);
    // The initial depth is intentionally loaded once. Later depth changes are
    // handled by the selector so switching tabs never resets the graph.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    const refresh = () => void load(depth, true);
    window.addEventListener("resource-family-changed", refresh);
    window.addEventListener("resource-bom-changed", refresh);
    window.addEventListener("resource-relations-changed", refresh);
    return () => {
      window.removeEventListener("resource-family-changed", refresh);
      window.removeEventListener("resource-bom-changed", refresh);
      window.removeEventListener("resource-relations-changed", refresh);
    };
  }, [depth, load]);

  const connectionChanged = useCallback(
    async (kind: ConnectionEditorChangeKind) => {
      setEditorSelection(null);
      setEditorNotice(t(`connectionDiagram.editor.notices.${kind}`));
      await load(depth, true);
    },
    [depth, load, t],
  );

  const model = useMemo(
    () =>
      payloadSnapshot.has(resource.id)
        ? buildResourceConnectionGraph({
            root: resource,
            depth,
            payloads: payloadSnapshot,
            maxNodes: MAX_GRAPH_NODES,
          })
        : null,
    [depth, payloadSnapshot, resource],
  );
  const stockResourceKey = useMemo(
    () =>
      model
        ? model.nodes
            .map((node) => node.resource.id)
            .sort()
            .join("|")
        : "",
    [model],
  );

  useEffect(() => {
    if (
      (!showStock && !showPriceFlow) ||
      !canViewStock ||
      !stockResourceKey
    ) {
      setStockLoading(false);
      setStockError(null);
      return;
    }
    const controller = new AbortController();
    setStockLoading(true);
    setStockError(null);
    void loadResourceStock(stockResourceKey.split("|"), controller.signal)
      .then((stock) => {
        if (!controller.signal.aborted) {
          setStockSnapshot(
            new Map(stock.map((item) => [item.resourceId, item])),
          );
        }
      })
      .catch((stockLoadError) => {
        if (controller.signal.aborted) return;
        setStockError(
          stockLoadError instanceof Error
            ? stockLoadError.message
            : t(
                showPriceFlow && !showStock
                  ? "connectionDiagram.priceFlow.errors.load"
                  : "connectionDiagram.stock.errors.load",
              ),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setStockLoading(false);
      });
    return () => controller.abort();
  }, [canViewStock, showPriceFlow, showStock, stockResourceKey, t]);

  useEffect(() => {
    if (!showCostStructure || !stockResourceKey) {
      setCostLoading(false);
      setCostError(null);
      return;
    }
    const controller = new AbortController();
    setCostLoading(true);
    setCostError(null);
    void loadResourceCosts(stockResourceKey.split("|"), controller.signal)
      .then((costs) => {
        if (!controller.signal.aborted) {
          setCostSnapshot(
            new Map(costs.map((item) => [item.resourceId, item])),
          );
        }
      })
      .catch((costLoadError) => {
        if (controller.signal.aborted) return;
        setCostError(
          costLoadError instanceof Error
            ? costLoadError.message
            : t("connectionDiagram.costStructure.errors.load"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCostLoading(false);
      });
    return () => controller.abort();
  }, [showCostStructure, stockResourceKey, t]);

  const costStructure = useMemo(
    () =>
      buildConnectionCostStructure({
        rootResourceId: resource.id,
        payloads: payloadSnapshot,
        unitCosts: costSnapshot,
        maxDepth: depth,
      }),
    [costSnapshot, depth, payloadSnapshot, resource.id],
  );

  const rows = useMemo(() => {
    const result = new Map<number, DisplayRowItem[]>();
    if (!model) return result;
    const ordered = orderConnectionRows(model.nodes, model.edges, resource.id);
    for (const [row, nodes] of ordered) {
      result.set(
        row,
        centerRoot(truncateRow(nodes, row), resource.id),
      );
    }
    return result;
  }, [model, resource.id]);
  const flowRowOf = useMemo(() => {
    const result = new Map<string, number>();
    for (const [row, items] of rows) {
      for (const item of items) {
        if (item.type === "resource") result.set(item.node.resource.id, row);
      }
    }
    return result;
  }, [rows]);
  const graphEdges = useMemo(() => {
    if (!model) return [];
    return model.edges.flatMap((edge) => {
      const connections = edge.connections.filter(
        (connection) =>
          connection.kind !== "family" &&
          flowRowOf.has(connection.fromResourceId) &&
          flowRowOf.has(connection.toResourceId),
      );
      return connections.length
        ? [
            {
              ...edge,
              key: `${edge.key}:flow`,
              visualOnly: false,
              connections,
            },
          ]
        : [];
    });
  }, [flowRowOf, model]);
  const familyGroups = useMemo(() => {
    if (!model) return [];
    return getConnectionFamilyGroups(
      model.nodes.filter((node) => flowRowOf.has(node.resource.id)),
      model.edges,
    );
  }, [flowRowOf, model]);
  const rowNumbers = Array.from(rows.keys());
  const firstRow = Math.min(0, ...rowNumbers);
  const lastRow = Math.max(0, ...rowNumbers);
  const maximumColumns = Math.max(
    1,
    ...Array.from(rows.values()).map((items) => items.length),
  );
  const canvasWidth = Math.max(
    MIN_CANVAS_WIDTH,
    maximumColumns * NODE_WIDTH +
      Math.max(0, maximumColumns - 1) * COLUMN_GAP +
      CANVAS_PADDING * 2,
  );
  const contentHeight =
    NODE_HEIGHT + Math.max(0, lastRow - firstRow) * ROW_STEP;
  const canvasHeight = Math.max(
    MIN_CANVAS_HEIGHT,
    contentHeight + CANVAS_PADDING * 2 + SAME_ROW_EDGE_GUTTER * 2,
  );
  const firstRowY = (canvasHeight - contentHeight) / 2;
  const positions = useMemo(() => {
    const result = new Map<string, NodePosition>();
    for (const [row, items] of rows) {
      const xs = columnPositions(items.length, canvasWidth);
      for (const [index, item] of items.entries()) {
        if (item.type !== "resource") continue;
        result.set(item.node.resource.id, {
          x: xs[index] ?? 0,
          y: firstRowY + (row - firstRow) * ROW_STEP,
        });
      }
    }
    return result;
  }, [canvasWidth, firstRow, firstRowY, rows]);

  useEffect(() => {
    const container = scrollRef.current;
    const rootPosition = positions.get(resource.id);
    if (!model || !container || !rootPosition) return;

    let frame = 0;
    const centerRoot = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        container.scrollLeft = Math.max(
          0,
          rootPosition.x + NODE_WIDTH / 2 - container.clientWidth / 2,
        );
      });
    };
    const observer = new ResizeObserver(centerRoot);
    observer.observe(container);
    centerRoot();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [model, positions, resource.id]);

  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-6 sm:px-6 lg:px-8">
      <Card className="overflow-hidden shadow-[var(--shadow-sm)]">
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:hidden sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-info-soft text-info">
              <Workflow className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                {t("connectionDiagram.title")}
                {model ? (
                  <Badge>
                    {t("connectionDiagram.connections", {
                      count: model.connectionCount,
                      value: number.format(model.connectionCount),
                    })}
                  </Badge>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">
                {t("connectionDiagram.description")}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted transition group-open:rotate-90" />
          </summary>

          <div className="border-t border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-subtle px-5 py-3 sm:px-6">
              <div className="flex flex-wrap gap-2">
                {view === "graph" || view === "list" ? (
                  <>
                    <LegendBadge kind="family" label={t("connectionDiagram.legend.family")} />
                    <LegendBadge kind="bom" label={t("connectionDiagram.legend.bom")} />
                    <LegendBadge kind="containment" label={t("connectionDiagram.legend.containment")} />
                    <LegendBadge kind="relationship" label={t("connectionDiagram.legend.relationship")} />
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(view === "graph" || view === "list") && loading && model ? (
                  <LoaderCircle className="size-3.5 animate-spin text-muted" aria-hidden="true" />
                ) : null}
                <div className="flex min-h-8 max-w-full flex-wrap items-center overflow-hidden rounded-lg border border-border bg-surface text-[13px] font-semibold">
                  <button
                    type="button"
                    onClick={() => { setView("graph"); setEditorSelection(null); }}
                    className={cn(
                      "flex h-8 items-center gap-1.5 px-2.5 transition",
                      view === "graph"
                        ? "bg-surface-hover text-foreground"
                        : "text-muted hover:text-foreground",
                    )}
                    aria-pressed={view === "graph"}
                  >
                    <Network className="size-3" aria-hidden="true" />
                    {t("connectionDiagram.viewToggle.graph")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setView("list"); setEditorSelection(null); }}
                    className={cn(
                      "flex h-8 items-center gap-1.5 px-2.5 transition",
                      view === "list"
                        ? "bg-surface-hover text-foreground"
                        : "text-muted hover:text-foreground",
                    )}
                    aria-pressed={view === "list"}
                  >
                    <LayoutList className="size-3" aria-hidden="true" />
                    {t("connectionDiagram.viewToggle.list")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setView("family"); setEditorSelection(null); }}
                    className={cn(
                      "flex h-8 items-center gap-1.5 px-2.5 transition",
                      view === "family"
                        ? "bg-surface-hover text-foreground"
                        : "text-muted hover:text-foreground",
                    )}
                    aria-pressed={view === "family"}
                  >
                    <GitBranch className="size-3" aria-hidden="true" />
                    {inventoryT("family.title")}
                  </button>
                </div>
                {view === "graph" ? (
                  <>
                    {canViewStock ? (
                      <>
                        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-semibold text-muted-strong">
                          <input
                            type="checkbox"
                            checked={showStock}
                            onChange={(event) => setShowStock(event.target.checked)}
                            className="size-3.5 rounded border-border-strong accent-brand-solid"
                          />
                          <span>{t("connectionDiagram.stock.show")}</span>
                          {showStock && stockLoading ? (
                            <LoaderCircle
                              className="size-3 animate-spin text-muted"
                              aria-label={t("connectionDiagram.stock.loading")}
                            />
                          ) : null}
                        </label>
                        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-semibold text-muted-strong">
                          <input
                            type="checkbox"
                            checked={showPriceFlow}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setShowPriceFlow(checked);
                              if (checked) setShowCostStructure(false);
                            }}
                            className="size-3.5 rounded border-border-strong accent-brand-solid"
                          />
                          <span>{t("connectionDiagram.priceFlow.show")}</span>
                          {showPriceFlow && stockLoading ? (
                            <LoaderCircle
                              className="size-3 animate-spin text-muted"
                              aria-label={t("connectionDiagram.priceFlow.loading")}
                            />
                          ) : null}
                        </label>
                      </>
                    ) : null}
                    <label className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-semibold text-muted-strong">
                      <input
                        type="checkbox"
                        checked={showCostStructure}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setShowCostStructure(checked);
                          if (checked) setShowPriceFlow(false);
                        }}
                        className="size-3.5 rounded border-border-strong accent-brand-solid"
                      />
                      <span>{t("connectionDiagram.costStructure.show")}</span>
                      {showCostStructure && costLoading ? (
                        <LoaderCircle
                          className="size-3 animate-spin text-muted"
                          aria-label={t(
                            "connectionDiagram.costStructure.loading",
                          )}
                        />
                      ) : null}
                    </label>
                    <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-semibold text-muted-strong">
                      <span>{t("connectionDiagram.depth.label")}</span>
                      <select
                        value={depth}
                        onChange={(event) => {
                          const nextDepth = Number(event.target.value);
                          setDepth(nextDepth);
                          if (payloadsRef.current.has(resource.id)) {
                            void load(nextDepth);
                          }
                        }}
                        className="bg-transparent text-xs font-semibold text-foreground outline-none"
                        aria-label={t("connectionDiagram.depth.ariaLabel")}
                      >
                        {DEPTH_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {view === "graph" || view === "list" ? (
                  <>
                    {canEdit ? (
                      <Button
                        variant={editing ? "primary" : "secondary"}
                        size="sm"
                        onClick={() => {
                          setEditing((current) => !current);
                          setEditorSelection(null);
                          setEditorNotice(null);
                        }}
                        aria-pressed={editing}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        {editing
                          ? t("connectionDiagram.editor.finishEditing")
                          : t("connectionDiagram.editor.edit")}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            {view === "family" ? (
              <ResourceFamilyManager
                resourceId={resource.id}
                canCreate={canCreate}
                canEdit={canEdit}
                canViewStock={canViewStock}
                embedded
              />
            ) : (
              <>
            {editing ? (
              <p className="border-b border-info-border bg-info-soft px-5 py-2.5 text-xs text-info sm:px-6">
                {t("connectionDiagram.editor.help")}
              </p>
            ) : null}
            {editorNotice ? (
              <p className="border-b border-success-border bg-success-soft px-5 py-2.5 text-xs text-success sm:px-6">
                {editorNotice}
              </p>
            ) : null}

            {partial && model ? (
              <p className="border-b border-warning-border bg-warning-soft px-5 py-2.5 text-xs text-warning sm:px-6">
                {t("connectionDiagram.partial")}
              </p>
            ) : null}
            {listRemoveError ? (
              <p className="border-b border-danger-border bg-danger-soft px-5 py-2.5 text-xs text-danger sm:px-6">
                {listRemoveError}
              </p>
            ) : null}
            {stockError ? (
              <p className="border-b border-danger-border bg-danger-soft px-5 py-2.5 text-xs text-danger sm:px-6">
                {stockError}
              </p>
            ) : null}
            {costError ? (
              <p className="border-b border-danger-border bg-danger-soft px-5 py-2.5 text-xs text-danger sm:px-6">
                {costError}
              </p>
            ) : null}
            {showCostStructure && costStructure.root ? (
              <CostStructureSummary
                item={costStructure.root}
                locale={locale}
                number={number}
              />
            ) : null}
            {error ? (
              <div className="px-5 py-8 text-center sm:px-6">
                <p className="text-sm text-danger">{error}</p>
                <Button
                  className="mt-3"
                  variant="secondary"
                  size="sm"
                  onClick={() => void load(depth, true)}
                >
                  {t("connectionDiagram.retry")}
                </Button>
              </div>
            ) : loading && !model ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                {t("connectionDiagram.loading")}
              </div>
            ) : model ? (
              view === "list" ? (
                <ConnectionListView
                  resource={resource}
                  payload={payloadSnapshot.get(resource.id) ?? null}
                  canEdit={canEdit}
                  canCreate={canCreate}
                  editing={editing}
                  editorSelection={editorSelection}
                  onAddConnection={() => {
                    setEditing(true);
                    setEditorSelection({ type: "node", resource });
                  }}
                  onRemoveError={setListRemoveError}
                  onChanged={connectionChanged}
                  onCloseEditor={() => setEditorSelection(null)}
                  getPayload={getPayload}
                />
              ) : model.connectionCount || editing ? (
                <div
                  className={cn(
                    editorSelection &&
                      "grid lg:grid-cols-[minmax(0,1fr)_360px]",
                  )}
                >
                  <div
                    ref={scrollRef}
                    className="min-w-0 overflow-x-auto bg-[radial-gradient(circle_at_center,var(--color-surface-muted)_1px,transparent_1px)] [background-size:18px_18px]"
                  >
                    <div
                      className="relative mx-auto"
                      style={{ width: canvasWidth, height: canvasHeight }}
                    >
                      <FamilyRails
                        groups={familyGroups}
                        positions={positions}
                        width={canvasWidth}
                        height={canvasHeight}
                      />
                      <GraphEdges
                        edges={graphEdges}
                        positions={positions}
                        width={canvasWidth}
                        height={canvasHeight}
                        editing={editing}
                        selectedEdgeKey={
                          editorSelection?.type === "edge"
                            ? editorSelection.edge.key
                            : null
                        }
                        onSelect={(edge) => {
                          const firstResource = model.nodes.find(
                            (node) => node.resource.id === edge.firstResourceId,
                          )?.resource;
                          const secondResource = model.nodes.find(
                            (node) => node.resource.id === edge.secondResourceId,
                          )?.resource;
                          if (!firstResource || !secondResource) return;
                          setEditorSelection({
                            type: "edge",
                            edge,
                            firstResource,
                            secondResource,
                          });
                        }}
                      />
                      {Array.from(rows.entries()).flatMap(
                        ([row, items]) => {
                          const xs = columnPositions(items.length, canvasWidth);
                          const y =
                            firstRowY + (row - firstRow) * ROW_STEP;
                          return items.map((item, index) => (
                            <PositionedGraphNode
                              key={
                                item.type === "resource"
                                  ? item.node.resource.id
                                  : `overflow:${row}`
                              }
                              item={item}
                              cover={
                                item.type === "resource"
                                  ? (coverSnapshot.get(
                                      item.node.resource.id,
                                    ) ?? null)
                                  : null
                              }
                              stock={
                                showStock && item.type === "resource"
                                  ? (stockSnapshot.get(
                                      item.node.resource.id,
                                    ) ?? null)
                                  : null
                              }
                              priceFlow={
                                showPriceFlow && item.type === "resource"
                                  ? (stockSnapshot.get(
                                      item.node.resource.id,
                                    )?.priceFlow ?? null)
                                  : null
                              }
                              costStructure={
                                showCostStructure && item.type === "resource"
                                  ? (costStructure.items.get(
                                      item.node.resource.id,
                                    ) ?? null)
                                  : null
                              }
                              buildableQuantity={
                                showStock &&
                                item.type === "resource" &&
                                (payloadSnapshot.get(item.node.resource.id)
                                  ?.bomComponents.length ?? 0) > 0
                                  ? (payloadSnapshot.get(
                                      item.node.resource.id,
                                    )?.bomBuildableQuantity ?? 0)
                                  : null
                              }
                              rootResourceId={resource.id}
                              x={xs[index] ?? 0}
                              y={y}
                              number={number}
                              locale={locale}
                              editing={editing}
                              selectedResourceId={
                                editorSelection?.type === "node"
                                  ? editorSelection.resource.id
                                  : null
                              }
                              onSelect={(selectedResource) =>
                                setEditorSelection({
                                  type: "node",
                                  resource: selectedResource,
                                })
                              }
                            />
                          ));
                        },
                      )}
                    </div>
                  </div>
                  {editorSelection ? (
                    <ResourceConnectionEditorPanel
                      selection={editorSelection}
                      rootResourceId={resource.id}
                      canCreate={canCreate}
                      loadPayload={getPayload}
                      onChanged={connectionChanged}
                      onClose={() => setEditorSelection(null)}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="px-6 py-10 text-center">
                  <CircleDot className="mx-auto size-6 text-muted" aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    {t("connectionDiagram.empty.title")}
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">
                    {t("connectionDiagram.empty.description")}
                  </p>
                </div>
              )
            ) : null}
              </>
            )}
          </div>
        </details>
      </Card>
    </section>
  );
}

function ConnectionListView({
  resource,
  payload,
  canEdit,
  canCreate,
  editing,
  editorSelection,
  onAddConnection,
  onRemoveError,
  onChanged,
  onCloseEditor,
  getPayload,
}: {
  resource: ConnectionDiagramResource;
  payload: ConnectionDiagramPayload | null;
  canEdit: boolean;
  canCreate: boolean;
  editing: boolean;
  editorSelection: ConnectionEditorSelection | null;
  onAddConnection: () => void;
  onRemoveError: (message: string | null) => void;
  onChanged: (kind: ConnectionEditorChangeKind) => Promise<void>;
  onCloseEditor: () => void;
  getPayload: (resourceId: string) => Promise<ConnectionDiagramPayload>;
}) {
  const { t } = useT("resource");
  const [removing, setRemoving] = useState<string | null>(null);

  const relations = payload?.relations ?? [];
  const family = payload?.family ?? null;
  const bomComponents = payload?.bomComponents ?? [];
  const bomParents = payload?.bomParents ?? [];

  const parents = relations.filter(
    (r) =>
      r.relationTypeKey === "contains" && r.targetResourceId === resource.id,
  );
  const children = relations.filter(
    (r) =>
      r.relationTypeKey === "contains" && r.sourceResourceId === resource.id,
  );
  const others = relations.filter(
    (r) =>
      r.relationTypeKey !== "contains" && r.relationTypeKey !== "variant_of",
  );

  const removeRelation = async (relationId: string, authResourceId: string) => {
    setRemoving(relationId);
    onRemoveError(null);
    try {
      await fetchJson(
        `/api/v1/relations/${relationId}?resourceId=${encodeURIComponent(authResourceId)}`,
        { method: "DELETE" },
      );
      await onChanged("relationship");
    } catch (error) {
      onRemoveError(
        error instanceof Error
          ? error.message
          : t("connectionDiagram.list.errors.remove"),
      );
    } finally {
      setRemoving(null);
    }
  };

  const confirmAndRemove = async (
    id: string,
    authResourceId: string,
  ) => {
    if (!window.confirm(t("connectionDiagram.list.confirmRemove"))) return;
    await removeRelation(id, authResourceId);
  };

  return (
    <div
      className={cn(
        editorSelection && "grid lg:grid-cols-[minmax(0,1fr)_360px]",
      )}
    >
      <div className="divide-y divide-border">
        {family &&
        (family.primary.id !== resource.id || family.variants.length > 0) ? (
          <ListSection
            icon={<GitBranch className="size-4" aria-hidden="true" />}
            tone="brand"
            label={t("connectionDiagram.list.family")}
          >
            {family.primary.id !== resource.id ? (
              <ListItem
                href={`/inventory/${family.primary.id}`}
                name={family.primary.name}
                subtitle={t("connectionDiagram.list.primaryBadge")}
                icon={<GitBranch className="size-3.5" />}
                iconTone="text-brand"
              />
            ) : null}
            {family.variants
              .filter((variant) => variant.id !== resource.id)
              .map((variant) => (
                <ListItem
                  key={variant.id}
                  href={`/inventory/${variant.id}`}
                  name={variant.name}
                  subtitle={t("connectionDiagram.kinds.variant")}
                  icon={<GitBranch className="size-3.5" />}
                  iconTone="text-brand"
                />
              ))}
          </ListSection>
        ) : null}

        {bomComponents.length > 0 ? (
          <ListSection
            icon={<Package className="size-4" aria-hidden="true" />}
            tone="warning"
            label={t("connectionDiagram.list.bom")}
          >
            {bomComponents.map((component) => {
              const quantity = displayBomQuantity(component);
              return (
                <ListItem
                  key={component.resourceId}
                  href={`/inventory/${component.resourceId}`}
                  name={component.name}
                  subtitle={t("connectionDiagram.list.quantity", quantity)}
                  icon={<Package className="size-3.5" />}
                  iconTone="text-warning"
                />
              );
            })}
          </ListSection>
        ) : null}

        {bomParents.length > 0 ? (
          <ListSection
            icon={<Package className="size-4" aria-hidden="true" />}
            tone="warning"
            label={t("connectionDiagram.list.usedIn")}
          >
            {bomParents.map((parent) => {
              const quantity = displayBomQuantity(parent);
              return (
                <ListItem
                  key={parent.resourceId}
                  href={`/inventory/${parent.resourceId}`}
                  name={parent.name}
                  subtitle={t(
                    "connectionDiagram.list.usedInQuantity",
                    quantity,
                  )}
                  icon={<Package className="size-3.5" />}
                  iconTone="text-warning"
                />
              );
            })}
          </ListSection>
        ) : null}

        <ListSection
          icon={<MapPin className="size-4" aria-hidden="true" />}
          tone="success"
          label={t("connectionDiagram.list.locatedIn")}
        >
          {parents.length ? (
            parents.map((relation) => (
              <ListItem
                key={relation.id}
                href={`/inventory/${relation.sourceResourceId}`}
                name={relation.source?.name ?? relation.sourceResourceId}
                subtitle={
                  relation.relationType?.label ??
                  t("connectionDiagram.list.locatedIn")
                }
                icon={<MapPin className="size-3.5" />}
                iconTone="text-success"
                badge={
                  relation.origin === "spatial"
                    ? t("connectionDiagram.list.automatic")
                    : undefined
                }
                onRemove={
                  canEdit && editing
                    ? () =>
                        void confirmAndRemove(relation.id, resource.id)
                    : undefined
                }
                removing={removing === relation.id}
                removeLabel={t("connectionDiagram.list.removeLocatedIn")}
              />
            ))
          ) : (
            <p className="py-3 text-xs text-muted">
              {t("connectionDiagram.list.locatedInEmpty")}
            </p>
          )}
        </ListSection>

        <ListSection
          icon={<Boxes className="size-4" aria-hidden="true" />}
          tone="success"
          label={t("connectionDiagram.list.contains")}
        >
          {children.length ? (
            children.map((relation) => (
              <ListItem
                key={relation.id}
                href={`/inventory/${relation.targetResourceId}`}
                name={relation.target?.name ?? relation.targetResourceId}
                subtitle={
                  relation.relationType?.inverseLabel ??
                  t("connectionDiagram.list.contains")
                }
                icon={<Boxes className="size-3.5" />}
                iconTone="text-success"
                badge={
                  relation.origin === "spatial"
                    ? t("connectionDiagram.list.automatic")
                    : undefined
                }
                onRemove={
                  canEdit && editing
                    ? () =>
                        void confirmAndRemove(relation.id, resource.id)
                    : undefined
                }
                removing={removing === relation.id}
                removeLabel={t("connectionDiagram.list.removeContains")}
              />
            ))
          ) : (
            <p className="py-3 text-xs text-muted">
              {t("connectionDiagram.list.containsEmpty")}
            </p>
          )}
        </ListSection>

        {others.length > 0 ? (
          <ListSection
            icon={<Link2 className="size-4" aria-hidden="true" />}
            tone="neutral"
            label={t("connectionDiagram.list.otherRelations", {
              count: others.length,
            })}
          >
            {others.map((relation) => {
              const outgoing = relation.sourceResourceId === resource.id;
              const relatedId = outgoing
                ? relation.targetResourceId
                : relation.sourceResourceId;
              const relatedName = outgoing
                ? (relation.target?.name ?? relatedId)
                : (relation.source?.name ?? relatedId);
              const label = outgoing
                ? (relation.relationType?.label ?? relation.relationTypeKey)
                : (relation.relationType?.inverseLabel ??
                  relation.relationTypeKey);
              return (
                <ListItem
                  key={relation.id}
                  href={`/inventory/${relatedId}`}
                  name={relatedName}
                  subtitle={label}
                  icon={<Link2 className="size-3.5" />}
                  iconTone="text-info"
                  onRemove={
                    canEdit && editing
                      ? () =>
                          void confirmAndRemove(relation.id, resource.id)
                      : undefined
                  }
                  removing={removing === relation.id}
                  removeLabel={t("connectionDiagram.list.removeRelation")}
                />
              );
            })}
          </ListSection>
        ) : null}

        {canEdit ? (
          <div className="px-5 py-4 sm:px-6">
            <Button
              variant="secondary"
              size="sm"
              onClick={onAddConnection}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {t("connectionDiagram.list.addConnection")}
            </Button>
          </div>
        ) : null}
      </div>

      {editorSelection ? (
        <ResourceConnectionEditorPanel
          selection={editorSelection}
          rootResourceId={resource.id}
          canCreate={canCreate}
          loadPayload={getPayload}
          onChanged={onChanged}
          onClose={onCloseEditor}
        />
      ) : null}
    </div>
  );
}

type ListSectionTone = "brand" | "warning" | "success" | "neutral";

const sectionIconColors: Record<ListSectionTone, string> = {
  brand: "bg-brand-soft text-brand",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  neutral: "bg-surface-muted text-muted-strong",
};

function ListSection({
  icon,
  tone,
  label,
  children,
}: {
  icon: React.ReactNode;
  tone: ListSectionTone;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-strong">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-md",
            sectionIconColors[tone],
          )}
        >
          {icon}
        </span>
        {label}
      </h3>
      <div className="mt-3 space-y-1.5">{children}</div>
    </div>
  );
}

function ListItem({
  href,
  name,
  subtitle,
  icon,
  iconTone,
  badge,
  onRemove,
  removing,
  removeLabel,
}: {
  href: string;
  name: string;
  subtitle: string;
  icon: React.ReactNode;
  iconTone: string;
  badge?: string;
  onRemove?: () => void;
  removing?: boolean;
  removeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
      <span className={cn("shrink-0", iconTone)}>{icon}</span>
      <Link
        href={href}
        className="min-w-0 flex-1 hover:underline"
      >
        <span className="block truncate text-xs font-semibold text-foreground">
          {name}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted">
          {subtitle}
        </span>
      </Link>
      {badge ? (
        <Badge tone="brand" className="min-h-5 px-1.5 text-[11px]">
          {badge}
        </Badge>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          disabled={removing}
          onClick={onRemove}
          aria-label={removeLabel}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-40"
        >
          {removing ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-3.5" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}

function LegendBadge({
  kind,
  label,
}: {
  kind: ConnectionDiagramKind;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted-strong">
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: kindColor[kind] }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function FamilyRails({
  groups,
  positions,
  width,
  height,
}: {
  groups: string[][];
  positions: ReadonlyMap<string, NodePosition>;
  width: number;
  height: number;
}) {
  const segments = groups.flatMap((group) => {
    const members = group
      .map((resourceId) => positions.get(resourceId))
      .filter((position): position is NodePosition => Boolean(position))
      .sort((left, right) => left.x - right.x);
    return members.slice(1).flatMap((right, index) => {
      const left = members[index];
      if (!left || left.y !== right.y) return [];
      return [
        {
          key: `${left.x}:${right.x}:${left.y}`,
          x1: left.x + NODE_WIDTH,
          x2: right.x,
          y: left.y + NODE_MEDIA_CENTER_Y,
        },
      ];
    });
  });
  if (!segments.length) return null;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {segments.map((segment) => (
        <path
          key={segment.key}
          d={`M ${segment.x1} ${segment.y} L ${segment.x2} ${segment.y}`}
          fill="none"
          stroke={kindColor.family}
          strokeWidth="1.5"
          strokeDasharray="4 5"
          opacity="0.7"
        />
      ))}
    </svg>
  );
}

function GraphEdges({
  edges,
  positions,
  width,
  height,
  editing,
  selectedEdgeKey,
  onSelect,
}: {
  edges: ConnectionDiagramGraphEdge[];
  positions: ReadonlyMap<string, NodePosition>;
  width: number;
  height: number;
  editing: boolean;
  selectedEdgeKey: string | null;
  onSelect: (edge: ConnectionDiagramGraphEdge) => void;
}) {
  const anchors = buildEdgeAnchorMap(edges, positions);
  return (
    <svg
      aria-hidden={editing ? undefined : "true"}
      className={cn("absolute inset-0", !editing && "pointer-events-none")}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        {Object.entries(kindColor).map(([kind, color]) => (
          <marker
            key={kind}
            id={`connection-arrow-${kind}`}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
            overflow="visible"
          >
            <path d="M 1 1 L 7 4 L 1 7 Z" fill={color} />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => (
        <GraphEdge
          key={edge.key}
          edge={edge}
          positions={positions}
          anchors={anchors.get(edge.key)}
          editing={editing && !edge.visualOnly}
          selected={selectedEdgeKey === edge.key}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}

function GraphEdge({
  edge,
  positions,
  anchors,
  editing,
  selected,
  onSelect,
}: {
  edge: ConnectionDiagramGraphEdge;
  positions: ReadonlyMap<string, NodePosition>;
  anchors: EdgeAnchors | undefined;
  editing: boolean;
  selected: boolean;
  onSelect: (edge: ConnectionDiagramGraphEdge) => void;
}) {
  const endpoints = visualEdgeEndpoints(edge);
  if (!endpoints) return null;
  const { primary, directed, fromId, toId } = endpoints;
  const visualOnly = Boolean(edge.visualOnly);
  const from = positions.get(fromId);
  const to = positions.get(toId);
  if (!from || !to) return null;
  const fromCenterX = anchors?.fromX ?? from.x + NODE_WIDTH / 2;
  const toCenterX = anchors?.toX ?? to.x + NODE_WIDTH / 2;
  let curve: {
    start: NodePosition;
    controlStart: NodePosition;
    controlEnd: NodePosition;
    end: NodePosition;
  };
  if (from.y === to.y) {
    const edgeY = visualOnly ? from.y + NODE_HEIGHT : from.y;
    const span = Math.abs(fromCenterX - toCenterX);
    const curveHeight = Math.min(64, 32 + span * 0.035);
    const controlY = visualOnly ? edgeY + curveHeight : edgeY - curveHeight;
    curve = {
      start: { x: fromCenterX, y: edgeY },
      controlStart: { x: fromCenterX, y: controlY },
      controlEnd: { x: toCenterX, y: controlY },
      end: { x: toCenterX, y: edgeY },
    };
  } else {
    const downward = from.y < to.y;
    const startY = downward ? from.y + NODE_HEIGHT : from.y;
    const arrowGap = directed ? 4 : 0;
    const endY = downward
      ? to.y - arrowGap
      : to.y + NODE_HEIGHT + arrowGap;
    const middleY = (startY + endY) / 2;
    curve = {
      start: { x: fromCenterX, y: startY },
      controlStart: { x: fromCenterX, y: middleY },
      controlEnd: { x: toCenterX, y: middleY },
      end: { x: toCenterX, y: endY },
    };
  }
  const path =
    primary.kind === "relationship" && !visualOnly
      ? buildWavyConnectionPath(curve)
      : `M ${curve.start.x} ${curve.start.y} C ${curve.controlStart.x} ${curve.controlStart.y}, ${curve.controlEnd.x} ${curve.controlEnd.y}, ${curve.end.x} ${curve.end.y}`;
  return (
    <g
      role={editing ? "button" : undefined}
      tabIndex={editing ? 0 : undefined}
      className={editing ? "cursor-pointer outline-none" : undefined}
      onClick={editing ? () => onSelect(edge) : undefined}
      onKeyDown={
        editing
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(edge);
              }
            }
          : undefined
      }
    >
      <path
        d={path}
        fill="none"
        stroke={kindColor[primary.kind]}
        strokeWidth={selected ? "3.5" : visualOnly ? "1.25" : "1.75"}
        strokeDasharray={visualOnly ? "3 5" : directed ? undefined : "5 5"}
        markerEnd={
          directed ? `url(#connection-arrow-${primary.kind})` : undefined
        }
        opacity={selected ? "1" : visualOnly ? "0.55" : "0.78"}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
      />
      {editing ? (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth="18"
          pointerEvents="stroke"
        />
      ) : null}
    </g>
  );
}

function PositionedGraphNode({
  item,
  cover,
  stock,
  priceFlow,
  costStructure,
  buildableQuantity,
  rootResourceId,
  x,
  y,
  number,
  locale,
  editing,
  selectedResourceId,
  onSelect,
}: {
  item: DisplayRowItem;
  cover: ConnectionDiagramCover | null;
  stock: ConnectionStockSummary | null;
  priceFlow: ConnectionPriceFlow | null;
  costStructure: ConnectionCostStructureItem | null;
  buildableQuantity: number | null;
  rootResourceId: string;
  x: number;
  y: number;
  number: Intl.NumberFormat;
  locale: string;
  editing: boolean;
  selectedResourceId: string | null;
  onSelect: (resource: ConnectionDiagramResource) => void;
}) {
  const { t } = useT("resource");
  if (item.type === "overflow") {
    return (
      <div
        className="absolute flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface/90 px-3 text-center text-muted"
        style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted">
          <Boxes className="size-4" aria-hidden="true" />
        </span>
        <span className="text-xs font-semibold">
          {t("connectionDiagram.more", {
            count: item.count,
            value: number.format(item.count),
          })}
        </span>
      </div>
    );
  }

  const isRoot = item.node.resource.id === rootResourceId;
  const connection = primaryConnection(item.node.connections);
  const kind = connection?.kind ?? "relationship";
  const descriptions = item.node.connections.map((candidate) =>
    connectionDescription(candidate, t, number),
  );
  const subtitle = isRoot
    ? t("connectionDiagram.current")
    : Array.from(new Set(descriptions)).join(" · ") ||
      humanize(item.node.resource.type ?? "inventory");
  const showsFinancialDetails = Boolean(priceFlow || costStructure);
  const content = (
    <>
      <span
        className={cn(
          "relative shrink-0 rounded-xl",
          stock && stockTone[stock.status].media,
        )}
      >
        <span
          className={cn(
            "grid place-items-center overflow-hidden rounded-xl bg-surface-muted",
            showsFinancialDetails ? "size-16" : "size-20",
          )}
          style={
            cover
              ? undefined
              : {
                  backgroundColor: `color-mix(in srgb, ${
                    isRoot ? "var(--color-info)" : kindColor[kind]
                  } 13%, transparent)`,
                  color: isRoot ? "var(--color-info)" : kindColor[kind],
                }
          }
        >
          {cover ? (
            <ResponsiveMediaImage
              media={cover}
              alt=""
              widths={[96, 192]}
              sizes="64px"
              className="h-full w-full object-cover"
            />
          ) : isRoot ? (
            <CircleDot className="size-8" aria-hidden="true" />
          ) : (
            <ConnectionIcon kind={kind} />
          )}
        </span>
        {stock ? (
          <StockIndicator
            stock={stock}
            buildableQuantity={buildableQuantity}
            number={number}
          />
        ) : null}
      </span>
      <span className="min-w-0 w-full">
        <span className="block truncate text-xs font-semibold text-foreground">
          {item.node.resource.name}
        </span>
        <span
          className={`mt-1 block truncate text-[12px] ${
            isRoot
              ? "font-semibold uppercase tracking-wider text-info"
              : "text-muted"
          }`}
        >
          {subtitle}
        </span>
      </span>
      {priceFlow ? (
        <PriceFlowIndicator
          flow={priceFlow}
          number={number}
          locale={locale}
        />
      ) : null}
      {costStructure ? (
        <CostStructureIndicator
          item={costStructure}
          isRoot={isRoot}
          number={number}
          locale={locale}
        />
      ) : null}
    </>
  );
  const selected = item.node.resource.id === selectedResourceId;
  const className = `absolute z-10 rounded-xl bg-surface transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
    isRoot
      ? "border-2 border-info shadow-[var(--shadow-md)]"
      : "border border-border shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
  } ${selected ? "ring-4 ring-focus/15" : ""}`;
  const contentClassName =
    `flex h-full w-full flex-col items-center justify-center rounded-[inherit] px-3 py-2 text-center ${
      showsFinancialDetails ? "gap-1.5" : "gap-2"
    }`;
  const style = { left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT };
  if (editing) {
    return (
      <div className={className} style={style}>
        <button
          type="button"
          className={contentClassName}
          onClick={() => onSelect(item.node.resource)}
          aria-label={t("connectionDiagram.editor.editItem", {
            name: item.node.resource.name,
          })}
        >
          {content}
        </button>
        <button
          type="button"
          onClick={() => onSelect(item.node.resource)}
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg bg-brand-soft text-brand transition hover:bg-brand-solid hover:text-on-brand"
          aria-label={t("connectionDiagram.editor.addTo", {
            name: item.node.resource.name,
          })}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }
  return isRoot ? (
    <div className={className} style={style}>
      <div className={contentClassName}>{content}</div>
    </div>
  ) : (
    <Link
      href={`/inventory/${item.node.resource.id}`}
      aria-label={t("connectionDiagram.openItem", {
        name: item.node.resource.name,
      })}
      className={className}
      style={style}
    >
      <span className={contentClassName}>{content}</span>
    </Link>
  );
}

function CostStructureSummary({
  item,
  locale,
  number,
}: {
  item: ConnectionCostStructureItem;
  locale: string;
  number: Intl.NumberFormat;
}) {
  const { t } = useT("resource");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: item.currency,
  });
  const incomplete =
    item.missingDirectComponentPriceCount > 0 ||
    item.incompatibleCurrencyCount > 0;
  const componentCost = money.format(item.directComponentCostCents / 100);
  const notices = [
    item.unitPriceCents === null
      ? t("connectionDiagram.costStructure.summary.missingItemPrice")
      : null,
    item.missingDirectComponentPriceCount > 0
      ? t("connectionDiagram.costStructure.summary.missingComponentPrices", {
          count: item.missingDirectComponentPriceCount,
          value: number.format(item.missingDirectComponentPriceCount),
        })
      : null,
    item.incompatibleCurrencyCount > 0
      ? t("connectionDiagram.costStructure.summary.incompatibleCurrencies", {
          count: item.incompatibleCurrencyCount,
          value: number.format(item.incompatibleCurrencyCount),
        })
      : null,
  ].filter((notice): notice is string => Boolean(notice));

  return (
    <div className="border-b border-border bg-warning-soft/40 px-5 py-3 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
          <CircleDollarSign className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <p className="text-xs font-semibold text-foreground">
                {t("connectionDiagram.costStructure.summary.title")}
              </p>
              <p className="mt-0.5 text-[12px] leading-4 text-muted">
                {t("connectionDiagram.costStructure.summary.description")}
              </p>
            </div>
            <span className="text-[12px] font-semibold text-muted">
              {t("connectionDiagram.costStructure.summary.componentCount", {
                count: item.directComponentCount,
                value: number.format(item.directComponentCount),
              })}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-3 overflow-hidden rounded-lg border border-warning-border bg-surface">
            <CostSummaryValue
              label={t(
                "connectionDiagram.costStructure.summary.itemPrice",
              )}
              value={
                item.unitPriceCents === null
                  ? "—"
                  : money.format(item.unitPriceCents / 100)
              }
            />
            <CostSummaryValue
              label={t(
                "connectionDiagram.costStructure.summary.componentCosts",
              )}
              value={`${incomplete ? "≥" : ""}${componentCost}`}
              bordered
            />
            <CostSummaryValue
              label={t("connectionDiagram.costStructure.summary.remaining")}
              value={
                item.remainingPriceCents === null
                  ? "—"
                  : money.format(item.remainingPriceCents / 100)
              }
              tone={
                item.remainingPriceCents === null
                  ? "muted"
                  : item.remainingPriceCents < 0
                    ? "danger"
                    : "success"
              }
              bordered
            />
          </dl>
          {notices.length ? (
            <p className="mt-2 text-[12px] leading-4 text-warning">
              {notices.join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CostSummaryValue({
  label,
  value,
  bordered = false,
  tone = "default",
}: {
  label: string;
  value: string;
  bordered?: boolean;
  tone?: "default" | "muted" | "success" | "danger";
}) {
  return (
    <div className={cn("min-w-0 px-2.5 py-2", bordered && "border-l border-border")}>
      <dt className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-0.5 truncate text-xs font-bold tabular-nums",
          tone === "default" && "text-foreground",
          tone === "muted" && "text-muted",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function CostStructureIndicator({
  item,
  isRoot,
  number,
  locale,
}: {
  item: ConnectionCostStructureItem;
  isRoot: boolean;
  number: Intl.NumberFormat;
  locale: string;
}) {
  const { t } = useT("resource");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: item.currency,
  });
  const unitPrice =
    item.unitPriceCents === null
      ? null
      : money.format(item.unitPriceCents / 100);
  const isRequiredComponent = !isRoot && item.requiredQuantity !== null;
  const primaryLabel = unitPrice
    ? isRequiredComponent
      ? t("connectionDiagram.costStructure.calculation", {
          quantity: number.format(item.requiredQuantity ?? 0),
          unitPrice,
        })
      : t("connectionDiagram.costStructure.unitPrice", { price: unitPrice })
    : t("connectionDiagram.costStructure.noUnitPrice");
  const totalLabel =
    isRequiredComponent && item.totalPriceCents !== null
      ? t("connectionDiagram.costStructure.total", {
          total: money.format(item.totalPriceCents / 100),
        })
      : null;

  return (
    <span
      className={cn(
        "grid w-full overflow-hidden rounded-md border bg-surface-subtle px-1.5 py-1 tabular-nums",
        unitPrice ? "border-warning-border" : "border-border",
      )}
      title={[primaryLabel, totalLabel].filter(Boolean).join(" · ")}
    >
      <span
        className={cn(
          "block truncate text-[10px] font-semibold leading-3",
          unitPrice ? "text-warning" : "text-muted",
        )}
      >
        {primaryLabel}
      </span>
      {totalLabel ? (
        <span className="block truncate text-[11px] font-bold leading-3 text-foreground">
          {totalLabel}
        </span>
      ) : null}
    </span>
  );
}

function PriceFlowIndicator({
  flow,
  number,
  locale,
}: {
  flow: ConnectionPriceFlow;
  number: Intl.NumberFormat;
  locale: string;
}) {
  const { t } = useT("resource");
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: flow.currency,
  });
  const directions = [
    {
      key: "inbound",
      sign: "+",
      value: flow.inbound,
      quantityClassName: "text-success",
    },
    {
      key: "outbound",
      sign: "−",
      value: flow.outbound,
      quantityClassName: "text-danger",
    },
    ...(flow.neutral.movementCount > 0
      ? [
          {
            key: "neutral",
            sign: "↔",
            value: flow.neutral,
            quantityClassName: "text-info",
          },
        ]
      : []),
  ] as const;
  const incompleteLabel =
    flow.unpricedMovementCount > 0
      ? t("connectionDiagram.priceFlow.unpriced", {
          count: flow.unpricedMovementCount,
          value: number.format(flow.unpricedMovementCount),
        })
      : null;
  const estimatedLabel = flow.estimated
    ? t("connectionDiagram.priceFlow.estimated")
    : null;

  return (
    <span
      className={cn(
        "grid w-full overflow-hidden rounded-md border bg-surface-subtle",
        directions.length === 3 ? "grid-cols-3" : "grid-cols-2",
        incompleteLabel ? "border-warning-border" : "border-border",
      )}
      title={[incompleteLabel, estimatedLabel].filter(Boolean).join(" · ")}
    >
      {directions.map((direction, index) => {
        const hasPrice = direction.value.pricedMovementCount > 0;
        const amount = hasPrice
          ? money.format(direction.value.amountCents / 100)
          : t("connectionDiagram.priceFlow.noPrice");
        const directionLabel = t(
          `connectionDiagram.priceFlow.${direction.key}`,
          {
            quantity: number.format(direction.value.quantity),
            amount,
          },
        );
        return (
          <span
            key={direction.key}
            className={cn(
              "min-w-0 px-1 py-0.5 tabular-nums",
              index < directions.length - 1 && "border-r border-border",
            )}
            title={directionLabel}
          >
            <span
              className={cn(
                "block truncate text-[10px] font-bold leading-3",
                direction.quantityClassName,
              )}
            >
              {direction.sign}
              {number.format(direction.value.quantity)}
            </span>
            <span
              className={cn(
                "block truncate text-[10px] font-semibold leading-3",
                !hasPrice
                  ? "text-muted"
                  : direction.value.amountCents < 0
                    ? "text-success"
                    : direction.value.amountCents > 0
                      ? "text-warning"
                      : "text-muted-strong",
              )}
            >
              {flow.estimated && hasPrice ? "≈" : ""}
              {amount}
              {incompleteLabel && !hasPrice ? "*" : ""}
            </span>
            <span className="sr-only">{directionLabel}</span>
          </span>
        );
      })}
    </span>
  );
}

function StockIndicator({
  stock,
  buildableQuantity,
  number,
}: {
  stock: ConnectionStockSummary;
  buildableQuantity: number | null;
  number: Intl.NumberFormat;
}) {
  const { t } = useT("resource");
  const statusLabel = t(`connectionDiagram.stock.statuses.${stock.status}`);
  const quantity = `${number.format(stock.quantity)} ${stock.unitName}`;
  const onHandLabel = t("connectionDiagram.stock.onHand", { quantity });
  const buildableLabel =
    buildableQuantity === null
      ? null
      : t("connectionDiagram.stock.buildable", {
          count: buildableQuantity,
          value: number.format(buildableQuantity),
        });
  return (
    <span
      className={cn(
        "absolute -left-2 -top-2 inline-flex max-w-[124px] flex-col items-start gap-0.5 rounded-lg px-2 py-1 text-[11px] font-bold leading-3 tabular-nums shadow-sm ring-1 ring-inset",
        stockTone[stock.status].badge,
      )}
      title={[onHandLabel, buildableLabel, statusLabel]
        .filter(Boolean)
        .join(" · ")}
    >
      <span className="flex max-w-full items-center gap-1">
        <span
          className="size-1.5 shrink-0 rounded-full bg-current"
          aria-hidden="true"
        />
        <span className="truncate">{onHandLabel}</span>
      </span>
      {buildableLabel ? (
        <span className="max-w-full truncate pl-2.5">{buildableLabel}</span>
      ) : null}
      <span className="sr-only"> · {statusLabel}</span>
    </span>
  );
}

function ConnectionIcon({ kind }: { kind: ConnectionDiagramKind }) {
  if (kind === "family") return <GitBranch className="size-8" aria-hidden="true" />;
  if (kind === "bom") return <Package className="size-8" aria-hidden="true" />;
  if (kind === "containment") return <MapPin className="size-8" aria-hidden="true" />;
  return <Link2 className="size-8" aria-hidden="true" />;
}

function connectionDescription(
  connection: ConnectionDiagramConnection,
  t: ReturnType<typeof useT>["t"],
  number: Intl.NumberFormat,
) {
  const descriptor = connection.descriptor;
  if (descriptor.type === "relationship") return descriptor.label;
  if (descriptor.type === "component" || descriptor.type === "assembly") {
    return t(`connectionDiagram.kinds.${descriptor.type}`, {
      count: descriptor.quantity,
      value: number.format(descriptor.quantity),
    });
  }
  return t(`connectionDiagram.kinds.${descriptor.type}`);
}
