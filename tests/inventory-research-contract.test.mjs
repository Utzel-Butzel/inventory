import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInventoryResearchValues,
  inventoryResearchResultSchema,
} from "../lib/inventory-research-contract.ts";

const resource = {
  name: "Cordless drill",
  description: "A drill from the workshop.",
  type: "object",
  tags: ["tool"],
  categories: [{ name: "Workshop", color: "blue" }],
  sku: null,
  serialNumber: null,
  barcode: null,
  valueCents: null,
  currency: "EUR",
  notes: "",
};

const research = inventoryResearchResultSchema.parse({
  title: "Bosch Professional GSR 18V-55",
  additionalDescription:
    "- Brushless 18 V drill driver with a 13 mm metal chuck.",
  type: "tool",
  tags: ["tool", "bosch", "cordless"],
  categories: ["Workshop", "Power tools"],
  sku: "06019H5200",
  serialNumber: "SN-123",
  barcode: "4059952509324",
  valueCents: 15900,
  currency: "eur",
  internalNotes: "Compatible with Bosch Professional 18V System batteries.",
  confidence: 0.91,
});

test("research enriches missing details without replacing existing content", () => {
  const { values, generatedFields } = buildInventoryResearchValues(
    resource,
    research,
  );

  assert.equal(values.name, undefined);
  assert.equal(
    values.description,
    "A drill from the workshop.\n\n- Brushless 18 V drill driver with a 13 mm metal chuck.",
  );
  assert.equal(values.type, "tool");
  assert.deepEqual(values.tags, ["tool", "bosch", "cordless"]);
  assert.deepEqual(values.categories, [
    { name: "Workshop", color: "blue" },
    { name: "Power tools" },
  ]);
  assert.equal(values.sku, "06019H5200");
  assert.equal(values.serialNumber, "SN-123");
  assert.equal(values.barcode, "4059952509324");
  assert.equal(values.valueCents, 15900);
  assert.equal(values.currency, "EUR");
  assert.equal(
    values.notes,
    "Compatible with Bosch Professional 18V System batteries.",
  );
  assert.deepEqual(generatedFields, [
    "description",
    "type",
    "tags",
    "categories",
    "sku",
    "serialNumber",
    "barcode",
    "valueCents",
    "currency",
    "notes",
  ]);
});

test("research can replace only a generic title", () => {
  const result = buildInventoryResearchValues(
    { ...resource, name: "Untitled item" },
    { ...research, additionalDescription: "", tags: [], categories: [] },
  );
  assert.equal(result.values.name, "Bosch Professional GSR 18V-55");
});

test("uncertain research does not change inventory data", () => {
  const result = buildInventoryResearchValues(resource, {
    ...research,
    confidence: 0.49,
  });
  assert.deepEqual(result, { values: {}, generatedFields: [] });
});

test("replayed research does not append the same description twice", () => {
  const existingDescription = `${resource.description}\n\n${research.additionalDescription}`;
  const result = buildInventoryResearchValues(
    { ...resource, description: existingDescription },
    { ...research, tags: [], categories: [] },
  );
  assert.equal(result.values.description, undefined);
});

test("exact identifiers and value require high confidence", () => {
  const result = buildInventoryResearchValues(resource, {
    ...research,
    confidence: 0.75,
  });
  assert.equal(result.values.serialNumber, undefined);
  assert.equal(result.values.barcode, undefined);
  assert.equal(result.values.valueCents, undefined);
  assert.equal(result.values.sku, undefined);
  assert.equal(result.values.description, research.additionalDescription
    ? `${resource.description}\n\n${research.additionalDescription}`
    : undefined);
});

test("research never replaces existing Operations values", () => {
  const result = buildInventoryResearchValues(
    {
      ...resource,
      sku: "INTERNAL-42",
      serialNumber: "EXISTING-SERIAL",
      barcode: "EXISTING-BARCODE",
      valueCents: 9900,
      notes: "Keep this note.",
    },
    {
      ...research,
      additionalDescription: "",
      tags: [],
      categories: [],
      type: "object",
    },
  );

  for (const field of [
    "sku",
    "serialNumber",
    "barcode",
    "valueCents",
    "currency",
    "notes",
  ]) {
    assert.equal(result.values[field], undefined, `${field} was replaced`);
  }
});
