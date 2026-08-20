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
    /selectedOrganization\?\.slug \?\? organization\.slug/,
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
  assert.match(proxy, /routedHeaders\(request, routeOrganizationReference\)/);
  assert.match(proxy, /response\.cookies\.set\(ORGANIZATION_COOKIE/);
  assert.match(auth, /\.get\(ORGANIZATION_ROUTE_HEADER\)/);
  assert.match(layout, /organizationIdentity\.organization\.slug/);
  assert.match(routing, /OrganizationRoutingProvider/);
  assert.match(routing, /organizationPath\(organizationSlug, href\)/);
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
  assert.match(manager, /organizations\.form\.slug/);
  assert.match(manager, /organizations\.form\.allowNegativeStock/);
  assert.match(manager, /allowNegativeStock: editingAllowNegativeStock/);
  assert.match(navigation, /href: "\/settings\/organization"/);
  assert.match(shell, /<OrganizationSwitcher/);
  assert.match(shell, /organizations\.length > 1/);
  assert.match(shell, /\{organization\.name\}/);
  assert.match(route, /identity\.permissions\.includes\("users\.manage"\)/);
  assert.match(route, /canManage:/);
  assert.match(openapi, /canManage:[\s\S]*type: boolean/);
});

test("the notification inbox uses the settings navigation shell", async () => {
  const [layout, sectionLayout, navigation] = await Promise.all([
    source("app/(dashboard)/notifications/layout.tsx"),
    source("components/settings-section-layout.tsx"),
    source("components/settings-navigation.tsx"),
  ]);

  assert.match(layout, /<SettingsSectionLayout/);
  assert.match(sectionLayout, /<SettingsNavigation/);
  assert.match(navigation, /activeHrefs: \["\/notifications"\]/);
});
