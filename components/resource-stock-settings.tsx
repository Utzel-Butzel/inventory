"use client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { fetchJson } from "@/lib/client-types";
import { AlertTriangle, ArrowLeft, Check, LoaderCircle, Save } from "lucide-react";
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

  if (loading) {
    return (
      <div className="grid min-h-[calc(100dvh-68px)] place-items-center">
        <LoaderCircle className="size-5 animate-spin text-brand" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 lg:py-8">
      <Link
        href={`/inventory/${resourceId}/stock`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t("resource.stock")}
      </Link>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
          {t("resource.settings.title")}
        </h1>
        {stock ? <p className="mt-1.5 text-sm text-muted">{stock.resource.name}</p> : null}
      </header>

      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      {stock && form ? (
        <form
          onSubmit={save}
          className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-6"
        >
          <div>
            <span className={labelClass}>{t("resource.settings.trackingMode")}</span>
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
                  onClick={() => setForm((current) => current ? { ...current, trackingMode: mode } : current)}
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
              <input type="number" min="0" max="1000000" step="1" required value={form.minimumStock} onChange={(event) => setForm({ ...form, minimumStock: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              {t("resource.settings.reorderQuantity")}
              <input type="number" min="0" max="1000000" step="1" required value={form.reorderQuantity} onChange={(event) => setForm({ ...form, reorderQuantity: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              {t("resource.settings.leadTime")}
              <input type="number" min="0" max="3650" step="1" required value={form.leadTimeDays} onChange={(event) => setForm({ ...form, leadTimeDays: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              {t("resource.settings.unitName")}
              <input required maxLength={60} value={form.unitName} onChange={(event) => setForm({ ...form, unitName: event.target.value })} placeholder={t("resource.settings.unitNamePlaceholder")} className={inputClass} />
            </label>
          </div>

          <div className="flex justify-end border-t border-border pt-5">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-strong px-4 text-xs font-semibold text-on-strong transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {t("resource.actions.saveSettings")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
