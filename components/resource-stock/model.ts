import { localDateTime } from "@/lib/client-formatters";

import type { TFunction } from "i18next";

import { type CustomFieldValues } from "@/lib/custom-field-contract";

import type {
  MovementForm,
  MovementType,
  StockApiResponse,
  StockData,
  StockMovement,
  UnitCreateForm,
  UnitStatus,
} from "./types";

const editableMovementTypes = new Set<MovementType>([
  "receipt",
  "issue",
  "adjustment",
  "return",
  "waste",
]);

export function isManualMovement(movement: StockMovement) {
  return (
    editableMovementTypes.has(movement.type as MovementType) &&
    !movement.unitId &&
    !movement.variantId &&
    !movement.assemblyBuildId &&
    !movement.purchaseReceiptId &&
    !movement.fromLocationResourceId &&
    !movement.toLocationResourceId
  );
}

export const movementLabelKeys: Record<MovementType, string> = {
  receipt: "resource.movements.types.receipt",
  issue: "resource.movements.types.issue",
  adjustment: "resource.movements.types.adjustment",
  return: "resource.movements.types.return",
  waste: "resource.movements.types.waste",
  transfer: "resource.movements.types.transfer",
};

export const incomingTypes: MovementType[] = [
  "receipt",
  "return",
  "adjustment",
  "transfer",
];
export const outgoingTypes: MovementType[] = [
  "issue",
  "waste",
  "adjustment",
  "transfer",
];

export const statusLabelKeys: Record<UnitStatus, string> = {
  available: "resource.units.status.available",
  reserved: "resource.units.status.reserved",
  "in-use": "resource.units.status.inUse",
  maintenance: "resource.units.status.maintenance",
  consumed: "resource.units.status.consumed",
  lost: "resource.units.status.lost",
  retired: "resource.units.status.retired",
};

export const unitStatuses = Object.keys(statusLabelKeys) as UnitStatus[];

export const defaultMovementForm = (direction: "in" | "out"): MovementForm => ({
  quantity: "1",
  quantityUnit: "base",
  type: direction === "in" ? "receipt" : "issue",
  reason: "",
  note: "",
  location: "",
  occurredAt: localDateTime(),
  totalPrice: "",
  contactId: "",
});

export const defaultUnitCreateForm = (): UnitCreateForm => ({
  idMode: "generated",
  count: "1",
  codes: "",
  location: "",
  locationResourceId: "",
  customFields: {},
  metadata: "{}",
  acquiredAt: localDateTime(),
  totalPrice: "",
});

export function parseMetadata(value: string, t: TFunction) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("resource.errors.metadataObject"));
  }
  return parsed as Record<string, unknown>;
}

export function customFieldValuesEqual(left: CustomFieldValues, right: CustomFieldValues) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      JSON.stringify(left[key]) === JSON.stringify(right[key]),
  );
}

export function quantityLabel(
  value: number,
  unitName: string,
  numberFormat: Intl.NumberFormat,
  t: TFunction,
) {
  const formatted = numberFormat.format(value);
  const name = unitName.trim();
  if (!name || name === "unit") {
    return t("resource.quantity.units", { count: value, value: formatted });
  }
  return `${formatted} ${name}`;
}

export function unitStatusClass(status: UnitStatus) {
  if (status === "available") return "bg-success-soft text-success";
  if (status === "reserved" || status === "in-use")
    return "bg-info-soft text-info";
  if (status === "maintenance") return "bg-warning-soft text-warning";
  if (status === "lost") return "bg-danger-soft text-danger";
  return "bg-surface-muted text-muted";
}

export function normalizeStock(payload: StockApiResponse, t: TFunction): StockData {
  const source = payload.stock ?? payload.data ?? payload;
  if (!source.resource) throw new Error(t("resource.errors.missingResource"));
  return {
    resource: {
      ...source.resource,
      type: source.resource.type ?? "other",
      categories: source.resource.categories ?? [],
      valueCents: source.resource.valueCents ?? null,
      currency: source.resource.currency ?? "EUR",
    },
    config: source.config ?? {
      trackingMode: "bulk",
      minimumStock: 0,
      reorderQuantity: 0,
      leadTimeDays: 0,
      unitName: "unit",
      purchaseUnitName: null,
      purchaseUnitFactor: null,
    },
    forecast: source.forecast ?? {
      averageDailyUsage: 0,
      daysUntilStockout: null,
      predictedStockoutAt: null,
      isBelowMinimum: false,
      suggestedReorderQuantity: 0,
    },
    procurement: source.procurement ?? {
      onOrder: 0,
      projectedQuantity: source.resource.quantity,
      nextExpectedAt: null,
      openLines: [],
    },
    movements: source.movements ?? [],
    units: (source.units ?? []).map((unit) => ({
      ...unit,
      customFields: unit.customFields ?? {},
      metadata: unit.metadata ?? {},
    })),
  };
}
