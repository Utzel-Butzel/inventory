import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const url = process.env.VARIANT_TEST_DATABASE_URL;
test("automatic finished variants are sparse, reusable and transactional", { skip: !url }, async (t) => {
  process.env.DATABASE_URL = url;
  const { db } = await import("../lib/db.ts");
  const { eq, and, sql } = await import("drizzle-orm");
  const { organizations, inventoryTypeDefinitions, relationTypeDefinitions, resources, resourceRelations, bomLines, variantBomOverrides, stockSettings } = await import("../db/schema.ts");
  const { updateResource } = await import("../lib/resources.ts");
  const { buildAssembly, getBom, previewAssemblyConfiguration, customizeAssemblyConfiguration, replaceBom, resetVariantBomOverrides } = await import("../lib/assemblies.ts");
  const [org] = await db.insert(organizations).values({ name: "Automatic configurations", slug: randomUUID(), allowNegativeStock: false }).returning();
  const organizationId = org.id;
  t.after(async () => {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
    await globalThis.inventorySql?.end();
  });
  await db.insert(inventoryTypeDefinitions).values({ organizationId, key: "object", label: "Object" });
  await db.insert(relationTypeDefinitions).values({ organizationId, key: "variant_of", label: "Variant", inverseLabel: "Variants", allowManual: false, isSystem: true });
  const make = async (name, quantity = 20) => (await db.insert(resources).values({ organizationId, name, quantity }).returning())[0].id;
  const parent = await make("Paper", 0);
  const pcb = await make("PCB");
  const frame = await make("Black frame");
  const white = await make("White frame");
  const wood = await make("Wood frame", 0);
  const standard = await make("Standard display");
  const premium = await make("Premium display");
  await db.insert(resourceRelations).values([[white, frame], [wood, frame], [premium, standard]].map(([sourceResourceId, targetResourceId]) => ({ organizationId, sourceResourceId, targetResourceId, relationTypeKey: "variant_of" })));
  await db.insert(bomLines).values([["pcb", pcb], ["frame", frame], ["display", standard]].map(([slotKey, componentResourceId], position) => ({ organizationId, assemblyResourceId: parent, componentResourceId, slotKey, quantityPerAssembly: 1, position })));
  const selection = { frame: white, display: premium };
  const count = async () => Number((await db.select({ count: sql`count(*)` }).from(resources).where(eq(resources.organizationId, organizationId)))[0].count);
  const quantity = async (id) => (await db.select().from(resources).where(eq(resources.id, id)))[0].quantity;
  const build = (config, key = { key: randomUUID(), requestHash: "a".repeat(64) }, authorize = () => true) => buildAssembly(organizationId, parent, { quantity: 1, outputConfiguration: config }, "test", key, authorize);
  const initialCount = await count();
  await assert.rejects(buildAssembly(organizationId, parent, { quantity: 1 }, "test",
    { key: randomUUID(), requestHash: "d".repeat(64) }, () => true), /outputConfiguration/);
  const preview = await previewAssemblyConfiguration(organizationId, parent, selection, () => true);
  assert.equal(preview.existingResourceId, null);
  assert.deepEqual(new Set(preview.components.map((line) => line.resourceId)), new Set([pcb, white, premium]));
  assert.equal(preview.resource.quantity, 0);
  assert.equal(await count(), initialCount, "preview never creates any of the six combinations");
  await assert.rejects(build({ frame: wood, display: premium }), /only 0 are available/i);
  assert.equal(await count(), initialCount, "failed stock transaction rolls back variant creation");
  await assert.rejects(build({ frame: white }), /every variable/);
  await assert.rejects(build({ ...selection, arbitrary: pcb }), /every variable/);
  await assert.rejects(build({ ...selection, frame: pcb }), /every variable/);
  await assert.rejects(build(selection, undefined, (resource) => resource.id !== white), /valid|inaccessible/);
  assert.equal(await count(), initialCount);

  const key = { key: randomUUID(), requestHash: "b".repeat(64) };
  const results = await Promise.all([build(selection, key), build(selection, key)]);
  const outputId = results[0].response.resource.id;
  assert.equal(results[1].response.resource.id, outputId);
  assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(await count(), initialCount + 1);
  assert.equal(await quantity(outputId), 1);
  assert.equal(await quantity(parent), 0);
  assert.equal(await quantity(frame), 20);
  assert.equal(await quantity(standard), 20);
  assert.equal(await quantity(white), 19);
  assert.equal(await quantity(premium), 19);
  assert.equal(await quantity(pcb), 19);
  const ownBom = await db.select().from(bomLines).where(eq(bomLines.assemblyResourceId, outputId));
  const overrides = await db.select().from(variantBomOverrides).where(eq(variantBomOverrides.variantResourceId, outputId));
  assert.equal(ownBom.length, 0, "common BOM is inherited");
  assert.equal(overrides.length, 2, "only selected variable slots are persisted");

  // Customize the finished recipe without changing its configuration identity.
  const recipe = await getBom(organizationId, outputId);
  await replaceBom(organizationId, outputId, recipe.components.map((line) => ({ slotKey: line.slotKey, resourceId: line.resourceId, quantityPerAssembly: line.slotKey === "pcb" ? 2 : 1 })));
  await updateResource(organizationId, outputId, { description: "Manually customized" }, "test");
  const customized = await previewAssemblyConfiguration(organizationId, parent, selection, () => true);
  assert.equal(customized.existingResourceId, outputId);
  assert.equal(customized.components.find((line) => line.slotKey === "pcb").quantityPerAssembly, 2);
  await build(selection);
  assert.equal(await count(), initialCount + 1);
  assert.equal(await quantity(pcb), 17);
  assert.equal(await quantity(outputId), 2);

  // Adopt a pre-existing manually named article by its recipe, not its name.
  const manual = await make("Special naming", 0);
  await db.insert(resourceRelations).values({ organizationId, sourceResourceId: manual, targetResourceId: parent, relationTypeKey: "variant_of" });
  const baseSelection = { frame, display: standard };
  const manualPreview = await previewAssemblyConfiguration(organizationId, parent, baseSelection, () => true);
  assert.equal(manualPreview.existingResourceId, manual);
  assert.equal((await build(baseSelection)).response.resource.id, manual);
  const concurrent = await Promise.all([build({ frame: white, display: standard }), build({ frame: white, display: standard })]);
  assert.equal(concurrent[0].response.resource.id, concurrent[1].response.resource.id);
  assert.equal(await quantity(concurrent[0].response.resource.id), 2);
  const beforeCustomize = await count();
  const prepared = await customizeAssemblyConfiguration(organizationId, parent, { frame, display: premium }, "test", () => true);
  assert.equal(await count(), beforeCustomize + 1);
  assert.equal(await quantity(prepared.resourceId), 0);
  assert.equal((await customizeAssemblyConfiguration(organizationId, parent, { display: premium, frame }, "test", () => true)).resourceId, prepared.resourceId);
  assert.equal(await count(), beforeCustomize + 1);

  // Explicitly archived variants cannot be silently replaced with duplicates.
  await db.update(resources).set({ status: "archived" }).where(eq(resources.id, prepared.resourceId));
  await assert.rejects(build({ frame, display: premium }), /archived/);
  assert.equal(await count(), beforeCustomize + 1);

  const manualRecipe = await getBom(organizationId, manual);
  await replaceBom(organizationId, manual, manualRecipe.components.map((line) => ({
    slotKey: line.slotKey, resourceId: line.resourceId, quantityPerAssembly: line.quantityPerAssembly,
  })));
  const parentRecipe = await getBom(organizationId, parent);
  await replaceBom(organizationId, parent, parentRecipe.components.map((line) => ({
    slotKey: line.slotKey, resourceId: line.slotKey === "frame" ? white : line.resourceId, quantityPerAssembly: line.quantityPerAssembly,
  })));
  assert.equal((await getBom(organizationId, manual)).components.find((line) => line.slotKey === "frame").resourceId, frame,
    "default selection remains pinned after the primary recipe changes");
  await resetVariantBomOverrides(organizationId, outputId);
  const reset = await getBom(organizationId, outputId);
  assert.equal(reset.components.find((line) => line.slotKey === "pcb").quantityPerAssembly, 1);
  assert.equal(reset.components.find((line) => line.slotKey === "display").resourceId, premium,
    "reset removes custom changes but preserves the selected finished configuration");

  const siblingParent = await make("Sibling-based product", 0);
  await db.insert(bomLines).values({ organizationId, assemblyResourceId: siblingParent, componentResourceId: white, slotKey: "frame", quantityPerAssembly: 1 });
  const siblingPreview = await previewAssemblyConfiguration(organizationId, siblingParent, { frame }, () => true);
  assert.equal(siblingPreview.components[0].resourceId, frame);

  // A broad matrix is still represented by slots plus values, never its product.
  const largeParent = await make("Complex product", 0);
  const largeSelection = {};
  for (let i = 0; i < 8; i++) {
    const primary = await make(`Component ${i}`);
    const alternative = await make(`Alternative ${i}`);
    await db.insert(resourceRelations).values({ organizationId, sourceResourceId: alternative, targetResourceId: primary, relationTypeKey: "variant_of" });
    await db.insert(bomLines).values({ organizationId, assemblyResourceId: largeParent, componentResourceId: primary, slotKey: `slot${i}`, quantityPerAssembly: 1, position: i });
    largeSelection[`slot${i}`] = alternative;
  }
  const beforeLarge = await count();
  const large = await previewAssemblyConfiguration(organizationId, largeParent, largeSelection, () => true);
  assert.equal(large.components.length, 8);
  assert.equal(await count(), beforeLarge, "256 combinations require zero finished records");
  await db.update(stockSettings).set({ trackingMode: "serialized" }).where(and(eq(stockSettings.organizationId, organizationId), eq(stockSettings.resourceId, largeParent)));
  const serialized = await buildAssembly(organizationId, largeParent, { quantity: 1, outputConfiguration: largeSelection }, "test", { key: randomUUID(), requestHash: "c".repeat(64) }, () => true);
  assert.equal(serialized.response.outputUnits.length, 1);
  assert.equal(await count(), beforeLarge + 1);
});
