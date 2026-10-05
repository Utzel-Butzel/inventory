import type { TFunction } from "i18next";

import { quantityLabel } from "@/components/resource-stock/model";
import { moneyToCents, toIsoDateTime } from "@/lib/client-formatters";
import { purchaseUnitsToBaseUnits } from "@/lib/stock-quantity-units";
import type { MovementForm, MovementPayload } from "./types";

type MovementOptions = {
  direction: "in" | "out";
  currentQuantity: number;
  allowNegativeStock: boolean;
  currency: string;
  unitName: string;
  numberFormat: Intl.NumberFormat;
  t: TFunction;
} & (
    | { mode: "create"; purchaseUnitFactor: number }
    | { mode: "edit"; previousDelta: number }
  );

export function buildStockMovementPayload(
  form: MovementForm,
  options: MovementOptions,
): MovementPayload {
  const { direction, currentQuantity, allowNegativeStock, currency, t } = options;
  const enteredQuantity = Number(form.quantity);
  if (!Number.isInteger(enteredQuantity) || enteredQuantity < 1) {
    throw new Error(t("resource.errors.validQuantity"));
  }
  const quantity =
    options.mode === "create" && direction === "in" && form.quantityUnit === "purchase"
      ? purchaseUnitsToBaseUnits(enteredQuantity, options.purchaseUnitFactor)
      : enteredQuantity;
  const delta = direction === "in" ? quantity : -quantity;
  const availableQuantity = options.mode === "edit"
    ? currentQuantity - options.previousDelta
    : currentQuantity;
  // Receipts may reduce an existing deficit; corrections must leave a valid balance.
  const exceedsAvailable = options.mode === "edit"
    ? availableQuantity + delta < 0
    : direction === "out" && quantity > availableQuantity;
  if (!allowNegativeStock && exceedsAvailable) {
    throw new Error(t("resource.errors.onlyAvailable", {
      quantity: quantityLabel(availableQuantity, options.unitName, options.numberFormat, t),
    }));
  }

  const occurredAt = toIsoDateTime(form.occurredAt);
  if (form.occurredAt && !occurredAt) {
    throw new Error(t("resource.errors.validBookingDate"));
  }
  const totalPriceCents = moneyToCents(form.totalPrice, direction === "out");
  if (Number.isNaN(totalPriceCents)) {
    throw new Error(t("resource.errors.validPrice"));
  }

  return {
    delta,
    ...(options.mode === "edit" ? { quantity } : {}),
    type: form.type,
    reason: form.reason.trim() || undefined,
    note: form.note.trim() || undefined,
    location: form.location.trim() || undefined,
    occurredAt,
    contactId: form.contactId || null,
    ...(totalPriceCents === null ? {} : { totalPriceCents, priceCurrency: currency }),
  };
}

export type StockBookingTask = "issue" | "receipt" | "count";

export function parseStockBookingTask(value: unknown): StockBookingTask {
  return value === "issue" || value === "count" ? value : "receipt";
}

export function buildStockCountPayload(form: MovementForm, options: MovementOptions): MovementPayload {
  const counted = Number(form.quantity);
  if (!form.quantity.trim() || !Number.isSafeInteger(counted) || counted < 0 || counted > 2_000_000_000) {
    throw new Error(options.t("resource.errors.validCount"));
  }
  const delta = counted - options.currentQuantity;
  const payload = buildStockMovementPayload({
    ...form, quantity: String(Math.abs(delta) || 1), quantityUnit: "base",
    type: "adjustment", totalPrice: "",
  }, { ...options, mode: "create", purchaseUnitFactor: 1, direction: delta < 0 ? "out" : "in" });
  return { ...payload, delta, expectedQuantity: options.currentQuantity };
}
