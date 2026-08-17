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
  buildResourceConnectionDiagram,
  type ConnectionDiagramBomComponent,
  type ConnectionDiagramConnection,
  type ConnectionDiagramFamily,
  type ConnectionDiagramKind,
  type ConnectionDiagramNode,
  type ConnectionDiagramRelation,
  type ConnectionDiagramResource,
} from "@/lib/resource-connection-diagram";

type DiagramPayload = {
  relations: ConnectionDiagramRelation[];
  family: ConnectionDiagramFamily | null;
  bomComponents: ConnectionDiagramBomComponent[];
};

type SourceName = "relations" | "family" | "bom";

type DisplayNode =
  | { type: "resource"; node: ConnectionDiagramNode }
  | { type: "overflow"; side: "left" | "right"; count: number };

const NODE_WIDTH = 232;
const NODE_HEIGHT = 70;
const ROW_GAP = 18;
const CANVAS_WIDTH = 1040;
const LEFT_X = 24;
const CURRENT_X = 404;
const RIGHT_X = 784;
const MAX_NODES_PER_SIDE = 10;

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

const humanize = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

const displayNodes = (
  nodes: ConnectionDiagramNode[],
  side: "left" | "right",
): DisplayNode[] => {
  if (nodes.length <= MAX_NODES_PER_SIDE) {
    return nodes.map((node) => ({ type: "resource" as const, node }));
  }
  return [
    ...nodes
      .slice(0, MAX_NODES_PER_SIDE - 1)
      .map((node) => ({ type: "resource" as const, node })),
    {
      type: "overflow" as const,
      side,
      count: nodes.length - (MAX_NODES_PER_SIDE - 1),
    },
  ];
};

const rowPositions = (count: number, canvasHeight: number) => {
  const contentHeight = count * NODE_HEIGHT + Math.max(0, count - 1) * ROW_GAP;
  const start = (canvasHeight - contentHeight) / 2;
  return Array.from(
    { length: count },
    (_, index) => start + index * (NODE_HEIGHT + ROW_GAP),
  );
};

const primaryConnection = (node: ConnectionDiagramNode) =>
  [...node.connections].sort(
    (left, right) =>
      ["family", "bom", "containment", "relationship"].indexOf(left.kind) -
      ["family", "bom", "containment", "relationship"].indexOf(right.kind),
  )[0];

const combinedDirection = (node: ConnectionDiagramNode) => {
  const directions = new Set(node.connections.map((item) => item.direction));
  return directions.size === 1
    ? node.connections[0]?.direction ?? "undirected"
    : "undirected";
};

export function ResourceConnectionDiagram({
  resource,
}: {
  resource: ConnectionDiagramResource;
}) {
  const { t, i18n } = useT("resource");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<DiagramPayload | null>(null);
  const [unavailable, setUnavailable] = useState<SourceName[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      fetchJson<{ relations: ConnectionDiagramRelation[] }>(
        `/api/v1/resources/${resource.id}/relations`,
        { cache: "no-store" },
      ),
      fetchJson<ConnectionDiagramFamily>(
        `/api/v1/resources/${resource.id}/family`,
        { cache: "no-store" },
      ),
      fetchJson<{ components: ConnectionDiagramBomComponent[] }>(
        `/api/v1/resources/${resource.id}/bom`,
        { cache: "no-store" },
      ),
    ] as const);

    const failedSources: SourceName[] = [];
    const [relationsResult, familyResult, bomResult] = results;
    if (relationsResult.status === "rejected") failedSources.push("relations");
    if (familyResult.status === "rejected") failedSources.push("family");
    if (bomResult.status === "rejected") failedSources.push("bom");

    if (failedSources.length === results.length) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      setError(
        firstFailure?.reason instanceof Error
          ? firstFailure.reason.message
          : t("connectionDiagram.errors.load"),
      );
      setLoading(false);
      return;
    }

    setUnavailable(failedSources);
    setPayload({
      relations:
        relationsResult.status === "fulfilled"
          ? relationsResult.value.relations
          : [],
      family:
        familyResult.status === "fulfilled" ? familyResult.value : null,
      bomComponents:
        bomResult.status === "fulfilled" ? bomResult.value.components : [],
    });
    setLoading(false);
  }, [resource.id, t]);

  const model = useMemo(
    () =>
      payload
        ? buildResourceConnectionDiagram({
            currentResourceId: resource.id,
            relations: payload.relations,
            family: payload.family,
            bomComponents: payload.bomComponents,
          })
        : null,
    [payload, resource.id],
  );
  const left = useMemo(
    () => displayNodes(model?.left ?? [], "left"),
    [model?.left],
  );
  const right = useMemo(
    () => displayNodes(model?.right ?? [], "right"),
    [model?.right],
  );
  const rowCount = Math.max(left.length, right.length, 1);
  const canvasHeight = Math.max(
    280,
    rowCount * NODE_HEIGHT + Math.max(0, rowCount - 1) * ROW_GAP + 48,
  );
  const currentY = canvasHeight / 2 - NODE_HEIGHT / 2;
  const leftY = rowPositions(left.length, canvasHeight);
  const rightY = rowPositions(right.length, canvasHeight);

  useEffect(() => {
    const container = scrollRef.current;
    if (!model || !container || container.clientWidth >= CANVAS_WIDTH) return;
    container.scrollLeft = Math.max(
      0,
      CURRENT_X + NODE_WIDTH / 2 - container.clientWidth / 2,
    );
  }, [model]);

  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-6 sm:px-6 lg:px-8">
      <Card className="overflow-hidden shadow-[var(--shadow-sm)]">
        <details
          className="group"
          onToggle={(event) => {
            if (event.currentTarget.open && !payload && !loading) void load();
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
                <LegendBadge
                  kind="containment"
                  label={t("connectionDiagram.legend.containment")}
                />
                <LegendBadge
                  kind="relationship"
                  label={t("connectionDiagram.legend.relationship")}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw
                  className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                {t("connectionDiagram.refresh")}
              </Button>
            </div>

            {unavailable.length && payload ? (
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
                  onClick={() => void load()}
                >
                  {t("connectionDiagram.retry")}
                </Button>
              </div>
            ) : loading && !payload ? (
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
                    style={{ width: CANVAS_WIDTH, height: canvasHeight }}
                  >
                    <DiagramEdges
                      left={left}
                      right={right}
                      leftY={leftY}
                      rightY={rightY}
                      currentY={currentY}
                      height={canvasHeight}
                    />
                    {left.map((item, index) => (
                      <PositionedNode
                        key={item.type === "resource" ? item.node.key : "left:overflow"}
                        item={item}
                        x={LEFT_X}
                        y={leftY[index] ?? 0}
                        number={number}
                      />
                    ))}
                    <CurrentNode resource={resource} y={currentY} />
                    {right.map((item, index) => (
                      <PositionedNode
                        key={item.type === "resource" ? item.node.key : "right:overflow"}
                        item={item}
                        x={RIGHT_X}
                        y={rightY[index] ?? 0}
                        number={number}
                      />
                    ))}
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

function DiagramEdges({
  left,
  right,
  leftY,
  rightY,
  currentY,
  height,
}: {
  left: DisplayNode[];
  right: DisplayNode[];
  leftY: number[];
  rightY: number[];
  currentY: number;
  height: number;
}) {
  const { t } = useT("resource");
  const currentCenterY = currentY + NODE_HEIGHT / 2;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      width={CANVAS_WIDTH}
      height={height}
      viewBox={`0 0 ${CANVAS_WIDTH} ${height}`}
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
      {left.map((item, index) => (
        <DiagramEdge
          key={item.type === "resource" ? item.node.key : "left:overflow"}
          item={item}
          nodeX={LEFT_X}
          nodeY={(leftY[index] ?? 0) + NODE_HEIGHT / 2}
          currentY={currentCenterY}
          side="left"
          overflowLabel={t("connectionDiagram.more", {
            count: item.type === "overflow" ? item.count : 0,
          })}
        />
      ))}
      {right.map((item, index) => (
        <DiagramEdge
          key={item.type === "resource" ? item.node.key : "right:overflow"}
          item={item}
          nodeX={RIGHT_X}
          nodeY={(rightY[index] ?? 0) + NODE_HEIGHT / 2}
          currentY={currentCenterY}
          side="right"
          overflowLabel={t("connectionDiagram.more", {
            count: item.type === "overflow" ? item.count : 0,
          })}
        />
      ))}
    </svg>
  );
}

function DiagramEdge({
  item,
  nodeX,
  nodeY,
  currentY,
  side,
  overflowLabel,
}: {
  item: DisplayNode;
  nodeX: number;
  nodeY: number;
  currentY: number;
  side: "left" | "right";
  overflowLabel: string;
}) {
  const connection = item.type === "resource" ? primaryConnection(item.node) : null;
  const kind = connection?.kind ?? "relationship";
  const direction =
    item.type === "resource" ? combinedDirection(item.node) : "undirected";
  const currentEdgeX = side === "left" ? CURRENT_X : CURRENT_X + NODE_WIDTH;
  const nodeEdgeX = side === "left" ? nodeX + NODE_WIDTH : nodeX;
  const startsAtNode = direction === "toward-current";
  const startX = startsAtNode ? nodeEdgeX : currentEdgeX;
  const startY = startsAtNode ? nodeY : currentY;
  const endX = startsAtNode ? currentEdgeX : nodeEdgeX;
  const endY = startsAtNode ? currentY : nodeY;
  const middleX = (currentEdgeX + nodeEdgeX) / 2;
  const path = `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
  const markerEnd =
    direction === "undirected" ? undefined : `url(#connection-arrow-${kind})`;
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={kindColor[kind]}
        strokeWidth="1.75"
        strokeDasharray={direction === "undirected" ? "5 5" : undefined}
        markerEnd={markerEnd}
        opacity="0.78"
      />
      {item.type === "overflow" ? (
        <text
          x={middleX}
          y={(nodeY + currentY) / 2 - 7}
          textAnchor="middle"
          className="fill-muted text-[10px] font-semibold"
          style={{
            paintOrder: "stroke",
            stroke: "var(--color-surface)",
            strokeWidth: 5,
          }}
        >
          {overflowLabel}
        </text>
      ) : null}
    </g>
  );
}

function CurrentNode({
  resource,
  y,
}: {
  resource: ConnectionDiagramResource;
  y: number;
}) {
  const { t } = useT("resource");
  return (
    <div
      className="absolute z-10 flex items-center gap-3 rounded-2xl border-2 border-info bg-surface px-3.5 shadow-[var(--shadow-md)]"
      style={{ left: CURRENT_X, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-info-soft text-info">
        <CircleDot className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">
          {resource.name}
        </span>
        <span className="mt-0.5 block truncate text-[10px] font-semibold uppercase tracking-wider text-info">
          {t("connectionDiagram.current")}
        </span>
      </span>
    </div>
  );
}

function PositionedNode({
  item,
  x,
  y,
  number,
}: {
  item: DisplayNode;
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

  const { node } = item;
  const connection = primaryConnection(node);
  const kind = connection?.kind ?? "relationship";
  const descriptions = node.connections.map((item) =>
    connectionDescription(item, t, number),
  );
  const subtitle = Array.from(new Set(descriptions)).join(" · ");
  return (
    <Link
      href={`/inventory/${node.resource.id}`}
      aria-label={t("connectionDiagram.openItem", { name: node.resource.name })}
      className="absolute z-10 flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 shadow-[var(--shadow-sm)] transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-xl"
        style={{
          backgroundColor: `color-mix(in srgb, ${kindColor[kind]} 13%, transparent)`,
          color: kindColor[kind],
        }}
      >
        <ConnectionIcon kind={kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
            {node.resource.name}
          </span>
          {node.connections.length > 1 ? (
            <Badge tone={kindBadgeTone[kind]} className="min-h-5 px-1.5 text-[9px]">
              {node.connections.length}
            </Badge>
          ) : null}
        </span>
        <span className="mt-1 block truncate text-[10px] text-muted">
          {subtitle || humanize(node.resource.type ?? "inventory")}
        </span>
      </span>
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

