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
import { useCallback, useEffect, useMemo, useState } from "react";

import { CodeScannerCamera } from "@/components/code-scanner-camera";
import { StockSectionNav } from "@/components/stock-section-nav";
import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";

type JsonRecord = Record<string, unknown>;
type WorkflowRevision = string | number;
type ScannerPhase = "scan" | "resolving" | "review" | "executing" | "success";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  revision: WorkflowRevision;
  enabled: boolean;
  unitStatus: string | null;
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
  statusAfter: string;
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
    name: firstString(record, ["name", "label"], "Untitled workflow"),
    description: firstString(record, ["description"]) || null,
    revision: readRevision(record.revision),
    enabled: asBoolean(record.enabled),
    unitStatus: normalizeStatus(record.unitStatus),
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
    name: firstString(resource, ["name", "resourceName", "label"], "Unknown resource"),
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
    !statusAfter ||
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
    metadataPreview: asRecord(resolution.metadataPreview),
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

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replaceAll("_", "-");
    if (normalized === "finished-assembled" || normalized === "fully-assembled") {
      return "Fully assembled";
    }
    return value;
  }
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function apiError(payload: unknown, fallback: string) {
  const root = asRecord(payload);
  if (!root) return fallback;
  const nested = asRecord(root.error);
  return (
    firstString(root, ["message", "error"]) ||
    firstString(nested, ["message", "detail"]) ||
    fallback
  );
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
  const entries = metadata ? Object.entries(metadata) : [];
  if (!entries.length) return <p className="text-xs text-[#5f6672]">No metadata</p>;
  return (
    <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5f6672]">
            {titleCase(key)}
          </dt>
          <dd className="mt-0.5 break-words text-xs font-medium text-[#34383f]">
            {displayValue(value)}
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
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ScannerPhase>("scan");
  const [rawCode, setRawCode] = useState("");
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [result, setResult] = useState<ExecuteResult | null>(null);

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
      if (!response.ok) {
        throw new Error(apiError(payload, "Scan workflows could not be loaded."));
      }
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
      setWorkflowsError(
        error instanceof Error ? error.message : "Scan workflows could not be loaded.",
      );
    } finally {
      if (!signal?.aborted) setWorkflowsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkflows(controller.signal);
    return () => controller.abort();
  }, [loadWorkflows]);

  const resetScan = useCallback(() => {
    setPhase("scan");
    setRawCode("");
    setResolution(null);
    setInputs({});
    setFieldErrors({});
    setRequestError(null);
    setIdempotencyKey("");
    setResult(null);
  }, []);

  const resolveCode = useCallback(
    async (code: string) => {
      const normalizedCode = code.trim();
      if (!selectedWorkflow || !normalizedCode || phase === "resolving" || phase === "executing") {
        return;
      }
      setRawCode(normalizedCode);
      setResolution(null);
      setResult(null);
      setRequestError(null);
      setPhase("resolving");
      try {
        const response = await fetch("/api/v1/stock/scans/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId: selectedWorkflow.id, code: normalizedCode }),
        });
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error(
            apiError(payload, "This code could not be resolved with the selected workflow."),
          );
        }
        const nextResolution = normalizeResolution(payload, selectedWorkflow);
        if (!nextResolution) {
          throw new Error("The scan service returned an unexpected resolution.");
        }
        setResolution(nextResolution);
        setInputs(
          Object.fromEntries(
            nextResolution.inputFields.map((field) => [field.key, field.defaultValue]),
          ),
        );
        setFieldErrors({});
        setIdempotencyKey(makeIdempotencyKey());
        setPhase("review");
      } catch (error) {
        setRequestError(
          error instanceof Error ? error.message : "The scanned code could not be resolved.",
        );
        setPhase("scan");
      }
    },
    [phase, selectedWorkflow],
  );

  const executeResolution = async () => {
    if (
      !canExecute ||
      !resolution ||
      (!resolution.unit && !resolution.willCreateUnit) ||
      !idempotencyKey ||
      phase === "executing"
    ) {
      return;
    }
    const validationErrors: Record<string, string> = {};
    const cleanedInputs: Record<string, string> = {};
    for (const field of resolution.inputFields) {
      const value = (inputs[field.key] ?? "").trim();
      if (field.required && !value) {
        validationErrors[field.key] = `${field.label} is required.`;
      } else if (value) {
        cleanedInputs[field.key] = value;
      }
    }
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;

    setRequestError(null);
    setPhase("executing");
    try {
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
          inputs: cleanedInputs,
          expectedResourceUpdatedAt: resolution.expectedResourceUpdatedAt,
          expectedUnitId: resolution.expectedUnitId,
          expectedUnitUpdatedAt: resolution.expectedUnitUpdatedAt,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(apiError(payload, "The stock update could not be completed."));
      }
      const nextResult = normalizeExecuteResult(payload, resolution);
      if (!nextResult) throw new Error("The stock service returned an unexpected result.");
      setResult(nextResult);
      setPhase("success");
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : "The stock update could not be completed.",
      );
      setPhase("review");
    }
  };

  const updateInput = (key: string, value: string) => {
    setInputs((current) => ({ ...current, [key]: value }));
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
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
          Stock automation
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-4xl">
              Scan into stock
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600 sm:text-base">
              Scan the complete QR content, let the selected workflow extract its
              identifier, and review every change before it reaches inventory.
            </p>
          </div>
          {selectedWorkflow ? (
            <Badge tone="brand" className="self-start sm:self-auto">
              {selectedWorkflow.name}
            </Badge>
          ) : null}
        </div>
      </div>

      <StockSectionNav />

      <div className="mt-6">
        {workflowsLoading ? (
          <ScannerLoading />
        ) : workflowsError ? (
          <Card>
            <EmptyState
              icon={<AlertTriangle className="size-5" aria-hidden="true" />}
              title="Scanner setup could not be loaded"
              description={workflowsError}
              action={
                <Button variant="secondary" onClick={() => void loadWorkflows()}>
                  <RefreshCw className="size-4" aria-hidden="true" /> Retry
                </Button>
              }
            />
          </Card>
        ) : workflows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Settings2 className="size-5" aria-hidden="true" />}
              title="No enabled scan workflow"
              description="Create and enable a workflow first. It defines how QR content maps to an EPD number, stock state, and editable properties."
            />
          </Card>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <div className="space-y-5">
              <Card className="p-4 sm:p-5">
                <label
                  htmlFor="scan-workflow"
                  className="text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6672]"
                >
                  Scan workflow
                </label>
                <select
                  id="scan-workflow"
                  value={selectedWorkflowId}
                  disabled={phase === "resolving" || phase === "executing"}
                  onChange={(event) => changeWorkflow(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-[#dfe2e7] bg-white px-3 text-sm font-semibold text-[#292c31] shadow-sm"
                >
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
                {selectedWorkflow?.description ? (
                  <p className="mt-2 text-xs leading-5 text-[#5f6672]">
                    {selectedWorkflow.description}
                  </p>
                ) : null}
              </Card>

              {phase === "success" && result ? (
                <Card className="overflow-hidden border-emerald-200">
                  <div className="bg-emerald-50 px-5 py-6 sm:px-6">
                    <div className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                        <Check className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                          Stock updated
                        </p>
                        <h2 className="mt-1 text-xl font-semibold text-emerald-950">
                          {result.resource.name}
                        </h2>
                        <p className="mt-1 text-sm text-emerald-800">
                          {result.created === true
                            ? "A new stock unit was assembled and added."
                            : "The existing stock unit was updated."}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-5 p-5 sm:p-6">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-[#f8f9fa] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5f6672]">
                          Unit
                        </p>
                        <p className="mt-1 break-all font-mono text-sm font-semibold text-[#292c31]">
                          {result.unit?.code ?? result.unit?.id ?? "—"}
                        </p>
                        {result.unit?.status ? (
                          <Badge tone="success" className="mt-2">
                            {titleCase(result.unit.status)}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="rounded-xl bg-[#f8f9fa] p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5f6672]">
                          Resource
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[#292c31]">
                          {result.resource.name}
                        </p>
                        <p className="mt-1 truncate font-mono text-[11px] text-[#5f6672]">
                          {result.resource.id}
                        </p>
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6672]">
                        Saved metadata
                      </h3>
                      <MetadataRows metadata={result.metadataAfter} />
                    </div>
                    <Button size="lg" className="w-full sm:w-auto" onClick={resetScan}>
                      <RotateCcw className="size-4" aria-hidden="true" /> Scan next item
                    </Button>
                  </div>
                </Card>
              ) : phase === "review" && resolution ? (
                <ReviewForm
                  resolution={resolution}
                  inputs={inputs}
                  errors={fieldErrors}
                  requestError={requestError}
                  canExecute={canExecute}
                  executing={false}
                  onInput={updateInput}
                  onCancel={resetScan}
                  onExecute={() => void executeResolution()}
                />
              ) : phase === "executing" && resolution ? (
                <ReviewForm
                  resolution={resolution}
                  inputs={inputs}
                  errors={fieldErrors}
                  requestError={requestError}
                  canExecute={canExecute}
                  executing
                  onInput={updateInput}
                  onCancel={resetScan}
                  onExecute={() => void executeResolution()}
                />
              ) : (
                <Card className="p-4 sm:p-5">
                  <CodeScannerCamera
                    key={selectedWorkflowId}
                    disabled={!selectedWorkflow || phase === "resolving"}
                    onDetected={(code) => void resolveCode(code)}
                  />
                  {phase === "resolving" ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-5 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-medium text-indigo-900"
                    >
                      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                      Resolving EPD number and workflow…
                    </div>
                  ) : null}
                  {requestError ? (
                    <div
                      role="alert"
                      className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                    >
                      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <div>
                        <p className="font-semibold">Code could not be resolved</p>
                        <p className="mt-0.5 text-xs leading-5 text-red-800">{requestError}</p>
                      </div>
                    </div>
                  ) : null}
                </Card>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-6">
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-[#292c31]">
                  <ScanLine className="size-4 text-[#5147d9]" aria-hidden="true" />
                  How this scan works
                </h2>
                <ol className="mt-4 space-y-4">
                  {[
                    ["1", "Scan", "Read a QR code or enter its complete content."],
                    ["2", "Enrich", "Choose configured properties such as color."],
                    ["3", "Review", "Confirm the unit and stock status before saving."],
                  ].map(([number, title, detail]) => (
                    <li key={number} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#eeedff] text-[11px] font-bold text-[#5147d9]">
                        {number}
                      </span>
                      <span>
                        <span className="block text-xs font-semibold text-[#34383f]">{title}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-[#5f6672]">
                          {detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
              {!canExecute ? (
                <Card className="border-amber-200 bg-amber-50 p-4">
                  <div className="flex gap-3">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
                    <div>
                      <p className="text-xs font-semibold text-amber-950">Read-only access</p>
                      <p className="mt-1 text-xs leading-5 text-amber-800">
                        You can scan and review a result, but only members and admins can apply
                        it to stock.
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
  errors,
  requestError,
  canExecute,
  executing,
  onInput,
  onCancel,
  onExecute,
}: {
  resolution: Resolution;
  inputs: Record<string, string>;
  errors: Record<string, string>;
  requestError: string | null;
  canExecute: boolean;
  executing: boolean;
  onInput: (key: string, value: string) => void;
  onCancel: () => void;
  onExecute: () => void;
}) {
  const unitUnavailable = !resolution.unit && !resolution.willCreateUnit;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[#e4e7eb] bg-[#f9fafb] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5147d9]">
              Review scan
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[#25282d]">
              {resolution.resource.name}
            </h2>
          </div>
          <Badge tone={resolution.unit ? "neutral" : unitUnavailable ? "danger" : "success"}>
            {resolution.unit
              ? "Existing unit"
              : unitUnavailable
                ? "Unit not found"
                : "New unit"}
          </Badge>
        </div>
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[#e4e7eb] p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5f6672]">
              <QrCode className="size-3" aria-hidden="true" /> Extracted EPD / code
            </p>
            <p className="mt-2 break-all font-mono text-sm font-semibold text-[#292c31]">
              {resolution.extractedCode}
            </p>
          </div>
          <div className="rounded-xl border border-[#e4e7eb] p-4">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5f6672]">
              <Warehouse className="size-3" aria-hidden="true" /> Target stock unit
            </p>
            <p className="mt-2 text-sm font-semibold text-[#292c31]">
              {resolution.unit?.code ?? resolution.extractedCode}
            </p>
            <p className="mt-1 text-xs text-[#5f6672]">
              {resolution.unit
                ? `Current status: ${titleCase(resolution.unit.status ?? "unknown")}`
                : resolution.willCreateUnit
                  ? "Will be created when you confirm"
                  : "No unit will be created"}
            </p>
          </div>
        </div>

        <section
          aria-labelledby="stock-impact-title"
          className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"
        >
          <h3
            id="stock-impact-title"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-indigo-800"
          >
            Inventory impact on confirmation
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white/80 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5f6672]">
                Lifecycle status
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#292c31]">
                <span>
                  {resolution.statusBefore
                    ? titleCase(resolution.statusBefore)
                    : "Unit does not exist yet"}
                </span>
                <ArrowRight className="size-4 shrink-0 text-indigo-600" aria-hidden="true" />
                <span className="text-indigo-800">{titleCase(resolution.statusAfter)}</span>
              </div>
            </div>
            <div className="rounded-lg bg-white/80 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5f6672]">
                    Available stock
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#292c31]">
                    <span>{resolution.quantityBefore}</span>
                    <ArrowRight className="size-4 text-indigo-600" aria-hidden="true" />
                    <span className="text-indigo-800">{resolution.quantityAfter}</span>
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
                  {resolution.delta}
                </Badge>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-indigo-900/75">
            Available stock counts only units whose lifecycle status is Available. A
            transition away from Available therefore reduces this quantity.
          </p>
        </section>

        {resolution.fixedProperties.length ? (
          <section aria-labelledby="fixed-properties-title">
            <h3
              id="fixed-properties-title"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6672]"
            >
              Set by workflow
            </h3>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {resolution.fixedProperties.map((property) => (
                <div key={property.key} className="rounded-xl bg-[#f4f5f7] px-3 py-2.5">
                  <dt className="text-[10px] font-medium text-[#5f6672]">{property.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-[#34383f]">
                    {displayValue(property.value)}
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
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6672]"
            >
              <Palette className="size-3.5" aria-hidden="true" /> Complete scan properties
            </h3>
            <div className="mt-3 space-y-5">
              {resolution.inputFields.map((field) => {
                const options =
                  isColorField(field) && field.options.length === 0
                    ? DEFAULT_COLOR_OPTIONS
                    : field.options;
                const colorField = isColorField({ ...field, options });
                const errorId = errors[field.key] ? `${field.key}-error` : undefined;
                return (
                  <div key={field.key}>
                    <label
                      htmlFor={`scan-field-${field.key}`}
                      className="text-sm font-semibold text-[#34383f]"
                    >
                      {field.label}
                      {field.required ? <span className="ml-1 text-[#c83d4d]">*</span> : null}
                    </label>
                    {colorField && options.length ? (
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
                                "flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3 text-left text-xs font-semibold transition",
                                checked
                                  ? "border-[#635bff] text-[#4139c8] shadow-[0_0_0_2px_rgb(99_91_255/0.12)]"
                                  : "border-[#dfe2e7] text-[#4c535e] hover:border-[#c7cad1]",
                              )}
                            >
                              <span
                                className="size-5 shrink-0 rounded-full border border-black/15 shadow-sm"
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
                        value={inputs[field.key] ?? ""}
                        disabled={executing}
                        required={field.required}
                        aria-invalid={Boolean(errors[field.key])}
                        aria-describedby={errorId}
                        onChange={(event) => onInput(field.key, event.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-[#dfe2e7] bg-white px-3 text-sm text-[#292c31] shadow-sm"
                      >
                        <option value="">Select {field.label.toLowerCase()}</option>
                        {options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`scan-field-${field.key}`}
                        type={field.type === "number" ? "number" : "text"}
                        value={inputs[field.key] ?? ""}
                        disabled={executing}
                        required={field.required}
                        aria-invalid={Boolean(errors[field.key])}
                        aria-describedby={errorId}
                        onChange={(event) => onInput(field.key, event.target.value)}
                        className="mt-2 h-11 w-full rounded-xl border border-[#dfe2e7] bg-white px-3 text-sm text-[#292c31] shadow-sm"
                      />
                    )}
                    {errors[field.key] ? (
                      <p id={errorId} role="alert" className="mt-1.5 text-xs text-[#b83243]">
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
          <section aria-labelledby="metadata-preview-title" className="rounded-xl bg-[#f8f9fa] p-4">
            <h3
              id="metadata-preview-title"
              className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-[#5f6672]"
            >
              Metadata preview
            </h3>
            <MetadataRows metadata={resolution.metadataPreview} />
          </section>
        ) : null}

        {requestError ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Update was not completed</p>
              <p className="mt-0.5 text-xs leading-5 text-red-800">{requestError}</p>
              <p className="mt-1 text-[11px] text-red-700">
                You can retry safely; the same idempotency key is reused.
              </p>
            </div>
          </div>
        ) : null}

        {unitUnavailable ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            No unit with this EPD number exists, and this workflow is not allowed to create
            one. Change the workflow or create the unit before trying again.
          </div>
        ) : null}

        {!canExecute ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            This is a read-only preview. Your role cannot execute stock changes.
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-[#e4e7eb] pt-5 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={executing} onClick={onCancel}>
            Scan again
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
              ? "Updating stock…"
              : unitUnavailable
                ? "Unit cannot be updated"
                : "Confirm and update stock"}
            {!executing ? <ArrowRight className="size-4" aria-hidden="true" /> : null}
          </Button>
        </div>
      </div>
    </Card>
  );
}
