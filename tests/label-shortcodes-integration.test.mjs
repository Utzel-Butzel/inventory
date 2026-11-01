import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

test("shortcodes are stable under concurrency, tenant-scoped and permanently reserved after deletion", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = "shortcode_test_" + randomUUID().replaceAll("-", "");
  const admin = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const connection = postgres(process.env.TEST_DATABASE_URL, { max: 8, connection: { search_path: schema } });
  globalThis.inventorySql = connection;
  try {
    await connection`CREATE TABLE organizations(id uuid PRIMARY KEY, slug text NOT NULL)`;
    await connection`CREATE TABLE resources(id uuid PRIMARY KEY, organization_id uuid NOT NULL)`;
    await connection`CREATE TABLE stock_units(id uuid PRIMARY KEY, organization_id uuid NOT NULL, resource_id uuid NOT NULL)`;
    await connection.unsafe(await readFile(new URL("../db/migrations/0075_label_shortcodes.sql", import.meta.url), "utf8"));
    await connection.unsafe(await readFile(new URL("../db/migrations/0076_label_qr_redirect.sql", import.meta.url), "utf8"));
    const { ensureLabelShortcode, resolveLabelShortcode } = await import("../lib/label-shortcodes.ts");
    const { getLabelExternalDestination } = await import("../lib/label-redirect.ts");
    const org = randomUUID(), otherOrg = randomUUID(), resource = randomUUID(), otherResource = randomUUID(), unit = randomUUID();
    await connection`INSERT INTO organizations(id,slug) VALUES(${org},'workshop'),(${otherOrg},'other')`;
    await connection`INSERT INTO resources VALUES(${resource},${org}),(${otherResource},${otherOrg})`;
    await connection`INSERT INTO stock_units VALUES(${unit},${org},${resource})`;
    const codes = await Promise.all(Array.from({ length: 20 }, () => ensureLabelShortcode(org, resource, null)));
    assert.equal(new Set(codes).size, 1);
    assert.match(codes[0], /^[A-Za-z0-9_-]{8}$/);
    const unitCodes = await Promise.all(Array.from({ length: 20 }, () => ensureLabelShortcode(org, resource, unit)));
    assert.equal(new Set(unitCodes).size, 1);
    assert.notEqual(unitCodes[0], codes[0]);
    assert.equal((await resolveLabelShortcode(unitCodes[0], org)).stockUnitId, unit);
    assert.equal(await resolveLabelShortcode(unitCodes[0], otherOrg), null);
    assert.equal(await ensureLabelShortcode(otherOrg, resource, null), null);
    assert.equal(await ensureLabelShortcode(otherOrg, otherResource, unit), null);
    assert.equal(await ensureLabelShortcode(org, resource, randomUUID()), null);
    assert.equal((await connection`SELECT * FROM label_shortcodes`).length, 2);
    const requestUrl = "https://inventory.example/q/" + codes[0];
    assert.equal(await getLabelExternalDestination(resource, null, requestUrl), null);
    await connection`UPDATE organizations SET label_qr_redirect_url='https://digital.konglomerat.org/slack' WHERE id=${org}`;
    assert.equal(await getLabelExternalDestination(resource, null, requestUrl), "https://digital.konglomerat.org/slack?src=qr");
    assert.equal(await getLabelExternalDestination(resource, unit, requestUrl), "https://digital.konglomerat.org/slack?src=qr");
    assert.equal(await getLabelExternalDestination(otherResource, null, requestUrl), null);
    assert.equal(await getLabelExternalDestination(otherResource, unit, requestUrl), null);
    await connection`UPDATE organizations SET label_qr_redirect_url='https://example.org/new?keep=1#section' WHERE id=${org}`;
    assert.equal(await getLabelExternalDestination(resource, null, requestUrl), "https://example.org/new?keep=1&src=qr#section");
    await connection`UPDATE organizations SET label_qr_redirect_url=NULL WHERE id=${org}`;
    assert.equal(await getLabelExternalDestination(resource, null, requestUrl), null);
    assert.equal(await ensureLabelShortcode(org, resource, null), codes[0]);
    await connection`UPDATE organizations SET label_qr_redirect_url='https://example.org/slack' WHERE id=${org}`;
    await connection`DELETE FROM stock_units WHERE id=${unit}`;
    assert.equal(await getLabelExternalDestination(resource, unit, requestUrl), null);
    assert.equal(await resolveLabelShortcode(unitCodes[0]), null);
    assert.equal((await resolveLabelShortcode(codes[0])).resourceId, resource);
    await connection`DELETE FROM resources WHERE id=${resource}`;
    assert.equal(await resolveLabelShortcode(codes[0]), null);
    await connection`DELETE FROM organizations WHERE id=${org}`;
    assert.equal((await connection`SELECT * FROM label_shortcodes`).length, 2);
    // Even a direct collision with a deleted target's code cannot overwrite its reservation.
    const inserted = await connection`INSERT INTO label_shortcodes(code,organization_id,resource_id) VALUES(${codes[0]},${otherOrg},${otherResource}) ON CONFLICT DO NOTHING RETURNING code`;
    assert.equal(inserted.length, 0);
  } finally {
    await connection.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    delete globalThis.inventorySql;
  }
});
