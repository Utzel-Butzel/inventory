import type { InventoryExportRow } from "./inventory-export";

export const INVENTORY_SYSTEMS = [
  "open-inventory",
  "snipe-it",
  "homebox",
] as const;
export type InventorySystem = (typeof INVENTORY_SYSTEMS)[number];
export type MigrationCsvRow = { cells: string[]; line: number };
export type MigrationMapping = { source: string; target: string | null };

export function parseInventorySystem(
  value: string | null,
): InventorySystem | null {
  return value === null
    ? "open-inventory"
    : (INVENTORY_SYSTEMS.find((system) => system === value) ?? null);
}

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
const unguard = (value: string) =>
  value.startsWith("'") && /^[\t\r\n ]*[=+\-@]/.test(value.slice(1))
    ? value.slice(1)
    : value;

// Keep the native importer strict; external spreadsheet exports may use semicolons or tabs.
export function parseMigrationCsv(source: string): MigrationCsvRow[] {
  const text = source.replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new Error("CSV contains null characters.");
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted && /[\r\n]/.test(text[i])) break;
    if (!quoted && counts.has(text[i]))
      counts.set(text[i], counts.get(text[i])! + 1);
  }
  const delimiter = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const rows: MigrationCsvRow[] = [];
  let cells: string[] = [],
    field = "",
    line = 1,
    start = 1;
  let inQuotes = false,
    closed = false;
  const finishField = () => {
    cells.push(field);
    field = "";
    closed = false;
  };
  const finishRow = () => {
    finishField();
    rows.push({ cells, line: start });
    if (rows.length > 10_000) throw new Error("CSV contains too many lines.");
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          closed = true;
        }
      } else if (c === "\r" || c === "\n") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        field += "\n";
        line++;
      } else field += c;
    } else if (c === delimiter) finishField();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finishRow();
      line++;
      start = line;
    } else if (c === '"' && !field && !closed) inQuotes = true;
    else {
      if (closed || c === '"')
        throw new Error(`Invalid quote on line ${line}.`);
      field += c;
    }
    if (field.length > 100_000)
      throw new Error(`Cell on line ${start} exceeds 100,000 characters.`);
    if (cells.length > 500) throw new Error("CSV contains too many columns.");
  }
  if (inQuotes) throw new Error(`Unclosed quote on line ${start}.`);
  if (field || cells.length || closed) finishRow();
  return rows;
}

const snipeFields: Record<string, string> = {
  name: "name",
  itemname: "name",
  assetname: "name",
  description: "description",
  assettag: "sku",
  serial: "serial_number",
  serialnumber: "serial_number",
  location: "location",
  category: "categories",
  purchasecost: "value_cents",
  notes: "notes",
};
const homeboxFields: Record<string, string> = {
  "hb.name": "name",
  "hb.description": "description",
  "hb.quantity": "quantity",
  "hb.location": "location",
  "hb.serialnumber": "serial_number",
  "hb.purchaseprice": "value_cents",
  "hb.notes": "notes",
  "hb.tags": "tags",
  "hb.labels": "tags",
  "hb.assetid": "sku",
  "hb.field.openinventorysku": "sku",
  "hb.field.openinventorybarcode": "barcode",
  "hb.field.openinventorycurrency": "currency",
};
const normalizedHeaders = [
  "name",
  "description",
  "type",
  "status",
  "sku",
  "quantity",
  "location",
  "serial_number",
  "barcode",
  "value_cents",
  "currency",
  "tags",
  "categories",
  "notes",
];

export function migrateInventoryRows(
  rows: MigrationCsvRow[],
  system: Exclude<InventorySystem, "open-inventory">,
  currency = "EUR",
) {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new Error("Choose a three-letter currency code.");
  const sourceHeaders = rows[0]?.cells ?? [];
  const keys = sourceHeaders.map(normalize);
  if (
    !keys.length ||
    keys.some((key) => !key) ||
    new Set(keys).size !== keys.length
  ) {
    throw new Error("CSV headers must be non-empty and unique.");
  }
  const fields = system === "homebox" ? homeboxFields : snipeFields;
  const mappings: MigrationMapping[] = sourceHeaders.map((source, i) => ({
    source,
    target: Object.hasOwn(fields, keys[i]) ? fields[keys[i]] : null,
  }));
  // Homebox's original asset ID remains in notes when an explicit SKU is present.
  if (system === "homebox" && keys.includes("hb.field.openinventorysku")) {
    mappings.forEach((mapping, i) => {
      if (keys[i] === "hb.assetid") mapping.target = null;
    });
  }
  const targets = mappings.map((mapping) => mapping.target).filter(Boolean);
  if (new Set(targets).size !== targets.length)
    throw new Error(
      "Multiple source columns map to the same inventory field. Keep only one of these columns.",
    );
  if (
    !targets.includes("name") &&
    !(
      system === "snipe-it" &&
      (keys.includes("modelname") || keys.includes("assettag"))
    )
  ) {
    throw new Error(
      system === "homebox"
        ? "Homebox CSV requires HB.name."
        : "Snipe-IT CSV requires Name, Model Name or Asset Tag.",
    );
  }
  const converted = rows
    .slice(1)
    .filter((row) => row.cells.some((cell) => cell.trim()))
    .map((row) => {
      if (row.cells.length > keys.length)
        throw new Error(`Too many cells on line ${row.line}.`);
      const values: Record<string, string> = {
        type: "object",
        status: "available",
        quantity: "1",
        currency,
      };
      const notes: string[] = [];
      const get = (key: string) =>
        unguard(row.cells[keys.indexOf(key)] ?? "").trim();
      mappings.forEach(({ source, target }, i) => {
        const value = unguard(row.cells[i] ?? "");
        if (!value.trim()) return;
        if (!target) {
          notes.push(`${source}: ${value}`);
          return;
        }
        if (target === "value_cents") {
          // Decimal comma is accepted; grouping separators and ambiguous prices are rejected.
          if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim()))
            throw new Error(
              `Invalid purchase price on line ${row.line}: ${value}`,
            );
          const [whole, fraction = ""] = value
            .trim()
            .replace(",", ".")
            .split(".");
          const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
          if (!Number.isSafeInteger(cents) || cents > 2_000_000_000)
            throw new Error(`Purchase price on line ${row.line} is too large.`);
          values[target] = String(cents);
        } else if (target === "categories")
          values[target] = JSON.stringify([value.trim()]);
        else if (target === "tags")
          values[target] = JSON.stringify(
            value
              .split(";")
              .map((tag) => tag.trim())
              .filter(Boolean),
          );
        else values[target] = value;
      });
      if (system === "snipe-it") {
        values.name ||= get("modelname") || get("assettag");
        const statuses: Record<string, string> = {
          "ready to deploy": "available",
          available: "available",
          "in use": "in-use",
          "in-use": "in-use",
          "checked out": "in-use",
          maintenance: "maintenance",
          "pending repair": "maintenance",
          archived: "archived",
        };
        const status = get("status").toLowerCase();
        values.status = Object.hasOwn(statuses, status)
          ? statuses[status]
          : "available";
      } else {
        const archived = get("hb.archived").toLowerCase();
        if (
          archived &&
          !["true", "false", "1", "0", "yes", "no"].includes(archived)
        )
          throw new Error(`Invalid HB.archived on line ${row.line}.`);
        values.status = ["true", "1", "yes"].includes(archived)
          ? "archived"
          : "available";
      }
      values.notes = [
        values.notes,
        notes.length ? `[${system}]\n${notes.join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      return {
        cells: normalizedHeaders.map((header) => values[header] ?? ""),
        line: row.line,
      };
    });
  return {
    rows: [{ cells: normalizedHeaders, line: rows[0].line }, ...converted],
    mappings,
  };
}

const cell = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const names = (value: InventoryExportRow[keyof InventoryExportRow]) => {
  const parsed: unknown = JSON.parse(String(value || "[]"));
  return Array.isArray(parsed)
    ? parsed
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : String(entry?.name ?? entry?.label ?? ""),
        )
        .filter(Boolean)
    : [];
};

export function buildMigrationCsv(
  rows: InventoryExportRow[],
  system: Exclude<InventorySystem, "open-inventory">,
) {
  const headers =
    system === "homebox"
      ? [
          "HB.import_ref",
          "HB.name",
          "HB.description",
          "HB.quantity",
          "HB.location",
          "HB.serial_number",
          "HB.purchase_price",
          "HB.archived",
          "HB.labels",
          "HB.notes",
          "HB.field.Open Inventory SKU",
          "HB.field.Open Inventory Barcode",
          "HB.field.Open Inventory Currency",
        ]
      : [
          "Asset Tag",
          "Name",
          "Model Name",
          "Category",
          "Status",
          "Serial",
          "Location",
          "Purchase Cost",
          "Notes",
        ];
  const data = rows.map((row) => {
    const retained =
      system === "homebox"
        ? ([
            "type",
            "status",
            "categories",
            "custom_fields",
            "slugs",
            "related_resource_ids",
            "gps_latitude",
            "gps_longitude",
            "gps_altitude",
            "map_features",
            "priority",
          ] as const)
        : ([
            "description",
            "type",
            "status",
            "quantity",
            "currency",
            "barcode",
            "tags",
            "categories",
            "custom_fields",
            "slugs",
            "related_resource_ids",
            "gps_latitude",
            "gps_longitude",
            "gps_altitude",
            "map_features",
            "priority",
          ] as const);
    const extra = Object.fromEntries(
      retained
        .filter(
          (key) =>
            row[key] !== null &&
            row[key] !== "" &&
            !["[]", "{}"].includes(String(row[key])),
        )
        .map((key) => [key, row[key]]),
    );
    const notes = [row.notes, `Open Inventory: ${JSON.stringify(extra)}`]
      .filter(Boolean)
      .join("\n\n");
    const price =
      row.value_cents == null ? "" : (Number(row.value_cents) / 100).toFixed(2);
    if (system === "homebox") {
      if (notes.length > 1000 || String(row.description ?? "").length > 255)
        throw new Error(
          `Homebox: "${row.name}" exceeds the portable CSV limits (notes: 1000, description: 255 characters). Use the Open Inventory CSV to retain all data.`,
        );
      const tags = names(row.tags);
      if (tags.some((tag) => tag.includes(";")))
        throw new Error(
          `Homebox: "${row.name}" has a tag containing a semicolon. Rename that tag before exporting.`,
        );
      return [
        `open-inventory:${row.id}`,
        row.name,
        row.description,
        row.quantity,
        row.location,
        row.serial_number,
        price,
        row.status === "archived" ? "true" : "false",
        tags.join("; "),
        notes,
        row.sku,
        row.barcode,
        row.currency,
      ];
    }
    // Snipe-IT assets represent individual devices, never aggregate stock rows.
    if (Number(row.quantity) !== 1)
      throw new Error(
        `Snipe-IT: "${row.name}" has quantity ${row.quantity}. Asset export requires exactly one unit per entry. Use the Open Inventory CSV for aggregate stock.`,
      );
    const statuses: Record<string, string> = {
      available: "Ready to Deploy",
      "in-use": "In Use",
      maintenance: "Maintenance",
      archived: "Archived",
    };
    return [
      row.sku || `OI-${row.id}`,
      row.name,
      row.name,
      names(row.categories)[0] || "Open Inventory",
      statuses[String(row.status)] ?? "Ready to Deploy",
      row.serial_number,
      row.location,
      price,
      notes,
    ];
  });
  return `\uFEFF${[headers, ...data].map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
