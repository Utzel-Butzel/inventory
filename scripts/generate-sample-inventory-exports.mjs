import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  buildInventoryCsv,
  buildInventoryPdf,
  buildInventoryXlsx,
  inventoryExportRow,
} from "../lib/inventory-export.ts";

const outputDirectory = resolve(process.argv[2] ?? "tmp/export-qa");
const generatedAt = new Date("2026-08-13T10:15:00.000Z");
const locations = [
  "Werkstatt / Regal A",
  "Lagerhalle Nord / Ebene 2",
  "Fahrzeug 3 / Seitenfach",
  "Büro / Materialschrank",
];
const variants = [];
const resources = Array.from({ length: 64 }, (_, index) => {
  const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const itemVariants =
    index % 7 === 0
      ? ["Klein", "Mittel", "Groß"].map((size, variantIndex) => {
          const variant = {
            id: `20000000-0000-4000-8000-${String(index * 10 + variantIndex + 1).padStart(12, "0")}`,
            resourceId: id,
            name: `${size} / Grün`,
            sku: `VAR-${index + 1}-${variantIndex + 1}`,
            barcode: `4012345${String(index * 10 + variantIndex).padStart(6, "0")}`,
            priceCents: 1299 + variantIndex * 250,
            currency: "EUR",
            quantity: variantIndex + 1,
            position: variantIndex,
            createdAt: generatedAt,
            updatedAt: generatedAt,
          };
          variants.push(variant);
          return variant;
        })
      : [];
  return {
    id,
    name:
      index % 9 === 0
        ? `Inventargegenstand ${index + 1} mit besonders langem Namen für den kontrollierten Tabellenumbruch`
        : `Inventargegenstand ${index + 1}`,
    description: `Musterbeschreibung für Eintrag ${index + 1}.`,
    type: ["tool", "object", "furniture", "vehicle"][index % 4],
    status: ["available", "in-use", "maintenance"][index % 3],
    sku: `SKU-${String(index + 1).padStart(4, "0")}`,
    quantity: 3 + (index % 11),
    location: locations[index % locations.length],
    serialNumber: index % 4 === 0 ? `SER-${String(index + 1).padStart(5, "0")}` : null,
    barcode: `4006381${String(index + 1).padStart(6, "0")}`,
    valueCents: 1250 + index * 375,
    currency: index === 63 ? "USD" : "EUR",
    priority: 1 + (index % 5),
    tags: index % 2 ? ["Muster"] : ["Muster", "Prüfung"],
    categories: [{ id: "sample", label: "Musterbestand" }],
    customFields: { inspectionDate: "2027-04-03", formulaSafe: "=1+1" },
    relatedResourceIds: [],
    gpsLatitude: index % 5 === 0 ? 52.520008 : null,
    gpsLongitude: index % 5 === 0 ? 13.404954 : null,
    gpsAltitude: null,
    mapFeatures: [],
    notes: index === 0 ? "+Spreadsheet formula guard" : "",
    createdAt: new Date("2026-01-02T09:30:00.000Z"),
    updatedAt: new Date(generatedAt.getTime() - index * 3_600_000),
    variants: itemVariants,
  };
});
const rows = resources.map(inventoryExportRow);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(`${outputDirectory}/inventory-sample.csv`, buildInventoryCsv(rows)),
  writeFile(
    `${outputDirectory}/inventory-sample.xlsx`,
    await buildInventoryXlsx(rows, { generatedAt, locale: "de", variants }),
  ),
  writeFile(
    `${outputDirectory}/inventory-sample.pdf`,
    await buildInventoryPdf(rows, { generatedAt, locale: "de" }),
  ),
]);

console.log(outputDirectory);
