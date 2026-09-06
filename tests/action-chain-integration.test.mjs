import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

// Deliberately never falls back to the application's DATABASE_URL or env files.
const url = process.env.ACTION_CHAIN_TEST_DATABASE_URL;
test("action chains preserve manufacturing and transaction invariants", { skip: !url }, async (t) => {
  process.env.DATABASE_URL = url;
  const { db } = await import("../lib/db.ts");
  const schema = await import("../db/schema.ts");
  const { eq, and, sql } = await import("drizzle-orm");
  const { runActionChain } = await import("../lib/action-chain-engine.ts");
  const { scanWorkflowCreateSchema } = await import("../lib/scan-workflow-contract.ts");
  const { createStockUnits } = await import("../lib/stock.ts");
  const { organizations, inventoryTypeDefinitions, relationTypeDefinitions, resources, resourceRelations, stockSettings, stockUnits, bomLines, stockScanWorkflows, stockScanExecutions } = schema;
  const actor = "action-chain-integration";
  const literal = (value) => ({ source: "literal", value });
  const scan = { source: "scan", field: "identifier" };
  const common = (id, type) => ({ id, label: id, type, enabled: true, when: null });
  const find = (resourceId) => ({ ...common("pcb", "find-unit"), target: { source: "resource", resourceId }, code: scan, allowMissing: false });
  const adjustment = (resourceId) => ({ ...common("book", "stock-adjustment"), target: { source: "resource", resourceId }, delta: literal(-1), factor: 1 });
  const webhook = { ...common("notify", "webhook"), eventName: "frame.completed", properties: [] };
  const fail = { ...common("quality", "assert"), message: "Quality check failed", check: { mode: "all", rules: [{ left: literal(false), operator: "equals", right: literal(true) }] } };
  async function fixture() {
    const [org] = await db.insert(organizations).values({ name: "Action chain test", slug: `chain-${randomUUID()}` }).returning();
    const organizationId = org.id;
    await db.insert(inventoryTypeDefinitions).values({ organizationId, key: "object", label: "Object" });
    await db.insert(relationTypeDefinitions).values({ organizationId, key: "variant_of", label: "Variant", inverseLabel: "Variant" });
    const make = async (name, quantity, trackingMode = "bulk") => {
      const [resource] = await db.insert(resources).values({ organizationId, name, quantity }).returning();
      await db.update(stockSettings).set({ trackingMode }).where(eq(stockSettings.resourceId, resource.id));
      return resource.id;
    };
    const pcb = await make("PCB", 0, "serialized");
    const frame = await make("OpenPaper 7", 0, "serialized");
    const shell = await make("Frame shell", 0);
    const black = await make("Black shell", 5);
    const white = await make("White shell", 5);
    await db.insert(resourceRelations).values([black, white].map((id) => ({ organizationId, sourceResourceId: id, targetResourceId: shell, relationTypeKey: "variant_of" })));
    await db.insert(bomLines).values([{ organizationId, assemblyResourceId: frame, componentResourceId: pcb, slotKey: "pcb-slot", quantityPerAssembly: 1 }, { organizationId, assemblyResourceId: frame, componentResourceId: shell, slotKey: "shell-slot", quantityPerAssembly: 1, position: 1 }]);
    await createStockUnits(organizationId, pcb, { code: "PCB-other" }, actor);
    const created = await createStockUnits(organizationId, pcb, { code: "PCB-123", metadata: { serial: "board-123" } }, actor);
    const build = { ...common("build", "assembly-build"), target: { source: "selected" }, code: scan, quantity: literal(1), properties: [{ key: "boardSerial", storage: "metadata", value: { source: "result", actionId: "pcb", path: "metadata.serial" } }], applyFlowValues: true, components: [{ slotKey: "pcb-slot", unitFromAction: "pcb" }, { slotKey: "shell-slot", choice: { inputKey: "color", resources: { black, white } } }] };
    const saveFlow = async (actions, extras = {}) => {
      const data = scanWorkflowCreateSchema.parse({ name: "Assemble frame", resourceId: frame, resourceIds: [frame], extraction: { mode: "full" }, identifierPropertyKey: "serial", identifierStorage: "metadata", actions, oncePerCode: true, inputFields: [{ key: "color", label: "Color", type: "select", storage: "metadata", required: true, options: [{ value: "black", label: "Black" }, { value: "white", label: "White" }] }], ...extras });
      const [workflow] = await db.insert(stockScanWorkflows).values({ ...data, organizationId }).returning();
      return workflow;
    };
    const input = (workflow, extras = {}) => ({ workflowId: workflow.id, code: "PCB-123", inputs: { color: "black" }, selectedResourceIds: [frame], ...extras });
    const snapshot = async () => {
      const result = {};
      for (const table of ["resources", "stock_units", "stock_movements", "assembly_builds", "assembly_build_components", "webhook_events", "stock_scan_executions"]) {
        // Table names are fixed above, and organizationId is bound as a value.
        result[table] = await db.execute(sql`select to_jsonb(t) as row from ${sql.identifier(table)} t where organization_id = ${organizationId} order by id`);
      }
      return JSON.parse(JSON.stringify(result));
    };
    return { organizationId, pcb, frame, black, white, boardId: created.units[0].id, build, saveFlow, input, snapshot };
  }
  t.after(async () => { await globalThis.inventorySql?.end(); });
    await t.test("preview rolls back; exact PCB and selected color are consumed on confirmation", async () => {
      const f = await fixture();
      const workflow = await f.saveFlow([find(f.pcb), f.build, webhook]);
      const before = await f.snapshot();
      const preview = await runActionChain(f.input(workflow), f.organizationId, { actor }, true);
      assert.deepEqual(await f.snapshot(), before);
      assert.equal(preview.steps[1].quantityAfter, 1);
      assert.ok(preview.steps[1].components.some((item) => item.codes.includes("PCB-123")));
      const request = f.input(workflow, { expectedPlanHash: preview.planHash });
      const identity = { actor, key: randomUUID() };
      const result = await runActionChain(request, f.organizationId, identity, false);
      assert.equal(result.steps.length, 3);
      const units = await db.select().from(stockUnits).where(eq(stockUnits.organizationId, f.organizationId));
      assert.equal(units.find((unit) => unit.id === f.boardId).status, "in-use");
      assert.equal(units.find((unit) => unit.code === "PCB-other").status, "available");
      const output = units.find((unit) => unit.resourceId === f.frame);
      assert.equal(output.code, "PCB-123");
      assert.equal(output.metadata.serial, "PCB-123");
      assert.equal(output.metadata.color, "black");
      assert.equal(output.metadata.boardSerial, "board-123");
      assert.ok(output.metadata.assemblyBuildId);
      const [black] = await db.select().from(resources).where(eq(resources.id, f.black));
      const [white] = await db.select().from(resources).where(eq(resources.id, f.white));
      assert.equal(black.quantity, 4); assert.equal(white.quantity, 5);
      const after = await f.snapshot();
      assert.equal((await runActionChain(request, f.organizationId, identity, false)).replayed, true);
      assert.equal((await runActionChain(request, f.organizationId, { actor, key: randomUUID() }, false)).replayed, true);
      assert.deepEqual(await f.snapshot(), after);
      await assert.rejects(runActionChain({ ...request, code: "other" }, f.organizationId, identity, false), /Ausführungsschlüssel/);
    });
    await t.test("a later failed assertion rolls back builds, movements, units, events and execution", async () => {
      const f = await fixture();
      const workflow = await f.saveFlow([find(f.pcb), f.build, webhook, fail]);
      const before = await f.snapshot();
      await assert.rejects(runActionChain(f.input(workflow), f.organizationId, { actor }, true), /Quality check failed/);
      assert.deepEqual(await f.snapshot(), before);
      // Preview a passing condition, then fail the same condition at execution
      // through an action result that is only created by the actual build.
      const [passing] = await db.update(stockScanWorkflows).set({ actions: [find(f.pcb), f.build, webhook] }).where(eq(stockScanWorkflows.id, workflow.id)).returning();
      const plan = await runActionChain(f.input(passing), f.organizationId, { actor }, true);
      // Deliberately keep the revision to exercise rollback *inside* execute.
      // Normal API edits always increment revision and fail the stale-plan check.
      await db.update(stockScanWorkflows).set({ actions: [find(f.pcb), f.build, webhook, fail] }).where(eq(stockScanWorkflows.id, workflow.id));
      await assert.rejects(runActionChain(f.input(workflow, { expectedPlanHash: plan.planHash }), f.organizationId, { actor, key: randomUUID() }, false), /Quality check failed/);
      assert.deepEqual(await f.snapshot(), before);
    });
    await t.test("stock changes invalidate confirmation", async () => {
      const f = await fixture(); const workflow = await f.saveFlow([adjustment(f.black)]);
      const preview = await runActionChain(f.input(workflow), f.organizationId, { actor }, true);
      await db.update(resources).set({ quantity: 3, updatedAt: new Date() }).where(eq(resources.id, f.black));
      await assert.rejects(runActionChain(f.input(workflow, { expectedPlanHash: preview.planHash }), f.organizationId, { actor, key: randomUUID() }, false), /Vorschau erneut/);
      assert.equal((await db.select().from(resources).where(eq(resources.id, f.black)))[0].quantity, 3);
    });
    await t.test("missing optional lookup can branch and hidden required inputs are ignored", async () => {
      const f = await fixture();
      const lookup = { ...find(f.pcb), allowMissing: true, code: literal("unknown") };
      const condition = { mode: "all", rules: [{ left: { source: "result", actionId: "pcb", path: "found" }, operator: "equals", right: literal(false) }] };
      const workflow = await f.saveFlow([lookup, { ...adjustment(f.black), when: condition }], { inputFields: [{ key: "detail", label: "Hidden", type: "text", storage: "execution", required: true, visibleWhen: { mode: "all", rules: [{ left: scan, operator: "equals", right: literal("show") }] } }] });
      const plan = await runActionChain(f.input(workflow, { inputs: {} }), f.organizationId, { actor }, true);
      assert.equal(plan.steps[1].quantityAfter, 4);
      assert.equal(plan.steps[1].skipped, false);
    });
    await t.test("foreign organization targets and disabled public triggers cannot be used", async () => {
      const f = await fixture(); const foreign = await fixture();
      const workflow = await f.saveFlow([adjustment(foreign.black)]);
      await assert.rejects(runActionChain(f.input(workflow), f.organizationId, { actor }, true), /nicht verfügbar/);
      await assert.rejects(runActionChain(f.input(workflow), f.organizationId, { actor, publicTriggerId: workflow.publicTriggerId }, true), /public|Public/);
      assert.equal((await db.select().from(stockScanExecutions).where(and(eq(stockScanExecutions.organizationId, f.organizationId), eq(stockScanExecutions.workflowId, workflow.id)))).length, 0);
    });
    await t.test("simultaneous confirmations with different keys execute only once", async () => {
      const f = await fixture(); const workflow = await f.saveFlow([adjustment(f.black)]);
      const preview = await runActionChain(f.input(workflow), f.organizationId, { actor }, true);
      const request = f.input(workflow, { expectedPlanHash: preview.planHash });
      const results = await Promise.all([1, 2].map(() => runActionChain(request, f.organizationId, { actor, key: randomUUID() }, false)));
      assert.equal(results.filter((result) => result.replayed).length, 1);
      assert.equal((await db.select().from(resources).where(eq(resources.id, f.black)))[0].quantity, 4);
    });
    await t.test("unit updates and locations reuse the exact result of the lookup", async () => {
      const f = await fixture();
      const update = { ...common("update", "unit"), target: { source: "result", actionId: "pcb" }, code: literal("wrong-code-must-be-ignored"), mode: "update", status: "maintenance", applyFlowValues: false, properties: [{ key: "tested", storage: "metadata", value: literal(true) }] };
      const location = { ...common("move", "set-location"), target: { source: "result", actionId: "update" }, location: literal("Assembly bench"), structured: false };
      const workflow = await f.saveFlow([find(f.pcb), update, location]);
      const plan = await runActionChain(f.input(workflow), f.organizationId, { actor }, true);
      assert.equal(plan.steps[2].locationAfter, "Assembly bench");
      await runActionChain(f.input(workflow, { expectedPlanHash: plan.planHash }), f.organizationId, { actor, key: randomUUID() }, false);
      const [unit] = await db.select().from(stockUnits).where(eq(stockUnits.id, f.boardId));
      assert.equal(unit.status, "maintenance"); assert.equal(unit.location, "Assembly bench");
      assert.equal(unit.metadata.tested, true); assert.equal(unit.metadata.serial, "board-123");
    });
    await t.test("a missing optional lookup can create a unit and disabled steps are skipped", async () => {
      const f = await fixture();
      const lookup = { ...find(f.pcb), allowMissing: true, code: literal("new-board") };
      const create = { ...common("create", "unit"), target: { source: "result", actionId: "pcb" }, mode: "create", applyFlowValues: false, when: { mode: "all", rules: [{ left: { source: "result", actionId: "pcb", path: "found" }, operator: "equals", right: literal(false) }] } };
      const storeId = { ...common("store-id", "unit"), target: { source: "result", actionId: "create" }, mode: "update", applyFlowValues: false, properties: [{ key: "selfId", storage: "metadata", value: { source: "result", actionId: "create", path: "unitId" } }] };
      const workflow = await f.saveFlow([lookup, create, { ...fail, enabled: false }, storeId]);
      const plan = await runActionChain(f.input(workflow), f.organizationId, { actor }, true);
      assert.equal(plan.steps[2].skipped, true);
      await runActionChain(f.input(workflow, { expectedPlanHash: plan.planHash }), f.organizationId, { actor, key: randomUUID() }, false);
      const [unit] = await db.select().from(stockUnits).where(and(eq(stockUnits.resourceId, f.pcb), eq(stockUnits.code, "new-board")));
      assert.ok(unit);
      assert.equal(plan.steps[3].metadata.selfId, unit.id);
      assert.equal(unit.metadata.selfId, unit.id);
    });
    await t.test("public execution respects read-only organizations", async () => {
      const f = await fixture(); const workflow = await f.saveFlow([adjustment(f.black)], { publicTriggerEnabled: true });
      const identity = { actor, publicTriggerId: workflow.publicTriggerId };
      const plan = await runActionChain(f.input(workflow), f.organizationId, identity, true);
      await db.update(organizations).set({ isReadOnly: true }).where(eq(organizations.id, f.organizationId));
      await assert.rejects(runActionChain(f.input(workflow, { expectedPlanHash: plan.planHash }), f.organizationId, { ...identity, key: randomUUID() }, false), /keine Änderungen/);
    });
    await t.test("structured location names are previewed and switching to free text clears the old relation", async () => {
      const f = await fixture();
      await db.update(inventoryTypeDefinitions).set({ canContain: true }).where(eq(inventoryTypeDefinitions.organizationId, f.organizationId));
      const [place] = await db.insert(resources).values({ organizationId: f.organizationId, name: "Assembly shelf" }).returning();
      const structured = { ...common("shelf", "set-location"), target: { source: "result", actionId: "pcb" }, structured: true, location: literal(place.id) };
      const free = { ...common("bench", "set-location"), target: { source: "result", actionId: "shelf" }, structured: false, location: literal("Bench 2") };
      const workflow = await f.saveFlow([find(f.pcb), structured, free]);
      const plan = await runActionChain(f.input(workflow), f.organizationId, { actor }, true);
      assert.equal(plan.steps[1].locationAfter, "Assembly shelf");
      assert.equal(plan.steps[2].locationBefore, "Assembly shelf");
      assert.equal(plan.steps[2].locationAfter, "Bench 2");
      await runActionChain(f.input(workflow, { expectedPlanHash: plan.planHash }), f.organizationId, { actor, key: randomUUID() }, false);
      const [unit] = await db.select().from(stockUnits).where(eq(stockUnits.id, f.boardId));
      assert.equal(unit.locationResourceId, null); assert.equal(unit.location, "Bench 2");
    });
});
