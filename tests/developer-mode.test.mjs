import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("developer mode is stored as a user preference", async () => {
  const [schema, migration, preferencesRoute, auth] = await Promise.all([
    source("db/schema.ts"),
    source("db/migrations/0038_user_developer_mode.sql"),
    source("app/api/v1/user/preferences/route.ts"),
    source("lib/api-auth.ts"),
  ]);

  assert.match(schema, /developerMode: boolean\("developer_mode"\)/);
  assert.match(migration, /"developer_mode" boolean DEFAULT false NOT NULL/);
  assert.match(preferencesRoute, /Object\.hasOwn\(payload, "developerMode"\)/);
  assert.match(preferencesRoute, /typeof developerMode !== "boolean"/);
  assert.match(auth, /developerMode: options\.user\.developerMode/);
});

test("developer mode exposes resource endpoints only when enabled", async () => {
  const [listPage, detailPage, list, detail, settings] = await Promise.all([
    source("app/(dashboard)/inventory/page.tsx"),
    source("app/(dashboard)/inventory/[id]/page.tsx"),
    source("components/inventory-client.tsx"),
    source("components/resource-details.tsx"),
    source("app/(dashboard)/settings/user/page.tsx"),
  ]);

  assert.match(listPage, /developerMode=\{identity\?\.developerMode \?\? false\}/);
  assert.match(detailPage, /organizationId=\{identity\?\.organizationId \?\? ""\}/);
  assert.match(list, /developerMode \? \(/);
  assert.match(list, /\/api\/v1\/resources\/\{resource\.id\}/);
  assert.match(detail, /X-Organization-ID: \{organizationId\}/);
  assert.match(detail, /\/api\/v1\/resources\/\{resource\.id\}\/stock/);
  assert.match(settings, /<DeveloperModeSetting/);
});
