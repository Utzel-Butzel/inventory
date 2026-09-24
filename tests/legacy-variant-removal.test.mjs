import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import YAML from "yaml";

test("the public API exposes one variant model and all schema references resolve", async () => {
  const api = YAML.parse(
    await readFile(new URL("../public/openapi.yaml", import.meta.url), "utf8"),
  );
  assert.ok(api.paths["/resources/{id}/family"]);
  assert.ok(api.paths["/resources/{id}/stock/builds"]);
  assert.ok(api.paths["/resources/{id}/stock/movements"]);
  assert.equal(api.paths["/resources/{id}/variants"], undefined);
  assert.equal(api.components.schemas.ResourceVariant, undefined);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.$ref?.startsWith("#/")) {
      const target = value.$ref
        .slice(2)
        .split("/")
        .reduce((node, key) => node?.[key], api);
      assert.ok(target, `Unresolved API reference: ${value.$ref}`);
    }
    Object.values(value).forEach(visit);
  };
  visit(api);
});

// Never load .env or use the application's database for integration tests.
const url = process.env.VARIANT_TEST_DATABASE_URL;
test(
  "family variants build, resolve and book independently after schema cleanup",
  { skip: !url },
  async (t) => {
    process.env.DATABASE_URL = url;
    const { db } = await import("../lib/db.ts");
    const { eq, sql } = await import("drizzle-orm");
    const {
      apiTokens,
      organizations,
      inventoryTypeDefinitions,
      relationTypeDefinitions,
      resources,
      resourceRelations,
      stockMovements,
      bomLines,
      variantBomOverrides,
    } = await import("../db/schema.ts");
    const { buildAssembly } = await import("../lib/assemblies.ts");
    const { bookStockMovement, getStockDetail } =
      await import("../lib/stock.ts");
    const { getResourceFamily } = await import("../lib/resource-families.ts");
    const { lookupResourceByCode } = await import("../lib/resource-lookup.ts");
    t.after(async () => {
      await globalThis.inventorySql?.end();
    });

    const [absence] = await db.execute(
      sql`select to_regclass('public.resource_variants') as relation`,
    );
    assert.equal(absence.relation, null);
    const columns = await db.execute(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('order_lines', 'stock_movements', 'woocommerce_order_line_syncs') and column_name in ('variant_id', 'variant_delta', 'variant_balance_after')`,
    );
    assert.equal(columns.length, 0);

    const [org] = await db
      .insert(organizations)
      .values({
        name: "Variant removal test",
        slug: `variants-${randomUUID()}`,
        allowNegativeStock: false,
      })
      .returning();
    const organizationId = org.id;
    await db
      .insert(inventoryTypeDefinitions)
      .values({ organizationId, key: "object", label: "Object" });
    await db
      .insert(relationTypeDefinitions)
      .values({
        organizationId,
        key: "variant_of",
        label: "Variant",
        inverseLabel: "Variants",
        allowManual: false,
        isSystem: true,
      });
    const make = async (name, quantity, sku = null, barcode = null) => {
      const [resource] = await db
        .insert(resources)
        .values({ organizationId, name, quantity, sku, barcode })
        .returning();
      return resource.id;
    };
    const primary = await make("OpenPaper L", 2);
    const white = await make("OpenPaper L white", 0, "OP-WHITE", "WHITE-CODE");
    const black = await make("OpenPaper L black", 0, "OP-BLACK");
    const pcb = await make("PCB", 10);
    const whiteFrame = await make("White frame", 10);
    const blackFrame = await make("Black frame", 10);
    await db
      .insert(resourceRelations)
      .values(
        [white, black].map((id) => ({
          organizationId,
          sourceResourceId: id,
          targetResourceId: primary,
          relationTypeKey: "variant_of",
        })),
      );
    await db.insert(bomLines).values([
      {
        organizationId,
        assemblyResourceId: primary,
        componentResourceId: pcb,
        slotKey: "pcb",
        quantityPerAssembly: 1,
      },
      {
        organizationId,
        assemblyResourceId: primary,
        componentResourceId: blackFrame,
        slotKey: "frame",
        quantityPerAssembly: 1,
        position: 1,
      },
    ]);
    await db
      .insert(variantBomOverrides)
      .values({
        organizationId,
        variantResourceId: white,
        slotKey: "frame",
        componentResourceId: whiteFrame,
        quantityPerAssembly: 1,
        quantityUnit: "base",
        position: 1,
      });
    const quantity = async (id) => {
      const [row] = await db
        .select()
        .from(resources)
        .where(eq(resources.id, id));
      return row.quantity;
    };
    const buildKey = { key: randomUUID(), requestHash: "a".repeat(64) };
    await buildAssembly(
      organizationId,
      white,
      { quantity: 1 },
      "test",
      buildKey,
      () => true,
    );
    assert.equal(
      (
        await buildAssembly(
          organizationId,
          white,
          { quantity: 1 },
          "test",
          buildKey,
          () => true,
        )
      ).replayed,
      true,
    );
    assert.deepEqual(
      await Promise.all(
        [primary, white, black, pcb, whiteFrame, blackFrame].map(quantity),
      ),
      [2, 1, 0, 9, 9, 10],
    );
    assert.equal(
      (await getResourceFamily(organizationId, primary)).summary.totalQuantity,
      3,
    );
    for (const code of [white, "OP-WHITE", "WHITE-CODE"]) {
      const match = await lookupResourceByCode(organizationId, code);
      assert.equal(match.resource.id, white);
      assert.equal("variant" in match, false);
    }

    const issue = { delta: -1, type: "issue", note: "Order #1234" };
    const issueKey = { key: randomUUID(), requestHash: "b".repeat(64) };
    await bookStockMovement(organizationId, white, issue, "test", issueKey);
    assert.equal(
      (await bookStockMovement(organizationId, white, issue, "test", issueKey))
        .replayed,
      true,
    );
    assert.deepEqual(
      await Promise.all(
        [primary, white, black, pcb, whiteFrame, blackFrame].map(quantity),
      ),
      [2, 0, 0, 9, 9, 10],
    );
    await assert.rejects(
      bookStockMovement(organizationId, white, issue, "test"),
      (error) => error.status === 409,
    );
    assert.equal(
      (await getResourceFamily(organizationId, primary)).summary.totalQuantity,
      2,
    );

    await bookStockMovement(
      organizationId,
      white,
      { delta: 1, type: "return" },
      "test",
    );
    const concurrent = await Promise.allSettled([
      bookStockMovement(organizationId, white, issue, "test"),
      bookStockMovement(organizationId, white, issue, "test"),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrent.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(await quantity(white), 0);
    // The ticket's parent-article build path must credit only its chosen variant.
    const build = (input, authorize = () => true) =>
      buildAssembly(
        organizationId,
        primary,
        input,
        "test",
        { key: randomUUID(), requestHash: "c".repeat(64) },
        authorize,
      );
    await assert.rejects(
      build({ quantity: 1 }),
      (error) => error.status === 422,
    );
    await assert.rejects(
      build({ quantity: 1, outputResourceId: pcb }),
      (error) => error.status === 422,
    );
    await assert.rejects(
      build(
        { quantity: 1, outputResourceId: white },
        (resource) => resource.id !== white,
      ),
      (error) => error.status === 403,
    );
    const explicitKey = { key: randomUUID(), requestHash: "d".repeat(64) };
    const explicit = { quantity: 1, outputResourceId: white };
    assert.equal(
      (
        await buildAssembly(
          organizationId,
          primary,
          explicit,
          "test",
          explicitKey,
          () => true,
        )
      ).response.resource.id,
      white,
    );
    assert.equal(
      (
        await buildAssembly(
          organizationId,
          primary,
          explicit,
          "test",
          explicitKey,
          () => true,
        )
      ).replayed,
      true,
    );
    assert.deepEqual(
      await Promise.all(
        [primary, white, black, pcb, whiteFrame, blackFrame].map(quantity),
      ),
      [2, 1, 0, 8, 8, 10],
    );

    // Selecting the white frame from the primary BOM identifies the white output.
    await db
      .insert(resourceRelations)
      .values({
        organizationId,
        sourceResourceId: whiteFrame,
        targetResourceId: blackFrame,
        relationTypeKey: "variant_of",
      });
    const inferred = await build({
      quantity: 1,
      componentResourceSelections: { frame: whiteFrame },
    });
    assert.equal(inferred.response.resource.id, white);
    assert.deepEqual(
      await Promise.all(
        [primary, white, black, pcb, whiteFrame, blackFrame].map(quantity),
      ),
      [2, 2, 0, 7, 7, 10],
    );
    const detail = await getStockDetail(organizationId, primary);
    assert.equal(detail.resource.quantity, 2); // Unassigned primary stock stays independently bookable.
    assert.equal(detail.family.summary.totalQuantity, 4);
    assert.equal(detail.family.summary.primaryQuantity, 2);
    assert.equal(detail.family.summary.variantQuantity, 2);
    assert.deepEqual(
      new Map(detail.family.variants.map((row) => [row.id, row.quantity])),
      new Map([
        [white, 2],
        [black, 0],
      ]),
    );
    await assert.rejects(
      getStockDetail(organizationId, primary, {
        authorize: (resource) => resource.id !== black,
      }),
      (error) => error.status === 403,
    );
    const twin = await make("White duplicate recipe", 0);
    await db
      .insert(resourceRelations)
      .values({
        organizationId,
        sourceResourceId: twin,
        targetResourceId: primary,
        relationTypeKey: "variant_of",
      });
    await db
      .insert(variantBomOverrides)
      .values({
        organizationId,
        variantResourceId: twin,
        slotKey: "frame",
        componentResourceId: whiteFrame,
        quantityPerAssembly: 1,
        quantityUnit: "base",
        position: 1,
      });
    await assert.rejects(
      build({
        quantity: 1,
        componentResourceSelections: { frame: whiteFrame },
      }),
      (error) => error.status === 422,
    );
    const naturalFrame = await make("Natural frame", 10);
    await db
      .insert(resourceRelations)
      .values({
        organizationId,
        sourceResourceId: naturalFrame,
        targetResourceId: blackFrame,
        relationTypeKey: "variant_of",
      });
    await assert.rejects(
      build({
        quantity: 1,
        componentResourceSelections: { frame: naturalFrame },
      }),
      (error) => error.status === 422,
    );
    assert.deepEqual(
      await Promise.all(
        [primary, white, black, pcb, whiteFrame, blackFrame].map(quantity),
      ),
      [2, 2, 0, 7, 7, 10],
    );
    await build({ quantity: 1, outputResourceId: primary });
    assert.equal(await quantity(primary), 3);
    assert.equal(await quantity(blackFrame), 9);

    // Negative output stock is permitted only when the organization allows it.
    await bookStockMovement(
      organizationId,
      white,
      { ...issue, delta: -2 },
      "test",
    );
    await assert.rejects(
      bookStockMovement(organizationId, white, issue, "test"),
      (error) => error.status === 409,
    );
    await db
      .update(organizations)
      .set({ allowNegativeStock: true })
      .where(eq(organizations.id, organizationId));
    await bookStockMovement(organizationId, white, issue, "test");
    assert.equal(await quantity(white), -1);
    const negativeDetail = await getStockDetail(organizationId, primary);
    assert.equal(negativeDetail.family.summary.variantQuantity, -1);
    assert.equal(negativeDetail.family.summary.totalQuantity, 2);
    await db
      .update(organizations)
      .set({ allowNegativeStock: false })
      .where(eq(organizations.id, organizationId));
    await assert.rejects(
      bookStockMovement(organizationId, white, issue, "test"),
      (error) => error.status === 409,
    );
    await bookStockMovement(
      organizationId,
      white,
      { delta: 1, type: "return" },
      "test",
    );
    assert.equal(await quantity(white), 0);
    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.resourceId, white));
    assert.equal(
      movements.filter((movement) => movement.type === "assembly-output")
        .length,
      3,
    );
    assert.equal(
      movements.filter((movement) => movement.type === "issue").length,
      4,
    );

    if (process.env.VARIANT_TEST_API_URL) {
      const token = `inv_${randomUUID()}`;
      const [credential] = await db
        .insert(apiTokens)
        .values({
          organizationId,
          name: "Isolated ticket HTTP test",
          prefix: token.slice(0, 12),
          tokenHash: createHash("sha256").update(token).digest("hex"),
          scopes: ["read", "write"],
        })
        .returning();
      try {
        const request = (id, suffix, body, key) =>
          fetch(
            `${process.env.VARIANT_TEST_API_URL}/api/v1/resources/${id}/stock${suffix}`,
            {
              method: body ? "POST" : "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(key ? { "Idempotency-Key": key } : {}),
              },
              ...(body ? { body: JSON.stringify(body) } : {}),
            },
          );
        let response = await request(primary, "");
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).family.summary.totalQuantity, 3);
        const key = randomUUID();
        response = await request(
          primary,
          "/builds",
          { quantity: 1, outputResourceId: white },
          key,
        );
        assert.equal(response.status, 201, await response.clone().text());
        assert.equal((await response.json()).resource.id, white);
        response = await request(
          primary,
          "/builds",
          { quantity: 1, outputResourceId: white },
          key,
        );
        assert.equal(response.status, 200);
        const componentsBeforeIssue = await Promise.all(
          [pcb, whiteFrame, blackFrame].map(quantity),
        );
        response = await request(white, "/movements", issue);
        assert.equal(response.status, 201, await response.clone().text());
        assert.deepEqual(
          await Promise.all([pcb, whiteFrame, blackFrame].map(quantity)),
          componentsBeforeIssue,
        );
        response = await request(white, "/movements", issue);
        assert.equal(response.status, 409);
        await db
          .update(organizations)
          .set({ allowNegativeStock: true })
          .where(eq(organizations.id, organizationId));
        response = await request(white, "/movements", issue);
        assert.equal(response.status, 201, await response.clone().text());
        assert.equal(await quantity(white), -1);
        response = await request(primary, "");
        assert.equal((await response.json()).family.summary.totalQuantity, 2);
        response = await request(
          primary,
          "/builds",
          { quantity: 1, componentResourceSelections: { frame: whiteFrame } },
          randomUUID(),
        );
        assert.equal(response.status, 422);
      } finally {
        await db.delete(apiTokens).where(eq(apiTokens.id, credential.id));
      }
    }
  },
);
