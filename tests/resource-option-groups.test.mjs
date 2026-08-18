import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("migration stores tenant-safe option definitions, combinations, and selections", async () => {
  const migration = await source("db/migrations/0032_resource_option_groups.sql");

  for (const table of [
    "resource_option_groups",
    "resource_option_values",
    "resource_option_configurations",
    "resource_option_selections",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
  assert.match(
    migration,
    /resource_option_groups_primary_bom_slot_unique[\s\S]*WHERE "bom_slot_key" IS NOT NULL/,
  );
  assert.match(
    migration,
    /resource_option_values_group_default_unique[\s\S]*WHERE "is_default"/,
  );
  assert.match(
    migration,
    /resource_option_configurations_signature_unique[\s\S]*\("primary_resource_id", "signature"\)/,
  );
  assert.match(
    migration,
    /resource_option_selections_organization_group_fk[\s\S]*resource_option_groups"\("organization_id", "id"\)/,
  );
  assert.match(
    migration,
    /resource_option_selections_group_value_fk[\s\S]*resource_option_values"\("group_id", "id"\)/,
  );
});

test("option selections cascade when their owning option data is deleted", async () => {
  const [migration, schema] = await Promise.all([
    source("db/migrations/0033_option_selection_cascades.sql"),
    source("db/schema.ts"),
  ]);

  for (const constraint of [
    "resource_option_selections_group_id_fkey",
    "resource_option_selections_value_id_fkey",
    "resource_option_selections_organization_group_fk",
    "resource_option_selections_group_value_fk",
  ]) {
    assert.match(
      migration,
      new RegExp(`${constraint}[\\s\\S]*ON DELETE CASCADE`),
    );
  }
  assert.match(
    schema,
    /groupId: uuid\("group_id"\)[\s\S]*resourceOptionGroups\.id, \{ onDelete: "cascade" \}/,
  );
  assert.match(
    schema,
    /valueId: uuid\("value_id"\)[\s\S]*resourceOptionValues\.id, \{ onDelete: "cascade" \}/,
  );
  assert.match(
    schema,
    /resource_option_selections_organization_group_fk[\s\S]*\.onDelete\("cascade"\)/,
  );
  assert.match(
    schema,
    /resource_option_selections_group_value_fk[\s\S]*\.onDelete\("cascade"\)/,
  );
});

test("resource deletion prunes only safe unused option-component values", async () => {
  const [resources, route] = await Promise.all([
    source("lib/resources.ts"),
    source("app/api/v1/resources/[id]/route.ts"),
  ]);
  const start = resources.indexOf("export async function deleteResource");
  const deletion = resources.slice(start, resources.indexOf("export async function getDashboardStats", start));

  const bomLock = deletion.indexOf("pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})");
  const familyLock = deletion.indexOf(
    "pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})",
  );
  const selectionGuard = deletion.indexOf("RESOURCE_USED_BY_OPTION_SELECTION");
  const cardinalityGuard = deletion.indexOf("RESOURCE_REQUIRED_BY_OPTION_GROUP");
  const deleteOptionValues = deletion.indexOf(".delete(resourceOptionValues)");
  const deleteResourceRow = deletion.indexOf(".delete(resources)");

  assert.ok(bomLock >= 0 && bomLock < familyLock);
  assert.ok(selectionGuard >= 0 && selectionGuard < deleteOptionValues);
  assert.ok(cardinalityGuard >= 0 && cardinalityGuard < deleteOptionValues);
  assert.ok(deleteOptionValues < deleteResourceRow);
  assert.match(route, /RESOURCE_USED_BY_OPTION_SELECTION[\s\S]*status: 409/);
  assert.match(route, /RESOURCE_REQUIRED_BY_OPTION_GROUP[\s\S]*status: 409/);
});

test("generation materializes the Cartesian product as ordinary first-class resources", async () => {
  const options = await source("lib/resource-options.ts");
  const start = options.indexOf("export async function generateResourceOptionVariants");
  assert.notEqual(start, -1);
  const generation = options.slice(start);

  const bomLock = generation.indexOf("pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})");
  const familyLock = generation.indexOf(
    "pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})",
  );
  const resourceLock = generation.indexOf('.for("update")');
  assert.ok(bomLock < familyLock && familyLock < resourceLock);
  assert.match(generation, /cartesianChoices\(groups\)/);
  assert.match(generation, /choices\.every\(\(\{ value \}\) => value\.isDefault\)/);
  assert.match(generation, /\.insert\(resources\)/);
  assert.match(generation, /quantity: 0/);
  assert.match(generation, /location: null/);
  assert.match(generation, /serialNumber: null/);
  assert.match(generation, /relatedResourceIds: \[\]/);
  assert.match(generation, /\.update\(stockSettings\)/);
  assert.match(
    generation,
    /sourceResourceId: created\.id[\s\S]*targetResourceId: primary\.id[\s\S]*protected: true/,
  );
  assert.match(options, /insertConfiguration[\s\S]*resourceOptionSelections/);
  assert.match(generation, /\.insert\(variantBomOverrides\)/);
  assert.match(generation, /assertCurrentEffectiveBomGraphAcyclic/);
});

test("BOM-mapped groups preserve the primary default and create sparse swaps", async () => {
  const [options, assemblies] = await Promise.all([
    source("lib/resource-options.ts"),
    source("lib/assemblies.ts"),
  ]);

  assert.match(
    options,
    /defaultValue\.componentResourceId !== base\.componentResourceId[\s\S]*must match the primary BOM/,
  );
  assert.match(
    options,
    /base\.componentResourceId === value\.componentResourceId[\s\S]*return \[\]/,
  );
  assert.match(
    assemblies,
    /resourceOptionGroups[\s\S]*mappedDefaults[\s\S]*cannot be removed[\s\S]*must match its mapped BOM slot/,
  );
  assert.match(
    assemblies,
    /readOptionControlledBomLines[\s\S]*follows its selected option/,
  );
  assert.match(
    assemblies,
    /syncOptionBomOverridesForPrimary[\s\S]*quantityPerAssembly: line\.quantityPerAssembly/,
  );
});

test("manual family creation is disabled while option groups own the family", async () => {
  const [family, manager] = await Promise.all([
    source("lib/resource-families.ts"),
    source("components/resource-family-manager.tsx"),
  ]);

  assert.match(
    family,
    /select\(\{ id: resourceOptionGroups\.id \}\)[\s\S]*This family uses option groups/,
  );
  assert.match(family, /optionGroupCount/);
  assert.match(manager, /family\?\.optionGroupCount === 0/);
  assert.match(manager, /resource-family-changed/);
});

test("detaching removes option identity but preserves every operational record", async () => {
  const assemblies = await source("lib/assemblies.ts");
  const start = assemblies.indexOf("export async function detachResourceVariant");
  const end = assemblies.indexOf("type BuildComponentDto", start);
  const detach = assemblies.slice(start, end);

  assert.match(detach, /delete\(resourceOptionConfigurations\)/);
  assert.match(detach, /delete\(resourceRelations\)/);
  for (const preserved of [
    "stockMovements",
    "stockLocationBalances",
    "stockUnits",
    "assemblyBuilds",
    "assemblyBuildComponents",
    "resources",
  ]) {
    assert.doesNotMatch(detach, new RegExp(`\\.delete\\(${preserved}\\)`));
  }
});

test("the default UI is collapsed and expands to a guarded editor and generator", async () => {
  const [component, page, route] = await Promise.all([
    source("components/resource-option-groups-manager.tsx"),
    source("app/(dashboard)/inventory/[id]/page.tsx"),
    source("app/api/v1/resources/[id]/options/route.ts"),
  ]);

  assert.match(page, /<ResourceOptionGroupsManager/);
  assert.match(component, /useState\(false\)/);
  assert.match(component, /aria-expanded=\{expanded\}/);
  assert.match(component, /options\.editor\.help/);
  assert.match(component, /options\.actions\.generate/);
  assert.match(component, /resource-family-changed/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function POST/);
  assert.match(route, /"inventory\.create"/);
  assert.match(route, /canAccessResource[\s\S]*"inventory\.update"/);
});

test("stock pages select a readable materialized configuration before booking", async () => {
  const [options, switcher, stockManager, openapi] = await Promise.all([
    source("lib/resource-options.ts"),
    source("components/resource-stock-configuration-switcher.tsx"),
    source("components/resource-stock-manager.tsx"),
    source("public/openapi.yaml"),
  ]);

  assert.match(options, /configurationResources\.map\(async \(resource\)/);
  assert.match(options, /await options\.authorize!\(resource\)/);
  assert.match(options, /accessibleConfigurations/);
  assert.match(options, /configurations: configurationDtos/);
  assert.match(options, /resourceName: resource\.name/);
  assert.match(options, /selection: groups\.flatMap/);

  assert.match(switcher, /\/api\/v1\/resources\/\$\{resourceId\}\/options/);
  assert.match(switcher, /\/api\/v1\/resources\/\$\{resourceId\}\/family/);
  assert.match(switcher, /useOrganizationHref/);
  assert.match(
    switcher,
    /router\.push\([\s\S]*\/inventory\/\$\{nextResourceId\}\/stock/,
  );
  assert.match(switcher, /configurations\.length < 2/);
  assert.match(switcher, /resource\.configuration\.help/);
  assert.match(switcher, /resource\.configuration\.movementHelp/);
  assert.match(stockManager, /<ResourceStockConfigurationSwitcher[\s\S]*placement="movement"/);

  assert.match(
    openapi,
    /ResourceOptions:[\s\S]*required: \[role, currentResourceId, primary, groups, configurations,/,
  );
  assert.match(openapi, /Materialized configurations whose inventory items the caller may read/);
});
