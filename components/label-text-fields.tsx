"use client";

import { useT } from "next-i18next/client";
import type { LabelResource, LabelTextOverride } from "@/lib/label-target";

export function LabelTextFields({ resource, onChange, onReset }: {
  resource: LabelResource;
  onChange: (change: LabelTextOverride) => void;
  onReset: () => void;
}) {
  const { t } = useT("labels");
  return <div className="space-y-2">
    {(["name", "subtitle"] as const).map(field => <label key={field} className="block text-xs font-medium text-muted-strong">
      {t(`text.${field}`)}
      <input value={resource[field] ?? ""} maxLength={240}
        onChange={event => onChange({ [field]: event.target.value })}
        className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-focus" />
    </label>)}
    <button type="button" onClick={onReset} className="text-xs font-semibold text-brand">{t("text.reset")}</button>
  </div>;
}
