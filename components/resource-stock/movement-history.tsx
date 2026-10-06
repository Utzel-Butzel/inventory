"use client";

import { formatDate, formatMoney } from "@/lib/client-formatters";

import {
  ChevronDown,
  History,
  LoaderCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";

import { isManualMovement, movementLabelKeys } from "./model";
import type { MovementType, StockContact, StockSectionProps } from "./types";
import type { StockMovementsController } from "./use-stock-movements";

import { BuildMovementDetails } from "./build-movement-details";

import { StockMovementEditForm } from "./movement-edit-form";

export type StockMovementHistoryProps = Pick<StockSectionProps, "stock" | "t" | "locale" | "numberFormat"> & {
  canEdit: boolean;
  availableContacts: StockContact[];
  movements: StockMovementsController;
};

export function StockMovementHistory({
  stock,
  t,
  locale,
  numberFormat,
  canEdit,
  availableContacts,
  movements,
}: StockMovementHistoryProps) {
  const {
    editingMovementId,
    movementEditForm,
    savingMovementId,
    deletingMovementId,
    historyFilter,
    setHistoryFilter,
    filteredMovements,
    startEditingMovement,
    deleteMovement,
  } = movements;
  const contactNameById = useMemo(
    () =>
      new Map(
        availableContacts.map((contact) => [
          contact.id,
          contact.company
            ? `${contact.name} · ${contact.company}`
            : contact.name,
        ]),
      ),
    [availableContacts],
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div><h2 className="text-base font-semibold">{t("resource.movements.title")}</h2><p className="mt-1 text-xs text-muted">{t("workspace.movementCount", { count: filteredMovements.length })}</p></div>
          <div className="relative">
            <select
              value={historyFilter}
              onChange={(event) =>
                setHistoryFilter(event.target.value as typeof historyFilter)
              }
              aria-label={t("resource.movements.filterLabel")}
              className="h-9 appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm font-medium text-muted outline-none hover:bg-surface-hover focus:border-focus"
            >
              <option value="all">{t("resource.movements.filters.all")}</option>
              <option value="in">{t("resource.movements.filters.in")}</option>
              <option value="out">{t("resource.movements.filters.out")}</option>
              <option value="audit">{t("resource.movements.filters.audit")}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted" />
          </div>
      </header>

      {filteredMovements.length ? (
        <div>
          <div className="hidden grid-cols-[170px_minmax(0,1fr)_100px_120px_16px] gap-4 border-b border-border bg-surface-subtle px-6 py-3 text-xs font-medium text-muted md:grid">
            <span>{t("resource.movements.date")}</span>
            <span>{t("workspace.movementEvent")}</span>
            <span className="text-right">{t("resource.movements.change")}</span>
            <span className="text-right">{t("resource.movements.balance")}</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {filteredMovements.map((movement) => {
              const positive = movement.delta > 0;
              const audit = movement.delta === 0;
              const editable = canEdit && isManualMovement(movement);
              const editing =
                editable &&
                editingMovementId === movement.id &&
                movementEditForm;
              const eventLabel = movement.assemblyBuildId
                ? t(movement.delta > 0 ? "workspace.assemblyCompleted" : "workspace.assemblyConsumed")
                : movement.reason || t(movementLabelKeys[movement.type as MovementType] ?? "resource.movements.stockUpdate", { defaultValue: movement.type });
              return (
                <details key={movement.id} className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto_16px] items-center gap-x-4 gap-y-2 px-4 py-4 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus md:grid-cols-[170px_minmax(0,1fr)_100px_120px_16px] md:px-6 [&::-webkit-details-marker]:hidden">
                    <time dateTime={movement.occurredAt} className="col-span-4 text-xs text-muted md:col-span-1 md:text-sm">{formatDate(movement.occurredAt, locale, true)}</time>
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">{eventLabel}</span>
                    <span className={`text-right text-sm font-semibold tabular-nums ${audit ? "text-muted" : positive ? "text-success" : "text-foreground"}`}>
                      <span className="sr-only">{t("resource.movements.change")}: </span>{positive ? "+" : ""}{numberFormat.format(movement.delta)}
                    </span>
                    <span className="text-right text-sm tabular-nums text-muted-strong"><span className="mb-0.5 block text-[11px] text-muted md:sr-only">{t("resource.movements.balance")}</span>{numberFormat.format(movement.balanceAfter)}</span>
                    <ChevronDown className="size-4 text-muted transition group-open:rotate-180" aria-hidden="true" />
                    <span className="sr-only">{t("workspace.movementDetails")}</span>
                  </summary>
                  <div className="border-t border-border bg-surface-subtle px-4 py-4 md:px-6">
                    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      <div><dt className="text-xs text-muted">{t("resource.booking.movementType")}</dt><dd className="mt-1">{t(movementLabelKeys[movement.type as MovementType] ?? "resource.movements.stockUpdate", { defaultValue: movement.type })}</dd></div>
                      <div><dt className="text-xs text-muted">{t("workspace.recordedBy")}</dt><dd className="mt-1">{movement.createdBy || t("resource.system")}</dd></div>
                      {movement.location ? <div><dt className="text-xs text-muted">{t("resource.booking.location")}</dt><dd className="mt-1 break-words">{movement.location}</dd></div> : null}
                      {movement.unitId ? <div><dt className="text-xs text-muted">{t("resource.movements.locationUnit")}</dt><dd className="mt-1 break-all font-mono text-xs">{movement.unitId}</dd></div> : null}
                      {movement.contactId ? <div><dt className="text-xs text-muted">{t("resource.movements.contact")}</dt><dd className="mt-1">{contactNameById.get(movement.contactId) ?? t("resource.movements.unknownContact")}</dd></div> : null}
                      {movement.totalPriceCents != null && movement.priceCurrency ? <div><dt className="text-xs text-muted">{t("resource.movements.transactionPrice")}</dt><dd className="mt-1">{formatMoney(movement.totalPriceCents, movement.priceCurrency, locale)}</dd></div> : null}
                      {movement.costCents != null && movement.costCurrency ? <div><dt className="text-xs text-muted">{t("resource.movements.inventoryCost")}</dt><dd className="mt-1">{formatMoney(movement.costCents, movement.costCurrency, locale)}{movement.costEstimated ? ` · ${t("resource.movements.estimated")}` : ""}</dd></div> : null}
                      {movement.note ? <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-muted">{t("resource.booking.note")}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{movement.note}</dd></div> : null}
                    </dl>
                    {movement.assemblyBuildId && movement.delta > 0 ? <div className="mt-4"><BuildMovementDetails resourceId={stock.resource.id} buildId={movement.assemblyBuildId} /></div> : null}
                    {editable ? <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                      <button type="button" onClick={() => startEditingMovement(movement)} disabled={Boolean(savingMovementId || deletingMovementId)}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-40">
                        <Pencil className="size-4" aria-hidden="true" />{t("resource.movements.edit")}
                      </button>
                      <button type="button" onClick={() => void deleteMovement(movement)} disabled={Boolean(savingMovementId || deletingMovementId)}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                        {deletingMovementId === movement.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}{t("resource.movements.delete")}
                      </button>
                    </div> : null}
                  </div>
                  {editing && movementEditForm ? <StockMovementEditForm stock={stock} t={t} movement={movement} form={movementEditForm} availableContacts={availableContacts} movements={movements} /> : null}
                </details>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="px-6 py-14 text-center">
          <History className="mx-auto size-6 text-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-muted-strong">
            {t("resource.movements.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {stock.movements.length
              ? t("resource.movements.noMatches")
              : t("resource.movements.noMovements")}
          </p>
        </div>
      )}
    </section>
  );
}
