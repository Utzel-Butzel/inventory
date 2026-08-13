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
import type { TFunction } from "i18next";
import { useT } from "next-i18next/client";

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

function parseCsv(source: string, t: TFunction<"settings">): CsvRow[] {
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
      if (field.length) throw new Error(t("csv.validation.unexpectedQuote", { line }));
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
    throw new Error(t("csv.validation.unclosedQuote", { line: rowStartLine }));
  }
  if (field.length || cells.length) finishRow();
  return rows;
}

const numberError = (
  value: string,
  label: string,
  options: { integer?: boolean; min: number; max: number },
  t: TFunction<"settings">,
) => {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return t("csv.validation.number", { label });
  if (options.integer && !Number.isInteger(number)) {
    return t("csv.validation.wholeNumber", { label });
  }
  if (number < options.min || number > options.max) {
    return t("csv.validation.range", { label, min: options.min, max: options.max });
  }
  return null;
};

const validateJson = (
  value: string,
  label: string,
  shape: "array" | "object",
  t: TFunction<"settings">,
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
      return t("csv.validation.jsonArray", { label });
    }
    if (
      shape === "object" &&
      (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    ) {
      return t("csv.validation.jsonObject", { label });
    }
    return null;
  } catch {
    return t("csv.validation.invalidJson", { label });
  }
};

function validateRow(
  row: CsvRow,
  headers: string[],
  validResourceTypes: ReadonlySet<string>,
  t: TFunction<"settings">,
): PreviewRow {
  const errors: string[] = [];
  if (row.cells.length > headers.length) {
    errors.push(t("csv.validation.cellCount", { expected: headers.length, actual: row.cells.length }));
  }
  const values: Record<string, string> = {};
  headers.forEach((header, index) => {
    values[header] = removeSpreadsheetGuard(row.cells[index] ?? "");
  });
  const value = (header: string) => values[header] ?? "";

  if (!value("name").trim()) errors.push(t("csv.validation.required", { label: "name" }));
  if (value("name").trim().length > 240) errors.push(t("csv.validation.tooLong", { label: "name", max: 240 }));
  if (value("description").length > 20_000) {
    errors.push(t("csv.validation.tooLong", { label: "description", max: "20,000" }));
  }
  if (value("sku").trim().length > 80) errors.push(t("csv.validation.tooLong", { label: "sku", max: 80 }));
  if (value("location").trim().length > 240) {
    errors.push(t("csv.validation.tooLong", { label: "location", max: 240 }));
  }
  if (value("serial_number").trim().length > 180) {
    errors.push(t("csv.validation.tooLong", { label: "serial_number", max: 180 }));
  }
  if (value("notes").length > 20_000) errors.push(t("csv.validation.tooLong", { label: "notes", max: "20,000" }));
  if (
    value("type").trim() &&
    !validResourceTypes.has(value("type").trim())
  ) {
    errors.push(t("csv.validation.unknownType", { value: value("type").trim() }));
  }
  if (value("status").trim() && !resourceStatuses.has(value("status").trim())) {
    errors.push(t("csv.validation.unknownStatus", { value: value("status").trim() }));
  }
  if (value("currency").trim() && value("currency").trim().length !== 3) {
    errors.push(t("csv.validation.currency"));
  }

  for (const error of [
    numberError(value("quantity"), "quantity", {
      integer: true,
      min: 0,
      max: 1_000_000,
    }, t),
    numberError(value("value_cents"), "value_cents", {
      integer: true,
      min: 0,
      max: 2_000_000_000,
    }, t),
    numberError(value("priority"), "priority", { integer: true, min: 1, max: 5 }, t),
    numberError(value("gps_latitude"), "gps_latitude", { min: -90, max: 90 }, t),
    numberError(value("gps_longitude"), "gps_longitude", { min: -180, max: 180 }, t),
    numberError(value("gps_altitude"), "gps_altitude", {
      min: -12_000,
      max: 100_000,
    }, t),
    validateJson(value("tags"), "tags", "array", t),
    validateJson(value("categories"), "categories", "array", t),
    validateJson(value("related_resource_ids"), "related_resource_ids", "array", t),
    validateJson(value("map_features"), "map_features", "array", t),
    validateJson(value("custom_fields"), "custom_fields", "object", t),
  ]) {
    if (error) errors.push(error);
  }

  return { line: row.line, values, errors };
}

function previewCsv(
  text: string,
  validResourceTypes: ReadonlySet<string>,
  t: TFunction<"settings">,
): CsvPreview {
  const parsed = parseCsv(text, t);
  const headerRow = parsed[0];
  if (!headerRow || headerRow.cells.every((cell) => !cell.trim())) {
    return { headers: [], rows: [], totalRows: 0, errors: [t("csv.validation.headerRequired")] };
  }

  const headers = headerRow.cells.map(canonicalHeader);
  const errors: string[] = [];
  const duplicates = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  const unknown = headers.filter((header) => !supportedHeaders.has(header));
  if (headers.some((header) => !header)) errors.push(t("csv.validation.emptyHeaders"));
  if (duplicates.length) {
    errors.push(t("csv.validation.duplicateHeaders", { headers: Array.from(new Set(duplicates)).join(", ") }));
  }
  if (unknown.length) {
    errors.push(t("csv.validation.unsupportedHeaders", { headers: Array.from(new Set(unknown)).join(", ") }));
  }
  if (!headers.includes("name")) errors.push(t("csv.validation.nameHeaderRequired"));

  const dataRows = parsed
    .slice(1)
    .filter((row) => row.cells.some((cell) => cell.trim()));
  if (!dataRows.length) errors.push(t("csv.validation.noRows"));
  if (dataRows.length > MAX_DATA_ROWS) {
    errors.push(t("csv.validation.maxRows", { count: MAX_DATA_ROWS }));
  }
  const rows = dataRows.map((row) =>
    validateRow(row, headers, validResourceTypes, t),
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

const responseError = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string; details?: string[] };
    return [payload.error, ...(payload.details ?? [])].filter(Boolean).join(" ");
  } catch {
    return fallback;
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
  const { t, i18n } = useT("settings");
  const locale = i18n.resolvedLanguage ?? i18n.language;
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
      setError(t("csv.errors.maxFile"));
      return;
    }

    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (text.includes("\u0000")) throw new Error(t("csv.errors.nullCharacters"));
      const parsedPreview = previewCsv(text, validResourceTypes, t);
      setCsvText(text);
      setPreview(parsedPreview);
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : t("csv.errors.invalidUtf8"),
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
      if (!response.ok) throw new Error(await responseError(response, t("csv.errors.request", { status: response.status })));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : t("csv.errors.export"));
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
      if (!response.ok) throw new Error(await responseError(response, t("csv.errors.request", { status: response.status })));
      const payload = (await response.json()) as CsvImportResponse;
      setResult(payload);
      if (payload.summary.created) onImported?.(payload.summary);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t("csv.errors.import"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileSpreadsheet className="size-4 text-success" aria-hidden="true" />
            {t("csv.title")}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {allowImport
              ? t("csv.description")
              : t("csv.exportOnlyDescription")}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {t("csv.export")}
        </Button>
      </div>

      {allowImport ? <div className="space-y-4 p-5">
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong bg-surface-subtle/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-muted-strong">
              {selectedFile ? selectedFile.name : t("csv.chooseFile")}
            </p>
            <p className="mt-1 text-xs text-muted">
              {selectedFile
                ? `${(selectedFile.size / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KB`
                : t("csv.fileHint")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {selectedFile ? (
              <Button variant="ghost" size="sm" onClick={resetFile}>
                <RotateCcw className="size-3.5" aria-hidden="true" /> {t("csv.reset")}
              </Button>
            ) : null}
            <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-[13px] font-medium text-muted-strong shadow-sm transition hover:bg-surface-subtle">
              <Upload className="size-3.5" aria-hidden="true" />
              {selectedFile ? t("csv.replace") : t("csv.choose")}
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
            className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-3.5 py-3 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                {t("csv.previewRows", { count: preview.totalRows })}
              </p>
              {preview.errors.length || rowErrors.length ? (
                <span className="text-xs font-semibold text-danger">
                  {t("csv.issues", { count: preview.errors.length + rowErrors.length })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> {t("csv.ready")}
                </span>
              )}
            </div>

            {preview.errors.length ? (
              <ul className="space-y-1 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-xs text-danger">
                {preview.errors.map((message) => (
                  <li key={message}>• {message}</li>
                ))}
              </ul>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full divide-y divide-border text-left text-xs">
                <thead className="bg-surface-subtle text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t("csv.table.line")}</th>
                    <th className="px-3 py-2 font-semibold">{t("csv.table.name")}</th>
                    <th className="px-3 py-2 font-semibold">{t("csv.table.type")}</th>
                    <th className="px-3 py-2 font-semibold">{t("csv.table.sku")}</th>
                    <th className="px-3 py-2 font-semibold">{t("csv.table.quantity")}</th>
                    <th className="px-3 py-2 font-semibold">{t("csv.table.location")}</th>
                    <th className="px-3 py-2 font-semibold">{t("csv.table.validation")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface text-muted-strong">
                  {preview.rows.slice(0, PREVIEW_ROWS).map((row) => (
                    <tr key={row.line} className={row.errors.length ? "bg-danger-soft/60" : undefined}>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{row.line}</td>
                      <td className="max-w-52 truncate px-3 py-2 font-medium text-foreground">
                        {row.values.name || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{row.values.type || "object"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.values.sku || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2">{row.values.quantity || "1"}</td>
                      <td className="max-w-44 truncate px-3 py-2">{row.values.location || "—"}</td>
                      <td className={row.errors.length ? "px-3 py-2 text-danger" : "px-3 py-2 text-success"}>
                        {row.errors.length ? row.errors.join(" ") : t("csv.table.valid")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.totalRows > PREVIEW_ROWS ? (
              <p className="text-xs text-muted">
                {t("csv.showingRows", { shown: PREVIEW_ROWS, total: preview.totalRows })}
              </p>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div
            className="rounded-xl border border-success-border bg-success-soft px-4 py-3"
            aria-live="polite"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" /> {t("csv.finished")}
            </p>
            <p className="mt-1 text-xs leading-5 text-success">
              {t("csv.summary", result.summary)}
            </p>
            {result.summary.failed ? (
              <ul className="mt-2 space-y-1 text-xs text-danger">
                {result.rows
                  .filter((row) => row.status === "error")
                  .slice(0, 20)
                  .map((row) => (
                    <li key={row.line}>
                      {t("csv.lineError", {
                        line: row.line,
                        error: row.error ?? "",
                        details: row.details?.join(" ") ?? "",
                      })}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-5 text-muted">
            {t("csv.importNote")}
          </p>
          <Button onClick={() => void importCsv()} disabled={!canImport}>
            {importing ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-4" aria-hidden="true" />
            )}
            {t("csv.importItems", { count: preview?.totalRows ?? 0 })}
          </Button>
        </div>
      </div> : null}
    </Card>
  );
}
