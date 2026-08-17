import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isPinnedReadOnlyDemoMembershipSet,
  organizationAllowsPermission,
  restrictOrganizationPermissions,
  restrictOrganizationScopes,
} from "../lib/organization-read-only.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("read-only organizations retain only read scopes and permissions", () => {
  assert.deepEqual(
    restrictOrganizationScopes(["read", "write", "ai"], true),
    ["read"],
  );
  assert.deepEqual(
    restrictOrganizationPermissions(
      [
        "inventory.read",
        "inventory.export",
        "inventory.update",
        "ai.use",
        "users.manage",
      ],
      true,
    ),
    ["inventory.read", "inventory.export"],
  );
  assert.equal(organizationAllowsPermission(true, "inventory.read"), true);
  assert.equal(organizationAllowsPermission(true, "inventory.update"), false);
  assert.equal(organizationAllowsPermission(true, "ai.use"), false);
});

test("writable organizations keep their configured policy unchanged", () => {
  assert.deepEqual(
    restrictOrganizationScopes(["write", "read", "ai"], false),
    ["write", "read", "ai"],
  );
  assert.deepEqual(
    restrictOrganizationPermissions(
      ["inventory.update", "users.manage", "ai.use"],
      false,
    ),
    ["inventory.update", "users.manage", "ai.use"],
  );
});

test("demo sessions require one pinned read-only viewer membership", () => {
  const membership = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "demo",
    isReadOnly: true,
    role: "viewer",
  };
  assert.equal(isPinnedReadOnlyDemoMembershipSet([membership], "demo"), true);
  assert.equal(
    isPinnedReadOnlyDemoMembershipSet(
      [membership, { ...membership, id: "22222222-2222-4222-8222-222222222222" }],
      "demo",
    ),
    false,
  );
  assert.equal(
    isPinnedReadOnlyDemoMembershipSet(
      [{ ...membership, isReadOnly: false }],
      "demo",
    ),
    false,
  );
  assert.equal(
    isPinnedReadOnlyDemoMembershipSet([{ ...membership, role: "admin" }], "demo"),
    false,
  );
  assert.equal(
    isPinnedReadOnlyDemoMembershipSet([membership], "another-tenant"),
    false,
  );
});

test("the organization flag is additive and exposed by identity summaries", async () => {
  const [migration, schema, organizations] = await Promise.all([
    read("../db/migrations/0030_demo_readonly.sql"),
    read("../db/schema.ts"),
    read("../lib/organizations.ts"),
  ]);

  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "is_read_only" boolean DEFAULT false NOT NULL/,
  );
  assert.match(schema, /isReadOnly: boolean\("is_read_only"\)/);
  assert.match(organizations, /isReadOnly: organization\.isReadOnly/);
});

test("all identity types and conditional resource rules fail closed", async () => {
  const auth = await read("../lib/api-auth.ts");

  assert.match(auth, /restrictOrganizationScopes\([\s\S]*selected\.isReadOnly/);
  assert.match(
    auth,
    /restrictOrganizationPermissions\([\s\S]*selected\.isReadOnly/,
  );
  assert.match(
    auth,
    /permissionsForStandaloneTokenScopes\(scopes\)[\s\S]*organization\.isReadOnly/,
  );
  assert.match(
    auth,
    /organizationAllowsPermission\([\s\S]*identity\.organization\.isReadOnly[\s\S]*permission/,
  );
  assert.match(auth, /selected\.isReadOnly\s*\? \[\]/);
  assert.match(auth, /isDemoSession && !demoAccessEnabled/);
  assert.match(auth, /demoOrganizationSlug/);
  assert.match(auth, /effectiveRole\.isSystem !== true/);
  assert.match(auth, /!isDemoSession &&[\s\S]*mayLinkByEmail/);
});

test("organization creation and native token creation reject read-only tenants", async () => {
  const [organizationRoute, nativeLoginRoute] = await Promise.all([
    read("../app/api/v1/organizations/route.ts"),
    read("../app/api/v1/auth/login/route.ts"),
  ]);

  assert.match(organizationRoute, /identity\.organization\.isReadOnly/);
  assert.match(nativeLoginRoute, /organization\.isReadOnly/);
  assert.match(nativeLoginRoute, /Native API access is disabled/);
});

test("notification writes are guarded while read endpoints avoid initialization", async () => {
  const [
    api,
    inboxRoute,
    preferencesRoute,
    pushRoute,
    notificationRoute,
    readAllRoute,
    service,
  ] = await Promise.all([
    read("../lib/notification-api.ts"),
    read("../app/api/v1/notifications/route.ts"),
    read("../app/api/v1/notifications/preferences/route.ts"),
    read("../app/api/v1/notifications/push-subscriptions/route.ts"),
    read("../app/api/v1/notifications/[id]/route.ts"),
    read("../app/api/v1/notifications/read-all/route.ts"),
    read("../lib/notifications.ts"),
  ]);

  assert.match(api, /requireWritableNotificationRecipient/);
  assert.match(api, /authorization\.identity\.organization\.isReadOnly/);
  for (const route of [preferencesRoute, pushRoute, notificationRoute, readAllRoute]) {
    assert.match(route, /requireWritableNotificationRecipient/);
  }
  assert.match(
    `${inboxRoute}\n${preferencesRoute}`,
    /initializePreference: !authorization\.identity\.organization\.isReadOnly/,
  );
  assert.match(service, /eq\(organizations\.isReadOnly, false\)/);
  assert.match(service, /notificationPreferenceForRead/);
});
