import { createHash } from "node:crypto";

import type { NewResource } from "@/db/schema";
import { requirePermission } from "@/lib/api-auth";
import {
  customFieldHttpError,
  validateCustomFieldValues,
} from "@/lib/custom-fields";
import {
  hashIdempotentPayload,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { positionFromMapFeatures } from "@/lib/map-features";
import {
  createResourceIdempotently,
  IdempotencyConflictError,
  replayResourceCreation,
} from "@/lib/resources";
import {
  customFieldValuesInputSchema,
  resourceInputSchema,
} from "@/lib/validators";
import {
  assertActiveInventoryType,
  inventoryStructureHttpError,
  synchronizeSpatialContainment,
} from "@/lib/inventory-structure";
import {
  assertResourceIdentifiersAvailable,
  ResourceIdentifierConflictError,
} from "@/lib/resource-identifiers";
import { isResourceSlugConflict } from "@/lib/resource-slug-contract";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DATA_ROWS = 1_000;
const MAX_CELL_CHARACTERS = 100_000;

const writableHeaders = [
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
  "priority",
  "tags",
  "categories",
  "slugs",
  "custom_fields",
  "related_resource_ids",
  "gps_latitude",
  "gps_longitude",
  "gps_altitude",
  "map_features",
  "notes",
] as const;

// Export-only data is accepted so a CSV produced by this app remains a valid
// import source. It is deliberately ignored while new parent items are created.
const readOnlyHeaders = ["id", "created_at", "updated_at", "variants"] as const;
const supportedHeaders = new Set<string>([
  ...writableHeaders,
  ...readOnlyHeaders,
]);

type CsvRow = { cells: string[]; line: number };

type ImportResult =
  | {
      line: number;
      status: "created" | "replayed";
      resource: { id: string; name: string; sku: string | null };
    }
  | {
      line: number;
      status: "error";
      error: string;
      details?: string[];
    };

class CsvSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

class CsvTooLargeError extends Error {
  constructor() {
    super("CSV files may be at most 5 MB.");
    this.name = "CsvTooLargeError";
  }
}

async function readLimitedBody(request: Request) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new CsvTooLargeError();
    }
    chunks.push(value);
  }

  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

const isBlankRow = (row: CsvRow) =>
  row.cells.every((cell) => cell.trim().length === 0);

function parseCsv(source: string): CsvRow[] {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const append = (character: string) => {
    field += character;
    if (field.length > MAX_CELL_CHARACTERS) {
      throw new CsvSyntaxError(
        `A cell beginning on line ${rowStartLine} exceeds ${MAX_CELL_CHARACTERS.toLocaleString("en-US")} characters.`,
      );
    }
  };

  const finishRow = () => {
    cells.push(field);
    rows.push({ cells, line: rowStartLine });
    cells = [];
    field = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          inQuotes = false;
        }
      } else if (character === "\r") {
        if (text[index + 1] === "\n") index += 1;
        append("\n");
        line += 1;
      } else {
        append(character);
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) {
        throw new CsvSyntaxError(`Unexpected quote on line ${line}.`);
      }
      inQuotes = true;
    } else if (character === ",") {
      cells.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
      line += 1;
      rowStartLine = line;
    } else {
      append(character);
    }
  }

  if (inQuotes) {
    throw new CsvSyntaxError(
      `Quoted cell beginning on line ${rowStartLine} is not closed.`,
    );
  }
  if (field.length > 0 || cells.length > 0) finishRow();
  return rows;
}

const headerAliases: Record<string, string> = {
  serialnumber: "serial_number",
  valuecents: "value_cents",
  customfields: "custom_fields",
  relatedresourceids: "related_resource_ids",
  gpslatitude: "gps_latitude",
  gpslongitude: "gps_longitude",
  gpsaltitude: "gps_altitude",
  mapfeatures: "map_features",
  createdat: "created_at",
  updatedat: "updated_at",
};

const canonicalHeader = (header: string) => {
  const normalized = header
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_");
  return headerAliases[normalized.replaceAll("_", "")] ?? normalized;
};

const removeSpreadsheetGuard = (value: string) =>
  value.startsWith("'") && /^[\t\r\n ]*[=+\-@]/.test(value.slice(1))
    ? value.slice(1)
    : value;

const parseJson = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
};

const parseStringArray = (value: string, label: string) => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = trimmed.startsWith("[")
    ? parseJson(trimmed, label)
    : trimmed.split(/[|;]/).map((entry) => entry.trim());
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${label} must be a JSON string array or a | separated list.`);
  }
  return parsed.map((entry) => entry.trim()).filter(Boolean);
};

const parseCategories = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith("[")) {
    return trimmed
      .split(/[|;]/)
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }

  const parsed = parseJson(trimmed, "categories");
  if (!Array.isArray(parsed)) {
    throw new Error("categories must contain a JSON array.");
  }
  return parsed.map((entry) => {
    if (typeof entry === "string") return { name: entry };
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Each category must be a name or an object with a name.");
    }
    const category = entry as Record<string, unknown>;
    if (typeof category.name !== "string") {
      throw new Error("Each category object must contain a string name.");
    }
    if (category.color !== undefined && typeof category.color !== "string") {
      throw new Error("A category color must be a string when provided.");
    }
    return {
      name: category.name,
      ...(category.color === undefined ? {} : { color: category.color }),
    };
  });
};

const parseCustomFields = (value: string): unknown => {
  if (!value.trim()) return {};
  return parseJson(value, "custom_fields");
};

const parseMapFeatures = (value: string) => {
  if (!value.trim()) return [];
  const parsed = parseJson(value, "map_features");
  if (!Array.isArray(parsed)) {
    throw new Error("map_features must contain a JSON array.");
  }
  return parsed;
};

function payloadFromRow(
  row: CsvRow,
  headers: string[],
): { payload: Record<string, unknown>; customFields?: unknown } {
  if (row.cells.length > headers.length) {
    throw new Error(
      `Row has ${row.cells.length} cells but the header has ${headers.length}.`,
    );
  }

  const values = new Map<string, string>();
  headers.forEach((header, index) => {
    values.set(header, removeSpreadsheetGuard(row.cells[index] ?? ""));
  });
  const has = (header: string) => values.has(header);
  const get = (header: string) => values.get(header) ?? "";
  const payload: Record<string, unknown> = { name: get("name") };

  for (const header of ["description", "type", "status", "currency", "notes"]) {
    if (has(header) && get(header).trim()) payload[header] = get(header);
    if ((header === "description" || header === "notes") && has(header) && !get(header)) {
      payload[header] = "";
    }
  }
  for (const [header, property] of [
    ["sku", "sku"],
    ["location", "location"],
    ["serial_number", "serialNumber"],
    ["barcode", "barcode"],
  ] as const) {
    if (has(header)) payload[property] = get(header).trim() ? get(header) : null;
  }
  for (const [header, property] of [
    ["quantity", "quantity"],
    ["value_cents", "valueCents"],
    ["priority", "priority"],
  ] as const) {
    if (has(header) && get(header).trim()) payload[property] = get(header).trim();
    if (header === "value_cents" && has(header) && !get(header).trim()) {
      payload[property] = null;
    }
  }
  for (const [header, property] of [
    ["gps_latitude", "gpsLatitude"],
    ["gps_longitude", "gpsLongitude"],
    ["gps_altitude", "gpsAltitude"],
  ] as const) {
    if (has(header)) {
      payload[property] = get(header).trim() ? get(header).trim() : null;
    }
  }
  if (has("tags")) payload.tags = parseStringArray(get("tags"), "tags");
  if (has("slugs")) payload.slugs = parseStringArray(get("slugs"), "slugs");
  if (has("categories")) payload.categories = parseCategories(get("categories"));
  if (has("related_resource_ids")) {
    payload.relatedResourceIds = parseStringArray(
      get("related_resource_ids"),
      "related_resource_ids",
    );
  }
  if (has("map_features")) {
    payload.mapFeatures = parseMapFeatures(get("map_features"));
  }

  return {
    payload,
    ...(has("custom_fields")
      ? { customFields: parseCustomFields(get("custom_fields")) }
      : {}),
  };
}

const uuidForImportRow = (importKey: string, rowIndex: number) => {
  const characters = createHash("sha256")
    .update(`${importKey}:${rowIndex}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  characters[12] = "5";
  characters[16] = ["8", "9", "a", "b"][
    Number.parseInt(characters[16] ?? "0", 16) % 4
  ];
  const hex = characters.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const validationDetails = (
  issues: Array<{ path: PropertyKey[]; message: string }>,
  prefix?: string,
) =>
  issues.map(({ path, message }) => {
    const field = [prefix, ...path.map(String)].filter(Boolean).join(".");
    return field ? `${field}: ${message}` : message;
  });

const csvContainsSpatialData = (headers: string[], rows: CsvRow[]) => {
  for (const header of ["gps_latitude", "gps_longitude", "gps_altitude"]) {
    const index = headers.indexOf(header);
    if (
      index >= 0 &&
      rows.some((row) => removeSpreadsheetGuard(row.cells[index] ?? "").trim())
    ) {
      return true;
    }
  }

  const mapFeaturesIndex = headers.indexOf("map_features");
  if (mapFeaturesIndex < 0) return false;
  return rows.some((row) => {
    const value = removeSpreadsheetGuard(
      row.cells[mapFeaturesIndex] ?? "",
    ).trim();
    if (!value) return false;
    try {
      return parseMapFeatures(value).length > 0;
    } catch {
      // Malformed non-empty spatial data remains protected. Validation later
      // reports the row-level syntax error to authorized importers.
      return true;
    }
  });
};

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "inventory.import");
  if (authorization.response) return authorization.response;

  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      {
        error:
          "An Idempotency-Key UUID is required so retrying an import cannot create duplicate items.",
      },
      { status: 400 },
    );
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLocaleLowerCase("en-US");
  if (
    mediaType &&
    !["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"].includes(
      mediaType,
    )
  ) {
    return Response.json(
      { error: "Expected a UTF-8 CSV request body." },
      { status: 415 },
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES) {
    return Response.json(
      { error: "CSV files may be at most 5 MB." },
      { status: 413 },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody(request);
  } catch (error) {
    if (!(error instanceof CsvTooLargeError)) throw error;
    return Response.json(
      { error: error.message },
      { status: 413 },
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return Response.json(
      { error: "The CSV file is not valid UTF-8." },
      { status: 400 },
    );
  }
  if (text.includes("\u0000")) {
    return Response.json(
      { error: "The CSV file contains unsupported null characters." },
      { status: 400 },
    );
  }

  let csvRows: CsvRow[];
  try {
    csvRows = parseCsv(text);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof CsvSyntaxError ? error.message : "Unable to parse CSV.",
      },
      { status: 400 },
    );
  }

  const headerRow = csvRows[0];
  if (!headerRow || isBlankRow(headerRow)) {
    return Response.json(
      { error: "The CSV file must begin with a header row." },
      { status: 422 },
    );
  }
  const headers = headerRow.cells.map(canonicalHeader);
  const headerErrors: string[] = [];
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  const unknownHeaders = headers.filter((header) => !supportedHeaders.has(header));
  if (headers.some((header) => !header)) headerErrors.push("Headers cannot be empty.");
  if (duplicateHeaders.length) {
    headerErrors.push(
      `Duplicate headers: ${Array.from(new Set(duplicateHeaders)).join(", ")}.`,
    );
  }
  if (unknownHeaders.length) {
    headerErrors.push(
      `Unsupported headers: ${Array.from(new Set(unknownHeaders)).join(", ")}.`,
    );
  }
  if (!headers.includes("name")) headerErrors.push("The name header is required.");
  if (headerErrors.length) {
    return Response.json(
      { error: "Invalid CSV headers.", details: headerErrors },
      { status: 422 },
    );
  }

  const dataRows = csvRows.slice(1).filter((row) => !isBlankRow(row));
  if (!dataRows.length) {
    return Response.json(
      { error: "The CSV file does not contain any inventory rows." },
      { status: 422 },
    );
  }
  if (dataRows.length > MAX_DATA_ROWS) {
    return Response.json(
      { error: `One import may contain at most ${MAX_DATA_ROWS} rows.` },
      { status: 413 },
    );
  }
  if (
    csvContainsSpatialData(headers, dataRows) &&
    !authorization.identity.permissions.includes("spatial.manage")
  ) {
    return Response.json(
      { error: "You do not have permission to import spatial data." },
      { status: 403 },
    );
  }

  const batchHash = hashIdempotentPayload({
    actor: authorization.identity.subject,
    csv: text,
  });
  const results: ImportResult[] = [];

  for (const [rowIndex, row] of dataRows.entries()) {
    let parsedRow: ReturnType<typeof payloadFromRow>;
    try {
      parsedRow = payloadFromRow(row, headers);
    } catch (error) {
      results.push({
        line: row.line,
        status: "error",
        error: error instanceof Error ? error.message : "Invalid CSV row.",
      });
      continue;
    }

    const parsed = resourceInputSchema.safeParse(parsedRow.payload);
    if (!parsed.success) {
      results.push({
        line: row.line,
        status: "error",
        error: "Invalid inventory item.",
        details: validationDetails(parsed.error.issues),
      });
      continue;
    }

    const parsedCustomFields = customFieldValuesInputSchema.safeParse(
      parsedRow.customFields ?? {},
    );
    if (!parsedCustomFields.success) {
      results.push({
        line: row.line,
        status: "error",
        error: "Invalid custom fields.",
        details: validationDetails(
          parsedCustomFields.error.issues,
          "custom_fields",
        ),
      });
      continue;
    }

    try {
      const { slugs, ...resourceInput } = parsed.data;
      const rowIdempotencyKey = uuidForImportRow(idempotency.key, rowIndex);
      const requestHash = hashIdempotentPayload({
        actor: authorization.identity.subject,
        batchHash,
        rowIndex,
        resource: { ...parsed.data, customFields: parsedCustomFields.data },
      });
      const replay = await replayResourceCreation({
        organizationId: authorization.identity.organizationId,
        idempotencyKey: rowIdempotencyKey,
        requestHash,
      });
      if (replay) {
        results.push({
          line: row.line,
          status: "replayed",
          resource: {
            id: replay.response.resource.id,
            name: replay.response.resource.name,
            sku: replay.response.resource.sku,
          },
        });
        continue;
      }

      await assertActiveInventoryType(
        authorization.identity.organizationId,
        resourceInput.type,
      );
      await assertResourceIdentifiersAvailable(
        authorization.identity.organizationId,
        resourceInput,
      );
      const customFields = await validateCustomFieldValues({
        organizationId: authorization.identity.organizationId,
        entityType: "inventory",
        target: {
          type: resourceInput.type,
          categories: resourceInput.categories,
        },
        values: parsedCustomFields.data,
        enforceRequired: parsedRow.customFields !== undefined,
      });
      const values: NewResource = {
        ...resourceInput,
        organizationId: authorization.identity.organizationId,
        customFields,
        ...(parsed.data.mapFeatures.length
          ? positionFromMapFeatures(parsed.data.mapFeatures)
          : {}),
        createdBy: authorization.identity.subject,
      };
      const result = await createResourceIdempotently({
        organizationId: authorization.identity.organizationId,
        values,
        slugs,
        idempotencyKey: rowIdempotencyKey,
        requestHash,
        actor: authorization.identity.subject,
      });
      results.push({
        line: row.line,
        status: result.replayed ? "replayed" : "created",
        resource: {
          id: result.response.resource.id,
          name: result.response.resource.name,
          sku: result.response.resource.sku,
        },
      });
    } catch (error) {
      const structureFailure = inventoryStructureHttpError(error, "");
      if (structureFailure.status !== 500) {
        results.push({
          line: row.line,
          status: "error",
          error: structureFailure.message,
        });
        continue;
      }
      const customFieldFailure = customFieldHttpError(error, "");
      if (customFieldFailure.status !== 500) {
        results.push({
          line: row.line,
          status: "error",
          error: "Invalid custom fields.",
          details: [customFieldFailure.message],
        });
        continue;
      }
      if (error instanceof IdempotencyConflictError) {
        results.push({
          line: row.line,
          status: "error",
          error:
            "This import key was already used with different data. Select the file again to start a new import.",
        });
        continue;
      }
      if (error instanceof ResourceIdentifierConflictError) {
        results.push({
          line: row.line,
          status: "error",
          error: `${error.message} Existing items are never overwritten by CSV import.`,
        });
        continue;
      }
      if (isResourceSlugConflict(error)) {
        results.push({
          line: row.line,
          status: "error",
          error:
            "That slug is already in use; existing items are never overwritten by CSV import.",
        });
        continue;
      }
      const message = error instanceof Error ? error.message : "";
      results.push({
        line: row.line,
        status: "error",
        error: message.includes("resources_sku_unique")
          ? "That SKU is already in use; existing items are never overwritten by CSV import."
          : "Unable to create this inventory item.",
      });
    }
  }

  const summary = {
    total: results.length,
    created: results.filter((result) => result.status === "created").length,
    replayed: results.filter((result) => result.status === "replayed").length,
    failed: results.filter((result) => result.status === "error").length,
  };
  const status = summary.failed > 0 ? 207 : summary.created > 0 ? 201 : 200;

  const createdSpatialData = [
    "map_features",
    "gps_latitude",
    "gps_longitude",
  ].some((header) => {
    const index = headers.indexOf(header);
    return index >= 0 && dataRows.some((row) => row.cells[index]?.trim());
  });
  if (summary.created > 0 && createdSpatialData) {
    await synchronizeSpatialContainment(
      authorization.identity.organizationId,
      authorization.identity.subject,
    );
  }

  return Response.json(
    { importId: idempotency.key, summary, rows: results },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
