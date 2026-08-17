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
};

export type ConnectionDiagramBomComponent = {
  resourceId: string;
  name: string;
  type?: string | null;
  status?: string | null;
  quantityPerAssembly: number;
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
