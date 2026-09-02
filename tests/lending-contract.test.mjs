import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isLoanOverdue,
  lendingSettingsSchema,
  loanWindowDurationDays,
} from "../lib/lending-contract.ts";

test("lending settings keep default and maximum durations consistent", () => {
  assert.equal(
    lendingSettingsSchema.safeParse({
      enabled: true,
      approvalRequired: true,
      defaultDurationDays: 7,
      maxDurationDays: 30,
    }).success,
    true,
  );
  assert.equal(
    lendingSettingsSchema.safeParse({
      enabled: true,
      approvalRequired: false,
      defaultDurationDays: 31,
      maxDurationDays: 30,
    }).success,
    false,
  );
});

test("overdue is a derived state for active loans only", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  assert.equal(
    isLoanOverdue(
      { kind: "checkout", status: "active", dueAt: "2026-09-01T12:00:00.000Z" },
      now,
    ),
    true,
  );
  assert.equal(
    isLoanOverdue(
      { kind: "reservation", status: "active", dueAt: "2026-09-01T12:00:00.000Z" },
      now,
    ),
    false,
  );
  assert.equal(
    isLoanOverdue(
      { kind: "checkout", status: "returned", dueAt: "2026-09-01T12:00:00.000Z" },
      now,
    ),
    false,
  );
});

test("loan windows use exact fractional days", () => {
  assert.equal(
    loanWindowDurationDays(
      new Date("2026-09-01T08:00:00.000Z"),
      new Date("2026-09-08T08:00:00.000Z"),
    ),
    7,
  );
});

test("the lending migration adds opt-in policy and deferred stock application", async () => {
  const migration = await readFile(
    new URL("../db/migrations/0048_resource_lending.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "resource_lending_settings"/);
  assert.match(migration, /"approval_required" boolean/);
  assert.match(migration, /"max_duration_days" integer/);
  assert.match(migration, /"stock_applied" boolean/);
  assert.match(migration, /FOREIGN KEY \("organization_id", "resource_id"\)/);
});
