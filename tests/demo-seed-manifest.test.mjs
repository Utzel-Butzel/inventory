import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEMO_ASSIGNMENTS,
  DEMO_LABEL_SETUP,
  DEMO_MEDIA,
  DEMO_ORGANIZATION,
  DEMO_PURCHASE_ORDER_LINES,
  DEMO_RESOURCES,
  DEMO_STOCK_MOVEMENTS,
  DEMO_STOCK_SETTINGS,
  DEMO_STOCK_UNITS,
  DEMO_USER,
  VIEWER_PERMISSIONS,
  validateDemoRemovalState,
  validateDemoSeedManifest,
} from "../scripts/demo-seed-manifest.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("demo manifest is coherent, fixed, and read-only by contract", () => {
  assert.deepEqual(validateDemoSeedManifest(), []);
  assert.equal(DEMO_ORGANIZATION.id, "d3e00000-0000-4000-8000-000000000001");
  assert.equal(DEMO_ORGANIZATION.name, "Werkstatt Nord · Demo");
  assert.equal(DEMO_ORGANIZATION.slug, "demo");
  assert.equal(DEMO_ORGANIZATION.isReadOnly, true);
  assert.deepEqual(DEMO_USER, {
    id: "d3e00000-0000-4000-8000-000000000002",
    email: "demo@inventory.invalid",
    name: "Demo-Besucher",
    role: "viewer",
  });
  assert.deepEqual(VIEWER_PERMISSIONS, [
    "inventory.read",
    "stock.read",
    "assignments.read",
    "counts.read",
    "spatial.read",
    "orders.read",
    "workflows.read",
    "labels.read",
  ]);
});

test("workshop scenario covers stock, custody, maintenance, ordering, and labels", () => {
  const items = DEMO_RESOURCES.filter(({ kind }) => kind === "item");
  const places = DEMO_RESOURCES.filter(({ kind }) => kind === "place");
  assert.deepEqual(places.map(({ name }) => name), [
    "Regal A2",
    "Werkbank E1",
    "Fach K3",
  ]);
  assert.deepEqual(items.map(({ name }) => name), [
    "Akku-Bohrschrauber 18 V",
    "Lötstation 80 W",
    "Digitalmultimeter TRMS",
    "Schrauben M4×20",
    "Kabelbinder 200 mm schwarz",
  ]);

  const drill = items.find(({ sku }) => sku === "WERK-ABS-18V");
  const drillUnits = DEMO_STOCK_UNITS.filter(
    ({ resourceId }) => resourceId === drill.id,
  );
  assert.equal(drill.quantity, 1);
  assert.deepEqual(drillUnits.map(({ status }) => status).sort(), [
    "available",
    "in-use",
  ]);
  assert.equal(DEMO_ASSIGNMENTS[0].assigneeLabel, "Projekt Lastenrad");

  const meter = items.find(({ sku }) => sku === "MESS-DMM-TRMS");
  assert.equal(meter.status, "maintenance");
  assert.equal(
    DEMO_STOCK_UNITS.find(({ resourceId }) => resourceId === meter.id).status,
    "maintenance",
  );

  const screws = items.find(({ sku }) => sku === "VERB-M4X20-A2");
  const screwHistory = DEMO_STOCK_MOVEMENTS.filter(
    ({ resourceId }) => resourceId === screws.id,
  );
  assert.deepEqual(screwHistory.map(({ delta }) => delta), [200, -74]);
  assert.equal(screws.quantity, 126);

  const cableTies = items.find(({ sku }) => sku === "VERB-KB-200-S");
  const cableSettings = DEMO_STOCK_SETTINGS.find(
    ({ resourceId }) => resourceId === cableTies.id,
  );
  assert.ok(cableTies.quantity < cableSettings.minimumStock);
  assert.equal(
    DEMO_PURCHASE_ORDER_LINES.find(
      ({ resourceId }) => resourceId === cableTies.id,
    ).orderedQuantity,
    100,
  );
  assert.equal(DEMO_LABEL_SETUP.widthMm, 62);
  assert.equal(DEMO_LABEL_SETUP.heightMm, 35);
});

test("rollback policy handles partial and colliding fixed identities fail-closed", () => {
  const configuration = { slug: "demo", email: "demo@inventory.invalid" };
  const organization = {
    id: DEMO_ORGANIZATION.id,
    name: DEMO_ORGANIZATION.name,
    slug: configuration.slug,
    is_read_only: true,
  };
  const user = {
    id: DEMO_USER.id,
    email: configuration.email,
    name: DEMO_USER.name,
    role: "viewer",
  };
  const organizationMembership = {
    user_id: DEMO_USER.id,
    role_key: "viewer",
    is_active: true,
  };
  const userMembership = {
    organization_id: DEMO_ORGANIZATION.id,
    role_key: "viewer",
    is_active: true,
  };
  const validate = (patch = {}) =>
    validateDemoRemovalState({
      configuration,
      organization: null,
      user: null,
      organizationMemberships: [],
      userMemberships: [],
      ...patch,
    });

  assert.deepEqual(validate(), []);
  assert.deepEqual(validate({ organization }), []);
  assert.deepEqual(validate({ user }), []);
  assert.deepEqual(
    validate({
      organization,
      user,
      organizationMemberships: [organizationMembership],
      userMemberships: [userMembership],
    }),
    [],
  );

  assert.ok(
    validate({ user: { ...user, email: "collision@example.invalid" } }).length > 0,
    "a colliding fixed user must not be removed when the organization is absent",
  );
  assert.ok(
    validate({
      organization: { ...organization, name: "Unrelated organization" },
    }).length > 0,
    "a colliding fixed organization must not be removed when the user is absent",
  );
  assert.ok(
    validate({ organization, organizationMemberships: [organizationMembership] })
      .length > 0,
    "an organization with a foreign or dangling membership must not be removed",
  );
  assert.ok(
    validate({ user, userMemberships: [{ ...userMembership, organization_id: "00000000-0000-4000-8000-000000000001" }] })
      .length > 0,
    "a fixed user with another membership must not be removed",
  );
});

test("bundled demo media exactly matches the documented checksums", async () => {
  for (const media of DEMO_MEDIA) {
    const contents = await readFile(
      path.join(repositoryRoot, "demo/assets", media.filename),
    );
    assert.equal(
      createHash("sha256").update(contents).digest("hex"),
      media.sha256,
      media.filename,
    );
  }
});

test("seed is opt-in, transactional, reconciling, and marks read-only last", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "scripts/seed-demo.mjs"),
    "utf8",
  );
  assert.match(source, /DEMO_ACCESS_ENABLED/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /SELECT\s+count\(\*\).*resources/is);
  assert.ok((source.match(/ON CONFLICT/g) ?? []).length >= 15);
  assert.match(
    source,
    /DELETE FROM stock_movements[\s\S]*type = 'opening_balance'[\s\S]*created_by = \$\{DEMO_ACTOR\}/,
  );

  const seedStart = source.indexOf("async function seedDemo");
  const seedEnd = source.indexOf("async function removeDemo");
  const seedBody = source.slice(seedStart, seedEnd);
  const readOnlyUpdate = seedBody.lastIndexOf("SET is_read_only = true");
  assert.ok(readOnlyUpdate > seedBody.lastIndexOf("INSERT INTO"));
  assert.ok(readOnlyUpdate > seedBody.lastIndexOf("DELETE FROM"));
});

test("cleanup is fixed-ID and fail-closed instead of deleting by slug", async () => {
  const source = await readFile(
    path.join(repositoryRoot, "scripts/seed-demo.mjs"),
    "utf8",
  );
  const removeStart = source.indexOf("async function removeDemo");
  const removeBody = source.slice(removeStart);
  assert.match(removeBody, /WHERE id = \$\{DEMO_ORGANIZATION\.id\}/);
  assert.match(removeBody, /validateDemoRemovalState/);
  assert.doesNotMatch(removeBody, /DELETE FROM organizations\s+WHERE slug/is);
  assert.doesNotMatch(removeBody, /DELETE FROM users\s+WHERE email/is);
  assert.match(source, /localMediaPath\(asset\.filename\)/);
});

test("production startup and image contain the opt-in seed inputs", async () => {
  const [startup, dockerfile, packageJson] = await Promise.all([
    readFile(path.join(repositoryRoot, "scripts/start-production.mjs"), "utf8"),
    readFile(path.join(repositoryRoot, "Dockerfile"), "utf8"),
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ]);
  assert.match(startup, /demoAccessEnabled === "true"/);
  assert.match(startup, /import\("\.\/seed-demo\.mjs"\)/);
  assert.match(dockerfile, /\/app\/demo \.\/demo/);
  assert.match(dockerfile, /scripts\/seed-demo\.mjs/);
  const scripts = JSON.parse(packageJson).scripts;
  assert.equal(scripts["db:seed:demo"], "node scripts/seed-demo.mjs");
  assert.equal(
    scripts["db:seed:demo:remove"],
    "node scripts/seed-demo.mjs --remove",
  );
});
