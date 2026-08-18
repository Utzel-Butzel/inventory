"use client";

import {
  Boxes,
  ChevronRight,
  CircleDot,
  GitBranch,
  Link2,
  LoaderCircle,
  MapPin,
  Package,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "next-i18next/client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { Badge, Button, Card } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import {
  buildResourceConnectionGraph,
  type ConnectionDiagramBomComponent,
  type ConnectionDiagramConnection,
  type ConnectionDiagramFamily,
  type ConnectionDiagramGraphEdge,
  type ConnectionDiagramGraphNode,
  type ConnectionDiagramKind,
  type ConnectionDiagramPayload,
  type ConnectionDiagramRelation,
  type ConnectionDiagramResource,
} from "@/lib/resource-connection-diagram";

type PayloadResult = {
  payload: ConnectionDiagramPayload;
  partial: boolean;
};

type DisplayColumnItem =
  | { type: "resource"; node: ConnectionDiagramGraphNode }
  | { type: "overflow"; column: number; count: number };

type NodePosition = { x: number; y: number };

const NODE_WIDTH = 232;
const NODE_HEIGHT = 70;
const ROW_GAP = 18;
const COLUMN_STEP = 330;
const CANVAS_PADDING = 24;
const MAX_VISIBLE_NODES_PER_COLUMN = 12;
const MAX_GRAPH_NODES = 45;
const FETCH_BATCH_SIZE = 6;
const DEPTH_OPTIONS = [1, 2, 3] as const;

const kindColor: Record<ConnectionDiagramKind, string> = {
  family: "var(--color-brand)",
  bom: "var(--color-warning)",
  containment: "var(--color-success)",
  relationship: "var(--color-info)",
};

const kindBadgeTone: Record<
  ConnectionDiagramKind,
  "brand" | "warning" | "success" | "neutral"
> = {
  family: "brand",
  bom: "warning",
  containment: "success",
  relationship: "neutral",
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

const displayColumn = (
  nodes: ConnectionDiagramGraphNode[],
  column: number,
  rootResourceId: string,
): DisplayColumnItem[] => {
  const sorted = [...nodes].sort(
    (left, right) =>
      Number(right.resource.id === rootResourceId) -
        Number(left.resource.id === rootResourceId) ||
      kindPriority[
        primaryConnection(left.connections)?.kind ?? "relationship"
      ] -
        kindPriority[
          primaryConnection(right.connections)?.kind ?? "relationship"
        ] ||
      left.resource.name.localeCompare(right.resource.name) ||
      left.resource.id.localeCompare(right.resource.id),
  );
  if (sorted.length <= MAX_VISIBLE_NODES_PER_COLUMN) {
    return sorted.map((node) => ({ type: "resource" as const, node }));
  }
  return [
    ...sorted
      .slice(0, MAX_VISIBLE_NODES_PER_COLUMN - 1)
      .map((node) => ({ type: "resource" as const, node })),
    {
      type: "overflow" as const,
      column,
      count: sorted.length - (MAX_VISIBLE_NODES_PER_COLUMN - 1),
    },
  ];
};

const centerRoot = (
  items: DisplayColumnItem[],
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

const rowPositions = (count: number, canvasHeight: number) => {
  const contentHeight = count * NODE_HEIGHT + Math.max(0, count - 1) * ROW_GAP;
  const start = (canvasHeight - contentHeight) / 2;
  return Array.from(
    { length: count },
    (_, index) => start + index * (NODE_HEIGHT + ROW_GAP),
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
    fetchJson<{ components: ConnectionDiagramBomComponent[] }>(
      `/api/v1/resources/${resourceId}/bom`,
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
  const [relations, family, bom] = results;
  return {
    partial: results.some((result) => result.status === "rejected"),
    payload: {
      relations:
        relations.status === "fulfilled" ? relations.value.relations : [],
      family: family.status === "fulfilled" ? family.value : null,
      bomComponents: bom.status === "fulfilled" ? bom.value.components : [],
    },
  };
}

export function ResourceConnectionDiagram({
  resource,
}: {
  resource: ConnectionDiagramResource;
}) {
  const { t, i18n } = useT("resource");
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
  const [depth, setDepth] = useState(1);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const columns = useMemo(() => {
    const result = new Map<number, DisplayColumnItem[]>();
    for (let column = -depth; column <= depth; column += 1) {
      const nodes = model?.nodes.filter((node) => node.column === column) ?? [];
      result.set(
        column,
        centerRoot(displayColumn(nodes, column, resource.id), resource.id),
      );
    }
    return result;
  }, [depth, model?.nodes, resource.id]);
  const maximumRows = Math.max(
    1,
    ...Array.from(columns.values()).map((items) => items.length),
  );
  const canvasHeight = Math.max(
    280,
    maximumRows * NODE_HEIGHT + Math.max(0, maximumRows - 1) * ROW_GAP + 48,
  );
  const canvasWidth =
    CANVAS_PADDING * 2 + NODE_WIDTH + depth * 2 * COLUMN_STEP;
  const positions = useMemo(() => {
    const result = new Map<string, NodePosition>();
    for (const [column, items] of columns) {
      const ys = rowPositions(items.length, canvasHeight);
      for (const [index, item] of items.entries()) {
        if (item.type !== "resource") continue;
        result.set(item.node.resource.id, {
          x: CANVAS_PADDING + (column + depth) * COLUMN_STEP,
          y: ys[index] ?? 0,
        });
      }
    }
    return result;
  }, [canvasHeight, columns, depth]);

  useEffect(() => {
    const container = scrollRef.current;
    const rootPosition = positions.get(resource.id);
    if (!model || !container || !rootPosition) return;
    container.scrollLeft = Math.max(
      0,
      rootPosition.x + NODE_WIDTH / 2 - container.clientWidth / 2,
    );
  }, [model, positions, resource.id]);

  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-6 sm:px-6 lg:px-8">
      <Card className="overflow-hidden shadow-[var(--shadow-sm)]">
        <details
          className="group"
          onToggle={(event) => {
            if (
              event.currentTarget.open &&
              !payloadsRef.current.has(resource.id) &&
              !loading
            ) {
              void load(depth);
            }
          }}
        >
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
                <LegendBadge kind="family" label={t("connectionDiagram.legend.family")} />
                <LegendBadge kind="bom" label={t("connectionDiagram.legend.bom")} />
                <LegendBadge kind="containment" label={t("connectionDiagram.legend.containment")} />
                <LegendBadge kind="relationship" label={t("connectionDiagram.legend.relationship")} />
              </div>
              <div className="flex items-center gap-2">
                {loading && model ? (
                  <LoaderCircle className="size-3.5 animate-spin text-muted" aria-hidden="true" />
                ) : null}
                <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-semibold text-muted-strong">
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
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => void load(depth, true)}
                >
                  <RefreshCw
                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {t("connectionDiagram.refresh")}
                </Button>
              </div>
            </div>

            {partial && model ? (
              <p className="border-b border-warning-border bg-warning-soft px-5 py-2.5 text-xs text-warning sm:px-6">
                {t("connectionDiagram.partial")}
              </p>
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
              model.connectionCount ? (
                <div
                  ref={scrollRef}
                  className="overflow-x-auto bg-[radial-gradient(circle_at_center,var(--color-surface-muted)_1px,transparent_1px)] [background-size:18px_18px]"
                >
                  <div
                    className="relative"
                    style={{ width: canvasWidth, height: canvasHeight }}
                  >
                    <GraphEdges
                      edges={model.edges}
                      positions={positions}
                      width={canvasWidth}
                      height={canvasHeight}
                    />
                    {Array.from(columns.entries()).flatMap(([column, items]) => {
                      const ys = rowPositions(items.length, canvasHeight);
                      const x = CANVAS_PADDING + (column + depth) * COLUMN_STEP;
                      return items.map((item, index) => (
                        <PositionedGraphNode
                          key={
                            item.type === "resource"
                              ? item.node.resource.id
                              : `overflow:${column}`
                          }
                          item={item}
                          rootResourceId={resource.id}
                          x={x}
                          y={ys[index] ?? 0}
                          number={number}
                        />
                      ));
                    })}
                  </div>
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
          </div>
        </details>
      </Card>
    </section>
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold text-muted-strong">
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: kindColor[kind] }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function GraphEdges({
  edges,
  positions,
  width,
  height,
}: {
  edges: ConnectionDiagramGraphEdge[];
  positions: ReadonlyMap<string, NodePosition>;
  width: number;
  height: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
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
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill={color} />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => (
        <GraphEdge key={edge.key} edge={edge} positions={positions} />
      ))}
    </svg>
  );
}

function GraphEdge({
  edge,
  positions,
}: {
  edge: ConnectionDiagramGraphEdge;
  positions: ReadonlyMap<string, NodePosition>;
}) {
  const primary = primaryConnection(edge.connections);
  if (!primary) return null;
  const directed = edge.connections.every(
    (connection) =>
      connection.directed &&
      connection.fromResourceId === edge.connections[0]?.fromResourceId &&
      connection.toResourceId === edge.connections[0]?.toResourceId,
  );
  const fromId = directed
    ? edge.connections[0].fromResourceId
    : edge.firstResourceId;
  const toId = directed
    ? edge.connections[0].toResourceId
    : edge.secondResourceId;
  const from = positions.get(fromId);
  const to = positions.get(toId);
  if (!from || !to) return null;
  const fromCenterY = from.y + NODE_HEIGHT / 2;
  const toCenterY = to.y + NODE_HEIGHT / 2;
  let path: string;
  if (from.x === to.x) {
    const downward = fromCenterY <= toCenterY;
    const startY = downward ? from.y + NODE_HEIGHT : from.y;
    const endY = downward ? to.y : to.y + NODE_HEIGHT;
    const curveX = from.x + NODE_WIDTH + 44;
    path = `M ${from.x + NODE_WIDTH / 2} ${startY} C ${curveX} ${startY}, ${curveX} ${endY}, ${to.x + NODE_WIDTH / 2} ${endY}`;
  } else {
    const leftToRight = from.x < to.x;
    const startX = leftToRight ? from.x + NODE_WIDTH : from.x;
    const endX = leftToRight ? to.x : to.x + NODE_WIDTH;
    const middleX = (startX + endX) / 2;
    path = `M ${startX} ${fromCenterY} C ${middleX} ${fromCenterY}, ${middleX} ${toCenterY}, ${endX} ${toCenterY}`;
  }
  return (
    <path
      d={path}
      fill="none"
      stroke={kindColor[primary.kind]}
      strokeWidth="1.75"
      strokeDasharray={directed ? undefined : "5 5"}
      markerEnd={
        directed ? `url(#connection-arrow-${primary.kind})` : undefined
      }
      opacity="0.78"
    />
  );
}

function PositionedGraphNode({
  item,
  rootResourceId,
  x,
  y,
  number,
}: {
  item: DisplayColumnItem;
  rootResourceId: string;
  x: number;
  y: number;
  number: Intl.NumberFormat;
}) {
  const { t } = useT("resource");
  if (item.type === "overflow") {
    return (
      <div
        className="absolute flex items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface/90 px-3.5 text-muted"
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
  const content = (
    <>
      <span
        className="grid size-9 shrink-0 place-items-center rounded-xl"
        style={{
          backgroundColor: `color-mix(in srgb, ${
            isRoot ? "var(--color-info)" : kindColor[kind]
          } 13%, transparent)`,
          color: isRoot ? "var(--color-info)" : kindColor[kind],
        }}
      >
        {isRoot ? (
          <CircleDot className="size-4" aria-hidden="true" />
        ) : (
          <ConnectionIcon kind={kind} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
            {item.node.resource.name}
          </span>
          {!isRoot && item.node.connections.length > 1 ? (
            <Badge tone={kindBadgeTone[kind]} className="min-h-5 px-1.5 text-[9px]">
              {item.node.connections.length}
            </Badge>
          ) : null}
        </span>
        <span
          className={`mt-1 block truncate text-[10px] ${
            isRoot
              ? "font-semibold uppercase tracking-wider text-info"
              : "text-muted"
          }`}
        >
          {subtitle}
        </span>
      </span>
    </>
  );
  const className = `absolute z-10 flex items-center gap-3 rounded-xl bg-surface px-3.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
    isRoot
      ? "border-2 border-info shadow-[var(--shadow-md)]"
      : "border border-border shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)]"
  }`;
  const style = { left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT };
  return isRoot ? (
    <div className={className} style={style}>
      {content}
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
      {content}
    </Link>
  );
}

function ConnectionIcon({ kind }: { kind: ConnectionDiagramKind }) {
  if (kind === "family") return <GitBranch className="size-4" aria-hidden="true" />;
  if (kind === "bom") return <Package className="size-4" aria-hidden="true" />;
  if (kind === "containment") return <MapPin className="size-4" aria-hidden="true" />;
  return <Link2 className="size-4" aria-hidden="true" />;
}

function connectionDescription(
  connection: ConnectionDiagramConnection,
  t: ReturnType<typeof useT>["t"],
  number: Intl.NumberFormat,
) {
  const descriptor = connection.descriptor;
  if (descriptor.type === "relationship") return descriptor.label;
  if (descriptor.type === "component") {
    return t("connectionDiagram.kinds.component", {
      count: descriptor.quantity,
      value: number.format(descriptor.quantity),
    });
  }
  return t(`connectionDiagram.kinds.${descriptor.type}`);
}
