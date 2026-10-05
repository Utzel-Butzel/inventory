"use client";

import {
  Info,
  LoaderCircle,
  PackageMinus,
  PackagePlus,
  SlidersHorizontal,
  ArrowRightLeft,
  ClipboardCheck,
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

import { StockContactSelect } from "./fields";

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
    task,
    selectTask,
    direction,
    movementForm,
    postingMovement,
    purchaseUnit,
    purchaseUnitConfigured,
    enteredUnitName,
    enteredUnitFactor,
    movementTypes,
    updateMovement,
    applyPhotoCount,
    submitMovement,
  } = movements;
  const isCount = task === "count";
  const amount = Number(movementForm.quantity);
  const validAmount = movementForm.quantity.trim() !== "" && Number.isSafeInteger(amount) && amount >= (isCount ? 0 : 1);
  const delta = isCount ? amount - currentQuantity : (direction === "in" ? 1 : -1) * amount * enteredUnitFactor;
  const projected = currentQuantity + delta;
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

        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("resource.booking.chooseTask")}>
          {(["issue", "receipt", "count"] as const).map((value) => {
            const Icon = value === "issue" ? PackageMinus : value === "receipt" ? PackagePlus : ClipboardCheck;
            return <button key={value} type="button" onClick={() => selectTask(value)} disabled={postingMovement}
              aria-pressed={task === value}
              className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-semibold disabled:opacity-50 ${task === value ? "border-brand-border bg-brand-soft text-brand" : "border-border text-muted-strong hover:bg-surface-hover"}`}>
              <Icon className="size-4" aria-hidden="true" />{t(`resource.booking.tasks.${value}`)}
            </button>;
          })}
          <a href="#stock-locations" className="flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-3 text-xs font-semibold text-muted-strong hover:bg-surface-hover">
            <ArrowRightLeft className="size-4" aria-hidden="true" />{t("resource.booking.tasks.transfer")}
          </a>
        </div>
        <p className="mb-4 text-sm text-muted">{t(`resource.booking.taskHelp.${task}`)}</p>



        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className={labelClass}>
            {t(isCount ? "resource.booking.countedQuantity" : "resource.booking.quantity")}
            <div className="relative">
              <input
                type="number"
                min={isCount ? "0" : "1"}
                max={isCount ? 2_000_000_000 : Math.max(1, Math.floor(2_000_000_000 / enteredUnitFactor))}
                step="1"
                required
                value={movementForm.quantity}
                onChange={(event) => updateMovement("quantity", event.target.value)}
                className={`${inputClass} ${!isCount && purchaseUnitConfigured && direction === "in" ? "pr-24" : "pr-20"}`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[12px] text-muted">
                {enteredUnitName}
              </span>
            </div>
            {!isCount && purchaseUnitConfigured && direction === "in" ? (
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
            {!isCount && purchaseUnitConfigured &&
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
        </div>
        {!isCount ? (
          <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-muted-strong">{t("resource.booking.photoQuantity")}</summary>
        <PhotoCountCapture
          key={task}
          itemId={stock.resource.id}
          itemName={stock.resource.name}
          unitName={unitName}
          direction={direction}
          quantity={movementForm.quantity}
          availableQuantity={currentQuantity}
          disabled={stock.config.trackingMode === "serialized"}
          onCount={applyPhotoCount}
        />
          </details>
        ) : null}
        <details className="mt-5 rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-semibold text-muted-strong">{t("resource.booking.optionalDetails")}</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!isCount ? (
          <label className={labelClass}>
            {t("resource.booking.movementType")}
            <select
              value={movementForm.type}
              onChange={(event) => updateMovement("type", event.target.value as MovementType)}
              className={inputClass}
            >
              {movementTypes.filter((type) => type !== "transfer").map((type) => (
                <option key={type} value={type}>
                  {t(movementLabelKeys[type])}
                </option>
              ))}
            </select>
          </label>
          ) : null}
          <label className={labelClass}>
            {t("resource.booking.date")}
            <input
              type="datetime-local"
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
          {!isCount ? (
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
          ) : null}
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
        </details>

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
          <div aria-live="polite" className="text-sm tabular-nums text-muted-strong">
            <span className="block text-xs text-muted">{t("resource.booking.balancePreview")}</span>
            {validAmount ? (
              <span className={`mt-1 block font-semibold ${projected < 0 ? "text-danger" : "text-foreground"}`}>
                {numberFormat.format(currentQuantity)} {delta < 0 ? "−" : "+"} {numberFormat.format(Math.abs(delta))} = {numberFormat.format(projected)} {unitName}
              </span>
            ) : <span>{t("resource.booking.enterQuantity")}</span>}
          </div>
          <button
            type="submit"
            disabled={
              postingMovement ||
              stock.config.trackingMode === "serialized" ||
              !validAmount
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
            {t(`resource.booking.submit.${task}`)}
          </button>
        </div>
      </form>
    </section>
  );
}
