import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("organization switching uses the scoped selection endpoint and clears client state", async () => {
  const switcher = await source("components/organization-switcher.tsx");

  assert.match(switcher, /fetch\("\/api\/v1\/organizations\/select"/);
  assert.match(switcher, /JSON\.stringify\(\{ organizationId \}\)/);
  assert.match(
    switcher,
    /window\.location\.assign\(organizationPath\(organizationId, "\/dashboard"\)\)/,
  );
});

test("web organization routing makes the URL tenant context authoritative", async () => {
  const [proxy, auth, layout, routing] = await Promise.all([
    source("proxy.ts"),
    source("lib/api-auth.ts"),
    source("app/(dashboard)/layout.tsx"),
    source("components/organization-routing.tsx"),
  ]);

  assert.match(proxy, /NextResponse\.rewrite/);
  assert.match(proxy, /routedHeaders\(request, routeOrganizationId\)/);
  assert.match(proxy, /response\.cookies\.set\(ORGANIZATION_COOKIE/);
  assert.match(auth, /headers\(\)\)\.get\(ORGANIZATION_HEADER\)/);
  assert.match(layout, /organizationPath\(identity\.organizationId/);
  assert.match(routing, /OrganizationRoutingProvider/);
  assert.match(routing, /organizationPath\(organizationId, href\)/);
});

test("organization settings use the list, create, and update contracts", async () => {
  const [manager, navigation, shell, route, openapi] = await Promise.all([
    source("components/organization-manager.tsx"),
    source("components/settings-navigation.tsx"),
    source("components/app-shell.tsx"),
    source("app/api/v1/organizations/route.ts"),
    source("public/openapi.yaml"),
  ]);

  assert.match(manager, /fetch\("\/api\/v1\/organizations"/);
  assert.match(manager, /method: "POST"/);
  assert.match(manager, /`\/api\/v1\/organizations\/\$\{encodeURIComponent\(organization\.id\)\}`/);
  assert.match(manager, /method: "PATCH"/);
  assert.match(navigation, /href: "\/settings\/organization"/);
  assert.match(shell, /<OrganizationSwitcher/);
  assert.match(shell, /\{organization\.name\}/);
  assert.match(route, /identity\.permissions\.includes\("users\.manage"\)/);
  assert.match(route, /canManage:/);
  assert.match(openapi, /canManage:[\s\S]*type: boolean/);
});
