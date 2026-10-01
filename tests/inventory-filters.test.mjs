import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
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
  for (const key of ["tag", "category", "excludeCategory"]) {
    assert.ok(client.includes(`search.set("${key}", ${key}.slice(1))`));
  }
  for (const locale of ["en", "de"]) {
    const copy = JSON.parse(await read(`../app/i18n/locales/${locale}/inventory.json`));
    for (const key of ["tagLabel", "categoryLabel", "excludeCategoryLabel"]) assert.ok(copy.filters[key]);
    assert.ok(copy.errors.filterOptions);
  }
});
