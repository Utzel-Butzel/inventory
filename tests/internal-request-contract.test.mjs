import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  canTransitionInternalRequest,
  internalRequestCreateSchema,
  internalRequestStatusAfter,
  reservationWindowsOverlap,
} from "../lib/internal-request-contract.ts";

const resourceA = "11111111-1111-4111-8111-111111111111";
const resourceB = "22222222-2222-4222-8222-222222222222";

function validRequest() {
  return {
    startsAt: "2026-09-01T08:00:00.000Z",
    dueAt: "2026-09-03T16:00:00.000Z",
    deliveryResourceId: null,
    note: "Site installation",
    lines: [
      { resourceId: resourceA, quantity: 2 },
      { resourceId: resourceB, quantity: 1, note: "Include charger" },
    ],
  };
}

test("internal requests accept multi-item future windows", () => {
  const parsed = internalRequestCreateSchema.safeParse(validRequest());
  assert.equal(parsed.success, true);
});

test("internal requests reject duplicate items and invalid windows", () => {
  const duplicate = validRequest();
  duplicate.lines[1].resourceId = resourceA;
  assert.equal(internalRequestCreateSchema.safeParse(duplicate).success, false);

  const reversed = validRequest();
  reversed.dueAt = reversed.startsAt;
  assert.equal(internalRequestCreateSchema.safeParse(reversed).success, false);

  const tooLong = validRequest();
  tooLong.dueAt = "2027-09-04T16:00:00.000Z";
  assert.equal(internalRequestCreateSchema.safeParse(tooLong).success, false);
});

test("reservation overlap uses half-open time windows", () => {
  const morning = {
    startsAt: new Date("2026-09-01T08:00:00.000Z"),
    dueAt: new Date("2026-09-01T12:00:00.000Z"),
  };
  const afternoon = {
    startsAt: new Date("2026-09-01T12:00:00.000Z"),
    dueAt: new Date("2026-09-01T16:00:00.000Z"),
  };
  const overlapping = {
    startsAt: new Date("2026-09-01T11:59:00.000Z"),
    dueAt: new Date("2026-09-01T13:00:00.000Z"),
  };
  const openEnded = {
    startsAt: new Date("2026-09-01T10:00:00.000Z"),
    dueAt: null,
  };

  assert.equal(reservationWindowsOverlap(morning, afternoon), false);
  assert.equal(reservationWindowsOverlap(morning, overlapping), true);
  assert.equal(reservationWindowsOverlap(openEnded, afternoon), true);
});

test("request lifecycle only permits terminal-safe transitions", () => {
  assert.equal(canTransitionInternalRequest("submitted", "approve"), true);
  assert.equal(internalRequestStatusAfter("submitted", "approve"), "approved");
  assert.equal(internalRequestStatusAfter("approved", "fulfill"), "fulfilled");
  assert.equal(internalRequestStatusAfter("approved", "cancel"), "cancelled");
  assert.equal(canTransitionInternalRequest("submitted", "fulfill"), false);
  assert.equal(canTransitionInternalRequest("fulfilled", "cancel"), false);
  assert.equal(internalRequestStatusAfter("rejected", "approve"), null);
});

test("the request migration persists tenant-scoped lifecycle data", async () => {
  const [migration, tenantConstraints] = await Promise.all([
    readFile(
      new URL("../db/migrations/0039_internal_requests.sql", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../db/migrations/0042_internal_request_tenant_fks.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "internal_requests"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "internal_request_lines"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "internal_request_events"/);
  assert.match(migration, /"organization_id" uuid NOT NULL/g);
  assert.match(migration, /"due_at" > "starts_at"/);
  assert.match(migration, /"internal_request_line_id" uuid/);
  assert.match(migration, /'requests\.read', 'requests\.create', 'requests\.manage'/);
  assert.match(
    tenantConstraints,
    /FOREIGN KEY \("organization_id", "request_id"\)/,
  );
  assert.match(
    tenantConstraints,
    /FOREIGN KEY \("organization_id", "internal_request_line_id"\)/,
  );
});
