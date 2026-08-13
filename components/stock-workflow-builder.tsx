"use client";

import type { TFunction } from "i18next";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { useT } from "next-i18next/client";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Eye,
  FileKey2,
  Layers3,
  LoaderCircle,
  Lock,
  PackageCheck,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  ScanLine,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
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
import { fetchJson } from "@/lib/client-types";

type ExtractionMode = "full" | "url-query" | "prefix";
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
  | { mode: "prefix"; prefix: string };

type FixedProperty = {
  key: string;
  label: string;
  value: string;
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
  options: InputOption[];
};

type WorkflowPayload = {
  name: string;
  description: string;
  enabled: boolean;
  resourceId: string;
  extraction: Extraction;
  identifierPropertyKey: string;
  createMissingUnit: boolean;
  unitStatus: UnitStatus | null;
  fixedProperties: FixedProperty[];
  inputFields: InputField[];
  revision?: number;
};

type WorkflowRecord = Omit<WorkflowPayload, "revision"> & {
  id: string;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
};

type StockItem = {
  resourceId: string;
  name: string;
  type?: string;
  quantity?: number;
  trackingMode: string;
  unitName?: string;
};

type DraftOption = InputOption & { uid: string };
type DraftInput = Omit<InputField, "options"> & {
  uid: string;
  options: DraftOption[];
};
type DraftFixedProperty = FixedProperty & { uid: string };

type WorkflowDraft = {
  id: string | null;
  revision?: number;
  name: string;
  description: string;
  enabled: boolean;
  resourceId: string;
  extraction: {
    mode: ExtractionMode;
    parameter: string;
    prefix: string;
    sourceOrigin: string;
    sourcePath: string;
  };
  identifierPropertyKey: string;
  createMissingUnit: boolean;
  unitStatus: UnitStatus | null;
  fixedProperties: DraftFixedProperty[];
  inputFields: DraftInput[];
};

type Notice = { tone: "success" | "error" | "info"; message: string };

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const textAreaClass =
  "mt-1.5 min-h-20 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] leading-5 text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const labelClass = "block text-[11px] font-semibold text-muted-strong";

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
    extraction: {
      mode: "url-query",
      parameter: "d",
      prefix: "EPD-",
      sourceOrigin: "https://paperlesspaper.de",
      sourcePath: "/b",
    },
    identifierPropertyKey: "epdNumber",
    createMissingUnit: true,
    unitStatus: null,
    fixedProperties: [
      {
        uid: "template-fixed-assembly-status",
        key: "assemblyStatus",
        label: t("workflows.template.assemblyStatus"),
        value: "finished-assembled",
      },
    ],
    inputFields: [
      {
        uid: "template-input-color",
        key: "color",
        label: t("workflows.template.color"),
        required: true,
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
  };
}

function workflowToDraft(workflow: WorkflowRecord): WorkflowDraft {
  const extraction = workflow.extraction;
  return {
    ...workflow,
    id: workflow.id,
    extraction: {
      mode: extraction.mode,
      parameter: extraction.mode === "url-query" ? extraction.parameter : "d",
      prefix: extraction.mode === "prefix" ? extraction.prefix : "EPD-",
      sourceOrigin:
        extraction.mode === "url-query" ? extraction.sourceOrigin ?? "" : "",
      sourcePath: extraction.mode === "url-query" ? extraction.sourcePath ?? "" : "",
    },
    fixedProperties: workflow.fixedProperties.map((property, index) => ({
      ...property,
      uid: `fixed-${index}-${property.key}`,
    })),
    inputFields: workflow.inputFields.map((field, fieldIndex) => ({
      ...field,
      uid: `input-${fieldIndex}-${field.key}`,
      options: field.options.map((option, optionIndex) => ({
        ...option,
        uid: `option-${fieldIndex}-${optionIndex}-${option.value}`,
      })),
    })),
  };
}

function draftToPayload(draft: WorkflowDraft): WorkflowPayload {
  let extraction: Extraction;
  if (draft.extraction.mode === "full") {
    extraction = { mode: "full" };
  } else if (draft.extraction.mode === "prefix") {
    extraction = { mode: "prefix", prefix: draft.extraction.prefix.trim() };
  } else {
    extraction = {
      mode: "url-query",
      parameter: draft.extraction.parameter.trim(),
      ...(draft.extraction.sourceOrigin.trim()
        ? { sourceOrigin: draft.extraction.sourceOrigin.trim() }
        : {}),
      ...(draft.extraction.sourcePath.trim()
        ? { sourcePath: draft.extraction.sourcePath.trim() }
        : {}),
    };
  }

  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: draft.enabled,
    resourceId: draft.resourceId,
    extraction,
    identifierPropertyKey: draft.identifierPropertyKey.trim(),
    createMissingUnit: draft.createMissingUnit,
    unitStatus: draft.unitStatus,
    fixedProperties: draft.fixedProperties.map(({ key, label, value }) => ({
      key: key.trim(),
      label: label.trim(),
      value: value.trim(),
    })),
    inputFields: draft.inputFields.map(({ key, label, required, options }) => ({
      key: key.trim(),
      label: label.trim(),
      required,
      options: options.map(({ value, label: optionLabel, color }) => ({
        value: value.trim(),
        label: optionLabel.trim(),
        ...(color ? { color } : {}),
      })),
    })),
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
          (item as StockItem).trackingMode === "serialized",
      ),
  );
}

function validateDraft(draft: WorkflowDraft, t: TFunction) {
  if (!draft.name.trim()) return t("workflows.validation.name");
  if (!draft.resourceId) return t("workflows.validation.resource");
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

  const propertyKeys = new Set<string>();
  propertyKeys.add(draft.identifierPropertyKey.trim());
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
    if (field.options.length === 0) return t("workflows.validation.optionRequired", {
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
        <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-brand-solid text-[8px] font-bold text-on-brand ring-2 ring-background">
          {number}
        </span>
      </span>
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-[11px] leading-5 text-muted">{description}</p>
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
        "mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12px] leading-5",
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

export function StockWorkflowBuilder({ canManage }: { canManage: boolean }) {
  const { t, i18n } = useT("scanner");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const firstDraft = useMemo(() => templateDraft(t), [t]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [resources, setResources] = useState<StockItem[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft>(firstDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baseSignature, setBaseSignature] = useState(() => payloadSignature(firstDraft));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sampleScan, setSampleScan] = useState(
    "https://paperlesspaper.de/b?d=epd13-9c139ed7b44c&w=99",
  );
  const [previewInputs, setPreviewInputs] = useState<Record<string, string>>({});

  const applyWorkflow = useCallback((workflow: WorkflowRecord) => {
    const nextDraft = workflowToDraft(workflow);
    setSelectedId(workflow.id);
    setDraft(nextDraft);
    setBaseSignature(payloadSignature(nextDraft));
    setConfirmDelete(false);
  }, []);

  const loadData = useCallback(
    async (options?: { refresh?: boolean; keepSelection?: string | null }) => {
      if (options?.refresh) setRefreshing(true);
      else setLoading(true);
      setNotice(null);
      try {
        const [workflowPayload, stockPayload] = await Promise.all([
          fetchJson<unknown>("/api/v1/stock/scan-workflows", { cache: "no-store" }),
          fetchJson<unknown>("/api/v1/stock", { cache: "no-store" }),
        ]);
        const nextWorkflows = workflowsFromResponse(workflowPayload);
        const nextResources = stockItemsFromResponse(stockPayload);
        setWorkflows(nextWorkflows);
        setResources(nextResources);

        const requestedId = options?.keepSelection;
        const nextSelection =
          (requestedId ? nextWorkflows.find((workflow) => workflow.id === requestedId) : null) ??
          nextWorkflows[0];
        if (nextSelection) {
          applyWorkflow(nextSelection);
        } else {
          const nextDraft = templateDraft(t, nextResources[0]?.resourceId ?? "");
          setSelectedId(null);
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
        setRefreshing(false);
      }
    },
    [applyWorkflow, t],
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
  const interactionBusy = saving || deleting || refreshing;
  const editable = canManage && !interactionBusy;
  const savedWorkflow = draft.id
    ? workflows.find((workflow) => workflow.id === draft.id) ?? null
    : null;
  const selectedResource = resources.find(
    (resource) => resource.resourceId === draft.resourceId,
  );
  const extractionResult = useMemo(
    () => extractIdentifier(sampleScan, draft.extraction, t),
    [draft.extraction, sampleScan, t],
  );

  const confirmDraftDiscard = () =>
    !dirty ||
    window.confirm(
      t("workflows.confirmDiscard"),
    );

  const chooseTemplate = () => {
    if (interactionBusy || !confirmDraftDiscard()) return;
    const nextDraft = templateDraft(t, resources[0]?.resourceId ?? "");
    setSelectedId(null);
    setDraft(nextDraft);
    setBaseSignature(payloadSignature(nextDraft));
    setConfirmDelete(false);
    setNotice({ tone: "info", message: t("workflows.notices.templateLoaded") });
  };

  const selectWorkflow = (workflow: WorkflowRecord) => {
    if (interactionBusy || selectedId === workflow.id || !confirmDraftDiscard()) return;
    applyWorkflow(workflow);
    setNotice(null);
  };

  const refreshData = () => {
    if (interactionBusy || !confirmDraftDiscard()) return;
    void loadData({ refresh: true, keepSelection: selectedId });
  };

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
      applyWorkflow(saved);
      setNotice({ tone: "success", message });
      return saved;
    } catch {
      setNotice({
        tone: "error",
        message: t("workflows.errors.save"),
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
    } catch {
      setNotice({
        tone: "error",
        message: t("workflows.errors.update"),
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
      if (remaining[0]) {
        applyWorkflow(remaining[0]);
      } else {
        const nextDraft = templateDraft(t, resources[0]?.resourceId ?? "");
        setSelectedId(null);
        setDraft(nextDraft);
        setBaseSignature(payloadSignature(nextDraft));
        setConfirmDelete(false);
      }
      setNotice({ tone: "success", message: t("workflows.notices.deleted") });
    } catch {
      setNotice({
        tone: "error",
        message: t("workflows.errors.delete"),
      });
    } finally {
      setDeleting(false);
    }
  };

  const updateFixedProperty = (
    uid: string,
    key: keyof Pick<DraftFixedProperty, "key" | "label" | "value">,
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
    patch: Partial<Pick<DraftInput, "key" | "label" | "required">>,
  ) => {
    setDraft((current) => ({
      ...current,
      inputFields: current.inputFields.map((field) =>
        field.uid === uid ? { ...field, ...patch } : field,
      ),
    }));
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
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Skeleton className="h-[480px] rounded-2xl" />
          <Skeleton className="h-[780px] rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="animate-fade-up">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">
            <Workflow className="size-3.5 text-brand" aria-hidden="true" />
            {t("workflows.header.eyebrow")}
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-foreground sm:text-[32px]">
            {t("workflows.header.title")}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            {t("workflows.header.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!canManage ? (
            <Badge tone="neutral" className="h-9 gap-1.5 px-3">
              <Lock className="size-3.5" aria-hidden="true" /> {t("workflows.header.readOnly")}
            </Badge>
          ) : null}
          <Button
            variant="secondary"
            onClick={refreshData}
            disabled={interactionBusy}
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
            {t("workflows.header.refresh")}
          </Button>
          {canManage ? (
            <Button onClick={chooseTemplate} disabled={interactionBusy}>
              <Sparkles className="size-4" aria-hidden="true" />
              {t("workflows.header.newTemplate")}
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? <NoticeBanner notice={notice} /> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="overflow-hidden xl:sticky xl:top-[84px]">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div>
              <h2 className="text-[13px] font-semibold text-foreground">{t("workflows.sidebar.title")}</h2>
              <p className="mt-0.5 text-[10px] text-muted">
                {t("workflows.sidebar.configured", {
                  count: workflows.length,
                  value: integer.format(workflows.length),
                })}
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={chooseTemplate}
                disabled={interactionBusy}
                className="grid size-8 place-items-center rounded-lg border border-border text-muted transition hover:border-brand-border hover:bg-brand-soft hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={t("workflows.sidebar.createAria")}
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {workflows.length ? (
            <div className="max-h-[540px] space-y-1 overflow-y-auto p-2">
              {workflows.map((workflow) => {
                const active = selectedId === workflow.id;
                const resource = resources.find(
                  (item) => item.resourceId === workflow.resourceId,
                );
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => selectWorkflow(workflow)}
                    disabled={interactionBusy}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                      active ? "bg-brand-soft" : "hover:bg-surface-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg",
                        workflow.enabled
                          ? "bg-success-soft text-success"
                          : "bg-border text-muted",
                      )}
                    >
                      <QrCode className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-foreground">
                        {workflow.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted">
                        {t("workflows.sidebar.resourceRevision", {
                          resource: resource?.name ?? t("workflows.fallbacks.resourceUnavailable"),
                          revision: integer.format(workflow.revision),
                        })}
                      </span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition",
                        active ? "text-brand" : "text-muted group-hover:text-muted",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              className="min-h-56 py-8"
              icon={<Workflow className="size-5" aria-hidden="true" />}
              title={t("workflows.sidebar.emptyTitle")}
              description={
                canManage
                  ? t("workflows.sidebar.emptyManager")
                  : t("workflows.sidebar.emptyViewer")
              }
            />
          )}

          <div className="border-t border-border bg-surface-subtle px-4 py-3 text-[10px] leading-4 text-muted">
            <span className="inline-flex items-center gap-1.5 font-medium text-muted">
              <ShieldCheck className="size-3.5 text-brand" aria-hidden="true" />
              {t("workflows.sidebar.safeTitle")}
            </span>
            <p className="mt-1">{t("workflows.sidebar.safeDescription")}</p>
          </div>
        </Card>

        <div className="min-w-0">
          <Card className="mb-4 overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-foreground">
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
                <p className="mt-1 text-[11px] text-muted">
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
                  <p className="text-[12px] leading-5 text-danger">
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
                    <p className="text-[11px] font-semibold text-muted-strong">{t("workflows.editor.enabledLabel")}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted">{t("workflows.editor.enabledDescription")}</p>
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
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-[12px] leading-5 text-muted shadow-[var(--shadow-sm)]">
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
                    <p className="text-[12px] font-semibold text-foreground">{t("workflows.steps.trigger.event")}</p>
                    <p className="mt-0.5 text-[10px] text-muted">{t("workflows.steps.trigger.eventDescription")}</p>
                  </div>
                </div>
                <Badge tone="brand">{t("workflows.steps.trigger.badge")}</Badge>
              </div>
            </FlowStep>

            <FlowStep
              number={integer.format(2)}
              icon={<FileKey2 className="size-[18px] sm:size-5" aria-hidden="true" />}
              title={t("workflows.steps.extract.title")}
              description={t("workflows.steps.extract.description")}
            >
              <div className="grid grid-cols-1 gap-1 rounded-xl bg-surface-muted p-1 sm:grid-cols-3">
                {(["full", "url-query", "prefix"] as const).map((mode) => (
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
                      "h-9 rounded-lg px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed",
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
                  <label className={labelClass}>
                    {t("workflows.steps.extract.identifierKey")}
                    <input
                      value={draft.identifierPropertyKey}
                      onChange={(event) => setDraft((current) => ({ ...current, identifierPropertyKey: event.target.value }))}
                      className={inputClass}
                      placeholder={t("workflows.steps.extract.identifierKeyPlaceholder")}
                      disabled={!editable}
                    />
                  </label>
                </div>
              ) : draft.extraction.mode === "prefix" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                  <label className={labelClass}>
                    {t("workflows.steps.extract.identifierKey")}
                    <input
                      value={draft.identifierPropertyKey}
                      onChange={(event) => setDraft((current) => ({ ...current, identifierPropertyKey: event.target.value }))}
                      className={inputClass}
                      placeholder={t("workflows.steps.extract.identifierKeyPlaceholder")}
                      disabled={!editable}
                    />
                  </label>
                </div>
              ) : (
                <label className={cn(labelClass, "mt-4 block max-w-md")}>
                  {t("workflows.steps.extract.identifierKey")}
                  <input
                    value={draft.identifierPropertyKey}
                    onChange={(event) => setDraft((current) => ({ ...current, identifierPropertyKey: event.target.value }))}
                    className={inputClass}
                    placeholder={t("workflows.steps.extract.identifierKeyPlaceholder")}
                    disabled={!editable}
                  />
                </label>
              )}
            </FlowStep>

            <FlowStep
              number={integer.format(3)}
              icon={<PackageCheck className="size-[18px] sm:size-5" aria-hidden="true" />}
              title={t("workflows.steps.target.title")}
              description={t("workflows.steps.target.description")}
            >
              {resources.length ? (
                <label className={labelClass}>
                  {t("workflows.steps.target.field")}
                  <select
                    value={draft.resourceId}
                    onChange={(event) => setDraft((current) => ({ ...current, resourceId: event.target.value }))}
                    className={inputClass}
                    disabled={!editable}
                  >
                    <option value="">{t("workflows.steps.target.select")}</option>
                    {resources.map((resource) => (
                      <option key={resource.resourceId} value={resource.resourceId}>
                        {resource.quantity !== undefined
                          ? t("workflows.steps.target.resourceQuantity", {
                              name: resource.name,
                              quantity: integer.format(resource.quantity),
                              unit:
                                resource.unitName ??
                                t("workflows.steps.target.units", {
                                  count: resource.quantity,
                                }),
                            })
                          : resource.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-warning-border bg-warning-soft p-3.5 text-[12px] leading-5 text-warning sm:flex-row sm:items-center sm:justify-between">
                  <span>{t("workflows.steps.target.none")}</span>
                  <Link href="/inventory" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                    {t("workflows.steps.target.configure")} <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              )}
              {selectedResource ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-success-border bg-success-soft p-3">
                  <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
                  <p className="text-[11px] text-success">
                    {t("workflows.steps.target.selected", { name: selectedResource.name })}
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
                        <span className="grid size-6 place-items-center rounded-md bg-brand-soft text-[10px] font-bold text-brand">
                          {integer.format(fieldIndex + 1)}
                        </span>
                        <p className="text-[12px] font-semibold text-muted-strong">{t("workflows.steps.inputs.selectField")}</p>
                      </div>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
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
                      <label className={labelClass}>
                        {t("workflows.steps.inputs.propertyKey")}
                        <input
                          value={field.key}
                          onChange={(event) => updateInput(field.uid, { key: event.target.value })}
                          className={inputClass}
                          placeholder={t("workflows.steps.inputs.propertyKeyPlaceholder")}
                          disabled={!editable}
                        />
                      </label>
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
                    <label className="mt-3 flex items-center gap-2 text-[11px] font-medium text-muted-strong">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => updateInput(field.uid, { required: event.target.checked })}
                        disabled={!editable}
                        className="size-4 rounded border-border-strong accent-brand-solid disabled:cursor-not-allowed"
                      />
                      {t("workflows.steps.inputs.required")}
                    </label>

                    <div className="mt-4 border-t border-border pt-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">{t("workflows.steps.inputs.options")}</p>
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
                            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-brand transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-50"
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
                  </div>
                ))}

                {draft.inputFields.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted">
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
                <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold text-muted-strong">{t("workflows.steps.actions.createMissing")}</p>
                      <p className="mt-1 text-[10px] leading-4 text-muted">{t("workflows.steps.actions.createMissingDescription")}</p>
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

              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-muted-strong">{t("workflows.steps.actions.fixedTitle")}</p>
                    <p className="mt-0.5 text-[10px] text-muted">{t("workflows.steps.actions.fixedDescription")}</p>
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
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className={labelClass}>
                          {t("workflows.steps.actions.key")}
                          <input
                            value={property.key}
                            onChange={(event) => updateFixedProperty(property.uid, "key", event.target.value)}
                            className={inputClass}
                            placeholder={t("workflows.steps.actions.keyPlaceholder")}
                            disabled={!editable}
                          />
                        </label>
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
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <p className="text-[10px] text-muted">
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
                            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-danger transition hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="size-3" aria-hidden="true" /> {t("workflows.steps.actions.remove")}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {draft.fixedProperties.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-[11px] text-muted">{t("workflows.steps.actions.none")}</p>
                  ) : null}
                </div>
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
                  <h2 className="text-[13px] font-semibold text-foreground">{t("workflows.preview.title")}</h2>
                  <p className="mt-0.5 text-[10px] text-muted">{t("workflows.preview.description")}</p>
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
                    className={cn(textAreaClass, "min-h-24 font-mono text-[12px]")}
                    placeholder={t("workflows.preview.placeholder")}
                    disabled={interactionBusy}
                  />
                </label>
                {draft.inputFields.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {draft.inputFields.map((field) => (
                      <label key={field.uid} className={labelClass}>
                        {field.label || field.key || t("workflows.preview.inputFallback")}{field.required ? " *" : ""}
                        <select
                          value={previewInputs[field.uid] ?? ""}
                          onChange={(event) => setPreviewInputs((current) => ({ ...current, [field.uid]: event.target.value }))}
                          className={inputClass}
                          disabled={interactionBusy}
                        >
                          {field.options.map((option) => (
                            <option key={option.uid} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-surface-subtle p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">{t("workflows.preview.result")}</p>
                {extractionResult.error ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-[11px] leading-5 text-danger">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {extractionResult.error}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-success-border bg-success-soft p-3">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-success">
                      <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                      {draft.identifierPropertyKey || t("workflows.preview.identifier")}
                    </div>
                    <p className="mt-1.5 break-all font-mono text-[13px] font-semibold text-success">{extractionResult.value}</p>
                  </div>
                )}

                <div className="mt-4 space-y-2.5 text-[11px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted">{t("workflows.preview.target")}</span>
                    <strong className="text-right font-semibold text-muted-strong">{selectedResource?.name ?? t("workflows.preview.notSelected")}</strong>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted">{t("workflows.preview.unit")}</span>
                    <strong className="text-right font-semibold text-muted-strong">
                      {t(draft.createMissingUnit ? "workflows.preview.findOrCreate" : "workflows.preview.findExisting")}
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
                          {option?.label ?? t("workflows.preview.notSelected")}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
