import type { ConnectionDiagramGraphEdge } from "./resource-connection-diagram";

export type ConnectionEdgeBundle = {
  key: string;
  edges: ConnectionDiagramGraphEdge[];
  assemblyIds: string[];
  componentIds: string[];
};

/** A presentation-only grouping. Original edges and quantities remain intact. */
export function bundleConnectionEdges(
  edges: ConnectionDiagramGraphEdge[],
  families: string[][],
): ConnectionEdgeBundle[] {
  const familyOf = new Map<string, string>();
  for (const family of families) {
    const key = JSON.stringify([...family].sort());
    for (const id of family) familyOf.set(id, key);
  }
  const groups = new Map<string, ConnectionEdgeBundle>();
  for (const edge of edges) {
    // Mixed relationships and multiple BOM positions must remain individually
    // selectable. Never combine different quantities or unit configurations.
    if (edge.visualOnly || edge.connections.length !== 1) continue;
    const connection = edge.connections[0];
    if (connection.kind !== "bom" || !connection.directed ||
      connection.descriptor.type !== "component") continue;
    const assemblyId = connection.toResourceId;
    const componentId = connection.fromResourceId;
    const assemblyFamily = familyOf.get(assemblyId);
    const componentFamily = familyOf.get(componentId);
    if (!assemblyFamily && !componentFamily) continue;
    const descriptor = connection.descriptor;
    const key = JSON.stringify([
      assemblyFamily ?? assemblyId, componentFamily ?? componentId,
      descriptor.quantity, descriptor.quantityUnit ?? "base",
      descriptor.unitName ?? null, descriptor.purchaseUnitName ?? null,
      descriptor.purchaseUnitFactor ?? null,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = { key, edges: [], assemblyIds: [], componentIds: [] };
      groups.set(key, group);
    }
    group.edges.push(edge);
    if (!group.assemblyIds.includes(assemblyId)) group.assemblyIds.push(assemblyId);
    if (!group.componentIds.includes(componentId)) group.componentIds.push(componentId);
  }
  return [...groups.values()].filter((group) => group.edges.length > 1);
}

export type ConnectionPoint = { x: number; y: number };

/** Orthogonal elbows with a small corner radius, including same-row routes. */
export function orthogonalConnectionPath(points: ConnectionPoint[], radius = 5) {
  if (!points.length) return "";
  const clean = points.filter((point, index) =>
    !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  let path = `M ${clean[0].x} ${clean[0].y}`;
  for (let index = 1; index < clean.length - 1; index++) {
    const previous = clean[index - 1], point = clean[index], next = clean[index + 1];
    const before = Math.hypot(point.x - previous.x, point.y - previous.y);
    const after = Math.hypot(next.x - point.x, next.y - point.y);
    const corner = Math.min(Math.max(0, radius), before / 2, after / 2);
    const enter = {
      x: point.x + (previous.x - point.x) * corner / before,
      y: point.y + (previous.y - point.y) * corner / before,
    };
    const leave = {
      x: point.x + (next.x - point.x) * corner / after,
      y: point.y + (next.y - point.y) * corner / after,
    };
    path += ` L ${enter.x} ${enter.y} Q ${point.x} ${point.y} ${leave.x} ${leave.y}`;
  }
  const last = clean[clean.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}
