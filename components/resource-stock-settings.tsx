"use client";

import { fetchJson } from "@/lib/client-types";
import {
  AlertTriangle,
  Check,
  LoaderCircle,
  Save,
  Settings2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";

type TrackingMode = "bulk" | "serialized";

type StockSettingsData = {
  resource: { name: string; quantity: number };
  config: {
    trackingMode: TrackingMode;
    minimumStock: number;
    reorderQuantity: number;
    leadTimeDays: number;
    unitName: string;
    purchaseUnitName: string | null;
    purchaseUnitFactor: number | null;
  };
  units: Array<{ id: string }>;
};

type StockSettingsResponse = Partial<StockSettingsData> & {
  stock?: StockSettingsData;
  data?: StockSettingsData;
};

type SettingsForm = {
  trackingMode: TrackingMode;
  minimumStock: string;
  reorderQuantity: string;
  leadTimeDays: string;
  unitName: string;
  purchaseUnitName: string;
  purchaseUnitFactor: string;
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-4 focus:ring-focus/10";
const labelClass = "block text-xs font-semibold text-muted-strong";

function toForm(stock: StockSettingsData): SettingsForm {
  return {
    trackingMode: stock.config.trackingMode,
    minimumStock: String(stock.config.minimumStock),
    reorderQuantity: String(stock.config.reorderQuantity),
    leadTimeDays: String(stock.config.leadTimeDays),
    unitName: stock.config.unitName,
    purchaseUnitName: stock.config.purchaseUnitName ?? "",
    purchaseUnitFactor:
      stock.config.purchaseUnitFactor === null
        ? ""
        : String(stock.config.purchaseUnitFactor),
  };
}

export function ResourceStockSettings({ resourceId }: { resourceId: string }) {
  const { t } = useT("stock");
  const endpoint = `/api/v1/resources/${resourceId}/stock`;
  const [stock, setStock] = useState<StockSettingsData | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJson<StockSettingsResponse>(endpoint, {
        cache: "no-store",
      });
      const source = payload.stock ?? payload.data ?? payload;
      if (!source.resource || !source.config) {
        throw new Error(t("resource.errors.load"));
      }
      const normalized: StockSettingsData = {
        resource: source.resource,
        config: source.config,
        units: source.units ?? [],
      };
      setStock(normalized);
      setForm(toForm(normalized));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("resource.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [endpoint, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!stock || !form) return;
    setError(null);
    setNotice(null);

    const minimumStock = Number(form.minimumStock);
    const reorderQuantity = Number(form.reorderQuantity);
    const leadTimeDays = Number(form.leadTimeDays);
    if (!Number.isInteger(minimumStock) || minimumStock < 0) {
      setError(t("resource.errors.minimumStock"));
      return;
    }
    if (!Number.isInteger(reorderQuantity) || reorderQuantity < 0) {
      setError(t("resource.errors.reorderQuantity"));
      return;
    }
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 3650) {
      setError(t("resource.errors.leadTime"));
      return;
    }
    const unitName = form.unitName.trim();
    if (!unitName || unitName.length > 60) {
      setError(t("resource.errors.unitName"));
      return;
    }
    const purchaseUnitName = form.purchaseUnitName.trim();
    const purchaseUnitFactor = form.purchaseUnitFactor.trim()
      ? Number(form.purchaseUnitFactor)
      : null;
    if (
      (purchaseUnitName &&
        (!Number.isInteger(purchaseUnitFactor) ||
          purchaseUnitFactor === null ||
          purchaseUnitFactor < 1)) ||
      (!purchaseUnitName && purchaseUnitFactor !== null)
    ) {
      setError(t("resource.errors.purchaseUnit"));
      return;
    }

    if (
      form.trackingMode !== stock.config.trackingMode &&
      stock.resource.quantity > 0 &&
      !window.confirm(
        form.trackingMode === "serialized"
          ? t("resource.confirm.switchSerialized", {
              quantity: `${stock.resource.quantity} ${stock.config.unitName}`,
            })
          : t("resource.confirm.switchBulk"),
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      await fetchJson(`${endpoint}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingMode: form.trackingMode,
          minimumStock,
          reorderQuantity,
          leadTimeDays,
          unitName,
          purchaseUnitName: purchaseUnitName || null,
          purchaseUnitFactor: purchaseUnitName ? purchaseUnitFactor : null,
        }),
      });
      const nextStock = {
        ...stock,
        config: {
          trackingMode: form.trackingMode,
          minimumStock,
          reorderQuantity,
          leadTimeDays,
          unitName,
          purchaseUnitName: purchaseUnitName || null,
          purchaseUnitFactor: purchaseUnitName ? purchaseUnitFactor : null,
        },
      };
      setStock(nextStock);
      setForm(toForm(nextStock));
      setNotice(t("resource.notices.settingsSaved"));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("resource.errors.saveSettings"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="stock-settings"
      className="mx-auto w-full max-w-[1450px] scroll-mt-24 px-4 pb-8 sm:px-6 lg:px-8"
    >
      <div className="rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted">
            <Settings2 className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t("resource.settings.title")}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {t("resource.settings.description")}
            </p>
          </div>
        </header>

        <div className="p-5 sm:p-6">
          {error ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              {notice}
            </div>
          ) : null}

          {loading ? (
            <div className="grid min-h-32 place-items-center">
              <LoaderCircle
                className="size-5 animate-spin text-brand"
                aria-hidden="true"
              />
            </div>
          ) : stock && form ? (
            <form onSubmit={save} className="space-y-5">
              <div>
                <span className={labelClass}>
                  {t("resource.settings.trackingMode")}
                </span>
                <div className="mt-1.5 grid grid-cols-2 rounded-xl bg-surface-muted p-1">
                  {(["bulk", "serialized"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={
                        mode === "bulk" &&
                        stock.config.trackingMode === "serialized" &&
                        stock.units.length > 0
                      }
                      onClick={() =>
                        setForm((current) =>
                          current
                            ? { ...current, trackingMode: mode }
                            : current,
                        )
                      }
                      className={`h-9 rounded-lg text-xs font-semibold transition ${
                        form.trackingMode === mode
                          ? "bg-surface text-brand shadow-sm"
                          : "text-muted hover:text-foreground"
                      } disabled:cursor-not-allowed disabled:opacity-35`}
                      title={
                        mode === "bulk" &&
                        stock.config.trackingMode === "serialized" &&
                        stock.units.length > 0
                          ? t("resource.settings.cannotReturnBulk")
                          : undefined
                      }
                    >
                      {t(`resource.tracking.${mode}`)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">
                  {form.trackingMode === "bulk"
                    ? t("resource.settings.bulkHelp")
                    : t("resource.settings.serializedHelp")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  {t("resource.settings.minimumStock")}
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="1"
                    required
                    value={form.minimumStock}
                    onChange={(event) =>
                      setForm({ ...form, minimumStock: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("resource.settings.reorderQuantity")}
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="1"
                    required
                    value={form.reorderQuantity}
                    onChange={(event) =>
                      setForm({ ...form, reorderQuantity: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("resource.settings.leadTime")}
                  <input
                    type="number"
                    min="0"
                    max="3650"
                    step="1"
                    required
                    value={form.leadTimeDays}
                    onChange={(event) =>
                      setForm({ ...form, leadTimeDays: event.target.value })
                    }
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("resource.settings.unitName")}
                  <input
                    required
                    maxLength={60}
                    value={form.unitName}
                    onChange={(event) =>
                      setForm({ ...form, unitName: event.target.value })
                    }
                    placeholder={t("resource.settings.unitNamePlaceholder")}
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="rounded-xl border border-border bg-surface-subtle p-4">
                <h3 className="text-xs font-semibold text-foreground">
                  {t("resource.settings.purchaseUnitTitle")}
                </h3>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {t("resource.settings.purchaseUnitHelp")}
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className={labelClass}>
                    {t("resource.settings.purchaseUnitName")}
                    <input
                      maxLength={60}
                      value={form.purchaseUnitName}
                      onChange={(event) =>
                        setForm({ ...form, purchaseUnitName: event.target.value })
                      }
                      placeholder={t("resource.settings.purchaseUnitNamePlaceholder")}
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("resource.settings.purchaseUnitFactor")}
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        max="2000000000"
                        step="1"
                        value={form.purchaseUnitFactor}
                        onChange={(event) =>
                          setForm({ ...form, purchaseUnitFactor: event.target.value })
                        }
                        placeholder="1000"
                        className={`${inputClass} pr-20`}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[13px] text-muted">
                        {form.unitName || t("resource.unit")}
                      </span>
                    </div>
                  </label>
                </div>
                {form.purchaseUnitName.trim() &&
                Number.isInteger(Number(form.purchaseUnitFactor)) &&
                Number(form.purchaseUnitFactor) > 0 ? (
                  <p className="mt-3 text-xs font-medium text-brand">
                    {t("resource.settings.purchaseUnitPreview", {
                      purchaseUnit: form.purchaseUnitName.trim(),
                      factor: Number(form.purchaseUnitFactor),
                      baseUnit: form.unitName.trim() || t("resource.unit"),
                    })}
                  </p>
                ) : null}
              </div>

              <div className="flex justify-end border-t border-border pt-5">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-strong px-4 text-xs font-semibold text-on-strong transition hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? (
                    <LoaderCircle
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Save className="size-4" aria-hidden="true" />
                  )}
                  {t("resource.actions.saveSettings")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
