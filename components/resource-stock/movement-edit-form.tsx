"use client";

import type { MovementForm, StockMovement } from "./types";

import { LoaderCircle, Save, X } from "lucide-react";
import { inputClass, labelClass } from "./fields";
import { incomingTypes, movementLabelKeys, outgoingTypes } from "./model";
import type { MovementType, StockContact, StockSectionProps } from "./types";
import type { StockMovementsController } from "./use-stock-movements";

import { MovementDirectionToggle, StockContactSelect } from "./fields";

export type StockMovementEditFormProps = Pick<StockSectionProps, "stock" | "t"> & {
  movement: StockMovement;
  form: MovementForm;
  availableContacts: StockContact[];
  movements: StockMovementsController;
};

export function StockMovementEditForm({
  stock,
  t,
  movement,
  form,
  availableContacts,
  movements,
}: StockMovementEditFormProps) {
  const movementEditForm = form;
  const {
    movementEditDirection,
    savingMovementId,
    closeMovementEditor,
    selectMovementEditDirection,
    updateMovementEdit,
    saveMovementEdit,
  } = movements;
  return (
    <form
      onSubmit={(event) =>
        void saveMovementEdit(event, movement)
      }
      className="border-t border-border bg-surface-subtle px-5 py-5 sm:px-6"
    >
      <MovementDirectionToggle
        direction={movementEditDirection}
        onChange={selectMovementEditDirection}
        t={t}
        compact
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelClass}>
          {t("resource.booking.quantity")}
          <input
            type="number"
            min="1"
            step="1"
            required
            value={movementEditForm.quantity}
            onChange={(event) =>
              updateMovementEdit(
                "quantity",
                event.target.value,
              )
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          {t("resource.booking.movementType")}
          <select
            value={movementEditForm.type}
            onChange={(event) =>
              updateMovementEdit(
                "type",
                event.target.value as MovementType,
              )
            }
            className={inputClass}
          >
            {(movementEditDirection === "in"
              ? incomingTypes
              : outgoingTypes
            )
              .filter((type) => type !== "transfer")
              .map((type) => (
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
            value={movementEditForm.occurredAt}
            onChange={(event) =>
              updateMovementEdit(
                "occurredAt",
                event.target.value,
              )
            }
            className={inputClass}
          />
        </label>
        <StockContactSelect
          contacts={availableContacts}
          value={movementEditForm.contactId}
          onChange={(value) => updateMovementEdit("contactId", value)}
          t={t}
          includeArchived
        />
        <label className={labelClass}>
          {movementEditDirection === "in"
            ? t("resource.booking.inboundPrice")
            : t("resource.booking.outboundPrice")}
          <div className="relative">
            <input
              type="number"
              min={
                movementEditDirection === "in"
                  ? "0"
                  : undefined
              }
              step="0.01"
              inputMode="decimal"
              value={movementEditForm.totalPrice}
              onChange={(event) =>
                updateMovementEdit(
                  "totalPrice",
                  event.target.value,
                )
              }
              className={`${inputClass} pr-14 tabular-nums`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[12px] text-muted">
              {stock.resource.currency}
            </span>
          </div>
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          {t("resource.booking.reason")}
          <input
            value={movementEditForm.reason}
            maxLength={240}
            onChange={(event) =>
              updateMovementEdit("reason", event.target.value)
            }
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          {t("resource.booking.location")}
          <input
            value={movementEditForm.location}
            maxLength={240}
            onChange={(event) =>
              updateMovementEdit(
                "location",
                event.target.value,
              )
            }
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>
          {t("resource.booking.note")}
          <textarea
            rows={2}
            value={movementEditForm.note}
            maxLength={20_000}
            onChange={(event) =>
              updateMovementEdit("note", event.target.value)
            }
            className={`${inputClass} h-auto resize-y py-3`}
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={closeMovementEditor}
          disabled={savingMovementId === movement.id}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
        >
          <X className="size-3.5" aria-hidden="true" />
          {t("resource.actions.cancel")}
        </button>
        <button
          type="submit"
          disabled={savingMovementId === movement.id}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-solid px-3 text-xs font-semibold text-on-brand transition hover:bg-brand-hover disabled:opacity-50"
        >
          {savingMovementId === movement.id ? (
            <LoaderCircle
              className="size-3.5 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          {t("resource.actions.saveMovement")}
        </button>
      </div>
    </form>
  );
}
