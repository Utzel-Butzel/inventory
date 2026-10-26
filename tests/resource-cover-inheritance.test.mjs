import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const url = process.env.VARIANT_TEST_DATABASE_URL;

test("variant covers fall back dynamically without inheriting editable files", { skip: !url }, async (t) => {
  process.env.DATABASE_URL = url;
  const { db } = await import("../lib/db.ts");
  const { eq } = await import("drizzle-orm");
  const { organizations, inventoryTypeDefinitions, relationTypeDefinitions, resources, resourceRelations, media, bomLines } = await import("../db/schema.ts");
  const { getResource, listResources, getResourceCovers } = await import("../lib/resources.ts");
  const { getStockDetail, getStockOverview } = await import("../lib/stock.ts");
  const { getBom } = await import("../lib/assemblies.ts");
  const { getResourceCoverMap } = await import("../lib/resource-covers.ts");
  const [org] = await db.insert(organizations).values({ name: "Cover inheritance test", slug: randomUUID() }).returning();
  t.after(async () => {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await globalThis.inventorySql?.end();
  });
  await db.insert(inventoryTypeDefinitions).values({ organizationId: org.id, key: "object", label: "Object" });
  await db.insert(relationTypeDefinitions).values({ organizationId: org.id, key: "variant_of", label: "Variant", inverseLabel: "Variants", allowManual: false, isSystem: true });
  const make = async (name) => (await db.insert(resources).values({ organizationId: org.id, name }).returning())[0].id;
  const primary = await make("Frame");
  const variant = await make("White frame");
  const unrelated = await make("Unrelated frame");
  await db.insert(resourceRelations).values({ organizationId: org.id, sourceResourceId: variant, targetResourceId: primary, relationTypeKey: "variant_of" });
  const upload = async (resourceId, kind = "image", position = 0) => (await db.insert(media).values({
    organizationId: org.id, resourceId, kind, position,
    storageKey: randomUUID(), url: "/test-media", name: "Test media",
    mimeType: kind === "image" ? "image/jpeg" : "application/pdf",
  }).returning())[0];

  assert.equal((await getResource(org.id, variant)).cover, null);
  const original = await upload(primary, "image", 5);
  const document = await upload(variant, "document");
  let result = await getResource(org.id, variant);
  assert.equal(result.cover.id, original.id);
  assert.equal(result.cover.resourceId, primary);
  assert.deepEqual(result.media.map((item) => item.id), [document.id]);
  assert.equal((await getResource(org.id, unrelated)).cover, null);
  for (const mediaMode of ["all", "cover"]) {
    const list = await listResources({ organizationId: org.id, mediaMode });
    assert.equal(list.resources.find((item) => item.id === variant).cover.id, original.id);
  }
  const summaries = await getResourceCovers(org.id, [variant, variant, primary, unrelated]);
  assert.equal(summaries.length, 2);
  assert.equal(summaries.find((item) => item.resourceId === variant).id, original.id);
  assert.equal((await getResourceCoverMap(randomUUID(), [variant, primary])).size, 0);
  assert.deepEqual(await getResourceCovers(org.id, []), []);

  const assembly = await make("Assembled display");
  await db.insert(bomLines).values({ organizationId: org.id, assemblyResourceId: assembly, componentResourceId: primary, slotKey: "frame", quantityPerAssembly: 1, position: 0 });
  const assertRelatedViews = async (imageId) => {
    const stock = await getStockDetail(org.id, variant);
    assert.equal(stock.resource.cover.id, imageId);
    assert.equal(stock.family.variants.find((item) => item.id === variant).cover.id, imageId);
    const overview = await getStockOverview(org.id);
    assert.equal(overview.items.find((item) => item.resourceId === variant).cover.id, imageId);
    const bom = await getBom(org.id, assembly);
    assert.equal(bom.components[0].choices.find((item) => item.resourceId === variant).cover.id, imageId);
  };
  await assertRelatedViews(original.id);
  const own = await upload(variant, "image", 20);
  assert.equal((await getResource(org.id, variant)).cover.id, own.id, "own image wins regardless of position");
  assert.equal((await getResourceCovers(org.id, [variant]))[0].id, own.id);
  await assertRelatedViews(own.id);
  const replacement = await upload(primary, "image", 1);
  assert.equal((await getResource(org.id, variant)).cover.id, own.id);
  await db.delete(media).where(eq(media.id, own.id));
  result = await getResource(org.id, variant);
  assert.equal(result.cover.id, replacement.id, "deleting own image restores current primary cover");
  assert.deepEqual(result.media.map((item) => item.id), [document.id]);
  await db.delete(media).where(eq(media.id, replacement.id));
  assert.equal((await getResource(org.id, variant)).cover.id, original.id);
  await db.delete(media).where(eq(media.id, original.id));
  assert.equal((await getResource(org.id, variant)).cover, null);
});
