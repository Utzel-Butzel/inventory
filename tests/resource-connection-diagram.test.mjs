import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildResourceConnectionDiagram } from "../lib/resource-connection-diagram.ts";

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

test("the detail-page diagram loads lazily from existing read APIs", async () => {
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
  assert.match(component, /<details[\s\S]*onToggle/);
  assert.match(component, /\/relations`/);
  assert.match(component, /\/family`/);
  assert.match(component, /\/bom`/);
  assert.match(component, /Promise\.allSettled/);
  assert.match(component, /OrganizationLink as Link/);
});
