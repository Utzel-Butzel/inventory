"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  PackageCheck,
  Palette,
  QrCode,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Settings2,
  Warehouse,
} from "lucide-react";
import { useT } from "next-i18next/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CodeScannerCamera } from "@/components/code-scanner-camera";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import {
  isScanCodeType,
  scanCodeTypes,
  type ScanCodeType,
} from "@/lib/scan-code-types";

type JsonRecord = Record<string, unknown>;
type WorkflowRevision = string | number;
type ScannerPhase = "scan" | "resolving" | "review" | "executing" | "success";
type ScannerInputValue = string | number | boolean | string[];
type WorkflowOperation =
  | { type: "unit" }
  | { type: "stock-adjustment"; delta: number }
  | { type: "assembly-build"; quantity: number };

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  revision: WorkflowRevision;
  enabled: boolean;
  unitStatus: string | null;
  operation: WorkflowOperation;
  codeTypes: ScanCodeType[];
};

type FieldOption = {
  value: string;
  label: string;
  color: string | null;
};

type InputField = {
  key: string;
  label: string;
  required: boolean;
  type: string;
  options: FieldOption[];
  defaultValue: string;
};

type FixedProperty = {
  key: string;
  label: string;
  value: unknown;
};

type ResourceSummary = {
  id: string;
  name: string;
  quantity: number | null;
  trackingMode: string | null;
  updatedAt: string | null;
};

type UnitSummary = {
  id: string;
  code: string | null;
  status: string | null;
  metadata: JsonRecord | null;
  updatedAt: string | null;
};

type Resolution = {
  workflow: Workflow;
  resource: ResourceSummary;
  unit: UnitSummary | null;
  willCreateUnit: boolean;
  extractedCode: string;
  inputFields: InputField[];
  fixedProperties: FixedProperty[];
  metadataPreview: JsonRecord | null;
  statusBefore: string | null;
  statusAfter: string | null;
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  expectedResourceUpdatedAt: string;
  expectedUnitId: string | null;
  expectedUnitUpdatedAt: string | null;
};

type ExecuteResult = {
  workflowId: string | null;
  revision: WorkflowRevision | null;
  resource: ResourceSummary;
  unit: UnitSummary | null;
  movement: JsonRecord | null;
  created: boolean | null;
  operation: WorkflowOperation;
  metadataBefore: JsonRecord | null;
  metadataAfter: JsonRecord | null;
};

type StockScannerProps = {
  canExecute: boolean;
};

const DEFAULT_COLOR_OPTIONS: FieldOption[] = [
  { value: "wood", label: "Wood", color: "#b8875c" },
  { value: "black", label: "Black", color: "#25282d" },
  { value: "white", label: "White", color: "#ffffff" },
  { value: "pink", label: "Pink", color: "#ef7fb0" },
  { value: "green", label: "Green", color: "#4d9564" },
  { value: "oak", label: "Oak", color: "#d2ab72" },
];

const KNOWN_SWATCHES: Record<string, string> = {
  holz: "#b8875c",
  wood: "#b8875c",
  schwarz: "#25282d",
  black: "#25282d",
  weiss: "#ffffff",
  weiß: "#ffffff",
  white: "#ffffff",
  pink: "#ef7fb0",
  rosa: "#ef7fb0",
  gruen: "#4d9564",
  grün: "#4d9564",
  green: "#4d9564",
  eiche: "#d2ab72",
  oak: "#d2ab72",
};

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstString(record: JsonRecord | null, keys: string[], fallback = "") {
  if (!record) return fallback;
  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== null && value.trim()) return value;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return fallback;
}

function asFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function normalizeStatus(value: unknown) {
  const status = asString(value)?.trim().toLowerCase().replaceAll("_", "-");
  return status || null;
}

function readRevision(value: unknown, fallback: WorkflowRevision = 1) {
  return typeof value === "number" || typeof value === "string" ? value : fallback;
}

function nestedPayloadRecord(payload: unknown, preferredKey: "resolution" | "result") {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root[preferredKey]) ?? asRecord(root.data) ?? root;
}

function normalizeWorkflow(value: unknown): Workflow | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = firstString(record, ["id", "workflowId"]);
  if (!id) return null;
  return {
    id,
    name: firstString(record, ["name", "label"]),
    description: firstString(record, ["description"]) || null,
    revision: readRevision(record.revision),
    enabled: asBoolean(record.enabled),
    unitStatus: normalizeStatus(record.unitStatus),
    codeTypes: Array.isArray(record.codeTypes)
      ? record.codeTypes.filter(isScanCodeType)
      : [...scanCodeTypes],
    operation:
      asRecord(record.operation)?.type === "stock-adjustment"
        ? {
            type: "stock-adjustment",
            delta: asFiniteNumber(asRecord(record.operation)?.delta) ?? 0,
          }
        : asRecord(record.operation)?.type === "assembly-build"
          ? {
              type: "assembly-build",
              quantity: asFiniteNumber(asRecord(record.operation)?.quantity) ?? 1,
            }
          : { type: "unit" },
  };
}

function workflowArray(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["workflows", "items", "results"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const data = asRecord(root.data);
  if (data) {
    for (const key of ["workflows", "items", "results"]) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
  }
  return [];
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawOption): FieldOption[] => {
    if (typeof rawOption === "string" || typeof rawOption === "number") {
      const option = String(rawOption);
      return [{ value: option, label: option, color: null }];
    }
    const option = asRecord(rawOption);
    if (!option) return [];
    const optionValue = firstString(option, ["value", "id", "key"]);
    if (!optionValue) return [];
    return [
      {
        value: optionValue,
        label: firstString(option, ["label", "name"], optionValue),
        color: firstString(option, ["color", "hex", "swatch"]) || null,
      },
    ];
  });
}

function normalizeFields(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawField, index): InputField[] => {
    const field = asRecord(rawField);
    if (!field) return [];
    const key = firstString(field, ["key", "id", "name"], `field_${index + 1}`);
    return [
      {
        key,
        label: firstString(field, ["label", "title", "name"], key),
        required: asBoolean(field.required),
        type: firstString(field, ["type", "inputType"], "text").toLowerCase(),
        options: normalizeOptions(field.options ?? field.choices ?? field.values),
        defaultValue: firstString(field, ["defaultValue", "default", "value"]),
      },
    ];
  });
}

function normalizeFixedProperties(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((rawProperty, index): FixedProperty[] => {
      const property = asRecord(rawProperty);
      if (!property) return [];
      const key = firstString(property, ["key", "id", "name"], `property_${index + 1}`);
      return [
        {
          key,
          label: firstString(property, ["label", "name"], key),
          value: property.value ?? property.fixedValue ?? "",
        },
      ];
    });
  }
  const properties = asRecord(value);
  if (!properties) return [];
  return Object.entries(properties).map(([key, propertyValue]) => ({
    key,
    label: titleCase(key),
    value: propertyValue,
  }));
}

function normalizeResource(value: unknown): ResourceSummary {
  const resource = asRecord(value);
  return {
    id: firstString(resource, ["id", "resourceId"]),
    name: firstString(resource, ["name", "resourceName", "label"]),
    quantity: asFiniteNumber(resource?.quantity),
    trackingMode: firstString(resource, ["trackingMode"]) || null,
    updatedAt: firstString(resource, ["updatedAt"]) || null,
  };
}

function normalizeUnit(value: unknown): UnitSummary | null {
  const unit = asRecord(value);
  if (!unit) return null;
  const id = firstString(unit, ["id", "unitId"]);
  const code = firstString(unit, ["code", "identifier", "epdNumber"]) || null;
  if (!id && !code) return null;
  return {
    id,
    code,
    status: normalizeStatus(unit.status ?? unit.state),
    metadata: asRecord(unit.metadata ?? unit.properties),
    updatedAt: firstString(unit, ["updatedAt"]) || null,
  };
}

function normalizeResolution(
  payload: unknown,
  fallbackWorkflow: Workflow,
): Resolution | null {
  const resolution = nestedPayloadRecord(payload, "resolution");
  if (!resolution) return null;
  const workflowRecord = asRecord(resolution.workflow);
  const workflow = normalizeWorkflow({
    ...fallbackWorkflow,
    ...(workflowRecord ?? {}),
    enabled: workflowRecord?.enabled ?? fallbackWorkflow.enabled,
  });
  if (!workflow) return null;

  const identifier = firstString(resolution, [
    "identifier",
    "extractedCode",
    "code",
    "epdNumber",
  ]);
  if (!identifier) return null;
  const fields = resolution.fields ?? resolution.inputFields;
  const resource = normalizeResource(resolution.resource ?? resolution.targetResource);
  const unit = normalizeUnit(resolution.unit);
  const willCreateUnit = asBoolean(
    resolution.willCreate ?? resolution.willCreateUnit,
    !resolution.unit,
  );
  const statusBefore = normalizeStatus(resolution.statusBefore);
  const statusAfter = normalizeStatus(resolution.statusAfter);
  const quantityBefore = asFiniteNumber(resolution.quantityBefore);
  const quantityAfter = asFiniteNumber(resolution.quantityAfter);
  const delta = asFiniteNumber(resolution.delta);
  const expectedResourceUpdatedAt =
    firstString(resolution, ["expectedResourceUpdatedAt"]) || resource.updatedAt;
  const expectedUnitId = firstString(resolution, ["expectedUnitId"]) || null;
  const expectedUnitUpdatedAt =
    firstString(resolution, ["expectedUnitUpdatedAt"]) || null;

  if (
    quantityBefore === null ||
    quantityAfter === null ||
    delta === null ||
    !expectedResourceUpdatedAt ||
    (expectedUnitId === null) !== (expectedUnitUpdatedAt === null)
  ) {
    return null;
  }

  return {
    workflow,
    resource,
    unit,
    willCreateUnit,
    extractedCode: identifier,
    inputFields: normalizeFields(fields),
    fixedProperties: normalizeFixedProperties(resolution.fixedProperties),
    metadataPreview: {
      ...(asRecord(resolution.metadataPreview) ?? {}),
      ...(asRecord(resolution.customFieldsPreview) ?? {}),
      ...(asRecord(resolution.executionPreview) ?? {}),
    },
    statusBefore,
    statusAfter,
    quantityBefore,
    quantityAfter,
    delta,
    expectedResourceUpdatedAt,
    expectedUnitId,
    expectedUnitUpdatedAt,
  };
}

function normalizeExecuteResult(payload: unknown, fallback: Resolution): ExecuteResult | null {
  const result = nestedPayloadRecord(payload, "result");
  if (!result) return null;
  const resource = normalizeResource(result.resource ?? fallback.resource);
  const unit = normalizeUnit(result.unit) ?? fallback.unit;
  if (!resource.id && !unit) return null;
  return {
    workflowId: firstString(result, ["workflowId"]) || fallback.workflow.id,
    revision:
      result.revision === undefined
        ? fallback.workflow.revision
        : readRevision(result.revision),
    resource,
    unit,
    movement: asRecord(result.movement),
    created:
      result.created === undefined
        ? null
        : asBoolean(result.created),
    operation:
      asRecord(result.operation)?.type === "stock-adjustment"
        ? {
            type: "stock-adjustment",
            delta: asFiniteNumber(asRecord(result.operation)?.delta) ?? 0,
          }
        : asRecord(result.operation)?.type === "assembly-build"
          ? {
              type: "assembly-build",
              quantity: asFiniteNumber(asRecord(result.operation)?.quantity) ?? 1,
            }
          : fallback.workflow.operation,
    metadataBefore: asRecord(result.metadataBefore),
    metadataAfter:
      asRecord(result.metadataAfter ?? result.metadata) ?? unit?.metadata ?? null,
  };
}

function titleCase(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(
  value: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
  number: Intl.NumberFormat,
) {
  if (value === null || value === undefined || value === "") return t("values.empty");
  if (typeof value === "boolean") return t(value ? "values.yes" : "values.no");
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replaceAll("_", "-");
    if (normalized === "finished-assembled" || normalized === "fully-assembled") {
      return t("values.fullyAssembled");
    }
    return value;
  }
  if (typeof value === "number") return number.format(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function isColorField(field: InputField) {
  return (
    field.type === "color" ||
    /(^|[\s_-])(color|colour|farbe)([\s_-]|$)/i.test(`${field.key} ${field.label}`) ||
    field.options.some((option) => option.color)
  );
}

function swatchColor(option: FieldOption) {
  const explicit = option.color?.trim();
  if (explicit && (/^#[\da-f]{3,8}$/i.test(explicit) || /^rgb|^hsl/i.test(explicit))) {
    return explicit;
  }
  return KNOWN_SWATCHES[option.value.toLowerCase()] ?? KNOWN_SWATCHES[option.label.toLowerCase()] ?? "#d6dae0";
}

function MetadataRows({ metadata }: { metadata: JsonRecord | null }) {
  const { t, i18n } = useT("scanner");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const number = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const entries = metadata ? Object.entries(metadata) : [];
  if (!entries.length) return <p className="text-xs text-muted">{t("scan.metadata.none")}</p>;
  return (
    <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            {titleCase(key)}
          </dt>
          <dd className="mt-0.5 break-words text-xs font-medium text-foreground">
            {displayValue(value, t, number)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ScannerLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <Skeleton className="h-[520px] rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

export function StockScanner({ canExecute }: StockScannerProps) {
  const { t } = useT("scanner");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ScannerPhase>("scan");
  const [rawCode, setRawCode] = useState("");
  const [rawCodeType, setRawCodeType] = useState<ScanCodeType | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [inputs, setInputs] = useState<Record<string, ScannerInputValue>>({});
  const [inputFiles, setInputFiles] = useState<Record<string, File[]>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const uploadIdempotencyKeys = useRef<Record<string, string>>({});

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflows],
  );

  const loadWorkflows = useCallback(async (signal?: AbortSignal) => {
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    try {
      const response = await fetch("/api/v1/stock/scan-workflows", {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error(t("scan.errors.workflowsLoad"));
      const enabledWorkflows = workflowArray(payload)
        .map(normalizeWorkflow)
        .filter((workflow): workflow is Workflow => Boolean(workflow?.enabled));
      setWorkflows(enabledWorkflows);
      setSelectedWorkflowId((current) =>
        enabledWorkflows.some((workflow) => workflow.id === current)
          ? current
          : (enabledWorkflows[0]?.id ?? ""),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setWorkflowsError(t("scan.errors.workflowsLoad"));
    } finally {
      if (!signal?.aborted) setWorkflowsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkflows(controller.signal);
    return () => controller.abort();
  }, [loadWorkflows]);

  const resetScan = useCallback(() => {
    setPhase("scan");
    setRawCode("");
    setRawCodeType(null);
    setResolution(null);
    setInputs({});
    setInputFiles({});
    setFieldErrors({});
    setRequestError(null);
    setIdempotencyKey("");
    setResult(null);
    uploadIdempotencyKeys.current = {};
  }, []);

  const resolveCode = useCallback(
    async (code: string, codeType: ScanCodeType | null = null) => {
      const normalizedCode = code.trim();
      if (!selectedWorkflow || !normalizedCode || phase === "resolving" || phase === "executing") {
        return;
      }
      setRawCode(normalizedCode);
      setRawCodeType(codeType);
      uploadIdempotencyKeys.current = {};
      setResolution(null);
      setResult(null);
      setRequestError(null);
      setPhase("resolving");
      try {
        const response = await fetch("/api/v1/stock/scans/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId: selectedWorkflow.id,
            code: normalizedCode,
            codeType,
          }),
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error(firstString(asRecord(payload), ["error"], t("scan.errors.resolve")));
        }
        const nextResolution = normalizeResolution(payload, selectedWorkflow);
        if (!nextResolution) {
          throw new Error(t("scan.errors.resolveUnexpected"));
        }
        setResolution(nextResolution);
        setInputs(
          Object.fromEntries(
            nextResolution.inputFields.map((field) => [field.key, field.defaultValue]),
          ),
        );
        setInputFiles({});
        setFieldErrors({});
        setIdempotencyKey(makeIdempotencyKey());
        setPhase("review");
      } catch (error) {
        setRequestError(
          error instanceof Error ? error.message : t("scan.errors.resolveFallback"),
        );
        setPhase("scan");
      }
    },
    [phase, selectedWorkflow, t],
  );

  const executeResolution = async () => {
    if (
      !canExecute ||
      !resolution ||
      (resolution.workflow.operation.type === "unit" &&
        !resolution.unit &&
        !resolution.willCreateUnit) ||
      !idempotencyKey ||
      phase === "executing"
    ) {
      return;
    }
    const validationErrors: Record<string, string> = {};
    const cleanedInputs: Record<string, ScannerInputValue> = {};
    for (const field of resolution.inputFields) {
      const rawValue = inputs[field.key];
      const value =
        typeof rawValue === "string" ? rawValue.trim() : rawValue;
      const files = inputFiles[field.key] ?? [];
      const empty =
        value === undefined || value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (field.required && (field.type === "media" || field.type === "file" ? files.length === 0 : empty)) {
        validationErrors[field.key] = t("scan.validation.required", { field: field.label });
      } else if (!empty) {
        cleanedInputs[field.key] =
          field.type === "number" ? Number(value) : value;
      }
    }
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;

    setRequestError(null);
    setPhase("executing");
    try {
      for (const field of resolution.inputFields) {
        if (field.type !== "media" && field.type !== "file") continue;
        const files = inputFiles[field.key] ?? [];
        if (!files.length) continue;
        const body = new FormData();
        files.forEach((file) => body.append("files", file));
        const uploadResponse = await fetch(
          `/api/v1/resources/${resolution.resource.id}/media`,
          {
            method: "POST",
            headers: {
              "Idempotency-Key":
                uploadIdempotencyKeys.current[field.key] ??=
                  makeIdempotencyKey(),
            },
            body,
          },
        );
        const uploadPayload = (await uploadResponse.json().catch(() => null)) as {
          uploaded?: Array<{ id?: string }>;
          error?: string;
        } | null;
        if (!uploadResponse.ok) {
          throw new Error(uploadPayload?.error ?? t("scan.errors.update"));
        }
        cleanedInputs[field.key] = (uploadPayload?.uploaded ?? [])
          .map((item) => item.id)
          .filter((id): id is string => Boolean(id));
      }
      const response = await fetch("/api/v1/stock/scans/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          workflowId: resolution.workflow.id,
          revision: resolution.workflow.revision,
          code: rawCode,
          codeType: rawCodeType,
          inputs: cleanedInputs,
          expectedResourceUpdatedAt: resolution.expectedResourceUpdatedAt,
          expectedUnitId: resolution.expectedUnitId,
          expectedUnitUpdatedAt: resolution.expectedUnitUpdatedAt,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(firstString(asRecord(payload), ["error"], t("scan.errors.update")));
      }
      const nextResult = normalizeExecuteResult(payload, resolution);
      if (!nextResult) throw new Error(t("scan.errors.updateUnexpected"));
      setResult(nextResult);
      setPhase("success");
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : t("scan.errors.update"),
      );
      setPhase("review");
    }
  };

  const updateInput = (key: string, value: ScannerInputValue) => {
    setInputs((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const updateInputFiles = (key: string, files: File[]) => {
    setInputFiles((current) => ({ ...current, [key]: files }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const changeWorkflow = (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    resetScan();
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          {t("scan.header.eyebrow")}
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              {t("scan.header.title")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted sm:text-base">
              {t("scan.header.description")}
            </p>
          </div>
          {selectedWorkflow ? (
            <Badge tone="brand" className="self-start sm:self-auto">
              {selectedWorkflow.name || t("scan.fallbacks.untitledWorkflow")}
            </Badge>
          ) : null}
        </div>
      </div>

      <div>
        {workflowsLoading ? (
          <ScannerLoading />
        ) : workflowsError ? (
          <Card>
            <EmptyState
              icon={<AlertTriangle className="size-5" aria-hidden="true" />}
              title={t("scan.setup.errorTitle")}
              description={workflowsError}
              action={
                <Button variant="secondary" onClick={() => void loadWorkflows()}>
                  <RefreshCw className="size-4" aria-hidden="true" /> {t("scan.setup.retry")}
                </Button>
              }
            />
          </Card>
        ) : workflows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Settings2 className="size-5" aria-hidden="true" />}
              title={t("scan.setup.emptyTitle")}
              description={t("scan.setup.emptyDescription")}
              action={
                canExecute ? (
                  <Link
                    href="/settings/action-flows"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-transparent bg-brand-solid px-4 text-sm font-semibold text-on-brand shadow-sm transition duration-150 hover:bg-brand-hover active:bg-brand-active"
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                    {t("scan.setup.configureWorkflows")}
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <div className="space-y-5">
              <Card className="p-4 sm:p-5">
                <label
                  htmlFor="scan-workflow"
                  className="text-xs font-semibold uppercase tracking-[0.08em] text-muted"
                >
                  {t("scan.setup.workflowLabel")}
                </label>
                <select
                  id="scan-workflow"
                  value={selectedWorkflowId}
                  disabled={phase === "resolving" || phase === "executing"}
                  onChange={(event) => changeWorkflow(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-foreground shadow-sm"
                >
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name || t("scan.fallbacks.untitledWorkflow")}
                    </option>
                  ))}
                </select>
                {selectedWorkflow?.description ? (
                  <p className="mt-2 text-xs leading-5 text-muted">
                    {selectedWorkflow.description}
                  </p>
                ) : null}
              </Card>

              {phase === "success" && result ? (
                <Card className="overflow-hidden border-success-border">
                  <div className="bg-success-soft px-5 py-6 sm:px-6">
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-on-strong">
                        <Check className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-success">
                          {t("scan.success.eyebrow")}
                        </p>
                        <h2 className="mt-1 text-xl font-semibold text-success">
                          {result.resource.name || t("scan.fallbacks.unknownResource")}
                        </h2>
                        <p className="mt-1 text-sm text-success">
                          {result.operation.type === "stock-adjustment"
                            ? `${result.operation.delta > 0 ? "+" : ""}${result.operation.delta} erfolgreich gebucht.`
                            : result.operation.type === "assembly-build"
                              ? "Baugruppe fertiggestellt und Komponenten ausgebucht."
                              : result.created === true
                                ? t("scan.success.created")
                                : t("scan.success.updated")}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-5 p-5 sm:p-6">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {result.unit ? (
                        <div className="rounded-xl bg-surface-subtle p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                            {t("scan.success.unit")}
                          </p>
                          <p className="mt-1 break-all font-mono text-sm font-semibold text-foreground">
                            {result.unit.code ?? result.unit.id}
                          </p>
                          {result.unit.status ? (
                            <Badge tone="success" className="mt-2">
                              {t(`statuses.${result.unit.status}`, {
                                defaultValue: titleCase(result.unit.status),
                              })}
                            </Badge>
                          ) : null}
                        </div>
                      ) : (
                        <div className="rounded-xl bg-surface-subtle p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                            Neuer Bestand
                          </p>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                            {result.resource.quantity ?? t("values.empty")}
                          </p>
                        </div>
                      )}
                      <div className="rounded-xl bg-surface-subtle p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                          {t("scan.success.resource")}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {result.resource.name || t("scan.fallbacks.unknownResource")}
                        </p>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted">
                          {result.resource.id}
                        </p>
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                        {t("scan.success.metadata")}
                      </h3>
                      <MetadataRows metadata={result.metadataAfter} />
                    </div>
                    <Button size="lg" className="w-full sm:w-auto" onClick={resetScan}>
                      <RotateCcw className="size-4" aria-hidden="true" /> {t("scan.success.next")}
                    </Button>
                  </div>
                </Card>
              ) : phase === "review" && resolution ? (
                <ReviewForm
                  resolution={resolution}
                  inputs={inputs}
                  inputFiles={inputFiles}
                  errors={fieldErrors}
                  requestError={requestError}
                  canExecute={canExecute}
                  executing={false}
                  onInput={updateInput}
                  onFiles={updateInputFiles}
                  onCancel={resetScan}
                  onExecute={() => void executeResolution()}
                />
              ) : phase === "executing" && resolution ? (
                <ReviewForm
                  resolution={resolution}
                  inputs={inputs}
                  inputFiles={inputFiles}
                  errors={fieldErrors}
                  requestError={requestError}
                  canExecute={canExecute}
                  executing
                  onInput={updateInput}
                  onFiles={updateInputFiles}
                  onCancel={resetScan}
                  onExecute={() => void executeResolution()}
                />
              ) : (
                <Card className="p-4 sm:p-5">
                  <CodeScannerCamera
                    key={selectedWorkflowId}
                    disabled={!selectedWorkflow || phase === "resolving"}
                    allowedFormats={selectedWorkflow?.codeTypes}
                    onDetected={(code, _source, codeType) =>
                      void resolveCode(code, codeType)
                    }
                  />
                  {phase === "resolving" ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-5 flex items-center gap-3 rounded-xl border border-brand-border bg-brand-soft px-4 py-3 text-sm font-medium text-brand-strong"
                    >
                      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                      {t("scan.resolving")}
                    </div>
                  ) : null}
                  {requestError ? (
                    <div
                      role="alert"
                      className="mt-5 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
                    >
                      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-semibold">{t("scan.resolveErrorTitle")}</p>
                        <p className="mt-0.5 text-xs leading-5 text-danger">{requestError}</p>
                      </div>
                    </div>
                  ) : null}
                </Card>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-6">
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ScanLine className="size-4 text-brand" aria-hidden="true" />
                  {t("scan.how.title")}
                </h2>
                <ol className="mt-4 space-y-4">
                  {(["scan", "enrich", "review"] as const).map((step) => (
                    <li key={step} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-bold text-brand">
                        {t(`scan.how.steps.${step}.number`)}
                      </span>
                      <span>
                        <span className="block text-xs font-semibold text-foreground">{t(`scan.how.steps.${step}.title`)}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted">
                          {t(`scan.how.steps.${step}.description`)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
              {!canExecute ? (
                <Card className="border-warning-border bg-warning-soft p-4">
                  <div className="flex gap-3">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <div>
                      <p className="text-xs font-semibold text-warning">{t("scan.readOnly.title")}</p>
                      <p className="mt-1 text-xs leading-5 text-warning">
                        {t("scan.readOnly.description")}
                      </p>
                    </div>
                  </div>
                </Card>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function ReviewForm({
  resolution,
  inputs,
  inputFiles,
  errors,
  requestError,
  canExecute,
  executing,
  onInput,
  onFiles,
  onCancel,
  onExecute,
}: {
  resolution: Resolution;
  inputs: Record<string, ScannerInputValue>;
  inputFiles: Record<string, File[]>;
  errors: Record<string, string>;
  requestError: string | null;
  canExecute: boolean;
  executing: boolean;
  onInput: (key: string, value: ScannerInputValue) => void;
  onFiles: (key: string, files: File[]) => void;
  onCancel: () => void;
  onExecute: () => void;
}) {
  const { t, i18n } = useT("scanner");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const number = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const defaultColorOptions = useMemo(
    () => DEFAULT_COLOR_OPTIONS.map((option) => ({
      ...option,
      label: t(`colors.${option.value}`, { defaultValue: option.label }),
    })),
    [t],
  );
  const unitUnavailable =
    resolution.workflow.operation.type === "unit" &&
    !resolution.unit &&
    !resolution.willCreateUnit;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-surface-subtle px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
              {t("scan.review.eyebrow")}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-foreground">
              {resolution.resource.name || t("scan.fallbacks.unknownResource")}
            </h2>
          </div>
          <Badge tone={resolution.unit ? "neutral" : unitUnavailable ? "danger" : "success"}>
            {resolution.workflow.operation.type === "stock-adjustment"
              ? "Bestandsbuchung"
              : resolution.workflow.operation.type === "assembly-build"
                ? "Montage abschließen"
                : resolution.unit
              ? t("scan.review.existingUnit")
              : unitUnavailable
                ? t("scan.review.unitNotFound")
                : t("scan.review.newUnit")}
          </Badge>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              <QrCode className="size-3" aria-hidden="true" /> {t("scan.review.extractedCode")}
            </p>
            <p className="mt-2 break-all font-mono text-sm font-semibold text-foreground">
              {resolution.extractedCode}
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              <Warehouse className="size-3" aria-hidden="true" /> {t("scan.review.targetUnit")}
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {resolution.workflow.operation.type === "stock-adjustment"
                ? resolution.resource.name
                : resolution.unit?.code ?? resolution.extractedCode}
            </p>
            <p className="mt-1 text-xs text-muted">
              {resolution.unit
                ? t("scan.review.currentStatus", {
                    status: t(`statuses.${resolution.unit.status ?? "unknown"}`, {
                      defaultValue: titleCase(resolution.unit.status ?? "unknown"),
                    }),
                  })
                : resolution.willCreateUnit
                  ? t("scan.review.willCreate")
                  : t("scan.review.willNotCreate")}
            </p>
          </div>
        </div>

        <section
          aria-labelledby="stock-impact-title"
          className="rounded-xl border border-brand-border bg-brand-soft/60 p-4"
        >
          <h3
            id="stock-impact-title"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-strong"
          >
            {t("scan.review.impactTitle")}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {resolution.statusAfter ? (
            <div className="rounded-lg bg-surface/80 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                {t("scan.review.lifecycleStatus")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                <span>
                  {resolution.statusBefore
                    ? t(`statuses.${resolution.statusBefore}`, {
                        defaultValue: titleCase(resolution.statusBefore),
                      })
                    : t("scan.review.unitDoesNotExist")}
                </span>
                <ArrowRight className="size-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="text-brand-strong">{t(`statuses.${resolution.statusAfter}`, {
                  defaultValue: titleCase(resolution.statusAfter),
                })}</span>
              </div>
            </div>
            ) : (
              <div className="rounded-lg bg-surface/80 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Aktion
                </p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {resolution.workflow.operation.type === "assembly-build"
                    ? `${resolution.workflow.operation.quantity} × Baugruppe fertigstellen`
                    : resolution.workflow.operation.type === "stock-adjustment"
                      ? `${resolution.workflow.operation.delta > 0 ? "+" : ""}${resolution.workflow.operation.delta} buchen`
                      : "Einheit aktualisieren"}
                </p>
              </div>
            )}
            <div className="rounded-lg bg-surface/80 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {t("scan.review.availableStock")}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span>{number.format(resolution.quantityBefore)}</span>
                    <ArrowRight className="size-4 text-brand" aria-hidden="true" />
                    <span className="text-brand-strong">{number.format(resolution.quantityAfter)}</span>
                  </div>
                </div>
                <Badge
                  tone={
                    resolution.delta < 0
                      ? "warning"
                      : resolution.delta > 0
                        ? "success"
                        : "neutral"
                  }
                >
                  {resolution.delta > 0 ? "+" : ""}
                  {number.format(resolution.delta)}
                </Badge>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-brand-strong/75">
            {t("scan.review.availableHelp")}
          </p>
        </section>

        {resolution.fixedProperties.length ? (
          <section aria-labelledby="fixed-properties-title">
            <h3
              id="fixed-properties-title"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-muted"
            >
              {t("scan.review.fixedProperties")}
            </h3>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {resolution.fixedProperties.map((property) => (
                <div key={property.key} className="rounded-xl bg-surface-muted px-3 py-2.5">
                  <dt className="text-[10px] font-medium text-muted">{property.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-foreground">
                    {displayValue(property.value, t, number)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {resolution.inputFields.length ? (
          <section aria-labelledby="scan-properties-title">
            <h3
              id="scan-properties-title"
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted"
            >
              <Palette className="size-3.5" aria-hidden="true" /> {t("scan.review.completeProperties")}
            </h3>
            <div className="mt-3 space-y-5">
              {resolution.inputFields.map((field) => {
                const options =
                  isColorField(field) && field.options.length === 0
                    ? defaultColorOptions
                    : field.options;
                const colorField = isColorField({ ...field, options });
                const errorId = errors[field.key] ? `${field.key}-error` : undefined;
                return (
                  <div key={field.key}>
                    <label
                      htmlFor={`scan-field-${field.key}`}
                      className="text-sm font-semibold text-foreground"
                    >
                      {field.label}
                      {field.required ? <span className="ml-1 text-danger">*</span> : null}
                    </label>
                    {field.type === "media" || field.type === "file" ? (
                      <div className="mt-2">
                        <input
                          id={`scan-field-${field.key}`}
                          type="file"
                          multiple
                          accept={
                            field.type === "media"
                              ? "image/*,video/*"
                              : "application/pdf,image/*,video/*,.usdz"
                          }
                          disabled={executing}
                          required={field.required}
                          aria-invalid={Boolean(errors[field.key])}
                          aria-describedby={errorId}
                          onChange={(event) =>
                            onFiles(field.key, Array.from(event.target.files ?? []))
                          }
                          className="block w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground shadow-sm"
                        />
                        {inputFiles[field.key]?.length ? (
                          <p className="mt-1.5 text-xs text-muted">
                            {inputFiles[field.key].map((file) => file.name).join(", ")}
                          </p>
                        ) : null}
                      </div>
                    ) : field.type === "checkbox" ? (
                      <label className="mt-2 flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 text-sm text-foreground shadow-sm">
                        <input
                          id={`scan-field-${field.key}`}
                          type="checkbox"
                          checked={inputs[field.key] === true}
                          disabled={executing}
                          onChange={(event) => onInput(field.key, event.target.checked)}
                          className="size-4 accent-brand-solid"
                        />
                        {field.label}
                      </label>
                    ) : colorField && options.length ? (
                      <div
                        role="radiogroup"
                        aria-label={field.label}
                        aria-describedby={errorId}
                        className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3"
                      >
                        {options.map((option) => {
                          const checked = inputs[field.key] === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={checked}
                              disabled={executing}
                              onClick={() => onInput(field.key, option.value)}
                              className={cn(
                                "flex min-h-11 items-center gap-2 rounded-xl border bg-surface px-3 text-left text-xs font-semibold transition",
                                checked
                                  ? "border-focus text-brand-strong ring-2 ring-focus/10"
                                  : "border-border text-muted-strong hover:border-border-strong",
                              )}
                            >
                              <span
                                className="size-5 shrink-0 rounded-full border border-border-strong shadow-sm"
                                style={{ backgroundColor: swatchColor(option) }}
                                aria-hidden="true"
                              />
                              <span className="truncate">{option.label}</span>
                              {checked ? (
                                <Check className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : options.length ? (
                      <select
                        id={`scan-field-${field.key}`}
                        value={String(inputs[field.key] ?? "")}
                        disabled={executing}
                        required={field.required}
                        aria-invalid={Boolean(errors[field.key])}
                        aria-describedby={errorId}
                        onChange={(event) => onInput(field.key, event.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground shadow-sm"
                      >
                        <option value="">{t("scan.review.selectField", { field: field.label })}</option>
                        {options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      field.type === "textarea" ? (
                        <textarea
                          id={`scan-field-${field.key}`}
                          value={String(inputs[field.key] ?? "")}
                          disabled={executing}
                          required={field.required}
                          aria-invalid={Boolean(errors[field.key])}
                          aria-describedby={errorId}
                          onChange={(event) => onInput(field.key, event.target.value)}
                          className="mt-2 min-h-24 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground shadow-sm"
                        />
                      ) : (
                        <input
                          id={`scan-field-${field.key}`}
                          type={field.type === "number" ? "number" : "text"}
                          value={String(inputs[field.key] ?? "")}
                          disabled={executing}
                          required={field.required}
                          aria-invalid={Boolean(errors[field.key])}
                          aria-describedby={errorId}
                          onChange={(event) => onInput(field.key, event.target.value)}
                          className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground shadow-sm"
                        />
                      )
                    )}
                    {errors[field.key] ? (
                      <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger">
                        {errors[field.key]}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {resolution.metadataPreview ? (
          <section aria-labelledby="metadata-preview-title" className="rounded-xl bg-surface-subtle p-4">
            <h3
              id="metadata-preview-title"
              className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted"
            >
              {t("scan.review.metadataPreview")}
            </h3>
            <MetadataRows metadata={resolution.metadataPreview} />
          </section>
        ) : null}

        {requestError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{t("scan.review.updateErrorTitle")}</p>
              <p className="mt-0.5 text-xs leading-5 text-danger">{requestError}</p>
              <p className="mt-1 text-[11px] text-danger">
                {t("scan.review.retryHelp")}
              </p>
            </div>
          </div>
        ) : null}

        {unitUnavailable ? (
          <div className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-xs leading-5 text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("scan.review.unitUnavailable")}
          </div>
        ) : null}

        {!canExecute ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-xs leading-5 text-warning">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("scan.review.readOnly")}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={executing} onClick={onCancel}>
            {t("scan.review.scanAgain")}
          </Button>
          <Button
            size="lg"
            disabled={!canExecute || executing || unitUnavailable}
            onClick={onExecute}
          >
            {executing ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <PackageCheck className="size-4" aria-hidden="true" />
            )}
            {executing
              ? t("scan.review.updating")
              : unitUnavailable
                ? t("scan.review.cannotUpdate")
                : t("scan.review.confirm")}
            {!executing ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
          </Button>
        </div>
      </div>
    </Card>
  );
}
