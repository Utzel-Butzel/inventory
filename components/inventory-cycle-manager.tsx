"use client";

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

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function quantityLabel(quantity: number, unitName: string) {
  const unit = unitName.trim() || "unit";
  return `${quantity.toLocaleString()} ${unit}${quantity === 1 ? "" : "s"}`;
}

function scheduleStatus(policy: InventoryCyclePolicy | null) {
  if (!policy) {
    return {
      label: "Not scheduled",
      detail: "Choose a cadence to make physical checks routine.",
      tone: "bg-slate-100 text-slate-600",
    };
  }
  if (!policy.enabled) {
    return {
      label: "Paused",
      detail: `The saved cadence is every ${policy.intervalDays} days.`,
      tone: "bg-slate-100 text-slate-600",
    };
  }
  const dueAt = new Date(policy.nextDueAt);
  const difference = dueAt.getTime() - Date.now();
  const days = Math.ceil(difference / (24 * 60 * 60 * 1_000));
  if (difference <= 0) {
    return {
      label: "Count due",
      detail: `Due ${formatDate(policy.nextDueAt)}.`,
      tone: "bg-amber-100 text-amber-800",
    };
  }
  return {
    label: days === 1 ? "Due tomorrow" : `Due in ${days} days`,
    detail: formatDate(policy.nextDueAt),
    tone: "bg-emerald-100 text-emerald-800",
  };
}

export function InventoryCycleManager({
  resourceId,
  canEdit,
  unitName = "unit",
  onStockChanged,
}: InventoryCycleManagerProps) {
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
            left.name.localeCompare(right.name),
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
            : "Unable to load the inventory cycle.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [resourceId],
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
  const status = scheduleStatus(cycle?.policy ?? null);
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
      setError("The cycle must be between 1 and 3,650 whole days.");
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
      setNotice(enabled ? "Inventory cycle saved." : "Inventory cycle paused.");
      await loadCycle(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save the inventory cycle.",
      );
    } finally {
      setSavingPolicy(false);
    }
  };

  const submitCount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedCount = Number(countedQuantity);
    if (!Number.isInteger(parsedCount) || parsedCount < 0) {
      setError("Enter a non-negative whole-number count.");
      return;
    }
    const countDate = new Date(countedAt);
    if (Number.isNaN(countDate.getTime())) {
      setError("Choose a valid count date and time.");
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
          ? "the entire inventory"
          : (locationById.get(countTarget)?.name ?? "the selected location");
      setNotice(`Count recorded for ${targetName}.`);
      setCountNote("");
      setCountedAt(localDateTime());
      setCountOpen(false);
      await loadCycle(true, true);
      onStockChanged?.();
    } catch (countError) {
      setError(
        countError instanceof Error
          ? countError.message
          : "Unable to record this inventory count.",
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
          note: "Serialized unit review completed",
        }),
      });
      setNotice("Serialized unit review completed.");
      await loadCycle(true, true);
      onStockChanged?.();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Unable to complete the serialized inventory review.",
      );
    } finally {
      setSubmittingCount(false);
    }
  };

  if (loading && !cycle) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
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
        <div className="flex items-start gap-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Inventory cycle is unavailable</p>
            <p className="mt-1 text-xs leading-5 text-rose-600">
              {error || "Cycle data could not be loaded."}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              onClick={() => void loadCycle()}
            >
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
            <CalendarClock className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Inventory cycle</h2>
            <p className="mt-0.5 text-xs leading-4 text-slate-600">
              Schedule recurring physical counts and reconcile discrepancies.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadCycle(true)}
          disabled={refreshing}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          aria-label="Refresh inventory cycle"
          title="Refresh inventory cycle"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {error ? (
        <div className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700 sm:mx-6">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 sm:mx-6">
          <span className="flex items-center gap-2">
            <Check className="size-3.5 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Current schedule
              </p>
              <p className="mt-2 text-base font-semibold text-slate-950">{status.label}</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">{status.detail}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${status.tone}`}>
              {cycle.policy?.enabled ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Last completed
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            {formatDate(lastCompletedAt)}
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            {cycle.history.length
              ? `${cycle.history.length} recent ${cycle.history.length === 1 ? "count" : "counts"}`
              : "No physical counts yet"}
          </p>
        </div>
      </div>

      <form onSubmit={savePolicy} className="border-y border-slate-100 px-5 py-5 sm:px-6">
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
                  enabled ? "bg-emerald-600" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 grid size-5 place-items-center rounded-full bg-white text-slate-600 shadow-sm transition ${
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
                <p className="text-xs font-semibold text-slate-800">
                  {enabled ? "Recurring counts enabled" : "Recurring counts paused"}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-600">
                  Counts can still be recorded while the reminder is paused.
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
                  className={`h-9 rounded-xl border px-3 text-[11px] font-semibold transition disabled:opacity-50 ${
                    !customInterval && parsedInterval === days
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {days / 7} weeks
                </button>
              ))}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setCustomInterval(true)}
                className={`h-9 rounded-xl border px-3 text-[11px] font-semibold transition disabled:opacity-50 ${
                  customInterval
                    ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                Custom
              </button>
              {customInterval ? (
                <label className="relative block">
                  <span className="sr-only">Custom interval in days</span>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    step="1"
                    required
                    disabled={!canEdit}
                    value={intervalDays}
                    onChange={(event) => setIntervalDays(event.target.value)}
                    className="h-9 w-28 rounded-xl border border-slate-200 bg-white pl-3 pr-11 text-xs text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:bg-slate-50"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">
                    days
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
              Save schedule
            </Button>
          ) : (
            <p className="text-[10px] leading-4 text-slate-600">
              Write access is required to change the schedule.
            </p>
          )}
        </div>
      </form>

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
              <ClipboardCheck className="size-3.5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-xs font-semibold text-slate-900">Physical count</h3>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Record what is physically present; any variance becomes an audited adjustment.
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
              {countOpen ? "Cancel" : "Count now"}
            </Button>
          ) : null}
        </div>

        {cycle.resource.trackingMode === "serialized" ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-[11px] leading-4 text-blue-700 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Review or scan each identified unit and correct its status first. Then
                complete the review without breaking unit-level traceability.
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
                Complete review
              </Button>
            ) : null}
          </div>
        ) : !canEdit ? (
          <p className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3 text-[11px] leading-4 text-slate-600">
            You can review completed counts. Recording a new count requires write access.
          </p>
        ) : countOpen ? (
          <form onSubmit={submitCount} className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-[11px] font-semibold text-slate-600">
                Count scope
                <select
                  value={countTarget}
                  onChange={(event) => chooseCountTarget(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                >
                  <option value={ENTIRE_INVENTORY}>
                    Entire inventory · expected {cycle.resource.quantity}
                  </option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} · expected {location.quantity}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-slate-600">
                Counted quantity
                <input
                  type="number"
                  min="0"
                  max="2000000000"
                  step="1"
                  required
                  value={countedQuantity}
                  onChange={(event) => setCountedQuantity(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
              <label className="block text-[11px] font-semibold text-slate-600">
                Counted at
                <input
                  type="datetime-local"
                  required
                  value={countedAt}
                  onChange={(event) => setCountedAt(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
              <label className="block text-[11px] font-semibold text-slate-600">
                Note <span className="font-normal text-slate-600">(optional)</span>
                <input
                  maxLength={20_000}
                  value={countNote}
                  onChange={(event) => setCountNote(event.target.value)}
                  placeholder="Reason or observation"
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none placeholder:text-slate-600 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-3 border-t border-emerald-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[10px] leading-4 text-slate-600">
                Expected {quantityLabel(expectedQuantity, unitName)} · variance{" "}
                <span className="font-semibold tabular-nums text-slate-700">
                  {Number.isInteger(Number(countedQuantity))
                    ? `${Number(countedQuantity) - expectedQuantity >= 0 ? "+" : ""}${Number(countedQuantity) - expectedQuantity}`
                    : "—"}
                </span>
              </p>
              <Button type="submit" size="sm" disabled={submittingCount}>
                {submittingCount ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ClipboardCheck className="size-3.5" aria-hidden="true" />
                )}
                Record count
              </Button>
            </div>
            {countTarget === ENTIRE_INVENTORY && locations.some((location) => location.quantity > 0) ? (
              <p className="mt-3 text-[10px] leading-4 text-slate-600">
                A total count reconciles unassigned stock. To correct one stored balance,
                select that location instead.
              </p>
            ) : null}
          </form>
        ) : null}
      </div>

      <div className="border-t border-slate-100">
        <div className="flex items-center gap-2 px-5 py-3.5 sm:px-6">
          <History className="size-3.5 text-slate-600" aria-hidden="true" />
          <h3 className="text-xs font-semibold text-slate-800">Recent counts</h3>
          <span className="ml-auto text-[10px] text-slate-600">{cycle.history.length}</span>
        </div>
        {cycle.history.length ? (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
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
                    <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-slate-800">
                      {count.locationResourceId ? (
                        <MapPin className="size-3 shrink-0 text-slate-600" aria-hidden="true" />
                      ) : (
                        <ClipboardCheck className="size-3 shrink-0 text-slate-600" aria-hidden="true" />
                      )}
                      <span className="truncate">
                        {location?.name ??
                          (count.locationResourceId ? "Unknown location" : "Entire inventory")}
                      </span>
                    </p>
                    <p className="mt-1 truncate text-[10px] text-slate-600">
                      {count.expectedQuantity.toLocaleString()} expected →{" "}
                      {count.countedQuantity.toLocaleString()} counted
                      {count.note ? ` · ${count.note}` : ""}
                    </p>
                  </div>
                  <span
                    className={`w-fit rounded-lg px-2 py-1 text-[11px] font-bold tabular-nums ${
                      count.variance > 0
                        ? "bg-emerald-50 text-emerald-700"
                        : count.variance < 0
                          ? "bg-rose-50 text-rose-700"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {count.variance > 0 ? "+" : ""}
                    {count.variance}
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-600 sm:block">
                    <Clock3 className="size-3 sm:hidden" aria-hidden="true" />
                    <p>{formatDate(count.countedAt)}</p>
                    <p className="mt-0.5 hidden truncate text-[9px] sm:block">
                      {count.createdBy || "System"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border-t border-slate-100 px-6 py-9 text-center">
            <ClipboardCheck className="mx-auto size-5 text-slate-600" aria-hidden="true" />
            <p className="mt-2 text-xs font-semibold text-slate-600">No counts recorded</p>
            <p className="mt-1 text-[10px] text-slate-600">
              The first physical check will appear here with its variance.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
