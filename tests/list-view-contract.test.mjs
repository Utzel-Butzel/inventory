import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createListViewConfig, listViewCollectionSchema, listViewConfigSchema,
  listViewWriteSchema, orderListItems, restoreListView, sameListView,
} from "../lib/list-view-contract.ts";

const id = "00000000-0000-4000-8000-000000000063";
const config = createListViewConfig({ sort: "name", filters: { status: "available" }, columns: ["name", "sku"] });
const view = { id, name: "Werkzeuge", config };

test("saved views round-trip all controls and validate the default reference", () => {
  const collection = { views: [view], defaultId: id };
  assert.deepEqual(listViewCollectionSchema.parse(JSON.parse(JSON.stringify(collection))), collection);
  assert.equal(listViewCollectionSchema.safeParse({ views: [], defaultId: id }).success, false);
  assert.equal(listViewCollectionSchema.safeParse({ views: [view, view], defaultId: id }).success, false);
  assert.equal(listViewCollectionSchema.safeParse({ views: [view, { ...view, id: "00000000-0000-4000-8000-000000000064", name: " werkzeuge " }], defaultId: null }).success, false);
});

test("invalid and oversized saved configurations are rejected", () => {
  for (const invalid of [
    { ...config, query: "a".repeat(501) },
    { ...config, direction: "up" },
    { ...config, pageSize: 501 },
    { ...config, pageSize: 0 },
    { ...config, columns: ["name", "name"] },
    { ...config, sort: "__proto__" },
    { ...config, filters: Object.fromEntries(Array.from({ length: 21 }, (_, i) => ["f" + i, "all"])) },
  ]) assert.equal(listViewConfigSchema.safeParse(invalid).success, false);
  assert.equal(listViewWriteSchema.safeParse({ scope: "inventory", revision: -1, collection: { views: [], defaultId: null } }).success, false);
  assert.equal(listViewWriteSchema.safeParse({ scope: "inventory", revision: 0, collection: { views: [], defaultId: null }, userId: id }).success, false);
});

test("ordering handles numbers, natural names, nulls and direction without mutating input", () => {
  const items = [{ name: "Teil 10", value: null }, { name: "Teil 2", value: 3 }, { name: "Teil 1", value: 12 }];
  const fields = { name: (item) => item.name, value: (item) => item.value };
  assert.deepEqual(orderListItems(items, { sort: "name", direction: "asc" }, fields, "de").map((item) => item.name), ["Teil 1", "Teil 2", "Teil 10"]);
  assert.deepEqual(orderListItems(items, { sort: "value", direction: "asc" }, fields).map((item) => item.value), [3, 12, null]);
  assert.deepEqual(orderListItems(items, { sort: "value", direction: "desc" }, fields).map((item) => item.value), [12, 3, null]);
  assert.equal(items[0].name, "Teil 10");
  assert.deepEqual(orderListItems(items, { sort: "__proto__", direction: "desc" }, fields), items);
});

test("restoration preserves the primary column and fills newly added filter defaults", () => {
  const defaults = createListViewConfig({ columns: ["name", "sku", "location"], filters: { type: "all", status: "all" } });
  const restored = restoreListView({ ...config, columns: ["location", "removed-column", "sku"] }, defaults);
  assert.deepEqual(restored.columns, ["name", "location", "sku"]);
  assert.deepEqual(restored.filters, { type: "all", status: "available" });
  assert.equal(sameListView({ ...config, filters: { type: "tool", status: "all" } }, { ...config, filters: { status: "all", type: "tool" } }), true);
  assert.equal(sameListView(config, { ...config, columns: ["sku", "name"] }), false);
});
