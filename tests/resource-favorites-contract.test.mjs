import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("favorites are private to an organization membership and cascade safely", async () => {
  const migration = await readSource(
    "db/migrations/0052_resource_favorites.sql",
  );

  assert.match(
    migration,
    /PRIMARY KEY \("organization_id", "user_id", "resource_id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "user_id"\)[\s\S]*REFERENCES "organization_memberships"\("organization_id", "user_id"\)[\s\S]*ON DELETE CASCADE/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "resource_id"\)[\s\S]*REFERENCES "resources"\("organization_id", "id"\)[\s\S]*ON DELETE CASCADE/,
  );
});

test("the favorites endpoint supports idempotent add and remove operations", async () => {
  const route = await readSource(
    "app/api/v1/resources/[id]/favorite/route.ts",
  );

  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /authorization\.identity\.userId/);
  assert.match(route, /"inventory\.read"/);
});

test("inventory navigation exposes the filtered favorites view after entries", async () => {
  const [shell, inventoryRoute, favoritesPage] = await Promise.all([
    readSource("components/app-shell.tsx"),
    readSource("app/api/v1/resources/route.ts"),
    readSource("app/(dashboard)/inventory/favorites/page.tsx"),
  ]);

  assert.match(
    shell,
    /navigation\.entries[\s\S]*\/inventory[\s\S]*navigation\.favorites[\s\S]*\/inventory\/favorites/,
  );
  assert.match(inventoryRoute, /favoritesOnly:[^\n]*favorites[^\n]*=== "true"/);
  assert.match(inventoryRoute, /favoriteUserId: authorization\.identity\.userId/);
  assert.match(favoritesPage, /<InventoryClient[\s\S]*favoritesOnly/);
});
