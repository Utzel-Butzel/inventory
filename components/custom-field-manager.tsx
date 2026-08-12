"use client";

import {
  Braces,
  Check,
  Hash,
  ListPlus,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, Card, EmptyState, cn } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import type { CustomFieldDefinition } from "@/lib/custom-field-contract";

type EntityType = CustomFieldDefinition["entityType"];
type FieldType = CustomFieldDefinition["fieldType"];
type ResourceType = CustomFieldDefinition["resourceTypes"][number];
type DefinitionOption = CustomFieldDefinition["options"][number];
type DraftOption = DefinitionOption & { uid: string };

type DefinitionDraft = {
  id: string | null;
  revision: number | null;
  entityType: EntityType;
  key: string;
  label: string;
  fieldType: FieldType;
  description: string;
  placeholder: string;
  required: boolean;
  options: DraftOption[];
  minValue: string;
  maxValue: string;
  step: string;
  resourceTypes: ResourceType[];
  categories: string;
  position: string;
};

const endpoint = "/api/v1/custom-fields";
const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-[#dfe2e7] bg-white px-3 text-[13px] text-[#30343a] outline-none transition placeholder:text-[#5f6672] hover:border-[#cfd3da] focus:border-[#776fff] focus:ring-3 focus:ring-[#635bff]/10 disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#5f6672]";
const textAreaClass = `${inputClass} h-auto min-h-20 resize-y py-2.5 leading-5`;
const labelClass = "block text-[11px] font-semibold text-[#555c67]";

const fieldTypeOptions: Array<{ value: FieldType; label: string }> = [
  { value: "text", label: "Single-line text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / no" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "email", label: "Email address" },
  { value: "url", label: "URL" },
];

const resourceTypeOptions: Array<{ value: ResourceType; label: string }> = [
  { value: "tool", label: "Tools" },
  { value: "object", label: "Objects" },
  { value: "furniture", label: "Furniture" },
  { value: "vehicle", label: "Vehicles" },
  { value: "place", label: "Places" },
  { value: "clothing", label: "Clothing" },
  { value: "person", label: "People" },
  { value: "project", label: "Projects" },
  { value: "other", label: "Other" },
];

type InventoryTypeListResponse = {
  types?: Array<{ key: string; label: string }>;
};

let nextLocalId = 0;
function localId(prefix: string) {
  nextLocalId += 1;
  return `${prefix}-${nextLocalId}`;
}

function emptyDraft(entityType: EntityType): DefinitionDraft {
  return {
    id: null,
    revision: null,
    entityType,
    key: "",
    label: "",
    fieldType: "text",
    description: "",
    placeholder: "",
    required: false,
    options: [],
    minValue: "",
    maxValue: "",
    step: "",
    resourceTypes: [],
    categories: "",
    position: "0",
  };
}

function definitionToDraft(definition: CustomFieldDefinition): DefinitionDraft {
  return {
    id: definition.id,
    revision: definition.revision,
    entityType: definition.entityType,
    key: definition.key,
    label: definition.label,
    fieldType: definition.fieldType,
    description: definition.description,
    placeholder: definition.placeholder,
    required: definition.required,
    options: definition.options.map((option) => ({ ...option, uid: localId("option") })),
    minValue: definition.minValue === null ? "" : String(definition.minValue),
    maxValue: definition.maxValue === null ? "" : String(definition.maxValue),
    step: definition.step === null ? "" : String(definition.step),
    resourceTypes: definition.resourceTypes,
    categories: definition.categories.join(", "),
    position: String(definition.position),
  };
}

function definitionsFromResponse(payload: unknown): CustomFieldDefinition[] {
  if (Array.isArray(payload)) return payload as CustomFieldDefinition[];
  if (!payload || typeof payload !== "object") return [];
  const wrapper = payload as {
    definitions?: unknown;
    customFields?: unknown;
    items?: unknown;
    data?: unknown;
  };
  const candidate =
    wrapper.definitions ?? wrapper.customFields ?? wrapper.items ?? wrapper.data;
  return Array.isArray(candidate) ? (candidate as CustomFieldDefinition[]) : [];
}

function definitionFromResponse(payload: unknown): CustomFieldDefinition | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as { definition?: unknown; customField?: unknown; data?: unknown };
  const candidate = wrapper.definition ?? wrapper.customField ?? wrapper.data ?? payload;
  return candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { id?: unknown }).id === "string"
    ? (candidate as CustomFieldDefinition)
    : null;
}

function parseCategories(value: string) {
  const categories: string[] = [];
  const seen = new Set<string>();
  for (const category of value.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const normalized = category.toLocaleLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    categories.push(category);
  }
  return categories;
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function draftPayload(draft: DefinitionDraft) {
  const selectable = draft.fieldType === "select" || draft.fieldType === "multi_select";
  const numeric = draft.fieldType === "number";
  return {
    entityType: draft.entityType,
    ...(draft.key.trim() ? { key: draft.key.trim() } : {}),
    label: draft.label.trim(),
    fieldType: draft.fieldType,
    description: draft.description.trim(),
    placeholder: draft.placeholder.trim(),
    required: draft.required,
    options: selectable
      ? draft.options.map(({ value, label, color }) => ({
          value: value.trim(),
          label: label.trim(),
          ...(color ? { color } : {}),
        }))
      : [],
    minValue: numeric ? numberOrNull(draft.minValue) : null,
    maxValue: numeric ? numberOrNull(draft.maxValue) : null,
    step: numeric ? numberOrNull(draft.step) : null,
    resourceTypes: draft.resourceTypes,
    categories: parseCategories(draft.categories),
    position: Number.isInteger(Number(draft.position)) ? Number(draft.position) : 0,
  };
}

function validateDraft(draft: DefinitionDraft) {
  if (!draft.label.trim()) return "Give this field a visible label.";
  if (draft.key.trim() && !/^[a-z][a-z0-9_]*$/.test(draft.key.trim())) {
    return "The key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores.";
  }
  if (!Number.isInteger(Number(draft.position)) || Number(draft.position) < 0) {
    return "Position must be a whole number of zero or more.";
  }
  if (
    draft.resourceTypes.some(
      (resourceType) => !/^[a-z][a-z0-9_-]{0,63}$/.test(resourceType),
    )
  ) {
    return "Inventory type keys must start with a lowercase letter and contain only lowercase letters, numbers, underscores, and hyphens.";
  }

  if (draft.fieldType === "number") {
    const min = numberOrNull(draft.minValue);
    const max = numberOrNull(draft.maxValue);
    const step = numberOrNull(draft.step);
    if (draft.minValue.trim() && min === null) return "Minimum must be a valid number.";
    if (draft.maxValue.trim() && max === null) return "Maximum must be a valid number.";
    if (draft.step.trim() && (step === null || step <= 0)) return "Step must be greater than zero.";
    if (min !== null && max !== null && min > max) return "Minimum cannot exceed maximum.";
  }

  if (draft.fieldType === "select" || draft.fieldType === "multi_select") {
    if (!draft.options.length) return "Add at least one select option.";
    const values = new Set<string>();
    for (const option of draft.options) {
      if (!option.label.trim() || !option.value.trim()) {
        return "Every select option needs a label and stored value.";
      }
      if (values.has(option.value.trim())) return "Select option values must be unique.";
      values.add(option.value.trim());
    }
  }

  return null;
}

function fieldTypeLabel(value: FieldType) {
  return fieldTypeOptions.find((option) => option.value === value)?.label ?? value;
}

export function CustomFieldManager() {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [availableResourceTypes, setAvailableResourceTypes] = useState(
    resourceTypeOptions,
  );
  const [entityType, setEntityType] = useState<EntityType>("inventory");
  const [draft, setDraft] = useState<DefinitionDraft>(() => emptyDraft("inventory"));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visibleDefinitions = useMemo(
    () =>
      definitions
        .filter((definition) => definition.entityType === entityType)
        .sort(
          (left, right) =>
            left.position - right.position || left.label.localeCompare(right.label),
        ),
    [definitions, entityType],
  );
  const availableResourceTypeKeys = useMemo(
    () => new Set(availableResourceTypes.map((option) => option.value)),
    [availableResourceTypes],
  );

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [payload, inventoryTypePayload] = await Promise.all([
        fetchJson<unknown>(endpoint, { cache: "no-store" }),
        fetchJson<InventoryTypeListResponse>("/api/v1/inventory-types", {
          cache: "no-store",
        }).catch(() => null),
      ]);
      const next = definitionsFromResponse(payload);
      setDefinitions(next);
      if (inventoryTypePayload?.types?.length) {
        setAvailableResourceTypes(
          inventoryTypePayload.types.map((type) => ({
            value: type.key,
            label: type.label,
          })),
        );
      }
      setDraft((current) => {
        const selected = current.id
          ? next.find((definition) => definition.id === current.id)
          : null;
        if (selected) return definitionToDraft(selected);
        const first = next
          .filter((definition) => definition.entityType === current.entityType)
          .sort(
            (left, right) =>
              left.position - right.position || left.label.localeCompare(right.label),
          )[0];
        return first ? definitionToDraft(first) : emptyDraft(current.entityType);
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Custom fields could not be loaded.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function selectEntity(next: EntityType) {
    setEntityType(next);
    const first = definitions
      .filter((definition) => definition.entityType === next)
      .sort(
        (left, right) =>
          left.position - right.position || left.label.localeCompare(right.label),
      )[0];
    setDraft(first ? definitionToDraft(first) : emptyDraft(next));
    setError(null);
    setNotice(null);
  }

  function startNew() {
    setDraft(emptyDraft(entityType));
    setError(null);
    setNotice(null);
  }

  function updateOption(
    uid: string,
    key: keyof Pick<DraftOption, "value" | "label" | "color">,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      options: current.options.map((option) =>
        option.uid === uid ? { ...option, [key]: value } : option,
      ),
    }));
  }

  async function saveDefinition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const payload = draftPayload(draft);
      const requestPayload = draft.id
        ? {
            label: payload.label,
            fieldType: payload.fieldType,
            description: payload.description,
            placeholder: payload.placeholder,
            required: payload.required,
            options: payload.options,
            minValue: payload.minValue,
            maxValue: payload.maxValue,
            step: payload.step,
            resourceTypes: payload.resourceTypes,
            categories: payload.categories,
            position: payload.position,
            revision: draft.revision,
          }
        : payload;
      const response = await fetchJson<unknown>(draft.id ? `${endpoint}/${draft.id}` : endpoint, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const saved = definitionFromResponse(response);
      if (!saved) {
        await load(true);
        setNotice(draft.id ? "Custom field updated." : "Custom field created.");
        return;
      }
      setDefinitions((current) =>
        [...current.filter((definition) => definition.id !== saved.id), saved].sort(
          (left, right) =>
            left.position - right.position || left.label.localeCompare(right.label),
        ),
      );
      setDraft(definitionToDraft(saved));
      setNotice(draft.id ? "Custom field updated." : "Custom field created.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Custom field could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDefinition() {
    if (!draft.id) return;
    if (
      !window.confirm(
        `Delete “${draft.label}”? Existing stored values for this key may no longer be visible.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson<unknown>(`${endpoint}/${draft.id}`, { method: "DELETE" });
      const remaining = definitions.filter((definition) => definition.id !== draft.id);
      setDefinitions(remaining);
      const first = remaining
        .filter((definition) => definition.entityType === entityType)
        .sort(
          (left, right) =>
            left.position - right.position || left.label.localeCompare(right.label),
        )[0];
      setDraft(first ? definitionToDraft(first) : emptyDraft(entityType));
      setNotice("Custom field deleted.");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Custom field could not be deleted.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section aria-labelledby="custom-fields-heading">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-[#eeedff] text-[#5147d9]">
              <Braces className="size-[18px]" aria-hidden="true" />
            </span>
            <div>
              <h2 id="custom-fields-heading" className="text-lg font-semibold tracking-[-0.02em] text-[#24272c]">
                Custom fields
              </h2>
              <p className="mt-0.5 text-[12px] text-[#5f6672]">
                Configure typed information by inventory type or category.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            aria-label="Refresh custom fields"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
          <Button size="sm" onClick={startNew} disabled={loading}>
            <Plus className="size-3.5" aria-hidden="true" /> New field
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-[#efd1d5] bg-[#fff7f8] px-3.5 py-3 text-[12px] leading-5 text-[#a83c49]">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-[#c8eadb] bg-[#f1fbf6] px-3.5 py-3 text-[12px] leading-5 text-[#176845]">
          <span className="flex items-center gap-2"><Check className="size-4" aria-hidden="true" /> {notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-[#e1e4e8] bg-white p-1 shadow-[var(--shadow-sm)]">
        {(
          [
            { value: "inventory" as const, label: "Inventory items", icon: Package },
            { value: "stock_unit" as const, label: "Stock units", icon: Warehouse },
          ] satisfies Array<{ value: EntityType; label: string; icon: typeof Package }>
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => selectEntity(tab.value)}
              className={cn(
                "flex h-10 items-center justify-center gap-2 rounded-lg text-[12px] font-semibold transition",
                entityType === tab.value
                  ? "bg-[#eeedff] text-[#5147d9] shadow-sm"
                  : "text-[#5f6672] hover:bg-[#f5f6f8] hover:text-[#34383e]",
              )}
            >
              <Icon className="size-4" aria-hidden="true" /> {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Card className="grid min-h-72 place-items-center text-[#5f6672]">
          <div className="text-center">
            <LoaderCircle className="mx-auto size-5 animate-spin" aria-hidden="true" />
            <p className="mt-2 text-[12px]">Loading custom fields…</p>
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
          <Card className="overflow-hidden xl:sticky xl:top-[88px]">
            <div className="border-b border-[#e8eaed] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#5f6672]">
                {visibleDefinitions.length} {visibleDefinitions.length === 1 ? "field" : "fields"}
              </p>
            </div>
            {visibleDefinitions.length ? (
              <div className="divide-y divide-[#eceef1]">
                {visibleDefinitions.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => setDraft(definitionToDraft(definition))}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3.5 text-left transition",
                      draft.id === definition.id
                        ? "bg-[#f3f2ff]"
                        : "bg-white hover:bg-[#fafbfc]",
                    )}
                  >
                    <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", draft.id === definition.id ? "bg-[#dedbff] text-[#5b52df]" : "bg-[#f0f2f4] text-[#5f6672]")}>
                      {definition.fieldType === "number" ? <Hash className="size-3.5" /> : <ListPlus className="size-3.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-[#34383e]">{definition.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-[#5f6672]">{definition.key} · {fieldTypeLabel(definition.fieldType)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                className="min-h-60"
                icon={<Braces className="size-5" aria-hidden="true" />}
                title="No custom fields yet"
                description={`Create the first field for ${entityType === "inventory" ? "inventory items" : "serialized stock units"}.`}
                action={<Button size="sm" onClick={startNew}><Plus className="size-3.5" /> Add field</Button>}
              />
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-[#e8eaed] px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-sm font-semibold text-[#292c31]">
                  {draft.id ? `Edit ${draft.label}` : "Create custom field"}
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-[#5f6672]">
                  Keys are stable API identifiers. Labels and field settings can be changed later.
                </p>
              </div>
              {draft.id ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void deleteDefinition()}
                  disabled={deleting || saving}
                >
                  {deleting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  Delete
                </Button>
              ) : null}
            </div>

            <form onSubmit={saveDefinition} className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Visible label
                  <input
                    value={draft.label}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    required
                    maxLength={120}
                    placeholder="Color"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  API key <span className="font-normal text-[#5f6672]">· generated when empty</span>
                  <input
                    value={draft.key}
                    onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                    disabled={Boolean(draft.id)}
                    maxLength={64}
                    placeholder="color"
                    className={`${inputClass} font-mono`}
                  />
                </label>
                <label className={labelClass}>
                  Field type
                  <select
                    value={draft.fieldType}
                    onChange={(event) => setDraft((current) => ({ ...current, fieldType: event.target.value as FieldType }))}
                    className={inputClass}
                  >
                    {fieldTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className={labelClass}>
                  Position
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={draft.position}
                    onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className={`${labelClass} sm:col-span-2`}>
                  Description <span className="font-normal text-[#5f6672]">· optional helper text</span>
                  <textarea
                    rows={3}
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    maxLength={5000}
                    placeholder="Shown underneath the input to explain what belongs here."
                    className={textAreaClass}
                  />
                </label>
                <label className={labelClass}>
                  Placeholder <span className="font-normal text-[#5f6672]">· optional</span>
                  <input
                    value={draft.placeholder}
                    onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))}
                    maxLength={240}
                    placeholder="e.g. Ocean blue"
                    className={inputClass}
                  />
                </label>
                <label className="flex items-center gap-3 self-end rounded-xl border border-[#e1e4e8] bg-[#fafbfc] px-3.5 py-3 text-[12px] font-medium text-[#555c67]">
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(event) => setDraft((current) => ({ ...current, required: event.target.checked }))}
                    className="size-4 accent-[#635bff]"
                  />
                  Required for matching records
                </label>
              </div>

              {draft.fieldType === "number" ? (
                <div className="rounded-xl border border-[#e1e4e8] bg-[#fafbfc] p-4">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-[#5f6672]">Number constraints</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["minValue", "maxValue", "step"] as const).map((key) => (
                      <label key={key} className={labelClass}>
                        {key === "minValue" ? "Minimum" : key === "maxValue" ? "Maximum" : "Step"}
                        <input
                          type="number"
                          step="any"
                          value={draft[key]}
                          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {draft.fieldType === "select" || draft.fieldType === "multi_select" ? (
                <div className="rounded-xl border border-[#e1e4e8] bg-[#fafbfc] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#5f6672]">Options</p>
                      <p className="mt-1 text-[10px] text-[#5f6672]">Labels are shown to people; values are stored in the API.</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        options: [...current.options, { uid: localId("option"), label: `Option ${current.options.length + 1}`, value: `option_${current.options.length + 1}`, color: "#8b83df" }],
                      }))}
                    >
                      <Plus className="size-3.5" /> Add option
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {draft.options.map((option) => (
                      <div key={option.uid} className="grid grid-cols-[38px_minmax(0,1fr)_30px] gap-2 sm:grid-cols-[38px_minmax(0,1fr)_minmax(0,1fr)_30px]">
                        <label className="relative mt-1.5 grid size-9 cursor-pointer place-items-center overflow-hidden rounded-lg border border-[#d8dce1] bg-white shadow-sm" title="Choose option color">
                          <span className="size-5 rounded-full border border-black/10" style={{ backgroundColor: option.color || "#8b83df" }} />
                          <input type="color" value={option.color || "#8b83df"} onChange={(event) => updateOption(option.uid, "color", event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Color for ${option.label}`} />
                        </label>
                        <label className={labelClass}>
                          <span className="sr-only">Visible label</span>
                          <input value={option.label} onChange={(event) => updateOption(option.uid, "label", event.target.value)} placeholder="Visible label" className={inputClass} />
                        </label>
                        <label className={`${labelClass} col-start-2 sm:col-start-auto`}>
                          <span className="sr-only">Stored value</span>
                          <input value={option.value} onChange={(event) => updateOption(option.uid, "value", event.target.value)} placeholder="stored_value" className={inputClass} />
                        </label>
                        <button
                          type="button"
                          onClick={() => setDraft((current) => ({ ...current, options: current.options.filter((item) => item.uid !== option.uid) }))}
                          className="col-start-3 row-start-1 mt-2 grid size-7 place-items-center rounded-lg text-[#9a636a] transition hover:bg-[#fff0f2] hover:text-[#b83243] sm:col-start-4"
                          aria-label={`Remove ${option.label}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="rounded-xl border border-[#e1e4e8] bg-[#fafbfc] p-4">
                <div className="mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[#5f6672]">Applies to</p>
                  <p className="mt-1 text-[10px] leading-4 text-[#5f6672]">Leave both filters empty to show this field everywhere. When both are set, records must match both.</p>
                </div>
                <span className={labelClass}>Inventory types</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, resourceTypes: [] }))}
                    className={cn("h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition", !draft.resourceTypes.length ? "border-[#cfcaff] bg-[#eeedff] text-[#554ddb]" : "border-[#dfe2e7] bg-white text-[#5f6672] hover:bg-[#f5f6f8]")}
                  >
                    All types
                  </button>
                  {availableResourceTypes.map((option) => {
                    const active = draft.resourceTypes.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setDraft((current) => ({
                          ...current,
                          resourceTypes: active
                            ? current.resourceTypes.filter((value) => value !== option.value)
                            : [...current.resourceTypes, option.value],
                        }))}
                        className={cn("h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition", active ? "border-[#cfcaff] bg-[#eeedff] text-[#554ddb]" : "border-[#dfe2e7] bg-white text-[#5f6672] hover:bg-[#f5f6f8]")}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <label className={`${labelClass} mt-4`}>
                  Additional inventory type keys{" "}
                  <span className="font-normal text-[#5f6672]">· comma separated, optional</span>
                  <input
                    value={draft.resourceTypes
                      .filter((resourceType) => !availableResourceTypeKeys.has(resourceType))
                      .join(", ")}
                    onChange={(event) => {
                      const additionalTypes = parseCategories(event.target.value);
                      setDraft((current) => ({
                        ...current,
                        resourceTypes: [
                          ...current.resourceTypes.filter((resourceType) =>
                            availableResourceTypeKeys.has(resourceType),
                          ),
                          ...additionalTypes,
                        ],
                      }));
                    }}
                    placeholder="machine, safety_equipment"
                    className={`${inputClass} font-mono`}
                  />
                </label>
                <label className={`${labelClass} mt-4`}>
                  Categories <span className="font-normal text-[#5f6672]">· comma separated, optional</span>
                  <input
                    value={draft.categories}
                    onChange={(event) => setDraft((current) => ({ ...current, categories: event.target.value }))}
                    placeholder="Workshop, Production"
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-[#eceef1] pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[10px] leading-4 text-[#5f6672]">
                  {draft.id ? "The API key remains unchanged when editing." : "Leave the key empty to generate it from the label."}
                </p>
                <Button type="submit" disabled={saving || deleting}>
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {saving ? "Saving…" : draft.id ? "Save field" : "Create field"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </section>
  );
}
