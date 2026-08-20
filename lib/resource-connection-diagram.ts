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
