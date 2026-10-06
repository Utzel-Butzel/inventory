"use client";

import { ResourceItemNavigation } from "@/components/resource-item-navigation";
import type { StockBookingTask } from "@/components/resource-stock/movement-form";

import {
  OrganizationLink as Link,
  useOrganizationAllowsNegativeStock,
} from "@/components/organization-routing";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  PackagePlus,
  Hammer,
  LoaderCircle,
  PackageMinus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import { StockActionPanel } from "./resource-stock/action-panel";
import { StockVariantOverview, StockThumbnail, type VirtualStockSelection, type StockBomPreview } from "./resource-stock/variant-overview";
import { FamilyStockDetails, type StockDetailTab } from "./resource-stock/family-details";
import { StockUnitCreateForm } from "./resource-stock/unit-create-form";
import { Button } from "@/components/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { isResourceId } from "@/lib/resource-short-link";
import { useInventoryBreadcrumb } from "@/components/inventory-breadcrumb-context";
import { useOrganizationHref } from "@/components/organization-routing";
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
  resourceId: initialResourceId,
  canEdit: initialCanEdit = false,
  selectedUnitId,
  initialTask = "receipt",
  openInitialTask = false,
  initialDetailTab = "movements",
}: {
  resourceId: string;
  canEdit?: boolean;
  selectedUnitId?: string;
  initialTask?: StockBookingTask;
  openInitialTask?: boolean;
  initialDetailTab?: StockDetailTab;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedVariant = searchParams.get("variant");
  const requestedId = requestedVariant && isResourceId(requestedVariant) ? requestedVariant : initialResourceId;
  const [resourceId, setResourceId] = useState(requestedId);
  const [canEdit, setCanEdit] = useState(initialCanEdit && requestedId === initialResourceId);
  const requestVersion = useRef(0);
  const activeLoadTarget = useRef(requestedId);
  const loadRequest = useRef<AbortController | null>(null);
  const organizationHref = useOrganizationHref();
  const [selectedAction, setAction] = useState<StockBookingTask | "build" | "transfer" | null>(openInitialTask ? initialTask : null);
  const [detailTab, setDetailTab] = useState<StockDetailTab>(selectedUnitId ? "units" : initialDetailTab);
  const [familyView, setFamilyView] = useState(false);
  const [virtual, setVirtual] = useState<VirtualStockSelection | null>(null);
  const [bom, setBom] = useState<StockBomPreview | null>(null);
  const [revision, setRevision] = useState(0);
  const [buildBusy, setBuildBusy] = useState(false);
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
    { ...defaultMovementForm(initialTask === "issue" ? "out" : "in"),
      ...(initialTask === "count" ? { quantity: "", type: "adjustment", reason: t("resource.booking.tasks.count") } : {}),
    },
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
      if (activeLoadTarget.current !== requestedId) return;
      loadRequest.current?.abort();
      const controller = new AbortController();
      loadRequest.current = controller;
      const version = ++requestVersion.current;
      const loadEndpoint = `/api/v1/resources/${requestedId}/stock`;
      if (!quiet) setLoading(true);
      setError(null);
      setCustomFieldError(null);
      try {
        const [payload, definitionsResult, locationsResult] = await Promise.all([
          fetchJson<StockApiResponse>(loadEndpoint, { cache: "no-store", signal: controller.signal }),
          fetchJson<CustomFieldsApiResponse>(customFieldsEndpoint, {
            signal: controller.signal,
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
          fetchJson<StockLocationsApiResponse>(`${loadEndpoint}/locations`, {
            signal: controller.signal,
            cache: "no-store",
          }).catch(() => null),
        ]);
        if (version !== requestVersion.current) return;
        const normalized = normalizeStock(payload, t);
        setResourceId(requestedId);
        setCanEdit(payload.canManageStock ?? (requestedId === initialResourceId && initialCanEdit));
        setStock(normalized);
        if (!quiet && normalized.family?.primary.id === requestedId && normalized.family.variants.length && !requestedVariant && !openInitialTask && initialDetailTab === "movements" && !selectedUnitId) setFamilyView(true);
        if (!quiet && initialTask === "receipt" && hasPurchaseUnit(normalized.config)) {
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
              (location) => location.id !== requestedId && location.status !== "archived",
            ),
          );
        }
      } catch (loadError) {
        if (version !== requestVersion.current) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("resource.errors.load"),
        );
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [customFieldsEndpoint, requestedVariant, requestedId, initialResourceId, initialCanEdit, initialTask, initialDetailTab, openInitialTask, selectedUnitId, t],
  );

  useEffect(() => {
    activeLoadTarget.current = requestedId;
    setAction(openInitialTask && requestedId === initialResourceId ? initialTask : null);
    setVirtual(null);
    setFamilyView(false);
    setNotice(null);
    void loadStock();
    return () => { requestVersion.current += 1; loadRequest.current?.abort(); };
  }, [loadStock, initialResourceId, initialTask, openInitialTask, requestedId]);

  useInventoryBreadcrumb(stock ? { href: `/inventory/${resourceId}`, name: stock.resource.name } : null);

  function selectVariant(id: string) {
    setVirtual(null);
    setFamilyView(false);
    setAction(null);
    if (id === resourceId && id === requestedId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", id);
    url.searchParams.set("tab", detailTab);
    url.searchParams.delete("unit");
    url.searchParams.delete("unitView");
    url.searchParams.delete("task");
    window.history.pushState(null, "", url);
  }
  const switchingVariant = requestedId !== resourceId;


  const currentQuantity = stock?.resource.quantity ?? 0;
  const configuredUnit = stock?.config.unitName?.trim();
  const unitName = !configuredUnit || configuredUnit === "unit" ? t("resource.unit") : configuredUnit;
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

  useEffect(() => {
    const controller = new AbortController();
    setBom(null);
    void fetchJson<StockBomPreview>(`/api/v1/resources/${resourceId}/bom`, { signal: controller.signal, cache: "no-store" })
      .then(setBom).catch(() => { if (!controller.signal.aborted) setBom(null); });
    return () => controller.abort();
  }, [resourceId, revision]);

  const mutationContext = {
    stock,
    endpoint,
    loadStock,
    setError,
    setNotice: (message: SetStateAction<string | null>) => {
      setNotice(message);
      if (typeof message === "string" && message) { setRevision((value) => value + 1); }
    },
    unitName,
    numberFormat,
    t,
  };
  const movements = useStockMovements({
    ...mutationContext,
    allowNegativeStock,
    initialTask,
    movementForm,
    setMovementForm,
  });
  const units = useStockUnits(mutationContext);
  const { pendingMovement, setPendingMovement, postingMovement, postMovement } = movements;

  if (loading && !stock) {
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

  const selectedName = virtual?.preview.resource.name ?? (stock.family?.variants.length && stock.family.primary.id === resourceId ? t("workspace.unassignedName", { name: stock.resource.name }) : stock.resource.name);
  const forecast = stock.forecast;
  const minimum = stock.config.minimumStock;
  const action = selectedAction ?? (virtual ? "build" : null);
  const actionBusy = buildBusy || postingMovement || units.creatingUnits || units.savingUnit;
  const actions: Array<StockBookingTask | "build" | "transfer"> = [
    ...((virtual?.preview ?? bom)?.components.length ? ["build" as const] : []),
    ...(!virtual ? ["issue", "receipt", "count", "transfer"] as const : []),
  ];
  function selectAction(next: (typeof actions)[number]) {
    if (actionBusy) return;
    setPendingMovement(null);
    setError(null);
    if (next !== "build" && next !== "transfer") movements.selectTask(next);
    setAction(next === action ? null : next);
  }


  return (
    <div className="app-page mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {stock.family?.primary.name ?? stock.resource.name}
            </h1>
            <span className="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-brand">
              {t(`resource.tracking.${virtual?.preview.resource.trackingMode ?? stock.config.trackingMode}`)}
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
      <ResourceItemNavigation resourceId={resourceId} current="stock" />

      {error ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          {switchingVariant ? <button type="button" onClick={() => void loadStock()} className="shrink-0 underline">{t("resource.actions.retry")}</button> : null}
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

      {loading && stock ? <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("resource.loading")}</p> : null}
      <div inert={switchingVariant} aria-busy={switchingVariant} className={switchingVariant ? "opacity-50" : undefined}>
      <section className="mb-5 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <div className="min-w-0 lg:w-full lg:max-w-lg" inert={actionBusy}>
            {stock.family ? <StockVariantOverview family={stock.family} resourceId={resourceId} revision={revision}
              allSelected={familyView} virtualSelected={Boolean(virtual)} virtualName={virtual?.preview.resource.name}
              onSelect={selectVariant} onCurrent={() => selectVariant(resourceId)}
              onAll={() => { setFamilyView(true); setVirtual(null); setAction(null); }}
              onVirtual={(selection) => { setVirtual(selection); setFamilyView(false); setAction(null); }} /> :
              <div className="flex items-center gap-3"><StockThumbnail cover={stock.resource.cover} /><h2 className="text-lg font-semibold">{selectedName}</h2></div>}
          </div>
          <div className="shrink-0 lg:text-right" aria-live="polite">
            <p className="text-xs font-medium text-muted">{familyView ? t("workspace.totalLabel") : t("resource.metrics.available")}</p>
            <p className="mt-1 flex items-baseline gap-2 lg:justify-end"><strong className="text-4xl font-semibold tracking-tight tabular-nums">{numberFormat.format(familyView ? stock.family?.summary.totalQuantity ?? currentQuantity : virtual ? 0 : currentQuantity)}</strong><span className="text-sm text-muted">{unitName}</span></p>
            {!familyView ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted lg:justify-end">
              {!virtual ? <><span>{t("resource.metrics.minimum")}: {numberFormat.format(minimum)}</span><span>{t("resource.metrics.incoming")}: {numberFormat.format(onOrder)}</span></> : null}
              {(virtual?.preview ?? bom)?.components.length ? <span title={t("workspace.sharedComponents")}>{t("workspace.buildable")}: {numberFormat.format((virtual?.preview ?? bom)!.buildableQuantity)}</span> : null}
            </div> : null}
            {!familyView && !virtual && forecast.isBelowMinimum ? <p className="mt-2 text-sm text-warning">{t("resource.forecast.belowThreshold")}</p> : null}
          </div>
        </div>
        {canEdit && !familyView ? <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <div aria-label={t("workspace.actions")} className="flex flex-wrap items-center gap-2">
            {actions.filter((task) => task !== "count" && task !== "transfer").map((task) => {
              const Icon = task === "build" ? Hammer : task === "issue" ? PackageMinus : PackagePlus;
              return <Button key={task} id={`stock-action-${task}`} aria-expanded={action === task} aria-controls="stock-action-panel"
                disabled={actionBusy} variant={action === task ? "primary" : "secondary"} onClick={() => selectAction(task)}>
                <Icon className="size-4" aria-hidden="true" />{t(`workspace.${task}`)}
              </Button>;
            })}
            {!virtual ? <details className="relative" onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
            }} onKeyDown={(event) => {
              if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
            }}>
              <summary className={`flex cursor-pointer list-none items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden ${action === "count" || action === "transfer" ? "border-brand bg-brand-soft text-brand" : "border-border text-muted-strong hover:bg-surface-hover"}`}>
                {action === "count" || action === "transfer" ? t(`workspace.${action}`) : t("workspace.moreActions")}<ChevronDown className="size-4" aria-hidden="true" />
              </summary>
              <div className="absolute left-0 top-full z-20 mt-2 w-52 rounded-xl border border-border bg-surface p-1 shadow-lg">
                {(["count", "transfer"] as const).map((task) => <button key={task} id={`stock-action-${task}`} type="button" disabled={actionBusy}
                  aria-expanded={action === task} aria-controls="stock-action-panel"
                  onClick={(event) => { selectAction(task); const menu = event.currentTarget.closest("details"); if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); } }}
                  className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-hover disabled:opacity-50">{t(`workspace.${task}`)}</button>)}
              </div>
            </details> : null}
          </div>
          {virtual ? <Button variant="secondary" disabled={buildBusy} onClick={async () => {
            setBuildBusy(true); setError(null);
            try {
              const created = await fetchJson<{ resourceId: string }>(`/api/v1/resources/${virtual.primaryId}/assembly-configuration`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(virtual.configuration) });
              router.push(organizationHref(`/inventory/${created.resourceId}/edit`));
            } catch (cause) { setError(cause instanceof Error ? cause.message : t("workspace.loadError")); }
            finally { setBuildBusy(false); }
          }}>{t("workspace.customize")}</Button> : null}
        </div> : null}
      {action && actions.includes(action) && canEdit && !familyView && !switchingVariant ? <StockActionPanel label={t(`workspace.${action}`)} busy={actionBusy}>
        {error ? <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
        {action === "build" ? <AssemblyManager resourceId={virtual?.primaryId ?? resourceId} fixedOutput unassignedOutput={!virtual && Boolean(stock.family?.variants.length) && stock.family?.primary.id === resourceId} outputConfiguration={virtual?.configuration} mode="build" showHistory={false}
          onBusyChange={setBuildBusy} onBuilt={(output) => { setBuildBusy(false); setNotice(t("workspace.built", { name: output.name })); setRevision((value) => value + 1); if (output.id !== resourceId) selectVariant(output.id); else void loadStock(true); }} /> : null}
        {!pendingMovement && !virtual && action !== "build" ? stock.config.trackingMode === "serialized" ? (action === "receipt" ? <StockUnitCreateForm stock={stock} t={t} customFieldError={customFieldError} availableLocations={availableLocations} applicableCustomFields={applicableCustomFields} units={units} /> : <>
          <p className="text-sm text-muted">{t(`workspace.serialized.${action}`)}</p>
          <StockUnits key={resourceId} selectedUnitId={selectedUnitId} stock={stock} t={t} locale={locale} numberFormat={numberFormat} customFieldError={customFieldError} availableLocations={availableLocations} applicableCustomFields={applicableCustomFields} units={units} showCreate={false} canEdit />
        </>) : action === "transfer" ? <StockLocationsManager key={resourceId} resourceId={resourceId} canEdit unitName={unitName} onBusyChange={setBuildBusy} onStockChanged={() => { void loadStock(true); setRevision((value) => value + 1); }} /> : <StockBooking contextual stock={stock} t={t} unitName={unitName} numberFormat={numberFormat} resourceId={resourceId} availableContacts={availableContacts} movements={movements} /> : null}
      {pendingMovement ? (
        <div className="space-y-4">
          <div
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
              {t(pendingMovement.expectedQuantity !== undefined ? "resource.confirm.countTitle" : "resource.confirm.outgoingTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {t(pendingMovement.expectedQuantity !== undefined ? "resource.confirm.countDescription" : "resource.confirm.outgoingDescription", {
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
                {t(pendingMovement.expectedQuantity !== undefined ? "resource.booking.submit.count" : "resource.actions.confirmStockOut")}
              </button>
            </div>
          </div>
        </div>
      ) : null}      </StockActionPanel> : null}
      </section>

      <div role="tablist" aria-label={t("workspace.details")} className="mb-4 flex gap-2 border-b border-border">
        {(["movements", "units", "locations"] as const).map((tab, index, tabs) => <button key={tab} id={`stock-tab-${tab}`} role="tab" aria-selected={detailTab === tab} aria-controls="stock-detail-panel" tabIndex={detailTab === tab ? 0 : -1}
          onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; setDetailTab(next); document.getElementById(`stock-tab-${next}`)?.focus(); } }}
          onClick={() => setDetailTab(tab)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${detailTab === tab ? "border-brand text-brand" : "border-transparent text-muted"}`}>{t(`workspace.${tab}`)}</button>)}
      </div>
      <section id="stock-detail-panel" inert={actionBusy} role="tabpanel" aria-labelledby={`stock-tab-${detailTab}`} tabIndex={0}>
        {virtual ? <p className="rounded-xl border border-border p-6 text-sm text-muted">{t("workspace.virtualEmpty")}</p> : familyView && stock.family ? <FamilyStockDetails members={[stock.family.primary, ...stock.family.variants]} tab={detailTab} /> : <>
          {detailTab === "movements" ? <StockMovementHistory stock={stock} t={t} locale={locale} numberFormat={numberFormat} canEdit={canEdit} availableContacts={availableContacts} movements={movements} /> : null}
          {detailTab === "units" ? (stock.config.trackingMode === "serialized" ? <StockUnits key={resourceId} selectedUnitId={selectedUnitId} stock={stock} t={t} locale={locale} numberFormat={numberFormat} customFieldError={customFieldError} availableLocations={availableLocations} applicableCustomFields={applicableCustomFields} units={units} showCreate={false} canEdit={false} /> : <p className="p-5 text-sm text-muted">{t("workspace.bulkUnits")}</p>) : null}
          {detailTab === "locations" ? <StockLocationsManager key={resourceId} resourceId={resourceId} canEdit={false} unitName={unitName} /> : null}
        </>}
      </section>


      </div>
    </div>
  );
}
