"use client";

import Link from "next/link";
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
  "mt-1.5 h-10 w-full rounded-xl border border-[#dfe2e7] bg-white px-3 text-[13px] text-[#30343a] outline-none transition placeholder:text-[#5f6672] hover:border-[#cfd3da] focus:border-[#776fff] focus:ring-3 focus:ring-[#635bff]/10 disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#5f6672]";
const textAreaClass =
  "mt-1.5 min-h-20 w-full resize-y rounded-xl border border-[#dfe2e7] bg-white px-3 py-2.5 text-[13px] leading-5 text-[#30343a] outline-none transition placeholder:text-[#5f6672] hover:border-[#cfd3da] focus:border-[#776fff] focus:ring-3 focus:ring-[#635bff]/10 disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#5f6672]";
const labelClass = "block text-[11px] font-semibold text-[#555c67]";

const unitStatusLabels: Record<UnitStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  "in-use": "In use",
  maintenance: "Maintenance",
  consumed: "Consumed",
  lost: "Lost",
  retired: "Retired",
};

const unitStatuses = Object.keys(unitStatusLabels) as UnitStatus[];

let nextLocalId = 0;
function localId(prefix: string) {
  nextLocalId += 1;
  return `${prefix}-${nextLocalId}`;
}

function templateDraft(resourceId = ""): WorkflowDraft {
  return {
    id: null,
    name: "Paperless Paper assembly",
    description:
      "Read an EPD number from the product QR code, register the assembled unit, and capture its color.",
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
        label: "Assembly status",
        value: "finished-assembled",
      },
    ],
    inputFields: [
      {
        uid: "template-input-color",
        key: "color",
        label: "Farbe",
        required: true,
        options: [
          { uid: "template-color-wood", value: "wood", label: "Holz", color: "#b9875e" },
          { uid: "template-color-black", value: "black", label: "Schwarz", color: "#202124" },
          { uid: "template-color-white", value: "white", label: "Weiß", color: "#f4f2ec" },
          { uid: "template-color-pink", value: "pink", label: "Pink", color: "#ec8eb0" },
          { uid: "template-color-green", value: "green", label: "Grün", color: "#668c67" },
          { uid: "template-color-oak", value: "oak", label: "Eiche", color: "#c9a56a" },
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

function validateDraft(draft: WorkflowDraft) {
  if (!draft.name.trim()) return "Give this workflow a name.";
  if (!draft.resourceId) return "Choose a serialized inventory item.";
  if (!draft.identifierPropertyKey.trim()) return "Set an identifier property key.";
  const validPropertyKey = /^[A-Za-z0-9_.-]+$/;
  if (!validPropertyKey.test(draft.identifierPropertyKey.trim())) {
    return "Property keys may only contain letters, numbers, underscore, dash, and dot.";
  }
  if (draft.extraction.mode === "url-query") {
    if (!draft.extraction.parameter.trim()) return "Set the URL query parameter to extract.";
    if (draft.extraction.sourceOrigin.trim()) {
      try {
        const sourceOrigin = draft.extraction.sourceOrigin.trim();
        const parsed = new URL(sourceOrigin);
        if (parsed.origin !== sourceOrigin) {
          return "Source origin must contain only scheme and host, for example https://example.com.";
        }
      } catch {
        return "Source origin must be a valid URL origin.";
      }
    }
    if (
      draft.extraction.sourcePath.trim() &&
      (!draft.extraction.sourcePath.trim().startsWith("/") ||
        draft.extraction.sourcePath.includes("?") ||
        draft.extraction.sourcePath.includes("#"))
    ) {
      return "Source path must begin with / and cannot contain a query or fragment.";
    }
  }
  if (draft.extraction.mode === "prefix" && !draft.extraction.prefix) {
    return "Set the prefix that should be removed from scans.";
  }

  const propertyKeys = new Set<string>();
  propertyKeys.add(draft.identifierPropertyKey.trim());
  for (const property of draft.fixedProperties) {
    if (!property.key.trim() || !property.label.trim() || !property.value.trim()) {
      return "Every fixed property needs a key, label, and value.";
    }
    if (!validPropertyKey.test(property.key.trim())) {
      return "Property keys may only contain letters, numbers, underscore, dash, and dot.";
    }
    if (propertyKeys.has(property.key.trim())) {
      return "Identifier, fixed property, and scan input keys must all be unique.";
    }
    propertyKeys.add(property.key.trim());
  }

  const inputKeys = new Set<string>();
  for (const field of draft.inputFields) {
    if (!field.key.trim() || !field.label.trim()) {
      return "Every scan input needs a key and label.";
    }
    if (!validPropertyKey.test(field.key.trim())) {
      return "Property keys may only contain letters, numbers, underscore, dash, and dot.";
    }
    if (inputKeys.has(field.key.trim()) || propertyKeys.has(field.key.trim())) {
      return "Identifier, fixed property, and scan input keys must all be unique.";
    }
    inputKeys.add(field.key.trim());
    if (field.options.length === 0) return `${field.label || "Each scan input"} needs an option.`;
    const optionValues = new Set<string>();
    for (const option of field.options) {
      if (!option.value.trim() || !option.label.trim()) {
        return `Every option in ${field.label || "a scan input"} needs a value and label.`;
      }
      if (optionValues.has(option.value.trim())) {
        return `Option values in ${field.label || "a scan input"} must be unique.`;
      }
      optionValues.add(option.value.trim());
    }
  }
  return null;
}

function extractIdentifier(
  scannedValue: string,
  extraction: WorkflowDraft["extraction"],
): { value: string | null; error: string | null } {
  const raw = scannedValue.trim();
  if (!raw) return { value: null, error: "Paste or scan a value to test extraction." };

  if (extraction.mode === "full") return { value: raw, error: null };
  if (extraction.mode === "prefix") {
    if (!raw.startsWith(extraction.prefix)) {
      return { value: null, error: `The scan does not start with “${extraction.prefix}”.` };
    }
    const value = raw.slice(extraction.prefix.length).trim();
    return value
      ? { value, error: null }
      : { value: null, error: "Nothing remains after removing the prefix." };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { value: null, error: "The scanned value is not a valid URL." };
  }

  if (extraction.sourceOrigin.trim()) {
    try {
      const expectedOrigin = new URL(extraction.sourceOrigin).origin;
      if (url.origin !== expectedOrigin) {
        return { value: null, error: `Expected a QR code from ${expectedOrigin}.` };
      }
    } catch {
      return { value: null, error: "The configured source origin is invalid." };
    }
  }
  if (extraction.sourcePath.trim() && url.pathname !== extraction.sourcePath.trim()) {
    return { value: null, error: `Expected the path ${extraction.sourcePath.trim()}.` };
  }
  const parameter = extraction.parameter.trim();
  const values = url.searchParams.getAll(parameter);
  if (values.length !== 1) {
    return {
      value: null,
      error: `The scan must contain exactly one “${parameter || "?"}” query value.`,
    };
  }
  const value = values[0].trim();
  return value
    ? { value, error: null }
    : {
        value: null,
        error: `Query parameter “${parameter || "?"}” is empty.`,
      };
}

function visiblePropertyValue(property: Pick<FixedProperty, "key" | "value">) {
  if (property.key === "assemblyStatus" && property.value === "finished-assembled") {
    return "Fully assembled";
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
  number: number;
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
          className="absolute bottom-[-18px] left-[18px] top-10 w-px bg-[#dfe2e7] sm:left-[22px] sm:top-12"
        />
      ) : null}
      <span className="relative z-10 grid size-[38px] place-items-center rounded-xl border border-[#dcd9ff] bg-[#eeedff] text-[#5147d9] shadow-sm sm:size-[46px]">
        {icon}
        <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-[#5147d9] text-[8px] font-bold text-white ring-2 ring-[#f7f8fa]">
          {number}
        </span>
      </span>
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="mb-4">
          <h2 className="text-[14px] font-semibold text-[#2b2f34]">{title}</h2>
          <p className="mt-1 text-[11px] leading-5 text-[#5f6672]">{description}</p>
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
        checked ? "bg-[#5147d9]" : "bg-[#cdd1d7]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition",
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
        notice.tone === "success" && "border-[#c8eadb] bg-[#f1fbf6] text-[#176845]",
        notice.tone === "error" && "border-[#efd1d5] bg-[#fff7f8] text-[#a83c49]",
        notice.tone === "info" && "border-[#d9d7ff] bg-[#f7f6ff] text-[#554ec4]",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{notice.message}</span>
    </div>
  );
}

export function StockWorkflowBuilder({ canManage }: { canManage: boolean }) {
  const firstDraft = useMemo(() => templateDraft(), []);
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
          const nextDraft = templateDraft(nextResources[0]?.resourceId ?? "");
          setSelectedId(null);
          setDraft(nextDraft);
          setBaseSignature(payloadSignature(nextDraft));
        }
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Workflows could not be loaded.",
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applyWorkflow],
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
    () => extractIdentifier(sampleScan, draft.extraction),
    [draft.extraction, sampleScan],
  );

  const confirmDraftDiscard = () =>
    !dirty ||
    window.confirm(
      "Discard your unsaved workflow changes? This action cannot be undone.",
    );

  const chooseTemplate = () => {
    if (interactionBusy || !confirmDraftDiscard()) return;
    const nextDraft = templateDraft(resources[0]?.resourceId ?? "");
    setSelectedId(null);
    setDraft(nextDraft);
    setBaseSignature(payloadSignature(nextDraft));
    setConfirmDelete(false);
    setNotice({ tone: "info", message: "Paperless Paper template loaded. Choose its inventory item, then save." });
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
    const validationError = validateDraft(nextDraft);
    if (validationError) {
      setNotice({ tone: "error", message: validationError });
      return null;
    }
    if (!canManage) {
      setNotice({ tone: "error", message: "Viewer access is read-only." });
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
      if (!saved) throw new Error("The workflow service returned an unexpected response.");
      setWorkflows((current) => {
        const exists = current.some((workflow) => workflow.id === saved.id);
        const next = exists
          ? current.map((workflow) => (workflow.id === saved.id ? saved : workflow))
          : [...current, saved];
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      applyWorkflow(saved);
      setNotice({ tone: "success", message });
      return saved;
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The workflow could not be saved.",
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () =>
    void persistDraft(draft, draft.id ? "Workflow updated." : "Workflow created and ready to scan.");

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
      if (!saved) throw new Error("The workflow service returned an unexpected response.");
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
        message: saved.enabled ? "Workflow enabled." : "Workflow paused.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The workflow could not be updated.",
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
        const nextDraft = templateDraft(resources[0]?.resourceId ?? "");
        setSelectedId(null);
        setDraft(nextDraft);
        setBaseSignature(payloadSignature(nextDraft));
        setConfirmDelete(false);
      }
      setNotice({ tone: "success", message: "Workflow deleted." });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The workflow could not be deleted.",
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
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#5f6672]">
            <Workflow className="size-3.5 text-[#5147d9]" aria-hidden="true" />
            Scan automation
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-[#1e2126] sm:text-[32px]">
            Build scan workflows visually.
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#5f6672]">
            Turn a QR code into an identified stock unit with guided inputs and consistent properties—without code.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!canManage ? (
            <Badge tone="neutral" className="h-9 gap-1.5 px-3">
              <Lock className="size-3.5" aria-hidden="true" /> Read only
            </Badge>
          ) : null}
          <Button
            variant="secondary"
            onClick={refreshData}
            disabled={interactionBusy}
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
          {canManage ? (
            <Button onClick={chooseTemplate} disabled={interactionBusy}>
              <Sparkles className="size-4" aria-hidden="true" />
              New from template
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? <NoticeBanner notice={notice} /> : null}

      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="overflow-hidden xl:sticky xl:top-[84px]">
          <div className="flex items-center justify-between border-b border-[#e8eaed] px-4 py-3.5">
            <div>
              <h2 className="text-[13px] font-semibold text-[#30343a]">Workflows</h2>
              <p className="mt-0.5 text-[10px] text-[#5f6672]">
                {workflows.length} configured
              </p>
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={chooseTemplate}
                disabled={interactionBusy}
                className="grid size-8 place-items-center rounded-lg border border-[#dfe2e7] text-[#5f6672] transition hover:border-[#cbc7ff] hover:bg-[#f5f4ff] hover:text-[#5147d9] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Create a workflow from the template"
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
                      active ? "bg-[#eeedff]" : "hover:bg-[#f5f6f8]",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg",
                        workflow.enabled
                          ? "bg-[#e7f7ef] text-[#168258]"
                          : "bg-[#eceef1] text-[#5f6672]",
                      )}
                    >
                      <QrCode className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-[#33373d]">
                        {workflow.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-[#5f6672]">
                        {resource?.name ?? "Inventory item unavailable"} · v{workflow.revision}
                      </span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition",
                        active ? "text-[#5147d9]" : "text-[#5f6672] group-hover:text-[#5f6672]",
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
              title="No saved workflows"
              description={
                canManage
                  ? "The Paperless Paper template is ready in the builder."
                  : "A manager can create the first scan workflow here."
              }
            />
          )}

          <div className="border-t border-[#e8eaed] bg-[#fafbfc] px-4 py-3 text-[10px] leading-4 text-[#5f6672]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#646b76]">
              <ShieldCheck className="size-3.5 text-[#5147d9]" aria-hidden="true" />
              Safe by design
            </span>
            <p className="mt-1">Only configured fields and allowed stock actions run after a scan.</p>
          </div>
        </Card>

        <div className="min-w-0">
          <Card className="mb-4 overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-[#e8eaed] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-[#292d33]">
                    {draft.id ? draft.name || "Untitled workflow" : "New workflow"}
                  </h2>
                  <Badge tone={draft.enabled ? "success" : "neutral"}>
                    {draft.enabled ? "Enabled" : "Paused"}
                  </Badge>
                  {dirty ? <Badge tone="warning">Unsaved changes</Badge> : null}
                  {!draft.id ? <Badge tone="brand">Template</Badge> : null}
                </div>
                <p className="mt-1 text-[11px] text-[#5f6672]">
                  {draft.id ? `Revision ${draft.revision ?? 1}` : "Based on the attached Paperless Paper QR-code use case"}
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
                      {savedWorkflow?.enabled ? "Pause" : "Enable"}
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
                      Delete
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
                    {saving ? "Saving…" : draft.id ? "Update" : "Save workflow"}
                  </Button>
                </div>
              ) : null}
            </div>

            {confirmDelete && savedWorkflow ? (
              <div className="flex flex-col gap-3 border-b border-[#efd1d5] bg-[#fff7f8] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#bd4553]" aria-hidden="true" />
                  <p className="text-[12px] leading-5 text-[#8f3540]">
                    Delete <strong>{savedWorkflow.name}</strong>? Existing stock units are not affected.
                  </p>
                </div>
                <div className="flex gap-2 self-end sm:self-auto">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={interactionBusy}>
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void deleteWorkflow()} disabled={interactionBusy}>
                    {deleting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                    {deleting ? "Deleting…" : "Delete workflow"}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <label className={labelClass}>
                Workflow name
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className={inputClass}
                  placeholder="Assembly scan"
                  disabled={!editable}
                />
              </label>
              <div className="rounded-xl border border-[#e2e4e8] bg-[#fafbfc] px-3.5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold text-[#4e555f]">Workflow enabled</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-[#5f6672]">Available on the Scan screen.</p>
                  </div>
                  <Toggle
                    checked={draft.enabled}
                    onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
                    disabled={!editable || Boolean(draft.id)}
                    label="Workflow enabled"
                  />
                </div>
              </div>
              <label className={cn(labelClass, "sm:col-span-2")}>
                Description
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className={textAreaClass}
                  placeholder="Explain when this workflow should be used."
                  disabled={!editable}
                />
              </label>
            </div>
          </Card>

          {!canManage ? (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-[#e0e2e7] bg-white px-4 py-3.5 text-[12px] leading-5 text-[#5f6672] shadow-[var(--shadow-sm)]">
              <Eye className="mt-0.5 size-4 shrink-0 text-[#5147d9]" aria-hidden="true" />
              You can inspect and locally preview this workflow. Editing, enabling, and deleting require editor access.
            </div>
          ) : null}

          <div className="space-y-[18px] rounded-2xl border border-[#e4e7eb] bg-[#f7f8fa] p-3 sm:p-5">
            <FlowStep
              number={1}
              icon={<QrCode className="size-[18px] sm:size-5" aria-hidden="true" />}
              title="Trigger"
              description="This workflow starts when a camera or handheld scanner reads a QR code."
            >
              <div className="flex flex-col gap-3 rounded-xl border border-[#e4e7eb] bg-[#fafbfc] p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-white text-[#5147d9] shadow-sm ring-1 ring-[#e2e4e8]">
                    <ScanLine className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold text-[#3c4148]">QR code scanned</p>
                    <p className="mt-0.5 text-[10px] text-[#5f6672]">Pass the decoded text into this workflow</p>
                  </div>
                </div>
                <Badge tone="brand">Scan trigger</Badge>
              </div>
            </FlowStep>

            <FlowStep
              number={2}
              icon={<FileKey2 className="size-[18px] sm:size-5" aria-hidden="true" />}
              title="Extract the EPD number"
              description="Choose a safe, predefined rule for turning scanned text into the unit identifier."
            >
              <div className="grid grid-cols-1 gap-1 rounded-xl bg-[#f0f2f4] p-1 sm:grid-cols-3">
                {([
                  ["full", "Full value"],
                  ["url-query", "URL parameter"],
                  ["prefix", "Remove prefix"],
                ] as const).map(([mode, label]) => (
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
                        ? "bg-white text-[#3e3a9f] shadow-sm"
                        : "text-[#5f6672] hover:text-[#383c42] disabled:opacity-65",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {draft.extraction.mode === "url-query" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>
                    Query parameter
                    <input
                      value={draft.extraction.parameter}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, parameter: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder="d"
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    Allowed source origin
                    <input
                      value={draft.extraction.sourceOrigin}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, sourceOrigin: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder="https://paperlesspaper.de"
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    Allowed path
                    <input
                      value={draft.extraction.sourcePath}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, sourcePath: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder="/b"
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    Identifier property key
                    <input
                      value={draft.identifierPropertyKey}
                      onChange={(event) => setDraft((current) => ({ ...current, identifierPropertyKey: event.target.value }))}
                      className={inputClass}
                      placeholder="epdNumber"
                      disabled={!editable}
                    />
                  </label>
                </div>
              ) : draft.extraction.mode === "prefix" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>
                    Prefix to remove
                    <input
                      value={draft.extraction.prefix}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extraction: { ...current.extraction, prefix: event.target.value },
                        }))
                      }
                      className={inputClass}
                      placeholder="EPD-"
                      disabled={!editable}
                    />
                  </label>
                  <label className={labelClass}>
                    Identifier property key
                    <input
                      value={draft.identifierPropertyKey}
                      onChange={(event) => setDraft((current) => ({ ...current, identifierPropertyKey: event.target.value }))}
                      className={inputClass}
                      placeholder="epdNumber"
                      disabled={!editable}
                    />
                  </label>
                </div>
              ) : (
                <label className={cn(labelClass, "mt-4 block max-w-md")}>
                  Identifier property key
                  <input
                    value={draft.identifierPropertyKey}
                    onChange={(event) => setDraft((current) => ({ ...current, identifierPropertyKey: event.target.value }))}
                    className={inputClass}
                    placeholder="epdNumber"
                    disabled={!editable}
                  />
                </label>
              )}
            </FlowStep>

            <FlowStep
              number={3}
              icon={<PackageCheck className="size-[18px] sm:size-5" aria-hidden="true" />}
              title="Choose the target inventory item"
              description="Only inventory configured for serialized stock can receive identified units."
            >
              {resources.length ? (
                <label className={labelClass}>
                  Serialized inventory item
                  <select
                    value={draft.resourceId}
                    onChange={(event) => setDraft((current) => ({ ...current, resourceId: event.target.value }))}
                    className={inputClass}
                    disabled={!editable}
                  >
                    <option value="">Select an inventory item…</option>
                    {resources.map((resource) => (
                      <option key={resource.resourceId} value={resource.resourceId}>
                        {resource.name}{resource.quantity !== undefined ? ` · ${resource.quantity} ${resource.unitName ?? "units"}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-[#eadfc7] bg-[#fffaf1] p-3.5 text-[12px] leading-5 text-[#82561c] sm:flex-row sm:items-center sm:justify-between">
                  <span>No serialized inventory items are available yet.</span>
                  <Link href="/inventory" className="inline-flex items-center gap-1 font-semibold text-[#6b55d4] hover:underline">
                    Configure inventory <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              )}
              {selectedResource ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#dce9e3] bg-[#f4fbf7] p-3">
                  <Check className="size-4 shrink-0 text-[#17845a]" aria-hidden="true" />
                  <p className="text-[11px] text-[#4f675b]">
                    <strong className="text-[#28543f]">{selectedResource.name}</strong> uses serialized tracking.
                  </p>
                </div>
              ) : null}
            </FlowStep>

            <FlowStep
              number={4}
              icon={<Layers3 className="size-[18px] sm:size-5" aria-hidden="true" />}
              title="Ask for scan-time inputs"
              description="Build guided select fields for information that changes from unit to unit."
            >
              <div className="space-y-3">
                {draft.inputFields.map((field, fieldIndex) => (
                  <div key={field.uid} className="rounded-xl border border-[#e1e4e8] bg-[#fafbfc] p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-md bg-[#eeedff] text-[10px] font-bold text-[#5147d9]">
                          {fieldIndex + 1}
                        </span>
                        <p className="text-[12px] font-semibold text-[#42474f]">Select field</p>
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
                          className="grid size-7 place-items-center rounded-lg text-[#9a636a] transition hover:bg-[#fff0f2] hover:text-[#b83243] disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Remove ${field.label || "scan input"}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className={labelClass}>
                        Property key
                        <input
                          value={field.key}
                          onChange={(event) => updateInput(field.uid, { key: event.target.value })}
                          className={inputClass}
                          placeholder="color"
                          disabled={!editable}
                        />
                      </label>
                      <label className={labelClass}>
                        Visible label
                        <input
                          value={field.label}
                          onChange={(event) => updateInput(field.uid, { label: event.target.value })}
                          className={inputClass}
                          placeholder="Farbe"
                          disabled={!editable}
                        />
                      </label>
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-[11px] font-medium text-[#555c67]">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => updateInput(field.uid, { required: event.target.checked })}
                        disabled={!editable}
                        className="size-4 rounded border-[#cfd3da] accent-[#635bff] disabled:cursor-not-allowed"
                      />
                      Required before the scan can be applied
                    </label>

                    <div className="mt-4 border-t border-[#e4e7eb] pt-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#5f6672]">Options</p>
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
                                            label: `Option ${item.options.length + 1}`,
                                            color: "#8b83df",
                                          },
                                        ],
                                      }
                                    : item,
                                ),
                              }))
                            }
                            disabled={!editable}
                            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-[#5d55d7] transition hover:bg-[#eeedff] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus className="size-3" aria-hidden="true" /> Add option
                          </button>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        {field.options.map((option) => (
                          <div key={option.uid} className="grid grid-cols-[36px_minmax(0,1fr)] gap-2 sm:grid-cols-[36px_minmax(0,1fr)_minmax(0,1fr)_30px]">
                            <label className="relative mt-1.5 grid size-9 cursor-pointer place-items-center overflow-hidden rounded-lg border border-[#d8dce1] bg-white shadow-sm" title="Choose swatch color">
                              <span className="size-5 rounded-full border border-black/10" style={{ backgroundColor: option.color ?? "#8b83df" }} />
                              <input
                                type="color"
                                value={option.color ?? "#8b83df"}
                                onChange={(event) => updateOption(field.uid, option.uid, "color", event.target.value)}
                                disabled={!editable}
                                className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                                aria-label={`Color for ${option.label}`}
                              />
                            </label>
                            <label className={labelClass}>
                              <span className="sm:sr-only">Label</span>
                              <input
                                value={option.label}
                                onChange={(event) => updateOption(field.uid, option.uid, "label", event.target.value)}
                                className={cn(inputClass, "mt-1.5")}
                                placeholder="Visible label"
                                disabled={!editable}
                              />
                            </label>
                            <label className={cn(labelClass, "col-start-2 sm:col-start-auto")}>
                              <span className="sm:sr-only">Stored value</span>
                              <input
                                value={option.value}
                                onChange={(event) => updateOption(field.uid, option.uid, "value", event.target.value)}
                                className={cn(inputClass, "mt-0 sm:mt-1.5")}
                                placeholder="Stored value"
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
                                className="col-start-1 row-start-2 grid size-7 place-items-center self-center rounded-lg text-[#9a636a] transition hover:bg-[#fff0f2] hover:text-[#b83243] disabled:cursor-not-allowed disabled:opacity-50 sm:col-start-auto sm:row-start-auto"
                                aria-label={`Remove ${option.label}`}
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
                  <div className="rounded-xl border border-dashed border-[#d6dae0] px-4 py-6 text-center text-[11px] text-[#5f6672]">
                    This workflow has no scan-time questions.
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
                            label: `Property ${current.inputFields.length + 1}`,
                            required: false,
                            options: [
                              { uid: localId("option"), value: "option-1", label: "Option 1", color: "#8b83df" },
                            ],
                          },
                        ],
                      }))
                    }
                    disabled={!editable}
                  >
                    <Plus className="size-3.5" aria-hidden="true" /> Add select field
                  </Button>
                ) : null}
              </div>
            </FlowStep>

            <FlowStep
              number={5}
              icon={<Settings2 className="size-[18px] sm:size-5" aria-hidden="true" />}
              title="Apply stock actions"
              description="Decide what happens to the matched EPD unit and which values are always written."
              last
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#e2e4e8] bg-[#fafbfc] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold text-[#4e555f]">Create missing unit</p>
                      <p className="mt-1 text-[10px] leading-4 text-[#5f6672]">Register this EPD number if it is new.</p>
                    </div>
                    <Toggle
                      checked={draft.createMissingUnit}
                      onChange={(createMissingUnit) => setDraft((current) => ({ ...current, createMissingUnit }))}
                      disabled={!editable}
                      label="Create a missing serialized unit"
                    />
                  </div>
                </div>
                <label className={labelClass}>
                  Lifecycle status after scan
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
                    <option value="">Keep default / current status</option>
                    {unitStatuses.map((status) => (
                      <option key={status} value={status}>{unitStatusLabels[status]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 border-t border-[#e5e7eb] pt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-[#4e555f]">Fixed properties</p>
                    <p className="mt-0.5 text-[10px] text-[#5f6672]">These values are applied on every successful scan.</p>
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
                              label: `Property ${current.fixedProperties.length + 1}`,
                              value: "value",
                            },
                          ],
                        }))
                      }
                      disabled={!editable}
                    >
                      <Plus className="size-3.5" aria-hidden="true" /> Add property
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {draft.fixedProperties.map((property) => (
                    <div key={property.uid} className="rounded-xl border border-[#e1e4e8] bg-[#fafbfc] p-3">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className={labelClass}>
                          Key
                          <input
                            value={property.key}
                            onChange={(event) => updateFixedProperty(property.uid, "key", event.target.value)}
                            className={inputClass}
                            placeholder="assemblyStatus"
                            disabled={!editable}
                          />
                        </label>
                        <label className={labelClass}>
                          Visible label
                          <input
                            value={property.label}
                            onChange={(event) => updateFixedProperty(property.uid, "label", event.target.value)}
                            className={inputClass}
                            placeholder="Assembly status"
                            disabled={!editable}
                          />
                        </label>
                        <label className={labelClass}>
                          Stored value
                          <input
                            value={property.value}
                            onChange={(event) => updateFixedProperty(property.uid, "value", event.target.value)}
                            className={inputClass}
                            placeholder="finished-assembled"
                            disabled={!editable}
                          />
                        </label>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <p className="text-[10px] text-[#5f6672]">
                          Visible as <strong className="text-[#4b5159]">{visiblePropertyValue(property)}</strong>
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
                            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-[#a2404b] transition hover:bg-[#fff0f2] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="size-3" aria-hidden="true" /> Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {draft.fixedProperties.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-[#d6dae0] px-4 py-5 text-center text-[11px] text-[#5f6672]">No fixed properties.</p>
                  ) : null}
                </div>
              </div>
            </FlowStep>
          </div>

          <Card className="mt-4 overflow-hidden">
            <div className="border-b border-[#e8eaed] bg-[linear-gradient(110deg,#faf9ff,#fff)] px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-[#eeedff] text-[#5147d9]">
                  <QrCode className="size-[18px]" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold text-[#30343a]">Local scan preview</h2>
                  <p className="mt-0.5 text-[10px] text-[#5f6672]">Test extraction and selections without changing inventory.</p>
                </div>
                <Badge tone="neutral" className="ml-auto">No write</Badge>
              </div>
            </div>
            <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div>
                <label className={labelClass}>
                  Scanned QR value
                  <textarea
                    value={sampleScan}
                    onChange={(event) => setSampleScan(event.target.value)}
                    className={cn(textAreaClass, "min-h-24 font-mono text-[12px]")}
                    placeholder="Paste a decoded QR value…"
                    disabled={interactionBusy}
                  />
                </label>
                {draft.inputFields.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {draft.inputFields.map((field) => (
                      <label key={field.uid} className={labelClass}>
                        {field.label || field.key || "Input"}{field.required ? " *" : ""}
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

              <div className="rounded-xl border border-[#e1e4e8] bg-[#fafbfc] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5f6672]">Result</p>
                {extractionResult.error ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#fff0f2] p-3 text-[11px] leading-5 text-[#a63e4b]">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {extractionResult.error}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-[#cce9db] bg-[#f0faf5] p-3">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#28543f]">
                      <CheckCircle2 className="size-3.5 text-[#168258]" aria-hidden="true" />
                      {draft.identifierPropertyKey || "Identifier"}
                    </div>
                    <p className="mt-1.5 break-all font-mono text-[13px] font-semibold text-[#24573e]">{extractionResult.value}</p>
                  </div>
                )}

                <div className="mt-4 space-y-2.5 text-[11px]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[#5f6672]">Target</span>
                    <strong className="text-right font-semibold text-[#464c54]">{selectedResource?.name ?? "Not selected"}</strong>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[#5f6672]">Unit</span>
                    <strong className="text-right font-semibold text-[#464c54]">{draft.createMissingUnit ? "Find or create" : "Find existing only"}</strong>
                  </div>
                  {draft.fixedProperties.map((property) => (
                    <div key={property.uid} className="flex items-start justify-between gap-3">
                      <span className="text-[#5f6672]">{property.label || property.key}</span>
                      <strong className="text-right font-semibold text-[#464c54]">{visiblePropertyValue(property)}</strong>
                    </div>
                  ))}
                  {draft.inputFields.map((field) => {
                    const option = field.options.find((item) => item.value === previewInputs[field.uid]);
                    return (
                      <div key={field.uid} className="flex items-center justify-between gap-3">
                        <span className="text-[#5f6672]">{field.label || field.key}</span>
                        <strong className="inline-flex items-center gap-1.5 text-right font-semibold text-[#464c54]">
                          {option?.color ? <span className="size-2.5 rounded-full border border-black/10" style={{ backgroundColor: option.color }} /> : null}
                          {option?.label ?? "Not selected"}
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
