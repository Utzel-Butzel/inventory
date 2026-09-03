import assert from "node:assert/strict";
import test from "node:test";

import {
  isOrganizationPagePath,
  isOrganizationScopedPagePath,
  organizationIdFromPathname,
  organizationPath,
  organizationReferenceFromPathname,
  slugifyOrganizationName,
  stripOrganizationPathname,
} from "../lib/organization-path.ts";

const organizationId = "11111111-1111-4111-8111-111111111111";
const organizationSlug = "workshop-berlin";

test("organization paths use short slugs and preserve query strings", () => {
  assert.equal(
    organizationPath(organizationSlug, "/inventory/item-id?tab=stock"),
    `/${organizationSlug}/inventory/item-id?tab=stock`,
  );
  assert.equal(
    organizationPath(organizationSlug, `/${organizationId}/dashboard`),
    `/${organizationSlug}/dashboard`,
  );
  assert.equal(
    organizationPath(organizationSlug, `/${organizationId}?view=compact`),
    `/${organizationSlug}/inventory?view=compact`,
  );
  assert.equal(
    organizationPath(organizationSlug.toUpperCase(), "/dashboard"),
    `/${organizationSlug}/dashboard`,
  );
  assert.equal(
    organizationPath(organizationSlug, "/"),
    `/${organizationSlug}/inventory`,
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

test("organization path parsing recognizes slug and legacy UUID prefixes", () => {
  const slugPathname = `/${organizationSlug}/settings/organization`;
  const uuidPathname = `/${organizationId}/settings/organization`;
  assert.equal(organizationReferenceFromPathname(slugPathname), organizationSlug);
  assert.equal(organizationIdFromPathname(slugPathname), null);
  assert.equal(organizationIdFromPathname(uuidPathname), organizationId);
  assert.equal(stripOrganizationPathname(slugPathname), "/settings/organization");
  assert.equal(stripOrganizationPathname("/settings/organization"), "/settings/organization");
  assert.equal(
    stripOrganizationPathname(`/${organizationSlug}/operations/loans`),
    "/operations/loans",
  );
  assert.equal(
    stripOrganizationPathname(`/${organizationSlug}/contacts`),
    "/contacts",
  );
  assert.equal(isOrganizationPagePath(slugPathname), true);
  assert.equal(isOrganizationScopedPagePath(slugPathname), true);
  assert.equal(isOrganizationPagePath("/share/public-id"), false);
});

test("app-root slugs remain unambiguous", () => {
  assert.equal(organizationPath("inventory", "/inventory"), "/inventory/inventory");
  assert.equal(isOrganizationScopedPagePath("/inventory"), false);
  assert.equal(isOrganizationScopedPagePath("/inventory/dashboard"), true);
  assert.equal(stripOrganizationPathname("/inventory/dashboard"), "/dashboard");
});

test("organization names produce short URL-safe slugs", () => {
  assert.equal(slugifyOrganizationName("Werkstatt München"), "werkstatt-munchen");
  assert.equal(slugifyOrganizationName("Login"), "login-org");
  assert.equal(slugifyOrganizationName(organizationId), `${organizationId}-org`);
  assert.ok(slugifyOrganizationName("x".repeat(100)).length <= 48);
});

test("organization paths reject malformed tenant identifiers", () => {
  assert.throws(
    () => organizationPath("not_an_organization", "/dashboard"),
    /valid organization slug or UUID/,
  );
});
