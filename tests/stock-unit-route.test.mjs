import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { STOCK_UNIT_CODE_CONFLICT, STOCK_UNIT_DELETE_LINKED } from "../lib/stock-unit-contract.ts";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const unitId = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
let calls;
let denied;
let conflict;
beforeEach(() => { calls = []; denied = false; conflict = false; });

mock.module("../lib/api-auth.ts", { namedExports: {
  requireResourcePermission: async (_request, permission, resourceId) => {
    assert.equal(permission, "stock.manage");
    assert.equal(resourceId, id);
    return denied ? { response: Response.json({}, { status: 403 }) } : { identity: { organizationId: "org", subject: "actor" } };
  },
} });
mock.module("../lib/stock.ts", { namedExports: {
  deleteStockUnit: async (...args) => {
    calls.push(args);
    if (conflict) throw new Error(STOCK_UNIT_DELETE_LINKED);
    return { deletedUnitId: unitId, quantity: 0 };
  },
  updateStockUnit: async (...args) => {
    calls.push(args);
    if (conflict) throw new Error(STOCK_UNIT_CODE_CONFLICT);
    return { unit: { id: unitId, resourceId: id, code: args[3].code } };
  },
  stockHttpError: error => ({ status: 409, message: error.message }),
} });
const { PATCH, DELETE } = await import("../app/api/v1/resources/[id]/stock/units/[unitId]/route.ts");
const patch = body => PATCH(new Request("http://localhost/unit", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id, unitId }) });
const remove = (params = { id, unitId }) => DELETE(new Request("http://localhost/unit", { method: "DELETE" }), { params: Promise.resolve(params) });

test("DELETE checks stock permission and scopes the removal to the actor's organization and item", async () => {
  assert.equal((await remove()).status, 200);
  assert.deepEqual(calls, [["org", id, unitId, "actor"]]);
  denied = true;
  assert.equal((await remove()).status, 403);
  assert.equal(calls.length, 1);
});

test("DELETE rejects invalid IDs and reports linked-unit conflicts", async () => {
  for (const params of [{ id: "bad", unitId }, { id, unitId: "bad" }]) {
    assert.equal((await remove(params)).status, 422);
  }
  assert.equal(calls.length, 0);
  conflict = true;
  const response = await remove();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, STOCK_UNIT_DELETE_LINKED);
});

test("PATCH accepts a code-only rename and passes its tenant, resource, unit and actor", async () => {
  const response = await patch({ code: "  Terra 1  " });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).unit.code, "Terra 1");
  assert.deepEqual(calls, [["org", id, unitId, { code: "Terra 1", occurredAt: undefined }, "actor"]]);
});

test("PATCH rejects empty, invalid and overlong identifiers before changing stock", async () => {
  for (const body of [{}, { code: "" }, { code: "   " }, { code: null }, { code: 1 }, { code: "x".repeat(181) }, { code: "Terra 1", id: unitId }]) {
    assert.equal((await patch(body)).status, 422);
  }
  assert.equal(calls.length, 0);
});

test("viewers cannot rename units and conflicts are returned to the editor", async () => {
  denied = true;
  assert.equal((await patch({ code: "Terra 1" })).status, 403);
  assert.equal(calls.length, 0);
  denied = false; conflict = true;
  const response = await patch({ code: "Terra 1" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, STOCK_UNIT_CODE_CONFLICT);
});
