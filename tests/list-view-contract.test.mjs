import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineListViews, createListViewConfig, listViewCollectionSchema, listViewConfigSchema, removeListView, saveListView,
  listViewWriteSchema, orderListItems, restoreListView, sameListView,
} from "../lib/list-view-contract.ts";

const id = "00000000-0000-4000-8000-000000000063";
const config = createListViewConfig({ sort: "name", filters: { status: "available" }, columns: ["name", "sku"] });

test("compact inventory defaults preserve saved optional columns and layouts", () => {
  const defaults = createListViewConfig({ columns: ["name", "quantity", "location", "status"], density: "compact" });
  const saved = { ...config, columns: ["name", "sku", "valueCents"], layout: "grid" };
  const restored = restoreListView(saved, defaults, [...defaults.columns, "sku", "valueCents"]);
  assert.deepEqual(restored.columns, saved.columns);
  assert.equal(restored.layout, "grid");
});
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


test("shared writes require a revision and cannot choose an organization or user", () => {
  const payload = { scope: "inventory", revision: 0, collection: { views: [], defaultId: null } };
  assert.equal(listViewWriteSchema.safeParse(payload).success, true);
  assert.equal(listViewWriteSchema.safeParse({ ...payload, organizationCollection: payload.collection }).success, false);
  assert.equal(listViewWriteSchema.safeParse({ ...payload, organizationRevision: 0 }).success, false);
  assert.equal(listViewWriteSchema.safeParse({ ...payload, organizationRevision: 0, organizationCollection: payload.collection }).success, true);
  assert.equal(listViewWriteSchema.safeParse({ ...payload, organizationId: id }).success, false);
});

test("personal and shared views with identical names and IDs remain separately selectable", () => {
  const collections = { personal: { views: [view], defaultId: id }, organization: { views: [view], defaultId: id } };
  const combined = combineListViews(collections);
  assert.equal(combined.views.length, 2);
  assert.notEqual(combined.views[0].key, combined.views[1].key);
  assert.equal(combined.defaultId, "personal:" + id);
  assert.equal(combineListViews({ ...collections, personal: { ...collections.personal, defaultId: null } }).defaultId, "organization:" + id);
});

test("changing visibility moves a view without publishing its personal default", () => {
  const empty = { views: [], defaultId: null };
  const collections = { personal: { views: [view], defaultId: id }, organization: empty };
  const original = combineListViews(collections).views[0];
  const sharedView = { ...view, id: "00000000-0000-4000-8000-000000000065" };
  const shared = saveListView(collections, sharedView, "organization", original);
  assert.deepEqual(shared.personal, empty);
  assert.deepEqual(shared.organization, { views: [sharedView], defaultId: null });
  assert.deepEqual(collections.personal.views, [view]);
  const restored = saveListView(shared, view, "personal", combineListViews(shared).views[0]);
  assert.deepEqual(restored.organization, empty);
  assert.deepEqual(restored.personal.views, [view]);
});

test("saving a personal copy leaves the shared original intact; duplicate names apply per visibility", () => {
  const collections = { personal: { views: [], defaultId: null }, organization: { views: [view], defaultId: id } };
  const copied = saveListView(collections, view, "personal");
  assert.deepEqual(copied.organization, collections.organization);
  assert.deepEqual(copied.personal.views, [view]);
  assert.throws(() => saveListView(copied, { ...view, name: " werkzeuge " }, "personal"), /name/);
  assert.deepEqual(removeListView(collections.organization, id), { views: [], defaultId: null });
});

test("a full destination rejects a visibility move without removing the source", () => {
  const personal = { views: [view], defaultId: id };
  const organization = { views: Array.from({ length: 30 }, (_, i) => ({ ...view, id: String(i), name: "Shared " + i })), defaultId: null };
  const collections = { personal, organization };
  assert.throws(() => saveListView(collections, view, "organization", combineListViews(collections).views[0]), /limit/);
  assert.deepEqual(collections.personal, personal);
});
