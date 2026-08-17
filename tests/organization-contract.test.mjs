import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  organizationCreateInputSchema,
  organizationSelectInputSchema,
  organizationUpdateInputSchema,
} from "../lib/validators.ts";

const read = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("organization request validators reject ambiguous or malformed input", () => {
  assert.deepEqual(
    organizationCreateInputSchema.parse({ name: "  Workshop Berlin  " }),
    { name: "Workshop Berlin" },
  );
  assert.equal(
    organizationCreateInputSchema.safeParse({ name: "", slug: "override" })
      .success,
    false,
  );
  assert.deepEqual(
    organizationCreateInputSchema.parse({
      name: "Workshop Berlin",
      slug: "  Workshop-Berlin  ",
    }),
    { name: "Workshop Berlin", slug: "workshop-berlin" },
  );
  assert.equal(
    organizationCreateInputSchema.safeParse({ name: "Workshop", slug: "login" })
      .success,
    false,
  );
  assert.deepEqual(
    organizationUpdateInputSchema.parse({ slug: "new-workshop" }),
    { slug: "new-workshop" },
  );
  assert.equal(organizationUpdateInputSchema.safeParse({}).success, false);
  assert.deepEqual(
    organizationSelectInputSchema.parse({
      organizationId: "11111111-1111-4111-8111-111111111111",
    }),
    { organizationId: "11111111-1111-4111-8111-111111111111" },
  );
  assert.equal(
    organizationSelectInputSchema.safeParse({ organizationId: "not-an-id" })
      .success,
    false,
  );
});

test("organization migration adopts legacy data and tenant-scopes critical keys", async () => {
  const migration = await read("../db/migrations/0029_organizations.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "organizations"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "organization_memberships"/);
  assert.match(
    migration,
    /00000000-0000-4000-8000-000000000001/,
  );
  assert.match(
    migration,
    /UPDATE %I SET organization_id = %L WHERE organization_id IS NULL/,
  );
  assert.match(
    migration,
    /"role_key", "is_active", "created_by"[\s\S]*"role", "is_active", 'migration'/,
  );
  assert.match(
    migration,
    /"resources" \("organization_id", "sku"\)/,
  );
  assert.match(
    migration,
    /ON CONFLICT \("organization_id", "resource_id", "language_code"\)/,
  );
  assert.match(
    migration,
    /WHERE "organization_id" = target_organization_id/,
  );
  assert.match(migration, /ALTER COLUMN organization_id DROP DEFAULT/);
  assert.match(
    migration,
    /resource_variants_organization_resource_fk/,
  );
  assert.match(migration, /media_organization_resource_fk/);
  assert.match(migration, /stock_movements_organization_resource_fk/);
  assert.match(migration, /room_scan_assets_organization_scan_fk/);
  assert.match(
    migration,
    /webhook_deliveries_organization_event_fk/,
  );
  assert.match(
    migration,
    /INSERT INTO "stock_settings" \([\s\S]*"organization_id"[\s\S]*NEW\."organization_id"/,
  );
});

test("identity resolution enforces header membership and standalone token pinning", async () => {
  const [auth, nextAuth, routes, capabilities, openapi] = await Promise.all([
    read("../lib/api-auth.ts"),
    read("../auth.ts"),
    read("../app/api/v1/organizations/select/route.ts"),
    read("../app/api/v1/auth/capabilities/route.ts"),
    read("../public/openapi.yaml"),
  ]);

  assert.match(auth, /\.get\(ORGANIZATION_HEADER\)/);
  assert.match(
    auth,
    /requestedOrganizationId !== token\.organizationId/,
  );
  assert.match(
    auth,
    /resource\.organizationId !== identity\.organizationId/,
  );
  assert.match(routes, /identity\.organizations\.find/);
  assert.match(routes, /cookieStore\.set\(ORGANIZATION_COOKIE/);
  assert.match(auth, /session\.user\.auth0EmailVerified/);
  assert.doesNotMatch(auth, /Pre-organization Auth0 identities/);
  assert.match(nextAuth, /delete token\.userId/);
  assert.match(capabilities, /principal: hashRequestIdentity\(identity\)/);
  assert.match(openapi, /required: \[name, principal, scopes,/);
});

test("organization-scoped identifiers and replay keys remain reusable", async () => {
  const [identifiers, mediaRoute] = await Promise.all([
    read("../lib/resource-identifiers.ts"),
    read("../app/api/v1/resources/[id]/media/route.ts"),
  ]);

  assert.match(identifiers, /resourceVariants\.organizationId/);
  assert.match(identifiers, /resources\.organizationId/);
  assert.match(
    mediaRoute,
    /target: \[[\s\S]*mediaUploadBatches\.organizationId,[\s\S]*mediaUploadBatches\.idempotencyKey/,
  );
});

test("one organization cannot reset another membership's global credentials", async () => {
  const userRoute = await read("../app/api/users/[id]/route.ts");

  assert.doesNotMatch(userRoute, /membershipCount > 1/);
  assert.match(
    userRoute,
    /Only the account owner can change their global profile or password/,
  );
  assert.match(userRoute, /pg_advisory_xact_lock/);
});

test("new organizations use immutable defaults instead of tenant configuration", async () => {
  const organizations = await read("../lib/organizations.ts");

  assert.match(organizations, /const canonicalInventoryTypes/);
  assert.match(organizations, /const canonicalRelationTypes/);
  assert.match(organizations, /instructions: ""/);
  assert.doesNotMatch(
    organizations,
    /from\(translationLanguages\)[\s\S]{0,160}DEFAULT_ORGANIZATION_ID/,
  );
});
