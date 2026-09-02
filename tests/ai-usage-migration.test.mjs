import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../db/migrations/0045_ai_cost_controls.sql", import.meta.url),
  "utf8",
);

test("AI cost controls persist a tenant budget and per-attempt ledger", () => {
  assert.match(migration, /ai_monthly_budget_micros/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "ai_usage_events"/);
  assert.match(migration, /"cost_micros" bigint NOT NULL/);
  assert.match(migration, /"organization_id" uuid NOT NULL/);
  assert.match(migration, /pg_catalog|estimated cost ledger|estimated AI spend/i);
});

test("legacy AI grants expand into every granular paid capability", () => {
  for (const permission of [
    "ai.analyze",
    "ai.research",
    "ai.recognize",
    "ai.count",
    "ai.images",
    "ai.translate",
    "ai.rooms",
  ]) {
    assert.match(migration, new RegExp(`'${permission.replace(".", "\\.")}'`));
  }
  assert.match(migration, /array_remove\("permissions", 'ai\.use'\)/);
});
