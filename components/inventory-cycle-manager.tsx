"use client";

import type { TFunction } from "i18next";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ClipboardCheck,
  Clock3,
  History,
  LoaderCircle,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { Button, Card, Skeleton } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

type TrackingMode = "bulk" | "serialized";

type InventoryCyclePolicy = {
  resourceId: string;
  intervalDays: number;
  enabled: boolean;
  nextDueAt: string;
  lastCompletedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type InventoryCount = {
  id: string;
  resourceId: string;
  locationResourceId: string | null;
  expectedQuantity: number;
  countedQuantity: number;
  variance: number;
  countedAt: string;
  note: string;
  movementId: string | null;
  idempotencyKey: string | null;
  createdBy: string | null;
  createdAt: string;
};

type InventoryCycle = {
  resource: {
    id: string;
    name: string;
    quantity: number;
    trackingMode: TrackingMode;
  };
  policy: InventoryCyclePolicy | null;
  history: InventoryCount[];
};

type CycleResponse = { cycle: InventoryCycle };

type LocationResponse = {
  breakdown: {
    resource: { quantity: number };
    locations: Array<{
      locationResourceId: string;
      name: string;
      type: string;
      quantity: number;
    }>;
  };
  availableLocations: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
  }>;
};

type CountLocation = {
  id: string;
  name: string;
  type: string;
  quantity: number;
};

export type InventoryCycleManagerProps = {
  resourceId: string;
  canEdit: boolean;
  unitName?: string;
  onStockChanged?: () => void;
};

const PRESET_DAYS = [14, 21, 28, 35] as const;
const ENTIRE_INVENTORY = "all";

function localDateTime(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(
  value: string | null | undefined,
  locale: string,
  includeTime = false,
) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function quantityLabel(
  quantity: number,
  unitName: string,
  numberFormat: Intl.NumberFormat,
  fallbackUnit: string,
) {
  const unit = unitName.trim() || fallbackUnit;
  return `${numberFormat.format(quantity)} ${unit}`;
}

function scheduleStatus(
  policy: InventoryCyclePolicy | null,
  t: TFunction,
  locale: string,
) {
  if (!policy) {
    return {
      label: t("cycle.schedule.notScheduled"),
      detail: t("cycle.schedule.notScheduledDetail"),
      tone: "bg-surface-muted text-muted",
    };
  }
  if (!policy.enabled) {
    return {
      label: t("cycle.schedule.paused"),
      detail: t("cycle.schedule.pausedDetail", {
        count: policy.intervalDays,
        value: new Intl.NumberFormat(locale).format(policy.intervalDays),
      }),
      tone: "bg-surface-muted text-muted",
    };
  }
  const dueAt = new Date(policy.nextDueAt);
  const difference = dueAt.getTime() - Date.now();
  const days = Math.ceil(difference / (24 * 60 * 60 * 1_000));
  if (difference <= 0) {
    return {
      label: t("cycle.schedule.countDue"),
      detail: t("cycle.schedule.dueDate", {
        date: formatDate(policy.nextDueAt, locale),
      }),
      tone: "bg-warning-soft text-warning",
    };
  }
  return {
    label: t("cycle.schedule.dueIn", {
      count: days,
      value: new Intl.NumberFormat(locale).format(days),
    }),
    detail: formatDate(policy.nextDueAt, locale),
    tone: "bg-success-soft text-success",
  };
}

export function InventoryCycleManager({
  resourceId,
  canEdit,
  unitName = "",
  onStockChanged,
}: InventoryCycleManagerProps) {
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [cycle, setCycle] = useState<InventoryCycle | null>(null);
  const [locations, setLocations] = useState<CountLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [submittingCount, setSubmittingCount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [intervalDays, setIntervalDays] = useState("28");
  const [customInterval, setCustomInterval] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [countTarget, setCountTarget] = useState(ENTIRE_INVENTORY);
  const [countedQuantity, setCountedQuantity] = useState("0");
  const [countedAt, setCountedAt] = useState(() => localDateTime());
  const [countNote, setCountNote] = useState("");

  const loadCycle = useCallback(
    async (quiet = false, resetCountForm = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [cycleResult, locationResult] = await Promise.all([
          fetchJson<CycleResponse>(
            `/api/v1/resources/${resourceId}/inventory-cycle`,
          ),
          fetchJson<LocationResponse>(
            `/api/v1/resources/${resourceId}/stock/locations`,
          ).catch(() => null),
        ]);
        setCycle(cycleResult.cycle);
        const savedInterval = cycleResult.cycle.policy?.intervalDays ?? 28;
        setEnabled(cycleResult.cycle.policy?.enabled ?? false);
        setIntervalDays(String(savedInterval));
        setCustomInterval(
          !PRESET_DAYS.includes(savedInterval as (typeof PRESET_DAYS)[number]),
        );

        const balances = new Map(
          (locationResult?.breakdown.locations ?? []).map((location) => [
            location.locationResourceId,
            location,
          ]),
        );
        const candidates = new Map<string, CountLocation>();
        for (const location of locationResult?.availableLocations ?? []) {
          if (location.id === resourceId || location.status === "archived") continue;
          candidates.set(location.id, {
            id: location.id,
            name: location.name,
            type: location.type,
            quantity: balances.get(location.id)?.quantity ?? 0,
          });
        }
        for (const balance of locationResult?.breakdown.locations ?? []) {
          if (!candidates.has(balance.locationResourceId)) {
            candidates.set(balance.locationResourceId, {
              id: balance.locationResourceId,
              name: balance.name,
              type: balance.type,
              quantity: balance.quantity,
            });
          }
        }
        setLocations(
          Array.from(candidates.values()).sort((left, right) =>
            left.name.localeCompare(right.name, locale),
          ),
        );
        if (!quiet || resetCountForm) {
          setCountTarget(ENTIRE_INVENTORY);
          setCountedQuantity(String(cycleResult.cycle.resource.quantity));
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("cycle.errors.load"),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [locale, resourceId, t],
  );

  useEffect(() => {
    void loadCycle();
  }, [loadCycle]);

  const locationById = useMemo(
    () => new Map(locations.map((location) => [location.id, location])),
    [locations],
  );
  const expectedQuantity =
    countTarget === ENTIRE_INVENTORY
      ? (cycle?.resource.quantity ?? 0)
      : (locationById.get(countTarget)?.quantity ?? 0);
  const status = scheduleStatus(cycle?.policy ?? null, t, locale);
  const lastCompletedAt =
    cycle?.policy?.lastCompletedAt ?? cycle?.history[0]?.countedAt ?? null;
  const parsedInterval = Number(intervalDays);
  const policyChanged =
    enabled !== (cycle?.policy?.enabled ?? false) ||
    parsedInterval !== (cycle?.policy?.intervalDays ?? 28);

  const chooseCountTarget = (target: string) => {
    setCountTarget(target);
    setCountedQuantity(
      String(
        target === ENTIRE_INVENTORY
          ? (cycle?.resource.quantity ?? 0)
          : (locationById.get(target)?.quantity ?? 0),
      ),
    );
  };

  const savePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !Number.isInteger(parsedInterval) ||
      parsedInterval < 1 ||
      parsedInterval > 3650
    ) {
      setError(t("cycle.errors.intervalRange"));
      return;
    }
    setSavingPolicy(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/inventory-cycle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalDays: parsedInterval, enabled }),
      });
      setNotice(
        enabled ? t("cycle.notices.saved") : t("cycle.notices.paused"),
      );
      await loadCycle(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("cycle.errors.save"),
      );
    } finally {
      setSavingPolicy(false);
    }
  };

  const submitCount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedCount = Number(countedQuantity);
    if (!Number.isInteger(parsedCount) || parsedCount < 0) {
      setError(t("cycle.errors.validCount"));
      return;
    }
    const countDate = new Date(countedAt);
    if (Number.isNaN(countDate.getTime())) {
      setError(t("cycle.errors.validDate"));
      return;
    }
    setSubmittingCount(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/inventory-counts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          countedQuantity: parsedCount,
          locationResourceId:
            countTarget === ENTIRE_INVENTORY ? null : countTarget,
          countedAt: countDate.toISOString(),
          ...(countNote.trim() ? { note: countNote.trim() } : {}),
        }),
      });
      const targetName =
        countTarget === ENTIRE_INVENTORY
          ? t("cycle.targets.entireInventorySentence")
          : (locationById.get(countTarget)?.name ??
            t("cycle.targets.selectedLocation"));
      setNotice(t("cycle.notices.recorded", { target: targetName }));
      setCountNote("");
      setCountedAt(localDateTime());
      setCountOpen(false);
      await loadCycle(true, true);
      onStockChanged?.();
    } catch (countError) {
      setError(
        countError instanceof Error
          ? countError.message
          : t("cycle.errors.record"),
      );
    } finally {
      setSubmittingCount(false);
    }
  };

  const completeSerializedReview = async () => {
    if (!cycle || !canEdit || cycle.resource.trackingMode !== "serialized") return;
    setSubmittingCount(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/inventory-counts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          countedQuantity: cycle.resource.quantity,
          countedAt: new Date().toISOString(),
          note: t("cycle.serialized.completedNote"),
        }),
      });
      setNotice(t("cycle.notices.serializedCompleted"));
      await loadCycle(true, true);
      onStockChanged?.();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : t("cycle.errors.serializedReview"),
      );
    } finally {
      setSubmittingCount(false);
    }
  };

  if (loading && !cycle) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <Skeleton className="h-10 w-60" />
        </div>
        <div className="space-y-3 p-5 sm:p-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    );
  }

  if (!cycle) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{t("cycle.unavailable.title")}</p>
            <p className="mt-1 text-xs leading-5 text-danger">
              {error || t("cycle.unavailable.description")}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              onClick={() => void loadCycle()}
            >
              {t("cycle.actions.tryAgain")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
            <CalendarClock className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("cycle.title")}</h2>
            <p className="mt-0.5 text-xs leading-4 text-muted">
              {t("cycle.description")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadCycle(true)}
          disabled={refreshing}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-muted-strong disabled:opacity-50"
          aria-label={t("cycle.actions.refresh")}
          title={t("cycle.actions.refresh")}
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {error ? (
        <div className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft px-3 py-2.5 text-xs text-danger sm:mx-6">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => setError(null)} aria-label={t("cycle.actions.dismissError")}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-xl border border-success-border bg-success-soft px-3 py-2.5 text-xs text-success sm:mx-6">
          <span className="flex items-center gap-2">
            <Check className="size-3.5 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("cycle.actions.dismissMessage")}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-6">
        <div className="rounded-2xl border border-border bg-surface-subtle/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {t("cycle.currentSchedule")}
              </p>
              <p className="mt-2 text-base font-semibold text-foreground">{status.label}</p>
              <p className="mt-1 text-[12px] leading-4 text-muted">{status.detail}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${status.tone}`}>
              {cycle.policy?.enabled
                ? t("cycle.state.active")
                : t("cycle.state.inactive")}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {t("cycle.lastCompleted")}
          </p>
          <p className="mt-2 text-sm font-semibold text-foreground">
            {formatDate(lastCompletedAt, locale)}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            {cycle.history.length
              ? t("cycle.recentCount", {
                  count: cycle.history.length,
                  value: numberFormat.format(cycle.history.length),
                })
              : t("cycle.noPhysicalCounts")}
          </p>
        </div>
      </div>

      <form onSubmit={savePolicy} className="border-y border-border px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={!canEdit}
                onClick={() => setEnabled((current) => !current)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  enabled ? "bg-success" : "bg-surface-hover"
                }`}
              >
                <span
                  className={`absolute top-0.5 grid size-5 place-items-center rounded-full bg-surface text-muted shadow-sm transition ${
                    enabled ? "left-[22px]" : "left-0.5"
                  }`}
                >
                  {enabled ? (
                    <Play className="size-2.5" aria-hidden="true" />
                  ) : (
                    <Pause className="size-2.5" aria-hidden="true" />
                  )}
                </span>
              </button>
              <div>
                <p className="text-xs font-semibold text-muted-strong">
                  {enabled
                    ? t("cycle.policy.enabled")
                    : t("cycle.policy.paused")}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {t("cycle.policy.pausedHelp")}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2">
              {PRESET_DAYS.map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => {
                    setCustomInterval(false);
                    setIntervalDays(String(days));
                  }}
                  className={`h-9 rounded-xl border px-3 text-[12px] font-semibold transition disabled:opacity-50 ${
                    !customInterval && parsedInterval === days
                      ? "border-success-border bg-success-soft text-success"
                      : "border-border bg-surface text-muted hover:border-border-strong"
                  }`}
                >
                  {t("cycle.policy.weeks", {
                    count: days / 7,
                    value: numberFormat.format(days / 7),
                  })}
                </button>
              ))}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setCustomInterval(true)}
                className={`h-9 rounded-xl border px-3 text-[12px] font-semibold transition disabled:opacity-50 ${
                  customInterval
                    ? "border-success-border bg-success-soft text-success"
                    : "border-border bg-surface text-muted hover:border-border-strong"
                }`}
              >
                {t("cycle.policy.custom")}
              </button>
              {customInterval ? (
                <label className="relative block">
                  <span className="sr-only">{t("cycle.policy.customDaysLabel")}</span>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    step="1"
                    required
                    disabled={!canEdit}
                    value={intervalDays}
                    onChange={(event) => setIntervalDays(event.target.value)}
                    className="h-9 w-28 rounded-xl border border-border bg-surface pl-3 pr-11 text-xs text-muted-strong outline-none focus:border-success focus:ring-4 focus:ring-success-border disabled:bg-surface-subtle"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">
                    {t("cycle.policy.days")}
                  </span>
                </label>
              ) : null}
            </div>
          </div>

          {canEdit ? (
            <Button type="submit" size="sm" disabled={savingPolicy || !policyChanged}>
              {savingPolicy ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-3.5" aria-hidden="true" />
              )}
              {t("cycle.actions.saveSchedule")}
            </Button>
          ) : (
            <p className="text-[11px] leading-4 text-muted">
              {t("cycle.policy.writeRequired")}
            </p>
          )}
        </div>
      </form>

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-success-soft text-success">
              <ClipboardCheck className="size-3.5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-xs font-semibold text-foreground">{t("cycle.count.title")}</h3>
              <p className="mt-1 text-[12px] leading-4 text-muted">
                {t("cycle.count.description")}
              </p>
            </div>
          </div>
          {canEdit && cycle.resource.trackingMode === "bulk" ? (
            <Button
              size="sm"
              variant={countOpen ? "ghost" : "secondary"}
              onClick={() => {
                setCountOpen((current) => !current);
                if (!countOpen) {
                  chooseCountTarget(ENTIRE_INVENTORY);
                  setCountedAt(localDateTime());
                }
              }}
            >
              {countOpen ? t("cycle.actions.cancel") : t("cycle.actions.countNow")}
            </Button>
          ) : null}
        </div>

        {cycle.resource.trackingMode === "serialized" ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-info-border bg-info-soft px-3.5 py-3 text-[12px] leading-4 text-info sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {t("cycle.serialized.description")}
              </span>
            </span>
            {canEdit ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={submittingCount}
                onClick={() => void completeSerializedReview()}
              >
                {submittingCount ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ClipboardCheck className="size-3.5" aria-hidden="true" />
                )}
                {t("cycle.actions.completeReview")}
              </Button>
            ) : null}
          </div>
        ) : !canEdit ? (
          <p className="mt-4 rounded-xl bg-surface-subtle px-3.5 py-3 text-[12px] leading-4 text-muted">
            {t("cycle.count.readOnly")}
          </p>
        ) : countOpen ? (
          <form onSubmit={submitCount} className="mt-5 rounded-2xl border border-success-border bg-success-soft/40 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-[12px] font-semibold text-muted">
                {t("cycle.count.scope")}
                <select
                  value={countTarget}
                  onChange={(event) => chooseCountTarget(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs text-muted-strong outline-none focus:border-success focus:ring-4 focus:ring-success-border"
                >
                  <option value={ENTIRE_INVENTORY}>
                    {t("cycle.count.entireExpected", {
                      quantity: numberFormat.format(cycle.resource.quantity),
                    })}
                  </option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {t("cycle.count.locationExpected", {
                        name: location.name,
                        quantity: numberFormat.format(location.quantity),
                      })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[12px] font-semibold text-muted">
                {t("cycle.count.countedQuantity")}
                <input
                  type="number"
                  min="0"
                  max="2000000000"
                  step="1"
                  required
                  value={countedQuantity}
                  onChange={(event) => setCountedQuantity(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs text-muted-strong outline-none focus:border-success focus:ring-4 focus:ring-success-border"
                />
              </label>
              <label className="block text-[12px] font-semibold text-muted">
                {t("cycle.count.countedAt")}
                <input
                  type="datetime-local"
                  required
                  value={countedAt}
                  onChange={(event) => setCountedAt(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs text-muted-strong outline-none focus:border-success focus:ring-4 focus:ring-success-border"
                />
              </label>
              <label className="block text-[12px] font-semibold text-muted">
                {t("cycle.count.note")} {" "}
                <span className="font-normal text-muted">
                  ({t("cycle.optional")})
                </span>
                <input
                  maxLength={20_000}
                  value={countNote}
                  onChange={(event) => setCountNote(event.target.value)}
                  placeholder={t("cycle.count.notePlaceholder")}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs text-muted-strong outline-none placeholder:text-muted focus:border-success focus:ring-4 focus:ring-success-border"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-success-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] leading-4 text-muted">
                {t("cycle.count.expected", {
                  quantity: quantityLabel(
                    expectedQuantity,
                    unitName,
                    numberFormat,
                    t("cycle.unit"),
                  ),
                })}{" "}
                · {t("cycle.count.variance")}{" "}
                <span className="font-semibold tabular-nums text-muted-strong">
                  {Number.isInteger(Number(countedQuantity))
                    ? `${Number(countedQuantity) - expectedQuantity >= 0 ? "+" : ""}${numberFormat.format(Number(countedQuantity) - expectedQuantity)}`
                    : "—"}
                </span>
              </p>
              <Button type="submit" size="sm" disabled={submittingCount}>
                {submittingCount ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ClipboardCheck className="size-3.5" aria-hidden="true" />
                )}
                {t("cycle.actions.recordCount")}
              </Button>
            </div>
            {countTarget === ENTIRE_INVENTORY && locations.some((location) => location.quantity > 0) ? (
              <p className="mt-3 text-[11px] leading-4 text-muted">
                {t("cycle.count.totalHelp")}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>

      <div className="border-t border-border">
        <div className="flex items-center gap-2 px-5 py-3.5 sm:px-6">
          <History className="size-3.5 text-muted" aria-hidden="true" />
          <h3 className="text-xs font-semibold text-muted-strong">{t("cycle.history.title")}</h3>
          <span className="ml-auto text-[11px] text-muted">{numberFormat.format(cycle.history.length)}</span>
        </div>
        {cycle.history.length ? (
          <div className="divide-y divide-border border-t border-border">
            {cycle.history.slice(0, 10).map((count) => {
              const location = count.locationResourceId
                ? locationById.get(count.locationResourceId)
                : null;
              return (
                <div
                  key={count.id}
                  className="grid gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_120px_100px] sm:items-center sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-muted-strong">
                      {count.locationResourceId ? (
                        <MapPin className="size-3 shrink-0 text-muted" aria-hidden="true" />
                      ) : (
                        <ClipboardCheck className="size-3 shrink-0 text-muted" aria-hidden="true" />
                      )}
                      <span className="truncate">
                        {location?.name ??
                          (count.locationResourceId
                            ? t("cycle.history.unknownLocation")
                            : t("cycle.targets.entireInventory"))}
                      </span>
                    </p>
                    <p className="mt-1 truncate text-[11px] text-muted">
                      {t("cycle.history.quantities", {
                        expected: numberFormat.format(count.expectedQuantity),
                        counted: numberFormat.format(count.countedQuantity),
                      })}
                      {count.note ? ` · ${count.note}` : ""}
                    </p>
                  </div>
                  <span
                    className={`w-fit rounded-lg px-2 py-1 text-[12px] font-bold tabular-nums ${
                      count.variance > 0
                        ? "bg-success-soft text-success"
                        : count.variance < 0
                          ? "bg-danger-soft text-danger"
                          : "bg-surface-muted text-muted"
                    }`}
                  >
                    {count.variance > 0 ? "+" : ""}
                    {numberFormat.format(count.variance)}
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted sm:block">
                    <Clock3 className="size-3 sm:hidden" aria-hidden="true" />
                    <p>{formatDate(count.countedAt, locale)}</p>
                    <p className="mt-0.5 hidden truncate text-[10px] sm:block">
                      {count.createdBy || t("cycle.history.system")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border-t border-border px-6 py-9 text-center">
            <ClipboardCheck className="mx-auto size-5 text-muted" aria-hidden="true" />
            <p className="mt-2 text-xs font-semibold text-muted">{t("cycle.history.emptyTitle")}</p>
            <p className="mt-1 text-[11px] text-muted">
              {t("cycle.history.emptyDescription")}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
