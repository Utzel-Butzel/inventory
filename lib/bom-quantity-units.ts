import {
  baseUnitsToPurchaseUnits,
  hasPurchaseUnit,
  purchaseUnitsToBaseUnits,
  type PurchaseUnitConfiguration,
} from "@/lib/stock-quantity-units";

export type BomQuantityUnit = "base" | "purchase";

export type BomQuantityUnitConfiguration = PurchaseUnitConfiguration & {
  unitName: string;
};

export function availableBomQuantityUnits(
  configuration: BomQuantityUnitConfiguration,
): BomQuantityUnit[] {
  return hasPurchaseUnit(configuration) ? ["base", "purchase"] : ["base"];
}

export function normalizeBomQuantityUnit(
  quantityPerAssembly: number,
  quantityUnit: BomQuantityUnit | null | undefined,
  configuration: BomQuantityUnitConfiguration,
): BomQuantityUnit {
  return quantityUnit === "purchase" &&
    hasPurchaseUnit(configuration) &&
    baseUnitsToPurchaseUnits(
      quantityPerAssembly,
      configuration.purchaseUnitFactor,
    ) !== null
    ? "purchase"
    : "base";
}

export function bomQuantityToDisplay(
  quantityPerAssembly: number,
  quantityUnit: BomQuantityUnit,
  configuration: BomQuantityUnitConfiguration,
) {
  if (quantityUnit !== "purchase" || !hasPurchaseUnit(configuration)) {
    return quantityPerAssembly;
  }
  return (
    baseUnitsToPurchaseUnits(
      quantityPerAssembly,
      configuration.purchaseUnitFactor,
    ) ?? quantityPerAssembly
  );
}

export function bomQuantityFromDisplay(
  quantity: number,
  quantityUnit: BomQuantityUnit,
  configuration: BomQuantityUnitConfiguration,
) {
  if (quantityUnit === "purchase" && hasPurchaseUnit(configuration)) {
    return purchaseUnitsToBaseUnits(quantity, configuration.purchaseUnitFactor);
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError("BOM quantity must be a positive whole number.");
  }
  return quantity;
}

export function bomQuantityUnitName(
  quantityUnit: BomQuantityUnit,
  configuration: BomQuantityUnitConfiguration,
) {
  return quantityUnit === "purchase" && hasPurchaseUnit(configuration)
    ? configuration.purchaseUnitName
    : configuration.unitName;
}
