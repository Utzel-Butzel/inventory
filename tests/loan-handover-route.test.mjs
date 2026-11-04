import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const assignmentId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const resourceId = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
let authenticated, permitted, found, documents, reads, checks;
beforeEach(() => {
  authenticated = true; permitted = true; found = true;
  documents = []; reads = []; checks = [];
});
mock.module("../lib/api-auth.ts", { namedExports: {
  requirePermission: async (_request, permission) => {
    checks.push({ permission });
    return permitted ? { identity: { organizationId: "test-org" } } : { response: Response.json({}, { status: 403 }) };
  },
  requireIdentity: async () => authenticated ? { identity: { organizationId: "test-org" } } : { response: Response.json({}, { status: 401 }) },
  requireResourcePermission: async (_request, permission, resource) => {
    checks.push({ permission, resource });
    return permitted ? { identity: { organizationId: "test-org" } } : { response: Response.json({}, { status: 403 }) };
  },
} });
mock.module("../lib/db.ts", { namedExports: {
  db: { select: () => {
    const selection = { from: () => selection, innerJoin: () => selection, where: () => selection, limit: async () => found ? [{ resourceId, id: resourceId }] : [] };
    return selection;
  } },
} });
mock.module("../lib/loan-handovers.ts", { namedExports: {
  getLoanHandovers: async (...args) => { reads.push(args); return documents; },
} });
mock.module("../lib/order-loan-handovers.ts", { namedExports: {
  getOrderLoanHandovers: async (...args) => { reads.push(args); return documents; },
} });
mock.module("../lib/loan-handover-pdf.ts", { namedExports: {
  renderLoanHandoverPdf: async () => Buffer.from("%PDF-1.7 test"),
} });
const { GET } = await import("../app/api/v1/assignments/[assignmentId]/handovers/route.ts");
const get = (query = "", id = assignmentId) => GET(new Request(`http://localhost/handovers${query}`), { params: Promise.resolve({ assignmentId: id }) });

test("unauthenticated and resource-denied users cannot read reports or PDFs", async () => {
  authenticated = false;
  assert.equal((await get()).status, 401);
  assert.deepEqual(checks, []); assert.deepEqual(reads, []);
  authenticated = true; permitted = false;
  assert.equal((await get("?format=pdf")).status, 403);
  assert.deepEqual(checks, [{ permission: "assignments.read", resource: resourceId }]);
  assert.deepEqual(reads, []);
});
test("invalid or absent assignments never load report data", async () => {
  assert.equal((await get("", "invalid")).status, 422);
  found = false;
  assert.equal((await get()).status, 404);
  assert.deepEqual(checks, []); assert.deepEqual(reads, []);
});
test("read access is scoped to the authorized organization and responses cannot be cached", async () => {
  documents = [{ phase: "checkout" }];
  const response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { documents });
  assert.deepEqual(reads, [["test-org", assignmentId]]);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
});
test("PDF downloads require at least one report and use a safe attachment filename", async () => {
  assert.equal((await get("?format=pdf")).status, 404);
  documents = [{ phase: "checkout" }];
  const response = await get("?format=pdf&locale=de");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-disposition"), `attachment; filename="handover-${assignmentId}.pdf"`);
});

const { GET: getOrderReports } = await import("../app/api/v1/orders/[id]/lines/[lineId]/handovers/route.ts");
test("order reports require order read permission and scope line and unit reports to the authorized tenant", async () => {
  const request = new Request(`http://localhost/order/handovers?unitId=${assignmentId}`);
  const context = { params: Promise.resolve({ id: assignmentId, lineId: resourceId }) };
  permitted = false;
  assert.equal((await getOrderReports(request, context)).status, 403);
  assert.deepEqual(reads, []);
  permitted = true;
  const response = await getOrderReports(request, context);
  assert.equal(response.status, 200);
  assert.deepEqual(reads, [["test-org", resourceId, assignmentId]]);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(checks, [{ permission: "orders.read" }, { permission: "orders.read" }]);
  found = false;
  assert.equal((await getOrderReports(request, context)).status, 404);
  assert.equal(reads.length, 1);
});
