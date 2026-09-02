import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import {
  isSuperAdminEmail,
  usersCanCreateOrganizations,
} from "../lib/deployment-access.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const originalSuperadmins = process.env.SUPERADMIN_EMAILS;
const originalCreationPolicy = process.env.USERS_CAN_CREATE_ORGANIZATIONS;

afterEach(() => {
  if (originalSuperadmins === undefined) delete process.env.SUPERADMIN_EMAILS;
  else process.env.SUPERADMIN_EMAILS = originalSuperadmins;
  if (originalCreationPolicy === undefined) {
    delete process.env.USERS_CAN_CREATE_ORGANIZATIONS;
  } else {
    process.env.USERS_CAN_CREATE_ORGANIZATIONS = originalCreationPolicy;
  }
});

test("deployment access policy normalizes superadmin emails", () => {
  process.env.SUPERADMIN_EMAILS = "Owner@Example.com, second@example.com ";

  assert.equal(isSuperAdminEmail("owner@example.com"), true);
  assert.equal(isSuperAdminEmail(" SECOND@EXAMPLE.COM "), true);
  assert.equal(isSuperAdminEmail("member@example.com"), false);
});

test("organization creation is opt-in for regular users", () => {
  delete process.env.USERS_CAN_CREATE_ORGANIZATIONS;
  assert.equal(usersCanCreateOrganizations(), false);

  for (const enabled of ["true", "TRUE", "1", "yes", "on"]) {
    process.env.USERS_CAN_CREATE_ORGANIZATIONS = enabled;
    assert.equal(usersCanCreateOrganizations(), true);
  }

  process.env.USERS_CAN_CREATE_ORGANIZATIONS = "false";
  assert.equal(usersCanCreateOrganizations(), false);
});

test("organization creation and global management are enforced server-side", async () => {
  const [
    identity,
    memberRoute,
    adminRoute,
    adminDetailRoute,
    page,
    navigation,
    openapi,
    usersRoute,
    userRoute,
  ] =
    await Promise.all([
      source("lib/api-auth.ts"),
      source("app/api/v1/organizations/route.ts"),
      source("app/api/v1/admin/organizations/route.ts"),
      source("app/api/v1/admin/organizations/[id]/route.ts"),
      source("app/(dashboard)/settings/system-organizations/page.tsx"),
      source("components/settings-navigation.tsx"),
      source("public/openapi.yaml"),
      source("app/api/users/route.ts"),
      source("app/api/users/[id]/route.ts"),
    ]);

  assert.match(identity, /requireSuperAdminSession/);
  assert.match(identity, /isSuperAdminEmail\(options\.user\.email\)/);
  assert.match(memberRoute, /usersCanCreateOrganizations\(\)/);
  assert.match(memberRoute, /!identity\.isSuperAdmin/);
  assert.match(adminRoute, /requireSuperAdminSession\(request\)/);
  assert.match(adminRoute, /listOrganizations\(\)/);
  assert.match(adminDetailRoute, /requireSuperAdminSession\(request\)/);
  assert.match(page, /if \(!identity\.isSuperAdmin\) notFound\(\)/);
  assert.match(navigation, /href: "\/settings\/system-organizations"/);
  assert.match(navigation, /superadminOnly: true/);
  assert.match(openapi, /\/admin\/organizations:/);
  assert.match(openapi, /superadminSession:/);
  assert.match(usersRoute, /isSuperAdminEmail\(parsed\.data\.email\)/);
  assert.match(userRoute, /isSuperAdminEmail\(existing\.user\.email\)/);
});
