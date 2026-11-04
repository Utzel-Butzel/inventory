import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { hashIdempotentPayload } from "../lib/idempotency.ts";

let denied, created, replayed, exported, resourceRows;
beforeEach(() => {
  denied = false;
  created = [];
  replayed = new Map();
  exported = [];
  resourceRows = [];
});
mock.module("../lib/api-auth.ts", {
  namedExports: {
    requirePermission: async (_request, permission) =>
      denied
        ? { response: Response.json({}, { status: 403 }) }
        : {
            identity: {
              organizationId: "org-a",
              subject: "user-a",
              permissions: [permission],
            },
          },
  },
});
mock.module("../lib/custom-fields.ts", {
  namedExports: {
    customFieldHttpError: () => ({ status: 500 }),
    validateCustomFieldValues: async () => ({}),
  },
});
mock.module("../lib/inventory-structure.ts", {
  namedExports: {
    assertActiveInventoryType: async () => {},
    inventoryStructureHttpError: () => ({ status: 500 }),
    synchronizeSpatialContainment: async () => {},
  },
});
class IdempotencyConflictError extends Error {}
class ResourceIdentifierConflictError extends Error {}
mock.module("../lib/resource-identifiers.ts", {
  namedExports: {
    assertResourceIdentifiersAvailable: async () => {},
    ResourceIdentifierConflictError,
  },
});
mock.module("../lib/resources.ts", {
  namedExports: {
    IdempotencyConflictError,
    replayResourceCreation: async ({ idempotencyKey, requestHash }) => {
      const previous = replayed.get(idempotencyKey);
      if (previous && previous.hash !== requestHash)
        throw new IdempotencyConflictError();
      return previous?.result;
    },
    createResourceIdempotently: async (args) => {
      created.push(args);
      const result = {
        response: {
          resource: { ...args.values, id: `item-${created.length}` },
        },
      };
      replayed.set(args.idempotencyKey, { hash: args.requestHash, result });
      return result;
    },
    listResources: async (args) => {
      exported.push(args);
      return {
        resources: resourceRows,
        pagination: { total: resourceRows.length, pages: 1 },
      };
    },
  },
});
const { POST } = await import("../app/api/v1/resources/import/route.ts");
const { GET } = await import("../app/api/v1/resources/export/route.ts");
const key = "10000000-0000-4000-8000-000000000001";
const send = (csv, query = "system=homebox&currency=EUR") =>
  POST(
    new Request(`http://localhost/api/v1/resources/import?${query}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv", "Idempotency-Key": key },
      body: csv,
    }),
  );

test("external import validates and scopes resource creation; exact retries replay, changed currency conflicts", async () => {
  const csv = "HB.name,HB.quantity,HB.purchase_price\nDrill,3,12.99";
  const response = await send(csv);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).summary.created, 1);
  assert.equal(created[0].organizationId, "org-a");
  assert.equal(created[0].values.createdBy, "user-a");
  assert.equal(created[0].values.quantity, 3);
  assert.equal(created[0].values.valueCents, 1299);
  assert.equal((await send(csv)).status, 200);
  assert.equal(created.length, 1);
  const conflict = await send(csv, "system=homebox&currency=USD");
  assert.equal(conflict.status, 207);
  assert.equal((await conflict.json()).summary.failed, 1);
  assert.equal(created.length, 1);
});

test("native import keeps its original idempotency payload", async () => {
  assert.equal((await send("name\nNative", "")).status, 201);
  const args = created[0];
  const {
    organizationId,
    createdBy,
    ...resource
  } = args.values;
  assert.equal(organizationId, "org-a");
  assert.equal(createdBy, "user-a");
  const expected = hashIdempotentPayload({
    actor: "user-a",
    batchHash: hashIdempotentPayload({ actor: "user-a", csv: "name\nNative" }),
    rowIndex: 0,
    resource: { ...resource, slugs: [] },
  });
  assert.equal(args.requestHash, expected);
});

test("permissions and invalid formats fail before writes or inventory reads", async () => {
  denied = true;
  assert.equal((await send("HB.name\nA")).status, 403);
  assert.equal(
    (await GET(new Request("http://localhost/export?system=homebox"))).status,
    403,
  );
  denied = false;
  assert.equal((await send("Name\nA", "system=unknown")).status, 400);
  assert.equal(
    (await send("Name\nA", "system=snipe-it&currency=EURO")).status,
    400,
  );
  for (const query of [
    "system=unknown",
    "system=homebox&format=pdf",
    "system=snipe-it&format=xlsx",
  ]) {
    assert.equal(
      (await GET(new Request(`http://localhost/export?${query}`))).status,
      400,
    );
  }
  assert.equal(created.length, 0);
  assert.equal(exported.length, 0);
});

test("external rows retain original source line errors and never round fractional quantities", async () => {
  const response = await send(
    'HB.name,HB.quantity,HB.notes\n"Drill\nBlue",2,ok\nInvalid,1.5,ok',
  );
  const body = await response.json();
  assert.equal(response.status, 207);
  assert.equal(body.rows[1].line, 4);
  assert.equal(body.rows[1].status, "error");
  assert.equal(created.length, 1);
});

test("external import limits and invalid content stop writes", async () => {
  assert.equal((await send("HB.name\n" + "A\n".repeat(1001))).status, 413);
  assert.equal(
    (await send("HB.name,HB.purchase_price\nA,invalid")).status,
    400,
  );
  assert.equal(
    (await send("HB.name\n" + "a".repeat(5 * 1024 * 1024))).status,
    413,
  );
  assert.equal(created.length, 0);
});

test("external export scopes reads, provides target filename and refuses lossy output", async () => {
  const response = await GET(
    new Request("http://localhost/export?system=homebox"),
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition"),
    /inventory-homebox-/,
  );
  assert.match(await response.text(), /HB.import_ref/);
  assert.equal(exported[0].organizationId, "org-a");
  resourceRows = [
    {
      id: key,
      name: "Bulk",
      quantity: 2,
      tags: [],
      categories: [],
      notes: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  const invalid = await GET(
    new Request("http://localhost/export?system=snipe-it"),
  );
  assert.equal(invalid.status, 422);
  assert.match((await invalid.json()).error, /exactly one unit/);
});
