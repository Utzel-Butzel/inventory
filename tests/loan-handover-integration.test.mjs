import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Never use the application's database or load its .env files for integration tests.
const url = process.env.HANDOVER_TEST_DATABASE_URL;
test("documented loans preserve stock, history and tenant isolation", { skip: !url }, async (t) => {
  process.env.DATABASE_URL = url;
  const { db } = await import("../lib/db.ts");
  const { organizations, inventoryTypeDefinitions, resources, resourceLendingSettings, stockSettings, stockUnits, loanHandovers, inventoryAssignments, stockMovements, orders, orderLines } = await import("../db/schema.ts");
  const { createInventoryAssignment, completeInventoryAssignment, activateInventoryReservation } = await import("../lib/inventory-assignments.ts");
  const { getLoanHandovers } = await import("../lib/loan-handovers.ts");
  const { executeOrderLineMovement, executeOrderLineUnitAction, updateOrder } = await import("../lib/orders.ts");
  const { getOrderLoanHandovers } = await import("../lib/order-loan-handovers.ts");
  const { hashIdempotentPayload } = await import("../lib/idempotency.ts");
  const { eq, and } = await import("drizzle-orm");
  const actor = "handover-test";
  const handover = { condition: "good", notes: "", accessories: [{ name: "Charger", present: true }], photos: [], givenBy: "Anna", receivedBy: "Ben", confirmed: true };
  const identity = (payload) => ({ key: randomUUID(), requestHash: hashIdempotentPayload(payload) });
  async function fixture(serialized = false) {
    const [org] = await db.insert(organizations).values({ name: "Handover test", slug: `handover-${randomUUID()}` }).returning();
    await db.insert(inventoryTypeDefinitions).values({ organizationId: org.id, key: "object", label: "Object" });
    const [resource] = await db.insert(resources).values({ organizationId: org.id, name: "Camera", quantity: 1 }).returning();
    await db.insert(resourceLendingSettings).values({ organizationId: org.id, resourceId: resource.id, enabled: true });
    let unit;
    if (serialized) {
      await db.update(stockSettings).set({ trackingMode: "serialized" }).where(eq(stockSettings.resourceId, resource.id));
      [unit] = await db.insert(stockUnits).values({ organizationId: org.id, resourceId: resource.id, code: "CAM-123" }).returning();
    }
    const input = { kind: "checkout", quantity: 1, recipient: { type: "label", label: "Ben" }, startsAt: new Date(), dueAt: new Date(Date.now() + 86_400_000), ...(unit ? { stockUnitId: unit.id } : {}), handover };
    const stock = async () => (await db.select().from(resources).where(eq(resources.id, resource.id)))[0].quantity;
    return { org: org.id, resource: resource.id, input, unit, stock };
  }
  t.after(async () => { await globalThis.inventorySql?.end(); });

  for (const serialized of [false, true]) await t.test(`checkout and return are atomic and idempotent (${serialized ? "serialized" : "bulk"})`, async () => {
    const f = await fixture(serialized); const key = identity(f.input);
    const [created, replayed] = await Promise.all([0, 1].map(() => createInventoryAssignment(f.org, f.resource, f.input, actor, key)));
    assert.equal(Number(created.replayed) + Number(replayed.replayed), 1);
    const id = created.response.assignment.id;
    assert.ok(created.response.assignment.checkoutDocumentedAt);
    assert.equal(await f.stock(), 0);
    const original = await getLoanHandovers(f.org, id);
    assert.equal(original.length, 1); assert.equal(original[0].borrower, "Ben");
    assert.equal(original[0].unitCode, serialized ? "CAM-123" : null);
    await db.update(resources).set({ name: "Renamed camera" }).where(eq(resources.id, f.resource));
    assert.equal((await getLoanHandovers(f.org, id))[0].resourceName, "Camera");
    const other = await fixture();
    assert.deepEqual(await getLoanHandovers(other.org, id), []);
    await assert.rejects(completeInventoryAssignment(other.org, id, { status: "returned", handover }, actor, identity({})), /not found/);
    for (const input of [{ status: "cancelled" }, { status: "returned" }, { status: "returned", handover: { ...handover, accessories: [] } }]) {
      await assert.rejects(completeInventoryAssignment(f.org, id, input, actor, identity(input)));
      assert.equal(await f.stock(), 0);
      assert.deepEqual(await getLoanHandovers(f.org, id), original);
    }
    const input = { status: "returned", handover: { ...handover, givenBy: "Ben", receivedBy: "Anna", condition: "worn", notes: "Small scratch", accessories: [{ name: "Charger", present: false }] } };
    const returnKey = identity(input);
    const results = await Promise.all([0, 1].map(() => completeInventoryAssignment(f.org, id, input, actor, returnKey)));
    assert.equal(results.filter((result) => result.replayed).length, 1);
    assert.equal(await f.stock(), 1);
    const documents = await getLoanHandovers(f.org, id);
    assert.equal(documents.length, 2); assert.deepEqual(documents[0], original[0]);
    assert.equal(documents[1].accessories[0].present, false);
    assert.equal((await db.select().from(stockMovements).where(eq(stockMovements.resourceId, f.resource))).filter((row) => row.type.startsWith("assignment-")).length, 2);
    await assert.rejects(completeInventoryAssignment(f.org, id, input, actor, identity(input)), /already returned/);
  });

  await t.test("reservation checkout saves a report once and then requires a documented return", async () => {
    const f = await fixture();
    const input = { ...f.input, kind: "reservation", startsAt: new Date(Date.now() + 3600_000), handover: undefined };
    const result = await createInventoryAssignment(f.org, f.resource, input, actor, identity(input));
    assert.equal(await f.stock(), 1);
    const key = identity(handover);
    const result2 = await activateInventoryReservation(f.org, result.response.assignment.id, { handover }, actor, key);
    assert.ok(result2.response.assignment.checkoutDocumentedAt);
    assert.equal(await f.stock(), 0);
    assert.equal((await activateInventoryReservation(f.org, result.response.assignment.id, { handover }, actor, key)).replayed, true);
  });

  await t.test("legacy loans remain returnable; bad photos and forbidden report kinds do not book stock", async () => {
    const f = await fixture();
    for (const input of [{ ...f.input, handover: { ...handover, photos: ["data:image/png;base64,bm90YW5pbWFnZQ=="] } }, { ...f.input, kind: "reservation" }]) {
      await assert.rejects(createInventoryAssignment(f.org, f.resource, input, actor, identity(input)));
      assert.equal(await f.stock(), 1);
      assert.equal((await db.select().from(inventoryAssignments).where(eq(inventoryAssignments.resourceId, f.resource))).length, 0);
    }
    const input = { ...f.input, handover: undefined };
    const result = await createInventoryAssignment(f.org, f.resource, input, actor, identity(input));
    await completeInventoryAssignment(f.org, result.response.assignment.id, { status: "returned" }, actor, identity({ status: "returned" }));
    assert.equal(await f.stock(), 1);
    assert.equal((await db.select().from(loanHandovers).where(and(eq(loanHandovers.organizationId, f.org), eq(loanHandovers.assignmentId, result.response.assignment.id)))).length, 0);
  });
  for (const serialized of [false, true]) await t.test(`order-based loans document issues and partial returns (${serialized ? "serialized" : "bulk"})`, async () => {
    const f = await fixture(serialized);
    if (!serialized) await db.update(resources).set({ quantity: 3 }).where(eq(resources.id, f.resource));
    const [order] = await db.insert(orders).values({ organizationId: f.org, type: "loan", contactName: "Ben", status: "reserved", expectedAt: new Date(Date.now() + 86_400_000) }).returning();
    const [line] = await db.insert(orderLines).values({ organizationId: f.org, orderId: order.id, resourceId: f.resource, orderedQuantity: serialized ? 1 : 3 }).returning();
    const execute = async (action, evidence, quantity = 1, key = identity({ action, evidence, quantity })) => serialized
      ? executeOrderLineUnitAction(f.org, order.id, line.id, { action, unitIds: [f.unit.id], handover: evidence }, actor)
      : executeOrderLineMovement(f.org, order.id, line.id, { action, quantity, handover: evidence }, actor, key);
    const issueQuantity = serialized ? 1 : 2;
    const key = identity({ issue: true });
    await execute("issue", handover, issueQuantity, key);
    assert.equal(await f.stock(), serialized ? 0 : 1);
    if (!serialized) {
      assert.equal((await execute("issue", handover, issueQuantity, key)).replayed, true);
    }
    const original = await getOrderLoanHandovers(f.org, line.id);
    assert.equal(original.length, 1);
    if (!serialized) {
      const oversized = { ...handover, accessories: Array.from({ length: 30 }, (_, index) => ({ name: `Accessory ${index}`, present: true })) };
      await assert.rejects(execute("issue", oversized), /at most 30 distinct accessories/);
      assert.equal(await f.stock(), 1);
      assert.deepEqual(await getOrderLoanHandovers(f.org, line.id), original);
    }
    assert.equal(original[0].orderId, order.id);
    assert.equal(original[0].quantity, issueQuantity);
    assert.equal(original[0].unitCode, serialized ? "CAM-123" : null);
    const other = await fixture();
    assert.deepEqual(await getOrderLoanHandovers(other.org, line.id), []);
    await assert.rejects(updateOrder(f.org, order.id, { status: "cancelled" }, actor), /Return documented/);
    for (const evidence of [undefined, { ...handover, accessories: [] }]) {
      await assert.rejects(execute("return", evidence));
      assert.deepEqual(await getOrderLoanHandovers(f.org, line.id), original);
      assert.equal(await f.stock(), serialized ? 0 : 1);
      if (serialized) assert.equal((await db.select().from(stockUnits).where(eq(stockUnits.id, f.unit.id)))[0].status, "in-use");
    }
    await execute("return", { ...handover, givenBy: "Ben", receivedBy: "Anna" });
    assert.equal(await f.stock(), serialized ? 1 : 2);
    const reports = await getOrderLoanHandovers(f.org, line.id);
    assert.equal(reports.length, 2);
    assert.deepEqual(reports[0], original[0]);
    assert.equal(reports[1].quantity, 1);
    if (!serialized) {
      await execute("return", handover);
      assert.equal(await f.stock(), 3);
      assert.equal((await getOrderLoanHandovers(f.org, line.id)).length, 3);
    }
  });

});
