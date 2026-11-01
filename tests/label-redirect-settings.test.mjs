import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

let permission, exists, changes;
beforeEach(() => { permission = true; exists = true; changes = []; });
mock.module("../lib/api-auth.ts", { namedExports: {
  getSessionIdentity: async id => {
    assert.equal(id, "target-org");
    return exists ? { permissions: permission ? ["users.manage"] : [], subject: "admin" } : null;
  },
} });
mock.module("../lib/organizations.ts", { namedExports: {
  updateOrganization: async options => { changes.push(options); return { id: options.id, labelQrRedirectUrl: options.labelQrRedirectUrl }; },
  OrganizationSlugUnavailableError: class extends Error {},
} });
const { PATCH } = await import("../app/api/v1/organizations/[id]/route.ts");
const patch = body => PATCH(new Request("https://inventory.example/api/v1/organizations/target-org", {
  method: "PATCH", body: JSON.stringify(body),
}), { params: Promise.resolve({ id: "target-org" }) });

test("admins can save and clear the selected organization's QR destination", async () => {
  for (const value of ["https://digital.konglomerat.org/slack", null]) {
    const response = await patch({ labelQrRedirectUrl: value });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).organization.labelQrRedirectUrl, value);
    assert.equal(changes.at(-1).id, "target-org");
    assert.equal(changes.at(-1).labelQrRedirectUrl, value);
  }
});

test("other members and nonmembers cannot change redirect settings", async () => {
  permission = false;
  assert.equal((await patch({ labelQrRedirectUrl: "https://example.org" })).status, 403);
  exists = false;
  assert.equal((await patch({ labelQrRedirectUrl: null })).status, 404);
  assert.equal(changes.length, 0);
});

test("invalid URLs are rejected before storage", async () => {
  assert.equal((await patch({ labelQrRedirectUrl: "javascript:alert(1)" })).status, 422);
  assert.equal(changes.length, 0);
});
