"use client";

import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  LoaderCircle,
  MapPin,
  MoveRight,
  PackageOpen,
  RefreshCw,
  Warehouse,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { Button, Card, Skeleton } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

type TrackingMode = "bulk" | "serialized";

type LocationBalance = {
  locationResourceId: string;
  name: string;
  type: string;
  quantity: number;
};

type AvailableLocation = {
  id: string;
  name: string;
  type: string;
  status: string;
};

type LocationBreakdown = {
  resource: {
    id: string;
    name: string;
    quantity: number;
    trackingMode: TrackingMode | null;
  };
  trackingMode: TrackingMode;
  assignedQuantity: number;
  unassignedQuantity: number;
  locations: LocationBalance[];
};

type LocationsResponse = {
  breakdown: LocationBreakdown;
  availableLocations: AvailableLocation[];
};

export type StockLocationsManagerProps = {
  resourceId: string;
  canEdit: boolean;
  unitName?: string;
  onStockChanged?: () => void;
};

const UNASSIGNED = "unassigned";

function quantityLabel(
  quantity: number,
  unitName: string,
  numberFormat: Intl.NumberFormat,
  fallbackUnit: string,
) {
  const unit = unitName.trim() || fallbackUnit;
  return `${numberFormat.format(quantity)} ${unit}`;
}

export function StockLocationsManager({
  resourceId,
  canEdit,
  unitName = "",
  onStockChanged,
}: StockLocationsManagerProps) {
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [data, setData] = useState<LocationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [source, setSource] = useState(UNASSIGNED);
  const [destination, setDestination] = useState("");
  const [quantity, setQuantity] = useState("1");

  const loadLocations = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await fetchJson<LocationsResponse>(
          `/api/v1/resources/${resourceId}/stock/locations`,
        );
        setData(result);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("locations.errors.load"),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [resourceId, t],
  );

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const sourceOptions = useMemo(() => {
    if (!data) return [];
    return [
      ...(data.breakdown.unassignedQuantity > 0
        ? [
            {
              id: UNASSIGNED,
              name: t("locations.unassigned"),
              quantity: data.breakdown.unassignedQuantity,
            },
          ]
        : []),
      ...data.breakdown.locations
        .filter((location) => location.quantity > 0)
        .map((location) => ({
          id: location.locationResourceId,
          name: location.name,
          quantity: location.quantity,
        })),
    ];
  }, [data, t]);

  const destinationOptions = useMemo(() => {
    if (!data) return [];
    return [
      { id: UNASSIGNED, name: t("locations.unassigned") },
      ...data.availableLocations
        .filter(
          (location) =>
            location.id !== resourceId && location.status !== "archived",
        )
        .map((location) => ({ id: location.id, name: location.name })),
    ];
  }, [data, resourceId, t]);

  useEffect(() => {
    if (!sourceOptions.length) {
      setSource(UNASSIGNED);
      setDestination("");
      return;
    }
    const validSource = sourceOptions.some((option) => option.id === source);
    const nextSource = validSource ? source : sourceOptions[0].id;
    if (!validSource) setSource(nextSource);
    const validDestination = destinationOptions.some(
      (option) => option.id === destination && option.id !== nextSource,
    );
    if (!validDestination) {
      setDestination(
        destinationOptions.find((option) => option.id !== nextSource)?.id ?? "",
      );
    }
  }, [destination, destinationOptions, source, sourceOptions]);

  const sourceQuantity =
    sourceOptions.find((option) => option.id === source)?.quantity ?? 0;

  useEffect(() => {
    const parsedQuantity = Number(quantity);
    if (sourceQuantity > 0 && parsedQuantity > sourceQuantity) {
      setQuantity(String(sourceQuantity));
    }
  }, [quantity, sourceQuantity]);

  const nameForLocation = (id: string) =>
    id === UNASSIGNED
      ? t("locations.unassigned")
      : destinationOptions.find((option) => option.id === id)?.name ??
        sourceOptions.find((option) => option.id === id)?.name ??
        t("locations.locationFallback");

  const submitTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data || data.breakdown.trackingMode !== "bulk") return;
    const parsedQuantity = Number(quantity);
    if (
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > sourceQuantity ||
      !destination ||
      destination === source
    ) {
      setError(t("locations.errors.validTransfer"));
      return;
    }

    const sourceName = nameForLocation(source);
    const destinationName = nameForLocation(destination);
    const movementLocation = `${sourceName} → ${destinationName}`.slice(0, 240);
    setPosting(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/stock/movements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          delta: 0,
          quantity: parsedQuantity,
          type: "transfer",
          reason: t("locations.transferReason"),
          location: movementLocation,
          fromLocationResourceId: source === UNASSIGNED ? null : source,
          toLocationResourceId:
            destination === UNASSIGNED ? null : destination,
        }),
      });
      setNotice(
        t("locations.notices.moved", {
          quantity: quantityLabel(
            parsedQuantity,
            unitName,
            numberFormat,
            t("locations.unit"),
          ),
          source: sourceName,
          destination: destinationName,
        }),
      );
      setQuantity("1");
      await loadLocations(true);
      onStockChanged?.();
    } catch (transferError) {
      setError(
        transferError instanceof Error
          ? transferError.message
          : t("locations.errors.move"),
      );
    } finally {
      setPosting(false);
    }
  };

  if (loading && !data) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4 sm:px-6">
          <Skeleton className="h-10 w-56" />
        </div>
        <div className="space-y-3 p-5 sm:p-6">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{t("locations.unavailable.title")}</p>
            <p className="mt-1 text-xs leading-5 text-danger">
              {error || t("locations.unavailable.description")}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              onClick={() => void loadLocations()}
            >
              {t("locations.actions.tryAgain")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const totalQuantity = data.breakdown.resource.quantity;
  const hasStock = totalQuantity > 0;
  const hasTransferDestination = destinationOptions.some(
    (option) => option.id !== source,
  );
  const transferDisabled =
    !canEdit ||
    data.breakdown.trackingMode !== "bulk" ||
    sourceOptions.length === 0 ||
    !hasTransferDestination;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Warehouse className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("locations.title")}</h2>
            <p className="mt-0.5 text-xs leading-4 text-muted">
              {t("locations.description")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadLocations(true)}
          disabled={refreshing}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-muted-strong disabled:opacity-50"
          aria-label={t("locations.actions.refresh")}
          title={t("locations.actions.refresh")}
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
          <button type="button" onClick={() => setError(null)} aria-label={t("locations.actions.dismissError")}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mx-5 mt-4 flex items-start justify-between gap-3 rounded-xl border border-success-border bg-success-soft px-3 py-2.5 text-xs text-success sm:mx-6">
          <span className="flex items-center gap-2">
            <Check className="size-3.5 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("locations.actions.dismissMessage")}>
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
        <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{t("locations.metrics.total")}</p>
          <p className="mt-1.5 text-xl font-semibold tracking-tight text-foreground">
            {numberFormat.format(totalQuantity)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{t("locations.metrics.assigned")}</p>
          <p className="mt-1.5 text-xl font-semibold tracking-tight text-foreground">
            {numberFormat.format(data.breakdown.assignedQuantity)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{t("locations.unassigned")}</p>
          <p className="mt-1.5 text-xl font-semibold tracking-tight text-foreground">
            {numberFormat.format(data.breakdown.unassignedQuantity)}
          </p>
        </div>
      </div>

      <div className="border-y border-border">
        {!hasStock ? (
          <div className="px-6 py-10 text-center">
            <PackageOpen className="mx-auto size-6 text-muted" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-muted-strong">{t("locations.empty.title")}</p>
            <p className="mt-1 text-xs text-muted">
              {t("locations.empty.description")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted">
                <Boxes className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-xs font-semibold text-foreground">{t("locations.unassigned")}</p>
                  <p className="shrink-0 text-xs font-semibold tabular-nums text-muted-strong">
                    {numberFormat.format(data.breakdown.unassignedQuantity)}
                  </p>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-border-strong"
                    style={{
                      width: `${Math.min(100, (data.breakdown.unassignedQuantity / Math.max(1, totalQuantity)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
            {data.breakdown.locations
              .filter((location) => location.quantity > 0)
              .map((location) => (
                <div
                  key={location.locationResourceId}
                  className="flex items-center gap-3 px-5 py-3.5 sm:px-6"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                    <MapPin className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {location.name}
                        </p>
                        <p className="mt-0.5 text-[10px] capitalize text-muted">
                          {t(`locations.types.${location.type}`, {
                            defaultValue: location.type,
                          })}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs font-semibold tabular-nums text-muted-strong">
                        {numberFormat.format(location.quantity)}
                      </p>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-brand-soft0"
                        style={{
                          width: `${Math.min(100, (location.quantity / Math.max(1, totalQuantity)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {canEdit ? (
        <form onSubmit={submitTransfer} className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-foreground">{t("locations.move.title")}</h3>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                {t("locations.move.description")}
              </p>
            </div>
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-semibold capitalize text-muted">
              {t(`locations.tracking.${data.breakdown.trackingMode}`)}
            </span>
          </div>

          {data.breakdown.trackingMode === "serialized" ? (
            <div className="flex items-start gap-2 rounded-xl border border-info-border bg-info-soft px-3.5 py-3 text-[11px] leading-4 text-info">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t("locations.move.serializedHelp")}
            </div>
          ) : sourceOptions.length === 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-subtle px-3.5 py-3 text-[11px] leading-4 text-muted">
              <PackageOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t("locations.move.noStock")}
            </div>
          ) : !hasTransferDestination ? (
            <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-3 text-[11px] leading-4 text-warning">
              <Warehouse className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {t("locations.move.noDestination")}
            </div>
          ) : (
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_100px]">
              <label className="block text-[11px] font-semibold text-muted">
                {t("locations.move.from")}
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  disabled={transferDisabled}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs text-foreground outline-none focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle"
                >
                  {sourceOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {numberFormat.format(option.quantity)}
                    </option>
                  ))}
                </select>
              </label>
              <MoveRight className="mb-3 hidden size-4 text-muted sm:block" aria-hidden="true" />
              <label className="block text-[11px] font-semibold text-muted">
                {t("locations.move.to")}
                <select
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  disabled={transferDisabled}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs text-foreground outline-none focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle"
                >
                  {destinationOptions
                    .filter((option) => option.id !== source)
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-muted">
                {t("locations.move.quantity")}
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, sourceQuantity)}
                  step="1"
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={transferDisabled}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-xs text-foreground outline-none focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle"
                />
              </label>
            </div>
          )}

          {data.breakdown.trackingMode === "bulk" &&
          sourceOptions.length > 0 &&
          hasTransferDestination ? (
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
              <p className="text-[10px] text-muted">
                {sourceQuantity > 0
                  ? t("locations.move.availableAtSource", {
                      quantity: quantityLabel(
                        sourceQuantity,
                        unitName,
                        numberFormat,
                        t("locations.unit"),
                      ),
                    })
                  : t("locations.move.noneAtSource")}
              </p>
              <Button type="submit" size="sm" disabled={transferDisabled || posting}>
                {posting ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                )}
                {t("locations.move.action")}
              </Button>
            </div>
          ) : null}
        </form>
      ) : (
        <div className="px-5 py-4 text-[11px] leading-5 text-muted sm:px-6">
          {t("locations.readOnly")}
        </div>
      )}
    </Card>
  );
}
