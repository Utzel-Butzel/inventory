"use client";

import {
  Braces,
  Check,
  Hash,
  ListPlus,
  Link2,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useT } from "next-i18next/client";
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
  referenceEntityType: EntityType;
  referenceMultiple: boolean;
  referenceResourceTypes: ResourceType[];
  referenceCategories: string;
  referenceStatuses: string;
  position: string;
};

const endpoint = "/api/v1/custom-fields";
const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const textAreaClass = `${inputClass} h-auto min-h-20 resize-y py-2.5 leading-5`;
const labelClass = "block text-[11px] font-semibold text-muted-strong";

const fieldTypeOptions: Array<{ value: FieldType }> = [
  { value: "text" },
  { value: "textarea" },
  { value: "number" },
  { value: "boolean" },
  { value: "date" },
  { value: "datetime" },
  { value: "select" },
  { value: "multi_select" },
  { value: "reference" },
  { value: "email" },
  { value: "url" },
];

const resourceTypeOptions: Array<{ value: ResourceType; label?: string }> = [
  { value: "tool" },
  { value: "object" },
  { value: "furniture" },
  { value: "vehicle" },
  { value: "place" },
  { value: "clothing" },
  { value: "person" },
  { value: "project" },
  { value: "other" },
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
    referenceEntityType: "inventory",
    referenceMultiple: false,
    referenceResourceTypes: [],
    referenceCategories: "",
    referenceStatuses: "",
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
    referenceEntityType: definition.referenceEntityType ?? "inventory",
    referenceMultiple: definition.referenceMultiple,
    referenceResourceTypes: definition.referenceResourceTypes,
    referenceCategories: definition.referenceCategories.join(", "),
    referenceStatuses: definition.referenceStatuses.join(", "),
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
  const reference = draft.fieldType === "reference";
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
    referenceEntityType: reference ? draft.referenceEntityType : null,
    referenceMultiple: reference ? draft.referenceMultiple : false,
    referenceResourceTypes: reference ? draft.referenceResourceTypes : [],
    referenceCategories: reference ? parseCategories(draft.referenceCategories) : [],
    referenceStatuses: reference ? parseCategories(draft.referenceStatuses) : [],
    position: Number.isInteger(Number(draft.position)) ? Number(draft.position) : 0,
  };
}

function validateDraft(draft: DefinitionDraft, t: TFunction) {
  if (!draft.label.trim()) return t("settings:customFields.validation.labelRequired");
  if (draft.key.trim() && !/^[a-z][a-z0-9_]*$/.test(draft.key.trim())) {
    return t("settings:customFields.validation.keyFormat");
  }
  if (!Number.isInteger(Number(draft.position)) || Number(draft.position) < 0) {
    return t("settings:customFields.validation.position");
  }
  if (
    draft.resourceTypes.some(
      (resourceType) => !/^[a-z][a-z0-9_-]{0,63}$/.test(resourceType),
    )
  ) {
    return t("settings:customFields.validation.inventoryTypeKeys");
  }

  if (draft.fieldType === "number") {
    const min = numberOrNull(draft.minValue);
    const max = numberOrNull(draft.maxValue);
    const step = numberOrNull(draft.step);
    if (draft.minValue.trim() && min === null) {
      return t("settings:customFields.validation.minimum");
    }
    if (draft.maxValue.trim() && max === null) {
      return t("settings:customFields.validation.maximum");
    }
    if (draft.step.trim() && (step === null || step <= 0)) {
      return t("settings:customFields.validation.step");
    }
    if (min !== null && max !== null && min > max) {
      return t("settings:customFields.validation.minimumMaximum");
    }
  }

  if (draft.fieldType === "select" || draft.fieldType === "multi_select") {
    if (!draft.options.length) return t("settings:customFields.validation.optionRequired");
    const values = new Set<string>();
    for (const option of draft.options) {
      if (!option.label.trim() || !option.value.trim()) {
        return t("settings:customFields.validation.optionValues");
      }
      if (values.has(option.value.trim())) {
        return t("settings:customFields.validation.optionUnique");
      }
      values.add(option.value.trim());
    }
  }

  if (
    draft.fieldType === "reference" &&
    draft.referenceResourceTypes.some(
      (resourceType) => !/^[a-z][a-z0-9_-]{0,63}$/.test(resourceType),
    )
  ) {
    return t("settings:customFields.validation.referenceTypeKeys");
  }

  return null;
}

function fieldTypeLabel(value: FieldType, t: TFunction) {
  return t(`settings:customFields.fieldTypes.${value}`, { defaultValue: value });
}

export function CustomFieldManager() {
  const { t } = useT(["settings", "common"]);
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
        loadError instanceof Error
          ? loadError.message
          : t("settings:customFields.errors.load"),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

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
    const validationError = validateDraft(draft, t);
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
            referenceEntityType: payload.referenceEntityType,
            referenceMultiple: payload.referenceMultiple,
            referenceResourceTypes: payload.referenceResourceTypes,
            referenceCategories: payload.referenceCategories,
            referenceStatuses: payload.referenceStatuses,
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
        setNotice(
          draft.id
            ? t("settings:customFields.notices.updated")
            : t("settings:customFields.notices.created"),
        );
        return;
      }
      setDefinitions((current) =>
        [...current.filter((definition) => definition.id !== saved.id), saved].sort(
          (left, right) =>
            left.position - right.position || left.label.localeCompare(right.label),
        ),
      );
      setDraft(definitionToDraft(saved));
      setNotice(
        draft.id
          ? t("settings:customFields.notices.updated")
          : t("settings:customFields.notices.created"),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("settings:customFields.errors.save"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteDefinition() {
    if (!draft.id) return;
    if (
      !window.confirm(
        t("settings:customFields.deleteConfirm", { label: draft.label }),
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
      setNotice(t("settings:customFields.notices.deleted"));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("settings:customFields.errors.delete"),
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
            <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
              <Braces className="size-[18px]" aria-hidden="true" />
            </span>
            <div>
              <h2 id="custom-fields-heading" className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                {t("settings:customFields.title")}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">
                {t("settings:customFields.description")}
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
            aria-label={t("settings:customFields.refresh")}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />
            {t("common:actions.refresh")}
          </Button>
          <Button size="sm" onClick={startNew} disabled={loading}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("settings:customFields.newField")}
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-danger-border bg-danger-soft px-3.5 py-3 text-[12px] leading-5 text-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={t("settings:customFields.dismissError")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-success-border bg-success-soft px-3.5 py-3 text-[12px] leading-5 text-success">
          <span className="flex items-center gap-2"><Check className="size-4" aria-hidden="true" /> {notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t("settings:customFields.dismissMessage")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-sm)]">
        {(
          [
            {
              value: "inventory" as const,
              label: t("settings:customFields.entities.inventory"),
              icon: Package,
            },
            {
              value: "stock_unit" as const,
              label: t("settings:customFields.entities.stockUnit"),
              icon: Warehouse,
            },
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
                  ? "bg-brand-soft text-brand shadow-sm"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" /> {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Card className="grid min-h-72 place-items-center text-muted">
          <div className="text-center">
            <LoaderCircle className="mx-auto size-5 animate-spin" aria-hidden="true" />
            <p className="mt-2 text-[12px]">
              {t("settings:customFields.loading")}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
          <Card className="overflow-hidden xl:sticky xl:top-[88px]">
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                {t("settings:customFields.fieldCount", {
                  count: visibleDefinitions.length,
                })}
              </p>
            </div>
            {visibleDefinitions.length ? (
              <div className="divide-y divide-border">
                {visibleDefinitions.map((definition) => (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => setDraft(definitionToDraft(definition))}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3.5 text-left transition",
                      draft.id === definition.id
                        ? "bg-brand-soft"
                        : "bg-surface hover:bg-surface-subtle",
                    )}
                  >
                    <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", draft.id === definition.id ? "bg-brand-soft text-brand" : "bg-surface-muted text-muted")}>
                      {definition.fieldType === "number" ? (
                        <Hash className="size-3.5" />
                      ) : definition.fieldType === "reference" ? (
                        <Link2 className="size-3.5" />
                      ) : (
                        <ListPlus className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-foreground">{definition.label}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted">
                        {definition.key} · {fieldTypeLabel(definition.fieldType, t)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                className="min-h-60"
                icon={<Braces className="size-5" aria-hidden="true" />}
                title={t("settings:customFields.emptyTitle")}
                description={t("settings:customFields.emptyDescription", {
                  target:
                    entityType === "inventory"
                      ? t("settings:customFields.entities.inventoryLower")
                      : t("settings:customFields.entities.serializedStockUnitsLower"),
                })}
                action={
                  <Button size="sm" onClick={startNew}>
                    <Plus className="size-3.5" />
                    {t("settings:customFields.addField")}
                  </Button>
                }
              />
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {draft.id
                    ? t("settings:customFields.editTitle", { label: draft.label })
                    : t("settings:customFields.createTitle")}
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  {t("settings:customFields.formDescription")}
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
                  {t("common:actions.delete")}
                </Button>
              ) : null}
            </div>

            <form onSubmit={saveDefinition} className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  {t("settings:customFields.visibleLabel")}
                  <input
                    value={draft.label}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    required
                    maxLength={120}
                    placeholder={t("settings:customFields.visibleLabelPlaceholder")}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("settings:customFields.apiKey")} {" "}
                  <span className="font-normal text-muted">
                    · {t("settings:customFields.generatedWhenEmpty")}
                  </span>
                  <input
                    value={draft.key}
                    onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                    disabled={Boolean(draft.id)}
                    maxLength={64}
                    placeholder={t("settings:customFields.apiKeyPlaceholder")}
                    className={`${inputClass} font-mono`}
                  />
                </label>
                <label className={labelClass}>
                  {t("settings:customFields.fieldType")}
                  <select
                    value={draft.fieldType}
                    onChange={(event) => setDraft((current) => ({ ...current, fieldType: event.target.value as FieldType }))}
                    className={inputClass}
                  >
                    {fieldTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {fieldTypeLabel(option.value, t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  {t("settings:customFields.position")}
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
                  {t("settings:customFields.fieldDescription")} {" "}
                  <span className="font-normal text-muted">
                    · {t("settings:customFields.optionalHelperText")}
                  </span>
                  <textarea
                    rows={3}
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    maxLength={5000}
                    placeholder={t("settings:customFields.descriptionPlaceholder")}
                    className={textAreaClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("settings:customFields.placeholder")} {" "}
                  <span className="font-normal text-muted">
                    · {t("settings:customFields.optional")}
                  </span>
                  <input
                    value={draft.placeholder}
                    onChange={(event) => setDraft((current) => ({ ...current, placeholder: event.target.value }))}
                    maxLength={240}
                    placeholder={t("settings:customFields.placeholderExample")}
                    className={inputClass}
                  />
                </label>
                <label className="flex items-center gap-3 self-end rounded-xl border border-border bg-surface-subtle px-3.5 py-3 text-[12px] font-medium text-muted-strong">
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(event) => setDraft((current) => ({ ...current, required: event.target.checked }))}
                    className="size-4 accent-brand-solid"
                  />
                  {t("settings:customFields.required")}
                </label>
              </div>

              {draft.fieldType === "number" ? (
                <div className="rounded-xl border border-border bg-surface-subtle p-4">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                    {t("settings:customFields.numberConstraints")}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(["minValue", "maxValue", "step"] as const).map((key) => (
                      <label key={key} className={labelClass}>
                        {key === "minValue"
                          ? t("settings:customFields.minimum")
                          : key === "maxValue"
                            ? t("settings:customFields.maximum")
                            : t("settings:customFields.step")}
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
                <div className="rounded-xl border border-border bg-surface-subtle p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                        {t("settings:customFields.options")}
                      </p>
                      <p className="mt-1 text-[10px] text-muted">
                        {t("settings:customFields.optionsDescription")}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        options: [
                          ...current.options,
                          {
                            uid: localId("option"),
                            label: t("settings:customFields.defaultOption", {
                              number: current.options.length + 1,
                            }),
                            value: `option_${current.options.length + 1}`,
                            color: "#8b83df",
                          },
                        ],
                      }))}
                    >
                      <Plus className="size-3.5" />
                      {t("settings:customFields.addOption")}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {draft.options.map((option) => (
                      <div key={option.uid} className="grid grid-cols-[38px_minmax(0,1fr)_30px] gap-2 sm:grid-cols-[38px_minmax(0,1fr)_minmax(0,1fr)_30px]">
                        <label
                          className="relative mt-1.5 grid size-9 cursor-pointer place-items-center overflow-hidden rounded-lg border border-border bg-surface shadow-sm"
                          title={t("settings:customFields.chooseOptionColor")}
                        >
                          <span className="size-5 rounded-full border border-border-strong" style={{ backgroundColor: option.color || "#8b83df" }} />
                          <input type="color" value={option.color || "#8b83df"} onChange={(event) => updateOption(option.uid, "color", event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t("settings:customFields.colorFor", { label: option.label })} />
                        </label>
                        <label className={labelClass}>
                          <span className="sr-only">
                            {t("settings:customFields.visibleLabel")}
                          </span>
                          <input value={option.label} onChange={(event) => updateOption(option.uid, "label", event.target.value)} placeholder={t("settings:customFields.visibleLabel")} className={inputClass} />
                        </label>
                        <label className={`${labelClass} col-start-2 sm:col-start-auto`}>
                          <span className="sr-only">
                            {t("settings:customFields.storedValue")}
                          </span>
                          <input value={option.value} onChange={(event) => updateOption(option.uid, "value", event.target.value)} placeholder={t("settings:customFields.storedValuePlaceholder")} className={inputClass} />
                        </label>
                        <button
                          type="button"
                          onClick={() => setDraft((current) => ({ ...current, options: current.options.filter((item) => item.uid !== option.uid) }))}
                          className="col-start-3 row-start-1 mt-2 grid size-7 place-items-center rounded-lg text-danger transition hover:bg-danger-soft hover:text-danger sm:col-start-4"
                          aria-label={t("settings:customFields.removeOption", {
                            label: option.label,
                          })}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {draft.fieldType === "reference" ? (
                <div className="rounded-xl border border-brand-border bg-brand-soft p-4">
                  <div className="mb-4 flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                      <Link2 className="size-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-brand">
                        {t("settings:customFields.reference.title")}
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-muted">
                        {t("settings:customFields.reference.description")}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className={labelClass}>
                      {t("settings:customFields.reference.targetCollection")}
                      <select
                        value={draft.referenceEntityType}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            referenceEntityType: event.target.value as EntityType,
                            referenceStatuses: "",
                          }))
                        }
                        className={inputClass}
                      >
                        <option value="inventory">
                          {t("settings:customFields.entities.inventory")}
                        </option>
                        <option value="stock_unit">
                          {t("settings:customFields.entities.serializedStockUnits")}
                        </option>
                      </select>
                    </label>
                    <label className="mt-[17px] flex h-10 items-center gap-3 rounded-xl border border-brand-border bg-surface px-3.5 text-[12px] font-medium text-muted-strong">
                      <input
                        type="checkbox"
                        checked={draft.referenceMultiple}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            referenceMultiple: event.target.checked,
                          }))
                        }
                        className="size-4 accent-brand-solid"
                      />
                      {t("settings:customFields.reference.allowMultiple")}
                    </label>
                  </div>

                  <div className="mt-4">
                    <span className={labelClass}>
                      {t("settings:customFields.reference.targetInventoryTypes")}
                    </span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            referenceResourceTypes: [],
                          }))
                        }
                        className={cn(
                          "h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition",
                          !draft.referenceResourceTypes.length
                            ? "border-brand-border bg-brand-soft text-brand"
                            : "border-border bg-surface text-muted hover:bg-surface-hover",
                        )}
                      >
                        {t("settings:customFields.allTypes")}
                      </button>
                      {availableResourceTypes.map((option) => {
                        const active = draft.referenceResourceTypes.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              setDraft((current) => ({
                                ...current,
                                referenceResourceTypes: active
                                  ? current.referenceResourceTypes.filter(
                                      (value) => value !== option.value,
                                    )
                                  : [...current.referenceResourceTypes, option.value],
                              }))
                            }
                            className={cn(
                              "h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition",
                              active
                                ? "border-brand-border bg-brand-soft text-brand"
                                : "border-border bg-surface text-muted hover:bg-surface-hover",
                            )}
                          >
                            {option.label ??
                              t(`settings:customFields.resourceTypes.${option.value}`, {
                                defaultValue: option.value,
                              })}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className={labelClass}>
                      {t("settings:customFields.reference.targetCategories")} {" "}
                      <span className="font-normal text-muted">
                        · {t("settings:customFields.commaSeparated")}
                      </span>
                      <input
                        value={draft.referenceCategories}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            referenceCategories: event.target.value,
                          }))
                        }
                        placeholder={t("settings:customFields.reference.categoryPlaceholder")}
                        className={inputClass}
                      />
                    </label>
                    <label className={labelClass}>
                      {t("settings:customFields.reference.allowedStatuses")} {" "}
                      <span className="font-normal text-muted">
                        · {t("settings:customFields.commaSeparated")}
                      </span>
                      <input
                        value={draft.referenceStatuses}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            referenceStatuses: event.target.value,
                          }))
                        }
                        placeholder={
                          draft.referenceEntityType === "stock_unit"
                            ? t("settings:customFields.reference.stockStatusPlaceholder")
                            : t("settings:customFields.reference.inventoryStatusPlaceholder")
                        }
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <label className={`${labelClass} mt-4`}>
                    {t("settings:customFields.reference.additionalTargetTypes")} {" "}
                    <span className="font-normal text-muted">
                      · {t("settings:customFields.commaSeparated")}
                    </span>
                    <input
                      value={draft.referenceResourceTypes
                        .filter((resourceType) => !availableResourceTypeKeys.has(resourceType))
                        .join(", ")}
                      onChange={(event) => {
                        const additionalTypes = parseCategories(event.target.value);
                        setDraft((current) => ({
                          ...current,
                          referenceResourceTypes: [
                            ...current.referenceResourceTypes.filter((resourceType) =>
                              availableResourceTypeKeys.has(resourceType),
                            ),
                            ...additionalTypes,
                          ],
                        }));
                      }}
                      placeholder={t("settings:customFields.reference.additionalTargetTypesPlaceholder")}
                      className={`${inputClass} font-mono`}
                    />
                  </label>
                </div>
              ) : null}

              <div className="rounded-xl border border-border bg-surface-subtle p-4">
                <div className="mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                    {t("settings:customFields.applies.title")}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted">
                    {t("settings:customFields.applies.description")}
                  </p>
                </div>
                <span className={labelClass}>
                  {t("settings:customFields.inventoryTypes")}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, resourceTypes: [] }))}
                    className={cn("h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition", !draft.resourceTypes.length ? "border-brand-border bg-brand-soft text-brand" : "border-border bg-surface text-muted hover:bg-surface-hover")}
                  >
                    {t("settings:customFields.allTypes")}
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
                        className={cn("h-8 rounded-lg border px-2.5 text-[10px] font-semibold transition", active ? "border-brand-border bg-brand-soft text-brand" : "border-border bg-surface text-muted hover:bg-surface-hover")}
                      >
                        {option.label ??
                          t(`settings:customFields.resourceTypes.${option.value}`, {
                            defaultValue: option.value,
                          })}
                      </button>
                    );
                  })}
                </div>
                <label className={`${labelClass} mt-4`}>
                  {t("settings:customFields.additionalInventoryTypes")} {" "}
                  <span className="font-normal text-muted">
                    · {t("settings:customFields.commaSeparatedOptional")}
                  </span>
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
                    placeholder={t("settings:customFields.additionalInventoryTypesPlaceholder")}
                    className={`${inputClass} font-mono`}
                  />
                </label>
                <label className={`${labelClass} mt-4`}>
                  {t("settings:customFields.categories")} {" "}
                  <span className="font-normal text-muted">
                    · {t("settings:customFields.commaSeparatedOptional")}
                  </span>
                  <input
                    value={draft.categories}
                    onChange={(event) => setDraft((current) => ({ ...current, categories: event.target.value }))}
                    placeholder={t("settings:customFields.categoriesPlaceholder")}
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[10px] leading-4 text-muted">
                  {draft.id
                    ? t("settings:customFields.editKeyHint")
                    : t("settings:customFields.createKeyHint")}
                </p>
                <Button type="submit" disabled={saving || deleting}>
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {saving
                    ? t("common:actions.saving")
                    : draft.id
                      ? t("settings:customFields.saveField")
                      : t("settings:customFields.createField")}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </section>
  );
}
