import assert from "node:assert/strict";
import test from "node:test";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { stockHttpError, updateStockUnit } from "../lib/stock.ts";
import { isStockUnitCodeConflict, STOCK_UNIT_CODE_CONFLICT, stockUnitCodeSchema } from "../lib/stock-unit-contract.ts";
import { labelTargetUrl } from "../lib/label-target.ts";
import { labelPlaceholderValues } from "../lib/label-rich-text.ts";

const resourceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const unitId = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
const previousDate = new Date("2026-10-01T12:00:00Z");
const duplicate = () => new Error("Failed query: update stock_units", {
  cause: Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "stock_units_resource_code_unique" }),
});

function fixture({ conflict = false, status = "available", missingUnit = false } = {}) {
  const resource = { id: resourceId, organizationId: "org", name: "Terra", sku: "TERRA", type: "tool", quantity: 3, currency: "EUR", valueCents: 1000, categories: [] };
  const unit = { id: unitId, organizationId: "org", resourceId, code: "STK-2F45-1234", status, location: null, locationResourceId: null, metadata: { fixture: true }, customFields: {}, acquisitionCostCents: 1000, costCurrency: "EUR", acquiredAt: previousDate, createdAt: previousDate, updatedAt: previousDate, lastMovedAt: previousDate };
  const writes = [];
  const locks = [];
  let savedUnit;
  let movement;
  const dialect = new PgDialect();
  const executor = { transaction: async run => run({
    select() {
      let table;
      return {
        from(value) { table = getTableName(value); return this; },
        where(condition) {
          if (table === "stock_units") {
            const query = dialect.sqlToQuery(condition);
            assert.deepEqual(query.params, ["org", unitId, resourceId]);
          }
          return this;
        },
        limit() { return this; },
        for(mode) { assert.equal(mode, "update"); locks.push(table); return this; },
        then(resolve, reject) {
          const rows = {
            resources: [resource], stock_settings: [{ trackingMode: "serialized" }],
            stock_units: missingUnit ? [] : [unit], stock_movements: movement ? [movement] : [], webhook_endpoints: [],
          };
          assert.ok(table in rows, `Unexpected read: ${table}`);
          return Promise.resolve(rows[table]).then(resolve, reject);
        },
      };
    },
    update(table) {
      const name = getTableName(table);
      return { set(value) {
        assert.deepEqual(locks, ["resources", "stock_units"]);
        assert.equal(Object.hasOwn(value, "id"), false);
        assert.equal(Object.hasOwn(value, "resourceId"), false);
        if (conflict && name === "stock_units") throw duplicate();
        writes.push({ table: name, value });
        if (name === "stock_units") savedUnit = { ...unit, ...value };
        return { where() { return { returning: async () => [savedUnit] }; } };
      } };
    },
    insert(table) {
      assert.equal(getTableName(table), "stock_movements");
      return { values(value) {
        writes.push({ table: "stock_movements", value });
        movement = { id: "movement", createdAt: new Date(), ...value };
        return { returning: async () => [movement] };
      } };
    },
  }) };
  return { resource, unit, writes, executor };
}

test("renaming replaces the generated identifier while preserving identity, stock and QR links", async () => {
  const f = fixture();
  const beforeUrl = labelTargetUrl("https://inventory.example", { ...f.resource, stockUnit: f.unit });
  const result = await updateStockUnit("org", resourceId, unitId, { code: "  Terra 1  ", note: "Asset marked" }, "actor", f.executor);
  assert.equal(result.unit.code, "Terra 1");
  assert.equal(result.unit.id, unitId);
  assert.equal(result.unit.resourceId, resourceId);
  assert.equal(result.resource.quantity, 3);
  assert.equal(result.unit.status, "available");
  assert.equal(result.unit.lastMovedAt, previousDate.toISOString());
  assert.deepEqual(result.unit.metadata, f.unit.metadata);
  assert.equal(result.unit.acquisitionCostCents, 1000);
  assert.equal(result.movement.delta, 0);
  assert.equal(result.movement.quantity, 0);
  assert.equal(result.movement.unitId, unitId);
  assert.equal(result.movement.note, "Asset marked\nUnit code changed from STK-2F45-1234 to Terra 1");
  const target = { ...f.resource, stockUnit: result.unit };
  assert.equal(labelTargetUrl("https://inventory.example", target), beforeUrl);
  assert.equal(labelPlaceholderValues(target, "https://inventory.example").Identifier, "Terra 1");
});

test("renaming an assigned unit leaves its status and stock unchanged", async () => {
  const f = fixture({ status: "in-use" });
  const result = await updateStockUnit("org", resourceId, unitId, { code: "Terra 1" }, "actor", f.executor);
  assert.equal(result.unit.status, "in-use");
  assert.equal(result.movement.delta, 0);
  assert.equal(result.resource.quantity, f.resource.quantity);
});

test("unrelated edits and re-saving the same code keep the identifier without a rename audit", async () => {
  for (const input of [{ metadata: { edited: true } }, { code: "STK-2F45-1234" }]) {
    const f = fixture();
    const result = await updateStockUnit("org", resourceId, unitId, input, "actor", f.executor);
    assert.equal(result.unit.code, f.unit.code);
    assert.equal(result.movement.note, "");
  }
});

test("invalid identifiers and unknown units fail before writing", async () => {
  for (const code of ["", "   ", "x".repeat(181)]) {
    const f = fixture();
    await assert.rejects(updateStockUnit("org", resourceId, unitId, { code }, "actor", f.executor), error => error.status === 422);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture({ missingUnit: true });
  await assert.rejects(updateStockUnit("org", resourceId, unitId, { code: "Terra 1" }, "actor", f.executor), error => error.status === 404);
  assert.equal(f.writes.length, 0);
});

test("a database uniqueness conflict returns 409 without recording a movement", async () => {
  const f = fixture({ conflict: true });
  await assert.rejects(updateStockUnit("org", resourceId, unitId, { code: "Terra 1" }, "actor", f.executor), error => {
    assert.deepEqual(stockHttpError(error, "fallback"), { status: 409, message: STOCK_UNIT_CODE_CONFLICT });
    return true;
  });
  assert.equal(f.writes.length, 0);
});

test("unit code validation accepts spaces and Unicode and rejects missing or excessive values", () => {
  assert.equal(stockUnitCodeSchema.parse("  Terra 1  "), "Terra 1");
  assert.equal(stockUnitCodeSchema.parse("Gerät 1"), "Gerät 1");
  assert.equal(stockUnitCodeSchema.parse("x".repeat(180)).length, 180);
  for (const code of [null, 42, "", "  ", "x".repeat(181)]) assert.equal(stockUnitCodeSchema.safeParse(code).success, false);
  assert.equal(isStockUnitCodeConflict(duplicate()), true);
  assert.equal(isStockUnitCodeConflict({ code: "23505", constraint_name: "other_unique" }), false);
  const cyclic = {}; cyclic.cause = cyclic;
  assert.equal(isStockUnitCodeConflict(cyclic), false);
});
