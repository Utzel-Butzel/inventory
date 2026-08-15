import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isPinnedReadOnlyDemoMembershipSet,
  organizationAllowsPermission,
  organizationAllowsWorkerSideEffects,
  PUBLIC_DEMO_ORGANIZATION_ID,
  PUBLIC_DEMO_USER_ID,
  restrictOrganizationPermissions,
  restrictOrganizationScopes,
} from "../lib/organization-read-only.ts";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const section = (source, start, end) => {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(startAt, -1, `Missing section start: ${start}`);
  assert.notEqual(endAt, -1, `Missing section end: ${end}`);
  return source.slice(startAt, endAt);
};

const occurrences = (source, token) => source.split(token).length - 1;

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

test("background side effects fail closed for read-only or missing tenants", () => {
  assert.equal(organizationAllowsWorkerSideEffects(false), true);
  assert.equal(organizationAllowsWorkerSideEffects(true), false);
  assert.equal(organizationAllowsWorkerSideEffects(null), false);
  assert.equal(organizationAllowsWorkerSideEffects(undefined), false);
});

test("demo sessions require one pinned read-only viewer membership", () => {
  const membership = {
    id: PUBLIC_DEMO_ORGANIZATION_ID,
    slug: "demo",
    isReadOnly: true,
    role: "viewer",
  };
  assert.equal(isPinnedReadOnlyDemoMembershipSet([membership], "demo"), true);
  assert.equal(
    isPinnedReadOnlyDemoMembershipSet(
      [{ ...membership, id: "11111111-1111-4111-8111-111111111111" }],
      "demo",
    ),
    false,
  );
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
  assert.equal(PUBLIC_DEMO_USER_ID, "d3e00000-0000-4000-8000-000000000002");
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

test("identity and conditional resource access fail closed", async () => {
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
  assert.match(auth, /databaseUserId !== PUBLIC_DEMO_USER_ID/);
  assert.match(auth, /demoOrganizationId: PUBLIC_DEMO_ORGANIZATION_ID/);
  assert.match(auth, /effectiveRole\.isSystem !== true/);
  assert.match(auth, /!isDemoSession && mayLinkByEmail/);
});

test("organization and native token creation reject read-only tenants", async () => {
  const [organizationRoute, nativeLoginRoute] = await Promise.all([
    read("../app/api/v1/organizations/route.ts"),
    read("../app/api/v1/auth/login/route.ts"),
  ]);
  assert.match(organizationRoute, /identity\.organization\.isReadOnly/);
  assert.match(nativeLoginRoute, /organization\.isReadOnly/);
});

test("notification writes are guarded and reads avoid initialization", async () => {
  const [api, inbox, preferences, push, single, readAll, service] =
    await Promise.all([
      read("../lib/notification-api.ts"),
      read("../app/api/v1/notifications/route.ts"),
      read("../app/api/v1/notifications/preferences/route.ts"),
      read("../app/api/v1/notifications/push-subscriptions/route.ts"),
      read("../app/api/v1/notifications/[id]/route.ts"),
      read("../app/api/v1/notifications/read-all/route.ts"),
      read("../lib/notifications.ts"),
    ]);
  assert.match(api, /requireWritableNotificationRecipient/);
  for (const route of [preferences, push, single, readAll]) {
    assert.match(route, /requireWritableNotificationRecipient/);
  }
  assert.match(
    `${inbox}\n${preferences}`,
    /initializePreference: !authorization\.identity\.organization\.isReadOnly/,
  );
  assert.match(service, /eq\(organizations\.isReadOnly, false\)/);
  assert.match(service, /notificationPreferenceForRead/);
});

test("translation and webhook workers guard every side-effect boundary", async () => {
  const [translations, webhooks] = await Promise.all([
    read("../lib/content-translations.ts"),
    read("../lib/webhooks.ts"),
  ]);

  const translationClaim = section(
    translations,
    "async function claimTranslationJob",
    "async function discardClaim",
  );
  assert.ok(
    occurrences(
      translationClaim,
      "writableTranslationOrganizationCondition()",
    ) >= 2,
  );
  for (const [start, end] of [
    ["async function discardClaim", "async function saveJobTranslations"],
    ["async function saveJobTranslations", "function errorMessage"],
    ["async function failClaim", "async function processTranslationJob"],
  ]) {
    assert.match(
      section(translations, start, end),
      /lockWritableTranslationOrganization/,
    );
  }
  assert.ok(
    occurrences(
      section(
        translations,
        "async function processTranslationJob",
        "export async function drainTranslationJobs",
      ),
      "translationOrganizationAllowsWork",
    ) >= 3,
  );

  const webhookClaim = section(
    webhooks,
    "async function claimWebhookDelivery",
    "async function markDeliverySuccess",
  );
  assert.ok(
    occurrences(webhookClaim, "writableWebhookOrganizationCondition") >= 3,
  );
  for (const [start, end] of [
    ["async function markDeliverySuccess", "async function markDeliveryFailure"],
    ["async function markDeliveryFailure", "async function deliverWebhook"],
  ]) {
    assert.match(
      section(webhooks, start, end),
      /lockWritableWebhookOrganization/,
    );
  }
  assert.ok(
    occurrences(
      section(
        webhooks,
        "async function deliverWebhook",
        "export async function drainWebhookDeliveries",
      ),
      "webhookOrganizationAllowsWork",
    ) >= 2,
  );
  assert.ok(
    occurrences(
      section(webhooks, "export async function drainWebhookDeliveries", "return { processed:"),
      "writableWebhookOrganizationCondition",
    ) >= 2,
  );
});
