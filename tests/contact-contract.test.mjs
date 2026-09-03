import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  contactInputSchema,
  contactPatchSchema,
} from "../lib/contact-contract.ts";
import { stockMovementSchema } from "../lib/stock-movement-contract.ts";

const resourceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("contacts can be customers and suppliers at the same time", () => {
  const parsed = contactInputSchema.parse({
    name: "  Alex Example  ",
    roles: ["customer", "supplier", "supplier"],
    email: " ALEX@EXAMPLE.COM ",
    countryCode: "de",
    tags: ["Key account", "Key account"],
    resourceIds: [resourceId, resourceId],
  });

  assert.equal(parsed.name, "Alex Example");
  assert.deepEqual(parsed.roles, ["customer", "supplier"]);
  assert.equal(parsed.email, "alex@example.com");
  assert.equal(parsed.countryCode, "DE");
  assert.deepEqual(parsed.tags, ["Key account"]);
  assert.deepEqual(parsed.resourceIds, [resourceId]);
});

test("contacts require at least one supported role", () => {
  assert.equal(
    contactInputSchema.safeParse({ name: "No role", roles: [] }).success,
    false,
  );
  assert.equal(
    contactInputSchema.safeParse({ name: "Invalid", roles: ["partner"] }).success,
    false,
  );
});

test("contact patches preserve omitted fields and reject empty patches", () => {
  assert.deepEqual(contactPatchSchema.parse({ city: " Berlin " }), {
    city: "Berlin",
  });
  assert.equal(contactPatchSchema.safeParse({}).success, false);
});

test("manual stock movements accept an optional contact assignment", () => {
  const movement = stockMovementSchema.parse({
    delta: 2,
    type: "receipt",
    contactId: resourceId,
  });
  assert.equal(movement.contactId, resourceId);
  assert.equal(
    stockMovementSchema.safeParse({
      delta: -1,
      type: "issue",
      contactId: "another-organization",
    }).success,
    false,
  );
});

test("contacts migration creates tenant-safe inventory and movement links", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0055_contacts.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "contacts"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "contact_resources"/);
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "resource_id"\)[\s\S]*REFERENCES "resources"\("organization_id", "id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("organization_id", "contact_id"\)[\s\S]*REFERENCES "contacts"\("organization_id", "id"\)/,
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "contact_id" uuid/);
});
