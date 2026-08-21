import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isResourceUuid,
  primaryResourceReference,
  resourceSlugsSchema,
} from "../lib/resource-slug-contract.ts";

test("resource slugs normalize and preserve multiple aliases", () => {
  assert.deepEqual(
    resourceSlugsSchema.parse(["  Workshop-Saw  ", "track-saw-2"]),
    ["workshop-saw", "track-saw-2"],
  );
});

test("resource slugs reject duplicates, reserved routes, UUIDs, and unsafe characters", () => {
  for (const slugs of [
    ["workshop-saw", "WORKSHOP-SAW"],
    ["new"],
    ["550e8400-e29b-41d4-a716-446655440000"],
    ["workshop_saw"],
    ["workshop--saw"],
  ]) {
    assert.equal(resourceSlugsSchema.safeParse(slugs).success, false);
  }
});

test("resource UUID detection keeps UUID references unambiguous", () => {
  assert.equal(isResourceUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isResourceUuid("workshop-saw"), false);
});

test("the first slug is the standard resource reference", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(
    primaryResourceReference({ id, slugs: ["standard", "alias"] }),
    "standard",
  );
  assert.equal(primaryResourceReference({ id, slugs: [] }), id);
  assert.equal(primaryResourceReference({ id }), id);
});

test("the migration enforces tenant uniqueness and tenant-safe cascading", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0041_resource_slugs.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    migration,
    /PRIMARY KEY \("organization_id", "slug"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "resource_id"\)[\s\S]*REFERENCES "resources"\("organization_id", "id"\) ON DELETE CASCADE/,
  );
  assert.match(migration, /"slug" <> 'new'/);
});
