import type {
  CustomFieldDefinition,
  CustomFieldValues,
} from "@/lib/custom-field-contract";
import type { TFunction } from "i18next";
import type { Dispatch, SetStateAction } from "react";

export type TrackingMode = "bulk" | "serialized";

export type MovementType =
  | "receipt"
  | "issue"
  | "adjustment"
  | "return"
  | "waste"
  | "transfer";

export type UnitStatus =
  | "available"
  | "reserved"
  | "in-use"
  | "maintenance"
  | "consumed"
  | "lost"
  | "retired";

export type StockConfig = {
  trackingMode: TrackingMode;
  minimumStock: number;
  reorderQuantity: number;
  leadTimeDays: number;
  unitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
};

export type StockForecast = {
  averageDailyUsage: number;
  daysUntilStockout: number | null;
  predictedStockoutAt: string | null;
  isBelowMinimum: boolean;
  suggestedReorderQuantity: number;
};

export type StockMovement = {
  id: string;
  contactId?: string | null;
  delta: number;
  balanceAfter: number;
  type: string;
  reason: string | null;
  note: string | null;
  location: string | null;
  occurredAt: string;
  createdAt: string;
  createdBy: string | null;
  unitId?: string | null;
  variantId?: string | null;
  variantDelta?: number | null;
  variantBalanceAfter?: number | null;
  assemblyBuildId?: string | null;
  purchaseReceiptId?: string | null;
  fromLocationResourceId?: string | null;
  toLocationResourceId?: string | null;
  totalPriceCents?: number | null;
  priceCurrency?: string | null;
  costCents?: number | null;
  costCurrency?: string | null;
  costEstimated?: boolean;
};

export type StockUnit = {
  id: string;
  code: string;
  status: UnitStatus;
  location: string | null;
  locationResourceId: string | null;
  customFields: CustomFieldValues;
  metadata: Record<string, unknown>;
  acquiredAt: string | null;
  lastMovedAt: string | null;
  createdAt: string;
  updatedAt: string;
  acquisitionCostCents?: number | null;
  costCurrency?: string | null;
  installation?: {
    buildId: string;
    assemblyResourceId: string;
    assemblyName: string;
    outputUnitId: string | null;
    outputUnitCode: string | null;
    installedAt: string;
  };
};

export type StockData = {
  resource: {
    id: string;
    name: string;
    quantity: number;
    type: string;
    categories: Array<{ name: string; color?: string }>;
    valueCents: number | null;
    currency: string;
  };
  config: StockConfig;
  forecast: StockForecast;
  procurement: {
    onOrder: number;
    projectedQuantity: number;
    nextExpectedAt: string | null;
    openLines: Array<{
      lineId: string;
      orderId: string;
      reference: string | null;
      supplier: string;
      orderedQuantity: number;
      receivedQuantity: number;
      openQuantity: number;
      expectedAt: string | null;
    }>;
  };
  movements: StockMovement[];
  units: StockUnit[];
};

export type StockApiResponse = Partial<StockData> & {
  stock?: StockData;
  data?: StockData;
};

export type MovementForm = {
  quantity: string;
  quantityUnit: "base" | "purchase";
  type: MovementType;
  reason: string;
  note: string;
  location: string;
  occurredAt: string;
  totalPrice: string;
  contactId: string;
};

export type StockContact = {
  id: string;
  name: string;
  company: string | null;
  roles: Array<"customer" | "supplier">;
  archivedAt: string | null;
};

export type UnitCreateForm = {
  idMode: "generated" | "custom";
  count: string;
  codes: string;
  location: string;
  locationResourceId: string;
  customFields: CustomFieldValues;
  metadata: string;
  acquiredAt: string;
  totalPrice: string;
};

export type UnitEditForm = {
  status: UnitStatus;
  location: string;
  locationResourceId: string;
  customFields: CustomFieldValues;
  metadata: string;
  occurredAt: string;
  reason: string;
  note: string;
  totalPrice: string;
};

export type MovementPayload = {
  delta: number;
  quantity?: number;
  type: MovementType;
  reason?: string;
  note?: string;
  location?: string;
  occurredAt?: string;
  totalPriceCents?: number;
  priceCurrency?: string;
  contactId?: string | null;
};

export type CustomFieldsApiResponse = { definitions: CustomFieldDefinition[] };

export type StockLocationOption = {
  id: string;
  name: string;
  type: string;
  status: string;
};

export type StockLocationsApiResponse = { availableLocations: StockLocationOption[] };

export type StockMutationContext = {
  stock: StockData | null;
  endpoint: string;
  loadStock: (quiet?: boolean) => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  unitName: string;
  numberFormat: Intl.NumberFormat;
  t: TFunction;
};

export type StockSectionProps = {
  stock: StockData;
  unitName: string;
  numberFormat: Intl.NumberFormat;
  locale: string;
  t: TFunction;
};
