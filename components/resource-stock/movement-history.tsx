"use client";

import { formatDate, formatMoney } from "@/lib/client-formatters";

import {
  ArrowDownRight,
  ArrowUpRight,
  Barcode,
  ChevronDown,
  History,
  LoaderCircle,
  MapPin,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";

import { SectionHeading } from "./fields";
import { isManualMovement, movementLabelKeys } from "./model";
import type { MovementType, StockContact, StockSectionProps } from "./types";
import type { StockMovementsController } from "./use-stock-movements";

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
      <SectionHeading
        icon={<History className="size-4" aria-hidden="true" />}
        title={t("resource.movements.title")}
        description={t("resource.movements.description", {
          count: stock.movements.length,
          value: numberFormat.format(stock.movements.length),
        })}
        trailing={
          <div className="relative">
            <select
              value={historyFilter}
              onChange={(event) =>
                setHistoryFilter(event.target.value as typeof historyFilter)
              }
              aria-label={t("resource.movements.filterLabel")}
              className="h-8 appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-[12px] font-medium text-muted outline-none hover:bg-surface-hover focus:border-focus"
            >
              <option value="all">{t("resource.movements.filters.all")}</option>
              <option value="in">{t("resource.movements.filters.in")}</option>
              <option value="out">{t("resource.movements.filters.out")}</option>
              <option value="audit">{t("resource.movements.filters.audit")}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted" />
          </div>
        }
      />

      {filteredMovements.length ? (
        <div>
          <div className="hidden grid-cols-[90px_minmax(160px,1.25fr)_minmax(130px,1fr)_100px_120px_72px] gap-4 border-b border-border bg-surface-subtle px-6 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted md:grid">
            <span>{t("resource.movements.change")}</span>
            <span>{t("resource.movements.reason")}</span>
            <span>{t("resource.movements.locationUnit")}</span>
            <span>{t("resource.movements.balance")}</span>
            <span>{t("resource.movements.date")}</span>
            <span className="text-right">
              {t("resource.movements.actions")}
            </span>
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
              return (
                <div key={movement.id}>
                  <div className="grid gap-3 px-5 py-4 transition hover:bg-surface-hover md:grid-cols-[90px_minmax(160px,1.25fr)_minmax(130px,1fr)_100px_120px_72px] md:items-center md:gap-4 md:px-6">
                    <div className="flex items-center justify-between md:block">
                      <span
                        className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-bold tabular-nums ${audit
                            ? "bg-surface-muted text-muted"
                            : positive
                              ? "bg-success-soft text-success"
                              : "bg-danger-soft text-danger"
                          }`}
                      >
                        {audit ? (
                          <SlidersHorizontal className="size-3" aria-hidden="true" />
                        ) : positive ? (
                          <ArrowUpRight className="size-3" aria-hidden="true" />
                        ) : (
                          <ArrowDownRight className="size-3" aria-hidden="true" />
                        )}
                        {positive ? "+" : ""}
                        {numberFormat.format(movement.delta)}
                      </span>
                      <span className="text-[11px] text-muted md:hidden">
                        {formatDate(movement.occurredAt, locale, true)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">
                        {movement.reason ||
                          t(
                            movementLabelKeys[
                            movement.type as MovementType
                            ] ?? "resource.movements.stockUpdate",
                            { defaultValue: movement.type },
                          )}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-muted">
                        {t(
                          movementLabelKeys[
                          movement.type as MovementType
                          ] ?? "resource.movements.stockUpdate",
                          {
                            defaultValue: movement.type.replaceAll("-", " "),
                          },
                        )}
                        {movement.note ? ` · ${movement.note}` : ""}
                      </p>
                      {movement.contactId ? (
                        <p className="mt-1 truncate text-[11px] font-medium text-brand">
                          {t("resource.movements.contact")}: {" "}
                          {contactNameById.get(movement.contactId) ??
                            t("resource.movements.unknownContact")}
                        </p>
                      ) : null}
                      {movement.totalPriceCents !== null &&
                        movement.totalPriceCents !== undefined &&
                        movement.priceCurrency ? (
                        <p className="mt-1 text-[11px] font-semibold text-brand">
                          {t("resource.movements.transactionPrice")}: {" "}
                          {formatMoney(
                            movement.totalPriceCents,
                            movement.priceCurrency,
                            locale,
                          )}
                        </p>
                      ) : null}
                      {movement.costCents !== null &&
                        movement.costCents !== undefined &&
                        movement.costCurrency ? (
                        <p className="mt-0.5 text-[10px] text-muted">
                          {t("resource.movements.inventoryCost")}: {" "}
                          {formatMoney(
                            movement.costCents,
                            movement.costCurrency,
                            locale,
                          )}
                          {movement.costEstimated
                            ? ` · ${t("resource.movements.estimated")}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                      {movement.location ? (
                        <>
                          <MapPin className="size-3 shrink-0 text-muted" aria-hidden="true" />
                          <span className="truncate">{movement.location}</span>
                        </>
                      ) : movement.unitId ? (
                        <>
                          <Barcode className="size-3 shrink-0 text-muted" aria-hidden="true" />
                          <span className="truncate font-mono">{movement.unitId.slice(0, 8)}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted md:font-semibold md:tabular-nums">
                      <span className="md:hidden">
                        {t("resource.movements.balance")}{" "}
                      </span>
                      {numberFormat.format(movement.balanceAfter)}
                    </p>
                    <div className="hidden md:block">
                      <p className="text-[11px] text-muted">
                        {formatDate(movement.occurredAt, locale)}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted">
                        {movement.createdBy || t("resource.system")}
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      {editable ? (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditingMovement(movement)}
                            disabled={Boolean(savingMovementId || deletingMovementId)}
                            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
                            aria-label={t("resource.movements.edit")}
                            title={t("resource.movements.edit")}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteMovement(movement)}
                            disabled={Boolean(savingMovementId || deletingMovementId)}
                            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                            aria-label={t("resource.movements.delete")}
                            title={t("resource.movements.delete")}
                          >
                            {deletingMovementId === movement.id ? (
                              <LoaderCircle
                                className="size-3.5 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            )}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {editing && movementEditForm ? (
                    <StockMovementEditForm
                      stock={stock}
                      t={t}
                      movement={movement}
                      form={movementEditForm}
                      availableContacts={availableContacts}
                      movements={movements}
                    />
                  ) : null}
                </div>
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
