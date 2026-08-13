import assert from "node:assert/strict";
import test from "node:test";

import {
  isOrganizationPagePath,
  organizationIdFromPathname,
  organizationPath,
  stripOrganizationPathname,
} from "../lib/organization-path.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";

test("organization paths prefix tenant pages and preserve query strings", () => {
  assert.equal(
    organizationPath(organizationId, "/inventory/item-id?tab=stock"),
    `/${organizationId}/inventory/item-id?tab=stock`,
  );
  assert.equal(
    organizationPath(organizationId, `/${organizationId}/dashboard`),
    `/${organizationId}/dashboard`,
  );
  assert.equal(
    organizationPath(organizationId, `/${organizationId}?view=compact`),
    `/${organizationId}/dashboard?view=compact`,
  );
  assert.equal(
    organizationPath(organizationId.toUpperCase(), "/dashboard"),
    `/${organizationId}/dashboard`,
  );
  assert.equal(
    organizationPath(organizationId, "/"),
    `/${organizationId}/dashboard`,
  );
});

test("public, authentication, and API paths remain outside organization URLs", () => {
  assert.equal(organizationPath(organizationId, "/login"), "/login");
  assert.equal(
    organizationPath(organizationId, "/login?callbackUrl=%2Finventory"),
    "/login?callbackUrl=%2Finventory",
  );
  assert.equal(organizationPath(organizationId, "/api/v1/resources"), "/api/v1/resources");
  assert.equal(organizationPath(organizationId, "/share/public-id"), "/share/public-id");
  assert.equal(organizationPath(organizationId, "/r/short-code"), "/r/short-code");
});

test("organization path parsing recognizes and removes only UUID prefixes", () => {
  const pathname = `/${organizationId}/settings/organization`;
  assert.equal(organizationIdFromPathname(pathname), organizationId);
  assert.equal(stripOrganizationPathname(pathname), "/settings/organization");
  assert.equal(stripOrganizationPathname("/settings/organization"), "/settings/organization");
  assert.equal(isOrganizationPagePath(pathname), true);
  assert.equal(isOrganizationPagePath("/share/public-id"), false);
});

test("organization paths reject malformed tenant identifiers", () => {
  assert.throws(
    () => organizationPath("not-an-organization", "/dashboard"),
    /valid organization UUID/,
  );
});
