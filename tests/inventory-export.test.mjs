import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";

import {
  buildInventoryCsv,
  buildInventoryPdf,
  buildInventoryXlsx,
  INVENTORY_EXPORT_HEADERS,
  inventoryExportRow,
  parseInventoryExportOptions,
} from "../lib/inventory-export.ts";

const generatedAt = new Date("2026-08-13T10:15:00.000Z");
const variants = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    resourceId: "10000000-0000-4000-8000-000000000001",
    name: "Grün / 5 m",
    sku: "CABLE-GRN-5",
    barcode: "4012345678901",
    priceCents: 1599,
    currency: "EUR",
    quantity: 4,
    position: 0,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  },
];

const sampleResources = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Verlängerungskabel, extra robust",
    description: "Für Werkstatt und Außenbereich; 25 m.",
    type: "tool",
    status: "available",
    sku: "CABLE-25",
    quantity: 7,
    location: "Werkstatt / Regal A / Fach 12",
    serialNumber: null,
    barcode: "4006381333931",
    valueCents: 4299,
    currency: "EUR",
    priority: 2,
    tags: ["Elektro", "Außen"],
    categories: [{ id: "energy", label: "Energie" }],
    customFields: { prüfung: "2027-04-03", anmerkung: "=HYPERLINK(\"bad\")" },
    relatedResourceIds: [],
    gpsLatitude: 52.520008,
    gpsLongitude: 13.404954,
    gpsAltitude: 34.2,
    mapFeatures: [],
    notes: "+Formelverdacht",
    createdAt: new Date("2026-01-02T09:30:00.000Z"),
    updatedAt: new Date("2026-08-12T16:45:00.000Z"),
    variants,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Schwerlastregal mit sehr langem Namen zur Prüfung des Tabellenumbruchs",
    description: "Ein langer Beschreibungstext, der kontrolliert umbrechen soll.",
    type: "furniture",
    status: "maintenance",
    sku: null,
    quantity: 2,
    location: "Lagerhalle Nord / Ebene 2 / Bereich mit langem Standortnamen",
    serialNumber: "SER-0002",
    barcode: null,
    valueCents: 125000,
    currency: "EUR",
    priority: 4,
    tags: [],
    categories: [],
    customFields: {},
    relatedResourceIds: ["10000000-0000-4000-8000-000000000001"],
    gpsLatitude: null,
    gpsLongitude: null,
    gpsAltitude: null,
    mapFeatures: [],
    notes: "Regelmäßig auf Schäden prüfen.",
    createdAt: new Date("2025-12-11T08:00:00.000Z"),
    updatedAt: new Date("2026-08-10T11:30:00.000Z"),
    variants: [],
  },
];

const rows = sampleResources.map(inventoryExportRow);

test("keeps CSV as the default export and validates requested formats", () => {
  assert.deepEqual(
    parseInventoryExportOptions("https://inventory.test/api/v1/resources/export"),
    { format: "csv", locale: "en" },
  );
  assert.deepEqual(
    parseInventoryExportOptions(
      "https://inventory.test/api/v1/resources/export?format=XLSX&lang=de-DE",
    ),
    { format: "xlsx", locale: "de" },
  );
  assert.equal(
    parseInventoryExportOptions(
      "https://inventory.test/api/v1/resources/export?format=docx",
    ),
    null,
  );
});

test("CSV retains the established columns, escapes formulas, and includes variants", () => {
  const csv = buildInventoryCsv(rows);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.endsWith("\r\n"));
  assert.ok(csv.includes('"id","name","description"'));
  assert.ok(csv.includes('"updated_at","barcode","variants"'));
  assert.ok(csv.includes("4006381333931"));
  assert.ok(csv.includes("'+Formelverdacht"));
  assert.ok(csv.includes("Grün / 5 m"));
  assert.equal(INVENTORY_EXPORT_HEADERS.at(-1), "variants");
});

test("the app accepts its export-only variants column on CSV re-import", async () => {
  const [serverImporter, clientImporter] = await Promise.all([
    readFile(new URL("../app/api/v1/resources/import/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/csv-import-export.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(
    serverImporter,
    /readOnlyHeaders\s*=\s*\[[^\]]*"variants"[^\]]*\]/s,
  );
  assert.match(
    clientImporter,
    /supportedHeaders\s*=\s*new Set\(\[[^\]]*"variants"[^\]]*\]\)/s,
  );
});

test("XLSX is typed, filterable, frozen, and contains a formatted variant sheet", async () => {
  const bytes = await buildInventoryXlsx(rows, {
    generatedAt,
    locale: "de",
    variants,
  });
  assert.equal(bytes.subarray(0, 2).toString(), "PK");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const inventory = workbook.getWorksheet("Inventarexport");
  assert.ok(inventory);
  assert.equal(inventory.getCell("A1").value, "Inventarexport");
  assert.equal(inventory.getCell("A4").value, "id");
  assert.equal(inventory.getCell("G5").value, 7);
  assert.ok(inventory.getCell("V5").value instanceof Date);
  assert.equal(inventory.getCell("X5").value, "4006381333931");
  assert.equal(inventory.getColumn("X").numFmt, "@");
  assert.equal(inventory.views[0]?.state, "frozen");
  assert.equal(inventory.views[0]?.ySplit, 4);
  assert.ok(inventory.autoFilter);
  assert.equal(inventory.pageSetup.fitToPage, false);
  assert.equal(inventory.pageSetup.scale, 65);
  assert.equal(inventory.getColumn("Y").hidden, true);

  const variantSheet = workbook.getWorksheet("Varianten");
  assert.ok(variantSheet);
  assert.equal(variantSheet.getCell("A1").value, "resource_id");
  assert.equal(variantSheet.getCell("C2").value, "Grün / 5 m");
  assert.equal(variantSheet.getCell("F2").value, 4);
  assert.equal(variantSheet.getColumn("E").numFmt, "@");
  assert.ok(variantSheet.autoFilter);
});

test("PDF is a valid multipage-ready report with metadata and buffered page numbers", async () => {
  const bytes = await buildInventoryPdf(rows, {
    generatedAt,
    locale: "de",
  });
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length > 2_000);

  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), "Inventarbericht");
  assert.equal(pdf.getAuthor(), "Open Inventory");
});

test("PDF keeps a 64-row report to four numbered data pages", async () => {
  const multipageRows = Array.from({ length: 64 }, (_, index) => {
    const resourceId = `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const rowVariants =
      index % 7 === 0
        ? ["Klein", "Mittel", "Groß"].map((size, variantIndex) => ({
            ...variants[0],
            id: `40000000-0000-4000-8000-${String(index * 10 + variantIndex + 1).padStart(12, "0")}`,
            resourceId,
            name: `${size} / Grün`,
            quantity: variantIndex + 1,
          }))
        : [];
    return inventoryExportRow({
      ...sampleResources[index % sampleResources.length],
      id: resourceId,
      name:
        index % 9 === 0
          ? `Inventargegenstand ${index + 1} mit besonders langem Namen für den kontrollierten Tabellenumbruch`
          : `Inventargegenstand ${index + 1}`,
      location: [
        "Werkstatt / Regal A",
        "Lagerhalle Nord / Ebene 2",
        "Fahrzeug 3 / Seitenfach",
        "Büro / Materialschrank",
      ][index % 4],
      variants: rowVariants,
    });
  });
  const bytes = await buildInventoryPdf(multipageRows, {
    generatedAt,
    locale: "de",
  });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 4);
});
