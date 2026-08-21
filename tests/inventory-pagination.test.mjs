import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  DEFAULT_INVENTORY_PAGE_SIZE,
  INVENTORY_PAGE_SIZE_OPTIONS,
  isInventoryPageSize,
  normalizeInventoryPageSize,
} from "../lib/inventory-pagination.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("inventory pagination exposes the supported page sizes", () => {
  assert.deepEqual([...INVENTORY_PAGE_SIZE_OPTIONS], [50, 100, 200, 500]);
  assert.equal(DEFAULT_INVENTORY_PAGE_SIZE, 50);
  assert.equal(isInventoryPageSize(200), true);
  assert.equal(isInventoryPageSize(24), false);
  assert.equal(normalizeInventoryPageSize(500), 500);
  assert.equal(normalizeInventoryPageSize(999), 50);
});

test("inventory pagination is wired through the list and user settings", async () => {
  const [client, settings, route, migration] = await Promise.all([
    read("../components/inventory-client.tsx"),
    read("../app/(dashboard)/settings/user/page.tsx"),
    read("../app/api/v1/user/preferences/route.ts"),
    read("../db/migrations/0037_user_inventory_page_size.sql"),
  ]);

  assert.match(client, /pageSize: String\(pageSize\)/);
  assert.match(client, /INVENTORY_PAGE_SIZE_OPTIONS\.map/);
  assert.match(settings, /<InventoryPageSizeSetting/);
  assert.match(route, /isInventoryPageSize\(inventoryPageSize\)/);
  assert.match(migration, /IN \(50, 100, 200, 500\)/);
});
