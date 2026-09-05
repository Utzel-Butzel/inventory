"use client";

import {
  Info,
  LoaderCircle,
  PackageMinus,
  PackagePlus,
  SlidersHorizontal,
} from "lucide-react";

import { PhotoCountCapture } from "@/components/photo-count-capture";
import {
  ResourceStockConfigurationSwitcher,
} from "@/components/resource-stock-configuration-switcher";

import { inputClass, labelClass, SectionHeading } from "./fields";
import { movementLabelKeys } from "./model";
import type {
  MovementForm,
  MovementType,
  StockContact,
  StockSectionProps,
} from "./types";
import type { StockMovementsController } from "./use-stock-movements";

import { MovementDirectionToggle, StockContactSelect } from "./fields";

export type StockBookingProps = Pick<StockSectionProps, "stock" | "t" | "unitName" | "numberFormat"> & {
  resourceId: string;
  availableContacts: StockContact[];
  movements: StockMovementsController;
};

export function StockBooking({
  stock,
  t,
  unitName,
  numberFormat,
  resourceId,
  availableContacts,
  movements,
}: StockBookingProps) {
  const currentQuantity = stock.resource.quantity;
  const {
    direction,
    movementForm,
    postingMovement,
    purchaseUnit,
    purchaseUnitConfigured,
    enteredUnitName,
    enteredUnitFactor,
    movementTypes,
    selectDirection,
    updateMovement,
    applyPhotoCount,
    submitMovement,
  } = movements;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
      <SectionHeading
        icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
        title={t("resource.booking.title")}
        description={t("resource.booking.description")}
        trailing={
          <span className="hidden text-[11px] font-semibold uppercase tracking-wider text-muted sm:block">
            {t("resource.booking.available", {
              quantity: numberFormat.format(currentQuantity),
            })}
          </span>
        }
      />
      <form onSubmit={submitMovement} className="p-5 sm:p-6">
        <ResourceStockConfigurationSwitcher
          resourceId={resourceId}
          placement="movement"
        />

        <MovementDirectionToggle
          direction={direction}
          onChange={selectDirection}
          t={t}
        />

        <PhotoCountCapture
          itemId={stock.resource.id}
          itemName={stock.resource.name}
          unitName={unitName}
          direction={direction}
          quantity={movementForm.quantity}
          availableQuantity={currentQuantity}
          disabled={stock.config.trackingMode === "serialized"}
          onCount={applyPhotoCount}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className={labelClass}>
            {t("resource.booking.quantity")}
            <div className="relative">
              <input
                type="number"
                min="1"
                max={
                  direction === "out"
                    ? Math.max(0, currentQuantity)
                    : Math.max(1, Math.floor(1_000_000 / enteredUnitFactor))
                }
                step="1"
                required
                value={movementForm.quantity}
                onChange={(event) => updateMovement("quantity", event.target.value)}
                className={`${inputClass} ${purchaseUnitConfigured && direction === "in" ? "pr-24" : "pr-20"}`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[12px] text-muted">
                {enteredUnitName}
              </span>
            </div>
            {purchaseUnitConfigured && direction === "in" ? (
              <select
                aria-label={t("resource.booking.quantityUnit")}
                value={movementForm.quantityUnit}
                onChange={(event) =>
                  updateMovement(
                    "quantityUnit",
                    event.target.value as MovementForm["quantityUnit"],
                  )
                }
                className={`${inputClass} mt-2`}
              >
                <option value="purchase">
                  {purchaseUnit?.name}
                </option>
                <option value="base">{unitName}</option>
              </select>
            ) : null}
            {purchaseUnitConfigured &&
              direction === "in" &&
              movementForm.quantityUnit === "purchase" ? (
              <span className="mt-1 block text-[10px] font-normal leading-4 text-muted">
                {t("resource.booking.purchaseUnitConversion", {
                  quantity: numberFormat.format(
                    Number(movementForm.quantity || 0) * enteredUnitFactor,
                  ),
                  unit: unitName,
                })}
              </span>
            ) : null}
          </label>
          <label className={labelClass}>
            {t("resource.booking.movementType")}
            <select
              value={movementForm.type}
              onChange={(event) => updateMovement("type", event.target.value as MovementType)}
              className={inputClass}
            >
              {movementTypes.map((type) => (
                <option key={type} value={type}>
                  {t(movementLabelKeys[type])}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("resource.booking.date")}
            <input
              type="datetime-local"
              required
              value={movementForm.occurredAt}
              onChange={(event) => updateMovement("occurredAt", event.target.value)}
              className={inputClass}
            />
          </label>
          <StockContactSelect
            contacts={availableContacts}
            value={movementForm.contactId}
            onChange={(value) => updateMovement("contactId", value)}
            t={t}
            optional
          />
          <label className={labelClass}>
            {direction === "in"
              ? t("resource.booking.inboundPrice")
              : t("resource.booking.outboundPrice")} {" "}
            <span className="font-normal text-muted">
              · {t("resource.optional")}
            </span>
            <div className="relative">
              <input
                type="number"
                min={direction === "in" ? "0" : "-20000000"}
                max="20000000"
                step="0.01"
                inputMode="decimal"
                value={movementForm.totalPrice}
                onChange={(event) => updateMovement("totalPrice", event.target.value)}
                placeholder="0.00"
                className={`${inputClass} pr-14 tabular-nums`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[12px] text-muted">
                {stock.resource.currency}
              </span>
            </div>
            <span className="mt-1 block text-[10px] font-normal leading-4 text-muted">
              {t("resource.booking.totalPriceHelp")}
            </span>
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t("resource.booking.reason")} {" "}
            <span className="font-normal text-muted">
              · {t("resource.optional")}
            </span>
            <input
              value={movementForm.reason}
              maxLength={240}
              onChange={(event) => updateMovement("reason", event.target.value)}
              placeholder={
                direction === "in"
                  ? t("resource.booking.reasonInPlaceholder")
                  : t("resource.booking.reasonOutPlaceholder")
              }
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            {t("resource.booking.location")} {" "}
            <span className="font-normal text-muted">
              · {t("resource.optional")}
            </span>
            <input
              value={movementForm.location}
              maxLength={240}
              onChange={(event) => updateMovement("location", event.target.value)}
              placeholder={t("resource.booking.locationPlaceholder")}
              className={inputClass}
            />
          </label>
          <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
            {t("resource.booking.note")} {" "}
            <span className="font-normal text-muted">
              · {t("resource.optional")}
            </span>
            <textarea
              rows={3}
              value={movementForm.note}
              maxLength={4000}
              onChange={(event) => updateMovement("note", event.target.value)}
              placeholder={t("resource.booking.notePlaceholder")}
              className={`${inputClass} h-auto resize-y py-3 leading-5`}
            />
          </label>
        </div>

        {stock.config.trackingMode === "serialized" ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-info-border bg-info-soft px-3.5 py-3 text-[12px] leading-4 text-info">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {t("resource.booking.serializedBeforeLink")} {" "}
              <a
                href="#serialized-units"
                className="font-semibold underline underline-offset-2"
              >
                {t("resource.booking.unitControlsBelow")}
              </a>
              {t("resource.booking.serializedAfterLink")}
            </span>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-muted">
            {t("resource.booking.projectedBalance", {
              quantity: numberFormat.format(
                Math.max(
                  0,
                  currentQuantity +
                  (direction === "in" ? 1 : -1) *
                  Number(movementForm.quantity || 0) *
                  enteredUnitFactor,
                ),
              ),
              unit: unitName,
            })}
          </p>
          <button
            type="submit"
            disabled={
              postingMovement ||
              stock.config.trackingMode === "serialized" ||
              (direction === "out" && currentQuantity < 1)
            }
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-on-strong shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45 ${direction === "in"
                ? "bg-success hover:brightness-90"
                : "bg-danger hover:brightness-90"
              }`}
          >
            {postingMovement ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : direction === "in" ? (
              <PackagePlus className="size-4" aria-hidden="true" />
            ) : (
              <PackageMinus className="size-4" aria-hidden="true" />
            )}
            {direction === "in"
              ? t("resource.actions.bookStockIn")
              : t("resource.actions.reviewStockOut")}
          </button>
        </div>
      </form>
    </section>
  );
}
