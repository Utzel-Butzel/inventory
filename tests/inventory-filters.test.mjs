import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { inventoryTagFilterSchema, readInventoryTagFilter, writeInventoryTagFilter, isInventoryTagFilterActive } from "../lib/inventory-tag-filter.ts";
import { inventoryTagFilterCondition } from "../lib/inventory-tag-filter-sql.ts";
import { createListViewConfig, restoreListView, listViewConfigSchema } from "../lib/list-view-contract.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("saved inventory filters preserve exact names, including the all sentinel", () => {
  const defaults = createListViewConfig({ filters: { tag: "all", category: "all", excludeCategory: "all" } });
  const saved = listViewConfigSchema.parse({ ...defaults, filters: {
    tag: "=all", category: "=Verbrauchsmaterialien", excludeCategory: "=Gegenstände im Büro",
  } });
  assert.deepEqual(restoreListView(saved, defaults).filters, saved.filters);
  assert.deepEqual(restoreListView(createListViewConfig(), defaults).filters, defaults.filters);
});

test("inventory API applies exact tag/category predicates to both rows and totals before pagination", async () => {
  const [route, store] = await Promise.all([read("../app/api/v1/resources/route.ts"), read("../lib/resources.ts")]);
  for (const key of ["tag", "category", "excludeCategory"]) {
    assert.ok(route.includes(`${key}: url.searchParams.get("${key}")`));
    assert.ok(store.indexOf(`if (options.${key})`) < store.indexOf("const where = conditions.length"));
  }
  assert.ok(store.indexOf("inventoryTagFilterCondition(resources.tags, options.tagFilter)") < store.indexOf("const where = conditions.length"));
  assert.ok(route.includes("inventoryTagFilterSchema.parse(JSON.parse(rawTagFilter))"));
  assert.ok(store.includes('conditions.push(sql`${options.tag} = ANY(${resources.tags})`)'));
  assert.ok(store.includes('JSON.stringify([{ name: options.category }])'));
  assert.ok(store.includes('sql`NOT (${resources.categories} @>'));
  assert.match(store, /\.where\(where\)[\s\S]*\.limit\(pageSize\)/);
  assert.ok(store.includes('db.select({ value: count() }).from(resources).where(where)'));
});

test("filter choices cover the organization independently of list pagination", async () => {
  const route = await read("../app/api/v1/resources/filter-options/route.ts");
  assert.ok(route.includes('requirePermission(request, "inventory.read")'));
  assert.equal((route.match(/WHERE \$\{resources.organizationId\} = \$\{organizationId\}/g) ?? []).length, 2);
  assert.ok(route.includes("SELECT DISTINCT unnest"));
  assert.ok(route.includes("jsonb_array_elements"));
  assert.doesNotMatch(route, /LIMIT|OFFSET/);
});

test("both layouts show tags and filter changes reset pagination", async () => {
  const client = await read("../components/inventory-client.tsx");
  assert.equal((client.match(/<ResourceTags tags=\{resource.tags\} \/>/g) ?? []).length, 2);
  assert.match(client, /setPage\(1\); \}, \[type, status, priority, tag, category, excludeCategory,/);
  assert.ok(client.includes('search.set("tagFilter", JSON.stringify(tagFilter))'));
  for (const key of ["category", "excludeCategory"]) {
    assert.ok(client.includes(`search.set("${key}", ${key}.slice(1))`));
  }
  for (const locale of ["en", "de"]) {
    const copy = JSON.parse(await read(`../app/i18n/locales/${locale}/inventory.json`));
    for (const key of ["tagLabel", "categoryLabel", "excludeCategoryLabel"]) assert.ok(copy.filters[key]);
    assert.ok(copy.errors.filterOptions);
  }
});


test("multi-tag saved views round-trip operators and long selections", () => {
  const tags = ["all", "a,b", 'a"b', "Größe", ...Array.from({ length: 20 }, (_, i) => `Tag ${i} ${"x".repeat(40)}`)];
  for (const operator of ["is", "isNot", "hasNot"]) {
    const filter = { operator, tags };
    const defaults = createListViewConfig({ filters: { tag: "all" } });
    const saved = listViewConfigSchema.parse({ ...defaults, filters: { tag: writeInventoryTagFilter(filter) } });
    assert.deepEqual(readInventoryTagFilter(restoreListView(saved, defaults).filters.tag), filter);
  }
  assert.deepEqual(readInventoryTagFilter("=all"), { operator: "is", tags: ["all"] });
  assert.deepEqual(readInventoryTagFilter("all"), { operator: "is", tags: [] });
  assert.deepEqual(readInventoryTagFilter("broken"), { operator: "is", tags: [] });
  assert.equal(listViewConfigSchema.safeParse(createListViewConfig({ filters: { status: "x".repeat(201) } })).success, false);
});

test("empty selections stay inactive, while HAS NOT works without a selection", () => {
  for (const operator of ["is", "isNot", "hasNot"]) {
    const filter = readInventoryTagFilter(writeInventoryTagFilter({ operator, tags: [] }));
    assert.equal(filter.operator, operator);
    assert.equal(isInventoryTagFilterActive(filter), operator === "hasNot");
  }
  assert.deepEqual(readInventoryTagFilter(writeInventoryTagFilter({ operator: "is", tags: ["a", "a"] })).tags, ["a"]);
  for (const invalid of [
    { operator: "invalid", tags: [] }, { operator: "is", tags: "a" },
    { operator: "is", tags: [""] }, { operator: "is", tags: ["x".repeat(61)] },
    { operator: "is", tags: Array(81).fill("a") },
  ]) assert.equal(inventoryTagFilterSchema.safeParse(invalid).success, false);
});

test("SQL uses exact parameterized overlap and its complement, with no predicate for an empty selection", () => {
  const dialect = new PgDialect();
  const column = sql.identifier("tags");
  const tags = ["all", "a,b", "'); DROP TABLE resources; --"];
  for (const operator of ["is", "isNot"]) {
    const query = dialect.sqlToQuery(inventoryTagFilterCondition(column, { operator, tags }));
    assert.deepEqual(query.params, tags);
    assert.equal(query.sql, operator === "is" ? '"tags" && ARRAY[$1, $2, $3]::text[]' : 'NOT ("tags" && ARRAY[$1, $2, $3]::text[])');
    assert.equal(inventoryTagFilterCondition(column, { operator, tags: [] }), undefined);
  }
  const empty = dialect.sqlToQuery(inventoryTagFilterCondition(column, { operator: "hasNot", tags }));
  assert.equal(empty.sql, 'cardinality("tags") = 0');
  assert.deepEqual(empty.params, []);
});

test("combined tag conditions survive saved views and accept legacy single conditions", () => {
  const filter = { conditions: [
    { operator: "is", tags: ["Werkzeug", "Büro"] },
    { operator: "isNot", tags: ["Defekt"] },
    { operator: "is", tags: [] },
  ] };
  const defaults = createListViewConfig({ filters: { tag: "all" } });
  const config = listViewConfigSchema.parse({ ...defaults, filters: { tag: writeInventoryTagFilter(filter) } });
  assert.deepEqual(readInventoryTagFilter(restoreListView(config, defaults).filters.tag), filter);
  assert.deepEqual(inventoryTagFilterSchema.parse(filter), filter);
  assert.deepEqual(inventoryTagFilterSchema.parse({ operator: "is", tags: ["Werkzeug"] }), { operator: "is", tags: ["Werkzeug"] });
  assert.equal(isInventoryTagFilterActive(filter), true);
  assert.equal(isInventoryTagFilterActive({ conditions: [{ operator: "is", tags: [] }, { operator: "isNot", tags: [] }] }), false);
  assert.equal(isInventoryTagFilterActive({ conditions: [{ operator: "isNot", tags: [] }, { operator: "hasNot", tags: [] }] }), true);
  assert.equal(writeInventoryTagFilter({ conditions: [] }), "all");
  for (const invalid of [
    { conditions: [] },
    { conditions: Array(11).fill({ operator: "is", tags: [] }) },
    { conditions: [{ operator: "is", tags: Array(80).fill("a") }, { operator: "isNot", tags: ["b"] }] },
    { conditions: [{ operator: "invalid", tags: ["a"] }] },
    { conditions: [{ conditions: [{ operator: "is", tags: ["a"] }] }] },
  ]) assert.equal(inventoryTagFilterSchema.safeParse(invalid).success, false);
});

test("combined SQL ANDs inclusion and exclusion while ignoring unfinished rows", () => {
  const dialect = new PgDialect();
  const column = sql.identifier("tags");
  const filter = { conditions: [
    { operator: "is", tags: ["Werkzeug", "Büro"] },
    { operator: "isNot", tags: ["Defekt"] },
    { operator: "is", tags: [] },
  ] };
  const query = dialect.sqlToQuery(inventoryTagFilterCondition(column, filter));
  assert.equal(query.sql, '("tags" && ARRAY[$1, $2]::text[] and NOT ("tags" && ARRAY[$3]::text[]))');
  assert.deepEqual(query.params, ["Werkzeug", "Büro", "Defekt"]);
  assert.equal(inventoryTagFilterCondition(column, { conditions: [{ operator: "is", tags: [] }] }), undefined);
});
