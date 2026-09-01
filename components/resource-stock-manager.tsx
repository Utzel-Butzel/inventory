"use client";

import type { TFunction } from "i18next";
import {
  OrganizationLink as Link,
  useOrganizationAllowsNegativeStock,
} from "@/components/organization-routing";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Barcode,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  History,
  Info,
  Layers3,
  LoaderCircle,
  MapPin,
  Minus,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useT } from "next-i18next/client";

import { AssemblyManager } from "@/components/assembly-manager";
import {
  CustomFieldInputs,
  CustomFieldValueSummary,
} from "@/components/custom-field-inputs";
import {
  PhotoCountCapture,
  type PhotoCountResult,
} from "@/components/photo-count-capture";
import { StockLocationsManager } from "@/components/stock-locations-manager";
import { ResourceStockConfigurationSwitcher } from "@/components/resource-stock-configuration-switcher";
import { fetchJson } from "@/lib/client-types";
import {
  isCustomFieldDefinitionApplicable,
  type CustomFieldDefinition,
  type CustomFieldValues,
} from "@/lib/custom-field-contract";

type TrackingMode = "bulk" | "serialized";
type MovementType =
  | "receipt"
  | "issue"
  | "adjustment"
  | "return"
  | "waste"
  | "transfer";
type UnitStatus =
  | "available"
  | "reserved"
  | "in-use"
  | "maintenance"
  | "consumed"
  | "lost"
  | "retired";

type StockConfig = {
  trackingMode: TrackingMode;
  minimumStock: number;
  reorderQuantity: number;
  leadTimeDays: number;
  unitName: string;
};

type StockForecast = {
  averageDailyUsage: number;
  daysUntilStockout: number | null;
  predictedStockoutAt: string | null;
  isBelowMinimum: boolean;
  suggestedReorderQuantity: number;
};

type StockMovement = {
  id: string;
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

type StockUnit = {
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

type StockData = {
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

type StockApiResponse = Partial<StockData> & {
  stock?: StockData;
  data?: StockData;
};

type MovementForm = {
  quantity: string;
  type: MovementType;
  reason: string;
  note: string;
  location: string;
  occurredAt: string;
  totalPrice: string;
};

type UnitCreateForm = {
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

type UnitEditForm = {
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

type MovementPayload = {
  delta: number;
  quantity?: number;
  type: MovementType;
  reason?: string;
  note?: string;
  location?: string;
  occurredAt?: string;
  totalPriceCents?: number;
  priceCurrency?: string;
};

const editableMovementTypes = new Set<MovementType>([
  "receipt",
  "issue",
  "adjustment",
  "return",
  "waste",
]);

function isManualMovement(movement: StockMovement) {
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

type CustomFieldsApiResponse = { definitions: CustomFieldDefinition[] };
type StockLocationOption = {
  id: string;
  name: string;
  type: string;
  status: string;
};
type StockLocationsApiResponse = { availableLocations: StockLocationOption[] };

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted";
const labelClass = "block text-xs font-semibold text-muted-strong";

const movementLabelKeys: Record<MovementType, string> = {
  receipt: "resource.movements.types.receipt",
  issue: "resource.movements.types.issue",
  adjustment: "resource.movements.types.adjustment",
  return: "resource.movements.types.return",
  waste: "resource.movements.types.waste",
  transfer: "resource.movements.types.transfer",
};

const incomingTypes: MovementType[] = [
  "receipt",
  "return",
  "adjustment",
  "transfer",
];
const outgoingTypes: MovementType[] = [
  "issue",
  "waste",
  "adjustment",
  "transfer",
];

const statusLabelKeys: Record<UnitStatus, string> = {
  available: "resource.units.status.available",
  reserved: "resource.units.status.reserved",
  "in-use": "resource.units.status.inUse",
  maintenance: "resource.units.status.maintenance",
  consumed: "resource.units.status.consumed",
  lost: "resource.units.status.lost",
  retired: "resource.units.status.retired",
};

const unitStatuses = Object.keys(statusLabelKeys) as UnitStatus[];

function localDateTime(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const defaultMovementForm = (direction: "in" | "out"): MovementForm => ({
  quantity: "1",
  type: direction === "in" ? "receipt" : "issue",
  reason: "",
  note: "",
  location: "",
  occurredAt: localDateTime(),
  totalPrice: "",
});

const defaultUnitCreateForm = (): UnitCreateForm => ({
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

function parseMetadata(value: string, t: TFunction) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("resource.errors.metadataObject"));
  }
  return parsed as Record<string, unknown>;
}

function customFieldValuesEqual(left: CustomFieldValues, right: CustomFieldValues) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      JSON.stringify(left[key]) === JSON.stringify(right[key]),
  );
}

function toIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function moneyToCents(value: string, allowNegative = false) {
  if (!value.trim()) return null;
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || (!allowNegative && amount < 0)) {
    return Number.NaN;
  }
  return Math.round(amount * 100);
}

function formatMoney(cents: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatDate(
  value: string | null | undefined,
  locale: string,
  includeTime = false,
) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function quantityLabel(
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

function unitStatusClass(status: UnitStatus) {
  if (status === "available") return "bg-success-soft text-success";
  if (status === "reserved" || status === "in-use")
    return "bg-info-soft text-info";
  if (status === "maintenance") return "bg-warning-soft text-warning";
  if (status === "lost") return "bg-danger-soft text-danger";
  return "bg-surface-muted text-muted";
}

function normalizeStock(payload: StockApiResponse, t: TFunction): StockData {
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

function SectionHeading({
  icon,
  title,
  description,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted">{description}</p>
        </div>
      </div>
      {trailing}
    </div>
  );
}

export function ResourceStockManager({
  resourceId,
  canEdit = false,
}: {
  resourceId: string;
  canEdit?: boolean;
}) {
  const allowNegativeStock = useOrganizationAllowsNegativeStock();
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const endpoint = `/api/v1/resources/${resourceId}/stock`;
  const customFieldsEndpoint = "/api/v1/custom-fields?entityType=stock_unit";
  const [stock, setStock] = useState<StockData | null>(null);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<
    CustomFieldDefinition[]
  >([]);
  const [customFieldError, setCustomFieldError] = useState<string | null>(null);
  const [availableLocations, setAvailableLocations] = useState<StockLocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [direction, setDirection] = useState<"in" | "out">("in");
  const [movementForm, setMovementForm] = useState<MovementForm>(
    defaultMovementForm("in"),
  );
  const [pendingMovement, setPendingMovement] = useState<MovementPayload | null>(null);
  const [postingMovement, setPostingMovement] = useState(false);
  const [editingMovementId, setEditingMovementId] = useState<string | null>(
    null,
  );
  const [movementEditDirection, setMovementEditDirection] = useState<
    "in" | "out"
  >("in");
  const [movementEditForm, setMovementEditForm] = useState<MovementForm | null>(
    null,
  );
  const [savingMovementId, setSavingMovementId] = useState<string | null>(null);
  const [deletingMovementId, setDeletingMovementId] = useState<string | null>(
    null,
  );
  const [historyFilter, setHistoryFilter] = useState<"all" | "in" | "out" | "audit">(
    "all",
  );

  const [unitCreateForm, setUnitCreateForm] = useState<UnitCreateForm>(
    defaultUnitCreateForm,
  );
  const [creatingUnits, setCreatingUnits] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitEditForm, setUnitEditForm] = useState<UnitEditForm | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);

  const loadStock = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      setCustomFieldError(null);
      try {
        const [payload, definitionsResult, locationsResult] = await Promise.all([
          fetchJson<StockApiResponse>(endpoint, { cache: "no-store" }),
          fetchJson<CustomFieldsApiResponse>(customFieldsEndpoint, {
            cache: "no-store",
          }).then(
            (value) => ({ value, error: null }),
            (definitionError: unknown) => ({
              value: null,
              error:
                definitionError instanceof Error
                  ? definitionError.message
                  : t("resource.errors.customFields"),
            }),
          ),
          fetchJson<StockLocationsApiResponse>(`${endpoint}/locations`, {
            cache: "no-store",
          }).catch(() => null),
        ]);
        const normalized = normalizeStock(payload, t);
        setStock(normalized);
        if (definitionsResult.value) {
          setCustomFieldDefinitions(definitionsResult.value.definitions);
        } else {
          setCustomFieldError(definitionsResult.error);
        }
        if (locationsResult) {
          setAvailableLocations(
            locationsResult.availableLocations.filter(
              (location) => location.id !== resourceId && location.status !== "archived",
            ),
          );
        }
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("resource.errors.load"),
        );
      } finally {
        setLoading(false);
      }
    },
    [customFieldsEndpoint, endpoint, resourceId, t],
  );

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  const currentQuantity = stock?.resource.quantity ?? 0;
  const unitName = stock?.config.unitName || t("resource.unit");
  const onOrder = stock?.procurement.onOrder ?? 0;
  const movementTypes = direction === "in" ? incomingTypes : outgoingTypes;
  const applicableCustomFields = useMemo(
    () =>
      stock
        ? customFieldDefinitions.filter((definition) =>
            isCustomFieldDefinitionApplicable(definition, {
              type: stock.resource.type,
              categories: stock.resource.categories,
            }),
          )
        : [],
    [customFieldDefinitions, stock],
  );

  const filteredMovements = useMemo(() => {
    const movements = stock?.movements ?? [];
    return movements.filter((movement) => {
      if (historyFilter === "in") return movement.delta > 0;
      if (historyFilter === "out") return movement.delta < 0;
      if (historyFilter === "audit") return movement.delta === 0;
      return true;
    });
  }, [historyFilter, stock?.movements]);

  function selectDirection(next: "in" | "out") {
    setDirection(next);
    setMovementForm((current) => ({
      ...current,
      type: next === "in" ? "receipt" : "issue",
    }));
  }

  function updateMovement<K extends keyof MovementForm>(key: K, value: MovementForm[K]) {
    setMovementForm((current) => ({ ...current, [key]: value }));
  }

  function applyPhotoCount(result: PhotoCountResult) {
    setMovementForm((current) => ({
      ...current,
      quantity: String(result.count),
      reason: current.reason || t("resource.movements.photoAssisted"),
    }));
  }

  function buildMovementPayload() {
    const quantity = Number(movementForm.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(t("resource.errors.validQuantity"));
    }
    if (
      !allowNegativeStock &&
      direction === "out" &&
      quantity > currentQuantity
    ) {
      throw new Error(
        t("resource.errors.onlyAvailable", {
          quantity: quantityLabel(
            currentQuantity,
            unitName,
            numberFormat,
            t,
          ),
        }),
      );
    }
    const occurredAt = toIso(movementForm.occurredAt);
    if (movementForm.occurredAt && !occurredAt) {
      throw new Error(t("resource.errors.validBookingDate"));
    }
    const totalPriceCents = moneyToCents(
      movementForm.totalPrice,
      direction === "out",
    );
    if (Number.isNaN(totalPriceCents)) {
      throw new Error(t("resource.errors.validPrice"));
    }
    return {
      delta: direction === "in" ? quantity : -quantity,
      type: movementForm.type,
      reason: movementForm.reason.trim() || undefined,
      note: movementForm.note.trim() || undefined,
      location: movementForm.location.trim() || undefined,
      occurredAt,
      ...(totalPriceCents === null
        ? {}
        : { totalPriceCents, priceCurrency: stock?.resource.currency ?? "EUR" }),
    } satisfies MovementPayload;
  }

  async function postMovement(payload: MovementPayload) {
    setPostingMovement(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`${endpoint}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setPendingMovement(null);
      setMovementForm(defaultMovementForm(direction));
      await loadStock(true);
      setNotice(
        payload.delta > 0
          ? t("resource.notices.bookedIn", {
              quantity: quantityLabel(payload.delta, unitName, numberFormat, t),
            })
          : t("resource.notices.bookedOut", {
              quantity: quantityLabel(
                Math.abs(payload.delta),
                unitName,
                numberFormat,
                t,
              ),
            }),
      );
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.bookMovement"),
      );
    } finally {
      setPostingMovement(false);
    }
  }

  function submitMovement(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!stock) return;
    if (stock.config.trackingMode === "serialized") {
      setError(
        t("resource.errors.serializedBooking"),
      );
      return;
    }
    try {
      const payload = buildMovementPayload();
      if (payload.delta < 0) {
        setPendingMovement(payload);
      } else {
        void postMovement(payload);
      }
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.checkBooking"),
      );
    }
  }

  function startEditingMovement(movement: StockMovement) {
    const nextDirection = movement.delta >= 0 ? "in" : "out";
    setEditingMovementId(movement.id);
    setMovementEditDirection(nextDirection);
    setMovementEditForm({
      quantity: String(Math.abs(movement.delta)),
      type: movement.type as MovementType,
      reason: movement.reason ?? "",
      note: movement.note ?? "",
      location: movement.location ?? "",
      occurredAt: localDateTime(movement.occurredAt),
      totalPrice:
        movement.totalPriceCents === null ||
        movement.totalPriceCents === undefined
          ? ""
          : (movement.totalPriceCents / 100).toFixed(2),
    });
    setError(null);
  }

  function closeMovementEditor() {
    setEditingMovementId(null);
    setMovementEditForm(null);
  }

  function selectMovementEditDirection(next: "in" | "out") {
    setMovementEditDirection(next);
    setMovementEditForm((current) =>
      current
        ? {
            ...current,
            type: next === "in" ? "receipt" : "issue",
          }
        : current,
    );
  }

  function updateMovementEdit<K extends keyof MovementForm>(
    key: K,
    value: MovementForm[K],
  ) {
    setMovementEditForm((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }

  function buildMovementEditPayload(movement: StockMovement) {
    if (!movementEditForm) throw new Error(t("resource.errors.checkBooking"));
    const quantity = Number(movementEditForm.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(t("resource.errors.validQuantity"));
    }
    const delta = movementEditDirection === "in" ? quantity : -quantity;
    const correctedQuantity = currentQuantity - movement.delta + delta;
    if (!allowNegativeStock && correctedQuantity < 0) {
      throw new Error(
        t("resource.errors.onlyAvailable", {
          quantity: quantityLabel(
            currentQuantity - movement.delta,
            unitName,
            numberFormat,
            t,
          ),
        }),
      );
    }
    const occurredAt = toIso(movementEditForm.occurredAt);
    if (movementEditForm.occurredAt && !occurredAt) {
      throw new Error(t("resource.errors.validBookingDate"));
    }
    const totalPriceCents = moneyToCents(
      movementEditForm.totalPrice,
      movementEditDirection === "out",
    );
    if (Number.isNaN(totalPriceCents)) {
      throw new Error(t("resource.errors.validPrice"));
    }
    return {
      delta,
      quantity,
      type: movementEditForm.type,
      reason: movementEditForm.reason.trim() || undefined,
      note: movementEditForm.note.trim() || undefined,
      location: movementEditForm.location.trim() || undefined,
      occurredAt,
      ...(totalPriceCents === null
        ? {}
        : {
            totalPriceCents,
            priceCurrency: stock?.resource.currency ?? "EUR",
          }),
    } satisfies MovementPayload;
  }

  async function saveMovementEdit(
    event: FormEvent,
    movement: StockMovement,
  ) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const payload = buildMovementEditPayload(movement);
      setSavingMovementId(movement.id);
      await fetchJson(`${endpoint}/movements/${movement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      closeMovementEditor();
      await loadStock(true);
      setNotice(t("resource.notices.movementUpdated"));
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.updateMovement"),
      );
    } finally {
      setSavingMovementId(null);
    }
  }

  async function deleteMovement(movement: StockMovement) {
    if (
      deletingMovementId ||
      !window.confirm(t("resource.confirm.deleteMovement"))
    ) {
      return;
    }
    setDeletingMovementId(movement.id);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`${endpoint}/movements/${movement.id}`, {
        method: "DELETE",
      });
      if (editingMovementId === movement.id) closeMovementEditor();
      await loadStock(true);
      setNotice(t("resource.notices.movementDeleted"));
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : t("resource.errors.deleteMovement"),
      );
    } finally {
      setDeletingMovementId(null);
    }
  }

  async function createUnits(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      const metadata = parseMetadata(unitCreateForm.metadata, t);
      const acquiredAt = toIso(unitCreateForm.acquiredAt);
      if (unitCreateForm.acquiredAt && !acquiredAt) {
        throw new Error(t("resource.errors.validAcquisitionDate"));
      }
      const totalPriceCents = moneyToCents(unitCreateForm.totalPrice);
      if (Number.isNaN(totalPriceCents)) {
        throw new Error(t("resource.errors.validPrice"));
      }

      let identifierPayload: { count: number } | { code: string } | { codes: string[] };
      let createdCount: number;
      if (unitCreateForm.idMode === "generated") {
        const count = Number(unitCreateForm.count);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          throw new Error(t("resource.errors.generatedUnitRange"));
        }
        identifierPayload = { count };
        createdCount = count;
      } else {
        const codes = unitCreateForm.codes
          .split(/[\n,]+/)
          .map((code) => code.trim())
          .filter(Boolean);
        if (!codes.length || codes.length > 100) {
          throw new Error(t("resource.errors.customUnitRange"));
        }
        if (new Set(codes.map((code) => code.toLowerCase())).size !== codes.length) {
          throw new Error(t("resource.errors.uniqueUnitIds"));
        }
        if (codes.some((code) => code.length > 120)) {
          throw new Error(t("resource.errors.unitIdLength"));
        }
        identifierPayload = codes.length === 1 ? { code: codes[0]! } : { codes };
        createdCount = codes.length;
      }

      setCreatingUnits(true);
      await fetchJson(`${endpoint}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...identifierPayload,
          location: unitCreateForm.location.trim() || undefined,
          locationResourceId: unitCreateForm.locationResourceId || null,
          customFields: unitCreateForm.customFields,
          metadata,
          acquiredAt,
          ...(totalPriceCents === null
            ? {}
            : { totalPriceCents, priceCurrency: stock?.resource.currency ?? "EUR" }),
        }),
      });
      setUnitCreateForm(defaultUnitCreateForm());
      await loadStock(true);
      setNotice(
        t("resource.notices.unitsCreated", {
          count: createdCount,
          value: numberFormat.format(createdCount),
        }),
      );
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("resource.errors.createUnits"),
      );
    } finally {
      setCreatingUnits(false);
    }
  }

  async function saveUnit(event: FormEvent) {
    event.preventDefault();
    if (!editingUnitId || !unitEditForm || !stock) return;
    setError(null);
    setNotice(null);
    try {
      const metadata = parseMetadata(unitEditForm.metadata, t);
      const occurredAt = toIso(unitEditForm.occurredAt);
      if (unitEditForm.occurredAt && !occurredAt) {
        throw new Error(t("resource.errors.validMovementDate"));
      }
      const unit = stock.units.find((candidate) => candidate.id === editingUnitId);
      const leavingAvailable =
        unit?.status === "available" && unitEditForm.status !== "available";
      const totalPriceCents = moneyToCents(
        unitEditForm.totalPrice,
        leavingAvailable,
      );
      if (Number.isNaN(totalPriceCents)) {
        throw new Error(t("resource.errors.validPrice"));
      }
      const customFieldsChanged = unit
        ? !customFieldValuesEqual(unit.customFields, unitEditForm.customFields)
        : true;
      if (
        leavingAvailable &&
        !window.confirm(
          t("resource.confirm.leaveAvailable", {
            code: unit.code,
            status: t(statusLabelKeys[unitEditForm.status]),
            unit: unitName,
          }),
        )
      ) {
        return;
      }

      setSavingUnit(true);
      await fetchJson(`${endpoint}/units/${editingUnitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: unitEditForm.status,
          location: unitEditForm.location.trim() || null,
          locationResourceId: unitEditForm.locationResourceId || null,
          ...(customFieldsChanged
            ? { customFields: unitEditForm.customFields }
            : {}),
          metadata,
          occurredAt,
          reason: unitEditForm.reason.trim() || undefined,
          note: unitEditForm.note.trim() || undefined,
          ...(totalPriceCents === null
            ? {}
            : { totalPriceCents, priceCurrency: stock.resource.currency }),
        }),
      });
      setEditingUnitId(null);
      setUnitEditForm(null);
      await loadStock(true);
      setNotice(
        t("resource.notices.unitUpdated", {
          code: unit?.code ?? t("resource.units.record"),
        }),
      );
    } catch (unitError) {
      setError(
        unitError instanceof Error
          ? unitError.message
          : t("resource.errors.updateUnit"),
      );
    } finally {
      setSavingUnit(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[calc(100dvh-68px)] place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-border bg-surface text-brand shadow-sm">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-muted">
            {t("resource.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (!stock) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <div className="rounded-2xl border border-danger-border bg-surface px-6 py-12 shadow-sm">
          <AlertTriangle className="mx-auto size-7 text-danger" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold text-foreground">
            {t("resource.unavailable.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
            {error ?? t("resource.unavailable.description")}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link
              href={`/inventory/${resourceId}`}
              className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-muted-strong hover:bg-surface-hover"
            >
              {t("resource.actions.backToItem")}
            </Link>
            <button
              type="button"
              onClick={() => void loadStock()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong hover:opacity-90"
            >
              <RefreshCw className="size-4" aria-hidden="true" />{" "}
              {t("resource.actions.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const forecast = stock.forecast;
  const minimum = stock.config.minimumStock;

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.035em] text-foreground sm:text-3xl">
              {stock.resource.name}
            </h1>
            <span className="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand">
              {t(`resource.tracking.${stock.config.trackingMode}`)}
            </span>
          </div>
        </div>
        {canEdit ? (
          <Link
            href={`/inventory/${resourceId}/edit#stock-settings`}
            className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:bg-surface-hover"
            aria-label={t("resource.settings.title")}
            title={t("resource.settings.title")}
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </header>

      {error ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => setError(null)} aria-label={t("resource.actions.dismissError")}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          <span className="flex items-center gap-2">
            <Check className="size-4 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("resource.actions.dismissMessage")}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div>
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
            <SectionHeading
              icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
              title={t("resource.booking.title")}
              description={t("resource.booking.description")}
              trailing={
                <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted sm:block">
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

              <div className="mb-5 grid grid-cols-2 rounded-xl bg-surface-muted p-1">
                <button
                  type="button"
                  onClick={() => selectDirection("in")}
                  className={`flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
                    direction === "in"
                      ? "bg-surface text-success shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <Plus className="size-4" aria-hidden="true" />{" "}
                  {t("resource.booking.stockIn")}
                </button>
                <button
                  type="button"
                  onClick={() => selectDirection("out")}
                  className={`flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
                    direction === "out"
                      ? "bg-surface text-danger shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  <Minus className="size-4" aria-hidden="true" />{" "}
                  {t("resource.booking.stockOut")}
                </button>
              </div>

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
                      max={direction === "out" ? Math.max(0, currentQuantity) : 1_000_000}
                      step="1"
                      required
                      value={movementForm.quantity}
                      onChange={(event) => updateMovement("quantity", event.target.value)}
                      className={`${inputClass} pr-20`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted">
                      {unitName}
                    </span>
                  </div>
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
                    <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted">
                      {stock.resource.currency}
                    </span>
                  </div>
                  <span className="mt-1 block text-[9px] font-normal leading-4 text-muted">
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
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-info-border bg-info-soft px-3.5 py-3 text-[11px] leading-4 text-info">
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
                <p className="text-[11px] text-muted">
                  {t("resource.booking.projectedBalance", {
                    quantity: numberFormat.format(
                      Math.max(
                        0,
                        currentQuantity +
                          (direction === "in" ? 1 : -1) *
                            Number(movementForm.quantity || 0),
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
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-on-strong shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    direction === "in"
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

          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
            <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(120px,0.6fr))] sm:items-center sm:p-6">
              <div className="flex items-center gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
                  <Boxes className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium text-muted">
                    {t("resource.metrics.available")}
                  </p>
                  <p className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-foreground">
                    {quantityLabel(currentQuantity, unitName, numberFormat, t)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.metrics.minimum")}
                </p>
                <p
                  className={`mt-1 text-lg font-semibold ${
                    forecast.isBelowMinimum ? "text-danger" : "text-foreground"
                  }`}
                >
                  {quantityLabel(minimum, unitName, numberFormat, t)}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.metrics.incoming")}
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {quantityLabel(onOrder, unitName, numberFormat, t)}
                </p>
              </div>
            </div>
            {forecast.isBelowMinimum ? (
              <div className="flex items-center gap-2 border-t border-warning-border bg-warning-soft px-5 py-3 text-xs font-medium text-warning sm:px-6">
                <AlertTriangle
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                {t("resource.forecast.belowThreshold")}
              </div>
            ) : null}
          </section>

          <section>
            <AssemblyManager
              resourceId={resourceId}
              mode="build"
              hideWhenEmpty
              onStockChanged={() => void loadStock(true)}
            />
          </section>

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
                    className="h-8 appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-[11px] font-medium text-muted outline-none hover:bg-surface-hover focus:border-focus"
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
                <div className="hidden grid-cols-[90px_minmax(160px,1.25fr)_minmax(130px,1fr)_100px_120px_72px] gap-4 border-b border-border bg-surface-subtle px-6 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted md:grid">
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
                            className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-bold tabular-nums ${
                              audit
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
                          <span className="text-[10px] text-muted md:hidden">
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
                          <p className="mt-0.5 truncate text-[10px] text-muted">
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
                          {movement.totalPriceCents !== null &&
                          movement.totalPriceCents !== undefined &&
                          movement.priceCurrency ? (
                            <p className="mt-1 text-[10px] font-semibold text-brand">
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
                            <p className="mt-0.5 text-[9px] text-muted">
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
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
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
                        <p className="text-[11px] text-muted md:font-semibold md:tabular-nums">
                          <span className="md:hidden">
                            {t("resource.movements.balance")}{" "}
                          </span>
                          {numberFormat.format(movement.balanceAfter)}
                        </p>
                        <div className="hidden md:block">
                          <p className="text-[10px] text-muted">
                            {formatDate(movement.occurredAt, locale)}
                          </p>
                          <p className="mt-0.5 truncate text-[9px] text-muted">
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
                        {editing ? (
                          <form
                            onSubmit={(event) =>
                              void saveMovementEdit(event, movement)
                            }
                            className="border-t border-border bg-surface-subtle px-5 py-5 sm:px-6"
                          >
                            <div className="mb-4 grid grid-cols-2 rounded-xl bg-surface-muted p-1 sm:max-w-xs">
                              <button
                                type="button"
                                onClick={() => selectMovementEditDirection("in")}
                                className={`flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
                                  movementEditDirection === "in"
                                    ? "bg-surface text-success shadow-sm"
                                    : "text-muted hover:text-foreground"
                                }`}
                              >
                                <Plus className="size-3.5" aria-hidden="true" />
                                {t("resource.booking.stockIn")}
                              </button>
                              <button
                                type="button"
                                onClick={() => selectMovementEditDirection("out")}
                                className={`flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
                                  movementEditDirection === "out"
                                    ? "bg-surface text-danger shadow-sm"
                                    : "text-muted hover:text-foreground"
                                }`}
                              >
                                <Minus className="size-3.5" aria-hidden="true" />
                                {t("resource.booking.stockOut")}
                              </button>
                            </div>
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
                                  <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted">
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
        </div>

      </div>

      <section
        id="serialized-units"
        className={`${stock.config.trackingMode === "serialized" ? "" : "hidden "}mt-5 scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]`}
      >
        <SectionHeading
          icon={<Barcode className="size-4" aria-hidden="true" />}
          title={t("resource.units.title")}
          description={t("resource.units.description", {
            count: stock.units.length,
            value: numberFormat.format(stock.units.length),
          })}
          trailing={
            <span className="hidden rounded-full bg-success-soft px-2.5 py-1 text-[10px] font-semibold text-success sm:inline-flex">
              {t("resource.units.availableCount", {
                count: stock.units.filter((unit) => unit.status === "available")
                  .length,
                value: numberFormat.format(
                  stock.units.filter((unit) => unit.status === "available")
                    .length,
                ),
              })}
            </span>
          }
        />

        {stock.config.trackingMode === "serialized" ? (
          <div className="grid items-start xl:grid-cols-[360px_minmax(0,1fr)]">
            <form
              onSubmit={createUnits}
              className="border-b border-border bg-surface-subtle p-5 sm:p-6 xl:border-b-0 xl:border-r"
            >
              <div className="mb-5 flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-xl bg-brand-soft text-brand">
                  <PackageCheck className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-xs font-semibold text-foreground">
                    {t("resource.units.registerTitle")}
                  </h3>
                  <p className="text-[10px] text-muted">
                    {t("resource.units.registerDescription")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 rounded-xl bg-surface-muted p-1">
                <button
                  type="button"
                  onClick={() =>
                    setUnitCreateForm((current) => ({ ...current, idMode: "generated" }))
                  }
                  className={`h-9 rounded-lg text-[11px] font-semibold transition ${
                    unitCreateForm.idMode === "generated"
                      ? "bg-surface text-brand shadow-sm"
                      : "text-muted"
                  }`}
                >
                  {t("resource.units.generateIds")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setUnitCreateForm((current) => ({ ...current, idMode: "custom" }))
                  }
                  className={`h-9 rounded-lg text-[11px] font-semibold transition ${
                    unitCreateForm.idMode === "custom"
                      ? "bg-surface text-brand shadow-sm"
                      : "text-muted"
                  }`}
                >
                  {t("resource.units.customIds")}
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {unitCreateForm.idMode === "generated" ? (
                  <label className={labelClass}>
                    {t("resource.units.numberOfUnits")}
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      required
                      value={unitCreateForm.count}
                      onChange={(event) =>
                        setUnitCreateForm((current) => ({
                          ...current,
                          count: event.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                  </label>
                ) : (
                  <label className={labelClass}>
                    {t("resource.units.unitIds")} {" "}
                    <span className="font-normal text-muted">
                      · {t("resource.units.onePerLine")}
                    </span>
                    <textarea
                      rows={5}
                      required
                      value={unitCreateForm.codes}
                      onChange={(event) =>
                        setUnitCreateForm((current) => ({
                          ...current,
                          codes: event.target.value,
                        }))
                      }
                      placeholder={"TOOL-0042-A\nTOOL-0042-B"}
                      className={`${inputClass} h-auto resize-y py-3 font-mono text-xs leading-5`}
                    />
                  </label>
                )}
                <label className={labelClass}>
                  {t("resource.units.inventoryLocation")} {" "}
                  <span className="font-normal text-muted">
                    · {t("resource.optional")}
                  </span>
                  <select
                    value={unitCreateForm.locationResourceId}
                    onChange={(event) =>
                      setUnitCreateForm((current) => ({
                        ...current,
                        locationResourceId: event.target.value,
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="">{t("resource.units.notAssigned")}</option>
                    {availableLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name} ·{" "}
                        {t(`resource.locationTypes.${location.type}`, {
                          defaultValue: location.type,
                        })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  {t("resource.units.locationNote")} {" "}
                  <span className="font-normal text-muted">
                    · {t("resource.optional")}
                  </span>
                  <input
                    value={unitCreateForm.location}
                    maxLength={240}
                    onChange={(event) =>
                      setUnitCreateForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                    placeholder={t("resource.units.locationNotePlaceholder")}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("resource.units.acquiredOn")}
                  <input
                    type="datetime-local"
                    value={unitCreateForm.acquiredAt}
                    onChange={(event) =>
                      setUnitCreateForm((current) => ({
                        ...current,
                        acquiredAt: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  {t("resource.units.acquisitionPrice")} {" "}
                  <span className="font-normal text-muted">
                    · {t("resource.optional")}
                  </span>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="20000000"
                      step="0.01"
                      inputMode="decimal"
                      value={unitCreateForm.totalPrice}
                      onChange={(event) =>
                        setUnitCreateForm((current) => ({
                          ...current,
                          totalPrice: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                      className={`${inputClass} pr-14 tabular-nums`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted">
                      {stock.resource.currency}
                    </span>
                  </div>
                  <span className="mt-1 block text-[9px] font-normal leading-4 text-muted">
                    {t("resource.units.acquisitionPriceHelp")}
                  </span>
                </label>
                {applicableCustomFields.length ? (
                  <div className="rounded-xl border border-brand-border bg-surface p-3.5">
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-foreground">
                        {t("resource.units.customFields")}
                      </p>
                      <p className="mt-0.5 text-[10px] leading-4 text-muted">
                        {t("resource.units.customFieldsBatchHelp")}
                      </p>
                    </div>
                    <CustomFieldInputs
                      definitions={applicableCustomFields}
                      values={unitCreateForm.customFields}
                      onChange={(customFields) =>
                        setUnitCreateForm((current) => ({
                          ...current,
                          customFields,
                        }))
                      }
                      disabled={creatingUnits}
                      className="sm:grid-cols-1"
                    />
                  </div>
                ) : customFieldError ? (
                  <p className="rounded-xl border border-warning-border bg-warning-soft px-3 py-2 text-[10px] leading-4 text-warning">
                    {t("resource.units.customFieldsUnavailable")}
                  </p>
                ) : null}
                <label className={labelClass}>
                  {t("resource.units.advancedMetadata")} {" "}
                  <span className="font-normal text-muted">· JSON</span>
                  <textarea
                    rows={4}
                    value={unitCreateForm.metadata}
                    onChange={(event) =>
                      setUnitCreateForm((current) => ({
                        ...current,
                        metadata: event.target.value,
                      }))
                    }
                    spellCheck={false}
                    className={`${inputClass} h-auto resize-y py-3 font-mono text-[11px] leading-5`}
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={creatingUnits || Boolean(customFieldError)}
                className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-solid px-4 text-xs font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover disabled:opacity-50"
              >
                {creatingUnits ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                {unitCreateForm.idMode === "generated"
                  ? t("resource.actions.registerUnits")
                  : t("resource.actions.registerCustomIds")}
              </button>
            </form>

            <div className="min-w-0">
              {stock.units.length ? (
                <div className="divide-y divide-border">
                  {stock.units.map((unit) => {
                    const editing = editingUnitId === unit.id && unitEditForm;
                    return (
                      <div key={unit.id} className="p-4 sm:p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-subtle text-muted">
                              <Barcode className="size-[18px]" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-mono text-xs font-semibold text-foreground">
                                  {unit.code}
                                </p>
                                <span
                                  className={`inline-flex h-5 items-center rounded-full px-2 text-[9px] font-bold uppercase tracking-wide ${unitStatusClass(unit.status)}`}
                                >
                                  {t(statusLabelKeys[unit.status], {
                                    defaultValue: unit.status,
                                  })}
                                </span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                                <span className="flex items-center gap-1">
                                  <MapPin className="size-3" aria-hidden="true" />
                                  {unit.location || t("resource.units.noLocation")}
                                </span>
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="size-3" aria-hidden="true" />
                                  {t("resource.units.acquired", {
                                    date: formatDate(unit.acquiredAt, locale),
                                  })}
                                </span>
                                <span>
                                  {t("resource.units.moved", {
                                    date: formatDate(unit.lastMovedAt, locale, true),
                                  })}
                                </span>
                                {unit.acquisitionCostCents !== null &&
                                unit.acquisitionCostCents !== undefined &&
                                unit.costCurrency ? (
                                  <span className="font-semibold text-brand">
                                    {formatMoney(
                                      unit.acquisitionCostCents,
                                      unit.costCurrency,
                                      locale,
                                    )}
                                  </span>
                                ) : null}
                              </div>
                              {unit.installation ? (
                                <Link
                                  href={`/inventory/${unit.installation.assemblyResourceId}/stock`}
                                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-info-soft px-2.5 py-1.5 text-[10px] font-semibold text-info transition hover:bg-info-soft/80"
                                >
                                  <Layers3 className="size-3" aria-hidden="true" />
                                  {t("resource.units.installedIn", {
                                    assembly: unit.installation.assemblyName,
                                  })}
                                  {unit.installation.outputUnitCode
                                    ? ` · ${unit.installation.outputUnitCode}`
                                    : ""}
                                </Link>
                              ) : null}
                              <CustomFieldValueSummary
                                definitions={applicableCustomFields}
                                values={unit.customFields}
                                limit={4}
                                className="mt-2"
                              />
                              {Object.keys(unit.metadata ?? {}).length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {Object.entries(unit.metadata)
                                    .slice(0, 4)
                                    .map(([key, value]) => (
                                      <span
                                        key={key}
                                        className="rounded-md bg-surface-muted px-2 py-1 text-[9px] text-muted"
                                      >
                                        {key}: {String(value)}
                                      </span>
                                    ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 pl-[52px] sm:pl-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (editing) {
                                  setEditingUnitId(null);
                                  setUnitEditForm(null);
                                  return;
                                }
                                setEditingUnitId(unit.id);
                                setUnitEditForm({
                                  status: unit.status,
                                  location: unit.location ?? "",
                                  locationResourceId: unit.locationResourceId ?? "",
                                  customFields: unit.customFields ?? {},
                                  metadata: JSON.stringify(unit.metadata ?? {}, null, 2),
                                  occurredAt: localDateTime(),
                                  reason: "",
                                  note: "",
                                  totalPrice: "",
                                });
                              }}
                              className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-hover hover:text-muted-strong"
                              aria-label={t("resource.actions.update")}
                              title={t("resource.actions.update")}
                            >
                              {editing ? (
                                <X className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Settings2 className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard.writeText(unit.code)}
                              className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-hover hover:text-muted-strong"
                              aria-label={t("resource.actions.copyUnitIdWithCode", {
                                code: unit.code,
                              })}
                              title={t("resource.actions.copyUnitId")}
                            >
                              <Copy className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        {editing && unitEditForm ? (
                          <form
                            onSubmit={saveUnit}
                            className="mt-4 rounded-xl border border-brand-border bg-brand-soft p-4"
                          >
                            <div className="mb-3 flex items-start gap-2 rounded-lg bg-surface/80 px-3 py-2 text-[10px] leading-4 text-muted">
                              <Info className="mt-0.5 size-3 shrink-0 text-brand" aria-hidden="true" />
                              {t("resource.units.editHelp")}
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <label className={labelClass}>
                                {t("resource.units.statusLabel")}
                                <select
                                  value={unitEditForm.status}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current
                                        ? { ...current, status: event.target.value as UnitStatus }
                                        : current,
                                    )
                                  }
                                  className={inputClass}
                                >
                                  {unitStatuses.map((status) => (
                                    <option key={status} value={status}>
                                      {t(statusLabelKeys[status])}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className={labelClass}>
                                {t("resource.units.inventoryLocation")}
                                <select
                                  value={unitEditForm.locationResourceId}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current
                                        ? {
                                            ...current,
                                            locationResourceId: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                  className={inputClass}
                                >
                                  <option value="">{t("resource.units.notAssigned")}</option>
                                  {availableLocations.map((location) => (
                                    <option key={location.id} value={location.id}>
                                      {location.name} ·{" "}
                                      {t(`resource.locationTypes.${location.type}`, {
                                        defaultValue: location.type,
                                      })}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className={labelClass}>
                                {t("resource.units.locationNote")}
                                <input
                                  value={unitEditForm.location}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current ? { ...current, location: event.target.value } : current,
                                    )
                                  }
                                  className={inputClass}
                                />
                              </label>
                              <label className={labelClass}>
                                {t("resource.units.effectiveDate")}
                                <input
                                  type="datetime-local"
                                  required
                                  value={unitEditForm.occurredAt}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current ? { ...current, occurredAt: event.target.value } : current,
                                    )
                                  }
                                  className={inputClass}
                                />
                              </label>
                              <label className={labelClass}>
                                {t("resource.units.transactionPrice")} {" "}
                                <span className="font-normal text-muted">
                                  · {t("resource.optional")}
                                </span>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min={
                                      unit.status === "available" &&
                                      unitEditForm.status !== "available"
                                        ? "-20000000"
                                        : "0"
                                    }
                                    max="20000000"
                                    step="0.01"
                                    inputMode="decimal"
                                    value={unitEditForm.totalPrice}
                                    onChange={(event) =>
                                      setUnitEditForm((current) =>
                                        current
                                          ? { ...current, totalPrice: event.target.value }
                                          : current,
                                      )
                                    }
                                    placeholder="0.00"
                                    className={`${inputClass} pr-14 tabular-nums`}
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-muted">
                                    {stock.resource.currency}
                                  </span>
                                </div>
                                <span className="mt-1 block text-[9px] font-normal leading-4 text-muted">
                                  {t("resource.units.transactionPriceHelp")}
                                </span>
                              </label>
                              <label className={`${labelClass} sm:col-span-2`}>
                                {t("resource.units.reason")} {" "}
                                <span className="font-normal text-muted">
                                  · {t("resource.optional")}
                                </span>
                                <input
                                  value={unitEditForm.reason}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current ? { ...current, reason: event.target.value } : current,
                                    )
                                  }
                                  placeholder={t("resource.units.reasonPlaceholder")}
                                  className={inputClass}
                                />
                              </label>
                              <label className={labelClass}>
                                {t("resource.units.internalNote")}
                                <input
                                  value={unitEditForm.note}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current ? { ...current, note: event.target.value } : current,
                                    )
                                  }
                                  className={inputClass}
                                />
                              </label>
                              {applicableCustomFields.length ? (
                                <div className="rounded-xl border border-brand-border bg-surface p-3.5 sm:col-span-2 lg:col-span-3">
                                  <div className="mb-3">
                                    <p className="text-xs font-semibold text-foreground">
                                      {t("resource.units.customFields")}
                                    </p>
                                    <p className="mt-0.5 text-[10px] leading-4 text-muted">
                                      {t("resource.units.customFieldsEditHelp")}
                                    </p>
                                  </div>
                                  <CustomFieldInputs
                                    definitions={applicableCustomFields}
                                    values={unitEditForm.customFields}
                                    onChange={(customFields) =>
                                      setUnitEditForm((current) =>
                                        current ? { ...current, customFields } : current,
                                      )
                                    }
                                    disabled={savingUnit}
                                  />
                                </div>
                              ) : null}
                              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                                {t("resource.units.advancedMetadata")} {" "}
                                <span className="font-normal text-muted">· JSON</span>
                                <textarea
                                  rows={4}
                                  value={unitEditForm.metadata}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current ? { ...current, metadata: event.target.value } : current,
                                    )
                                  }
                                  spellCheck={false}
                                  className={`${inputClass} h-auto resize-y py-3 font-mono text-[11px] leading-5`}
                                />
                              </label>
                            </div>
                            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-brand-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-[9px] text-muted">
                                {t("resource.units.registeredUpdated", {
                                  registered: formatDate(unit.createdAt, locale, true),
                                  updated: formatDate(unit.updatedAt, locale, true),
                                })}
                              </p>
                              <button
                                type="submit"
                                disabled={savingUnit}
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-solid px-3.5 text-[11px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-50"
                              >
                                {savingUnit ? (
                                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Save className="size-3.5" aria-hidden="true" />
                                )}
                                {t("resource.actions.saveUnit")}
                              </button>
                            </div>
                          </form>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-6 py-16 text-center">
                  <Barcode className="mx-auto size-7 text-muted" aria-hidden="true" />
                  <h3 className="mt-4 text-sm font-semibold text-muted-strong">
                    {t("resource.units.emptyTitle")}
                  </h3>
                  <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">
                    {t("resource.units.emptyDescription")}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-5">
        <StockLocationsManager
          resourceId={resourceId}
          canEdit={canEdit}
          unitName={unitName}
          onStockChanged={() => void loadStock(true)}
        />
      </section>

      {pendingMovement ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-overlay p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outgoing-confirmation-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl sm:p-6"
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-danger-soft text-danger">
              <PackageMinus className="size-5" aria-hidden="true" />
            </span>
            <h2
              id="outgoing-confirmation-title"
              className="mt-4 text-lg font-semibold tracking-[-0.02em] text-foreground"
            >
              {t("resource.confirm.outgoingTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {t("resource.confirm.outgoingDescription", {
                quantity: quantityLabel(
                  Math.abs(pendingMovement.delta),
                  unitName,
                  numberFormat,
                  t,
                ),
              })}
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface-subtle p-3 text-center">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.confirm.before")}
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">{currentQuantity}</p>
              </div>
              <div className="border-x border-border">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.confirm.change")}
                </p>
                <p className="mt-1 text-base font-semibold text-danger">
                  {pendingMovement.delta}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">
                  {t("resource.confirm.after")}
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">
                  {currentQuantity + pendingMovement.delta}
                </p>
              </div>
            </div>
            {currentQuantity + pendingMovement.delta <= minimum ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-soft px-3.5 py-3 text-[11px] leading-4 text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {t("resource.confirm.minimumWarning", { minimum })}
              </div>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingMovement(null)}
                disabled={postingMovement}
                className="h-10 rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-muted-strong hover:bg-surface-hover disabled:opacity-50"
              >
                {t("resource.actions.goBack")}
              </button>
              <button
                type="button"
                onClick={() => void postMovement(pendingMovement)}
                disabled={postingMovement}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-danger px-4 text-xs font-semibold text-on-strong shadow-sm hover:brightness-90 disabled:opacity-50"
              >
                {postingMovement ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <PackageMinus className="size-4" aria-hidden="true" />
                )}
                {t("resource.actions.confirmStockOut")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
