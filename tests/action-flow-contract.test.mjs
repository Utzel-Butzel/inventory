import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  publicActionFlowExecuteSchema,
  scanWorkflowCreateSchema,
  stockScanResolveSchema,
  stockScanExecuteSchema,
} from "../lib/scan-workflow-contract.ts";
import {
  extractScanRegexValue,
  scanRegexFromSelection,
} from "../lib/scan-regex.ts";

const resourceId = "4b277830-d4f3-42b6-9d13-f70801f32e76";
const secondResourceId = "fcd3ccdc-68a4-4afd-a07c-094b942ffaee";

test("the action-flow migration persists operations and permits action webhooks", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0044_action_flows.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /"operation" jsonb/);
  assert.match(migration, /"extracted_fields" jsonb/);
  assert.match(migration, /inventory\.action\.executed/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS "webhook_events_type_check"/);
});

test("the code setup migration stores accepted symbologies and execution metadata", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0047_scan_code_setup.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /"code_types" text\[\]/);
  assert.match(migration, /"code_type" varchar\(32\)/);
  assert.match(migration, /workflow_extraction/);
});

test("the public action URL migration adds an unguessable trigger and quantity source", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0049_public_action_flow_urls.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /"public_trigger_id" uuid/);
  assert.match(migration, /gen_random_uuid\(\)/);
  assert.match(migration, /UNIQUE INDEX/iu);
  assert.match(migration, /"quantity_input_key" varchar\(80\)/);
});

test("the target migration adds multi-target and variation selection settings", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0050_action_flow_targets.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /"target_resource_ids" uuid\[\]/);
  assert.match(migration, /"target_selection_mode" varchar\(16\)/);
  assert.match(migration, /"allow_variant_selection" boolean/);
  assert.match(migration, /ARRAY\["resource_id"\]/);
});

test("the target picker reuses the universal inventory select with quick preview", async () => {
  const [builder, inventorySelect] = await Promise.all([
    readFile(
      new URL("../components/stock-workflow/target-step.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/inventory-select.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(builder, /<InventorySelect/);
  assert.match(builder, /targetQuery/);
  assert.match(builder, /resource\.sku/);
  assert.match(inventorySelect, /InventoryQuickPreview/);
  assert.match(inventorySelect, /inventorySelect\.preview\.open/);
  assert.match(inventorySelect, /\/api\/v1\/resources\/\$\{item\.id\}/);
});

test("an action flow can target all entries or let users select with radios or checkboxes", () => {
  const base = {
    name: "Mehrere Ziele",
    resourceId,
    resourceIds: [resourceId, secondResourceId],
    extraction: { mode: "full" },
    identifierPropertyKey: "code",
    identifierStorage: "execution",
    operation: { type: "stock-adjustment", delta: 1 },
  };

  for (const targetSelectionMode of ["all", "radio", "checkbox"]) {
    const result = scanWorkflowCreateSchema.safeParse({
      ...base,
      targetSelectionMode,
      allowVariantSelection: true,
    });
    assert.equal(result.success, true);
  }
  assert.equal(
    stockScanResolveSchema.safeParse({
      workflowId: resourceId,
      code: "restock",
      selectedResourceIds: [secondResourceId],
    }).success,
    true,
  );
  assert.equal(
    publicActionFlowExecuteSchema.safeParse({
      selectedResourceIds: [resourceId, secondResourceId],
      inputs: {},
    }).success,
    true,
  );
});

test("an E-paper assembly flow accepts extracted fields, typed input, media, and a webhook", () => {
  const result = scanWorkflowCreateSchema.safeParse({
    name: "E-Paper-Rahmen fertigstellen",
    resourceId,
    extraction: {
      mode: "url-query",
      parameter: "id",
      sourceOrigin: "https://inventory.example",
      sourcePath: "/frame",
    },
    identifierPropertyKey: "epaper_id",
    identifierStorage: "custom-field",
    extractedFields: [
      {
        key: "batch",
        label: "Charge",
        extraction: { mode: "url-query", parameter: "batch" },
        storage: "custom-field",
      },
    ],
    operation: { type: "assembly-build", quantity: 1 },
    createMissingUnit: true,
    unitStatus: "available",
    fixedProperties: [
      {
        key: "assembly_state",
        label: "Montagestatus",
        value: "finished",
        storage: "metadata",
      },
    ],
    inputFields: [
      {
        key: "frame_color",
        label: "Rahmenfarbe",
        type: "radio",
        storage: "custom-field",
        required: true,
        options: [
          { value: "black", label: "Schwarz" },
          { value: "white", label: "Weiß" },
        ],
      },
      {
        key: "photos",
        label: "Montagefotos",
        type: "media",
        storage: "execution",
        required: false,
      },
    ],
    triggerWebhook: true,
    webhookEventName: "epaper.frame.completed",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.operation, { type: "assembly-build", quantity: 1 });
    assert.equal(result.data.inputFields[1].storage, "execution");
  }
});

test("a universal barcode flow can add five bulk items", () => {
  const result = scanWorkflowCreateSchema.safeParse({
    name: "Fünf Stück einbuchen",
    resourceId,
    extraction: { mode: "full" },
    identifierPropertyKey: "scanned_code",
    identifierStorage: "execution",
    codeTypes: ["code_128", "ean_13", "qr_code"],
    operation: { type: "stock-adjustment", delta: 5 },
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.operation.delta, 5);
    assert.deepEqual(result.data.codeTypes, ["code_128", "ean_13", "qr_code"]);
  }
});

test("a public URL flow can use a required number input as its booking quantity", () => {
  const result = scanWorkflowCreateSchema.safeParse({
    name: "Öffentlich nachfüllen",
    resourceId,
    extraction: { mode: "full" },
    identifierPropertyKey: "source",
    identifierStorage: "execution",
    publicTriggerEnabled: true,
    publicTriggerCode: "public-restock",
    operation: { type: "stock-adjustment", delta: 1 },
    quantityInputKey: "quantity",
    inputFields: [
      {
        key: "quantity",
        label: "Menge",
        type: "number",
        storage: "execution",
        required: true,
      },
      {
        key: "note",
        label: "Notiz",
        type: "text",
        storage: "execution",
        required: false,
      },
    ],
  });
  assert.equal(result.success, true);
  assert.equal(
    publicActionFlowExecuteSchema.safeParse({
      inputs: { quantity: 5, note: "Lieferung" },
    }).success,
    true,
  );

  assert.equal(
    scanWorkflowCreateSchema.safeParse({
      name: "Invalid quantity source",
      resourceId,
      extraction: { mode: "full" },
      identifierPropertyKey: "source",
      identifierStorage: "execution",
      operation: { type: "stock-adjustment", delta: 1 },
      quantityInputKey: "quantity",
      inputFields: [
        {
          key: "quantity",
          label: "Menge",
          type: "number",
          storage: "execution",
          required: false,
        },
      ],
    }).success,
    false,
  );
});

test("regex extraction supports a named group and rejects unsafe patterns", () => {
  const flow = scanWorkflowCreateSchema.safeParse({
    name: "Seriennummer extrahieren",
    resourceId,
    codeTypes: ["data_matrix"],
    extraction: {
      mode: "regex",
      pattern: "^LOT-[A-Z]+;SN=(?<value>[A-Z0-9-]+)$",
      flags: "i",
      group: "value",
    },
    identifierPropertyKey: "serial_number",
  });
  assert.equal(flow.success, true);
  assert.deepEqual(
    extractScanRegexValue("LOT-AB;SN=EPD-42", {
      pattern: "^LOT-[A-Z]+;SN=(?<value>[A-Z0-9-]+)$",
      flags: "i",
      group: "value",
    }),
    { value: "EPD-42", error: null },
  );
  assert.equal(
    scanWorkflowCreateSchema.safeParse({
      name: "Unsafe",
      resourceId,
      extraction: { mode: "regex", pattern: "(a+)+$", group: "1" },
      identifierPropertyKey: "code",
    }).success,
    false,
  );
  assert.equal(
    scanWorkflowCreateSchema.safeParse({
      name: "Ambiguous repetition",
      resourceId,
      extraction: { mode: "regex", pattern: "(a|aa)+$", group: "1" },
      identifierPropertyKey: "code",
    }).success,
    false,
  );
});

test("a selected sample segment becomes an exact, validated regex", () => {
  const sample = "LOT=42;SN=EPD-123;COLOR=black";
  const selection = scanRegexFromSelection(
    sample,
    sample.indexOf("EPD-123"),
    sample.indexOf("EPD-123") + "EPD-123".length,
  );
  assert.deepEqual(selection, {
    pattern: "^LOT=42;SN=(?<value>.+?);COLOR=black$",
    flags: "",
    group: "value",
  });
  assert.deepEqual(extractScanRegexValue(sample, selection), {
    value: "EPD-123",
    error: null,
  });
});

test("scanner requests accept known symbology metadata and reject unknown types", () => {
  assert.equal(
    stockScanResolveSchema.safeParse({
      workflowId: resourceId,
      code: "SN=42",
      codeType: "code_128",
    }).success,
    true,
  );
  assert.equal(
    stockScanResolveSchema.safeParse({
      workflowId: resourceId,
      code: "SN=42",
      codeType: "made_up",
    }).success,
    false,
  );
});

test("file inputs must be execution data and stock adjustments cannot be zero", () => {
  const base = {
    name: "Invalid flow",
    resourceId,
    extraction: { mode: "full" },
    identifierPropertyKey: "code",
  };

  assert.equal(
    scanWorkflowCreateSchema.safeParse({
      ...base,
      operation: { type: "stock-adjustment", delta: 0 },
    }).success,
    false,
  );
  assert.equal(
    scanWorkflowCreateSchema.safeParse({
      ...base,
      inputFields: [
        {
          key: "document",
          label: "Dokument",
          type: "file",
          storage: "custom-field",
          required: false,
        },
      ],
    }).success,
    false,
  );
});

test("native and web executions use the same typed input contract", () => {
  const result = stockScanExecuteSchema.safeParse({
    workflowId: resourceId,
    revision: 3,
    code: "https://inventory.example/frame?id=EP-42",
    expectedResourceUpdatedAt: "2026-09-02T10:00:00.000Z",
    expectedUnitId: null,
    expectedUnitUpdatedAt: null,
    inputs: {
      frame_color: "black",
      inspected: true,
      temperature: 21.5,
      photos: ["6b325660-944c-48f7-9a5b-7c723a37279b"],
    },
  });

  assert.equal(result.success, true);
});
