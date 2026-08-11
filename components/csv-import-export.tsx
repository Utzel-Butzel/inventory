"use client";

import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  RotateCcw,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useMemo, useRef, useState } from "react";

import { Button, Card } from "@/components/ui";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DATA_ROWS = 1_000;
const PREVIEW_ROWS = 8;

const supportedHeaders = new Set([
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
]);

const resourceTypes = new Set([
  "place",
  "person",
  "vehicle",
  "tool",
  "project",
  "clothing",
  "furniture",
  "object",
  "other",
]);

const resourceStatuses = new Set([
  "available",
  "in-use",
  "maintenance",
  "archived",
]);

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

type CsvRow = { cells: string[]; line: number };

type PreviewRow = {
  line: number;
  values: Record<string, string>;
  errors: string[];
};

type CsvPreview = {
  headers: string[];
  rows: PreviewRow[];
  totalRows: number;
  errors: string[];
};

type ImportRowResult = {
  line: number;
  status: "created" | "replayed" | "error";
  error?: string;
  details?: string[];
  resource?: { id: string; name: string; sku: string | null };
};

export type CsvImportSummary = {
  total: number;
  created: number;
  replayed: number;
  failed: number;
};

type CsvImportResponse = {
  importId: string;
  summary: CsvImportSummary;
  rows: ImportRowResult[];
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

function parseCsv(source: string): CsvRow[] {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

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
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else if (character === "\r") {
        if (text[index + 1] === "\n") index += 1;
        field += "\n";
        line += 1;
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (character === '"') {
      if (field.length) throw new Error(`Unexpected quote on line ${line}.`);
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
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error(`Quoted cell beginning on line ${rowStartLine} is not closed.`);
  }
  if (field.length || cells.length) finishRow();
  return rows;
}

const numberError = (
  value: string,
  label: string,
  options: { integer?: boolean; min: number; max: number },
) => {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return `${label} must be a number.`;
  if (options.integer && !Number.isInteger(number)) {
    return `${label} must be a whole number.`;
  }
  if (number < options.min || number > options.max) {
    return `${label} must be between ${options.min} and ${options.max}.`;
  }
  return null;
};

const validateJson = (
  value: string,
  label: string,
  shape: "array" | "object",
) => {
  if (!value.trim()) return null;
  if (
    ["tags", "categories", "related_resource_ids"].includes(label) &&
    !value.trim().startsWith("[")
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (shape === "array" && !Array.isArray(parsed)) {
      return `${label} must contain a JSON array.`;
    }
    if (
      shape === "object" &&
      (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    ) {
      return `${label} must contain a JSON object.`;
    }
    return null;
  } catch {
    return `${label} contains invalid JSON.`;
  }
};

function validateRow(
  row: CsvRow,
  headers: string[],
  validResourceTypes: ReadonlySet<string>,
): PreviewRow {
  const errors: string[] = [];
  if (row.cells.length > headers.length) {
    errors.push(`Expected ${headers.length} cells but found ${row.cells.length}.`);
  }
  const values: Record<string, string> = {};
  headers.forEach((header, index) => {
    values[header] = removeSpreadsheetGuard(row.cells[index] ?? "");
  });
  const value = (header: string) => values[header] ?? "";

  if (!value("name").trim()) errors.push("name is required.");
  if (value("name").trim().length > 240) errors.push("name is longer than 240 characters.");
  if (value("description").length > 20_000) {
    errors.push("description is longer than 20,000 characters.");
  }
  if (value("sku").trim().length > 80) errors.push("sku is longer than 80 characters.");
  if (value("location").trim().length > 240) {
    errors.push("location is longer than 240 characters.");
  }
  if (value("serial_number").trim().length > 180) {
    errors.push("serial_number is longer than 180 characters.");
  }
  if (value("notes").length > 20_000) errors.push("notes is longer than 20,000 characters.");
  if (
    value("type").trim() &&
    !validResourceTypes.has(value("type").trim())
  ) {
    errors.push(`Unknown type: ${value("type").trim()}.`);
  }
  if (value("status").trim() && !resourceStatuses.has(value("status").trim())) {
    errors.push(`Unknown status: ${value("status").trim()}.`);
  }
  if (value("currency").trim() && value("currency").trim().length !== 3) {
    errors.push("currency must use a three-letter code such as EUR.");
  }

  for (const error of [
    numberError(value("quantity"), "quantity", {
      integer: true,
      min: 0,
      max: 1_000_000,
    }),
    numberError(value("value_cents"), "value_cents", {
      integer: true,
      min: 0,
      max: 2_000_000_000,
    }),
    numberError(value("priority"), "priority", { integer: true, min: 1, max: 5 }),
    numberError(value("gps_latitude"), "gps_latitude", { min: -90, max: 90 }),
    numberError(value("gps_longitude"), "gps_longitude", { min: -180, max: 180 }),
    numberError(value("gps_altitude"), "gps_altitude", {
      min: -12_000,
      max: 100_000,
    }),
    validateJson(value("tags"), "tags", "array"),
    validateJson(value("categories"), "categories", "array"),
    validateJson(value("related_resource_ids"), "related_resource_ids", "array"),
    validateJson(value("map_features"), "map_features", "array"),
    validateJson(value("custom_fields"), "custom_fields", "object"),
  ]) {
    if (error) errors.push(error);
  }

  return { line: row.line, values, errors };
}

function previewCsv(
  text: string,
  validResourceTypes: ReadonlySet<string>,
): CsvPreview {
  const parsed = parseCsv(text);
  const headerRow = parsed[0];
  if (!headerRow || headerRow.cells.every((cell) => !cell.trim())) {
    return { headers: [], rows: [], totalRows: 0, errors: ["A header row is required."] };
  }

  const headers = headerRow.cells.map(canonicalHeader);
  const errors: string[] = [];
  const duplicates = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  const unknown = headers.filter((header) => !supportedHeaders.has(header));
  if (headers.some((header) => !header)) errors.push("Headers cannot be empty.");
  if (duplicates.length) {
    errors.push(`Duplicate headers: ${Array.from(new Set(duplicates)).join(", ")}.`);
  }
  if (unknown.length) {
    errors.push(`Unsupported headers: ${Array.from(new Set(unknown)).join(", ")}.`);
  }
  if (!headers.includes("name")) errors.push("The name header is required.");

  const dataRows = parsed
    .slice(1)
    .filter((row) => row.cells.some((cell) => cell.trim()));
  if (!dataRows.length) errors.push("The file does not contain any inventory rows.");
  if (dataRows.length > MAX_DATA_ROWS) {
    errors.push(`One import may contain at most ${MAX_DATA_ROWS} rows.`);
  }
  const rows = dataRows.map((row) =>
    validateRow(row, headers, validResourceTypes),
  );
  return { headers, rows, totalRows: dataRows.length, errors };
}

const newIdempotencyKey = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const responseError = async (response: Response) => {
  try {
    const payload = (await response.json()) as { error?: string; details?: string[] };
    return [payload.error, ...(payload.details ?? [])].filter(Boolean).join(" ");
  } catch {
    return `Request failed (HTTP ${response.status}).`;
  }
};

const filenameFromDisposition = (header: string | null) => {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return (match?.[1] ?? "inventory.csv").replace(/[^a-zA-Z0-9._-]/g, "_");
};

export function CsvImportExport({
  onImported,
  allowImport = true,
  inventoryTypeKeys,
}: {
  onImported?: (summary: CsvImportSummary) => void;
  allowImport?: boolean;
  inventoryTypeKeys?: string[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [importKey, setImportKey] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportResponse | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const validResourceTypes = useMemo(
    () =>
      inventoryTypeKeys?.length
        ? new Set(inventoryTypeKeys)
        : resourceTypes,
    [inventoryTypeKeys],
  );

  const rowErrors = useMemo(
    () => preview?.rows.filter((row) => row.errors.length) ?? [],
    [preview],
  );
  const canImport = Boolean(
    allowImport &&
    selectedFile &&
      csvText &&
      preview &&
      !preview.errors.length &&
      !rowErrors.length &&
      !importing,
  );

  const resetFile = () => {
    setSelectedFile(null);
    setCsvText("");
    setImportKey("");
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setResult(null);
    setError(null);
    setPreview(null);
    setCsvText("");
    setSelectedFile(file);
    setImportKey(file ? newIdempotencyKey() : "");
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("CSV files may be at most 5 MB.");
      return;
    }

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (text.includes("\u0000")) throw new Error("The file contains null characters.");
      const parsedPreview = previewCsv(text, validResourceTypes);
      setCsvText(text);
      setPreview(parsedPreview);
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : "The selected file is not valid UTF-8 CSV.",
      );
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/resources/export", {
        headers: { Accept: "text/csv" },
      });
      if (!response.ok) throw new Error(await responseError(response));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const importCsv = async () => {
    if (!canImport || !importKey) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/v1/resources/import", {
        method: "POST",
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Idempotency-Key": importKey,
        },
        body: csvText,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = (await response.json()) as CsvImportResponse;
      setResult(payload);
      if (payload.summary.created) onImported?.(payload.summary);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <FileSpreadsheet className="size-4 text-emerald-700" aria-hidden="true" />
            CSV import and export
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {allowImport
              ? "Export a safe spreadsheet, or preview up to 1,000 new inventory items before importing."
              : "Export the current inventory as a spreadsheet."}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Export CSV
        </Button>
      </div>

      {allowImport ? <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">
              {selectedFile ? selectedFile.name : "Choose a UTF-8 CSV file"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {selectedFile
                ? `${(selectedFile.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`
                : "Use the exported headers; id and timestamps are ignored on import."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {selectedFile ? (
              <Button variant="ghost" size="sm" onClick={resetFile}>
                <RotateCcw className="size-3.5" aria-hidden="true" /> Reset
              </Button>
            ) : null}
            <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
              <Upload className="size-3.5" aria-hidden="true" />
              {selectedFile ? "Replace" : "Choose file"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void chooseFile(event)}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Preview · {preview.totalRows} {preview.totalRows === 1 ? "row" : "rows"}
              </p>
              {preview.errors.length || rowErrors.length ? (
                <span className="text-xs font-semibold text-red-700">
                  {preview.errors.length + rowErrors.length} issue
                  {preview.errors.length + rowErrors.length === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> Ready to import
                </span>
              )}
            </div>

            {preview.errors.length ? (
              <ul className="space-y-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
                {preview.errors.map((message) => (
                  <li key={message}>• {message}</li>
                ))}
              </ul>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Line</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">SKU</th>
                    <th className="px-3 py-2 font-semibold">Quantity</th>
                    <th className="px-3 py-2 font-semibold">Location</th>
                    <th className="px-3 py-2 font-semibold">Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                  {preview.rows.slice(0, PREVIEW_ROWS).map((row) => (
                    <tr key={row.line} className={row.errors.length ? "bg-red-50/60" : undefined}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-400">{row.line}</td>
                      <td className="max-w-52 truncate px-3 py-2 font-medium text-slate-900">
                        {row.values.name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{row.values.type || "object"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.values.sku || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.values.quantity || "1"}</td>
                      <td className="max-w-44 truncate px-3 py-2">{row.values.location || "—"}</td>
                      <td className={row.errors.length ? "px-3 py-2 text-red-700" : "px-3 py-2 text-emerald-700"}>
                        {row.errors.length ? row.errors.join(" ") : "Valid"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.totalRows > PREVIEW_ROWS ? (
              <p className="text-xs text-slate-400">
                Showing the first {PREVIEW_ROWS} rows; all {preview.totalRows} rows were validated.
              </p>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
            aria-live="polite"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <CheckCircle2 className="size-4" aria-hidden="true" /> Import finished
            </p>
            <p className="mt-1 text-xs leading-5 text-emerald-800">
              {result.summary.created} created, {result.summary.replayed} already imported, {result.summary.failed} failed.
            </p>
            {result.summary.failed ? (
              <ul className="mt-2 space-y-1 text-xs text-red-800">
                {result.rows
                  .filter((row) => row.status === "error")
                  .slice(0, 20)
                  .map((row) => (
                    <li key={row.line}>
                      Line {row.line}: {row.error} {row.details?.join(" ")}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-5 text-slate-500">
            Import only creates new items. Existing records and matching SKUs are never changed.
          </p>
          <Button onClick={() => void importCsv()} disabled={!canImport}>
            {importing ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-4" aria-hidden="true" />
            )}
            Import {preview?.totalRows ?? 0} {preview?.totalRows === 1 ? "item" : "items"}
          </Button>
        </div>
      </div> : null}
    </Card>
  );
}
