"use client";

import { cn } from "@/components/ui";
import type { TFunction } from "i18next";
import { Minus, Plus } from "lucide-react";
import type { StockContact } from "./types";

export const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted";
export const labelClass = "block text-xs font-semibold text-muted-strong";

export function StockContactSelect({
  contacts,
  value,
  onChange,
  t,
  includeArchived = false,
  optional = false,
}: {
  contacts: StockContact[];
  value: string;
  onChange: (value: string) => void;
  t: TFunction;
  includeArchived?: boolean;
  optional?: boolean;
}) {
  const visibleContacts = includeArchived
    ? contacts
    : contacts.filter((contact) => !contact.archivedAt);
  if (!visibleContacts.length) return null;

  return (
    <label className={labelClass}>
      {t("resource.booking.contact")}
      {optional ? (
        <>
          {" "}
          <span className="font-normal text-muted">· {t("resource.optional")}</span>
        </>
      ) : null}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="">{t("resource.booking.noContact")}</option>
        {visibleContacts.map((contact) => (
          <option key={contact.id} value={contact.id} disabled={Boolean(contact.archivedAt)}>
            {contact.company ? `${contact.name} · ${contact.company}` : contact.name}
            {contact.archivedAt ? ` · ${t("resource.booking.archivedContact")}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MovementDirectionToggle({
  direction,
  onChange,
  t,
  compact = false,
}: {
  direction: "in" | "out";
  onChange: (direction: "in" | "out") => void;
  t: TFunction;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "grid grid-cols-2 rounded-xl bg-surface-muted p-1",
      compact ? "mb-4 sm:max-w-xs" : "mb-5",
    )}>
      {(["in", "out"] as const).map((value) => {
        const Icon = value === "in" ? Plus : Minus;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg text-xs font-semibold transition",
              compact ? "h-9" : "h-10",
              direction === value
                ? cn("bg-surface shadow-sm", value === "in" ? "text-success" : "text-danger")
                : "text-muted hover:text-foreground",
            )}
          >
            <Icon className={compact ? "size-3.5" : "size-4"} aria-hidden="true" />
            {t(value === "in" ? "resource.booking.stockIn" : "resource.booking.stockOut")}
          </button>
        );
      })}
    </div>
  );
}

export function SectionHeading({
  icon,
  title,
  description,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted">{description}</p>
        </div>
      </div>
      {trailing}
    </div>
  );
}
