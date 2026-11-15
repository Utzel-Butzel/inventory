"use client";

import { useId } from "react";
import { Check, FileText, Network, Printer } from "lucide-react";
import { useT } from "next-i18next/client";
import { LabelHelp } from "@/components/label-help";

type PrintRoute = "browser" | "ptouch" | "shared";
const routes = [
  { value: "browser", icon: FileText },
  { value: "ptouch", icon: Printer },
  { value: "shared", icon: Network },
] as const;

export function LabelPrintRoute({ value, onChange, disabled }: {
  value: PrintRoute;
  onChange: (value: PrintRoute) => void;
  disabled: boolean;
}) {
  const { t } = useT("labels");
  const id = useId();
  return <div>
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 id={id} className="text-sm font-semibold">{t("direct.destination")}</h2>
      <LabelHelp><p>{t(`route.${value}.help`)}</p><p className="mt-2">{t("shared.devicePreference")}</p></LabelHelp>
    </div>
    <fieldset aria-labelledby={id} disabled={disabled} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
      {routes.map(({ value: route, icon: Icon }) => <label key={route} className="relative min-w-0 cursor-pointer has-disabled:cursor-not-allowed">
        <input type="radio" name={id} value={route} checked={value === route} onChange={() => onChange(route)} className="peer sr-only" />
        <span className="flex h-full items-center gap-3 rounded-xl border border-border bg-surface p-3 transition hover:border-border-strong peer-checked:border-brand peer-checked:bg-brand-soft peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2 peer-disabled:opacity-50">
          <Icon size={18} aria-hidden="true" className={value === route ? "shrink-0 text-brand" : "shrink-0 text-muted"} />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t(`route.${route}.title`)}</span><span className="mt-0.5 block text-xs text-muted">{t(`route.${route}.subtitle`)}</span></span>
          <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${value === route ? "border-brand bg-brand-solid text-on-brand" : "border-border"}`} aria-hidden="true">{value === route ? <Check size={11} strokeWidth={3} /> : null}</span>
        </span>
      </label>)}
    </fieldset>
  </div>;
}
