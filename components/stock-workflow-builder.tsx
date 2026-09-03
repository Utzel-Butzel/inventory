"use client";

import type { TFunction } from "i18next";
import {
  OrganizationLink as Link,
  useOrganizationHref,
} from "@/components/organization-routing";
import { useT } from "next-i18next/client";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  Eye,
  ExternalLink,
  FileKey2,
  Layers3,
  Link2,
  LoaderCircle,
  Lock,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCcw,
  Save,
  ScanLine,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Webhook,
  Workflow,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { CodeScannerCamera } from "@/components/code-scanner-camera";
import {
  InventorySelect,
  type InventorySelectItem,
} from "@/components/inventory-select";
import { fetchJson } from "@/lib/client-types";
import {
  scanCodeTypeLabels,
  scanCodeTypes,
  type ScanCodeType,
} from "@/lib/scan-code-types";
import {
  extractScanRegexValue,
  scanRegexFromSelection,
  scanRegexValidationError,
} from "@/lib/scan-regex";

type ExtractionMode = "full" | "url-query" | "prefix" | "regex";
type UnitStatus =
  | "available"
  | "reserved"
  | "in-use"
  | "maintenance"
  | "consumed"
  | "lost"
  | "retired";

type Extraction =
  | { mode: "full" }
  | {
      mode: "url-query";
      parameter: string;
      sourceOrigin?: string;
      sourcePath?: string;
    }
  | { mode: "prefix"; prefix: string }
  | { mode: "regex"; pattern: string; flags: string; group: string };

type StorageTarget = "custom-field" | "metadata" | "execution";
type TargetSelectionMode = "all" | "radio" | "checkbox";
type InputType =
  | "text"
  | "textarea"
  | "number"
  | "checkbox"
  | "select"
  | "radio"
  | "media"
  | "file";
type Operation =
  | { type: "unit" }
  | { type: "stock-adjustment"; delta: number }
  | { type: "assembly-build"; quantity: number };

type FixedProperty = {
  key: string;
  label: string;
  value: string;
  storage: StorageTarget;
};

type ExtractedField = {
  key: string;
  label: string;
  extraction: Extraction;
  storage: StorageTarget;
};

type InputOption = {
  value: string;
  label: string;
  color?: string;
};

type InputField = {
  key: string;
  label: string;
  required: boolean;
  type: InputType;
  storage: StorageTarget;
  placeholder: string;
  options: InputOption[];
};

type WorkflowPayload = {
  name: string;
  description: string;
  enabled: boolean;
  resourceId: string;
  resourceIds: string[];
  targetSelectionMode: TargetSelectionMode;
  allowVariantSelection: boolean;
  codeTypes: ScanCodeType[];
  publicTriggerEnabled: boolean;
  publicTriggerCode: string | null;
  quantityInputKey: string | null;
  extraction: Extraction;
  identifierPropertyKey: string;
  identifierStorage: StorageTarget;
  extractedFields: ExtractedField[];
  operation: Operation;
  createMissingUnit: boolean;
  unitStatus: UnitStatus | null;
  fixedProperties: FixedProperty[];
  inputFields: InputField[];
  triggerWebhook: boolean;
  webhookEventName: string;
  revision?: number;
};

type WorkflowRecord = Omit<WorkflowPayload, "revision"> & {
  id: string;
  publicTriggerId: string;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
};

type StockItem = {
  resourceId: string;
  name: string;
  sku?: string | null;
  type?: string;
  quantity?: number;
  trackingMode: string;
  unitName?: string;
  variantOfResourceId?: string | null;
  cover?: InventorySelectItem["cover"];
};

type StockUnitCustomField = {
  key: string;
  label: string;
  fieldType: string;
};

type DraftOption = InputOption & { uid: string };
type DraftInput = Omit<InputField, "options"> & {
  uid: string;
  options: DraftOption[];
};
type DraftFixedProperty = FixedProperty & { uid: string };
type DraftExtraction = {
  mode: ExtractionMode;
  parameter: string;
  prefix: string;
  sourceOrigin: string;
  sourcePath: string;
  pattern: string;
  flags: string;
  group: string;
};
type DraftExtractedField = Omit<ExtractedField, "extraction"> & {
  uid: string;
  extraction: DraftExtraction;
};

type WorkflowDraft = {
  id: string | null;
  revision?: number;
  name: string;
  description: string;
  enabled: boolean;
  resourceId: string;
  resourceIds: string[];
  targetSelectionMode: TargetSelectionMode;
  allowVariantSelection: boolean;
  codeTypes: ScanCodeType[];
  publicTriggerEnabled: boolean;
  publicTriggerId: string | null;
  publicTriggerCode: string;
  quantityInputKey: string | null;
  extraction: DraftExtraction;
  identifierPropertyKey: string;
  identifierStorage: StorageTarget;
  extractedFields: DraftExtractedField[];
  operation: Operation;
  createMissingUnit: boolean;
  unitStatus: UnitStatus | null;
  fixedProperties: DraftFixedProperty[];
  inputFields: DraftInput[];
  triggerWebhook: boolean;
  webhookEventName: string;
};

type Notice = { tone: "success" | "error" | "info"; message: string };

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-[14px] text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const textAreaClass =
  "mt-1.5 min-h-20 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] leading-5 text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const labelClass = "block text-[12px] font-semibold text-muted-strong";

type StockUnitCustomFieldSelectProps = {
  fields: StockUnitCustomField[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  t: TFunction;
  className?: string;
};

function StockUnitCustomFieldSelect({
  fields,
  value,
  onChange,
  disabled,
  t,
  className,
}: StockUnitCustomFieldSelectProps) {
  const selectedField = fields.find((field) => field.key === value);

  return (
    <label className={cn(labelClass, className)}>
      {t("workflows.storage.customFieldLabel")}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
        disabled={disabled}
      >
        <option value="" disabled>
          {fields.length
            ? t("workflows.storage.customFieldPlaceholder")
            : t("workflows.storage.noCustomFields")}
        </option>
        {value && !selectedField ? (
          <option value={value}>
            {t("workflows.storage.missingCustomField", { key: value })}
          </option>
        ) : null}
        {fields.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label} ({field.key})
          </option>
        ))}
      </select>
    </label>
  );
}

const unitStatuses: UnitStatus[] = [
  "available",
  "reserved",
  "in-use",
  "maintenance",
  "consumed",
  "lost",
  "retired",
];

let nextLocalId = 0;
function localId(prefix: string) {
  nextLocalId += 1;
  return `${prefix}-${nextLocalId}`;
}

function templateDraft(t: TFunction, resourceId = ""): WorkflowDraft {
  return {
    id: null,
    name: t("workflows.template.name"),
    description: t("workflows.template.description"),
    enabled: true,
    resourceId,
    resourceIds: resourceId ? [resourceId] : [],
    targetSelectionMode: "all",
    allowVariantSelection: false,
    codeTypes: ["qr_code"],
    publicTriggerEnabled: false,
    publicTriggerId: null,
    publicTriggerCode: "",
    quantityInputKey: null,
    extraction: {
      mode: "url-query",
      parameter: "d",
      prefix: "EPD-",
      sourceOrigin: "https://paperlesspaper.de",
      sourcePath: "/b",
      pattern: "^.*[?&]d=(?<value>[^&]+).*$",
      flags: "",
      group: "value",
    },
    identifierPropertyKey: "epdNumber",
    identifierStorage: "custom-field",
    extractedFields: [],
    operation: { type: "assembly-build", quantity: 1 },
    createMissingUnit: true,
    unitStatus: null,
    fixedProperties: [
      {
        uid: "template-fixed-assembly-status",
        key: "assemblyStatus",
        label: t("workflows.template.assemblyStatus"),
        value: "finished-assembled",
        storage: "metadata",
      },
    ],
    inputFields: [
      {
        uid: "template-input-color",
        key: "color",
        label: t("workflows.template.color"),
        required: true,
        type: "radio",
        storage: "custom-field",
        placeholder: "",
        options: [
          { uid: "template-color-wood", value: "wood", label: t("workflows.template.colors.wood"), color: "#b9875e" },
          { uid: "template-color-black", value: "black", label: t("workflows.template.colors.black"), color: "#202124" },
          { uid: "template-color-white", value: "white", label: t("workflows.template.colors.white"), color: "#f4f2ec" },
          { uid: "template-color-pink", value: "pink", label: t("workflows.template.colors.pink"), color: "#ec8eb0" },
          { uid: "template-color-green", value: "green", label: t("workflows.template.colors.green"), color: "#668c67" },
          { uid: "template-color-oak", value: "oak", label: t("workflows.template.colors.oak"), color: "#c9a56a" },
        ],
      },
    ],
    triggerWebhook: false,
    webhookEventName: "inventory.action.executed",
  };
}

function extractionToDraft(extraction: Extraction): DraftExtraction {
  return {
    mode: extraction.mode,
    parameter: extraction.mode === "url-query" ? extraction.parameter : "d",
    prefix: extraction.mode === "prefix" ? extraction.prefix : "EPD-",
    sourceOrigin:
      extraction.mode === "url-query" ? extraction.sourceOrigin ?? "" : "",
    sourcePath:
      extraction.mode === "url-query" ? extraction.sourcePath ?? "" : "",
    pattern: extraction.mode === "regex" ? extraction.pattern : "(?<value>.+)",
    flags: extraction.mode === "regex" ? extraction.flags : "",
    group: extraction.mode === "regex" ? extraction.group : "value",
  };
}

function extractionFromDraft(extraction: DraftExtraction): Extraction {
  if (extraction.mode === "full") return { mode: "full" };
  if (extraction.mode === "prefix") {
    return { mode: "prefix", prefix: extraction.prefix.trim() };
  }
  if (extraction.mode === "regex") {
    return {
      mode: "regex",
      pattern: extraction.pattern,
      flags: extraction.flags,
      group: extraction.group,
    };
  }
  return {
    mode: "url-query",
    parameter: extraction.parameter.trim(),
    ...(extraction.sourceOrigin.trim()
      ? { sourceOrigin: extraction.sourceOrigin.trim() }
      : {}),
    ...(extraction.sourcePath.trim()
      ? { sourcePath: extraction.sourcePath.trim() }
      : {}),
  };
}

function workflowToDraft(workflow: WorkflowRecord): WorkflowDraft {
  const extraction = workflow.extraction;
  return {
    ...workflow,
    id: workflow.id,
    resourceIds: workflow.resourceIds?.length
      ? workflow.resourceIds
      : [workflow.resourceId],
    targetSelectionMode: workflow.targetSelectionMode ?? "all",
    allowVariantSelection: workflow.allowVariantSelection ?? false,
    extraction: extractionToDraft(extraction),
    codeTypes: workflow.codeTypes?.length
      ? workflow.codeTypes
      : [...scanCodeTypes],
    publicTriggerEnabled: workflow.publicTriggerEnabled ?? false,
    publicTriggerId: workflow.publicTriggerId ?? null,
    publicTriggerCode: workflow.publicTriggerCode ?? "",
    quantityInputKey: workflow.quantityInputKey ?? null,
    identifierStorage: workflow.identifierStorage ?? "metadata",
    operation: workflow.operation ?? { type: "unit" },
    extractedFields: (workflow.extractedFields ?? []).map((field, index) => ({
      ...field,
      uid: `extracted-${index}-${field.key}`,
      storage: field.storage ?? "custom-field",
      extraction: extractionToDraft(field.extraction),
    })),
    fixedProperties: workflow.fixedProperties.map((property, index) => ({
      ...property,
      storage: property.storage ?? "metadata",
      uid: `fixed-${index}-${property.key}`,
    })),
    inputFields: workflow.inputFields.map((field, fieldIndex) => ({
      ...field,
      type: field.type ?? "select",
      storage: field.storage ?? "metadata",
      placeholder: field.placeholder ?? "",
      uid: `input-${fieldIndex}-${field.key}`,
      options: field.options.map((option, optionIndex) => ({
        ...option,
        uid: `option-${fieldIndex}-${optionIndex}-${option.value}`,
      })),
    })),
    triggerWebhook: workflow.triggerWebhook ?? false,
    webhookEventName:
      workflow.webhookEventName ?? "inventory.action.executed",
  };
}

function draftToPayload(draft: WorkflowDraft): WorkflowPayload {
  const extraction = extractionFromDraft(draft.extraction);

  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    resourceId: draft.resourceIds[0] ?? draft.resourceId,
    resourceIds: draft.resourceIds,
    targetSelectionMode: draft.targetSelectionMode,
    allowVariantSelection: draft.allowVariantSelection,
    codeTypes: draft.codeTypes,
    publicTriggerEnabled: draft.publicTriggerEnabled,
    publicTriggerCode: draft.publicTriggerCode.trim() || null,
    quantityInputKey: draft.quantityInputKey,
    extraction,
    identifierPropertyKey: draft.identifierPropertyKey.trim(),
    identifierStorage: draft.identifierStorage,
    extractedFields: draft.extractedFields.map((field) => ({
      key: field.key.trim(),
      label: field.label.trim(),
      storage: field.storage,
      extraction: extractionFromDraft(field.extraction),
    })),
    operation: draft.operation,
    createMissingUnit: draft.createMissingUnit,
    unitStatus: draft.unitStatus,
    fixedProperties: draft.fixedProperties.map(({ key, label, value, storage }) => ({
      key: key.trim(),
      label: label.trim(),
      value: value.trim(),
      storage,
    })),
    inputFields: draft.inputFields.map(({ key, label, required, type, storage, placeholder, options }) => ({
      key: key.trim(),
      label: label.trim(),
      required,
      type,
      storage,
      placeholder: placeholder.trim(),
      options: options.map(({ value, label: optionLabel, color }) => ({
        value: value.trim(),
        label: optionLabel.trim(),
        ...(color ? { color } : {}),
      })),
    })),
    triggerWebhook: draft.triggerWebhook,
    webhookEventName: draft.webhookEventName.trim(),
    ...(draft.revision !== undefined ? { revision: draft.revision } : {}),
  };
}

function payloadSignature(draft: WorkflowDraft) {
  return JSON.stringify(draftToPayload(draft));
}

function workflowsFromResponse(payload: unknown): WorkflowRecord[] {
  if (Array.isArray(payload)) return payload as WorkflowRecord[];
  if (payload && typeof payload === "object") {
    const candidate = payload as {
      workflows?: unknown;
      items?: unknown;
      data?: unknown;
    };
    if (Array.isArray(candidate.workflows)) return candidate.workflows as WorkflowRecord[];
    if (Array.isArray(candidate.items)) return candidate.items as WorkflowRecord[];
    if (Array.isArray(candidate.data)) return candidate.data as WorkflowRecord[];
  }
  return [];
}

function workflowFromResponse(payload: unknown): WorkflowRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as { workflow?: unknown; data?: unknown; id?: unknown };
  const candidate = wrapper.workflow ?? wrapper.data ?? payload;
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { id?: unknown }).id === "string"
  ) {
    return candidate as WorkflowRecord;
  }
  return null;
}

function stockItemsFromResponse(payload: unknown): StockItem[] {
  if (!payload || typeof payload !== "object") return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is StockItem =>
      Boolean(
        item &&
          typeof item === "object" &&
          typeof (item as StockItem).resourceId === "string" &&
          typeof (item as StockItem).name === "string" &&
          typeof (item as StockItem).trackingMode === "string",
      ),
  );
}

function stockUnitCustomFieldsFromResponse(payload: unknown): StockUnitCustomField[] {
  if (!payload || typeof payload !== "object") return [];
  const definitions = (payload as { definitions?: unknown }).definitions;
  if (!Array.isArray(definitions)) return [];
  return definitions.filter(
    (definition): definition is StockUnitCustomField =>
      Boolean(
        definition &&
          typeof definition === "object" &&
          typeof (definition as StockUnitCustomField).key === "string" &&
          typeof (definition as StockUnitCustomField).label === "string" &&
          typeof (definition as StockUnitCustomField).fieldType === "string",
      ),
  );
}

function validateDraft(draft: WorkflowDraft, t: TFunction) {
  if (!draft.name.trim()) return t("workflows.validation.name");
  if (!draft.resourceIds.length) return t("workflows.validation.resource");
  if (!draft.codeTypes.length) return t("workflows.validation.codeType");
  if (!draft.identifierPropertyKey.trim()) return t("workflows.validation.identifier");
  const validPropertyKey = /^[A-Za-z0-9_.-]+$/;
  if (!validPropertyKey.test(draft.identifierPropertyKey.trim())) {
    return t("workflows.validation.propertyKey");
  }
  if (draft.extraction.mode === "url-query") {
    if (!draft.extraction.parameter.trim()) return t("workflows.validation.queryParameter");
    if (draft.extraction.sourceOrigin.trim()) {
      try {
        const sourceOrigin = draft.extraction.sourceOrigin.trim();
        const parsed = new URL(sourceOrigin);
        if (parsed.origin !== sourceOrigin) {
          return t("workflows.validation.sourceOriginOnly");
        }
      } catch {
        return t("workflows.validation.sourceOriginInvalid");
      }
    }
    if (
      draft.extraction.sourcePath.trim() &&
      (!draft.extraction.sourcePath.trim().startsWith("/") ||
        draft.extraction.sourcePath.includes("?") ||
        draft.extraction.sourcePath.includes("#"))
    ) {
      return t("workflows.validation.sourcePath");
    }
  }
  if (draft.extraction.mode === "prefix" && !draft.extraction.prefix) {
    return t("workflows.validation.prefix");
  }
  if (draft.extraction.mode === "regex") {
    const regexError = scanRegexValidationError(
      draft.extraction.pattern,
      draft.extraction.flags,
    );
    if (regexError || !draft.extraction.group.trim()) {
      return regexError ?? t("workflows.validation.regexGroup");
    }
  }

  const propertyKeys = new Set<string>();
  propertyKeys.add(draft.identifierPropertyKey.trim());
  for (const field of draft.extractedFields) {
    if (!field.key.trim() || !field.label.trim()) {
      return t("workflows.validation.input");
    }
    if (
      !validPropertyKey.test(field.key.trim()) ||
      propertyKeys.has(field.key.trim())
    ) {
      return t("workflows.validation.uniqueKeys");
    }
    propertyKeys.add(field.key.trim());
    if (field.extraction.mode === "regex") {
      const regexError = scanRegexValidationError(
        field.extraction.pattern,
        field.extraction.flags,
      );
      if (regexError || !field.extraction.group.trim()) {
        return regexError ?? t("workflows.validation.regexGroup");
      }
    }
  }
  for (const property of draft.fixedProperties) {
    if (!property.key.trim() || !property.label.trim() || !property.value.trim()) {
      return t("workflows.validation.fixedProperty");
    }
    if (!validPropertyKey.test(property.key.trim())) {
      return t("workflows.validation.propertyKey");
    }
    if (propertyKeys.has(property.key.trim())) {
      return t("workflows.validation.uniqueKeys");
    }
    propertyKeys.add(property.key.trim());
  }

  const inputKeys = new Set<string>();
  for (const field of draft.inputFields) {
    if (!field.key.trim() || !field.label.trim()) {
      return t("workflows.validation.input");
    }
    if (!validPropertyKey.test(field.key.trim())) {
      return t("workflows.validation.propertyKey");
    }
    if (inputKeys.has(field.key.trim()) || propertyKeys.has(field.key.trim())) {
      return t("workflows.validation.uniqueKeys");
    }
    inputKeys.add(field.key.trim());
    if (
      (field.type === "select" || field.type === "radio") &&
      field.options.length === 0
    ) return t("workflows.validation.optionRequired", {
      field: field.label || t("workflows.validation.eachInput"),
    });
    const optionValues = new Set<string>();
    for (const option of field.options) {
      if (!option.value.trim() || !option.label.trim()) {
        return t("workflows.validation.optionValues", {
          field: field.label || t("workflows.validation.anInput"),
        });
      }
      if (optionValues.has(option.value.trim())) {
        return t("workflows.validation.optionUnique", {
          field: field.label || t("workflows.validation.anInput"),
        });
      }
      optionValues.add(option.value.trim());
    }
  }
  if (draft.quantityInputKey) {
    const quantityField = draft.inputFields.find(
      (field) => field.key.trim() === draft.quantityInputKey,
    );
    if (
      draft.operation.type === "unit" ||
      !quantityField ||
      quantityField.type !== "number" ||
      !quantityField.required
    ) {
      return t("workflows.validation.quantityInput");
    }
  }
  if (draft.publicTriggerEnabled && draft.publicTriggerCode.trim()) {
    const publicCode = extractIdentifier(
      draft.publicTriggerCode,
      draft.extraction,
      t,
    );
    if (publicCode.error) return t("workflows.validation.publicTriggerCode");
  }
  if (!draft.webhookEventName.trim()) return t("workflows.validation.input");
  return null;
}

function extractIdentifier(
  scannedValue: string,
  extraction: WorkflowDraft["extraction"],
  t: TFunction,
): { value: string | null; error: string | null } {
  const raw = scannedValue.trim();
  if (!raw) return { value: null, error: t("workflows.extractionErrors.empty") };

  if (extraction.mode === "full") return { value: raw, error: null };
  if (extraction.mode === "prefix") {
    if (!raw.startsWith(extraction.prefix)) {
      return { value: null, error: t("workflows.extractionErrors.prefixMismatch", { prefix: extraction.prefix }) };
    }
    const value = raw.slice(extraction.prefix.length).trim();
    return value
      ? { value, error: null }
      : { value: null, error: t("workflows.extractionErrors.prefixEmpty") };
  }
  if (extraction.mode === "regex") {
    const extracted = extractScanRegexValue(raw, extraction);
    return extracted.error
      ? { value: null, error: extracted.error }
      : { value: extracted.value, error: null };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { value: null, error: t("workflows.extractionErrors.invalidUrl") };
  }

  if (extraction.sourceOrigin.trim()) {
    try {
      const expectedOrigin = new URL(extraction.sourceOrigin).origin;
      if (url.origin !== expectedOrigin) {
        return { value: null, error: t("workflows.extractionErrors.originMismatch", { origin: expectedOrigin }) };
      }
    } catch {
      return { value: null, error: t("workflows.extractionErrors.originInvalid") };
    }
  }
  if (extraction.sourcePath.trim() && url.pathname !== extraction.sourcePath.trim()) {
    return { value: null, error: t("workflows.extractionErrors.pathMismatch", { path: extraction.sourcePath.trim() }) };
  }
  const parameter = extraction.parameter.trim();
  const values = url.searchParams.getAll(parameter);
  if (values.length !== 1) {
    return {
      value: null,
      error: t("workflows.extractionErrors.queryCount", { parameter: parameter || "?" }),
    };
  }
  const value = values[0].trim();
  return value
    ? { value, error: null }
    : {
        value: null,
        error: t("workflows.extractionErrors.queryEmpty", { parameter: parameter || "?" }),
      };
}

function visiblePropertyValue(property: Pick<FixedProperty, "key" | "value">, t: TFunction) {
  if (property.key === "assemblyStatus" && property.value === "finished-assembled") {
    return t("values.fullyAssembled");
  }
  return property.value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function FlowStep({
  number,
  icon,
  title,
  description,
  children,
  last = false,
}: {
  number: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section className="relative grid grid-cols-[38px_minmax(0,1fr)] gap-3 sm:grid-cols-[46px_minmax(0,1fr)] sm:gap-4">
      {!last ? (
        <span
          aria-hidden="true"
          className="absolute bottom-[-18px] left-[18px] top-10 w-px bg-border sm:left-[22px] sm:top-12"
        />
      ) : null}
      <span className="relative z-10 grid size-[38px] place-items-center rounded-xl border border-brand-border bg-brand-soft text-brand shadow-sm sm:size-[46px]">
        {icon}
        <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-brand-solid text-[9px] font-bold text-on-brand ring-2 ring-background">
          {number}
        </span>
      </span>
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted">{description}</p>
        </div>
        {children}
      </Card>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-55",
        checked ? "bg-brand-solid" : "bg-border-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </button>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const Icon = notice.tone === "success" ? CheckCircle2 : notice.tone === "error" ? AlertCircle : CircleDot;
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(
        "mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-5",
        notice.tone === "success" && "border-success-border bg-success-soft text-success",
        notice.tone === "error" && "border-danger-border bg-danger-soft text-danger",
        notice.tone === "info" && "border-brand-border bg-brand-soft text-brand",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{notice.message}</span>
    </div>
  );
}

type StockWorkflowBuilderProps = {
  canManage: boolean;
  view?: "list" | "editor";
  workflowId?: string | null;
};

export function StockWorkflowBuilder({
  canManage,
  view = "list",
  workflowId = null,
}: StockWorkflowBuilderProps) {
  const { t, i18n } = useT("scanner");
  const router = useRouter();
  const organizationHref = useOrganizationHref();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const firstDraft = useMemo(() => templateDraft(t), [t]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [resources, setResources] = useState<StockItem[]>([]);
  const [stockUnitCustomFields, setStockUnitCustomFields] = useState<StockUnitCustomField[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft>(firstDraft);
  const [baseSignature, setBaseSignature] = useState(() => payloadSignature(firstDraft));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rotatingPublicUrl, setRotatingPublicUrl] = useState(false);
  const [copiedPublicUrl, setCopiedPublicUrl] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sampleScan, setSampleScan] = useState(
    "https://paperlesspaper.de/b?d=epd13-9c139ed7b44c&w=99",
  );
  const [sampleCodeType, setSampleCodeType] = useState<ScanCodeType | null>(
    "qr_code",
  );
  const [sampleSelection, setSampleSelection] = useState({ start: 0, end: 0 });
  const [showExampleScanner, setShowExampleScanner] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [previewInputs, setPreviewInputs] = useState<Record<string, string>>({});
  const [targetQuery, setTargetQuery] = useState("");

  const applyWorkflow = useCallback((workflow: WorkflowRecord) => {
    const nextDraft = workflowToDraft(workflow);
    setDraft(nextDraft);
    setBaseSignature(payloadSignature(nextDraft));
    setConfirmDelete(false);
  }, []);

  const loadData = useCallback(
    async () => {
      setLoading(true);
      setNotice(null);
      try {
        const [workflowPayload, stockPayload, customFieldPayload] = await Promise.all([
          fetchJson<unknown>("/api/v1/stock/scan-workflows", { cache: "no-store" }),
          fetchJson<unknown>("/api/v1/stock", { cache: "no-store" }),
          fetchJson<unknown>("/api/v1/custom-fields?entityType=stock_unit", {
            cache: "no-store",
          }).catch(() => ({ definitions: [] })),
        ]);
        const nextWorkflows = workflowsFromResponse(workflowPayload);
        const nextResources = stockItemsFromResponse(stockPayload);
        setWorkflows(nextWorkflows);
        setResources(nextResources);
        setStockUnitCustomFields(
          stockUnitCustomFieldsFromResponse(customFieldPayload),
        );

        if (view === "editor" && workflowId) {
          const nextSelection = nextWorkflows.find(
            (workflow) => workflow.id === workflowId,
          );
          if (nextSelection) {
            applyWorkflow(nextSelection);
          } else {
            const nextDraft = templateDraft(t, nextResources[0]?.resourceId ?? "");
            setDraft(nextDraft);
            setBaseSignature(payloadSignature(nextDraft));
            setNotice({ tone: "error", message: t("workflows.errors.notFound") });
          }
        } else if (view === "editor") {
          const nextDraft = templateDraft(t, nextResources[0]?.resourceId ?? "");
          setDraft(nextDraft);
          setBaseSignature(payloadSignature(nextDraft));
        }
      } catch {
        setNotice({
          tone: "error",
          message: t("workflows.errors.load"),
        });
      } finally {
        setLoading(false);
      }
    },
    [applyWorkflow, t, view, workflowId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPreviewInputs((current) => {
      const next: Record<string, string> = {};
      for (const field of draft.inputFields) {
        const stillValid = field.options.some((option) => option.value === current[field.uid]);
        next[field.uid] = stillValid ? current[field.uid]! : field.options[0]?.value ?? "";
      }
      return next;
    });
  }, [draft.inputFields]);

  const dirty = payloadSignature(draft) !== baseSignature;
  const interactionBusy = saving || deleting || rotatingPublicUrl;
  const editable = canManage && !interactionBusy;
  const savedWorkflow = draft.id
    ? workflows.find((workflow) => workflow.id === draft.id) ?? null
    : null;
  const selectedResources = draft.resourceIds.flatMap((resourceId) => {
    const resource = resources.find((item) => item.resourceId === resourceId);
    return resource ? [resource] : [];
  });
  const selectedResourcesHaveVariants = selectedResources.some((resource) =>
    resources.some(
      (candidate) => candidate.variantOfResourceId === resource.resourceId,
    ),
  );
  const targetItems = useMemo(() => {
    const normalizedQuery = targetQuery.trim().toLocaleLowerCase(locale);
    return resources
      .filter(
        (resource) =>
          !normalizedQuery ||
          resource.name.toLocaleLowerCase(locale).includes(normalizedQuery) ||
          resource.sku?.toLocaleLowerCase(locale).includes(normalizedQuery),
      )
      .map((resource) => ({
        id: resource.resourceId,
        name: resource.name,
        sku: resource.sku,
        type: resource.type,
        quantity: resource.quantity,
        trackingMode: resource.trackingMode,
        cover: resource.cover,
      }));
  }, [locale, resources, targetQuery]);
  const selectedIdentifierCustomField = stockUnitCustomFields.find(
    (field) => field.key === draft.identifierPropertyKey,
  );
  const extractionResult = useMemo(
    () => extractIdentifier(sampleScan, draft.extraction, t),
    [draft.extraction, sampleScan, t],
  );
  const selectedSampleValue = sampleScan.slice(
    sampleSelection.start,
    sampleSelection.end,
  );
  const publicTriggerPath = draft.publicTriggerId
    ? `/share/action/${draft.publicTriggerId}`
    : null;
  const publicTriggerLive = Boolean(
    savedWorkflow?.publicTriggerEnabled &&
      savedWorkflow.publicTriggerId === draft.publicTriggerId,
  );

  useEffect(() => {
    if (view !== "editor" || !dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, view]);

  const toggleCodeType = (codeType: ScanCodeType) => {
    setDraft((current) => ({
      ...current,
      codeTypes: current.codeTypes.includes(codeType)
        ? current.codeTypes.filter((candidate) => candidate !== codeType)
        : scanCodeTypes.filter(
            (candidate) =>
              candidate === codeType || current.codeTypes.includes(candidate),
          ),
    }));
  };

  const toggleTargetResource = (selectedItem: InventorySelectItem) => {
    const resource = resources.find(
      (candidate) => candidate.resourceId === selectedItem.id,
    );
    if (!resource) return;
    setDraft((current) => {
      const checked = current.resourceIds.includes(resource.resourceId);
      const resourceIds = checked
        ? current.resourceIds.filter(
            (resourceId) => resourceId !== resource.resourceId,
          )
        : [
            ...current.resourceIds.filter((resourceId) => {
              if (resource.variantOfResourceId === resourceId) return false;
              return !resources.some(
                (candidate) =>
                  candidate.resourceId === resourceId &&
                  candidate.variantOfResourceId === resource.resourceId,
              );
            }),
            resource.resourceId,
          ];
      return {
        ...current,
        resourceIds,
        resourceId: resourceIds[0] ?? "",
        targetSelectionMode:
          resourceIds.length < 2 ? "all" : current.targetSelectionMode,
      };
    });
  };

  const applySelectionRegex = (fieldUid?: string) => {
    const generated = scanRegexFromSelection(
      sampleScan,
      sampleSelection.start,
      sampleSelection.end,
    );
    if (!generated) {
      setAiError(t("workflows.regexStudio.selectValue"));
      return;
    }
    setDraft((current) =>
      fieldUid
        ? {
            ...current,
            extractedFields: current.extractedFields.map((field) =>
              field.uid === fieldUid
                ? {
                    ...field,
                    extraction: {
                      ...field.extraction,
                      mode: "regex",
                      ...generated,
                    },
                  }
                : field,
            ),
          }
        : {
            ...current,
            extraction: {
              ...current.extraction,
              mode: "regex",
              ...generated,
            },
          },
    );
    setAiError(null);
    setAiExplanation(t("workflows.regexStudio.selectionApplied"));
  };

  const generateRegexWithAi = async () => {
    const instruction = aiInstruction.trim();
    if (!selectedSampleValue && !instruction) {
      setAiError(t("workflows.regexStudio.selectOrDescribe"));
      return;
    }
    setAiGenerating(true);
    setAiError(null);
    setAiExplanation(null);
    try {
      const result = await fetchJson<{
        suggestion: {
          pattern: string;
          flags: string;
          group: string;
          explanation: string;
        };
      }>("/api/v1/stock/scan-workflows/extraction-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleCode: sampleScan,
          codeType: sampleCodeType,
          ...(selectedSampleValue ? { desiredValue: selectedSampleValue } : {}),
          ...(instruction ? { instruction } : {}),
        }),
      });
      setDraft((current) => ({
        ...current,
        extraction: {
          ...current.extraction,
          mode: "regex",
          pattern: result.suggestion.pattern,
          flags: result.suggestion.flags,
          group: result.suggestion.group,
        },
      }));
      setAiExplanation(result.suggestion.explanation);
    } catch (error) {
      setAiError(
        error instanceof Error
          ? error.message
          : t("workflows.regexStudio.aiError"),
      );
    } finally {
      setAiGenerating(false);
    }
  };

  const confirmDraftDiscard = () =>
    !dirty ||
    window.confirm(
      t("workflows.confirmDiscard"),
    );

  const persistDraft = async (
    nextDraft: WorkflowDraft,
    message: string,
  ): Promise<WorkflowRecord | null> => {
    const validationError = validateDraft(nextDraft, t);
    if (validationError) {
      setNotice({ tone: "error", message: validationError });
      return null;
    }
    if (!canManage) {
      setNotice({ tone: "error", message: t("workflows.notices.viewerReadOnly") });
      return null;
    }

    setSaving(true);
    setNotice(null);
    try {
      const payload = draftToPayload(nextDraft);
      const endpoint = nextDraft.id
        ? `/api/v1/stock/scan-workflows/${nextDraft.id}`
        : "/api/v1/stock/scan-workflows";
      const response = await fetchJson<unknown>(endpoint, {
        method: nextDraft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = workflowFromResponse(response);
      if (!saved) throw new Error(t("workflows.errors.unexpected"));
      setWorkflows((current) => {
        const exists = current.some((workflow) => workflow.id === saved.id);
        const next = exists
          ? current.map((workflow) => (workflow.id === saved.id ? saved : workflow))
          : [...current, saved];
        return next.sort((left, right) => left.name.localeCompare(right.name, locale));
      });
      const created = nextDraft.id === null;
      applyWorkflow(saved);
      setNotice({ tone: "success", message });
      if (created) {
        router.replace(
          organizationHref(`/settings/action-flows/${saved.id}`),
        );
      }
      return saved;
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("workflows.errors.save"),
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () =>
    void persistDraft(
      draft,
      t(draft.id ? "workflows.notices.updated" : "workflows.notices.created"),
    );

  const toggleSavedWorkflow = async () => {
    if (!savedWorkflow || !canManage || interactionBusy) return;
    const enabled = !savedWorkflow.enabled;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetchJson<unknown>(
        `/api/v1/stock/scan-workflows/${savedWorkflow.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: savedWorkflow.revision,
            enabled,
          }),
        },
      );
      const saved = workflowFromResponse(response);
      if (!saved) throw new Error(t("workflows.errors.unexpected"));
      setWorkflows((current) =>
        current.map((workflow) => (workflow.id === saved.id ? saved : workflow)),
      );
      setDraft((current) =>
        current.id === saved.id
          ? {
              ...current,
              revision: saved.revision,
              enabled: saved.enabled,
            }
          : current,
      );
      setBaseSignature(payloadSignature(workflowToDraft(saved)));
      setNotice({
        tone: "success",
        message: t(saved.enabled ? "workflows.notices.enabled" : "workflows.notices.paused"),
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("workflows.errors.update"),
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!savedWorkflow || !canManage || interactionBusy) return;
    setDeleting(true);
    setNotice(null);
    try {
      await fetchJson<unknown>(
        `/api/v1/stock/scan-workflows/${savedWorkflow.id}?revision=${encodeURIComponent(String(savedWorkflow.revision))}`,
        { method: "DELETE" },
      );
      const remaining = workflows.filter((workflow) => workflow.id !== savedWorkflow.id);
      setWorkflows(remaining);
      router.replace(organizationHref("/settings/action-flows"));
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("workflows.errors.delete"),
      });
    } finally {
      setDeleting(false);
    }
  };

  const copyPublicTriggerUrl = async () => {
    if (!publicTriggerPath) return;
    try {
      await navigator.clipboard.writeText(
        new URL(publicTriggerPath, window.location.origin).toString(),
      );
      setCopiedPublicUrl(true);
      window.setTimeout(() => setCopiedPublicUrl(false), 2_000);
    } catch {
      setNotice({ tone: "error", message: t("workflows.publicTrigger.copyError") });
    }
  };

  const rotatePublicTriggerUrl = async () => {
    if (!draft.id || !draft.revision || dirty || interactionBusy) return;
    if (!window.confirm(t("workflows.publicTrigger.rotateConfirm"))) return;
    setRotatingPublicUrl(true);
    setNotice(null);
    try {
      const response = await fetchJson<unknown>(
        `/api/v1/stock/scan-workflows/${draft.id}/public-trigger/rotate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: draft.revision }),
        },
      );
      const saved = workflowFromResponse(response);
      if (!saved) throw new Error(t("workflows.errors.unexpected"));
      setWorkflows((current) =>
        current.map((workflow) => (workflow.id === saved.id ? saved : workflow)),
      );
      applyWorkflow(saved);
      setNotice({ tone: "success", message: t("workflows.publicTrigger.rotated") });
    } catch (rotateError) {
      setNotice({
        tone: "error",
        message:
          rotateError instanceof Error
            ? rotateError.message
            : t("workflows.publicTrigger.rotateError"),
      });
    } finally {
      setRotatingPublicUrl(false);
    }
  };

  const updateFixedProperty = (
    uid: string,
    key: keyof Pick<DraftFixedProperty, "key" | "label" | "value" | "storage">,
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      fixedProperties: current.fixedProperties.map((property) =>
        property.uid === uid ? { ...property, [key]: value } : property,
      ),
    }));
  };

  const updateInput = (
    uid: string,
    patch: Partial<
      Pick<DraftInput, "key" | "label" | "required" | "type" | "storage" | "placeholder">
    >,
  ) => {
    setDraft((current) => {
      const previous = current.inputFields.find((field) => field.uid === uid);
      const nextQuantityKey =
        previous && current.quantityInputKey === previous.key
          ? patch.type && patch.type !== "number"
            ? null
            : patch.key ?? current.quantityInputKey
          : current.quantityInputKey;
      return {
        ...current,
        quantityInputKey: nextQuantityKey,
        inputFields: current.inputFields.map((field) =>
          field.uid === uid ? { ...field, ...patch } : field,
        ),
      };
    });
  };

  const updateOption = (
    fieldUid: string,
    optionUid: string,
    key: keyof Pick<DraftOption, "value" | "label" | "color">,
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      inputFields: current.inputFields.map((field) =>
        field.uid === fieldUid
          ? {
              ...field,
              options: field.options.map((option) =>
                option.uid === optionUid ? { ...option, [key]: value } : option,
              ),
            }
          : field,
      ),
    }));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-9 w-72 max-w-full" />
            <Skeleton className="mt-3 h-4 w-[520px] max-w-full" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton
          className={cn(
            "rounded-2xl",
            view === "list" ? "h-[480px]" : "h-[780px]",
          )}
        />
      </div>
    );
  }

  if (view === "list") {
    return (
      <div>
        <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.13em] text-muted">
              <Workflow className="size-3.5 text-brand" aria-hidden="true" />
              {t("workflows.header.eyebrow")}
            </div>
            <h1 className="text-[29px] font-semibold tracking-[-0.04em] text-foreground sm:text-[33px]">
              {t("workflows.header.title")}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
              {t("workflows.header.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!canManage ? (
              <Badge tone="neutral" className="h-9 gap-1.5 px-3">
                <Lock className="size-3.5" aria-hidden="true" />
                {t("workflows.header.readOnly")}
              </Badge>
            ) : (
              <Link
                href="/settings/action-flows/new"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-transparent bg-brand-solid px-4 text-sm font-semibold text-on-brand shadow-sm transition duration-150 hover:bg-brand-hover active:bg-brand-active"
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("workflows.header.newTemplate")}
              </Link>
            )}
          </div>
        </div>

        {notice ? <NoticeBanner notice={notice} /> : null}

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">
                {t("workflows.sidebar.title")}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">
                {t("workflows.sidebar.configured", {
                  count: workflows.length,
                  value: integer.format(workflows.length),
                })}
              </p>
            </div>
          </div>

          {workflows.length ? (
            <div className="divide-y divide-border">
              {workflows.map((workflow) => {
                const resource = resources.find(
                  (item) => item.resourceId === workflow.resourceId,
                );
                return (
                  <Link
                    key={workflow.id}
                    href={`/settings/action-flows/${workflow.id}`}
                    className="group flex items-center gap-3 px-4 py-4 transition hover:bg-surface-hover sm:gap-4 sm:px-5"
                  >
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-xl",
                        workflow.enabled
                          ? "bg-success-soft text-success"
                          : "bg-surface-muted text-muted",
                      )}
                    >
                      <QrCode className="size-[18px]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-foreground sm:text-sm">
                          {workflow.name}
                        </span>
                        <Badge tone={workflow.enabled ? "success" : "neutral"}>
                          {t(
                            workflow.enabled
                              ? "workflows.editor.enabled"
                              : "workflows.editor.paused",
                          )}
                        </Badge>
                      </span>
                      {workflow.description ? (
                        <span className="mt-1 block truncate text-[12px] text-muted">
                          {workflow.description}
                        </span>
                      ) : null}
                      <span className="mt-1 block truncate text-[11px] text-muted">
                        {t("workflows.sidebar.resourceRevision", {
                          resource:
                            resource?.name ??
                            t("workflows.fallbacks.resourceUnavailable"),
                          revision: integer.format(workflow.revision),
                        })}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-muted-strong transition group-hover:text-brand">
                      <span className="hidden sm:inline">
                        {t("workflows.sidebar.edit")}
                      </span>
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              className="min-h-72 py-10"
              icon={<Workflow className="size-5" aria-hidden="true" />}
              title={t("workflows.sidebar.emptyTitle")}
              description={
                canManage
                  ? t("workflows.sidebar.emptyManager")
                  : t("workflows.sidebar.emptyViewer")
              }
              action={
                canManage ? (
                  <Link
                    href="/settings/action-flows/new"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-brand-solid px-3 text-[14px] font-medium text-on-brand shadow-sm transition hover:bg-brand-hover"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t("workflows.header.newTemplate")}
                  </Link>
                ) : undefined
              }
            />
          )}

          <div className="border-t border-border bg-surface-subtle px-4 py-3 text-[11px] leading-4 text-muted sm:px-5">
            <span className="inline-flex items-center gap-1.5 font-medium text-muted">
              <ShieldCheck className="size-3.5 text-brand" aria-hidden="true" />
              {t("workflows.sidebar.safeTitle")}
            </span>
            <p className="mt-1">{t("workflows.sidebar.safeDescription")}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/settings/action-flows"
        onClick={(event) => {
          if (!confirmDraftDiscard()) event.preventDefault();
        }}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-strong transition hover:text-brand"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t("workflows.editor.backToList")}
      </Link>

      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.13em] text-muted">
            <Workflow className="size-3.5 text-brand" aria-hidden="true" />
            {t("workflows.header.eyebrow")}
          </div>
          <h1 className="text-[29px] font-semibold tracking-[-0.04em] text-foreground sm:text-[33px]">
            {t("workflows.header.title")}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            {t("workflows.header.description")}
          </p>
        </div>
        {!canManage ? (
          <Badge tone="neutral" className="h-9 gap-1.5 px-3">
            <Lock className="size-3.5" aria-hidden="true" />
            {t("workflows.header.readOnly")}
          </Badge>
        ) : null}
      </div>

      {notice ? <NoticeBanner notice={notice} /> : null}

      {workflowId && !draft.id ? (
        <Card>
          <EmptyState
            className="min-h-72 py-10"
            icon={<AlertCircle className="size-5" aria-hidden="true" />}
            title={t("workflows.errors.notFoundTitle")}
            description={t("workflows.errors.notFound")}
            action={
              <Link
                href="/settings/action-flows"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[14px] font-medium text-foreground shadow-sm transition hover:bg-surface-subtle"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                {t("workflows.editor.backToList")}
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="min-w-0">
          <Card className="mb-4 overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[16px] font-semibold text-foreground">
                    {draft.id
                      ? draft.name || t("workflows.fallbacks.untitled")
                      : t("workflows.editor.newWorkflow")}
                  </h2>
                  <Badge tone={draft.enabled ? "success" : "neutral"}>
                    {t(draft.enabled ? "workflows.editor.enabled" : "workflows.editor.paused")}
                  </Badge>
                  {dirty ? <Badge tone="warning">{t("workflows.editor.unsaved")}</Badge> : null}
                  {!draft.id ? <Badge tone="brand">{t("workflows.editor.template")}</Badge> : null}
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  {draft.id
                    ? t("workflows.editor.revision", {
                        value: integer.format(draft.revision ?? 1),
                      })
                    : t("workflows.editor.basedOnTemplate")}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  {draft.id ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void toggleSavedWorkflow()}
                      disabled={interactionBusy || !savedWorkflow}
                    >
                      {t(savedWorkflow?.enabled ? "workflows.editor.pause" : "workflows.editor.enable")}
                    </Button>
                  ) : null}
                  {draft.id ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmDelete(true)}
                      disabled={interactionBusy || !savedWorkflow}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      {t("workflows.editor.delete")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={saveDraft}
                    disabled={interactionBusy || (Boolean(draft.id) && !dirty)}
                  >
                    {saving ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="size-3.5" aria-hidden="true" />
                    )}
                    {t(
                      saving
                        ? "workflows.editor.saving"
                        : draft.id
                          ? "workflows.editor.update"
                          : "workflows.editor.save",
                    )}
                  </Button>
                </div>
              ) : null}
            </div>

            {confirmDelete && savedWorkflow ? (
              <div className="flex flex-col gap-3 border-b border-danger-border bg-danger-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                  <p className="text-[13px] leading-5 text-danger">
                    {t("workflows.editor.confirmDelete", { name: savedWorkflow.name })}
                  </p>
                </div>
                <div className="flex gap-2 self-end sm:self-auto">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={interactionBusy}>
                    {t("workflows.editor.cancel")}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void deleteWorkflow()} disabled={interactionBusy}>
                    {deleting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                    {t(deleting ? "workflows.editor.deleting" : "workflows.editor.deleteWorkflow")}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <label className={labelClass}>
                {t("workflows.editor.name")}
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className={inputClass}
                  placeholder={t("workflows.editor.namePlaceholder")}
                  disabled={!editable}
                />
              </label>
              <div className="rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[12px] font-semibold text-muted-strong">{t("workflows.editor.enabledLabel")}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted">{t("workflows.editor.enabledDescription")}</p>
                  </div>
                  <Toggle
                    checked={draft.enabled}
                    onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
                    disabled={!editable || Boolean(draft.id)}
                    label={t("workflows.editor.enabledLabel")}
                  />
                </div>
              </div>
              <label className={cn(labelClass, "sm:col-span-2")}>
                {t("workflows.editor.description")}
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className={textAreaClass}
                  placeholder={t("workflows.editor.descriptionPlaceholder")}
                  disabled={!editable}
                />
              </label>
            </div>
          </Card>

          {!canManage ? (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-[13px] leading-5 text-muted shadow-[var(--shadow-sm)]">
              <Eye className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              {t("workflows.editor.viewerDescription")}
            </div>
          ) : null}

          <div className="space-y-[18px] rounded-2xl border border-border bg-surface-subtle p-3 sm:p-5">
            <FlowStep
              number={integer.format(1)}
              icon={<QrCode className="size-[18px] sm:size-5" aria-hidden="true" />}
              title={t("workflows.steps.trigger.title")}
              description={t("workflows.steps.trigger.description")}
            >
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-subtle p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-surface text-brand shadow-sm ring-1 ring-border">
                    <ScanLine className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{t("workflows.steps.trigger.event")}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{t("workflows.steps.trigger.eventDescription")}</p>
                  </div>
                </div>
                <Badge tone="brand">{t("workflows.steps.trigger.badge")}</Badge>
              </div>
              <div className="mt-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-muted-strong">
                      {t("workflows.steps.trigger.codeTypes")}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      {t("workflows.steps.trigger.codeTypesDescription")}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!editable}
                    onClick={() => setShowExampleScanner((current) => !current)}
                  >
                    <ScanLine className="size-3.5" aria-hidden="true" />
                    {t(
                      showExampleScanner
                        ? "workflows.steps.trigger.closeExampleScanner"
                        : "workflows.steps.trigger.scanExample",
                    )}
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {scanCodeTypes.map((codeType) => {
                    const selected = draft.codeTypes.includes(codeType);
                    return (
                      <button
                        key={codeType}
                        type="button"
                        aria-pressed={selected}
                        disabled={!editable}
                        onClick={() => toggleCodeType(codeType)}
                        className={cn(
                          "flex min-h-10 items-center gap-2 rounded-xl border px-3 text-left text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
                          selected
                            ? "border-brand-border bg-brand-soft text-brand-strong"
                            : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-4 shrink-0 place-items-center rounded border",
                            selected
                              ? "border-brand-solid bg-brand-solid text-on-brand"
                              : "border-border-strong",
                          )}
                        >
                          {selected ? <Check className="size-3" aria-hidden="true" /> : null}
                        </span>
                        {scanCodeTypeLabels[codeType]}
                      </button>
                    );
                  })}
                </div>
                {!draft.codeTypes.length ? (
                  <p className="mt-2 text-[12px] text-danger">
                    {t("workflows.validation.codeType")}
                  </p>
                ) : null}
              </div>
              {showExampleScanner ? (
                <div className="mt-4 rounded-2xl border border-brand-border bg-surface p-3 sm:p-4">
                  <CodeScannerCamera
                    disabled={!editable}
                    onDetected={(code, _source, codeType) => {
                      setSampleScan(code);
                      setSampleCodeType(codeType);
                      setSampleSelection({ start: 0, end: 0 });
                      if (codeType) {
                        setDraft((current) => ({
                          ...current,
                          codeTypes: current.codeTypes.includes(codeType)
                            ? current.codeTypes
                            : scanCodeTypes.filter(
                                (candidate) =>
                                  candidate === codeType ||
                                  current.codeTypes.includes(candidate),
                              ),
                        }));
                      }
                      setShowExampleScanner(false);
                    }}
                  />
                </div>
              ) : null}

              <div className="mt-4 rounded-2xl border border-border bg-surface p-3.5 sm:p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                    <Link2 className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground">
                      {t("workflows.publicTrigger.title")}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      {t("workflows.publicTrigger.description")}
                    </p>
                  </div>
                  <Toggle
                    checked={draft.publicTriggerEnabled}
                    onChange={(publicTriggerEnabled) =>
                      setDraft((current) => ({ ...current, publicTriggerEnabled }))
                    }
                    disabled={!editable}
                    label={t("workflows.publicTrigger.toggle")}
                  />
                </div>

                {draft.publicTriggerEnabled ? (
                  <div className="mt-4 space-y-3 border-t border-border pt-4">
                    <label className={labelClass}>
                      {t("workflows.publicTrigger.fixedCode")}
                      <textarea
                        value={draft.publicTriggerCode}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            publicTriggerCode: event.target.value,
                          }))
                        }
                        className={cn(textAreaClass, "min-h-20 font-mono text-[13px]")}
                        placeholder={t("workflows.publicTrigger.fixedCodePlaceholder")}
                        disabled={!editable}
                      />
                      <span className="mt-1 block text-[11px] leading-4 text-muted">
                        {t("workflows.publicTrigger.fixedCodeDescription")}
                      </span>
                    </label>

                    {publicTriggerPath && publicTriggerLive ? (
                      <div className="rounded-xl border border-success-border bg-success-soft p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-success">
                          {t("workflows.publicTrigger.live")}
                        </p>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <input
                            value={publicTriggerPath}
                            readOnly
                            aria-label={t("workflows.publicTrigger.url")}
                            className={cn(inputClass, "mt-0 min-w-0 flex-1 font-mono text-[12px]")}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => void copyPublicTriggerUrl()}
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                            {t(
                              copiedPublicUrl
                                ? "workflows.publicTrigger.copied"
                                : "workflows.publicTrigger.copy",
                            )}
                          </Button>
                          <a
                            href={publicTriggerPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12px] font-semibold text-muted-strong transition hover:border-border-strong hover:text-foreground"
                          >
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                            {t("workflows.publicTrigger.open")}
                          </a>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] leading-4 text-success">
                            {t("workflows.publicTrigger.security")}
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => void rotatePublicTriggerUrl()}
                            disabled={!editable || dirty}
                          >
                            {rotatingPublicUrl ? (
                              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <RefreshCcw className="size-3.5" aria-hidden="true" />
                            )}
                            {t("workflows.publicTrigger.rotate")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-[12px] leading-5 text-muted">
                        {t("workflows.publicTrigger.saveToActivate")}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </FlowStep>

            <FlowStep
              number={integer.format(2)}
              icon={<FileKey2 className="size-[18px] sm:size-5" aria-hidden="true" />}
              title={t("workflows.steps.extract.title")}
              description={t("workflows.steps.extract.description")}
            >
              <div className="mb-4 rounded-2xl border border-brand-border bg-[linear-gradient(135deg,var(--color-brand-soft),var(--color-surface))] p-3.5 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                      <Sparkles className="size-4 text-brand" aria-hidden="true" />
                      {t("workflows.regexStudio.title")}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      {t("workflows.regexStudio.description")}
                    </p>
                  </div>
                  {sampleCodeType ? (
                    <Badge tone="brand">{scanCodeTypeLabels[sampleCodeType]}</Badge>
                  ) : (
                    <Badge tone="neutral">{t("workflows.regexStudio.manual")}</Badge>
                  )}
                </div>
                <label className={cn(labelClass, "mt-3 block")}>
                  {t("workflows.regexStudio.sample")}
                  <textarea
                    value={sampleScan}
                    onChange={(event) => {
                      setSampleScan(event.target.value);
                      setSampleSelection({ start: 0, end: 0 });
                    }}
                    onSelect={(event) =>
                      setSampleSelection({
                        start: event.currentTarget.selectionStart,
                        end: event.currentTarget.selectionEnd,
                      })
                    }
                    className={cn(textAreaClass, "min-h-24 font-mono text-[13px]")}
                    disabled={interactionBusy}
                  />
                </label>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    value={aiInstruction}
                    onChange={(event) => setAiInstruction(event.target.value)}
                    className={cn(inputClass, "mt-0")}
                    placeholder={t("workflows.regexStudio.instructionPlaceholder")}
                    disabled={!editable || aiGenerating}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!editable || !selectedSampleValue || aiGenerating}
                    onClick={() => applySelectionRegex()}
                  >
                    {t("workflows.regexStudio.useSelection")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      !editable ||
                      aiGenerating ||
                      (!selectedSampleValue && !aiInstruction.trim())
                    }
                    onClick={() => void generateRegexWithAi()}
                  >
                    {aiGenerating ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="size-3.5" aria-hidden="true" />
                    )}
                    {t("workflows.regexStudio.generate")}
                  </Button>
                </div>
                {selectedSampleValue ? (
                  <p className="mt-2 break-all text-[11px] text-muted">
                    {t("workflows.regexStudio.selected")}: {" "}
                    <code className="rounded bg-surface px-1.5 py-0.5 text-foreground">
                      {selectedSampleValue}
                    </code>
                  </p>
                ) : null}
                {aiExplanation ? (
                  <p className="mt-2 text-[12px] leading-5 text-success">
                    {aiExplanation}
                  </p>
                ) : null}
                {aiError ? (
                  <p role="alert" className="mt-2 text-[12px] leading-5 text-danger">
                    {aiError}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1 sm:grid-cols-4">
                {(["full", "url-query", "prefix", "regex"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        extraction: { ...current.extraction, mode },
                      }))
                    }
                    disabled={!editable}
                    aria-pressed={draft.extraction.mode === mode}
                    className={cn(
                      "h-9 rounded-lg px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed",
                      draft.extraction.mode === mode
                        ? "bg-surface text-brand-strong shadow-sm"
                        : "text-muted hover:text-foreground disabled:opacity-65",
                    )}
                  >
                    {t(`workflows.steps.extract.modes.${mode}`)}
                  </button>
                ))}
              </div>

              {draft.extraction.mode === "url-query" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>
                    {t("workflows.steps.extract.queryParameter")}
                    <input
                      value={draft.extraction.parameter}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, parameter: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder={t("workflows.steps.extract.queryParameterPlaceholder")}
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("workflows.steps.extract.sourceOrigin")}
                    <input
                      value={draft.extraction.sourceOrigin}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, sourceOrigin: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder={t("workflows.steps.extract.sourceOriginPlaceholder")}
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("workflows.steps.extract.sourcePath")}
                    <input
                      value={draft.extraction.sourcePath}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, sourcePath: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder={t("workflows.steps.extract.sourcePathPlaceholder")}
                      disabled={!editable}
                    />
                  </label>
                </div>
              ) : draft.extraction.mode === "prefix" ? (
                <div className="mt-4 max-w-md">
                  <label className={labelClass}>
                    {t("workflows.steps.extract.prefix")}
                    <input
                      value={draft.extraction.prefix}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, prefix: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder={t("workflows.steps.extract.prefixPlaceholder")}
                      disabled={!editable}
                    />
                  </label>
                </div>
              ) : draft.extraction.mode === "regex" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_140px]">
                  <label className={labelClass}>
                    {t("workflows.steps.extract.regexPattern")}
                    <input
                      value={draft.extraction.pattern}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: {
                            ...current.extraction,
                            pattern: event.target.value,
                          },
                        }))
                      }
                      className={cn(inputClass, "font-mono")}
                      placeholder="^(?<value>.+)$"
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("workflows.steps.extract.regexFlags")}
                    <input
                      value={draft.extraction.flags}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: {
                            ...current.extraction,
                            flags: event.target.value,
                          },
                        }))
                      }
                      className={cn(inputClass, "font-mono")}
                      placeholder="iu"
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("workflows.steps.extract.regexGroup")}
                    <input
                      value={draft.extraction.group}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: {
                            ...current.extraction,
                            group: event.target.value,
                          },
                        }))
                      }
                      className={cn(inputClass, "font-mono")}
                      placeholder="value"
                      disabled={!editable}
                    />
                  </label>
                </div>
              ) : null}
              <div className="mt-5 rounded-2xl border border-border bg-surface-subtle p-3.5 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">
                      {t("workflows.storage.identifierTitle")}
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      {t("workflows.storage.identifierDescription")}
                    </p>
                  </div>
                  <Badge tone="neutral">{t("workflows.storage.stockUnitBadge")}</Badge>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>
                    {t("workflows.storage.destination")}
                    <select
                      value={draft.identifierStorage}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          identifierStorage: event.target.value as StorageTarget,
                        }))
                      }
                      className={inputClass}
                      disabled={!editable}
                    >
                      <option value="custom-field">
                        {t("workflows.storage.targets.customField")}
                      </option>
                      <option value="metadata">
                        {t("workflows.storage.targets.metadata")}
                      </option>
                      <option value="execution">
                        {t("workflows.storage.targets.execution")}
                      </option>
                    </select>
                  </label>
                  {draft.identifierStorage === "custom-field" ? (
                    <StockUnitCustomFieldSelect
                      fields={stockUnitCustomFields}
                      value={draft.identifierPropertyKey}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          identifierPropertyKey: value,
                        }))
                      }
                      disabled={!editable}
                      t={t}
                    />
                  ) : (
                    <label className={labelClass}>
                      {draft.identifierStorage === "metadata"
                        ? t("workflows.storage.metadataKey")
                        : t("workflows.storage.executionKey")}
                      <input
                        value={draft.identifierPropertyKey}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            identifierPropertyKey: event.target.value,
                          }))
                        }
                        className={inputClass}
                        placeholder={t("workflows.steps.extract.identifierKeyPlaceholder")}
                        disabled={!editable}
                      />
                    </label>
                  )}
                </div>
                {draft.identifierStorage === "custom-field" ? (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand-border bg-brand-soft px-3 py-2.5 text-[12px] leading-5 text-brand-strong">
                    {selectedIdentifierCustomField ? (
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <p>
                      {selectedIdentifierCustomField
                        ? t("workflows.storage.selectedCustomField", {
                            label: selectedIdentifierCustomField.label,
                            key: draft.identifierPropertyKey,
                          })
                        : t("workflows.storage.selectConfiguredField")}{" "}
                      <Link
                        href="/settings/custom-fields"
                        className="font-semibold underline underline-offset-2"
                      >
                        {t("workflows.storage.manageCustomFields")}
                      </Link>
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] leading-4 text-muted">
                    {draft.identifierStorage === "metadata"
                      ? t("workflows.storage.metadataHint")
                      : t("workflows.storage.executionHint")}
                  </p>
                )}
                <p className="mt-2 text-[11px] leading-4 text-muted">
                  {t("workflows.storage.inventoryItemScope")}
                </p>
              </div>

              <div className="mt-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-muted-strong">
                      {t("workflows.storage.additionalFieldsTitle")}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted">
                      {t("workflows.storage.additionalFieldsDescription")}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!editable}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        extractedFields: [
                          ...current.extractedFields,
                          {
                            uid: localId("extracted"),
                            key: `codeField${current.extractedFields.length + 1}`,
                            label: `QR-Feld ${current.extractedFields.length + 1}`,
                            storage: "custom-field",
                            extraction: {
                              ...current.extraction,
                              mode: "url-query",
                              parameter: `field${current.extractedFields.length + 1}`,
                            },
                          },
                        ],
                      }))
                    }
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t("workflows.storage.addField")}
                  </Button>
                </div>
              {draft.extractedFields.length ? (
                <div className="mt-3 space-y-2">
                  {draft.extractedFields.map((field) => (
                    <div key={field.uid} className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-3 sm:grid-cols-2 lg:grid-cols-5">
                      {field.storage === "custom-field" ? (
                        <StockUnitCustomFieldSelect
                          fields={stockUnitCustomFields}
                          value={field.key}
                          onChange={(value) =>
                            setDraft((current) => ({
                              ...current,
                              extractedFields: current.extractedFields.map((item) =>
                                item.uid === field.uid ? { ...item, key: value } : item,
                              ),
                            }))
                          }
                          disabled={!editable}
                          t={t}
                        />
                      ) : (
                        <label className={labelClass}>
                          {t("workflows.storage.propertyKey")}
                          <input
                            value={field.key}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                extractedFields: current.extractedFields.map((item) =>
                                  item.uid === field.uid
                                    ? { ...item, key: event.target.value }
                                    : item,
                                ),
                              }))
                            }
                            className={inputClass}
                            disabled={!editable}
                          />
                        </label>
                      )}
                      <label className={labelClass}>
                        Bezeichnung
                        <input
                          value={field.label}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              extractedFields: current.extractedFields.map((item) =>
                                item.uid === field.uid ? { ...item, label: event.target.value } : item,
                              ),
                            }))
                          }
                          className={inputClass}
                          disabled={!editable}
                        />
                      </label>
                      <label className={labelClass}>
                        Extraktion
                        <select
                          value={field.extraction.mode}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              extractedFields: current.extractedFields.map((item) =>
                                item.uid === field.uid
                                  ? {
                                      ...item,
                                      extraction: {
                                        ...item.extraction,
                                        mode: event.target.value as ExtractionMode,
                                      },
                                    }
                                  : item,
                              ),
                            }))
                          }
                          className={inputClass}
                          disabled={!editable}
                        >
                          <option value="url-query">URL-Parameter</option>
                          <option value="regex">Regulärer Ausdruck</option>
                          <option value="prefix">Präfix entfernen</option>
                          <option value="full">Vollständiger Wert</option>
                        </select>
                      </label>
                      <label className={labelClass}>
                        {field.extraction.mode === "prefix"
                          ? "Präfix"
                          : field.extraction.mode === "regex"
                            ? "Regex"
                            : "Parameter"}
                        <input
                          value={
                            field.extraction.mode === "prefix"
                              ? field.extraction.prefix
                              : field.extraction.mode === "regex"
                                ? field.extraction.pattern
                                : field.extraction.parameter
                          }
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              extractedFields: current.extractedFields.map((item) =>
                                item.uid === field.uid
                                  ? {
                                      ...item,
                                      extraction: {
                                        ...item.extraction,
                                        [item.extraction.mode === "prefix"
                                          ? "prefix"
                                          : item.extraction.mode === "regex"
                                            ? "pattern"
                                            : "parameter"]: event.target.value,
                                      },
                                    }
                                  : item,
                              ),
                            }))
                          }
                          className={inputClass}
                          disabled={!editable || field.extraction.mode === "full"}
                        />
                      </label>
                      <div className="flex items-end gap-2">
                        <label className={cn(labelClass, "min-w-0 flex-1")}>
                          {t("workflows.storage.destination")}
                          <select
                            value={field.storage}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                extractedFields: current.extractedFields.map((item) =>
                                  item.uid === field.uid
                                    ? { ...item, storage: event.target.value as StorageTarget }
                                    : item,
                                ),
                              }))
                            }
                            className={inputClass}
                            disabled={!editable}
                          >
                            <option value="custom-field">
                              {t("workflows.storage.targets.customFieldShort")}
                            </option>
                            <option value="metadata">
                              {t("workflows.storage.targets.metadataShort")}
                            </option>
                            <option value="execution">
                              {t("workflows.storage.targets.executionShort")}
                            </option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-lg text-danger hover:bg-danger-soft"
                          disabled={!editable}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              extractedFields: current.extractedFields.filter((item) => item.uid !== field.uid),
                            }))
                          }
                          aria-label="QR-Feld entfernen"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      {field.extraction.mode === "regex" ? (
                        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[100px_140px_auto] lg:col-span-5">
                          <label className={labelClass}>
                            Flags
                            <input
                              value={field.extraction.flags}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  extractedFields: current.extractedFields.map((item) =>
                                    item.uid === field.uid
                                      ? {
                                          ...item,
                                          extraction: {
                                            ...item.extraction,
                                            flags: event.target.value,
                                          },
                                        }
                                      : item,
                                  ),
                                }))
                              }
                              className={cn(inputClass, "font-mono")}
                              disabled={!editable}
                            />
                          </label>
                          <label className={labelClass}>
                            Capture Group
                            <input
                              value={field.extraction.group}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  extractedFields: current.extractedFields.map((item) =>
                                    item.uid === field.uid
                                      ? {
                                          ...item,
                                          extraction: {
                                            ...item.extraction,
                                            group: event.target.value,
                                          },
                                        }
                                      : item,
                                  ),
                                }))
                              }
                              className={cn(inputClass, "font-mono")}
                              disabled={!editable}
                            />
                          </label>
                          <div className="flex items-end">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={!editable || !selectedSampleValue}
                              onClick={() => applySelectionRegex(field.uid)}
                            >
                              {t("workflows.regexStudio.useSelectionForField")}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              </div>
            </FlowStep>

            <FlowStep
              number={integer.format(3)}
              icon={<PackageCheck className="size-[18px] sm:size-5" aria-hidden="true" />}
              title={t("workflows.steps.target.title")}
              description={t("workflows.steps.target.description")}
            >
              {resources.length ? (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] leading-5 text-muted">
                      {t("workflows.steps.target.searchDescription")}
                    </p>
                    <Badge tone="neutral">
                      {t("workflows.steps.target.selectedCount", {
                        count: draft.resourceIds.length,
                      })}
                    </Badge>
                  </div>
                  <InventorySelect
                    className="mt-2"
                    items={targetItems}
                    selectedIds={draft.resourceIds}
                    onSelect={toggleTargetResource}
                    query={targetQuery}
                    onQueryChange={setTargetQuery}
                    label={t("workflows.steps.target.field")}
                    placeholder={t("workflows.steps.target.searchPlaceholder")}
                    emptyText={t("workflows.steps.target.noMatches")}
                    searchingText={t("workflows.steps.target.searching")}
                    selectedText={t("workflows.steps.target.selectedShort")}
                    disabled={!editable}
                    itemMeta={(item) => {
                      const resource = resources.find(
                        (candidate) => candidate.resourceId === item.id,
                      );
                      if (!resource) return item.sku || item.type || "—";
                      const parent = resource.variantOfResourceId
                        ? resources.find(
                            (candidate) =>
                              candidate.resourceId === resource.variantOfResourceId,
                          )
                        : null;
                      if (parent) {
                        return t("workflows.steps.target.variantOf", {
                          name: parent.name,
                        });
                      }
                      const quantity = t(
                        "workflows.steps.target.resourceQuantity",
                        {
                          name: "",
                          quantity: integer.format(resource.quantity ?? 0),
                          unit:
                            resource.unitName ??
                            t("workflows.steps.target.units", {
                              count: resource.quantity ?? 0,
                            }),
                        },
                      ).replace(/^\s*·\s*/, "");
                      return resource.sku ? `${resource.sku} · ${quantity}` : quantity;
                    }}
                  />

                  {draft.resourceIds.length > 1 ? (
                    <fieldset className="mt-4 rounded-xl border border-border bg-surface-subtle p-3.5">
                      <legend className="px-1 text-[12px] font-semibold text-muted-strong">
                        {t("workflows.steps.target.executionMode")}
                      </legend>
                      <div className="mt-1 grid gap-2 sm:grid-cols-3">
                        {(["all", "radio", "checkbox"] as const).map((mode) => (
                          <label
                            key={mode}
                            className={cn(
                              "flex cursor-pointer items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-[12px]",
                              draft.targetSelectionMode === mode
                                ? "border-brand-border text-brand-strong"
                                : "border-border text-muted-strong",
                            )}
                          >
                            <input
                              type="radio"
                              name="target-selection-mode"
                              value={mode}
                              checked={draft.targetSelectionMode === mode}
                              disabled={!editable}
                              onChange={() =>
                                setDraft((current) => ({
                                  ...current,
                                  targetSelectionMode: mode,
                                }))
                              }
                              className="mt-0.5 accent-brand-solid"
                            />
                            <span>
                              <strong className="block font-semibold">
                                {t(`workflows.steps.target.modes.${mode}.label`)}
                              </strong>
                              <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                                {t(`workflows.steps.target.modes.${mode}.description`)}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}

                  {selectedResourcesHaveVariants ? (
                    <label className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-surface-subtle p-3.5">
                      <input
                        type="checkbox"
                        checked={draft.allowVariantSelection}
                        disabled={!editable}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            allowVariantSelection: event.target.checked,
                          }))
                        }
                        className="mt-0.5 size-4 accent-brand-solid"
                      />
                      <span>
                        <strong className="block text-[12px] font-semibold text-muted-strong">
                          {t("workflows.steps.target.allowVariants")}
                        </strong>
                        <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                          {t("workflows.steps.target.allowVariantsDescription")}
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-warning-border bg-warning-soft p-3.5 text-[13px] leading-5 text-warning sm:flex-row sm:items-center sm:justify-between">
                  <span>{t("workflows.steps.target.none")}</span>
                  <Link href="/inventory" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                    {t("workflows.steps.target.configure")} <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              )}
              {selectedResources.length ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-success-border bg-success-soft p-3">
                  <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
                  <p className="text-[12px] text-success">
                    {t("workflows.steps.target.selected", {
                      name: selectedResources.map((resource) => resource.name).join(", "),
                    })}
                  </p>
                </div>
              ) : null}
            </FlowStep>

            <FlowStep
              number={integer.format(4)}
              icon={<Layers3 className="size-[18px] sm:size-5" aria-hidden="true" />}
              title={t("workflows.steps.inputs.title")}
              description={t("workflows.steps.inputs.description")}
            >
              <div className="space-y-3">
                {draft.inputFields.map((field, fieldIndex) => (
                  <div key={field.uid} className="rounded-xl border border-border bg-surface-subtle p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-md bg-brand-soft text-[11px] font-bold text-brand">
                          {integer.format(fieldIndex + 1)}
                        </span>
                        <p className="text-[13px] font-semibold text-muted-strong">{t("workflows.steps.inputs.selectField")}</p>
                      </div>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              quantityInputKey:
                                current.quantityInputKey === field.key
                                  ? null
                                  : current.quantityInputKey,
                              inputFields: current.inputFields.filter((item) => item.uid !== field.uid),
                            }))
                          }
                          disabled={!editable}
                          className="grid size-7 place-items-center rounded-lg text-danger transition hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={t("workflows.steps.inputs.removeField", {
                            field: field.label || t("workflows.steps.inputs.scanInput"),
                          })}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {field.storage === "custom-field" ? (
                        <StockUnitCustomFieldSelect
                          fields={stockUnitCustomFields}
                          value={field.key}
                          onChange={(value) => updateInput(field.uid, { key: value })}
                          disabled={!editable}
                          t={t}
                        />
                      ) : (
                        <label className={labelClass}>
                          {t("workflows.storage.propertyKey")}
                          <input
                            value={field.key}
                            onChange={(event) =>
                              updateInput(field.uid, { key: event.target.value })
                            }
                            className={inputClass}
                            placeholder={t("workflows.steps.inputs.propertyKeyPlaceholder")}
                            disabled={!editable}
                          />
                        </label>
                      )}
                      <label className={labelClass}>
                        {t("workflows.steps.inputs.visibleLabel")}
                        <input
                          value={field.label}
                          onChange={(event) => updateInput(field.uid, { label: event.target.value })}
                          className={inputClass}
                          placeholder={t("workflows.steps.inputs.visibleLabel")}
                          disabled={!editable}
                        />
                      </label>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <label className={labelClass}>
                        Eingabetyp
                        <select
                          value={field.type}
                          onChange={(event) => {
                            const type = event.target.value as InputType;
                            updateInput(field.uid, {
                              type,
                              ...(type === "media" || type === "file"
                                ? { storage: "execution" }
                                : {}),
                            });
                          }}
                          className={inputClass}
                          disabled={!editable}
                        >
                          <option value="text">Text</option>
                          <option value="textarea">Mehrzeiliger Text</option>
                          <option value="number">Zahl</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="select">Select</option>
                          <option value="radio">Radio</option>
                          <option value="media">Foto / Video</option>
                          <option value="file">Datei / PDF</option>
                        </select>
                      </label>
                      <label className={labelClass}>
                        {t("workflows.storage.destination")}
                        <select
                          value={field.storage}
                          onChange={(event) =>
                            updateInput(field.uid, {
                              storage: event.target.value as StorageTarget,
                            })
                          }
                          className={inputClass}
                          disabled={
                            !editable || field.type === "media" || field.type === "file"
                          }
                        >
                          <option value="custom-field">
                            {t("workflows.storage.targets.customFieldShort")}
                          </option>
                          <option value="metadata">
                            {t("workflows.storage.targets.metadataShort")}
                          </option>
                          <option value="execution">
                            {t("workflows.storage.targets.executionShort")}
                          </option>
                        </select>
                      </label>
                      <label className={labelClass}>
                        Platzhalter
                        <input
                          value={field.placeholder}
                          onChange={(event) =>
                            updateInput(field.uid, { placeholder: event.target.value })
                          }
                          className={inputClass}
                          disabled={!editable}
                        />
                      </label>
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-[12px] font-medium text-muted-strong">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => updateInput(field.uid, { required: event.target.checked })}
                        disabled={!editable}
                        className="size-4 rounded border-border-strong accent-brand-solid disabled:cursor-not-allowed"
                      />
                      {t("workflows.steps.inputs.required")}
                    </label>

                    {field.type === "select" || field.type === "radio" ? (
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">{t("workflows.steps.inputs.options")}</p>
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                inputFields: current.inputFields.map((item) =>
                                  item.uid === field.uid
                                    ? {
                                        ...item,
                                        options: [
                                          ...item.options,
                                          {
                                            uid: localId("option"),
                                            value: `option-${item.options.length + 1}`,
                                            label: t("workflows.steps.inputs.newOption", {
                                              value: integer.format(item.options.length + 1),
                                            }),
                                            color: "#8b83df",
                                          },
                                        ],
                                      }
                                    : item,
                                ),
                              }))
                            }
                            disabled={!editable}
                            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-brand transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus className="size-3" aria-hidden="true" /> {t("workflows.steps.inputs.addOption")}
                          </button>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        {field.options.map((option) => (
                          <div key={option.uid} className="grid grid-cols-[36px_minmax(0,1fr)] gap-2 sm:grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)_30px]">
                            <label className="relative mt-1.5 grid size-9 cursor-pointer place-items-center overflow-hidden rounded-lg border border-border bg-surface shadow-sm" title={t("workflows.steps.inputs.chooseColor")}>
                              <span className="size-5 rounded-full border border-border-strong" style={{ backgroundColor: option.color ?? "#8b83df" }} />
                              <input
                                type="color"
                                value={option.color ?? "#8b83df"}
                                onChange={(event) => updateOption(field.uid, option.uid, "color", event.target.value)}
                                disabled={!editable}
                                className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                aria-label={t("workflows.steps.inputs.colorFor", { label: option.label })}
                              />
                            </label>
                            <label className={labelClass}>
                              <span className="sm:sr-only">{t("workflows.steps.inputs.label")}</span>
                              <input
                                value={option.label}
                                onChange={(event) => updateOption(field.uid, option.uid, "label", event.target.value)}
                                className={cn(inputClass, "mt-1.5")}
                                placeholder={t("workflows.steps.inputs.visibleLabel")}
                                disabled={!editable}
                              />
                            </label>
                            <label className={cn(labelClass, "col-start-2 sm:col-start-auto")}>
                              <span className="sm:sr-only">{t("workflows.steps.inputs.storedValue")}</span>
                              <input
                                value={option.value}
                                onChange={(event) => updateOption(field.uid, option.uid, "value", event.target.value)}
                                className={cn(inputClass, "mt-0 sm:mt-1.5")}
                                placeholder={t("workflows.steps.inputs.storedValue")}
                                disabled={!editable}
                              />
                            </label>
                            {canManage ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    inputFields: current.inputFields.map((item) =>
                                      item.uid === field.uid
                                        ? { ...item, options: item.options.filter((value) => value.uid !== option.uid) }
                                        : item,
                                    ),
                                  }))
                                }
                                disabled={!editable}
                                className="col-start-1 row-start-2 grid size-7 place-items-center self-center rounded-lg text-danger transition hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50 sm:col-start-auto sm:row-start-auto"
                                aria-label={t("workflows.steps.inputs.removeOption", { label: option.label })}
                              >
                                <X className="size-3.5" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                    ) : null}
                  </div>
                ))}

                {draft.inputFields.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted">
                    {t("workflows.steps.inputs.none")}
                  </div>
                ) : null}

                {canManage ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        inputFields: [
                          ...current.inputFields,
                          {
                            uid: localId("input"),
                            key: `property${current.inputFields.length + 1}`,
                            label: t("workflows.steps.inputs.newProperty", {
                              value: integer.format(current.inputFields.length + 1),
                            }),
                            required: false,
                            type: "text",
                            storage: "custom-field",
                            placeholder: "",
                            options: [
                              {
                                uid: localId("option"),
                                value: "option-1",
                                label: t("workflows.steps.inputs.newOption", {
                                  value: integer.format(1),
                                }),
                                color: "#8b83df",
                              },
                            ],
                          },
                        ],
                      }))
                    }
                    disabled={!editable}
                  >
                    <Plus className="size-3.5" aria-hidden="true" /> {t("workflows.steps.inputs.addField")}
                  </Button>
                ) : null}
              </div>
            </FlowStep>

            <FlowStep
              number={integer.format(5)}
              icon={<Settings2 className="size-[18px] sm:size-5" aria-hidden="true" />}
              title={t("workflows.steps.actions.title")}
              description={t("workflows.steps.actions.description")}
              last
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelClass}>
                  Hauptaktion
                  <select
                    value={draft.operation.type}
                    onChange={(event) => {
                      const type = event.target.value as Operation["type"];
                      setDraft((current) => ({
                        ...current,
                        quantityInputKey:
                          type === "unit" ? null : current.quantityInputKey,
                        ...(type === "stock-adjustment"
                          ? {
                              identifierStorage: "execution" as const,
                              extractedFields: current.extractedFields.map((field) => ({
                                ...field,
                                storage: "execution" as const,
                              })),
                              fixedProperties: current.fixedProperties.map((property) => ({
                                ...property,
                                storage: "execution" as const,
                              })),
                              inputFields: current.inputFields.map((field) => ({
                                ...field,
                                storage: "execution" as const,
                              })),
                            }
                          : {}),
                        operation:
                          type === "stock-adjustment"
                            ? { type, delta: 5 }
                            : type === "assembly-build"
                              ? { type, quantity: 1 }
                              : { type: "unit" },
                      }));
                    }}
                    className={inputClass}
                    disabled={!editable}
                  >
                    <option value="assembly-build">Baugruppe fertigstellen</option>
                    <option value="stock-adjustment">Bestand ein-/ausbuchen</option>
                    <option value="unit">Einheit anlegen/aktualisieren</option>
                  </select>
                </label>
                {draft.operation.type === "stock-adjustment" ? (
                  <label className={labelClass}>
                    Bestandsänderung
                    <input
                      type="number"
                      value={draft.operation.delta}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          operation: {
                            type: "stock-adjustment",
                            delta: Number(event.target.value),
                          },
                        }))
                      }
                      className={inputClass}
                      disabled={!editable}
                    />
                    <span className="mt-1 block text-[11px] text-muted">
                      Positiv zum Einbuchen, negativ zum Ausbuchen – z. B. +5.
                    </span>
                  </label>
                ) : draft.operation.type === "assembly-build" ? (
                  <label className={labelClass}>
                    Fertige Menge
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={draft.operation.quantity}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          operation: {
                            type: "assembly-build",
                            quantity: Number(event.target.value),
                          },
                        }))
                      }
                      className={inputClass}
                      disabled={!editable}
                    />
                    <span className="mt-1 block text-[11px] text-muted">
                      Die Stückliste wird automatisch verbraucht.
                    </span>
                  </label>
                ) : null}
              </div>

              {draft.operation.type !== "unit" ? (
                <div className="mt-3 rounded-xl border border-border bg-surface-subtle p-3.5">
                  <label className={labelClass}>
                    {t("workflows.quantityInput.label")}
                    <select
                      value={draft.quantityInputKey ?? ""}
                      onChange={(event) => {
                        const quantityInputKey = event.target.value || null;
                        setDraft((current) => ({
                          ...current,
                          quantityInputKey,
                          inputFields: current.inputFields.map((field) =>
                            field.key === quantityInputKey
                              ? { ...field, required: true }
                              : field,
                          ),
                        }));
                      }}
                      className={inputClass}
                      disabled={!editable}
                    >
                      <option value="">{t("workflows.quantityInput.fixed")}</option>
                      {draft.inputFields
                        .filter((field) => field.type === "number")
                        .map((field) => (
                          <option key={field.uid} value={field.key}>
                            {field.label || field.key}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="mt-1.5 text-[11px] leading-4 text-muted">
                    {draft.inputFields.some((field) => field.type === "number")
                      ? t("workflows.quantityInput.description")
                      : t("workflows.quantityInput.noNumberField")}
                  </p>
                </div>
              ) : null}

              {draft.operation.type === "unit" ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold text-muted-strong">{t("workflows.steps.actions.createMissing")}</p>
                        <p className="mt-1 text-[11px] leading-4 text-muted">{t("workflows.steps.actions.createMissingDescription")}</p>
                      </div>
                      <Toggle
                        checked={draft.createMissingUnit}
                        onChange={(createMissingUnit) => setDraft((current) => ({ ...current, createMissingUnit }))}
                        disabled={!editable}
                        label={t("workflows.steps.actions.createMissingAria")}
                      />
                    </div>
                  </div>
                  <label className={labelClass}>
                    {t("workflows.steps.actions.status")}
                    <select
                      value={draft.unitStatus ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          unitStatus: (event.target.value || null) as UnitStatus | null,
                        }))
                      }
                      className={inputClass}
                      disabled={!editable}
                    >
                      <option value="">{t("workflows.steps.actions.keepStatus")}</option>
                      {unitStatuses.map((status) => (
                        <option key={status} value={status}>{t(`statuses.${status}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-muted-strong">{t("workflows.steps.actions.fixedTitle")}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{t("workflows.steps.actions.fixedDescription")}</p>
                  </div>
                  {canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          fixedProperties: [
                            ...current.fixedProperties,
                            {
                              uid: localId("fixed"),
                              key: `property${current.fixedProperties.length + 1}`,
                              label: t("workflows.steps.actions.newProperty", {
                                value: integer.format(current.fixedProperties.length + 1),
                              }),
                              value: t("workflows.steps.actions.defaultValue"),
                              storage: "metadata",
                            },
                          ],
                        }))
                      }
                      disabled={!editable}
                    >
                      <Plus className="size-3.5" aria-hidden="true" /> {t("workflows.steps.actions.addProperty")}
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {draft.fixedProperties.map((property) => (
                    <div key={property.uid} className="rounded-xl border border-border bg-surface-subtle p-3">
                      <div className="grid gap-2 sm:grid-cols-4">
                        {property.storage === "custom-field" ? (
                          <StockUnitCustomFieldSelect
                            fields={stockUnitCustomFields}
                            value={property.key}
                            onChange={(value) =>
                              updateFixedProperty(property.uid, "key", value)
                            }
                            disabled={!editable}
                            t={t}
                          />
                        ) : (
                          <label className={labelClass}>
                            {t("workflows.storage.propertyKey")}
                            <input
                              value={property.key}
                              onChange={(event) =>
                                updateFixedProperty(
                                  property.uid,
                                  "key",
                                  event.target.value,
                                )
                              }
                              className={inputClass}
                              placeholder={t("workflows.steps.actions.keyPlaceholder")}
                              disabled={!editable}
                            />
                          </label>
                        )}
                        <label className={labelClass}>
                          {t("workflows.steps.actions.visibleLabel")}
                          <input
                            value={property.label}
                            onChange={(event) => updateFixedProperty(property.uid, "label", event.target.value)}
                            className={inputClass}
                            placeholder={t("workflows.template.assemblyStatus")}
                            disabled={!editable}
                          />
                        </label>
                        <label className={labelClass}>
                          {t("workflows.steps.actions.storedValue")}
                          <input
                            value={property.value}
                            onChange={(event) => updateFixedProperty(property.uid, "value", event.target.value)}
                            className={inputClass}
                            placeholder={t("workflows.steps.actions.storedValuePlaceholder")}
                            disabled={!editable}
                          />
                        </label>
                        <label className={labelClass}>
                          {t("workflows.storage.destination")}
                          <select
                            value={property.storage}
                            onChange={(event) =>
                              updateFixedProperty(
                                property.uid,
                                "storage",
                                event.target.value,
                              )
                            }
                            className={inputClass}
                            disabled={!editable}
                          >
                            <option value="custom-field">
                              {t("workflows.storage.targets.customFieldShort")}
                            </option>
                            <option value="metadata">
                              {t("workflows.storage.targets.metadataShort")}
                            </option>
                            <option value="execution">
                              {t("workflows.storage.targets.executionShort")}
                            </option>
                          </select>
                        </label>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <p className="text-[11px] text-muted">
                          {t("workflows.steps.actions.visibleAs", {
                            value: visiblePropertyValue(property, t),
                          })}
                        </p>
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                fixedProperties: current.fixedProperties.filter((item) => item.uid !== property.uid),
                              }))
                            }
                            disabled={!editable}
                            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="size-3" aria-hidden="true" /> {t("workflows.steps.actions.remove")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {draft.fixedProperties.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[12px] text-muted">{t("workflows.steps.actions.none")}</p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-surface-subtle p-3.5 sm:flex-row sm:items-center">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                  <Webhook className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-muted-strong">
                    Webhook nach erfolgreicher Ausführung
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Sendet ein signiertes Ereignis an abonnierte Integrations-Webhooks.
                  </p>
                </div>
                <input
                  aria-label="Webhook-Ereignisname"
                  value={draft.webhookEventName}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      webhookEventName: event.target.value,
                    }))
                  }
                  className={cn(inputClass, "mt-0 sm:w-64")}
                  disabled={!editable || !draft.triggerWebhook}
                />
                <Toggle
                  checked={draft.triggerWebhook}
                  onChange={(triggerWebhook) =>
                    setDraft((current) => ({ ...current, triggerWebhook }))
                  }
                  disabled={!editable}
                  label="Webhook auslösen"
                />
              </div>
            </FlowStep>
          </div>

          <Card className="mt-4 overflow-hidden">
            <div className="border-b border-border bg-[linear-gradient(110deg,var(--color-brand-soft),var(--color-surface))] px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
                  <QrCode className="size-[18px]" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-[14px] font-semibold text-foreground">{t("workflows.preview.title")}</h2>
                  <p className="mt-0.5 text-[11px] text-muted">{t("workflows.preview.description")}</p>
                </div>
                <Badge tone="neutral" className="ml-auto">{t("workflows.preview.noWrite")}</Badge>
              </div>
            </div>
            <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div>
                <label className={labelClass}>
                  {t("workflows.preview.scannedValue")}
                  <textarea
                    value={sampleScan}
                    onChange={(event) => setSampleScan(event.target.value)}
                    className={cn(textAreaClass, "min-h-24 font-mono text-[13px]")}
                    placeholder={t("workflows.preview.placeholder")}
                    disabled={interactionBusy}
                  />
                </label>
                {draft.inputFields.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {draft.inputFields.map((field) => (
                      <label key={field.uid} className={labelClass}>
                        {field.label || field.key || t("workflows.preview.inputFallback")}{field.required ? " *" : ""}
                        {field.type === "select" || field.type === "radio" ? (
                          <select
                            value={previewInputs[field.uid] ?? ""}
                            onChange={(event) => setPreviewInputs((current) => ({ ...current, [field.uid]: event.target.value }))}
                            className={inputClass}
                            disabled={interactionBusy}
                          >
                            <option value="">—</option>
                            {field.options.map((option) => (
                              <option key={option.uid} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : field.type === "checkbox" ? (
                          <input
                            type="checkbox"
                            checked={previewInputs[field.uid] === "true"}
                            onChange={(event) =>
                              setPreviewInputs((current) => ({
                                ...current,
                                [field.uid]: String(event.target.checked),
                              }))
                            }
                            className="mt-3 size-4 accent-brand-solid"
                            disabled={interactionBusy}
                          />
                        ) : field.type === "media" || field.type === "file" ? (
                          <input
                            type="file"
                            multiple
                            accept={field.type === "media" ? "image/*,video/*" : "application/pdf,image/*"}
                            className={cn(inputClass, "py-2")}
                            disabled={interactionBusy}
                          />
                        ) : (
                          <input
                            type={field.type === "number" ? "number" : "text"}
                            value={previewInputs[field.uid] ?? ""}
                            placeholder={field.placeholder}
                            onChange={(event) => setPreviewInputs((current) => ({ ...current, [field.uid]: event.target.value }))}
                            className={inputClass}
                            disabled={interactionBusy}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-surface-subtle p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{t("workflows.preview.result")}</p>
                {extractionResult.error ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-[12px] leading-5 text-danger">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {extractionResult.error}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-success-border bg-success-soft p-3">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-success">
                      <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                      {draft.identifierPropertyKey || t("workflows.preview.identifier")}
                    </div>
                    <p className="mt-1.5 break-all font-mono text-[14px] font-semibold text-success">{extractionResult.value}</p>
                  </div>
                )}

                <div className="mt-4 space-y-2.5 text-[12px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted">{t("workflows.preview.target")}</span>
                    <strong className="text-right font-semibold text-muted-strong">
                      {selectedResources.length
                        ? selectedResources.map((resource) => resource.name).join(", ")
                        : t("workflows.preview.notSelected")}
                    </strong>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted">Aktion</span>
                    <strong className="text-right font-semibold text-muted-strong">
                      {draft.operation.type === "stock-adjustment"
                        ? `${draft.operation.delta > 0 ? "+" : ""}${draft.operation.delta} Bestand`
                        : draft.operation.type === "assembly-build"
                          ? `${draft.operation.quantity} × Baugruppe fertigstellen`
                          : t(draft.createMissingUnit ? "workflows.preview.findOrCreate" : "workflows.preview.findExisting")}
                    </strong>
                  </div>
                  {draft.fixedProperties.map((property) => (
                    <div key={property.uid} className="flex items-start justify-between gap-3">
                      <span className="text-muted">{property.label || property.key}</span>
                      <strong className="text-right font-semibold text-muted-strong">{visiblePropertyValue(property, t)}</strong>
                    </div>
                  ))}
                  {draft.inputFields.map((field) => {
                    const option = field.options.find((item) => item.value === previewInputs[field.uid]);
                    return (
                      <div key={field.uid} className="flex items-center justify-between gap-3">
                        <span className="text-muted">{field.label || field.key}</span>
                        <strong className="inline-flex items-center gap-1.5 text-right font-semibold text-muted-strong">
                          {option?.color ? <span className="size-2.5 rounded-full border border-border-strong" style={{ backgroundColor: option.color }} /> : null}
                          {option?.label ?? previewInputs[field.uid] ?? t("workflows.preview.notSelected")}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
