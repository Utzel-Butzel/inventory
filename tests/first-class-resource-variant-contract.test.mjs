import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("migration installs a protected child-to-primary variant relation", async () => {
  const migration = await source(
    "db/migrations/0031_first_class_resource_variants.sql",
  );

  assert.match(
    migration,
    /INSERT INTO "relation_type_definitions"[\s\S]*'variant_of'[\s\S]*false, false, 15, true/,
  );
  assert.match(
    migration,
    /ON CONFLICT \("organization_id", "key"\) DO UPDATE SET[\s\S]*"allow_manual" = false[\s\S]*"is_system" = true/,
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "attributes" jsonb DEFAULT '\{\}'::jsonb NOT NULL/,
  );
  assert.match(migration, /jsonb_typeof\("attributes"\) = 'object'/);
  assert.match(migration, /overriddenFields/);

  // A variant is the source (child) of at most one variant_of edge. Multiple
  // variants may still target the same primary resource.
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "resource_relations_variant_source_unique"[\s\S]*\("organization_id", "source_resource_id"\)[\s\S]*WHERE "relation_type_key" = 'variant_of'/,
  );
  assert.doesNotMatch(
    migration,
    /resource_relations_variant_target_unique/,
  );
});

test("migration gives BOM rows stable slots and variants sparse per-slot changes", async () => {
  const migration = await source(
    "db/migrations/0031_first_class_resource_variants.sql",
  );

  assert.match(
    migration,
    /ALTER TABLE "bom_lines"[\s\S]*ADD COLUMN IF NOT EXISTS "slot_key" varchar\(80\)/,
  );
  assert.match(
    migration,
    /UPDATE "bom_lines"[\s\S]*SET "slot_key" = "id"::text[\s\S]*WHERE "slot_key" IS NULL/,
  );
  assert.match(migration, /ALTER COLUMN "slot_key" SET NOT NULL/);
  assert.match(
    migration,
    /"bom_lines_assembly_slot_unique"[\s\S]*\("assembly_resource_id", "slot_key"\)/,
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "variant_bom_overrides"/,
  );
  assert.match(migration, /"variant_resource_id" uuid NOT NULL/);
  assert.match(migration, /"slot_key" varchar\(80\) NOT NULL/);
  assert.match(migration, /"removed" boolean DEFAULT false NOT NULL/);
  assert.match(
    migration,
    /"variant_bom_overrides_variant_slot_unique"[\s\S]*\("variant_resource_id", "slot_key"\)/,
  );
  assert.match(
    migration,
    /"removed" AND "component_resource_id" IS NULL AND "quantity_per_assembly" IS NULL/,
  );
  assert.match(
    migration,
    /NOT "removed" AND "component_resource_id" IS NOT NULL[\s\S]*"quantity_per_assembly" > 0/,
  );
});

test("manufacturing resolves, saves, resets, and builds the effective variant BOM", async () => {
  const [assemblies, route] = await Promise.all([
    source("lib/assemblies.ts"),
    source("app/api/v1/resources/[id]/bom/route.ts"),
  ]);

  assert.match(
    assemblies,
    /applyVariantBomOverrides[\s\S]*origin: "inherited"[\s\S]*origin: "override"[\s\S]*origin: "variant"/,
  );
  assert.match(
    assemblies,
    /resolveEffectiveBomRecipe[\s\S]*readStoredBom[\s\S]*readVariantOverrides/,
  );
  assert.match(
    assemblies,
    /replaceBom[\s\S]*baseBySlot[\s\S]*removed: true[\s\S]*insert\(variantBomOverrides\)/,
  );
  assert.match(
    assemblies,
    /assertEffectiveBomGraphAcyclic[\s\S]*primaryByVariant[\s\S]*applyVariantBomOverrides/,
  );
  assert.match(
    assemblies,
    /buildAssembly[\s\S]*pg_advisory_xact_lock\(\$\{BOM_WRITE_LOCK_ID\}\)[\s\S]*resolveEffectiveBomRecipe/,
  );
  assert.match(
    assemblies,
    /resetVariantBomOverrides[\s\S]*delete\(variantBomOverrides\)/,
  );
  assert.match(route, /export async function DELETE/);
  assert.match(route, /resetVariantBomOverrides/);
});

test("detaching freezes inherited BOM while preserving the variant resource and operations", async () => {
  const [assemblies, familyRoute, familyManager, openapi] = await Promise.all([
    source("lib/assemblies.ts"),
    source("app/api/v1/resources/[id]/family/route.ts"),
    source("components/resource-family-manager.tsx"),
    source("public/openapi.yaml"),
  ]);

  const detachStart = assemblies.indexOf(
    "export async function detachResourceVariant",
  );
  const detachEnd = assemblies.indexOf("type BuildComponentDto", detachStart);
  const detach = assemblies.slice(detachStart, detachEnd);
  assert.notEqual(detachStart, -1);
  assert.notEqual(detachEnd, -1);

  const bomLock = detach.indexOf(
    "pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})",
  );
  const familyLock = detach.indexOf(
    "pg_advisory_xact_lock(${VARIANT_FAMILY_WRITE_LOCK_ID})",
  );
  const resolve = detach.indexOf("resolveEffectiveBomRecipe");
  const materialize = detach.indexOf("insert(bomLines)");
  const removeOverrides = detach.indexOf("delete(variantBomOverrides)");
  const removeMembership = detach.indexOf("delete(resourceRelations)");
  assert.ok(
    bomLock < familyLock &&
      familyLock < resolve &&
      resolve < materialize &&
      materialize < removeOverrides &&
      removeOverrides < removeMembership,
  );
  assert.match(detach, /recipe\.lines\.map/);
  assert.match(detach, /relationTypeKey, "variant_of"/);
  assert.match(detach, /changedFields: \["variantFamily", "bom"\]/);

  // Operational records already belong to the variant resource. Detachment
  // must not delete or re-parent any of them (or the resource itself).
  for (const preservedTable of [
    "stockMovements",
    "stockLocationBalances",
    "stockUnits",
    "assemblyBuilds",
    "assemblyBuildComponents",
    "resources",
  ]) {
    assert.doesNotMatch(
      detach,
      new RegExp(`\\.delete\\(${preservedTable}\\)`),
      preservedTable,
    );
  }
  assert.doesNotMatch(detach, /targetResourceId:\s*variantResourceId/);

  assert.match(familyRoute, /export async function DELETE/);
  assert.match(familyRoute, /"inventory\.update"/);
  assert.match(familyRoute, /detachResourceVariant/);
  assert.match(familyManager, /family\.detach\.confirm/);
  assert.match(
    familyManager,
    /`\/api\/v1\/resources\/\$\{resourceId\}\/family`[\s\S]*method: "DELETE"/,
  );
  assert.match(
    openapi,
    /summary: Detach a first-class variant[\s\S]*effective inherited bill of materials is materialized[\s\S]*manufacturing history stay attached/,
  );
});

test("family creation makes an ordinary zero-stock resource with its own operational state", async () => {
  const family = await source("lib/resource-families.ts");

  assert.match(
    family,
    /createResourceFamilyVariant[\s\S]*transaction[\s\S]*\.insert\(resources\)/,
  );
  assert.match(family, /name: options\.input\.name/);
  assert.match(family, /quantity: 0/);
  assert.match(family, /serialNumber: null/);
  assert.match(family, /relatedResourceIds: \[\]/);
  assert.match(family, /mapFeatures: \[\]/);
  assert.doesNotMatch(family, /quantity: primary\.quantity/);
  assert.doesNotMatch(family, /serialNumber: primary\.serialNumber/);
  assert.doesNotMatch(family, /relatedResourceIds: primary\.relatedResourceIds/);

  // Shared catalog data starts inherited, while stock settings belong to the
  // newly-created resource and can diverge afterwards.
  for (const inheritedField of [
    "description",
    "type",
    "valueCents",
    "currency",
    "tags",
    "categories",
    "customFields",
    "notes",
  ]) {
    assert.match(
      family,
      new RegExp(`${inheritedField}: primary\\.${inheritedField}`),
      inheritedField,
    );
  }
  assert.match(
    family,
    /resources_initialize_stock trigger already created this row[\s\S]*\.update\(stockSettings\)[\s\S]*eq\(stockSettings\.resourceId, created\.id\)/,
  );
  assert.doesNotMatch(
    family,
    /createResourceFamilyVariant[\s\S]*\.insert\(stockSettings\)/,
  );
});

test("family membership is a protected variant-to-primary edge and cannot nest", async () => {
  const family = await source("lib/resource-families.ts");

  assert.match(
    family,
    /\.insert\(resourceRelations\)[\s\S]*sourceResourceId: created\.id[\s\S]*targetResourceId: primary\.id[\s\S]*relationTypeKey: VARIANT_RELATION_TYPE/,
  );
  assert.match(
    family,
    /attributes: \{[\s\S]*overriddenFields: \[\][\s\S]*protected: true/,
  );
  assert.match(
    family,
    /eq\(resourceRelations\.sourceResourceId, primary\.id\)[\s\S]*eq\(resourceRelations\.relationTypeKey, VARIANT_RELATION_TYPE\)/,
  );
  assert.match(family, /variant families cannot be nested/i);
});

test("ordinary relationship APIs cannot create, enable, or delete variant family links", async () => {
  const [structure, organizations] = await Promise.all([
    source("lib/inventory-structure.ts"),
    source("lib/organizations.ts"),
  ]);

  assert.match(
    organizations,
    /key: "variant_of"[\s\S]*allowManual: false[\s\S]*isSystem: true/,
  );
  assert.match(
    structure,
    /if \(!relationType \|\| !relationType\.allowManual\)[\s\S]*allows manual assignments/,
  );
  assert.match(
    structure,
    /current\.key === "variant_of" && patch\.allowManual === true/,
  );
  assert.match(
    structure,
    /relation\?\.relationTypeKey === "variant_of"[\s\S]*Variant-family links are managed/,
  );
});

test("a primary resource cannot be deleted while first-class variants target it", async () => {
  const resources = await source("lib/resources.ts");
  const familyCheck = resources.indexOf(
    'eq(resourceRelations.relationTypeKey, "variant_of")',
    resources.indexOf("export async function deleteResource"),
  );
  const targetCheck = resources.indexOf(
    "eq(resourceRelations.targetResourceId, id)",
    familyCheck,
  );
  const blocked = resources.indexOf(
    'throw new Error("RESOURCE_HAS_FIRST_CLASS_VARIANTS")',
    targetCheck,
  );
  const deleteRow = resources.indexOf(".delete(resources)", blocked);

  assert.notEqual(familyCheck, -1);
  assert.notEqual(targetCheck, -1);
  assert.notEqual(blocked, -1);
  assert.notEqual(deleteRow, -1);
  assert.ok(familyCheck < targetCheck && targetCheck < blocked && blocked < deleteRow);
});

test("ordinary item edits maintain sparse catalog inheritance atomically", async () => {
  const resources = await source("lib/resources.ts");

  assert.match(
    resources,
    /pg_advisory_xact_lock\(\$\{VARIANT_FAMILY_WRITE_LOCK_ID\}\)/,
  );
  assert.match(
    resources,
    /findResourceVariantMembership\([\s\S]*current\.id[\s\S]*inheritedChangedFields/,
  );
  assert.match(
    resources,
    /isDeepStrictEqual\(proposed\[field\], primary\[field\]\)[\s\S]*overrides\.delete\(field\)[\s\S]*overrides\.add\(field\)/,
  );
  assert.match(
    resources,
    /targetResourceId, current\.id[\s\S]*VARIANT_RELATION_TYPE[\s\S]*overriddenFieldsFromAttributes/,
  );
  assert.match(
    resources,
    /options\.authorize\(variant, proposedVariant\)[\s\S]*propagatedVariantUpdates\.push/,
  );
  assert.match(
    resources,
    /inheritedFromResourceId: saved\.id/,
  );
});

test("generic relationship UI keeps variant_of inside the family panel", async () => {
  const manager = await source("components/resource-relations-manager.tsx");

  assert.match(
    manager,
    /relationType\.allowManual[\s\S]*relationType\.key !== "contains"[\s\S]*relationType\.key !== "variant_of"/,
  );
  assert.match(
    manager,
    /const others = relations\.filter\([\s\S]*relation\.relationTypeKey !== "contains"[\s\S]*relation\.relationTypeKey !== "variant_of"/,
  );
});

test("legacy bulk variants stay hidden by default and cannot be newly created here", async () => {
  const [page, legacyManager] = await Promise.all([
    source("app/(dashboard)/inventory/[id]/page.tsx"),
    source("components/resource-variants-manager.tsx"),
  ]);

  assert.match(
    page,
    /<ResourceVariantsManager[\s\S]*hideWhenEmpty[\s\S]*allowCreate=\{false\}/,
  );
  assert.match(
    legacyManager,
    /hideWhenEmpty[\s\S]*!loading[\s\S]*!error[\s\S]*data\?\.variants\.length[\s\S]*return null/,
  );
  assert.match(
    legacyManager,
    /canEdit && allowCreate && !formOpen/,
  );
});

test("the default first-class variant form asks only for identity fields", async () => {
  const manager = await source("components/resource-family-manager.tsx");

  assert.match(
    manager,
    /type CreateForm = \{[\s\S]*name: string;[\s\S]*sku: string;[\s\S]*barcode: string;[\s\S]*\};/,
  );
  assert.doesNotMatch(
    manager.match(/type CreateForm = \{[\s\S]*?\};/)?.[0] ?? "",
    /quantity|location|tracking|serial|component|relationship/i,
  );
  assert.match(manager, /family\?\.role !== "variant"/);
});
