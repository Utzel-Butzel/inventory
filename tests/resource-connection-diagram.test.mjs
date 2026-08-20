import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildResourceConnectionDiagram,
  buildResourceConnectionGraph,
  orderConnectionColumns,
  orderConnectionRows,
} from "../lib/resource-connection-diagram.ts";

const item = (id, name) => ({ id, name, type: "item", status: "available" });

test("builds a directional tree from family, BOM, containment, and relationships", () => {
  const current = item("current", "Current");
  const primary = item("primary", "Primary");
  const sibling = item("sibling", "Sibling");
  const container = item("container", "Storage A");
  const child = item("child", "Contained child");
  const inbound = item("inbound", "Inbound relation");
  const outbound = item("outbound", "Outbound relation");
  const component = item("component", "Component X");

  const model = buildResourceConnectionDiagram({
    currentResourceId: current.id,
    family: {
      role: "variant",
      currentResourceId: current.id,
      primary,
      variants: [current, sibling],
    },
    bomComponents: [
      {
        resourceId: component.id,
        name: component.name,
        type: component.type,
        status: component.status,
        quantityPerAssembly: 5,
      },
    ],
    relations: [
      {
        id: "parent-relation",
        sourceResourceId: container.id,
        targetResourceId: current.id,
        relationTypeKey: "contains",
        source: container,
        target: current,
        relationType: { label: "Contains", inverseLabel: "Located in" },
      },
      {
        id: "child-relation",
        sourceResourceId: current.id,
        targetResourceId: child.id,
        relationTypeKey: "contains",
        source: current,
        target: child,
        relationType: { label: "Contains", inverseLabel: "Located in" },
      },
      {
        id: "incoming-relation",
        sourceResourceId: inbound.id,
        targetResourceId: current.id,
        relationTypeKey: "powers",
        source: inbound,
        target: current,
        relationType: { label: "Powers", inverseLabel: "Powered by" },
      },
      {
        id: "outgoing-relation",
        sourceResourceId: current.id,
        targetResourceId: outbound.id,
        relationTypeKey: "related",
        source: current,
        target: outbound,
        relationType: { label: "Related to", inverseLabel: "Related to" },
      },
      {
        id: "protected-family-edge",
        sourceResourceId: current.id,
        targetResourceId: primary.id,
        relationTypeKey: "variant_of",
        source: current,
        target: primary,
        relationType: { label: "Variant of", inverseLabel: "Variants" },
      },
    ],
  });

  assert.deepEqual(
    model.left.map((node) => node.resource.id),
    [primary.id, container.id, inbound.id],
  );
  assert.deepEqual(
    model.right.map((node) => node.resource.id),
    [sibling.id, component.id, child.id, outbound.id],
  );
  assert.equal(model.connectionCount, 7);
  assert.equal(model.left[0].connections[0].direction, "away-from-current");
  assert.equal(model.left[1].connections[0].direction, "toward-current");
  assert.deepEqual(model.right[1].connections[0].descriptor, {
    type: "component",
    quantity: 5,
  });
  assert.equal(
    model.left[2].connections[0].descriptor.label,
    "Powered by",
  );
});

test("merges repeated resources on the same side while retaining each connection", () => {
  const current = item("current", "Current");
  const component = item("component", "Component X");
  const model = buildResourceConnectionDiagram({
    currentResourceId: current.id,
    bomComponents: [
      {
        resourceId: component.id,
        name: component.name,
        type: component.type,
        status: component.status,
        quantityPerAssembly: 2,
      },
    ],
    relations: [
      {
        id: "related-component",
        sourceResourceId: current.id,
        targetResourceId: component.id,
        relationTypeKey: "related",
        source: current,
        target: component,
        relationType: { label: "Related to", inverseLabel: "Related to" },
      },
    ],
  });

  assert.equal(model.right.length, 1);
  assert.equal(model.right[0].connections.length, 2);
  assert.equal(model.connectionCount, 2);
});

test("adds a visual dashed rail between adjacent primary-item variants", () => {
  const primary = item("primary", "Primary");
  const first = item("first", "Blue variant");
  const second = item("second", "Red variant");
  const graph = buildResourceConnectionGraph({
    root: primary,
    depth: 1,
    payloads: new Map([
      [
        primary.id,
        {
          family: {
            role: "primary",
            currentResourceId: primary.id,
            primary,
            variants: [second, first],
          },
          bomComponents: [],
          relations: [],
        },
      ],
    ]),
  });

  const siblingRail = graph.edges.find((edge) => edge.visualOnly);
  assert.ok(siblingRail);
  assert.equal(siblingRail.connections[0].descriptor.type, "sibling");
  assert.equal(siblingRail.connections[0].directed, false);
  assert.equal(graph.connectionCount, 2);
});

test("lays out family members together with BOM components below the item", () => {
  const root = item("root", "Root assembly");
  const blue = item("blue", "Blue variation");
  const red = item("red", "Red variation");
  const component = item("component", "Component");
  const componentVariation = item("component-variation", "Component variation");
  const subcomponent = item("subcomponent", "Subcomponent");
  const container = item("container", "Container");
  const unrelated = item("unrelated", "Unrelated item");
  const graph = buildResourceConnectionGraph({
    root,
    depth: 2,
    payloads: new Map([
      [
        root.id,
        {
          family: {
            role: "primary",
            currentResourceId: root.id,
            primary: root,
            variants: [blue, red],
          },
          bomComponents: [
            {
              resourceId: component.id,
              name: component.name,
              type: component.type,
              status: component.status,
              quantityPerAssembly: 1,
            },
          ],
          relations: [
            {
              id: "container-root",
              sourceResourceId: container.id,
              targetResourceId: root.id,
              relationTypeKey: "contains",
              source: container,
              target: root,
              relationType: { label: "Contains", inverseLabel: "Located in" },
            },
            {
              id: "root-unrelated",
              sourceResourceId: root.id,
              targetResourceId: unrelated.id,
              relationTypeKey: "related",
              source: root,
              target: unrelated,
              relationType: { label: "Related", inverseLabel: "Related" },
            },
          ],
        },
      ],
      [
        component.id,
        {
          family: {
            role: "primary",
            currentResourceId: component.id,
            primary: component,
            variants: [componentVariation],
          },
          bomComponents: [
            {
              resourceId: subcomponent.id,
              name: subcomponent.name,
              type: subcomponent.type,
              status: subcomponent.status,
              quantityPerAssembly: 2,
            },
          ],
          relations: [],
        },
      ],
    ]),
  });
  const rows = orderConnectionRows(graph.nodes, graph.edges, root.id);
  const rowOf = (resourceId) =>
    Array.from(rows).find(([, nodes]) =>
      nodes.some((node) => node.resource.id === resourceId),
    )?.[0];

  assert.equal(rowOf(root.id), 0);
  assert.equal(rowOf(blue.id), rowOf(root.id));
  assert.equal(rowOf(red.id), rowOf(root.id));
  assert.ok(rowOf(component.id) > rowOf(root.id));
  assert.equal(rowOf(componentVariation.id), rowOf(component.id));
  assert.ok(rowOf(subcomponent.id) > rowOf(component.id));
  assert.equal(rowOf(container.id), undefined);
  assert.equal(rowOf(unrelated.id), undefined);
  assert.deepEqual(Array.from(rows.keys()), [0, 1, 2]);
  const componentRow = rows.get(1).map((node) => node.resource.id);
  assert.equal(
    Math.abs(
      componentRow.indexOf(component.id) -
        componentRow.indexOf(componentVariation.id),
    ),
    1,
  );
});

test("expands loaded payloads across bounded levels without duplicating cycles", () => {
  const root = item("root", "Root");
  const child = item("child", "Child");
  const grandchild = item("grandchild", "Grandchild");
  const relation = (id, source, target) => ({
    id,
    sourceResourceId: source.id,
    targetResourceId: target.id,
    relationTypeKey: "related",
    source,
    target,
    relationType: { label: "Related to", inverseLabel: "Related to" },
  });
  const payloads = new Map([
    [
      root.id,
      {
        family: null,
        bomComponents: [],
        relations: [relation("root-child", root, child)],
      },
    ],
    [
      child.id,
      {
        family: null,
        bomComponents: [],
        relations: [
          relation("root-child", root, child),
          relation("child-grandchild", child, grandchild),
        ],
      },
    ],
    [
      grandchild.id,
      {
        family: null,
        bomComponents: [],
        relations: [relation("child-grandchild", child, grandchild)],
      },
    ],
  ]);

  const oneLevel = buildResourceConnectionGraph({ root, depth: 1, payloads });
  assert.deepEqual(
    oneLevel.nodes.map((node) => node.resource.id),
    [root.id, child.id],
  );
  assert.equal(oneLevel.connectionCount, 1);

  const threeLevels = buildResourceConnectionGraph({
    root,
    depth: 3,
    payloads,
  });
  assert.deepEqual(
    threeLevels.nodes.map((node) => node.resource.id),
    [root.id, child.id, grandchild.id],
  );
  assert.deepEqual(
    threeLevels.nodes.map((node) => node.column),
    [0, 1, 2],
  );
  assert.equal(threeLevels.connectionCount, 2);
  assert.equal(threeLevels.edges.length, 2);
});

test("orders columns so connected nodes align and edges stop crossing", () => {
  const graphNode = (id, name, column, depth) => ({
    resource: { id, name, type: "item", status: "available" },
    column,
    depth,
    connections: [],
  });
  const graphEdge = (first, second, visualOnly = false) => ({
    key: `${first}:${second}`,
    firstResourceId: first,
    secondResourceId: second,
    visualOnly,
    connections: [],
  });

  // Alpha connects to Yankee and Beta connects to Xerox, but the plain
  // name order of the outer column is [Xerox, Yankee], so the two edges cross.
  const nodes = [
    graphNode("root", "Root", 0, 0),
    graphNode("alpha", "Alpha", 1, 1),
    graphNode("beta", "Beta", 1, 1),
    graphNode("xerox", "Xerox", 2, 2),
    graphNode("yankee", "Yankee", 2, 2),
  ];
  const edges = [
    graphEdge("root", "alpha"),
    graphEdge("root", "beta"),
    graphEdge("alpha", "yankee"),
    graphEdge("beta", "xerox"),
  ];

  const ordered = orderConnectionColumns(nodes, edges, 2, "root");
  const rowOf = (column, id) =>
    ordered.get(column).findIndex((node) => node.resource.id === id);

  // Each outer node ends up in the same row as the middle node it connects to,
  // which is exactly the arrangement with no crossing edges.
  assert.equal(rowOf(1, "alpha"), rowOf(2, "yankee"));
  assert.equal(rowOf(1, "beta"), rowOf(2, "xerox"));
  assert.notEqual(rowOf(2, "xerox"), rowOf(2, "yankee"));
});

test("keeps a crossing-free column in its deterministic name order", () => {
  const graphNode = (id, name, column, depth) => ({
    resource: { id, name, type: "item", status: "available" },
    column,
    depth,
    connections: [],
  });
  const graphEdge = (first, second) => ({
    key: `${first}:${second}`,
    firstResourceId: first,
    secondResourceId: second,
    connections: [],
  });

  const ordered = orderConnectionColumns(
    [
      graphNode("root", "Root", 0, 0),
      graphNode("a", "Apple", 1, 1),
      graphNode("c", "Cherry", 1, 1),
      graphNode("b", "Banana", 1, 1),
    ],
    [graphEdge("root", "a"), graphEdge("root", "c"), graphEdge("root", "b")],
    1,
    "root",
  );

  assert.deepEqual(
    ordered.get(1).map((node) => node.resource.id),
    ["a", "b", "c"],
  );
});

test("scores connections using the root's rendered center position", () => {
  const graphNode = (id, column) => ({
    resource: { id, name: id, type: "item", status: "available" },
    column,
    depth: Math.abs(column),
    connections: [],
  });
  const graphEdge = (first, second, visualOnly = false) => ({
    key: `${first}:${second}`,
    firstResourceId: first,
    secondResourceId: second,
    visualOnly,
    connections: [],
  });

  // The graph renderer moves the root between the other nodes in its column.
  // The container and its connected variant therefore both need to be above
  // the root to avoid crossing the root-to-variant arrows. Decorative variant
  // rails must not pull the variants back into a crossing order.
  const ordered = orderConnectionColumns(
    [
      graphNode("root", 0),
      graphNode("container", 0),
      graphNode("unrelated", 0),
      graphNode("german", 1),
      graphNode("english", 1),
      graphNode("french", 1),
    ],
    [
      graphEdge("root", "german"),
      graphEdge("root", "english"),
      graphEdge("root", "french"),
      graphEdge("container", "german"),
      graphEdge("german", "english", true),
      graphEdge("english", "french", true),
    ],
    3,
    "root",
  );

  assert.deepEqual(
    ordered.get(0).map((node) => node.resource.id),
    ["root", "container", "unrelated"],
  );
  assert.equal(ordered.get(1)[0].resource.id, "german");
});

test("the detail-page connection flow opens by default and owns every connection tool", async () => {
  const [page, component] = await Promise.all([
    readFile(
      new URL("../app/(dashboard)/inventory/[id]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/resource-connection-diagram.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /<ResourceConnectionDiagram/);
  assert.doesNotMatch(page, /<ResourceFamilyManager/);
  assert.doesNotMatch(page, /<ResourceOptionGroupsManager/);
  assert.match(component, /<details className="group" open>/);
  assert.match(component, /<ResourceFamilyManager[\s\S]*embedded/);
  assert.doesNotMatch(component, /ResourceOptionGroupsManager/);
  assert.doesNotMatch(component, /inventoryT\("options\.title"\)/);
  assert.match(component, /\/relations`/);
  assert.match(component, /\/family`/);
  assert.match(component, /\/bom`/);
  assert.match(component, /Promise\.allSettled/);
  assert.match(component, /OrganizationLink as Link/);
  assert.match(component, /DEPTH_OPTIONS = \[1, 2, 3\]/);
  assert.match(component, /useState\(3\)/);
  assert.match(component, /connectionDiagram\.depth\.label/);
  assert.match(component, /buildResourceConnectionGraph/);
  assert.match(component, /orderConnectionRows/);
  assert.match(component, /getConnectionFamilyGroups/);
  assert.match(component, /<FamilyRails/);
  assert.match(component, /hierarchyDown/);
  assert.match(component, /buildEdgeAnchorMap/);
  assert.match(component, /distributedAnchorX/);
  assert.match(component, /markerUnits="userSpaceOnUse"/);
  assert.match(component, /M 1 1 L 7 4 L 1 7 Z/);
  assert.match(component, /NODE_WIDTH = 168/);
  assert.match(component, /NODE_HEIGHT = 112/);
  assert.match(component, /ROW_STEP = 182/);
  assert.match(component, /flex h-full w-full flex-col items-center/);
  assert.match(component, /MAX_GRAPH_NODES = 45/);
  assert.match(component, /MIN_CANVAS_HEIGHT = 420/);
  assert.match(component, /Math\.max\(\s*MIN_CANVAS_HEIGHT/);
  assert.match(component, /className="relative mx-auto"/);
  assert.match(component, /new ResizeObserver\(centerRoot\)/);
  assert.match(component, /\/api\/v1\/resources\/covers/);
  assert.match(component, /src=\{cover\.url\}/);
  assert.match(component, /coverSnapshot\.get/);
  assert.doesNotMatch(component, /iconX|iconY/);
});

test("loads visible item covers in one access-controlled request", async () => {
  const [route, resources] = await Promise.all([
    readFile(
      new URL("../app/api/v1/resources/covers/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/resources.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /resourceIdsSchema[\s\S]*\.max\(45\)/);
  assert.match(route, /canAccessResource[\s\S]*"inventory\.read"/);
  assert.match(route, /getResourceCovers/);
  assert.match(resources, /export async function getResourceCovers/);
  assert.match(resources, /eq\(media\.kind, "image"\)/);
});

test("the diagram edits typed connections without bypassing existing APIs", async () => {
  const [page, diagram, editor, assembly, relations] = await Promise.all([
    readFile(
      new URL("../app/(dashboard)/inventory/[id]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/resource-connection-diagram.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../components/resource-connection-editor-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../components/assembly-manager.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/resource-relations-manager.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /canEdit=\{canEdit\}/);
  assert.match(page, /canCreate=\{canCreate\}/);
  assert.match(diagram, /ResourceConnectionEditorPanel/);
  assert.match(diagram, /selectedEdgeKey/);
  assert.match(diagram, /connectionDiagram\.editor\.edit/);
  assert.match(diagram, /pointerEvents="stroke"/);
  assert.match(editor, /method: "PUT"[\s\S]*\/bom`/);
  assert.match(editor, /existingResourceId: candidate\.id/);
  assert.match(editor, /relationTypeKey: relationType/);
  assert.match(editor, /method: "DELETE"/);
  assert.match(editor, /bomWritePayload/);
  assert.match(editor, /max-h-80/);
  assert.match(editor, /src=\{candidate\.cover\.url\}/);
  assert.match(assembly, /resource-bom-changed/);
  assert.match(relations, /resource-relations-changed/);
});
