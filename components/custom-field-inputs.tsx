"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/components/ui";
import type {
  CustomFieldDefinition,
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
  "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-600 hover:border-slate-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600";
const labelClass = "block text-xs font-semibold text-slate-700";

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

function formatDate(value: string, includeTime = false) {
  const date = includeTime ? new Date(value) : new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

export function formatCustomFieldValue(
  definition: CustomFieldDefinition,
  value: CustomFieldValue | undefined,
) {
  if (value === undefined || value === null || value === "") return "—";
  if (definition.fieldType === "boolean") return value === true ? "Yes" : "No";
  if (definition.fieldType === "number" && typeof value === "number") {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value);
  }
  if (definition.fieldType === "date" && typeof value === "string") {
    return formatDate(value);
  }
  if (definition.fieldType === "datetime" && typeof value === "string") {
    return formatDate(value, true);
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

export function CustomFieldInputs({
  definitions,
  values,
  onChange,
  disabled = false,
  className,
  emptyState,
}: CustomFieldInputsProps) {
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
            {definition.required ? <span className="ml-1 text-rose-500">*</span> : null}
          </>
        );
        const description = definition.description ? (
          <span id={descriptionId} className="mt-1.5 block text-[11px] font-normal leading-4 text-slate-600">
            {definition.description}
          </span>
        ) : null;

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
                <option value="">{definition.placeholder || "Choose…"}</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
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
                <option value="">{definition.placeholder || "Choose…"}</option>
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
              <div className="mt-1.5 flex min-h-11 flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
                {definition.options.map((option) => {
                  const checked = selected.includes(option.value);
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition",
                        checked
                          ? "border-violet-200 bg-violet-50 text-violet-800"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
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
                          className="size-2.5 rounded-full border border-black/10"
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
          className="rounded-md bg-slate-100 px-2 py-1 text-[9px] text-slate-600"
          title={definition.description || undefined}
        >
          <span className="font-semibold">{definition.label}:</span>{" "}
          {formatCustomFieldValue(definition, values[definition.key])}
        </span>
      ))}
    </div>
  );
}
