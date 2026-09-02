"use client";

import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, Skeleton } from "@/components/ui";
import type { AiBillableAction } from "@/lib/ai-billing";

type UsageResponse = {
  currency: "USD";
  estimated: boolean;
  period: { start: string; end: string };
  budgetMicros: number | null;
  remainingMicros: number | null;
  summary: {
    costMicros: number;
    actionCount: number;
    runningCount: number;
    failedCount: number;
  };
  byAction: Array<{
    action: AiBillableAction;
    costMicros: number;
    count: number;
  }>;
  recent: Array<{
    id: string;
    action: AiBillableAction;
    provider: "openai" | "google" | "replicate";
    model: string;
    status: "running" | "succeeded" | "failed";
    costMicros: number;
    costEstimated: boolean;
    actor: string;
    actorName: string | null;
    resourceId: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
};

const errorMessage = (payload: unknown, fallback: string) =>
  payload &&
  typeof payload === "object" &&
  "error" in payload &&
  typeof payload.error === "string"
    ? payload.error
    : fallback;

export function AiUsageManager() {
  const { t, i18n } = useT("settings");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
    [locale],
  );
  const formatMoney = useCallback(
    (micros: number) => money.format(micros / 1_000_000),
    [money],
  );

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/ai/usage", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("aiUsage.errors.load")));
      }
      const next = payload as UsageResponse;
      setUsage(next);
      setBudgetInput(
        next.budgetMicros === null ? "" : String(next.budgetMicros / 1_000_000),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("aiUsage.errors.load"),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBudget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = budgetInput.trim().replace(",", ".");
    const value = normalized ? Number(normalized) : null;
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError(t("aiUsage.errors.budget"));
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/ai/usage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyBudgetUsd: value }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("aiUsage.errors.save")));
      }
      setNotice(t("aiUsage.notices.saved"));
      await load(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t("aiUsage.errors.save"),
      );
    } finally {
      setSaving(false);
    }
  }

  const budgetPercent =
    usage?.budgetMicros === null || !usage?.budgetMicros
      ? usage?.budgetMicros === 0
        ? 100
        : 0
      : Math.min(100, (usage.summary.costMicros / usage.budgetMicros) * 100);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand">
            <BrainCircuit className="size-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-foreground">{t("aiUsage.title")}</h2>
              <Badge tone="warning">{t("aiUsage.estimated")}</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              {t("aiUsage.description")}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("aiUsage.refresh")}
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-b border-danger-border bg-danger-soft px-5 py-3 text-sm text-danger sm:px-6" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start gap-2 border-b border-success-border bg-success-soft px-5 py-3 text-sm text-success sm:px-6" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      {loading && !usage ? (
        <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-6">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : usage ? (
        <div className="space-y-6 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Summary
              label={t("aiUsage.summary.spent")}
              value={formatMoney(usage.summary.costMicros)}
            />
            <Summary
              label={t("aiUsage.summary.remaining")}
              value={
                usage.remainingMicros === null
                  ? t("aiUsage.unlimited")
                  : formatMoney(usage.remainingMicros)
              }
            />
            <Summary
              label={t("aiUsage.summary.actions")}
              value={String(usage.summary.actionCount)}
              hint={
                usage.summary.runningCount || usage.summary.failedCount
                  ? t("aiUsage.summary.statusHint", {
                      running: usage.summary.runningCount,
                      failed: usage.summary.failedCount,
                    })
                  : undefined
              }
            />
          </div>

          <form onSubmit={saveBudget} className="rounded-2xl border border-border bg-surface-subtle p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <label className="block max-w-sm flex-1">
                <span className="text-xs font-semibold text-muted-strong">
                  {t("aiUsage.budget.label")}
                </span>
                <div className="mt-2 flex h-11 items-center rounded-xl border border-border bg-surface px-3.5 shadow-sm focus-within:border-focus focus-within:ring-4 focus-within:ring-focus/10">
                  <span className="text-sm text-muted">$</span>
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="0.01"
                    value={budgetInput}
                    onChange={(event) => setBudgetInput(event.target.value)}
                    placeholder={t("aiUsage.budget.unlimitedPlaceholder")}
                    className="h-full min-w-0 flex-1 bg-transparent pl-2 text-sm text-foreground outline-none"
                  />
                </div>
                <span className="mt-1.5 block text-xs leading-5 text-muted">
                  {t("aiUsage.budget.hint")}
                </span>
              </label>
              <Button type="submit" disabled={saving}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? t("aiUsage.budget.saving") : t("aiUsage.budget.save")}
              </Button>
            </div>
            {usage.budgetMicros !== null ? (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={`h-full rounded-full ${budgetPercent >= 90 ? "bg-danger" : budgetPercent >= 70 ? "bg-warning" : "bg-brand-solid"}`}
                    style={{ width: `${budgetPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {t("aiUsage.budget.progress", {
                    percent: Math.round(budgetPercent),
                    budget: formatMoney(usage.budgetMicros),
                  })}
                </p>
              </div>
            ) : null}
          </form>

          <section>
            <h3 className="text-sm font-semibold text-foreground">
              {t("aiUsage.byAction.title")}
            </h3>
            <div className="mt-3 overflow-hidden rounded-2xl border border-border">
              {usage.byAction.map((row) => (
                <div key={row.action} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                  <span className="truncate text-sm font-medium text-foreground">
                    {t(`aiUsage.actions.${row.action}`)}
                  </span>
                  <span className="text-xs tabular-nums text-muted">
                    {t("aiUsage.byAction.count", { count: row.count })}
                  </span>
                  <span className="min-w-20 text-right text-sm font-semibold tabular-nums text-muted-strong">
                    {formatMoney(row.costMicros)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-foreground">
              {t("aiUsage.recent.title")}
            </h3>
            <p className="mt-1 text-xs text-muted">{t("aiUsage.recent.description")}</p>
            <div className="mt-3 overflow-hidden rounded-2xl border border-border">
              {usage.recent.length ? usage.recent.map((event) => (
                <div key={event.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {t(`aiUsage.actions.${event.action}`)}
                      </span>
                      <Badge tone={event.status === "failed" ? "danger" : event.status === "running" ? "warning" : "neutral"}>
                        {t(`aiUsage.status.${event.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {event.actorName || event.actor} · {event.provider} / {event.model} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-strong">
                    {formatMoney(event.costMicros)}
                  </span>
                </div>
              )) : (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  {t("aiUsage.recent.empty")}
                </p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </Card>
  );
}

function Summary({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-subtle p-4">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
