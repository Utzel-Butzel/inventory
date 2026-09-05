"use client";

import {
  OrganizationLink as Link,
  useOrganizationAllowsNegativeStock,
} from "@/components/organization-routing";
import {
  AlertTriangle,
  Boxes,
  Check,
  LoaderCircle,
  PackageMinus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AssemblyManager } from "@/components/assembly-manager";
import { StockLocationsManager } from "@/components/stock-locations-manager";
import { fetchJson } from "@/lib/client-types";
import {
  isCustomFieldDefinitionApplicable,
  type CustomFieldDefinition,
} from "@/lib/custom-field-contract";
import { hasPurchaseUnit } from "@/lib/stock-quantity-units";

import { StockBooking } from "./resource-stock/booking";
import {
  defaultMovementForm,
  normalizeStock,
  quantityLabel,
} from "./resource-stock/model";
import { StockMovementHistory } from "./resource-stock/movement-history";
import type {
  CustomFieldsApiResponse,
  MovementForm,
  StockApiResponse,
  StockContact,
  StockData,
  StockLocationOption,
  StockLocationsApiResponse,
} from "./resource-stock/types";
import { StockUnits } from "./resource-stock/units";
import { useStockMovements } from "./resource-stock/use-stock-movements";
import { useStockUnits } from "./resource-stock/use-stock-units";

export function ResourceStockManager({
  resourceId,
  canEdit = false,
}: {
  resourceId: string;
  canEdit?: boolean;
}) {
  const allowNegativeStock = useOrganizationAllowsNegativeStock();
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const endpoint = `/api/v1/resources/${resourceId}/stock`;
  const customFieldsEndpoint = "/api/v1/custom-fields?entityType=stock_unit";
  const [stock, setStock] = useState<StockData | null>(null);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<
    CustomFieldDefinition[]
  >([]);
  const [customFieldError, setCustomFieldError] = useState<string | null>(null);
  const [availableLocations, setAvailableLocations] = useState<StockLocationOption[]>([]);
  const [availableContacts, setAvailableContacts] = useState<StockContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [movementForm, setMovementForm] = useState<MovementForm>(
    defaultMovementForm("in"),
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ contacts: StockContact[] }>(
      "/api/v1/contacts?includeArchived=true",
      { cache: "no-store", signal: controller.signal },
    )
      .then((payload) => setAvailableContacts(payload.contacts ?? []))
      .catch((contactError: unknown) => {
        if (!(contactError instanceof DOMException && contactError.name === "AbortError")) {
          setAvailableContacts([]);
        }
      });
    return () => controller.abort();
  }, []);

  const loadStock = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      setCustomFieldError(null);
      try {
        const [payload, definitionsResult, locationsResult] = await Promise.all([
          fetchJson<StockApiResponse>(endpoint, { cache: "no-store" }),
          fetchJson<CustomFieldsApiResponse>(customFieldsEndpoint, {
            cache: "no-store",
          }).then(
            (value) => ({ value, error: null }),
            (definitionError: unknown) => ({
              value: null,
              error:
                definitionError instanceof Error
                  ? definitionError.message
                  : t("resource.errors.customFields"),
            }),
          ),
          fetchJson<StockLocationsApiResponse>(`${endpoint}/locations`, {
            cache: "no-store",
          }).catch(() => null),
        ]);
        const normalized = normalizeStock(payload, t);
        setStock(normalized);
        if (!quiet && hasPurchaseUnit(normalized.config)) {
          setMovementForm((current) => ({
            ...current,
            quantityUnit: "purchase",
          }));
        }
        if (definitionsResult.value) {
          setCustomFieldDefinitions(definitionsResult.value.definitions);
        } else {
          setCustomFieldError(definitionsResult.error);
        }
        if (locationsResult) {
          setAvailableLocations(
            locationsResult.availableLocations.filter(
              (location) => location.id !== resourceId && location.status !== "archived",
            ),
          );
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("resource.errors.load"),
        );
      } finally {
        setLoading(false);
      }
    },
    [customFieldsEndpoint, endpoint, resourceId, t],
  );

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  const currentQuantity = stock?.resource.quantity ?? 0;
  const unitName = stock?.config.unitName || t("resource.unit");
  const onOrder = stock?.procurement.onOrder ?? 0;
  const applicableCustomFields = useMemo(
    () =>
      stock
        ? customFieldDefinitions.filter((definition) =>
          isCustomFieldDefinitionApplicable(definition, {
            type: stock.resource.type,
            categories: stock.resource.categories,
          }),
        )
        : [],
    [customFieldDefinitions, stock],
  );

  const mutationContext = {
    stock,
    endpoint,
    loadStock,
    setError,
    setNotice,
    unitName,
    numberFormat,
    t,
  };
  const movements = useStockMovements({
    ...mutationContext,
    allowNegativeStock,
    movementForm,
    setMovementForm,
  });
  const units = useStockUnits(mutationContext);
  const { pendingMovement, setPendingMovement, postingMovement, postMovement } = movements;

  if (loading) {
    return (
      <div className="grid min-h-[calc(100dvh-68px)] place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-border bg-surface text-brand shadow-sm">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-muted">
            {t("resource.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (!stock) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <div className="rounded-2xl border border-danger-border bg-surface px-6 py-12 shadow-sm">
          <AlertTriangle className="mx-auto size-7 text-danger" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold text-foreground">
            {t("resource.unavailable.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            {error ?? t("resource.unavailable.description")}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link
              href={`/inventory/${resourceId}`}
              className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-muted-strong hover:bg-surface-hover"
            >
              {t("resource.actions.backToItem")}
            </Link>
            <button
              type="button"
              onClick={() => void loadStock()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong hover:opacity-90"
            >
              <RefreshCw className="size-4" aria-hidden="true" />{" "}
              {t("resource.actions.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const forecast = stock.forecast;
  const minimum = stock.config.minimumStock;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {stock.resource.name}
            </h1>
            <span className="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-brand">
              {t(`resource.tracking.${stock.config.trackingMode}`)}
            </span>
          </div>
        </div>
        {canEdit ? (
          <Link
            href={`/inventory/${resourceId}/edit#stock-settings`}
            className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:bg-surface-hover"
            aria-label={t("resource.settings.title")}
            title={t("resource.settings.title")}
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </header>

      {error ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => setError(null)} aria-label={t("resource.actions.dismissError")}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          <span className="flex items-center gap-2">
            <Check className="size-4 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("resource.actions.dismissMessage")}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div>
        <div className="space-y-5">
          <StockBooking
            stock={stock}
            t={t}
            unitName={unitName}
            numberFormat={numberFormat}
            resourceId={resourceId}
            availableContacts={availableContacts}
            movements={movements}
          />

          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
            <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(120px,0.6fr))] sm:items-center sm:p-6">
              <div className="flex items-center gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
                  <Boxes className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted">
                    {t("resource.metrics.available")}
                  </p>
                  <p className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                    {quantityLabel(currentQuantity, unitName, numberFormat, t)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.metrics.minimum")}
                </p>
                <p
                  className={`mt-1 text-lg font-semibold ${forecast.isBelowMinimum ? "text-danger" : "text-foreground"
                    }`}
                >
                  {quantityLabel(minimum, unitName, numberFormat, t)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.metrics.incoming")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {quantityLabel(onOrder, unitName, numberFormat, t)}
                </p>
              </div>
            </div>
            {forecast.isBelowMinimum ? (
              <div className="flex items-center gap-2 border-t border-warning-border bg-warning-soft px-5 py-3 text-xs font-medium text-warning sm:px-6">
                <AlertTriangle
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                {t("resource.forecast.belowThreshold")}
              </div>
            ) : null}
          </section>

          <section>
            <AssemblyManager
              resourceId={resourceId}
              mode="build"
              hideWhenEmpty
              onStockChanged={() => void loadStock(true)}
            />
          </section>

          <StockMovementHistory
            stock={stock}
            t={t}
            locale={locale}
            numberFormat={numberFormat}
            canEdit={canEdit}
            availableContacts={availableContacts}
            movements={movements}
          />
        </div>

      </div>

      <StockUnits
        stock={stock}
        t={t}
        locale={locale}
        numberFormat={numberFormat}
        customFieldError={customFieldError}
        availableLocations={availableLocations}
        applicableCustomFields={applicableCustomFields}
        units={units}
      />

      <section className="mt-5">
        <StockLocationsManager
          resourceId={resourceId}
          canEdit={canEdit}
          unitName={unitName}
          onStockChanged={() => void loadStock(true)}
        />
      </section>

      {pendingMovement ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-overlay p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outgoing-confirmation-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl sm:p-6"
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-danger-soft text-danger">
              <PackageMinus className="size-5" aria-hidden="true" />
            </span>
            <h2
              id="outgoing-confirmation-title"
              className="mt-4 text-lg font-semibold tracking-[-0.02em] text-foreground"
            >
              {t("resource.confirm.outgoingTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {t("resource.confirm.outgoingDescription", {
                quantity: quantityLabel(
                  Math.abs(pendingMovement.delta),
                  unitName,
                  numberFormat,
                  t,
                ),
              })}
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface-subtle p-3 text-center">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.confirm.before")}
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">{currentQuantity}</p>
              </div>
              <div className="border-x border-border">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.confirm.change")}
                </p>
                <p className="mt-1 text-base font-semibold text-danger">
                  {pendingMovement.delta}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.confirm.after")}
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">
                  {currentQuantity + pendingMovement.delta}
                </p>
              </div>
            </div>
            {currentQuantity + pendingMovement.delta <= minimum ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-3 text-[12px] leading-4 text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {t("resource.confirm.minimumWarning", { minimum })}
              </div>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingMovement(null)}
                disabled={postingMovement}
                className="h-10 rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-muted-strong hover:bg-surface-hover disabled:opacity-50"
              >
                {t("resource.actions.goBack")}
              </button>
              <button
                type="button"
                onClick={() => void postMovement(pendingMovement)}
                disabled={postingMovement}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-danger px-4 text-xs font-semibold text-on-strong shadow-sm hover:brightness-90 disabled:opacity-50"
              >
                {postingMovement ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <PackageMinus className="size-4" aria-hidden="true" />
                )}
                {t("resource.actions.confirmStockOut")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
