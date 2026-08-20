import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("inventory research migration and schema allow the paid operation", async () => {
  const [migration, schema] = await Promise.all([
    readFile(
      new URL("../db/migrations/0034_ai_inventory_research.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  for (const constraint of [
    "ai_rate_limit_buckets_operation_check",
    "ai_idempotency_operations_operation_check",
  ]) {
    assert.match(migration, new RegExp(`DROP CONSTRAINT IF EXISTS "${constraint}"`));
    assert.match(migration, new RegExp(`ADD CONSTRAINT "${constraint}"`));
  }
  assert.equal((migration.match(/'research'/g) ?? []).length, 2);
  assert.match(schema, /operation.*research.*recognize.*count.*cover.*translate/s);
});
