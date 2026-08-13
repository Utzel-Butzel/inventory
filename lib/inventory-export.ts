import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export const INVENTORY_EXPORT_HEADERS = [
  "id",
  "name",
  "description",
  "type",
  "status",
  "sku",
  "quantity",
  "location",
  "serial_number",
  "value_cents",
  "currency",
  "priority",
  "tags",
  "categories",
  "custom_fields",
  "related_resource_ids",
  "gps_latitude",
  "gps_longitude",
  "gps_altitude",
  "map_features",
  "notes",
  "created_at",
  "updated_at",
  "barcode",
  "variants",
] as const;

export type InventoryExportHeader = (typeof INVENTORY_EXPORT_HEADERS)[number];
export type InventoryExportFormat = "csv" | "xlsx" | "pdf";
export type InventoryExportLocale = "de" | "en";
export type InventoryExportCell = string | number | Date | null;
export type InventoryExportRow = Record<
  InventoryExportHeader,
  InventoryExportCell
>;

const supportedFormats = new Set<InventoryExportFormat>(["csv", "xlsx", "pdf"]);

export function parseInventoryExportOptions(input: string | URL): {
  format: InventoryExportFormat;
  locale: InventoryExportLocale;
} | null {
  const url = input instanceof URL ? input : new URL(input);
  const requestedFormat = url.searchParams.get("format")?.toLowerCase() ?? "csv";
  if (!supportedFormats.has(requestedFormat as InventoryExportFormat)) return null;
  return {
    format: requestedFormat as InventoryExportFormat,
    locale: url.searchParams.get("lang")?.toLowerCase().startsWith("de")
      ? "de"
      : "en",
  };
}

export type InventoryExportResource = {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  sku: string | null;
  quantity: number;
  location: string | null;
  serialNumber: string | null;
  barcode: string | null;
  valueCents: number | null;
  currency: string;
  priority: number;
  tags: unknown;
  categories: unknown;
  customFields: unknown;
  relatedResourceIds: unknown;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAltitude: number | null;
  mapFeatures: unknown;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  variants?: InventoryExportVariant[];
};

export type InventoryExportVariant = {
  id: string;
  resourceId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number | null;
  currency: string;
  quantity: number;
  position: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const localeCopy = {
  de: {
    title: "Inventarbericht",
    spreadsheetTitle: "Inventarexport",
    generated: "Erstellt",
    records: "Einträge",
    totalQuantity: "Gesamtmenge",
    inventoryValue: "Bestandswert",
    mixedCurrencies: "mehrere Währungen",
    page: "Seite",
    of: "von",
    columns: {
      name: "Name",
      sku: "SKU",
      type: "Typ",
      status: "Status",
      quantity: "Menge",
      location: "Standort",
      value: "Wert",
      variants: "Varianten",
      updated: "Aktualisiert",
    },
  },
  en: {
    title: "Inventory report",
    spreadsheetTitle: "Inventory export",
    generated: "Generated",
    records: "Records",
    totalQuantity: "Total quantity",
    inventoryValue: "Inventory value",
    mixedCurrencies: "multiple currencies",
    page: "Page",
    of: "of",
    columns: {
      name: "Name",
      sku: "SKU",
      type: "Type",
      status: "Status",
      quantity: "Quantity",
      location: "Location",
      value: "Value",
      variants: "Variants",
      updated: "Updated",
    },
  },
} as const;

const stringifyJson = (value: unknown) => JSON.stringify(value) ?? "";

export function inventoryExportRow(
  resource: InventoryExportResource,
): InventoryExportRow {
  return {
    id: resource.id,
    name: resource.name,
    description: resource.description,
    type: resource.type,
    status: resource.status,
    sku: resource.sku,
    quantity: resource.quantity,
    location: resource.location,
    serial_number: resource.serialNumber,
    value_cents: resource.valueCents,
    currency: resource.currency,
    priority: resource.priority,
    tags: stringifyJson(resource.tags),
    categories: stringifyJson(resource.categories),
    custom_fields: stringifyJson(resource.customFields),
    related_resource_ids: stringifyJson(resource.relatedResourceIds),
    gps_latitude: resource.gpsLatitude,
    gps_longitude: resource.gpsLongitude,
    gps_altitude: resource.gpsAltitude,
    map_features: stringifyJson(resource.mapFeatures),
    notes: resource.notes,
    created_at: resource.createdAt,
    updated_at: resource.updatedAt,
    barcode: resource.barcode,
    variants: stringifyJson(resource.variants ?? []),
  };
}

// Quoting alone does not stop spreadsheet applications from evaluating a cell
// as a formula. Prefixing risky CSV text with an apostrophe is understood by
// common spreadsheet tools and is removed again by this app's importer.
export const guardSpreadsheetFormula = (value: string) =>
  /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;

export const csvCell = (value: InventoryExportCell) => {
  if (value === null) return '""';
  const text =
    typeof value === "string"
      ? guardSpreadsheetFormula(value)
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export function buildInventoryCsv(rows: InventoryExportRow[]) {
  const csv = [
    INVENTORY_EXPORT_HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      INVENTORY_EXPORT_HEADERS.map((header) => csvCell(row[header])).join(","),
    ),
  ].join("\r\n");
  return `\uFEFF${csv}\r\n`;
}

const columnWidths: Record<InventoryExportHeader, number> = {
  id: 38,
  name: 28,
  description: 44,
  type: 16,
  status: 16,
  sku: 18,
  quantity: 12,
  location: 24,
  serial_number: 22,
  value_cents: 14,
  currency: 10,
  priority: 10,
  tags: 28,
  categories: 30,
  custom_fields: 45,
  related_resource_ids: 40,
  gps_latitude: 14,
  gps_longitude: 14,
  gps_altitude: 14,
  map_features: 40,
  notes: 44,
  created_at: 21,
  updated_at: 21,
  barcode: 22,
  variants: 45,
};

const xlsxValue = (value: InventoryExportCell) => value ?? "";

export async function buildInventoryXlsx(
  rows: InventoryExportRow[],
  options: {
    generatedAt?: Date;
    locale?: InventoryExportLocale;
    variants?: InventoryExportVariant[];
  } = {},
) {
  const generatedAt = options.generatedAt ?? new Date();
  const locale = options.locale ?? "en";
  const copy = localeCopy[locale];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Open Inventory";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.title = copy.spreadsheetTitle;
  workbook.subject = `${rows.length} ${copy.records.toLocaleLowerCase(locale)}`;
  workbook.calcProperties.fullCalcOnLoad = false;

  const worksheet = workbook.addWorksheet(copy.spreadsheetTitle.slice(0, 31), {
    properties: { defaultRowHeight: 18 },
    pageSetup: {
      orientation: "landscape",
      // Keep a fixed, readable print scale. "Fit to one page" made the full
      // fidelity data sheet technically complete but illegible on paper.
      fitToPage: false,
      scale: 65,
      paperSize: 9,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
    views: [
      {
        state: "frozen",
        xSplit: 2,
        ySplit: 4,
        topLeftCell: "C5",
        activeCell: "A5",
        showGridLines: false,
      },
    ],
  });

  const finalColumn = worksheet.getColumn(INVENTORY_EXPORT_HEADERS.length).letter;
  worksheet.mergeCells(`A1:${finalColumn}1`);
  worksheet.getCell("A1").value = copy.spreadsheetTitle;
  worksheet.getCell("A1").font = {
    name: "Aptos Display",
    size: 18,
    bold: true,
    color: { argb: "FFFFFFFF" },
  };
  worksheet.getCell("A1").alignment = { vertical: "middle" };
  worksheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF153E57" },
  };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells(`A2:${finalColumn}2`);
  worksheet.getCell("A2").value =
    `${copy.records}: ${rows.length.toLocaleString(locale)}  |  ` +
    `${copy.generated}: ${generatedAt.toISOString()}`;
  worksheet.getCell("A2").font = {
    name: "Aptos",
    size: 10,
    color: { argb: "FF40566A" },
  };
  worksheet.getCell("A2").alignment = { vertical: "middle" };
  worksheet.getCell("A2").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEAF1F5" },
  };
  worksheet.getRow(2).height = 22;
  worksheet.getRow(3).height = 8;

  const headerRowNumber = 4;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = [...INVENTORY_EXPORT_HEADERS];
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = {
      name: "Aptos",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF246B7A" },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF184C57" } },
    };
  });

  for (const row of rows) {
    const excelRow = worksheet.addRow(
      INVENTORY_EXPORT_HEADERS.map((header) => xlsxValue(row[header])),
    );
    excelRow.font = { name: "Aptos", size: 9 };
    excelRow.alignment = { vertical: "top" };
    if (excelRow.number % 2 === 0) {
      excelRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF5F8FA" },
      };
    }
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFD8E1E8" } },
      };
    });
  }

  for (const [index, header] of INVENTORY_EXPORT_HEADERS.entries()) {
    const column = worksheet.getColumn(index + 1);
    column.width = columnWidths[header];
    column.alignment = {
      vertical: "top",
      horizontal:
        header === "quantity" ||
        header === "value_cents" ||
        header === "priority" ||
        header.startsWith("gps_")
          ? "right"
          : "left",
      wrapText: [
        "description",
        "tags",
        "categories",
        "custom_fields",
        "related_resource_ids",
        "map_features",
        "notes",
      ].includes(header),
    };
  }

  const firstDataRow = headerRowNumber + 1;
  const lastDataRow = Math.max(firstDataRow, headerRowNumber + rows.length);
  const columnFor = (header: InventoryExportHeader) =>
    worksheet.getColumn(INVENTORY_EXPORT_HEADERS.indexOf(header) + 1);
  for (const header of ["id", "sku", "serial_number", "barcode"] as const) {
    // Identifiers are text even when they contain digits only. This preserves
    // leading zeroes and avoids scientific notation for EAN/UPC-style values.
    columnFor(header).numFmt = "@";
  }
  columnFor("quantity").numFmt = "#,##0";
  columnFor("value_cents").numFmt = "#,##0";
  columnFor("priority").numFmt = "0";
  columnFor("gps_latitude").numFmt = "0.000000";
  columnFor("gps_longitude").numFmt = "0.000000";
  columnFor("gps_altitude").numFmt = "0.00";
  columnFor("created_at").numFmt = "yyyy-mm-dd hh:mm:ss";
  columnFor("updated_at").numFmt = "yyyy-mm-dd hh:mm:ss";
  // Variant rows have their own structured sheet. Retain the raw JSON for
  // lossless parity with CSV while keeping the primary sheet usable.
  columnFor("variants").hidden = true;
  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: lastDataRow, column: INVENTORY_EXPORT_HEADERS.length },
  };
  worksheet.pageSetup.printTitlesRow = "1:4";
  worksheet.pageSetup.printArea = `A1:${finalColumn}${lastDataRow}`;
  worksheet.headerFooter.oddFooter =
    `&L${copy.spreadsheetTitle}&C${copy.page} &P ${copy.of} &N&R&D`;

  if (options.variants?.length) {
    const variantSheetName = locale === "de" ? "Varianten" : "Variants";
    const variantSheet = workbook.addWorksheet(variantSheetName, {
      properties: { defaultRowHeight: 18 },
      views: [
        {
          state: "frozen",
          xSplit: 2,
          ySplit: 1,
          topLeftCell: "C2",
          activeCell: "A2",
          showGridLines: false,
        },
      ],
    });
    const variantHeaders = [
      "resource_id",
      "variant_id",
      "name",
      "sku",
      "barcode",
      "quantity",
      "price_cents",
      "currency",
      "position",
      "created_at",
      "updated_at",
    ] as const;
    variantSheet.addRow([...variantHeaders]);
    for (const variant of options.variants) {
      variantSheet.addRow([
        variant.resourceId,
        variant.id,
        variant.name,
        variant.sku ?? "",
        variant.barcode ?? "",
        variant.quantity,
        variant.priceCents ?? "",
        variant.currency,
        variant.position,
        variant.createdAt instanceof Date
          ? variant.createdAt
          : new Date(variant.createdAt),
        variant.updatedAt instanceof Date
          ? variant.updatedAt
          : new Date(variant.updatedAt),
      ]);
    }
    const variantHeader = variantSheet.getRow(1);
    variantHeader.height = 24;
    variantHeader.eachCell((cell) => {
      cell.font = {
        name: "Aptos",
        size: 10,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF246B7A" },
      };
      cell.alignment = { vertical: "middle" };
    });
    variantSheet.columns.forEach((column, index) => {
      column.width = [38, 38, 28, 18, 22, 12, 14, 10, 10, 21, 21][index];
      column.font = { name: "Aptos", size: 9 };
      column.alignment = { vertical: "top" };
    });
    variantSheet.getColumn(6).numFmt = "#,##0";
    variantSheet.getColumn(7).numFmt = "#,##0";
    variantSheet.getColumn(9).numFmt = "0";
    variantSheet.getColumn(10).numFmt = "yyyy-mm-dd hh:mm:ss";
    variantSheet.getColumn(11).numFmt = "yyyy-mm-dd hh:mm:ss";
    for (const columnNumber of [1, 2, 4, 5]) {
      variantSheet.getColumn(columnNumber).numFmt = "@";
    }
    variantSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(2, options.variants.length + 1), column: variantHeaders.length },
    };
    variantSheet.pageSetup = {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      printTitlesRow: "1:1",
      printArea: `A1:K${options.variants.length + 1}`,
    };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const normalizePdfText = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const formatNumber = (value: number, locale: InventoryExportLocale) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    .format(value)
    .replace(/[\u00a0\u202f]/g, " ");

const formatMoney = (
  cents: number,
  currency: string,
  locale: InventoryExportLocale,
) => `${formatNumber(cents / 100, locale)} ${normalizePdfText(currency)}`;

const pdfColumns = [
  { key: "name", width: 128, align: "left" as const },
  { key: "sku", width: 72, align: "left" as const },
  { key: "type", width: 58, align: "left" as const },
  { key: "status", width: 64, align: "left" as const },
  { key: "quantity", width: 44, align: "right" as const },
  { key: "location", width: 112, align: "left" as const },
  { key: "value", width: 88, align: "right" as const },
  { key: "variants", width: 104, align: "left" as const },
  { key: "updated", width: 88, align: "left" as const },
] as const;

type PdfColumnKey = (typeof pdfColumns)[number]["key"];
type PdfRow = Record<PdfColumnKey, string>;

type CompactVariant = {
  name?: unknown;
  priceCents?: unknown;
  currency?: unknown;
  quantity?: unknown;
};

const parseRowVariants = (row: InventoryExportRow): CompactVariant[] => {
  try {
    const value = JSON.parse(String(row.variants ?? "[]")) as unknown;
    return Array.isArray(value) ? (value as CompactVariant[]) : [];
  } catch {
    return [];
  }
};

const rowValueContributions = (row: InventoryExportRow) => {
  const parentCurrency = normalizePdfText(row.currency) || "EUR";
  const parentPrice = typeof row.value_cents === "number" ? row.value_cents : 0;
  const totalQuantity = typeof row.quantity === "number" ? row.quantity : 0;
  const variants = parseRowVariants(row);
  const totals = new Map<string, number>();
  let allocatedQuantity = 0;
  for (const variant of variants) {
    const quantity = Number(variant.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    allocatedQuantity += quantity;
    const explicitPrice = Number(variant.priceCents);
    const hasExplicitPrice = Number.isFinite(explicitPrice) && explicitPrice >= 0;
    const currency = hasExplicitPrice
      ? normalizePdfText(variant.currency) || parentCurrency
      : parentCurrency;
    const unitPrice = hasExplicitPrice ? explicitPrice : parentPrice;
    totals.set(currency, (totals.get(currency) ?? 0) + unitPrice * quantity);
  }
  const unallocatedQuantity = Math.max(0, totalQuantity - allocatedQuantity);
  if (unallocatedQuantity > 0 && parentPrice > 0) {
    totals.set(
      parentCurrency,
      (totals.get(parentCurrency) ?? 0) + parentPrice * unallocatedQuantity,
    );
  }
  return totals;
};

const compactValueSummary = (
  totals: Map<string, number>,
  locale: InventoryExportLocale,
) =>
  [...totals.entries()]
    .slice(0, 2)
    .map(([currency, cents]) => formatMoney(cents, currency, locale))
    .join(" | ");

const pdfRow = (
  row: InventoryExportRow,
  locale: InventoryExportLocale,
): PdfRow => ({
  name: normalizePdfText(row.name),
  sku: normalizePdfText(row.sku) || "-",
  type: normalizePdfText(row.type),
  status: normalizePdfText(row.status),
  quantity:
    typeof row.quantity === "number" ? formatNumber(row.quantity, locale) : "-",
  location: normalizePdfText(row.location) || "-",
  value: compactValueSummary(rowValueContributions(row), locale) || "-",
  variants: (() => {
    const variants = parseRowVariants(row);
    if (!variants.length) return "-";
    const preview = variants.slice(0, 3).map((variant) => {
      const name = normalizePdfText(variant.name) || "-";
      const quantity = Number(variant.quantity);
      return Number.isFinite(quantity) ? `${name} (${quantity})` : name;
    });
    if (variants.length > preview.length) {
      preview.push(`+${variants.length - preview.length}`);
    }
    return preview.join(", ");
  })(),
  updated:
    row.updated_at instanceof Date
      ? row.updated_at.toISOString().slice(0, 16).replace("T", " ")
      : normalizePdfText(row.updated_at),
});

export async function buildInventoryPdf(
  rows: InventoryExportRow[],
  options: {
    generatedAt?: Date;
    locale?: InventoryExportLocale;
  } = {},
) {
  const generatedAt = options.generatedAt ?? new Date();
  const locale = options.locale ?? "en";
  const copy = localeCopy[locale];
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    info: {
      Title: copy.title,
      Author: "Open Inventory",
      Subject: `${rows.length} ${copy.records.toLocaleLowerCase(locale)}`,
      CreationDate: generatedAt,
      ModDate: generatedAt,
    },
    margins: { top: 28, right: 36, bottom: 30, left: 36 },
    size: "A4",
    layout: "landscape",
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    doc.once("error", reject);
  });

  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const left = 36;
  const right = pageWidth - 36;
  const tableWidth = pdfColumns.reduce((sum, column) => sum + column.width, 0);
  const totalQuantity = rows.reduce(
    (sum, row) => sum + (typeof row.quantity === "number" ? row.quantity : 0),
    0,
  );
  const valueTotals = new Map<string, number>();
  for (const row of rows) {
    for (const [currency, cents] of rowValueContributions(row)) {
      valueTotals.set(currency, (valueTotals.get(currency) ?? 0) + cents);
    }
  }
  const valueSummary = [...valueTotals.entries()]
    .slice(0, 3)
    .map(([currency, cents]) => formatMoney(cents, currency, locale))
    .join(" | ");

  const drawPageHeader = (firstPage: boolean) => {
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#153E57");
    doc.text(copy.title, left, 28, { width: 340, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor("#5B7080");
    doc.text(
      `${copy.generated}: ${generatedAt.toISOString()}  |  ${copy.records}: ${rows.length.toLocaleString(locale)}`,
      400,
      32,
      { width: right - 400, align: "right", lineBreak: false },
    );
    doc.moveTo(left, 51).lineTo(right, 51).lineWidth(0.8).strokeColor("#B9C8D3").stroke();

    if (!firstPage) return 65;
    const cardY = 62;
    const cardGap = 8;
    const cardWidth = (tableWidth - cardGap * 2) / 3;
    const cards = [
      [copy.records, rows.length.toLocaleString(locale)],
      [copy.totalQuantity, formatNumber(totalQuantity, locale)],
      [
        copy.inventoryValue,
        valueTotals.size > 3
          ? `${valueSummary} | ${copy.mixedCurrencies}`
          : valueSummary || "-",
      ],
    ];
    cards.forEach(([label, value], index) => {
      const x = left + index * (cardWidth + cardGap);
      doc.roundedRect(x, cardY, cardWidth, 38, 4).fill("#EAF1F5");
      doc.font("Helvetica").fontSize(6.5).fillColor("#5B7080");
      doc.text(label.toUpperCase(), x + 8, cardY + 7, {
        width: cardWidth - 16,
        lineBreak: false,
      });
      doc.font("Helvetica-Bold").fontSize(index === 2 ? 8 : 11).fillColor("#153E57");
      doc.text(value, x + 8, cardY + 19, {
        width: cardWidth - 16,
        height: 13,
        ellipsis: true,
        lineBreak: false,
      });
    });
    return 110;
  };

  const drawTableHeader = (y: number) => {
    doc.rect(left, y, tableWidth, 20).fill("#246B7A");
    let x = left;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#FFFFFF");
    for (const column of pdfColumns) {
      doc.text(copy.columns[column.key], x + 4, y + 6, {
        width: column.width - 8,
        align: column.align ?? "left",
        lineBreak: false,
      });
      x += column.width;
    }
    return y + 20;
  };

  let pageIndex = 0;
  const newPage = () => {
    doc.addPage();
    pageIndex += 1;
    return drawTableHeader(drawPageHeader(pageIndex === 1));
  };

  let y = newPage();
  // Leave a protected footer band. PDFKit automatically creates a new page
  // when text is written below the bottom margin, including while revisiting
  // buffered pages to add page numbers.
  const bottom = pageHeight - 50;
  rows.forEach((sourceRow, rowIndex) => {
    const row = pdfRow(sourceRow, locale);
    const heights = pdfColumns.map((column) =>
      doc
        .font("Helvetica")
        .fontSize(7.3)
        .heightOfString(row[column.key], {
          width: column.width - 8,
          lineGap: 1,
        }),
    );
    const rowHeight = Math.min(38, Math.max(20, Math.max(...heights) + 8));
    if (y + rowHeight > bottom) y = newPage();

    if (rowIndex % 2 === 1) {
      doc.rect(left, y, tableWidth, rowHeight).fill("#F5F8FA");
    }
    doc
      .moveTo(left, y + rowHeight)
      .lineTo(left + tableWidth, y + rowHeight)
      .lineWidth(0.35)
      .strokeColor("#D8E1E8")
      .stroke();
    let x = left;
    doc.font("Helvetica").fontSize(7.3).fillColor("#263C4A");
    for (const column of pdfColumns) {
      doc.text(row[column.key], x + 4, y + 5, {
        width: column.width - 8,
        height: rowHeight - 8,
        align: column.align ?? "left",
        lineGap: 1,
        ellipsis: true,
      });
      x += column.width;
    }
    y += rowHeight;
  });

  if (!rows.length) {
    doc.font("Helvetica").fontSize(9).fillColor("#5B7080");
    doc.text("-", left, y + 12, { width: tableWidth, align: "center" });
  }

  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.font("Helvetica").fontSize(7).fillColor("#6B7F8D");
    doc.text(
      `${copy.page} ${index + 1} ${copy.of} ${range.count}`,
      left,
      pageHeight - 43,
      {
        width: tableWidth,
        height: 10,
        align: "center",
        lineBreak: false,
      },
    );
  }

  doc.end();
  return completed;
}
