import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMigrationCsv,
  migrateInventoryRows,
  parseInventorySystem,
  parseMigrationCsv,
} from "../lib/inventory-migration.ts";

const read = (csv, system, currency) => {
  const { rows, mappings } = migrateInventoryRows(
    parseMigrationCsv(csv),
    system,
    currency,
  );
  return {
    mappings,
    items: rows
      .slice(1)
      .map((row) => ({
        line: row.line,
        ...Object.fromEntries(
          rows[0].cells.map((key, i) => [key, row.cells[i]]),
        ),
      })),
  };
};
const row = {
  id: "10000000-0000-4000-8000-000000000001",
  name: '=Laptop, "work"',
  description: "Portable computer",
  type: "object",
  status: "archived",
  sku: "LT-1",
  quantity: 1,
  location: "Home / Office",
  serial_number: "SN-001",
  value_cents: 12345,
  currency: "EUR",
  priority: 3,
  tags: '["IT","Office"]',
  categories: '[{"name":"Computers"}]',
  slugs: "[]",
  custom_fields: "{}",
  related_resource_ids: "[]",
  gps_latitude: null,
  gps_longitude: null,
  gps_altitude: null,
  map_features: "[]",
  notes: 'First line\nSecond "line"',
  created_at: new Date(),
  updated_at: new Date(),
  barcode: "001234",
};

test("external CSV reads BOM, tabs, semicolons, quoted delimiters and multiline data with original line numbers", () => {
  assert.deepEqual(
    parseMigrationCsv(
      '\uFEFFName;Notes\r\n"A;B";"one\r\ntwo"\r\nC;"said ""hi"""\r\n',
    ),
    [
      { cells: ["Name", "Notes"], line: 1 },
      { cells: ["A;B", "one\ntwo"], line: 2 },
      { cells: ["C", 'said "hi"'], line: 4 },
    ],
  );
  assert.deepEqual(parseMigrationCsv("Name\tNotes\nA\tB")[1].cells, ["A", "B"]);
  for (const csv of ['Name\n"oops', 'Name\n"a"b', 'Name\na"b', "Name\n\0"])
    assert.throws(() => parseMigrationCsv(csv));
  assert.throws(
    () => parseMigrationCsv(`Name\n${"x".repeat(100001)}`),
    /100,000/,
  );
});

test("Snipe-IT maps device identity, decimal prices and statuses while retaining custom/source columns", () => {
  const { items } = read(
    'Asset Tag;Name;Serial;Purchase Cost;Category;Status;ID;Warranty\nLT-1;Laptop;0012;"12,34";Laptops;Pending Repair;123;36 months',
    "snipe-it",
    "USD",
  );
  assert.equal(items[0].name, "Laptop");
  assert.equal(items[0].sku, "LT-1");
  assert.equal(items[0].serial_number, "0012");
  assert.equal(items[0].value_cents, "1234");
  assert.equal(items[0].currency, "USD");
  assert.equal(items[0].quantity, "1");
  assert.equal(items[0].status, "maintenance");
  assert.deepEqual(JSON.parse(items[0].categories), ["Laptops"]);
  assert.match(items[0].notes, /ID: 123/);
  assert.match(items[0].notes, /Warranty: 36 months/);
  assert.equal(
    read("Model Name,Asset Tag\nModel,A1", "snipe-it").items[0].name,
    "Model",
  );
  const unknown = read("Name,Status\nA,Custom status", "snipe-it").items[0];
  assert.equal(unknown.status, "available");
  assert.match(unknown.notes, /Custom status/);
});

test("Homebox maps legacy labels, archive flags and asset IDs; preserves nested paths and custom fields", () => {
  const { items } = read(
    "HB.name,HB.quantity,HB.asset_id,HB.labels,HB.archived,HB.location,HB.field.Owner,HB.import_ref\nDrill,5,000-123,Tools;Workshop,true,Home / Garage,Sam,external-1",
    "homebox",
  );
  assert.equal(items[0].quantity, "5");
  assert.equal(items[0].sku, "000-123");
  assert.equal(items[0].location, "Home / Garage");
  assert.equal(items[0].status, "archived");
  assert.deepEqual(JSON.parse(items[0].tags), ["Tools", "Workshop"]);
  assert.match(items[0].notes, /HB.field.Owner: Sam/);
  assert.match(items[0].notes, /HB.import_ref: external-1/);
});

test("rejects ambiguous mappings, missing names, extra cells, invalid prices and booleans", () => {
  for (const csv of [
    "Name,Name\nA,B",
    "Name,Asset Name\nA,B",
    "ID\n1",
    "Name\nA,B",
    "Name,Purchase Cost\nA,NaN",
    "Name,Purchase Cost\nA,1.234",
    "Name,Purchase Cost\nA,20000000.01",
  ])
    assert.throws(() => read(csv, "snipe-it"));
  assert.throws(() => read("HB.name,HB.archived\nA,maybe", "homebox"));
  assert.throws(() => read("Name\nA", "snipe-it", "EURO"));
  assert.equal(parseInventorySystem(null), "open-inventory");
  assert.equal(parseInventorySystem("bad"), null);
});

test("Homebox export round trip retains basic inventory fields and formula text", () => {
  const csv = buildMigrationCsv([row], "homebox");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=Laptop"));
  const imported = read(csv, "homebox").items[0];
  for (const field of [
    "name",
    "description",
    "sku",
    "location",
    "serial_number",
    "barcode",
    "currency",
    "status",
    "tags",
  ])
    assert.equal(imported[field], row[field], field);
  assert.equal(imported.value_cents, "12345");
  assert.equal(imported.quantity, "1");
  assert.match(imported.notes, /Second "line"/);
  assert.match(imported.notes, /open-inventory:10000000/);
  const withAssetId = csv
    .replace('"HB.import_ref",', '"HB.asset_id","HB.import_ref",')
    .replace('"open-inventory:', '"000-999","open-inventory:');
  const value = read(withAssetId, "homebox").items[0];
  assert.equal(value.sku, "LT-1");
  assert.match(value.notes, /HB.asset_id: 000-999/);
});

test("Snipe-IT export supplies required creation columns, guards formulas, keeps value and category", () => {
  const csv = buildMigrationCsv([row], "snipe-it");
  const parsed = parseMigrationCsv(csv);
  assert.ok(parsed[0].cells.includes("Model Name"));
  assert.ok(parsed[0].cells.includes("Status"));
  assert.equal(parsed[1].cells[3], "Computers");
  assert.equal(parsed[1].cells[7], "123.45");
  const imported = read(csv, "snipe-it").items[0];
  assert.equal(imported.name, row.name);
  assert.equal(imported.status, "archived");
  assert.equal(imported.value_cents, "12345");
  assert.match(
    buildMigrationCsv([{ ...row, sku: null, categories: "[]" }], "snipe-it"),
    /OI-10000000/,
  );
});

test("exports fail visibly instead of silently losing aggregate quantity, long text or tag separators", () => {
  for (const quantity of [0, 2, 1000000])
    assert.throws(
      () => buildMigrationCsv([{ ...row, quantity }], "snipe-it"),
      /exactly one unit/,
    );
  assert.throws(
    () => buildMigrationCsv([{ ...row, notes: "a".repeat(1001) }], "homebox"),
    /portable CSV limits/,
  );
  assert.throws(
    () =>
      buildMigrationCsv([{ ...row, description: "a".repeat(256) }], "homebox"),
    /portable CSV limits/,
  );
  assert.throws(
    () => buildMigrationCsv([{ ...row, tags: '["A;B"]' }], "homebox"),
    /semicolon/,
  );
});
