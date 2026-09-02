export const MAX_STOCK_QUANTITY = 2_000_000_000;

export type PurchaseUnitConfiguration = {
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
};

export function hasPurchaseUnit(
  configuration: PurchaseUnitConfiguration,
): configuration is { purchaseUnitName: string; purchaseUnitFactor: number } {
  return (
    Boolean(configuration.purchaseUnitName?.trim()) &&
    Number.isSafeInteger(configuration.purchaseUnitFactor) &&
    (configuration.purchaseUnitFactor ?? 0) > 0
  );
}

export function purchaseUnitsToBaseUnits(
  quantity: number,
  factor: number,
  maximum = MAX_STOCK_QUANTITY,
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError("Purchase quantity must be a positive whole number.");
  }
  if (!Number.isSafeInteger(factor) || factor < 1) {
    throw new RangeError("Purchase unit factor must be a positive whole number.");
  }
  const baseQuantity = quantity * factor;
  if (!Number.isSafeInteger(baseQuantity) || baseQuantity > maximum) {
    throw new RangeError(`Converted quantity must not exceed ${maximum}.`);
  }
  return baseQuantity;
}

export function baseUnitsToPurchaseUnits(quantity: number, factor: number) {
  if (!Number.isFinite(quantity) || !Number.isSafeInteger(factor) || factor < 1) {
    return null;
  }
  const purchaseQuantity = quantity / factor;
  return Number.isInteger(purchaseQuantity) ? purchaseQuantity : null;
}
