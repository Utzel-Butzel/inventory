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

function quantityLabel(quantity: number, unitName: string) {
  const unit = unitName.trim() || "unit";
  return `${quantity.toLocaleString()} ${unit}${quantity === 1 ? "" : "s"}`;
}

export function StockLocationsManager({
  resourceId,
  canEdit,
  unitName = "unit",
  onStockChanged,
}: StockLocationsManagerProps) {
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
            : "Unable to load stock locations.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [resourceId],
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
              name: "Unassigned",
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
  }, [data]);

  const destinationOptions = useMemo(() => {
    if (!data) return [];
    return [
      { id: UNASSIGNED, name: "Unassigned" },
      ...data.availableLocations
        .filter(
          (location) =>
            location.id !== resourceId && location.status !== "archived",
        )
        .map((location) => ({ id: location.id, name: location.name })),
    ];
  }, [data, resourceId]);

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
      ? "Unassigned"
      : destinationOptions.find((option) => option.id === id)?.name ??
        sourceOptions.find((option) => option.id === id)?.name ??
        "Location";

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
      setError("Choose two different locations and a valid whole-number quantity.");
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
          reason: "Stock location transfer",
          location: movementLocation,
          fromLocationResourceId: source === UNASSIGNED ? null : source,
          toLocationResourceId:
            destination === UNASSIGNED ? null : destination,
        }),
      });
      setNotice(
        `Moved ${quantityLabel(parsedQuantity, unitName)} from ${sourceName} to ${destinationName}.`,
      );
      setQuantity("1");
      await loadLocations(true);
      onStockChanged?.();
    } catch (transferError) {
      setError(
        transferError instanceof Error
          ? transferError.message
          : "Unable to move this stock.",
      );
    } finally {
      setPosting(false);
    }
  };

  if (loading && !data) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
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
        <div className="flex items-start gap-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Stock locations are unavailable</p>
            <p className="mt-1 text-xs leading-5 text-rose-600">
              {error || "The location breakdown could not be loaded."}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-4"
              onClick={() => void loadLocations()}
            >
              Try again
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
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700">
            <Warehouse className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Stock by location</h2>
            <p className="mt-0.5 text-xs leading-4 text-slate-600">
              The total stays simple; expand it only when placement matters.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadLocations(true)}
          disabled={refreshing}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          aria-label="Refresh stock locations"
          title="Refresh stock locations"
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

      <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Total</p>
          <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950">
            {totalQuantity.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Assigned</p>
          <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950">
            {data.breakdown.assignedQuantity.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Unassigned</p>
          <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950">
            {data.breakdown.unassignedQuantity.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="border-y border-slate-100">
        {!hasStock ? (
          <div className="px-6 py-10 text-center">
            <PackageOpen className="mx-auto size-6 text-slate-600" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No stock to place</p>
            <p className="mt-1 text-xs text-slate-600">
              Book stock in first, then assign it to a location.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                <Boxes className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-xs font-semibold text-slate-800">Unassigned</p>
                  <p className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                    {data.breakdown.unassignedQuantity.toLocaleString()}
                  </p>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-400"
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
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600">
                    <MapPin className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-800">
                          {location.name}
                        </p>
                        <p className="mt-0.5 text-[10px] capitalize text-slate-600">
                          {location.type}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                        {location.quantity.toLocaleString()}
                      </p>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-violet-500"
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
              <h3 className="text-xs font-semibold text-slate-900">Move stock</h3>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Transfers change only where stock is stored, never the total.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-600">
              {data.breakdown.trackingMode}
            </span>
          </div>

          {data.breakdown.trackingMode === "serialized" ? (
            <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-[11px] leading-4 text-blue-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Move serialized stock by editing the individual unit. This keeps each
              physical item and its location history in sync.
            </div>
          ) : sourceOptions.length === 0 ? (
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[11px] leading-4 text-slate-600">
              <PackageOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              There is no stock available to move. Book stock in before assigning a
              structured location.
            </div>
          ) : !hasTransferDestination ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50 px-3.5 py-3 text-[11px] leading-4 text-amber-700">
              <Warehouse className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Create an inventory item whose type can contain stock before assigning a
              structured location.
            </div>
          ) : (
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_100px]">
              <label className="block text-[11px] font-semibold text-slate-600">
                From
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  disabled={transferDisabled}
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:bg-slate-50"
                >
                  {sourceOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {option.quantity}
                    </option>
                  ))}
                </select>
              </label>
              <MoveRight className="mb-3 hidden size-4 text-slate-600 sm:block" aria-hidden="true" />
              <label className="block text-[11px] font-semibold text-slate-600">
                To
                <select
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  disabled={transferDisabled}
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:bg-slate-50"
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
              <label className="block text-[11px] font-semibold text-slate-600">
                Quantity
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, sourceQuantity)}
                  step="1"
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={transferDisabled}
                  className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:bg-slate-50"
                />
              </label>
            </div>
          )}

          {data.breakdown.trackingMode === "bulk" &&
          sourceOptions.length > 0 &&
          hasTransferDestination ? (
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <p className="text-[10px] text-slate-600">
                {sourceQuantity > 0
                  ? `${quantityLabel(sourceQuantity, unitName)} available at source`
                  : "No stock available at the source"}
              </p>
              <Button type="submit" size="sm" disabled={transferDisabled || posting}>
                {posting ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                )}
                Move stock
              </Button>
            </div>
          ) : null}
        </form>
      ) : (
        <div className="px-5 py-4 text-[11px] leading-5 text-slate-600 sm:px-6">
          You can review location balances. Editing requires inventory write access.
        </div>
      )}
    </Card>
  );
}
