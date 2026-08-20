export type ConnectionDiagramResource = {
  id: string;
  name: string;
  type?: string | null;
  status?: string | null;
};

export type ConnectionDiagramRelation = {
  id: string;
  sourceResourceId: string;
  targetResourceId: string;
  relationTypeKey: string;
  origin?: "manual" | "spatial";
  source: ConnectionDiagramResource | null;
  target: ConnectionDiagramResource | null;
  relationType: {
    label: string;
    inverseLabel: string;
  } | null;
};

export type ConnectionDiagramFamily = {
  role: "primary" | "variant" | "standalone";
  currentResourceId: string;
  primary: ConnectionDiagramResource;
  variants: ConnectionDiagramResource[];
  optionGroupCount?: number;
};

export type ConnectionDiagramBomComponent = {
  id?: string;
  slotKey?: string;
  resourceId: string;
  name: string;
  type?: string | null;
  status?: string | null;
  quantityPerAssembly: number;
  position?: number;
  note?: string | null;
  origin?: "local" | "base" | "inherited" | "override" | "variant";
};

export type ConnectionDiagramKind =
  | "family"
  | "bom"
  | "containment"
  | "relationship";

export type ConnectionDiagramDirection =
  | "toward-current"
  | "away-from-current"
  | "undirected";

export type ConnectionDiagramDescriptor =
  | { type: "primary" }
  | { type: "variant" }
  | { type: "sibling" }
  | { type: "component"; quantity: number }
  | { type: "located-in" }
  | { type: "contains" }
  | { type: "relationship"; label: string };

export type ConnectionDiagramConnection = {
  id: string;
  kind: ConnectionDiagramKind;
  direction: ConnectionDiagramDirection;
  descriptor: ConnectionDiagramDescriptor;
};

export type ConnectionDiagramNode = {
  key: string;
  side: "left" | "right";
  resource: ConnectionDiagramResource;
  connections: ConnectionDiagramConnection[];
};

export type ConnectionDiagramModel = {
  left: ConnectionDiagramNode[];
  right: ConnectionDiagramNode[];
  connectionCount: number;
};

export type ConnectionDiagramPayload = {
  relations: ConnectionDiagramRelation[];
  family: ConnectionDiagramFamily | null;
  bomComponents: ConnectionDiagramBomComponent[];
};

export type ConnectionDiagramGraphNode = {
  resource: ConnectionDiagramResource;
  column: number;
  depth: number;
  connections: ConnectionDiagramConnection[];
};

export type ConnectionDiagramGraphEdge = {
  key: string;
  firstResourceId: string;
  secondResourceId: string;
  visualOnly?: boolean;
  connections: Array<
    ConnectionDiagramConnection & {
      canonicalId: string;
      fromResourceId: string;
      toResourceId: string;
      directed: boolean;
    }
  >;
};

export type ConnectionDiagramGraph = {
  nodes: ConnectionDiagramGraphNode[];
  edges: ConnectionDiagramGraphEdge[];
  connectionCount: number;
  truncated: boolean;
};

type Input = {
  currentResourceId: string;
  family?: ConnectionDiagramFamily | null;
  bomComponents?: ConnectionDiagramBomComponent[];
  relations?: ConnectionDiagramRelation[];
};

const kindPriority: Record<ConnectionDiagramKind, number> = {
  family: 0,
  bom: 1,
  containment: 2,
  relationship: 3,
};

export function buildResourceConnectionDiagram(
  input: Input,
): ConnectionDiagramModel {
  const nodes = new Map<string, ConnectionDiagramNode>();
  let connectionCount = 0;

  const add = (
    side: ConnectionDiagramNode["side"],
    resource: ConnectionDiagramResource | null | undefined,
    connection: ConnectionDiagramConnection,
  ) => {
    if (!resource || resource.id === input.currentResourceId) return;
    const key = `${side}:${resource.id}`;
    const current = nodes.get(key);
    if (!current) {
      connectionCount += 1;
      nodes.set(key, {
        key,
        side,
        resource: { ...resource },
        connections: [connection],
      });
      return;
    }
    if (!current.resource.type && resource.type) current.resource.type = resource.type;
    if (!current.resource.status && resource.status) {
      current.resource.status = resource.status;
    }
    if (current.connections.some((item) => item.id === connection.id)) return;
    connectionCount += 1;
    current.connections.push(connection);
  };

  const family = input.family;
  if (
    family?.role === "variant" &&
    family.primary.id !== input.currentResourceId
  ) {
    add("left", family.primary, {
      id: `family:primary:${family.primary.id}`,
      kind: "family",
      direction: "away-from-current",
      descriptor: { type: "primary" },
    });
    for (const sibling of family.variants) {
      if (sibling.id === input.currentResourceId) continue;
      add("right", sibling, {
        id: `family:sibling:${sibling.id}`,
        kind: "family",
        direction: "undirected",
        descriptor: { type: "sibling" },
      });
    }
  } else if (family && family.primary.id === input.currentResourceId) {
    for (const variant of family.variants) {
      add("right", variant, {
        id: `family:variant:${variant.id}`,
        kind: "family",
        // variant_of is stored child -> primary.
        direction: "toward-current",
        descriptor: { type: "variant" },
      });
    }
  }

  for (const component of input.bomComponents ?? []) {
    add(
      "right",
      {
        id: component.resourceId,
        name: component.name,
        type: component.type,
        status: component.status,
      },
      {
        id: `bom:${component.resourceId}`,
        kind: "bom",
        // Component stock flows into the selected finished item.
        direction: "toward-current",
        descriptor: {
          type: "component",
          quantity: component.quantityPerAssembly,
        },
      },
    );
  }

  for (const relation of input.relations ?? []) {
    if (relation.relationTypeKey === "variant_of") continue;
    const outgoing = relation.sourceResourceId === input.currentResourceId;
    const incoming = relation.targetResourceId === input.currentResourceId;
    if (!outgoing && !incoming) continue;

    if (relation.relationTypeKey === "contains") {
      if (outgoing) {
        add("right", relation.target, {
          id: `relation:${relation.id}`,
          kind: "containment",
          direction: "away-from-current",
          descriptor: { type: "contains" },
        });
      } else {
        add("left", relation.source, {
          id: `relation:${relation.id}`,
          kind: "containment",
          direction: "toward-current",
          descriptor: { type: "located-in" },
        });
      }
      continue;
    }

    const relatedResource = outgoing ? relation.target : relation.source;
    const label = outgoing
      ? relation.relationType?.label ?? relation.relationTypeKey
      : relation.relationType?.inverseLabel ?? relation.relationTypeKey;
    add(outgoing ? "right" : "left", relatedResource, {
      id: `relation:${relation.id}`,
      kind: "relationship",
      direction: outgoing ? "away-from-current" : "toward-current",
      descriptor: { type: "relationship", label },
    });
  }

  const sortNodes = (
    left: ConnectionDiagramNode,
    right: ConnectionDiagramNode,
  ) => {
    const leftPriority = Math.min(
      ...left.connections.map((connection) => kindPriority[connection.kind]),
    );
    const rightPriority = Math.min(
      ...right.connections.map((connection) => kindPriority[connection.kind]),
    );
    return (
      leftPriority - rightPriority ||
      left.resource.name.localeCompare(right.resource.name) ||
      left.resource.id.localeCompare(right.resource.id)
    );
  };

  return {
    left: Array.from(nodes.values())
      .filter((node) => node.side === "left")
      .sort(sortNodes),
    right: Array.from(nodes.values())
      .filter((node) => node.side === "right")
      .sort(sortNodes),
    connectionCount,
  };
}

const canonicalConnectionId = (
  currentResourceId: string,
  relatedResourceId: string,
  connection: ConnectionDiagramConnection,
) => {
  if (connection.id.startsWith("relation:")) return connection.id;
  const pair = [currentResourceId, relatedResourceId].sort().join(":");
  if (connection.kind === "family") return `family:${pair}`;
  return `${connection.kind}:${currentResourceId}:${relatedResourceId}:${connection.id}`;
};

/**
 * Expands already-loaded direct payloads into a bounded, cycle-safe graph.
 * Missing payloads simply leave a node as a leaf; the client can use the
 * returned node depths to decide which resources need another fetch round.
 */
export function buildResourceConnectionGraph(input: {
  root: ConnectionDiagramResource;
  depth: number;
  payloads: ReadonlyMap<string, ConnectionDiagramPayload>;
  maxNodes?: number;
}): ConnectionDiagramGraph {
  const maximumDepth = Math.max(1, Math.min(3, Math.trunc(input.depth)));
  const maximumNodes = Math.max(3, input.maxNodes ?? 45);
  const nodes = new Map<string, ConnectionDiagramGraphNode>([
    [
      input.root.id,
      {
        resource: { ...input.root },
        column: 0,
        depth: 0,
        connections: [],
      },
    ],
  ]);
  const edges = new Map<string, ConnectionDiagramGraphEdge>();
  const canonicalConnections = new Set<string>();
  const queue = [input.root.id];
  const expanded = new Set<string>();
  let truncated = false;

  while (queue.length) {
    const currentResourceId = queue.shift()!;
    const currentNode = nodes.get(currentResourceId)!;
    if (expanded.has(currentResourceId) || currentNode.depth >= maximumDepth) {
      continue;
    }
    expanded.add(currentResourceId);
    const payload = input.payloads.get(currentResourceId);
    if (!payload) continue;
    const direct = buildResourceConnectionDiagram({
      currentResourceId,
      ...payload,
    });
    for (const directNode of [...direct.left, ...direct.right]) {
      // Siblings are useful around the selected root, but recursively joining
      // every sibling to every other sibling would turn a family into a clique.
      const connections = directNode.connections.filter(
        (connection) =>
          currentNode.depth === 0 || connection.descriptor.type !== "sibling",
      );
      if (!connections.length) continue;
      const relatedResourceId = directNode.resource.id;
      let relatedNode = nodes.get(relatedResourceId);
      if (!relatedNode) {
        if (nodes.size >= maximumNodes) {
          truncated = true;
          continue;
        }
        relatedNode = {
          resource: { ...directNode.resource },
          column:
            currentNode.column + (directNode.side === "left" ? -1 : 1),
          depth: currentNode.depth + 1,
          connections: [],
        };
        nodes.set(relatedResourceId, relatedNode);
        if (relatedNode.depth < maximumDepth) queue.push(relatedResourceId);
      } else {
        if (!relatedNode.resource.type && directNode.resource.type) {
          relatedNode.resource.type = directNode.resource.type;
        }
        if (!relatedNode.resource.status && directNode.resource.status) {
          relatedNode.resource.status = directNode.resource.status;
        }
      }

      const pair = [currentResourceId, relatedResourceId].sort();
      const edgeKey = pair.join(":");
      const edge = edges.get(edgeKey) ?? {
        key: edgeKey,
        firstResourceId: pair[0],
        secondResourceId: pair[1],
        connections: [],
      };
      for (const connection of connections) {
        const canonicalId = canonicalConnectionId(
          currentResourceId,
          relatedResourceId,
          connection,
        );
        if (canonicalConnections.has(canonicalId)) continue;
        canonicalConnections.add(canonicalId);
        const towardCurrent = connection.direction === "toward-current";
        const directed = connection.direction !== "undirected";
        edge.connections.push({
          ...connection,
          canonicalId,
          fromResourceId: towardCurrent
            ? relatedResourceId
            : currentResourceId,
          toResourceId: towardCurrent
            ? currentResourceId
            : relatedResourceId,
          directed,
        });
        for (const graphNode of [currentNode, relatedNode]) {
          if (
            !graphNode.connections.some(
              (item) =>
                item.id === connection.id && item.kind === connection.kind,
            )
          ) {
            graphNode.connections.push(connection);
          }
        }
      }
      if (edge.connections.length) edges.set(edgeKey, edge);
    }
  }

  // When the selected item is the primary family member, its variants all sit
  // in the same visual column. Join adjacent variants with a subtle dashed
  // rail so the family reads as one group without implying extra persisted
  // relationships or turning a large family into a full clique.
  const rootFamily = input.payloads.get(input.root.id)?.family;
  if (rootFamily?.primary.id === input.root.id) {
    const visibleVariants = rootFamily.variants
      .filter((variant) => nodes.has(variant.id))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      );
    for (let index = 1; index < visibleVariants.length; index += 1) {
      const first = visibleVariants[index - 1];
      const second = visibleVariants[index];
      const pair = [first.id, second.id].sort();
      const key = `family-sibling:${pair.join(":")}`;
      edges.set(key, {
        key,
        firstResourceId: pair[0],
        secondResourceId: pair[1],
        visualOnly: true,
        connections: [
          {
            id: key,
            kind: "family",
            direction: "undirected",
            descriptor: { type: "sibling" },
            canonicalId: key,
            fromResourceId: first.id,
            toResourceId: second.id,
            directed: false,
          },
        ],
      });
    }
  }

  return {
    nodes: Array.from(nodes.values()).sort(
      (left, right) =>
        left.column - right.column ||
        left.depth - right.depth ||
        left.resource.name.localeCompare(right.resource.name) ||
        left.resource.id.localeCompare(right.resource.id),
    ),
    edges: Array.from(edges.values()),
    connectionCount: canonicalConnections.size,
    truncated,
  };
}

const primaryGraphConnection = <T extends ConnectionDiagramConnection>(
  connections: T[],
) =>
  [...connections].sort(
    (left, right) => kindPriority[left.kind] - kindPriority[right.kind],
  )[0];

const compareGraphNodes =
  (rootResourceId: string) =>
  (left: ConnectionDiagramGraphNode, right: ConnectionDiagramGraphNode) =>
    Number(right.resource.id === rootResourceId) -
      Number(left.resource.id === rootResourceId) ||
    kindPriority[
      primaryGraphConnection(left.connections)?.kind ?? "relationship"
    ] -
      kindPriority[
        primaryGraphConnection(right.connections)?.kind ?? "relationship"
      ] ||
    left.resource.name.localeCompare(right.resource.name) ||
    left.resource.id.localeCompare(right.resource.id);

const buildFamilyGroupIndex = (
  nodes: ConnectionDiagramGraphNode[],
  edges: ConnectionDiagramGraphEdge[],
) => {
  const nodeById = new Map(nodes.map((node) => [node.resource.id, node]));
  const parent = new Map(nodes.map((node) => [node.resource.id, node.resource.id]));
  const find = (resourceId: string): string => {
    const current = parent.get(resourceId);
    if (!current || current === resourceId) return resourceId;
    const root = find(current);
    parent.set(resourceId, root);
    return root;
  };
  const union = (firstResourceId: string, secondResourceId: string) => {
    if (!nodeById.has(firstResourceId) || !nodeById.has(secondResourceId)) return;
    const firstRoot = find(firstResourceId);
    const secondRoot = find(secondResourceId);
    if (firstRoot === secondRoot) return;
    const [root, child] = [firstRoot, secondRoot].sort();
    parent.set(child, root);
  };
  const familyDegree = new Map<string, number>();

  for (const edge of edges) {
    for (const connection of edge.connections) {
      if (connection.kind !== "family") continue;
      union(connection.fromResourceId, connection.toResourceId);
      familyDegree.set(
        connection.fromResourceId,
        (familyDegree.get(connection.fromResourceId) ?? 0) + 1,
      );
      familyDegree.set(
        connection.toResourceId,
        (familyDegree.get(connection.toResourceId) ?? 0) + 1,
      );
    }
  }

  const groupIdOf = new Map<string, string>();
  const membersByGroup = new Map<string, ConnectionDiagramGraphNode[]>();
  for (const node of nodes) {
    const groupId = find(node.resource.id);
    groupIdOf.set(node.resource.id, groupId);
    const members = membersByGroup.get(groupId);
    if (members) members.push(node);
    else membersByGroup.set(groupId, [node]);
  }
  return { familyDegree, groupIdOf, membersByGroup, nodeById };
};

export function getConnectionFamilyGroups(
  nodes: ConnectionDiagramGraphNode[],
  edges: ConnectionDiagramGraphEdge[],
): string[][] {
  const { membersByGroup } = buildFamilyGroupIndex(nodes, edges);
  return Array.from(membersByGroup.values())
    .filter((members) => members.length > 1)
    .map((members) =>
      members
        .map((node) => node.resource.id)
        .sort((left, right) => left.localeCompare(right)),
    );
}

/**
 * Builds a strict structural tree: the selected product and its family occupy
 * level zero, each BOM family occupies the next level, and BOMs of those items
 * continue one level lower. Containment and general relationships stay in the
 * list view instead of competing with the assembly hierarchy on this canvas.
 */
export function orderConnectionRows(
  nodes: ConnectionDiagramGraphNode[],
  edges: ConnectionDiagramGraphEdge[],
  rootResourceId: string,
): Map<number, ConnectionDiagramGraphNode[]> {
  const { familyDegree, groupIdOf, membersByGroup, nodeById } =
    buildFamilyGroupIndex(nodes, edges);
  const rootGroupId = groupIdOf.get(rootResourceId);
  const result = new Map<number, ConnectionDiagramGraphNode[]>();
  if (!rootGroupId) return result;

  const childrenByGroup = new Map<string, Set<string>>();
  const parentsByGroup = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const connection of edge.connections) {
      if (connection.kind !== "bom") continue;
      const assemblyGroupId = groupIdOf.get(connection.toResourceId);
      const componentGroupId = groupIdOf.get(connection.fromResourceId);
      if (
        !assemblyGroupId ||
        !componentGroupId ||
        assemblyGroupId === componentGroupId
      ) {
        continue;
      }
      const children = childrenByGroup.get(assemblyGroupId);
      if (children) children.add(componentGroupId);
      else childrenByGroup.set(assemblyGroupId, new Set([componentGroupId]));
      const parents = parentsByGroup.get(componentGroupId);
      if (parents) parents.add(assemblyGroupId);
      else parentsByGroup.set(componentGroupId, new Set([assemblyGroupId]));
    }
  }

  const levelOf = new Map<string, number>([[rootGroupId, 0]]);
  const queue = [rootGroupId];
  while (queue.length) {
    const groupId = queue.shift()!;
    const level = levelOf.get(groupId)!;
    const children = Array.from(childrenByGroup.get(groupId) ?? []).sort();
    for (const childGroupId of children) {
      if (levelOf.has(childGroupId)) continue;
      levelOf.set(childGroupId, level + 1);
      queue.push(childGroupId);
    }
  }

  const groupPosition = new Map<string, number>([[rootGroupId, 0]]);
  const maximumLevel = Math.max(0, ...levelOf.values());
  const groupLabel = (groupId: string) =>
    [...(membersByGroup.get(groupId) ?? [])]
      .sort(
        (left, right) =>
          left.resource.name.localeCompare(right.resource.name) ||
          left.resource.id.localeCompare(right.resource.id),
      )[0]?.resource.name ?? groupId;
  const arrangeMembers = (groupId: string) => {
    const members = [...(membersByGroup.get(groupId) ?? [])].sort(
      (left, right) =>
        left.resource.name.localeCompare(right.resource.name) ||
        left.resource.id.localeCompare(right.resource.id),
    );
    const hub = members.includes(nodeById.get(rootResourceId)!)
      ? nodeById.get(rootResourceId)
      : [...members].sort(
          (left, right) =>
            (familyDegree.get(right.resource.id) ?? 0) -
              (familyDegree.get(left.resource.id) ?? 0) ||
            left.resource.name.localeCompare(right.resource.name) ||
            left.resource.id.localeCompare(right.resource.id),
        )[0];
    if (!hub || members.length < 2) return members;
    const others = members.filter((member) => member !== hub);
    const middle = Math.floor(others.length / 2);
    return [...others.slice(0, middle), hub, ...others.slice(middle)];
  };

  for (let level = 0; level <= maximumLevel; level += 1) {
    const groups = Array.from(levelOf.entries())
      .filter(([, candidateLevel]) => candidateLevel === level)
      .map(([groupId]) => groupId)
      .sort((left, right) => {
        const parentCenter = (groupId: string) => {
          const positions = Array.from(parentsByGroup.get(groupId) ?? [])
            .map((parentId) => groupPosition.get(parentId))
            .filter((position): position is number => position !== undefined);
          return positions.length
            ? positions.reduce((sum, position) => sum + position, 0) /
                positions.length
            : 0;
        };
        return (
          parentCenter(left) - parentCenter(right) ||
          groupLabel(left).localeCompare(groupLabel(right)) ||
          left.localeCompare(right)
        );
      });
    const rowNodes: ConnectionDiagramGraphNode[] = [];
    for (const groupId of groups) {
      const members = arrangeMembers(groupId);
      groupPosition.set(groupId, rowNodes.length + (members.length - 1) / 2);
      rowNodes.push(...members);
    }
    if (rowNodes.length) result.set(level, rowNodes);
  }
  return result;
}

type Point = { x: number; y: number };

const orientation = (a: Point, b: Point, c: Point) =>
  Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

// Two segments cross when each straddles the line through the other. Endpoints
// that merely touch or lie collinear do not count, so edges fanning out of a
// shared node are never treated as crossing.
const segmentsCross = (p1: Point, p2: Point, p3: Point, p4: Point) => {
  const d1 = orientation(p3, p4, p1);
  const d2 = orientation(p3, p4, p2);
  const d3 = orientation(p1, p2, p3);
  const d4 = orientation(p1, p2, p4);
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4;
};

/**
 * Counts how many pairs of edges cross given the current vertical order. Only
 * edges that span two different columns are considered; same-column edges
 * (sibling rails and stacked containment) render as side bulges and never
 * take part in the layered crossing problem. Column index doubles as the
 * horizontal coordinate, which is enough because the rendered curves stay
 * monotonic between their two columns.
 */
function countConnectionCrossings(
  edges: ConnectionDiagramGraphEdge[],
  positionOf: ReadonlyMap<string, Point>,
) {
  const segments = edges.flatMap((edge) => {
    if (edge.visualOnly) return [];
    const first = positionOf.get(edge.firstResourceId);
    const second = positionOf.get(edge.secondResourceId);
    if (!first || !second || first.x === second.x) return [];
    return [{ first, second, a: edge.firstResourceId, b: edge.secondResourceId }];
  });
  let crossings = 0;
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const left = segments[i];
      const right = segments[j];
      if (
        left.a === right.a ||
        left.a === right.b ||
        left.b === right.a ||
        left.b === right.b
      ) {
        continue;
      }
      if (segmentsCross(left.first, left.second, right.first, right.second)) {
        crossings += 1;
      }
    }
  }
  return crossings;
}

/**
 * Orders each column of a laid-out graph vertically to reduce edge crossings.
 * Nodes start in a stable kind/name order, then repeatedly move toward the
 * average vertical position of the nodes they connect to — the barycenter
 * heuristic used by layered graph drawing. Columns are centered on zero so a
 * node's coordinate is comparable across columns of different sizes, which is
 * what lets an edge spanning from a left column to a right column pull its
 * endpoints into alignment. Because plain barycenter iteration can oscillate
 * between two arrangements on symmetric graphs, every intermediate arrangement
 * is scored and the one with the fewest actual crossings is kept. The selected
 * root is scored at the same centered position used by the renderer, while it
 * remains first in the returned array so column truncation can never hide it.
 * Same-column decorative rails are ignored by the barycenter calculation since
 * they cannot cross the between-column connection arrows.
 */
export function orderConnectionColumns(
  nodes: ConnectionDiagramGraphNode[],
  edges: ConnectionDiagramGraphEdge[],
  depth: number,
  rootResourceId: string,
): Map<number, ConnectionDiagramGraphNode[]> {
  const compare = compareGraphNodes(rootResourceId);
  const byColumn = new Map<number, ConnectionDiagramGraphNode[]>();
  for (let column = -depth; column <= depth; column += 1) {
    byColumn.set(
      column,
      nodes.filter((node) => node.column === column).sort(compare),
    );
  }

  const columnOf = new Map(
    nodes.map((node) => [node.resource.id, node.column]),
  );
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const neighbors = adjacency.get(from);
    if (neighbors) neighbors.push(to);
    else adjacency.set(from, [to]);
  };
  for (const edge of edges) {
    if (
      edge.visualOnly ||
      columnOf.get(edge.firstResourceId) ===
        columnOf.get(edge.secondResourceId)
    ) {
      continue;
    }
    link(edge.firstResourceId, edge.secondResourceId);
    link(edge.secondResourceId, edge.firstResourceId);
  }

  const verticalOf = new Map<string, number>();
  const centerColumn = (column: ConnectionDiagramGraphNode[]) => {
    const rootIndex = column.findIndex(
      (node) => node.resource.id === rootResourceId,
    );
    const visualOrder = [...column];
    if (rootIndex >= 0 && visualOrder.length > 1) {
      const [root] = visualOrder.splice(rootIndex, 1);
      visualOrder.splice(Math.floor(visualOrder.length / 2), 0, root);
    }
    visualOrder.forEach((node, index) =>
      verticalOf.set(node.resource.id, index - (column.length - 1) / 2),
    );
  };
  for (const column of byColumn.values()) centerColumn(column);

  const positions = () => {
    const map = new Map<string, Point>();
    for (const [id, y] of verticalOf) {
      const x = columnOf.get(id);
      if (x !== undefined) map.set(id, { x, y });
    }
    return map;
  };
  const snapshot = () =>
    new Map(Array.from(byColumn, ([column, order]) => [column, [...order]]));

  // Reorders one column against the current positions of every column it
  // touches, then re-centers just that column. Moving a single column at a
  // time (rather than all at once) is what lets a sweep settle a crossing:
  // reordering every column together can merely rotate the whole layout and
  // preserve the crossing it was meant to remove.
  const reorderColumn = (columnIndex: number) => {
    const column = byColumn.get(columnIndex);
    if (!column || column.length < 2) return;
    const barycenter = new Map<string, number>();
    for (const node of column) {
      if (node.resource.id === rootResourceId) {
        barycenter.set(node.resource.id, verticalOf.get(node.resource.id) ?? 0);
        continue;
      }
      const neighborVerticals = (adjacency.get(node.resource.id) ?? [])
        .map((id) => verticalOf.get(id))
        .filter((value): value is number => value !== undefined);
      barycenter.set(
        node.resource.id,
        neighborVerticals.length
          ? neighborVerticals.reduce((sum, value) => sum + value, 0) /
              neighborVerticals.length
          : verticalOf.get(node.resource.id) ?? 0,
      );
    }
    const root = column.find(
      (node) => node.resource.id === rootResourceId,
    );
    const sortable = root
      ? column.filter((node) => node.resource.id !== rootResourceId)
      : column;
    sortable.sort(
      (left, right) =>
        (barycenter.get(left.resource.id) ?? 0) -
          (barycenter.get(right.resource.id) ?? 0) || compare(left, right),
    );
    if (root) column.splice(0, column.length, root, ...sortable);
    centerColumn(column);
  };

  const sweepOrder: number[] = [];
  for (let distance = 1; distance <= depth; distance += 1) {
    sweepOrder.push(distance, -distance);
  }

  let best = snapshot();
  let bestCrossings = countConnectionCrossings(edges, positions());
  const keepIfBetter = () => {
    const crossings = countConnectionCrossings(edges, positions());
    if (crossings >= bestCrossings) return;
    bestCrossings = crossings;
    best = snapshot();
  };

  for (let iteration = 0; iteration < 4 && bestCrossings > 0; iteration += 1) {
    for (const columnIndex of sweepOrder) {
      reorderColumn(columnIndex);
      keepIfBetter();
    }
    for (let index = sweepOrder.length - 1; index >= 0; index -= 1) {
      reorderColumn(sweepOrder[index]);
      keepIfBetter();
    }
  }

  return best;
}
