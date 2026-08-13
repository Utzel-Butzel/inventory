import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("access role collection operations stay inside the active organization", async () => {
  const route = await read("../app/api/access/roles/route.ts");

  assert.match(route, /identity\.organizationId/);
  assert.match(route, /listAccessRolesWithCounts\(organizationId\)/);
  assert.match(
    route,
    /eq\(inventoryAccessRules\.organizationId, organizationId\)/,
  );
  assert.match(route, /\.values\(\{[\s\S]*organizationId,/);
  assert.match(
    route,
    /target: \[accessRoles\.organizationId, accessRoles\.key\]/,
  );
});

test("access role detail operations scope lookups, membership checks, and writes", async () => {
  const route = await read("../app/api/access/roles/[key]/route.ts");

  assert.ok(
    route.match(/eq\(accessRoles\.organizationId, organizationId\)/g)?.length >= 4,
  );
  assert.ok(
    route.match(/eq\(inventoryAccessRules\.organizationId, organizationId\)/g)
      ?.length >= 2,
  );
  assert.match(route, /from\(organizationMemberships\)/);
  assert.match(
    route,
    /eq\(organizationMemberships\.organizationId, organizationId\)/,
  );
  assert.match(route, /revokeApiTokensForRoles\(\[key\], organizationId\)/);
  assert.doesNotMatch(route, /from\(users\)/);
});

test("access rule operations scope role references and direct rule IDs", async () => {
  const [collection, detail] = await Promise.all([
    read("../app/api/access/rules/route.ts"),
    read("../app/api/access/rules/[id]/route.ts"),
  ]);

  assert.match(collection, /identity\.organizationId/);
  assert.match(collection, /eq\(accessRoles\.organizationId, organizationId\)/);
  assert.match(
    collection,
    /eq\(inventoryAccessRules\.organizationId, organizationId\)/,
  );
  assert.match(collection, /\.values\(\{[\s\S]*organizationId,/);
  assert.match(
    collection,
    /revokeApiTokensForRoles\(\[rule\.roleKey\], organizationId\)/,
  );

  assert.ok(
    detail.match(/eq\(inventoryAccessRules\.organizationId, organizationId\)/g)
      ?.length >= 6,
  );
  assert.ok(
    detail.match(/eq\(accessRoles\.organizationId, organizationId\)/g)?.length >= 2,
  );
  assert.doesNotMatch(
    detail,
    /\.where\(eq\(inventoryAccessRules\.id, id\.data\)\)/,
  );
  assert.match(
    detail,
    /revokeApiTokensForRoles\(\[existing\.roleKey, rule\.roleKey\], organizationId\)/,
  );
  assert.match(
    detail,
    /revokeApiTokensForRoles\(\[rule\.roleKey\], organizationId\)/,
  );
});

test("tenant access helpers require an explicit organization at every call site", async () => {
  const accessControl = await read("../lib/access-control.ts");

  assert.doesNotMatch(accessControl, /DEFAULT_ORGANIZATION_ID/);
  for (const helper of [
    "getEffectiveRole",
    "listAccessRolesWithCounts",
    "getResourceRecord",
    "getResourceRecords",
    "listRulesForRole",
    "conditionalScopesForRole",
    "revokeApiTokensForRoles",
  ]) {
    const declaration = accessControl.match(
      new RegExp(`export async function ${helper}\\([\\s\\S]*?\\n\\) \\{`),
    )?.[0];
    assert.ok(declaration, `${helper} must remain an exported async helper`);
    assert.match(
      declaration,
      /organizationId: string/,
      `${helper} must require an organization id`,
    );
    assert.doesNotMatch(
      declaration,
      /organizationId\s*=/,
      `${helper} must not silently fall back to another tenant`,
    );
  }
});

test("organization admins cannot list or revoke account-owned native tokens", async () => {
  const [collection, detail, accessControl, userDetail] = await Promise.all([
    read("../app/api/tokens/route.ts"),
    read("../app/api/tokens/[id]/route.ts"),
    read("../lib/access-control.ts"),
    read("../app/api/users/[id]/route.ts"),
  ]);

  assert.match(collection, /isNull\(apiTokens\.userId\)/);
  assert.match(detail, /isNull\(apiTokens\.userId\)/);
  assert.match(accessControl, /Authorization is recomputed/);
  assert.doesNotMatch(accessControl, /update\(apiTokens\)/);
  assert.doesNotMatch(userDetail, /const tokenCondition/);
});

test("bulk, merge, recognition, and dashboard reads use the active organization", async () => {
  const [duplicates, batch, recognition, details, stock, edit] = await Promise.all([
    read("../app/api/v1/duplicates/route.ts"),
    read("../app/api/v1/resources/batch/route.ts"),
    read("../app/api/v1/ai/recognize/route.ts"),
    read("../app/(dashboard)/inventory/[id]/page.tsx"),
    read("../app/(dashboard)/inventory/[id]/stock/page.tsx"),
    read("../app/(dashboard)/inventory/[id]/edit/page.tsx"),
  ]);

  assert.match(
    duplicates,
    /getResourceRecords\([\s\S]*authorization\.identity\.organizationId,[\s\S]*\)/,
  );
  assert.match(
    batch,
    /getResourceRecords\([\s\S]*authorization\.identity\.organizationId,[\s\S]*\)/,
  );
  assert.match(
    recognition,
    /listRulesForRole\([\s\S]*authorization\.identity\.role,[\s\S]*authorization\.identity\.organizationId,[\s\S]*\)/,
  );
  for (const page of [details, stock, edit]) {
    assert.match(page, /getResourceRecord\(id, identity\.organizationId\)/);
  }
});
