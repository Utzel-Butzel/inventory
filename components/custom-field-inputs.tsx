"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useT } from "next-i18next/client";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import type {
  CustomFieldDefinition,
  CustomFieldReferenceOption,
  CustomFieldValue,
  CustomFieldValues,
} from "@/lib/custom-field-contract";

export type CustomFieldInputsProps = {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  onChange: (values: CustomFieldValues) => void;
  disabled?: boolean;
  className?: string;
  emptyState?: ReactNode;
};

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted";
const labelClass = "block text-xs font-semibold text-muted-strong";

type ReferenceOptionsResponse = { options: CustomFieldReferenceOption[] };

const referenceOptionCache = new Map<string, CustomFieldReferenceOption>();
type ReferenceResolutionRequest = {
  ids: string[];
  resolve: (options: CustomFieldReferenceOption[]) => void;
  reject: (error: unknown) => void;
};
const pendingReferenceResolutions = new Map<
  string,
  { ids: Set<string>; requests: ReferenceResolutionRequest[]; timer: number }
>();

function referenceCacheKey(definitionId: string, optionId: string) {
  return `${definitionId}:${optionId}`;
}

function cacheReferenceOptions(
  definitionId: string,
  options: CustomFieldReferenceOption[],
) {
  for (const option of options) {
    referenceOptionCache.set(referenceCacheKey(definitionId, option.id), option);
  }
}

async function fetchReferenceOptions(
  definitionId: string,
  query: string,
  selectedIds: string[],
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set("q", query.trim());
  for (const id of selectedIds) parameters.append("selected", id);
  const response = await fetchJson<ReferenceOptionsResponse>(
    `/api/v1/custom-fields/${definitionId}/options?${parameters.toString()}`,
    { cache: "no-store", signal },
  );
  cacheReferenceOptions(definitionId, response.options);
  return response.options;
}

function resolveReferenceOptions(definitionId: string, ids: string[]) {
  const cached = ids
    .map((id) => referenceOptionCache.get(referenceCacheKey(definitionId, id)))
    .filter((option): option is CustomFieldReferenceOption => Boolean(option));
  if (cached.length === ids.length) return Promise.resolve(cached);

  return new Promise<CustomFieldReferenceOption[]>((resolve, reject) => {
    let batch = pendingReferenceResolutions.get(definitionId);
    if (!batch) {
      batch = {
        ids: new Set<string>(),
        requests: [],
        timer: window.setTimeout(() => {
          const queued = pendingReferenceResolutions.get(definitionId);
          if (!queued) return;
          pendingReferenceResolutions.delete(definitionId);
          const queuedIds = [...queued.ids];
          const chunks = Array.from(
            { length: Math.ceil(queuedIds.length / 100) },
            (_, index) => queuedIds.slice(index * 100, index * 100 + 100),
          );
          void Promise.all(
            chunks.map((chunk) =>
              fetchReferenceOptions(definitionId, "", chunk),
            ),
          )
            .then(() => {
              for (const request of queued.requests) {
                request.resolve(
                  request.ids
                    .map((id) =>
                      referenceOptionCache.get(referenceCacheKey(definitionId, id)),
                    )
                    .filter(
                      (option): option is CustomFieldReferenceOption => Boolean(option),
                    ),
                );
              }
            })
            .catch((error: unknown) => {
              for (const request of queued.requests) request.reject(error);
            });
        }, 0),
      };
      pendingReferenceResolutions.set(definitionId, batch);
    }
    for (const id of ids) {
      if (!referenceOptionCache.has(referenceCacheKey(definitionId, id))) {
        batch.ids.add(id);
      }
    }
    batch.requests.push({ ids, resolve, reject });
  });
}

function hasOwnValue(values: CustomFieldValues, key: string) {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function withValue(
  values: CustomFieldValues,
  key: string,
  value: CustomFieldValue | undefined,
) {
  const next = { ...values };
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  ) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

function toDateTimeLocal(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatDate(value: string, includeTime = false, locale?: string) {
  const date = includeTime ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

export function formatCustomFieldValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue | undefined,
  options: { locale?: string; yesLabel?: string; noLabel?: string } = {},
) {
  if (value === undefined || value === null || value === "") return "—";
  if (definition.fieldType === "boolean") {
    return value === true
      ? options.yesLabel ?? String(true)
      : options.noLabel ?? String(false);
  }
  if (definition.fieldType === "number" && typeof value === "number") {
    return new Intl.NumberFormat(options.locale, { maximumFractionDigits: 8 }).format(value);
  }
  if (definition.fieldType === "date" && typeof value === "string") {
    return formatDate(value, false, options.locale);
  }
  if (definition.fieldType === "datetime" && typeof value === "string") {
    return formatDate(value, true, options.locale);
  }
  if (definition.fieldType === "select" && typeof value === "string") {
    return definition.options.find((option) => option.value === value)?.label ?? value;
  }
  if (definition.fieldType === "multi_select" && Array.isArray(value)) {
    return value
      .map(
        (entry) =>
          definition.options.find((option) => option.value === entry)?.label ?? entry,
      )
      .join(", ");
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function ReferenceFieldInput({
  definition,
  value,
  inputId,
  descriptionId,
  disabled,
  onChange,
}: {
  definition: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  inputId: string;
  descriptionId?: string;
  disabled: boolean;
  onChange: (value: CustomFieldValue | undefined) => void;
}) {
  const { t } = useT(["settings", "common"]);
  const selectedIds = useMemo(
    () =>
      definition.referenceMultiple
        ? Array.isArray(value)
          ? value
          : []
        : typeof value === "string"
          ? [value]
          : [],
    [definition.referenceMultiple, value],
  );
  const selectedKey = selectedIds.join(",");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomFieldReferenceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetchReferenceOptions(
        definition.id,
        query,
        selectedKey ? selectedKey.split(",") : [],
        controller.signal,
      )
        .then(setOptions)
        .catch((loadError: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("settings:customInputs.errors.referenceChoices"),
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query ? 200 : 0);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [definition.id, query, selectedKey, t]);

  const byId = new Map(options.map((option) => [option.id, option]));
  const selectedOptions = selectedIds.map(
    (id) =>
      byId.get(id) ?? referenceOptionCache.get(referenceCacheKey(definition.id, id)),
  );

  const remove = (id: string) => {
    if (definition.referenceMultiple) {
      onChange(selectedIds.filter((selectedId) => selectedId !== id));
    } else {
      onChange(undefined);
    }
  };
  const choose = (id: string) => {
    if (definition.referenceMultiple) {
      onChange(
        selectedIds.includes(id)
          ? selectedIds.filter((selectedId) => selectedId !== id)
          : [...selectedIds, id],
      );
    } else {
      onChange(id);
      setOpen(false);
    }
    setQuery("");
  };

  return (
    <div>
      {selectedIds.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {selectedIds.map((id, index) => {
            const option = selectedOptions[index];
            return (
              <span
                key={id}
                className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-brand-border bg-brand-soft px-2.5 text-xs font-medium text-brand"
                title={option?.description || id}
              >
                <span className="truncate">
                  {option?.label ?? t("settings:customInputs.unavailable", { id: id.slice(0, 8) })}
                </span>
                <button
                  type="button"
                  onClick={() => remove(id)}
                  disabled={disabled}
                  aria-label={t("settings:customInputs.removeReference", {
                    label: option?.label ?? t("settings:customInputs.reference"),
                  })}
                  className="grid size-5 shrink-0 place-items-center rounded text-brand hover:bg-brand-soft disabled:cursor-not-allowed"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <input
          id={inputId}
          role="combobox"
          value={query}
          disabled={disabled}
          required={definition.required && selectedIds.length === 0}
          aria-describedby={descriptionId}
          aria-controls={`${inputId}-options`}
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={
            definition.placeholder ||
            t("settings:customInputs.searchReference", {
              target:
                definition.referenceEntityType === "stock_unit"
                  ? t("settings:customInputs.serializedStock")
                  : t("settings:customInputs.inventory"),
            })
          }
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          className={`${inputClass} pl-9 pr-9`}
        />
        {loading ? (
          <LoaderCircle
            className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-brand"
            aria-label={t("settings:customInputs.loadingReferenceChoices")}
          />
        ) : null}
        {open ? (
          <div
            id={`${inputId}-options`}
            role="listbox"
            aria-multiselectable={definition.referenceMultiple}
            className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl"
          >
            {error ? (
              <p className="px-3 py-2 text-xs leading-5 text-danger">{error}</p>
            ) : options.length ? (
              options.map((option) => {
                const selected = selectedIds.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option.id)}
                    className={cn(
                      "block w-full rounded-lg px-3 py-2 text-left transition",
                      selected ? "bg-brand-soft" : "hover:bg-surface-subtle",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {option.label}
                      </span>
                      {selected ? (
                        <span className="text-[12px] font-semibold text-brand">
                          {t("settings:customInputs.selected")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-muted">
                      {option.description}
                    </span>
                  </button>
                );
              })
            ) : loading ? (
              <p className="px-3 py-2 text-xs text-muted">
                {t("settings:customInputs.loading")}
              </p>
            ) : (
              <p className="px-3 py-2 text-xs text-muted">
                {t("settings:customInputs.noMatches")}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CustomFieldInputs({
  definitions,
  values,
  onChange,
  disabled = false,
  className,
  emptyState,
}: CustomFieldInputsProps) {
  const { t } = useT(["settings", "common"]);
  const generatedId = useId().replaceAll(":", "");
  const sortedDefinitions = [...definitions].sort(
    (left, right) => left.position - right.position || left.label.localeCompare(right.label),
  );

  if (!sortedDefinitions.length) {
    return emptyState ? <>{emptyState}</> : null;
  }

  const update = (key: string, value: CustomFieldValue | undefined) =>
    onChange(withValue(values, key, value));

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {sortedDefinitions.map((definition) => {
        const inputId = `${generatedId}-${definition.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
        const descriptionId = definition.description ? `${inputId}-description` : undefined;
        const value = values[definition.key];
        const commonProps = {
          id: inputId,
          disabled,
          required: definition.required,
          "aria-describedby": descriptionId,
        };
        const fieldLabel = (
          <>
            {definition.label}
            {definition.required ? <span className="ml-1 text-danger">*</span> : null}
          </>
        );
        const description = definition.description ? (
          <span id={descriptionId} className="mt-1.5 block text-[13px] font-normal leading-4 text-muted">
            {definition.description}
          </span>
        ) : null;

        if (definition.fieldType === "reference") {
          return (
            <div key={definition.id} className={labelClass}>
              <label htmlFor={inputId}>{fieldLabel}</label>
              <ReferenceFieldInput
                definition={definition}
                value={value}
                inputId={inputId}
                descriptionId={descriptionId}
                disabled={disabled}
                onChange={(nextValue) => update(definition.key, nextValue)}
              />
              {description}
            </div>
          );
        }

        if (definition.fieldType === "textarea") {
          return (
            <label key={definition.id} htmlFor={inputId} className={`${labelClass} sm:col-span-2`}>
              {fieldLabel}
              <textarea
                {...commonProps}
                rows={4}
                value={typeof value === "string" ? value : ""}
                onChange={(event) => update(definition.key, event.target.value || undefined)}
                placeholder={definition.placeholder || undefined}
                className={`${inputClass} h-auto resize-y py-3 leading-5`}
              />
              {description}
            </label>
          );
        }

        if (definition.fieldType === "boolean") {
          return (
            <label key={definition.id} htmlFor={inputId} className={labelClass}>
              {fieldLabel}
              <select
                {...commonProps}
                value={hasOwnValue(values, definition.key) ? (value === true ? "true" : "false") : ""}
                onChange={(event) =>
                  update(
                    definition.key,
                    event.target.value === "" ? undefined : event.target.value === "true",
                  )
                }
                className={inputClass}
              >
                <option value="">
                  {definition.placeholder || t("settings:customInputs.choose")}
                </option>
                <option value="true">{t("common:boolean.yes")}</option>
                <option value="false">{t("common:boolean.no")}</option>
              </select>
              {description}
            </label>
          );
        }

        if (definition.fieldType === "select") {
          return (
            <label key={definition.id} htmlFor={inputId} className={labelClass}>
              {fieldLabel}
              <select
                {...commonProps}
                value={typeof value === "string" ? value : ""}
                onChange={(event) => update(definition.key, event.target.value || undefined)}
                className={inputClass}
              >
                <option value="">
                  {definition.placeholder || t("settings:customInputs.choose")}
                </option>
                {definition.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {description}
            </label>
          );
        }

        if (definition.fieldType === "multi_select") {
          const selected = Array.isArray(value) ? value : [];
          return (
            <fieldset
              key={definition.id}
              className="sm:col-span-2"
              aria-describedby={descriptionId}
              aria-required={definition.required}
              disabled={disabled}
            >
              <legend className={labelClass}>{fieldLabel}</legend>
              <div className="mt-1.5 flex min-h-11 flex-wrap gap-2 rounded-xl border border-border bg-surface p-2">
                {definition.options.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition",
                        checked
                          ? "border-brand-border bg-brand-soft text-brand"
                          : "border-border bg-surface-subtle text-muted hover:bg-surface-muted",
                        disabled && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          update(
                            definition.key,
                            checked
                              ? selected.filter((entry) => entry !== option.value)
                              : [...selected, option.value],
                          )
                        }
                        className="sr-only"
                      />
                      {option.color ? (
                        <span
                          className="size-2.5 rounded-full border border-border-strong"
                          style={{ backgroundColor: option.color }}
                        />
                      ) : null}
                      {option.label}
                    </label>
                  );
                })}
              </div>
              {description}
            </fieldset>
          );
        }

        const inputType =
          definition.fieldType === "number"
            ? "number"
            : definition.fieldType === "date"
              ? "date"
              : definition.fieldType === "datetime"
                ? "datetime-local"
                : definition.fieldType === "email"
                  ? "email"
                  : definition.fieldType === "url"
                    ? "url"
                    : "text";
        const inputValue =
          definition.fieldType === "datetime"
            ? toDateTimeLocal(value)
            : typeof value === "string" || typeof value === "number"
              ? String(value)
              : "";

        return (
          <label key={definition.id} htmlFor={inputId} className={labelClass}>
            {fieldLabel}
            <input
              {...commonProps}
              type={inputType}
              value={inputValue}
              min={definition.fieldType === "number" ? definition.minValue ?? undefined : undefined}
              max={definition.fieldType === "number" ? definition.maxValue ?? undefined : undefined}
              step={definition.fieldType === "number" ? definition.step ?? "any" : undefined}
              placeholder={definition.placeholder || undefined}
              onChange={(event) => {
                if (definition.fieldType === "number") {
                  update(
                    definition.key,
                    event.target.value === "" || !Number.isFinite(event.target.valueAsNumber)
                      ? undefined
                      : event.target.valueAsNumber,
                  );
                  return;
                }
                if (definition.fieldType === "datetime") {
                  update(definition.key, fromDateTimeLocal(event.target.value));
                  return;
                }
                update(definition.key, event.target.value || undefined);
              }}
              className={inputClass}
            />
            {description}
          </label>
        );
      })}
    </div>
  );
}

export function CustomFieldValueSummary({
  definitions,
  values,
  limit = 4,
  className,
}: {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues;
  limit?: number;
  className?: string;
}) {
  const visible = [...definitions]
    .sort((left, right) => left.position - right.position || left.label.localeCompare(right.label))
    .filter((definition) => hasOwnValue(values, definition.key))
    .slice(0, limit);

  if (!visible.length) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {visible.map((definition) => (
        <span
          key={definition.id}
          className="rounded-md bg-surface-muted px-2 py-1 text-[11px] text-muted"
          title={definition.description || undefined}
        >
          <span className="font-semibold">{definition.label}:</span>{" "}
          <CustomFieldValueDisplay
            definition={definition}
            value={values[definition.key]}
          />
        </span>
      ))}
    </div>
  );
}

export function CustomFieldValueDisplay({
  definition,
  value,
}: {
  definition: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
}) {
  const { t, i18n } = useT(["settings", "common"]);
  const ids = useMemo(
    () =>
      definition.fieldType === "reference"
        ? Array.isArray(value)
          ? value
          : typeof value === "string"
            ? [value]
            : []
        : [],
    [definition.fieldType, value],
  );
  const idsKey = ids.join(",");
  const [resolved, setResolved] = useState<CustomFieldReferenceOption[]>([]);

  useEffect(() => {
    if (definition.fieldType !== "reference" || !idsKey) return;
    const requestedIds = idsKey.split(",");
    const cached = requestedIds
      .map((id) => referenceOptionCache.get(referenceCacheKey(definition.id, id)))
      .filter((option): option is CustomFieldReferenceOption => Boolean(option));
    if (cached.length) setResolved(cached);
    if (cached.length === requestedIds.length) return;
    let active = true;
    void resolveReferenceOptions(definition.id, requestedIds)
      .then((options) => {
        if (active) setResolved(options);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [definition.fieldType, definition.id, idsKey]);

  if (definition.fieldType !== "reference") {
    return (
      <>
        {formatCustomFieldValue(definition, value, {
          locale: i18n.resolvedLanguage ?? i18n.language,
          yesLabel: t("common:boolean.yes"),
          noLabel: t("common:boolean.no"),
        })}
      </>
    );
  }
  if (!ids.length) return <>—</>;
  const labels = new Map(resolved.map((option) => [option.id, option.label]));
  return (
    <>
      {ids
        .map(
          (id) =>
            labels.get(id) ??
            t("settings:customInputs.unavailable", { id: id.slice(0, 8) }),
        )
        .join(", ")}
    </>
  );
}
