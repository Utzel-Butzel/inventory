"use client";

import type { StorageTarget } from "./types";

import type { TFunction } from "i18next";
import { AlertCircle, CheckCircle2, CircleDot } from "lucide-react";
import { type ReactNode } from "react";

import { Card, cn } from "@/components/ui";

import type { FixedProperty, Notice, StockUnitCustomField } from "./types";

export const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-[14px] text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
export const textAreaClass =
  "mt-1.5 min-h-20 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-[14px] leading-5 text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
export const labelClass = "block text-[12px] font-semibold text-muted-strong";

export type StockUnitCustomFieldSelectProps = {
  fields: StockUnitCustomField[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  t: TFunction;
  className?: string;
};

export function StockUnitCustomFieldSelect({
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

export function visiblePropertyValue(property: Pick<FixedProperty, "key" | "value">, t: TFunction) {
  if (property.key === "assemblyStatus" && property.value === "finished-assembled") {
    return t("values.fullyAssembled");
  }
  return property.value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function FlowStep({
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

export function Toggle({
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

export function NoticeBanner({ notice }: { notice: Notice }) {
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


export function StorageTargetSelect({
  value,
  onChange,
  disabled,
  t,
  compact = false,
  className,
}: {
  value: StorageTarget;
  onChange: (storage: StorageTarget) => void;
  disabled: boolean;
  t: TFunction;
  compact?: boolean;
  className?: string;
}) {
  const targets = [
    ["custom-field", "customField"],
    ["metadata", "metadata"],
    ["execution", "execution"],
  ] as const;

  return (
    <label className={cn(labelClass, className)}>
      {t("workflows.storage.destination")}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as StorageTarget)}
        className={inputClass}
        disabled={disabled}
      >
        {targets.map(([target, label]) => (
          <option key={target} value={target}>
            {t(`workflows.storage.targets.${label}${compact ? "Short" : ""}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
