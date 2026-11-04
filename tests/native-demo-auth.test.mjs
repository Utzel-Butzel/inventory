import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { PUBLIC_DEMO_NATIVE_TOKEN, PUBLIC_DEMO_ORGANIZATION_ID, PUBLIC_DEMO_USER_ID } from "../lib/organization-read-only.ts";

const enabled = process.env.TEST_DEMO_DISABLED !== "1";
let memberships, role, user, reads;
const forbidden = () => { throw new Error("Demo authentication must not write or initialize data"); };
const baseMembership = { id: PUBLIC_DEMO_ORGANIZATION_ID, slug: "demo", isReadOnly: true, role: "viewer" };
beforeEach(() => {
  memberships = [{ ...baseMembership }];
  role = { key: "viewer", name: "Viewer", isSystem: true, permissions: ["inventory.read", "inventory.update", "ai.analyze"] };
  user = { id: PUBLIC_DEMO_USER_ID, email: "demo@inventory.invalid", name: "Demo", isActive: true, developerMode: true };
  reads = 0;
});
mock.module("../auth.ts", { namedExports: { auth: forbidden, demoAccessEnabled: enabled } });
mock.module("next/headers", { namedExports: { cookies: forbidden, headers: forbidden } });
mock.module("../lib/db.ts", { namedExports: { db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => { reads++; return user ? [user] : []; } }) }) }),
  update: forbidden, insert: forbidden, delete: forbidden,
} } });
mock.module("../lib/deployment-access.ts", { namedExports: { isSuperAdminEmail: () => true } });
mock.module("../lib/access-control.ts", { namedExports: {
  conditionalScopesForRole: forbidden, getEffectiveRole: async () => role,
  getResourceRecord: forbidden, listRulesForRole: forbidden,
  permissionsForStandaloneTokenScopes: forbidden,
  roleScopesForPermissions: () => ["read", "write", "ai"], ruleGrantsResourcePermission: forbidden,
} });
mock.module("../lib/resource-slugs.ts", { namedExports: { resolveResourceId: forbidden } });
mock.module("../lib/organizations.ts", { namedExports: {
  getOrganization: forbidden, listOrganizationsForUser: async (id) => { assert.equal(id, PUBLIC_DEMO_USER_ID); return memberships; },
  ORGANIZATION_COOKIE: "inventory-org", ORGANIZATION_HEADER: "x-organization-id", ORGANIZATION_ROUTE_HEADER: "x-inventory-organization-route",
  organizationSummary: forbidden, selectOrganization: forbidden,
} });
const { getRequestIdentity, requireIdentity, requirePermission, requireSuperAdminSession } = await import("../lib/api-auth.ts");
const request = (organization) => new Request("https://demo.example/api/v1/organizations", { headers: {
  authorization: `Bearer ${PUBLIC_DEMO_NATIVE_TOKEN}`, ...(organization ? { "x-organization-id": organization } : {}),
} });

if (!enabled) {
  test("ordinary deployments reject the public selector before accessing the database", async () => {
    assert.equal(await getRequestIdentity(request()), null);
    assert.equal(reads, 0);
  });
} else {
  test("public demo is a read-only viewer without administrator privileges or writes", async () => {
    const identity = await getRequestIdentity(request());
    assert.equal(identity.organizationId, PUBLIC_DEMO_ORGANIZATION_ID);
    assert.deepEqual(identity.scopes, ["read"]);
    assert.deepEqual(identity.permissions, ["inventory.read"]);
    assert.equal(identity.isSuperAdmin, false);
    assert.equal(identity.developerMode, false);
    assert.equal((await requireIdentity(request(), "write")).response.status, 403);
    assert.equal((await requireIdentity(request(), "ai")).response.status, 403);
    assert.equal((await requirePermission(request(), "inventory.update")).response.status, 403);
    assert.equal((await requireSuperAdminSession(request())).response.status, 403);
  });
  test("foreign organization headers cannot switch the demo tenant", async () => {
    assert.equal(await getRequestIdentity(request("another-tenant")), null);
    assert.ok(await getRequestIdentity(request(PUBLIC_DEMO_ORGANIZATION_ID)));
  });
  test("revoked or broadened demo memberships immediately invalidate access", async () => {
    for (const invalid of [[], [{ ...baseMembership, isReadOnly: false }], [{ ...baseMembership, role: "admin" }], [{ ...baseMembership, slug: "other" }], [baseMembership, { ...baseMembership, id: "other" }]]) {
      memberships = invalid;
      assert.equal(await getRequestIdentity(request()), null);
    }
  });
  test("missing user and custom elevated role fail closed", async () => {
    user = null;
    assert.equal(await getRequestIdentity(request()), null);
    user = { id: PUBLIC_DEMO_USER_ID };
    role.isSystem = false;
    assert.equal(await getRequestIdentity(request()), null);
  });
}
