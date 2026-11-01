import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const unit = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
let signedIn, denied, target, calls, external;
beforeEach(() => { signedIn = true; denied = null; target = true; calls = []; external = null; });
const identity = { organizationId: "org", organization: { slug: "current-workspace" } };
mock.module("../lib/api-auth.ts", { namedExports: {
  getSessionIdentity: async () => signedIn ? identity : null,
  requirePermission: async (_request, permission) => denied === permission ? { response: new Response(null, { status: 403 }) } : { identity },
  requireResourcePermission: async (_request, permission) => denied === permission ? { response: new Response(null, { status: 403 }) } : { identity, resource: { id } },
} });
mock.module("../lib/label-shortcodes.ts", { namedExports: {
  ensureLabelShortcode: async (...args) => { calls.push(args); return target ? "K7m4Xp2A" : null; },
  resolveLabelShortcode: async code => target && code === "K7m4Xp2A" ? { organizationSlug: "target-workspace", resourceId: id, stockUnitId: unit } : null,
} });
mock.module("../lib/label-redirect.ts", { namedExports: {
  getLabelExternalDestination: async (resourceId, stockUnitId) => {
    assert.equal(resourceId, id);
    assert.ok(stockUnitId === null || stockUnitId === unit);
    return external;
  },
} });
const { POST } = await import("../app/api/v1/labels/shortcodes/route.ts");
const { GET } = await import("../app/q/[code]/route.ts");
const { GET: legacyGET } = await import("../app/r/[code]/route.ts");
const post = body => POST(new Request("https://inventory.example/api/v1/labels/shortcodes", { method: "POST", body: JSON.stringify(body) }));
const get = (code = "K7m4Xp2A") => GET(new Request("https://inventory.example/q/" + code), { params: Promise.resolve({ code }) });

test("shortcode creation checks label, resource and unit permissions and scopes storage", async () => {
  assert.equal((await post({ resourceId: id, stockUnitId: unit })).status, 200);
  assert.deepEqual(calls, [["org", id, unit]]);
  for (const permission of ["labels.read", "inventory.read", "stock.read"]) {
    denied = permission;
    assert.equal((await post({ resourceId: id, stockUnitId: unit })).status, 403);
  }
  assert.equal(calls.length, 1);
});

test("invalid and absent targets cannot be printed; cross-origin creation is refused", async () => {
  assert.equal((await post({ resourceId: "bad" })).status, 422);
  assert.equal(calls.length, 0);
  target = false;
  assert.equal((await post({ resourceId: id })).status, 404);
  assert.equal((await POST(new Request("https://inventory.example/api/v1/labels/shortcodes", {
    method: "POST", headers: { origin: "https://evil.invalid" }, body: JSON.stringify({ resourceId: id }),
  }))).status, 403);
});

test("shortcodes redirect to the stored organization and unit, retaining source through login", async () => {
  const destination = `/target-workspace/inventory/${id}/stock?unit=${unit}&src=qr`;
  const response = await get();
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), destination);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  signedIn = false;
  const login = new URL((await get()).headers.get("location"), "https://inventory.example");
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("callbackUrl"), destination);
  target = false;
  assert.equal((await get()).status, 404);
  assert.equal((await get("invalid")).status, 404);
});

test("existing QR redirects preserve src=qr and remain compatible with unmarked labels", async () => {
  const code = "PyUE4E-JQdOaDAMF6CwzAQ";
  const legacy = query => legacyGET(new Request(`https://inventory.example/r/${code}${query}`), { params: Promise.resolve({ code }) });
  assert.equal((await legacy("")).headers.get("location"), `/current-workspace/inventory/${id}`);
  assert.equal((await legacy("?src=qr")).headers.get("location"), `/current-workspace/inventory/${id}?src=qr`);
  signedIn = false;
  const response = await legacy("?unit=TyUE4E-JQdOaDAMF6CwzAg&src=qr");
  const login = new URL(response.headers.get("location"), "https://inventory.example");
  assert.equal(login.searchParams.get("callbackUrl"), `/inventory/${id}/stock?unit=${unit}&src=qr`);
});

test("saved external destinations apply to normal and short labels without requiring login", async () => {
  signedIn = false;
  external = "https://digital.konglomerat.org/slack?src=qr";
  const code = "PyUE4E-JQdOaDAMF6CwzAQ";
  for (const response of [await get(), await legacyGET(new Request(`https://inventory.example/r/${code}?url=https://evil.invalid`), { params: Promise.resolve({ code }) })]) {
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), external);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  // Deleting the target still invalidates a stored shortcode, even with an external destination.
  target = false;
  assert.equal((await get()).status, 404);
});
