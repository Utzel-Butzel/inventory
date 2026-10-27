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
  return [...groups.values()].filter((group) => group.edges.length > 1 &&
    (group.assemblyIds.length === 1 || group.componentIds.length === 1));
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

export type ConnectionLaneRoute = { key: string; sourceXs: number[]; targetXs: number[] };

/** Minimize intersections of horizontal buses with other routes' vertical legs. */
export function assignConnectionLanes(routes: ConnectionLaneRoute[], span = 90) {
  const crosses = (x: number, route: ConnectionLaneRoute) => {
    const xs = [...route.sourceXs, ...route.targetXs];
    return x > Math.min(...xs) && x < Math.max(...xs);
  };
  // If a is above b, b's source legs and a's target legs can cross a bus.
  const beforeCost = routes.map(a => routes.map(b =>
    b.sourceXs.filter(x => crosses(x, a) && !a.sourceXs.includes(x)).length +
    a.targetXs.filter(x => crosses(x, b) && !b.targetXs.includes(x)).length));
  let order = routes.map((_, index) => index);
  const insertionCost = (route: number, others: number[], at: number) =>
    others.reduce((sum, other, index) => sum + (index < at ? beforeCost[other][route] : beforeCost[route][other]), 0);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let route = 0; route < routes.length; route++) {
      const current = order.indexOf(route);
      const others = order.filter(index => index !== route);
      let best = current, cost = insertionCost(route, others, current);
      for (let at = 0; at <= others.length; at++) {
        const candidate = insertionCost(route, others, at);
        if (candidate < cost) { best = at; cost = candidate; }
      }
      if (best !== current) { others.splice(best, 0, route); order = others; changed = true; }
    }
    if (!changed) break;
  }
  const spacing = Math.min(12, span / Math.max(1, routes.length - 1));
  return new Map(order.map((index, rank) => [routes[index].key, (rank - (routes.length - 1) / 2) * spacing]));
}

/** Place parent blocks above their own children, without overlapping cards or splitting families. */
export function alignConnectionNodes(
  rows: ReadonlyMap<number, string[]>, edges: ConnectionDiagramGraphEdge[], families: string[][],
  cardWidth: number, gap: number, canvasWidth: number, padding: number,
) {
  const xs = new Map<string, number>();
  const familyOf = new Map(families.flatMap((family, index) => family.map(id => [id, String(index)] as const)));
  const children = new Map<string, Set<string>>();
  for (const edge of edges) for (const connection of edge.connections) {
    if (connection.kind !== "bom") continue;
    const set = children.get(connection.toResourceId) ?? new Set<string>();
    set.add(connection.fromResourceId); children.set(connection.toResourceId, set);
  }
  for (const [, ids] of [...rows].sort(([a], [b]) => b - a)) {
    const rowWidth = ids.length * (cardWidth + gap) - gap;
    const defaultStart = (canvasWidth - rowWidth) / 2;
    const blocks: { ids: string[]; prefix: number; desired: number; weight: number }[] = [];
    for (const id of ids) {
      const previous = blocks.at(-1);
      if (previous && familyOf.has(id) && familyOf.get(previous.ids[0]) === familyOf.get(id)) previous.ids.push(id);
      else blocks.push({ ids: [id], prefix: 0, desired: 0, weight: 1 });
    }
    let prefix = 0;
    for (const block of blocks) {
      const width = block.ids.length * (cardWidth + gap) - gap;
      const targets = [...new Set(block.ids.flatMap(id => [...(children.get(id) ?? [])]))]
        .filter(id => xs.has(id)).map(id => xs.get(id)! + cardWidth / 2);
      block.prefix = prefix;
      block.desired = targets.length ? targets.reduce((a,b) => a+b,0) / targets.length - width / 2 - prefix : defaultStart;
      block.weight = block.ids.length;
      prefix += width + gap;
    }
    // Isotonic regression: closest feasible block positions with minimum gaps.
    const pools: { blocks: typeof blocks; value: number; weight: number }[] = [];
    for (const block of blocks) {
      pools.push({ blocks: [block], value: block.desired, weight: block.weight });
      while (pools.length > 1 && pools.at(-2)!.value > pools.at(-1)!.value) {
        const right = pools.pop()!, left = pools.pop()!;
        pools.push({ blocks: [...left.blocks, ...right.blocks],
          value: (left.value * left.weight + right.value * right.weight) / (left.weight + right.weight),
          weight: left.weight + right.weight });
      }
    }
    for (const pool of pools) for (const block of pool.blocks) {
      const start = Math.max(padding, Math.min(canvasWidth - padding - rowWidth, pool.value));
      block.ids.forEach((id, index) => xs.set(id, start + block.prefix + index * (cardWidth + gap)));
    }
  }
  return xs;
}

/** A common-parts panel is valid only for the complete family, with identical
 * quantities/units for each shared component. It never invents BOM entries. */
export function groupCommonFamilyComponents(
  edges: ConnectionDiagramGraphEdge[], families: string[][],
  rowOf: ReadonlyMap<string, number>,
): ConnectionEdgeBundle[] {
  const grouped = new Map<string, ConnectionEdgeBundle>();
  for (const bundle of bundleConnectionEdges(edges, families)) {
    if (bundle.componentIds.length !== 1) continue;
    const family = families.find(ids => ids.length === bundle.assemblyIds.length &&
      ids.every(id => bundle.assemblyIds.includes(id)));
    if (!family || family.length < 2) continue;
    const sourceRow = rowOf.get(family[0]);
    const componentId = bundle.componentIds[0];
    if (sourceRow === undefined || !family.every(id => rowOf.get(id) === sourceRow) ||
      rowOf.get(componentId) !== sourceRow + 1) continue;
    // Keep component variant families in their own outline.
    if (families.some(ids => ids.includes(componentId))) continue;
    const key = `common:${JSON.stringify([...family].sort())}`;
    const group = grouped.get(key) ?? { key, assemblyIds: [...family], componentIds: [], edges: [] };
    group.componentIds.push(componentId);
    group.edges.push(...bundle.edges);
    grouped.set(key, group);
  }
  return [...grouped.values()].filter(group => group.componentIds.every(id =>
    [...grouped.values()].filter(other => other.componentIds.includes(id)).length === 1));
}
