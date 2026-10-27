import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Never connect to the application's database or load its env files here.
const url = process.env.STOCK_UNIT_TEST_DATABASE_URL;
test("serialized-unit deletion preserves database and ledger invariants", { skip: !url }, async (t) => {
  process.env.DATABASE_URL = url;
  const { and, eq, sql } = await import("drizzle-orm");
  const { db } = await import("../lib/db.ts");
  const { organizations, resources, stockSettings, stockUnits, stockMovements,
    stockCostLayers, stockCostAllocations, inventoryTypeDefinitions,
    orders, orderLines, orderLineUnits, inventoryAssignments, assemblyBuilds,
    assemblyBuildComponents } = await import("../db/schema.ts");
  const { createStockUnits, deleteStockUnit, updateStockUnit, deleteStockMovement } = await import("../lib/stock.ts");
  const { STOCK_UNIT_DELETE_LINKED } = await import("../lib/stock-unit-contract.ts");
  const actor = "unit-deletion-test";
  t.after(async () => { await globalThis.inventorySql?.end(); });

  async function fixture() {
    const [org] = await db.insert(organizations).values({ name: "Unit deletion test", slug: `delete-${randomUUID()}` }).returning();
    const organizationId = org.id;
    await db.insert(inventoryTypeDefinitions).values({ organizationId, key: "object", label: "Object" });
    const [resource] = await db.insert(resources).values({ organizationId, name: "Terra", quantity: 0, valueCents: 1200, currency: "EUR" }).returning();
    await db.insert(stockSettings).values({ organizationId, resourceId: resource.id, trackingMode: "serialized" })
      .onConflictDoUpdate({ target: stockSettings.resourceId, set: { trackingMode: "serialized" } });
    const created = await createStockUnits(organizationId, resource.id, { code: "Terra 1", totalPriceCents: 1200, priceCurrency: "EUR" }, actor);
    const unit = created.units[0];
    const rows = table => db.select().from(table).where(eq(table.organizationId, organizationId));
    const snapshot = async () => {
      const result = {};
      for (const table of ["resources", "stock_units", "stock_movements", "stock_cost_layers", "stock_cost_allocations", "webhook_events"]) {
        result[table] = await db.execute(sql`select to_jsonb(t) as row from ${sql.identifier(table)} t where organization_id = ${organizationId} order by id`);
      }
      return JSON.parse(JSON.stringify(result));
    };
    const remove = () => deleteStockUnit(organizationId, resource.id, unit.id, actor);
    return { organizationId, resource, unit, rows, snapshot, remove };
  }

  await t.test("available units are removed with stock, cost and immutable audit reconciled", async () => {
    const f = await fixture();
    const before = await f.rows(stockMovements);
    const opening = before.find(row => row.type === "unit-created");
    const result = await f.remove();
    assert.equal(result.deletedUnitId, f.unit.id);
    assert.equal(result.quantity, 0);
    assert.equal(result.movement.delta, -1);
    assert.equal(result.movement.type, "unit-deleted");
    assert.equal(result.movement.costCents, 1200);
    assert.ok(result.movement.note.includes(f.unit.code));
    assert.ok(result.movement.note.includes(f.unit.id));
    assert.equal(result.movement.unitId, undefined);
    assert.deepEqual(await f.rows(stockUnits), []);
    assert.equal((await f.rows(resources))[0].quantity, 0);
    const movements = await f.rows(stockMovements);
    assert.equal(movements.length, before.length + 1);
    assert.equal(movements.find(row => row.id === opening.id).delta, 1);
    assert.ok(movements.every(row => row.unitId === null));
    const [layer] = await f.rows(stockCostLayers);
    assert.equal(layer.remainingQuantity, 0);
    assert.equal(layer.remainingCostCents, 0);
    assert.equal(layer.initialCostCents, 1200);
    assert.equal((await f.rows(stockCostAllocations))[0].costCents, 1200);
    for (const movementId of [opening.id, result.movement.id]) {
      await assert.rejects(deleteStockMovement(f.organizationId, f.resource.id, movementId), error => error.status === 409);
    }
    const replacement = await createStockUnits(f.organizationId, f.resource.id, { code: f.unit.code }, actor);
    assert.notEqual(replacement.units[0].id, f.unit.id, "old QR identity must never point to the replacement");
  });

  await t.test("deleting an unavailable unit does not remove stock or cost a second time", async () => {
    const f = await fixture();
    await updateStockUnit(f.organizationId, f.resource.id, f.unit.id, { status: "lost" }, actor);
    const allocations = await f.rows(stockCostAllocations);
    const before = await f.rows(stockMovements);
    const result = await f.remove();
    assert.equal(result.quantity, 0);
    assert.equal(result.movement.delta, 0);
    assert.deepEqual(await f.rows(stockCostAllocations), allocations);
    assert.equal((await f.rows(stockMovements)).length, before.length + 1);
  });

  await t.test("concurrent duplicate deletion changes stock only once", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([f.remove(), f.remove()]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.status, 404);
    assert.equal((await f.rows(resources))[0].quantity, 0);
    assert.equal((await f.rows(stockMovements)).filter(row => row.type === "unit-deleted").length, 1);
  });

  await t.test("wrong organizations and items cannot delete a unit", async () => {
    const f = await fixture();
    const other = await fixture();
    const before = await f.snapshot();
    await assert.rejects(deleteStockUnit(other.organizationId, f.resource.id, f.unit.id, actor), error => error.status === 404);
    await assert.rejects(deleteStockUnit(f.organizationId, other.resource.id, f.unit.id, actor), error => error.status === 404);
    await assert.rejects(deleteStockUnit(f.organizationId, f.resource.id, other.unit.id, actor), error => error.status === 404);
    assert.deepEqual(await f.snapshot(), before);
  });

  await t.test("negative stock and bulk tracking are rejected without writes", async () => {
    for (const mode of ["negative", "bulk"]) {
      const f = await fixture();
      if (mode === "negative") await db.update(resources).set({ quantity: 0 }).where(eq(resources.id, f.resource.id));
      else await db.update(stockSettings).set({ trackingMode: "bulk" }).where(eq(stockSettings.resourceId, f.resource.id));
      const before = await f.snapshot();
      await assert.rejects(f.remove(), error => error.status === 409);
      assert.deepEqual(await f.snapshot(), before);
    }
  });

  await t.test("rollback restores unit, quantity, costs and history together", async () => {
    const f = await fixture();
    const before = await f.snapshot();
    await assert.rejects(db.transaction(async tx => {
      await deleteStockUnit(f.organizationId, f.resource.id, f.unit.id, actor, tx);
      throw new Error("rollback test");
    }), /rollback test/);
    assert.deepEqual(await f.snapshot(), before);
  });

  for (const link of ["order", "returned-assignment", "assembly-component", "assembly-output"]) {
    await t.test(`retains units with ${link} links`, async () => {
      const f = await fixture();
      const organizationId = f.organizationId;
      if (link === "order") {
        const [order] = await db.insert(orders).values({ organizationId, type: "sale", contactName: "Test", status: "returned" }).returning();
        const [line] = await db.insert(orderLines).values({ organizationId, orderId: order.id, resourceId: f.resource.id, orderedQuantity: 1, fulfilledQuantity: 1, returnedQuantity: 1 }).returning();
        await db.insert(orderLineUnits).values({ organizationId, orderLineId: line.id, stockUnitId: f.unit.id, status: "returned", reservedAt: new Date("2026-10-01"), fulfilledAt: new Date("2026-10-02"), returnedAt: new Date("2026-10-03") });
      } else if (link === "returned-assignment") {
        await db.insert(inventoryAssignments).values({ organizationId, resourceId: f.resource.id, stockUnitId: f.unit.id, kind: "checkout", status: "returned", assigneeLabel: "Test" });
      } else {
        const [build] = await db.insert(assemblyBuilds).values({ organizationId, assemblyResourceId: f.resource.id, quantity: 1, idempotencyKey: randomUUID(), requestHash: "0".repeat(64) }).returning();
        await db.insert(assemblyBuildComponents).values({ organizationId, buildId: build.id, componentResourceId: f.resource.id, componentName: "Test", quantityPerAssembly: 1, quantityConsumed: 1,
          ...(link === "assembly-output" ? { outputUnitId: f.unit.id } : { componentUnitId: f.unit.id }) });
      }
      const before = await f.snapshot();
      await assert.rejects(f.remove(), error => error.status === 409 && error.message === STOCK_UNIT_DELETE_LINKED);
      assert.deepEqual(await f.snapshot(), before);
      assert.equal((await db.select().from(stockUnits).where(and(eq(stockUnits.organizationId, organizationId), eq(stockUnits.id, f.unit.id)))).length, 1);
    });
  }
});
