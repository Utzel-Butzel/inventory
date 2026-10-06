"use client";

import { useEffect, useId, useState } from "react";
import { useT } from "next-i18next/client";
import Select from "react-select";
import { Package } from "lucide-react";
import { ResponsiveMediaImage } from "@/components/responsive-media-image";
import type { FamilyStock, StockCover } from "@/components/family-stock-summary";
import { Button } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import { inputClass } from "./fields";

export type StockBomPreview = {
  resource: { id: string; name: string; quantity: number; trackingMode: "bulk" | "serialized" };
  buildableQuantity: number;
  existingResourceId?: string | null;
  components: Array<{ slotKey: string; name: string; choices: Array<{ resourceId: string; name: string }> }>;
};
export type VirtualStockSelection = { primaryId: string; configuration: Record<string, string>; preview: StockBomPreview };

export function StockVariantOverview({ family, resourceId, revision, allSelected, virtualSelected, virtualName, onSelect, onCurrent, onAll, onVirtual }: {
  family: FamilyStock;
  resourceId: string;
  revision: number;
  allSelected: boolean;
  virtualSelected: boolean;
  virtualName?: string;
  onSelect: (id: string) => void;
  onCurrent: () => void;
  onAll: () => void;
  onVirtual: (selection: VirtualStockSelection) => void;
}) {
  const { t, i18n } = useT("stock");
  const selectId = useId();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  const [base, setBase] = useState<StockBomPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<StockBomPreview>(`/api/v1/resources/${family.primary.id}/bom`, { signal: controller.signal, cache: "no-store" })
      .then(setBase).catch(() => { if (!controller.signal.aborted) setBase(null); });
    return () => controller.abort();
  }, [family.primary.id, revision]);
  const groups = base?.components.filter((component) => component.choices.length > 1) ?? [];
  const options = [
    { value: "all", label: t("workspace.allVariants"), quantity: family.summary.totalQuantity, cover: family.primary.cover },
    ...family.variants.map((member) => ({ value: member.id, label: member.name, quantity: member.quantity, cover: member.cover })),
    { value: family.primary.id, label: family.variants.length ? t("workspace.unassignedName", { name: family.primary.name }) : family.primary.name, quantity: family.primary.quantity, cover: family.primary.cover },
  ];
  const selected = virtualSelected
    ? { value: "virtual", label: virtualName ?? t("workspace.chooseConfiguration"), quantity: 0, cover: family.primary.cover }
    : options.find((option) => option.value === (allSelected ? "all" : resourceId)) ?? options[0];
  const chooseConfiguration = async () => {
    setResolving(true); setError(null);
    const configuration = Object.fromEntries(groups.map((group) => [group.slotKey, choices[group.slotKey]]));
    try {
      const preview = await fetchJson<StockBomPreview>(`/api/v1/resources/${family.primary.id}/assembly-configuration?selection=${encodeURIComponent(JSON.stringify(configuration))}`);
      if (preview.existingResourceId === resourceId) onCurrent();
      else if (preview.existingResourceId) onSelect(preview.existingResourceId);
      else onVirtual({ primaryId: family.primary.id, configuration, preview });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("workspace.loadError")); }
    finally { setResolving(false); }
  };
  return <div className="min-w-0" aria-label={t("workspace.variants")}>
    {family.variants.length || groups.length ? <>
    <label htmlFor={`${selectId}-input`} className="mb-2 block text-xs font-medium text-muted">{t("workspace.variant")}</label>
    <Select<(typeof options)[number]>
      instanceId={selectId}
      inputId={`${selectId}-input`}
      options={options}
      value={selected}
      onChange={(option) => {
        if (!option) return;
        if (option.value === "all") { if (!allSelected) onAll(); }
        else onSelect(option.value);
      }}
      placeholder={t("workspace.searchVariants")}
      noOptionsMessage={() => t("workspace.noMatches")}
      maxMenuHeight={320}
      formatOptionLabel={(option, { context }) => <span className="flex min-w-0 items-center gap-3">
        <StockThumbnail cover={option.cover} />
        <span className="min-w-0 flex-1 whitespace-normal break-words text-sm font-semibold">{option.label}</span>
        {context === "menu" ? <span className="shrink-0 text-sm tabular-nums text-muted">{number.format(option.quantity)}</span> : null}
      </span>}
      styles={{
        control: (base, state) => ({ ...base, minHeight: 64, borderRadius: 12, backgroundColor: "var(--color-surface)", borderColor: state.isFocused ? "var(--color-focus)" : "var(--color-border)", boxShadow: state.isFocused ? "0 0 0 1px var(--color-focus)" : "none", ":hover": { borderColor: "var(--color-focus)" } }),
        input: (base) => ({ ...base, color: "var(--color-foreground)" }),
        singleValue: (base) => ({ ...base, color: "var(--color-foreground)" }),
        placeholder: (base) => ({ ...base, color: "var(--color-muted)" }),
        menu: (base) => ({ ...base, zIndex: 30, overflow: "hidden", borderRadius: 12, backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)" }),
        option: (base, state) => ({ ...base, backgroundColor: state.isSelected ? "var(--color-brand-soft)" : state.isFocused ? "var(--color-surface-hover)" : "var(--color-surface)", color: state.isSelected ? "var(--color-brand)" : "var(--color-foreground)", ":active": { backgroundColor: "var(--color-brand-soft)" } }),
        dropdownIndicator: (base) => ({ ...base, color: "var(--color-muted)" }),
        indicatorSeparator: () => ({ display: "none" }),
      }}
    />
    </> : <div className="flex items-center gap-3"><StockThumbnail cover={family.primary.cover} /><h2 className="text-lg font-semibold">{family.primary.name}</h2></div>}
    {groups.length ? <details className="mt-3" open={virtualSelected || !family.variants.length}>
      <summary className="cursor-pointer text-sm font-semibold">{t("workspace.chooseConfiguration")}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{groups.map((group) => <label key={group.slotKey} className="text-xs font-medium">{group.name}<select value={choices[group.slotKey] ?? ""} className={`${inputClass} mt-1`} onChange={(event) => setChoices((previous) => ({ ...previous, [group.slotKey]: event.target.value }))}><option value="">{t("workspace.choose")}</option>{group.choices.map((choice) => <option key={choice.resourceId} value={choice.resourceId}>{choice.name}</option>)}</select></label>)}</div>
      <p className="my-3 text-xs text-muted">{t("workspace.virtualHelp")}</p>
      <Button size="sm" disabled={resolving || groups.some((group) => !choices[group.slotKey])} onClick={() => void chooseConfiguration()}>{t("workspace.selectConfiguration")}</Button>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </details> : null}
  </div>;
}

export function StockThumbnail({ cover }: { cover?: StockCover | null }) {
  return <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-subtle text-muted">
    {cover?.url ? <ResponsiveMediaImage media={cover} alt="" widths={[96, 192]} sizes="40px" className="size-full object-cover" /> : <Package className="size-5" aria-hidden="true" />}
  </span>;
}
