import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the inventory list exposes selection in both views and uses the batch API", async () => {
  const inventory = await source("components/inventory-client.tsx");

  assert.match(inventory, /const MAX_BATCH_SELECTION = 100/);
  assert.match(inventory, /view === "grid"/);
  assert.match(inventory, /view === "table"/);
  assert.match(inventory, /aria-pressed=\{selected\}/);
  assert.match(inventory, /togglePageSelection/);
  assert.match(inventory, /"\/api\/v1\/resources\/batch"/);
  assert.match(
    inventory,
    /JSON\.stringify\(\{ ids: selectedIds, changes, addTags \}\)/,
  );
});

test("batch selection copy is complete in English and German", async () => {
  const [english, german] = await Promise.all([
    source("app/i18n/locales/en/inventory.json").then(JSON.parse),
    source("app/i18n/locales/de/inventory.json").then(JSON.parse),
  ]);

  for (const catalog of [english, german]) {
    assert.equal(typeof catalog.batchSelection.start, "string");
    assert.equal(typeof catalog.batchSelection.selectPage, "string");
    assert.equal(typeof catalog.batchSelection.fields.status, "string");
    assert.equal(typeof catalog.batchSelection.fields.type, "string");
    assert.equal(typeof catalog.batchSelection.fields.priority, "string");
    assert.equal(typeof catalog.batchSelection.fields.tags, "string");
    assert.equal(typeof catalog.batchSelection.fields.location, "string");
    assert.equal(typeof catalog.batchSelection.notices.updated_other, "string");
    assert.equal(typeof catalog.batchSelection.errors.update, "string");
  }
});
