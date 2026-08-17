"use client";

import { Barcode, LoaderCircle, PackagePlus, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { fetchJson } from "@/lib/client-types";
import type {
  ResourceVariantDto,
  ResourceVariantStockSummary,
} from "@/lib/resource-variant-contract";

type VariantResponse = {
  variants: ResourceVariantDto[];
  summary: ResourceVariantStockSummary;
  trackingMode: "bulk" | "serialized";
};

type VariantForm = {
  name: string;
  sku: string;
  barcode: string;
  price: string;
  currency: string;
  initialAllocation: string;
};

const emptyForm: VariantForm = {
  name: "",
  sku: "",
  barcode: "",
  price: "",
  currency: "EUR",
  initialAllocation: "0",
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-success focus:ring-4 focus:ring-success-border";
const labelClass = "block text-[11px] font-semibold text-muted-strong";

const money = (cents: number | null, currency: string, locale: string) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat(locale, { style: "currency", currency }).format(
        cents / 100,
      );

export function ResourceVariantsManager({
  resourceId,
  canEdit,
  canManageStock = false,
  hideWhenEmpty = false,
  allowCreate = true,
}: {
  resourceId: string;
  canEdit: boolean;
  canManageStock?: boolean;
  hideWhenEmpty?: boolean;
  allowCreate?: boolean;
}) {
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [data, setData] = useState<VariantResponse | null>(null);
  const [form, setForm] = useState<VariantForm>(emptyForm);
  const [editing, setEditing] = useState<ResourceVariantDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [stockVariant, setStockVariant] = useState<ResourceVariantDto | null>(null);
  const [stockDelta, setStockDelta] = useState("1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await fetchJson<VariantResponse>(
          `/api/v1/resources/${resourceId}/variants`,
          { cache: "no-store" },
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("variants.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [resourceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const beginEdit = (variant: ResourceVariantDto) => {
    setEditing(variant);
    setFormOpen(true);
    setForm({
      name: variant.name,
      sku: variant.sku ?? "",
      barcode: variant.barcode ?? "",
      price: variant.priceCents === null ? "" : (variant.priceCents / 100).toFixed(2),
      currency: variant.currency,
      initialAllocation: "0",
    });
  };
  const resetForm = () => {
    setEditing(null);
    setFormOpen(false);
    setForm(emptyForm);
  };

  const saveVariant = async () => {
    const initialAllocation = Number(form.initialAllocation || 0);
    if (!form.name.trim() || !Number.isInteger(initialAllocation) || initialAllocation < 0) {
      setError(t("variants.errors.invalidForm"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await fetchJson(
        editing
          ? `/api/v1/resources/${resourceId}/variants/${editing.id}`
          : `/api/v1/resources/${resourceId}/variants`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            sku: form.sku.trim() || null,
            barcode: form.barcode.trim() || null,
            priceCents: form.price ? Math.round(Number(form.price) * 100) : null,
            currency: form.currency.toUpperCase(),
            ...(!editing ? { initialAllocation } : {}),
          }),
        },
      );
      resetForm();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("variants.errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const deleteVariant = async (variant: ResourceVariantDto) => {
    if (!window.confirm(t("variants.confirmDelete", { name: variant.name }))) return;
    setSaving(true);
    try {
      await fetchJson(
        `/api/v1/resources/${resourceId}/variants/${variant.id}`,
        { method: "DELETE" },
      );
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("variants.errors.delete"));
    } finally {
      setSaving(false);
    }
  };

  const bookStock = async () => {
    if (!stockVariant) return;
    const delta = Number(stockDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      setError(t("variants.errors.invalidStock"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await fetchJson(
        `/api/v1/resources/${resourceId}/variants/${stockVariant.id}/stock/movements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            delta,
            type: delta > 0 ? "receipt" : "issue",
            reason: "Variant stock booking",
          }),
        },
      );
      setStockVariant(null);
      setStockDelta("1");
      await load();
    } catch (stockError) {
      setError(stockError instanceof Error ? stockError.message : t("variants.errors.stock"));
    } finally {
      setSaving(false);
    }
  };

  if (
    hideWhenEmpty &&
    !loading &&
    !error &&
    (data?.variants.length ?? 0) === 0
  ) {
    return null;
  }

  return (
    <section className="mx-auto mt-6 w-full max-w-[1450px] px-4 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PackagePlus className="size-4 text-success" />{" "}
              {allowCreate ? t("variants.title") : t("variants.legacyTitle")}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {allowCreate
                ? t("variants.description")
                : t("variants.legacyDescription")}
            </p>
          </div>
          {data ? (
            <div className="flex gap-2 text-[11px] font-semibold">
              <span className="rounded-full bg-success-soft px-2.5 py-1 text-success">
                {t("variants.allocated", { value: number.format(data.summary.allocatedQuantity) })}
              </span>
              <span className="rounded-full bg-surface-muted px-2.5 py-1 text-muted-strong">
                {t("variants.unallocated", { value: number.format(data.summary.unallocatedQuantity) })}
              </span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 flex justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-xs text-danger">
            {error}
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        ) : null}

        {loading ? (
          <div className="grid min-h-28 place-items-center text-muted"><LoaderCircle className="animate-spin" /></div>
        ) : data?.trackingMode === "serialized" ? (
          <p className="mt-5 rounded-xl border border-warning-border bg-warning-soft p-4 text-xs leading-5 text-warning">
            {t("variants.serializedDisabled")}
          </p>
        ) : (
          <>
            {data?.variants.length ? (
              <div className="mt-5 overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-muted">
                    <tr><th className="px-4 py-3">{t("variants.fields.name")}</th><th className="px-4 py-3">{t("variants.fields.sku")}</th><th className="px-4 py-3">{t("variants.fields.barcode")}</th><th className="px-4 py-3">{t("variants.fields.price")}</th><th className="px-4 py-3 text-right">{t("variants.fields.stock")}</th>{canEdit || canManageStock ? <th className="px-4 py-3" /> : null}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.variants.map((variant) => (
                      <tr key={variant.id}>
                        <td className="px-4 py-3 font-semibold text-foreground">{variant.name}</td>
                        <td className="px-4 py-3 font-mono text-muted-strong">{variant.sku || "—"}</td>
                        <td className="px-4 py-3 font-mono text-muted-strong">{variant.barcode || "—"}</td>
                        <td className="px-4 py-3 text-muted-strong">{money(variant.priceCents, variant.currency, locale)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-foreground">{number.format(variant.quantity)}</td>
                        {canEdit || canManageStock ? (
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex gap-1">
                              {canManageStock ? <button type="button" onClick={() => setStockVariant(variant)} className="rounded-lg border border-brand-border bg-brand-soft px-2 py-1 font-semibold text-brand">{t("variants.actions.stock")}</button> : null}
                              {canEdit ? <button type="button" onClick={() => beginEdit(variant)} className="rounded-lg border border-border px-2 py-1 font-semibold text-muted-strong">{t("variants.actions.edit")}</button> : null}
                              {canEdit ? <button type="button" disabled={variant.quantity !== 0 || saving} onClick={() => void deleteVariant(variant)} className="rounded-lg border border-danger-border p-1.5 text-danger disabled:cursor-not-allowed disabled:opacity-30" title={variant.quantity ? t("variants.actions.zeroFirst") : t("variants.actions.delete")}><Trash2 className="size-3.5" /></button> : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-5 rounded-xl border border-dashed border-border bg-surface-subtle px-5 py-7 text-center text-xs text-muted">{t("variants.empty")}</p>
            )}

            {stockVariant ? (
              <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-brand-border bg-brand-soft p-4">
                <label className={labelClass}>{t("variants.stockChange", { name: stockVariant.name })}<input type="number" step="1" value={stockDelta} onChange={(event) => setStockDelta(event.target.value)} className={`${inputClass} w-40 bg-surface`} /></label>
                <button type="button" disabled={saving} onClick={() => void bookStock()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-xs font-semibold text-on-strong"><Save className="size-3.5" /> {t("variants.actions.book")}</button>
                <button type="button" onClick={() => setStockVariant(null)} className="h-10 px-3 text-xs font-semibold text-muted-strong">{t("variants.actions.cancel")}</button>
                <p className="w-full text-[11px] text-brand">{t("variants.stockHelp")}</p>
              </div>
            ) : null}

            {canEdit && allowCreate && !formOpen ? (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-xs font-semibold text-on-strong"
              >
                <Plus className="size-3.5" /> {t("variants.actions.add")}
              </button>
            ) : null}

            {canEdit && formOpen ? (
              <div className="mt-5 rounded-xl border border-border bg-surface-subtle p-4">
                <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><Plus className="size-3.5" /> {editing ? t("variants.editTitle", { name: editing.name }) : t("variants.addTitle")}</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className={labelClass}>{t("variants.fields.name")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("variants.namePlaceholder")} className={inputClass} /></label>
                  <label className={labelClass}>{t("variants.fields.sku")} · {t("variants.optional")}<input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} className={inputClass} /></label>
                  <label className={labelClass}><span className="inline-flex items-center gap-1"><Barcode className="size-3" /> {t("variants.fields.barcode")} · {t("variants.optional")}</span><input value={form.barcode} onChange={(event) => setForm((current) => ({ ...current, barcode: event.target.value }))} className={inputClass} /></label>
                  <label className={labelClass}>{t("variants.fields.price")} · {t("variants.optional")}<div className="mt-1.5 flex"><input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} className={`${inputClass} mt-0 rounded-r-none`} /><input value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.slice(0, 3) }))} className="h-10 w-20 rounded-r-xl border border-l-0 border-border bg-surface px-2 text-center text-xs font-semibold uppercase" aria-label={t("variants.currency")} /></div></label>
                  {!editing ? <label className={labelClass}>{t("variants.openingAllocation")}<input type="number" min="0" step="1" max={Math.max(0, data?.summary.unallocatedQuantity ?? 0)} value={form.initialAllocation} onChange={(event) => setForm((current) => ({ ...current, initialAllocation: event.target.value }))} className={inputClass} /><span className="mt-1 block font-normal text-muted">{t("variants.openingAllocationHelp")}</span></label> : null}
                </div>
                <div className="mt-4 flex gap-2">
                  <button type="button" disabled={saving} onClick={() => void saveVariant()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-xs font-semibold text-on-strong">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {editing ? t("variants.actions.save") : t("variants.actions.add")}</button>
                  <button type="button" onClick={resetForm} className="h-10 px-3 text-xs font-semibold text-muted-strong">{t("variants.actions.cancel")}</button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
