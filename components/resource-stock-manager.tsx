"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Barcode,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
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
  QrCode,
  RefreshCw,
  Save,
  Settings2,
  ShieldAlert,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  TrendingDown,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { AssemblyManager } from "@/components/assembly-manager";
import {
  PhotoCountCapture,
  type PhotoCountResult,
} from "@/components/photo-count-capture";
import { PurchaseOrdersManager } from "@/components/purchase-orders-manager";
import { fetchJson } from "@/lib/client-types";

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
  assemblyBuildId?: string | null;
  purchaseReceiptId?: string | null;
};

type StockUnit = {
  id: string;
  code: string;
  status: UnitStatus;
  location: string | null;
  metadata: Record<string, unknown>;
  acquiredAt: string | null;
  lastMovedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  resource: { id: string; name: string; quantity: number };
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

type ConfigForm = {
  trackingMode: TrackingMode;
  minimumStock: string;
  reorderQuantity: string;
  leadTimeDays: string;
  unitName: string;
};

type MovementForm = {
  quantity: string;
  type: MovementType;
  reason: string;
  note: string;
  location: string;
  occurredAt: string;
};

type UnitCreateForm = {
  idMode: "generated" | "custom";
  count: string;
  codes: string;
  location: string;
  metadata: string;
  acquiredAt: string;
};

type UnitEditForm = {
  status: UnitStatus;
  location: string;
  metadata: string;
  occurredAt: string;
  reason: string;
  note: string;
};

type MovementPayload = {
  delta: number;
  type: MovementType;
  reason?: string;
  note?: string;
  location?: string;
  occurredAt?: string;
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const labelClass = "block text-xs font-semibold text-slate-700";

const movementLabels: Record<MovementType, string> = {
  receipt: "Receipt",
  issue: "Issue",
  adjustment: "Adjustment",
  return: "Return",
  waste: "Waste / loss",
  transfer: "Transfer",
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

const statusLabels: Record<UnitStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  "in-use": "In use",
  maintenance: "Maintenance",
  consumed: "Consumed",
  lost: "Lost",
  retired: "Retired",
};

const unitStatuses = Object.keys(statusLabels) as UnitStatus[];

const defaultConfigForm: ConfigForm = {
  trackingMode: "bulk",
  minimumStock: "0",
  reorderQuantity: "0",
  leadTimeDays: "0",
  unitName: "unit",
};

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
});

const defaultUnitCreateForm = (): UnitCreateForm => ({
  idMode: "generated",
  count: "1",
  codes: "",
  location: "",
  metadata: "{}",
  acquiredAt: localDateTime(),
});

function toConfigForm(config: StockConfig): ConfigForm {
  return {
    trackingMode: config.trackingMode,
    minimumStock: String(config.minimumStock),
    reorderQuantity: String(config.reorderQuantity),
    leadTimeDays: String(config.leadTimeDays),
    unitName: config.unitName,
  };
}

function parseMetadata(value: string) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object, for example {\"color\": \"blue\"}.");
  }
  return parsed as Record<string, unknown>;
}

function toIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function pluralize(value: number, unitName: string) {
  const name = unitName.trim() || "unit";
  return `${value.toLocaleString()} ${name}${value === 1 ? "" : "s"}`;
}

function unitStatusClass(status: UnitStatus) {
  if (status === "available") return "bg-emerald-50 text-emerald-700";
  if (status === "reserved" || status === "in-use")
    return "bg-blue-50 text-blue-700";
  if (status === "maintenance") return "bg-amber-50 text-amber-700";
  if (status === "lost") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

function normalizeStock(payload: StockApiResponse): StockData {
  const source = payload.stock ?? payload.data ?? payload;
  if (!source.resource) throw new Error("The stock response is missing its resource.");
  return {
    resource: source.resource,
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
    units: source.units ?? [],
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
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <p className="mt-0.5 text-xs leading-4 text-slate-400">{description}</p>
        </div>
      </div>
      {trailing}
    </div>
  );
}

export function ResourceStockManager({ resourceId }: { resourceId: string }) {
  const endpoint = `/api/v1/resources/${resourceId}/stock`;
  const [stock, setStock] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [configForm, setConfigForm] = useState<ConfigForm>(defaultConfigForm);
  const [savingConfig, setSavingConfig] = useState(false);

  const [direction, setDirection] = useState<"in" | "out">("in");
  const [movementForm, setMovementForm] = useState<MovementForm>(
    defaultMovementForm("in"),
  );
  const [pendingMovement, setPendingMovement] = useState<MovementPayload | null>(null);
  const [postingMovement, setPostingMovement] = useState(false);
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
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const payload = await fetchJson<StockApiResponse>(endpoint, {
          cache: "no-store",
        });
        const normalized = normalizeStock(payload);
        setStock(normalized);
        setConfigForm(toConfigForm(normalized.config));
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load stock data.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  const currentQuantity = stock?.resource.quantity ?? 0;
  const unitName = stock?.config.unitName || "unit";
  const onOrder = stock?.procurement.onOrder ?? 0;
  const movementTypes = direction === "in" ? incomingTypes : outgoingTypes;

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
      reason: current.reason || "Photo-assisted count",
    }));
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!stock) return;
    setError(null);
    setNotice(null);

    const minimumStock = Number(configForm.minimumStock);
    const reorderQuantity = Number(configForm.reorderQuantity);
    const leadTimeDays = Number(configForm.leadTimeDays);
    if (!Number.isInteger(minimumStock) || minimumStock < 0) {
      setError("Minimum stock must be a whole number of zero or more.");
      return;
    }
    if (!Number.isInteger(reorderQuantity) || reorderQuantity < 0) {
      setError("Reorder quantity must be a whole number of zero or more.");
      return;
    }
    if (!Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 3650) {
      setError("Lead time must be between 0 and 3,650 days.");
      return;
    }
    const cleanUnitName = configForm.unitName.trim();
    if (!cleanUnitName || cleanUnitName.length > 60) {
      setError("Unit name must contain between 1 and 60 characters.");
      return;
    }

    if (
      configForm.trackingMode !== stock.config.trackingMode &&
      currentQuantity > 0 &&
      !window.confirm(
        configForm.trackingMode === "serialized"
          ? `Switch to serialized tracking? ${pluralize(currentQuantity, unitName)} will receive generated unit IDs automatically.`
          : "Switch to bulk tracking? Existing unit records remain in the history, but day-to-day booking will use quantities.",
      )
    ) {
      return;
    }

    setSavingConfig(true);
    try {
      await fetchJson(`${endpoint}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingMode: configForm.trackingMode,
          minimumStock,
          reorderQuantity,
          leadTimeDays,
          unitName: cleanUnitName,
        }),
      });
      await loadStock(true);
      setNotice("Stock settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save settings.");
    } finally {
      setSavingConfig(false);
    }
  }

  function buildMovementPayload() {
    const quantity = Number(movementForm.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error("Quantity must be a whole number of at least one.");
    }
    if (direction === "out" && quantity > currentQuantity) {
      throw new Error(
        `Only ${pluralize(currentQuantity, unitName)} are available. Reduce the outgoing quantity.`,
      );
    }
    const occurredAt = toIso(movementForm.occurredAt);
    if (movementForm.occurredAt && !occurredAt) {
      throw new Error("Choose a valid booking date and time.");
    }
    return {
      delta: direction === "in" ? quantity : -quantity,
      type: movementForm.type,
      reason: movementForm.reason.trim() || undefined,
      note: movementForm.note.trim() || undefined,
      location: movementForm.location.trim() || undefined,
      occurredAt,
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
          ? `${pluralize(payload.delta, unitName)} booked in.`
          : `${pluralize(Math.abs(payload.delta), unitName)} booked out.`,
      );
    } catch (movementError) {
      setError(
        movementError instanceof Error
          ? movementError.message
          : "Unable to book the stock movement.",
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
        "Direct quantity bookings are locked in serialized mode. Register a unit or update an existing unit status instead.",
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
        movementError instanceof Error ? movementError.message : "Check the booking details.",
      );
    }
  }

  async function createUnits(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      const metadata = parseMetadata(unitCreateForm.metadata);
      const acquiredAt = toIso(unitCreateForm.acquiredAt);
      if (unitCreateForm.acquiredAt && !acquiredAt) {
        throw new Error("Choose a valid acquisition date.");
      }

      let identifierPayload: { count: number } | { code: string } | { codes: string[] };
      let createdCount: number;
      if (unitCreateForm.idMode === "generated") {
        const count = Number(unitCreateForm.count);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          throw new Error("Generate between 1 and 100 unit IDs at a time.");
        }
        identifierPayload = { count };
        createdCount = count;
      } else {
        const codes = unitCreateForm.codes
          .split(/[\n,]+/)
          .map((code) => code.trim())
          .filter(Boolean);
        if (!codes.length || codes.length > 100) {
          throw new Error("Enter between 1 and 100 custom unit IDs.");
        }
        if (new Set(codes.map((code) => code.toLowerCase())).size !== codes.length) {
          throw new Error("Each custom unit ID must be unique.");
        }
        if (codes.some((code) => code.length > 120)) {
          throw new Error("Custom unit IDs can contain at most 120 characters.");
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
          metadata,
          acquiredAt,
        }),
      });
      setUnitCreateForm(defaultUnitCreateForm());
      await loadStock(true);
      setNotice(`${createdCount} serialized ${createdCount === 1 ? "unit" : "units"} created.`);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Unable to create units.",
      );
    } finally {
      setCreatingUnits(false);
    }
  }

  function beginUnitEdit(unit: StockUnit) {
    setEditingUnitId(unit.id);
    setUnitEditForm({
      status: unit.status,
      location: unit.location ?? "",
      metadata: JSON.stringify(unit.metadata ?? {}, null, 2),
      occurredAt: localDateTime(),
      reason: "",
      note: "",
    });
  }

  async function saveUnit(event: FormEvent) {
    event.preventDefault();
    if (!editingUnitId || !unitEditForm || !stock) return;
    setError(null);
    setNotice(null);
    try {
      const metadata = parseMetadata(unitEditForm.metadata);
      const occurredAt = toIso(unitEditForm.occurredAt);
      if (unitEditForm.occurredAt && !occurredAt) {
        throw new Error("Choose a valid movement date.");
      }
      const unit = stock.units.find((candidate) => candidate.id === editingUnitId);
      const leavingAvailable =
        unit?.status === "available" && unitEditForm.status !== "available";
      if (
        leavingAvailable &&
        !window.confirm(
          `Set ${unit.code} to “${statusLabels[unitEditForm.status]}”? This removes one ${unitName} from available stock.`,
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
          metadata,
          occurredAt,
          reason: unitEditForm.reason.trim() || undefined,
          note: unitEditForm.note.trim() || undefined,
        }),
      });
      setEditingUnitId(null);
      setUnitEditForm(null);
      await loadStock(true);
      setNotice(`Unit ${unit?.code ?? "record"} updated.`);
    } catch (unitError) {
      setError(unitError instanceof Error ? unitError.message : "Unable to update unit.");
    } finally {
      setSavingUnit(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[calc(100dvh-68px)] place-items-center px-6 text-center">
        <div>
          <span className="mx-auto grid size-11 place-items-center rounded-2xl border border-slate-200 bg-white text-violet-600 shadow-sm">
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-slate-600">Loading stock workspace…</p>
        </div>
      </div>
    );
  }

  if (!stock) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16 text-center">
        <div className="rounded-2xl border border-rose-200 bg-white px-6 py-12 shadow-sm">
          <AlertTriangle className="mx-auto size-7 text-rose-500" aria-hidden="true" />
          <h1 className="mt-4 text-lg font-semibold text-slate-950">Stock data is unavailable</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            {error ?? "The stock record could not be loaded."}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link
              href={`/inventory/${resourceId}`}
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to item
            </Link>
            <button
              type="button"
              onClick={() => void loadStock()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <RefreshCw className="size-4" aria-hidden="true" /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const forecast = stock.forecast;
  const minimum = stock.config.minimumStock;
  const stockBarMax = Math.max(currentQuantity, minimum, 1);
  const stockBarWidth = Math.min(100, (currentQuantity / stockBarMax) * 100);
  const minimumMarker = Math.min(100, (minimum / stockBarMax) * 100);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-slate-800">
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Inventory
            </Link>
            <ChevronRight className="size-3" aria-hidden="true" />
            <Link
              href={`/inventory/${resourceId}`}
              className="max-w-44 truncate hover:text-slate-800 sm:max-w-72"
            >
              {stock.resource.name}
            </Link>
            <ChevronRight className="size-3" aria-hidden="true" />
            <span className="text-slate-600">Stock</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Stock management
            </h1>
            <span className="inline-flex h-6 items-center rounded-full bg-violet-50 px-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-violet-700">
              {stock.config.trackingMode}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-slate-500">
            Book movements, keep reorder levels healthy, and trace every serialized unit.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/stock/scan"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700"
          >
            <QrCode className="size-3.5" aria-hidden="true" /> Scan code
          </Link>
          <Link
            href={`/inventory/${resourceId}`}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            Item details <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => void loadStock(true)}
            disabled={refreshing}
            className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            aria-label="Refresh stock data"
            title="Refresh stock data"
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="flex items-center gap-2">
            <Check className="size-4 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Available stock</p>
            <span className="grid size-8 place-items-center rounded-xl bg-violet-50 text-violet-700">
              <Boxes className="size-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">
            {currentQuantity.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {pluralize(currentQuantity, unitName)} ready to use
          </p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Incoming</p>
            <span className="grid size-8 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <ShoppingCart className="size-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">
            {onOrder.toLocaleString()}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {onOrder > 0
              ? `${pluralize(stock.procurement.projectedQuantity, unitName)} after receipt${stock.procurement.nextExpectedAt ? ` · ${formatDate(stock.procurement.nextExpectedAt)}` : ""}`
              : "Nothing currently on order"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Minimum level</p>
            <span
              className={`grid size-8 place-items-center rounded-xl ${forecast.isBelowMinimum ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
            >
              {forecast.isBelowMinimum ? (
                <ShieldAlert className="size-4" aria-hidden="true" />
              ) : (
                <CircleCheck className="size-4" aria-hidden="true" />
              )}
            </span>
          </div>
          <p className="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">
            {minimum.toLocaleString()}
          </p>
          <p className={`mt-1 text-[11px] ${forecast.isBelowMinimum ? "font-medium text-rose-600" : "text-slate-400"}`}>
            {forecast.isBelowMinimum ? "Reorder threshold reached" : "Stock is above the threshold"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Average usage</p>
            <span className="grid size-8 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <TrendingDown className="size-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">
            {forecast.averageDailyUsage.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{unitName}s used per day</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Stock runway</p>
            <span className="grid size-8 place-items-center rounded-xl bg-amber-50 text-amber-700">
              <Clock3 className="size-4" aria-hidden="true" />
            </span>
          </div>
          <p className="mt-4 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">
            {forecast.daysUntilStockout === null
              ? "Stable"
              : `${Math.max(0, Math.round(forecast.daysUntilStockout))}d`}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {forecast.predictedStockoutAt
              ? `Estimated ${formatDate(forecast.predictedStockoutAt)}`
              : "No stockout predicted"}
          </p>
        </div>
      </section>

      <section className="mb-5 grid items-start gap-5 2xl:grid-cols-2">
        <AssemblyManager
          resourceId={resourceId}
          mode="build"
          onStockChanged={() => void loadStock(true)}
        />
        <PurchaseOrdersManager
          resourceId={resourceId}
          compact
          onStockChanged={() => void loadStock(true)}
        />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_390px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.025)]">
            <SectionHeading
              icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
              title="Book a stock movement"
              description="Record incoming or outgoing inventory with a dated audit entry."
              trailing={
                <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:block">
                  Available {currentQuantity}
                </span>
              }
            />
            <form onSubmit={submitMovement} className="p-5 sm:p-6">
              <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => selectDirection("in")}
                  className={`flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
                    direction === "in"
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Plus className="size-4" aria-hidden="true" /> Stock in
                </button>
                <button
                  type="button"
                  onClick={() => selectDirection("out")}
                  className={`flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
                    direction === "out"
                      ? "bg-white text-rose-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Minus className="size-4" aria-hidden="true" /> Stock out
                </button>
              </div>

              <PhotoCountCapture
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
                  Quantity
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
                    <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[11px] text-slate-400">
                      {unitName}s
                    </span>
                  </div>
                </label>
                <label className={labelClass}>
                  Movement type
                  <select
                    value={movementForm.type}
                    onChange={(event) => updateMovement("type", event.target.value as MovementType)}
                    className={inputClass}
                  >
                    {movementTypes.map((type) => (
                      <option key={type} value={type}>
                        {movementLabels[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Booking date
                  <input
                    type="datetime-local"
                    required
                    value={movementForm.occurredAt}
                    onChange={(event) => updateMovement("occurredAt", event.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className={`${labelClass} sm:col-span-2`}>
                  Reason <span className="font-normal text-slate-400">· optional</span>
                  <input
                    value={movementForm.reason}
                    maxLength={240}
                    onChange={(event) => updateMovement("reason", event.target.value)}
                    placeholder={
                      direction === "in"
                        ? "e.g. Purchase order PO-1048"
                        : "e.g. Issued to production team"
                    }
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Location <span className="font-normal text-slate-400">· optional</span>
                  <input
                    value={movementForm.location}
                    maxLength={240}
                    onChange={(event) => updateMovement("location", event.target.value)}
                    placeholder="Workshop · Shelf A3"
                    className={inputClass}
                  />
                </label>
                <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                  Note <span className="font-normal text-slate-400">· optional</span>
                  <textarea
                    rows={3}
                    value={movementForm.note}
                    maxLength={4000}
                    onChange={(event) => updateMovement("note", event.target.value)}
                    placeholder="Add context that will help someone understand this booking later."
                    className={`${inputClass} h-auto resize-y py-3 leading-5`}
                  />
                </label>
              </div>

              {stock.config.trackingMode === "serialized" ? (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-[11px] leading-4 text-blue-700">
                  <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Direct quantity booking is locked in serialized mode. Register a unit or
                    update an existing unit <a href="#serialized-units" className="font-semibold underline underline-offset-2">below</a>;
                    its stock movement is created automatically.
                  </span>
                </div>
              ) : null}

              <div className="mt-5 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-slate-400">
                  Projected balance: {Math.max(
                    0,
                    currentQuantity +
                      (direction === "in" ? 1 : -1) * Number(movementForm.quantity || 0),
                  ).toLocaleString()} {unitName}s
                </p>
                <button
                  type="submit"
                  disabled={
                    postingMovement ||
                    stock.config.trackingMode === "serialized" ||
                    (direction === "out" && currentQuantity < 1)
                  }
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-45 ${
                    direction === "in"
                      ? "bg-emerald-700 hover:bg-emerald-800"
                      : "bg-rose-700 hover:bg-rose-800"
                  }`}
                >
                  {postingMovement ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : direction === "in" ? (
                    <PackagePlus className="size-4" aria-hidden="true" />
                  ) : (
                    <PackageMinus className="size-4" aria-hidden="true" />
                  )}
                  {direction === "in" ? "Book stock in" : "Review stock out"}
                </button>
              </div>
            </form>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.025)]">
            <SectionHeading
              icon={<History className="size-4" aria-hidden="true" />}
              title="Movement history"
              description={`${stock.movements.length} immutable audit ${stock.movements.length === 1 ? "entry" : "entries"}.`}
              trailing={
                <div className="relative">
                  <select
                    value={historyFilter}
                    onChange={(event) =>
                      setHistoryFilter(event.target.value as typeof historyFilter)
                    }
                    aria-label="Filter movement history"
                    className="h-8 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-[11px] font-medium text-slate-600 outline-none hover:bg-slate-50 focus:border-violet-400"
                  >
                    <option value="all">All movements</option>
                    <option value="in">Stock in</option>
                    <option value="out">Stock out</option>
                    <option value="audit">Audit only</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-slate-400" />
                </div>
              }
            />

            {filteredMovements.length ? (
              <div>
                <div className="hidden grid-cols-[90px_minmax(160px,1.25fr)_minmax(130px,1fr)_100px_120px] gap-4 border-b border-slate-100 bg-slate-50/60 px-6 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 md:grid">
                  <span>Change</span>
                  <span>Reason</span>
                  <span>Location / unit</span>
                  <span>Balance</span>
                  <span>Date</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {filteredMovements.map((movement) => {
                    const positive = movement.delta > 0;
                    const audit = movement.delta === 0;
                    return (
                      <div
                        key={movement.id}
                        className="grid gap-3 px-5 py-4 transition hover:bg-slate-50/70 md:grid-cols-[90px_minmax(160px,1.25fr)_minmax(130px,1fr)_100px_120px] md:items-center md:gap-4 md:px-6"
                      >
                        <div className="flex items-center justify-between md:block">
                          <span
                            className={`inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-bold tabular-nums ${
                              audit
                                ? "bg-slate-100 text-slate-600"
                                : positive
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-rose-50 text-rose-700"
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
                            {movement.delta}
                          </span>
                          <span className="text-[10px] text-slate-400 md:hidden">
                            {formatDate(movement.occurredAt, true)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800">
                            {movement.reason ||
                              movementLabels[movement.type as MovementType] ||
                              "Stock update"}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-400">
                            {movementLabels[movement.type as MovementType] ??
                              movement.type.replaceAll("-", " ")}
                            {movement.note ? ` · ${movement.note}` : ""}
                          </p>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500">
                          {movement.location ? (
                            <>
                              <MapPin className="size-3 shrink-0 text-slate-400" aria-hidden="true" />
                              <span className="truncate">{movement.location}</span>
                            </>
                          ) : movement.unitId ? (
                            <>
                              <Barcode className="size-3 shrink-0 text-slate-400" aria-hidden="true" />
                              <span className="truncate font-mono">{movement.unitId.slice(0, 8)}</span>
                            </>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 md:font-semibold md:tabular-nums">
                          <span className="md:hidden">Balance </span>
                          {movement.balanceAfter.toLocaleString()}
                        </p>
                        <div className="hidden md:block">
                          <p className="text-[10px] text-slate-500">
                            {formatDate(movement.occurredAt)}
                          </p>
                          <p className="mt-0.5 truncate text-[9px] text-slate-400">
                            {movement.createdBy || "System"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="px-6 py-14 text-center">
                <History className="mx-auto size-6 text-slate-300" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-slate-700">No matching movements</p>
                <p className="mt-1 text-xs text-slate-400">
                  {stock.movements.length
                    ? "Choose another filter to see the audit trail."
                    : "Your first stock booking will appear here."}
                </p>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-[88px]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.025)]">
            <SectionHeading
              icon={<Settings2 className="size-4" aria-hidden="true" />}
              title="Tracking settings"
              description="How this resource is counted and reordered."
            />
            <form onSubmit={saveConfig} className="space-y-4 p-5">
              <div>
                <span className={labelClass}>Tracking mode</span>
                <div className="mt-1.5 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                  {(["bulk", "serialized"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={
                        mode === "bulk" &&
                        stock.config.trackingMode === "serialized" &&
                        stock.units.length > 0
                      }
                      onClick={() =>
                        setConfigForm((current) => ({ ...current, trackingMode: mode }))
                      }
                      className={`h-9 rounded-lg text-[11px] font-semibold capitalize transition ${
                        configForm.trackingMode === mode
                          ? "bg-white text-violet-700 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      } disabled:cursor-not-allowed disabled:opacity-35`}
                      title={
                        mode === "bulk" &&
                        stock.config.trackingMode === "serialized" &&
                        stock.units.length > 0
                          ? "Serialized units must remain traceable, so this item cannot return to bulk mode."
                          : undefined
                      }
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-400">
                  {configForm.trackingMode === "bulk"
                    ? "Track one shared quantity for interchangeable items."
                    : "Give each physical item its own ID, status, and history."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Minimum stock
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="1"
                    required
                    value={configForm.minimumStock}
                    onChange={(event) =>
                      setConfigForm((current) => ({
                        ...current,
                        minimumStock: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Reorder quantity
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="1"
                    required
                    value={configForm.reorderQuantity}
                    onChange={(event) =>
                      setConfigForm((current) => ({
                        ...current,
                        reorderQuantity: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={labelClass}>
                  Lead time
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="3650"
                      step="1"
                      required
                      value={configForm.leadTimeDays}
                      onChange={(event) =>
                        setConfigForm((current) => ({
                          ...current,
                          leadTimeDays: event.target.value,
                        }))
                      }
                      className={`${inputClass} pr-12`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[10px] text-slate-400">
                      days
                    </span>
                  </div>
                </label>
                <label className={labelClass}>
                  Unit name
                  <input
                    required
                    maxLength={60}
                    value={configForm.unitName}
                    onChange={(event) =>
                      setConfigForm((current) => ({
                        ...current,
                        unitName: event.target.value,
                      }))
                    }
                    placeholder="piece"
                    className={inputClass}
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={savingConfig}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {savingConfig ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                Save stock settings
              </button>
            </form>
          </section>

          <section
            className={`overflow-hidden rounded-2xl border p-5 shadow-[0_1px_2px_rgba(15,23,42,.025)] ${
              forecast.isBelowMinimum
                ? "border-amber-200 bg-amber-50/60"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-900">Stock forecast</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Based on recorded outgoing movement.
                </p>
              </div>
              <span
                className={`grid size-8 place-items-center rounded-xl ${
                  forecast.isBelowMinimum
                    ? "bg-amber-100 text-amber-700"
                    : "bg-violet-50 text-violet-700"
                }`}
              >
                <Sparkles className="size-4" aria-hidden="true" />
              </span>
            </div>
            <div className="relative mt-6 h-2 rounded-full bg-slate-200/80">
              <div
                className={`h-full rounded-full ${forecast.isBelowMinimum ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${stockBarWidth}%` }}
              />
              <span
                className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-slate-700"
                style={{ left: `${minimumMarker}%` }}
                title="Minimum stock"
              />
            </div>
            <div className="mt-2 flex justify-between text-[9px] text-slate-400">
              <span>0</span>
              <span>Minimum {minimum}</span>
              <span>{stockBarMax}</span>
            </div>
            <div className="mt-5 rounded-xl border border-white/80 bg-white/70 p-3.5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] text-slate-500">Suggested order</span>
                <span className="text-sm font-semibold text-slate-950">
                  {pluralize(forecast.suggestedReorderQuantity, unitName)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <span className="text-[11px] text-slate-500">Lead time</span>
                <span className="text-xs font-semibold text-slate-700">
                  {stock.config.leadTimeDays} days
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <span className="text-[11px] text-slate-500">Already ordered</span>
                <span className="text-xs font-semibold text-blue-700">
                  {pluralize(onOrder, unitName)}
                </span>
              </div>
            </div>
            <Link
              href={`/stock/orders?resourceId=${resourceId}`}
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-[11px] font-semibold text-blue-800 transition hover:bg-blue-100"
            >
              <ShoppingCart className="size-3.5" aria-hidden="true" />
              Manage purchase orders
            </Link>
            {forecast.isBelowMinimum ? (
              <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-amber-800">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                Available stock is at or below the reorder threshold.
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      <section
        id="serialized-units"
        className="mt-5 scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.025)]"
      >
        <SectionHeading
          icon={<Barcode className="size-4" aria-hidden="true" />}
          title="Serialized units"
          description={
            stock.config.trackingMode === "serialized"
              ? `${stock.units.length} physical ${stock.units.length === 1 ? "unit" : "units"} with individual status and location.`
              : "Track individual IDs, locations, metadata, and lifecycle status."
          }
          trailing={
            stock.config.trackingMode === "serialized" ? (
              <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 sm:inline-flex">
                {stock.units.filter((unit) => unit.status === "available").length} available
              </span>
            ) : undefined
          }
        />

        {stock.config.trackingMode !== "serialized" ? (
          <div className="px-5 py-12 text-center sm:px-6">
            <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-violet-50 text-violet-700">
              <Layers3 className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-slate-800">
              Serialized tracking is not enabled
            </h3>
            <p className="mx-auto mt-1.5 max-w-lg text-xs leading-5 text-slate-500">
              Choose serialized mode in Tracking settings when each physical item needs
              its own code, status, location, and movement trail.
            </p>
            <button
              type="button"
              onClick={() =>
                setConfigForm((current) => ({ ...current, trackingMode: "serialized" }))
              }
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"
            >
              <Settings2 className="size-3.5" aria-hidden="true" /> Prepare serialized mode
            </button>
          </div>
        ) : (
          <div className="grid items-start xl:grid-cols-[360px_minmax(0,1fr)]">
            <form
              onSubmit={createUnits}
              className="border-b border-slate-200 bg-slate-50/50 p-5 sm:p-6 xl:border-b-0 xl:border-r"
            >
              <div className="mb-5 flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-xl bg-violet-100 text-violet-700">
                  <PackageCheck className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">Register units</h3>
                  <p className="text-[10px] text-slate-400">Generated or your own asset IDs</p>
                </div>
              </div>

              <div className="grid grid-cols-2 rounded-xl bg-slate-200/70 p-1">
                <button
                  type="button"
                  onClick={() =>
                    setUnitCreateForm((current) => ({ ...current, idMode: "generated" }))
                  }
                  className={`h-9 rounded-lg text-[11px] font-semibold transition ${
                    unitCreateForm.idMode === "generated"
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-slate-500"
                  }`}
                >
                  Generate IDs
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setUnitCreateForm((current) => ({ ...current, idMode: "custom" }))
                  }
                  className={`h-9 rounded-lg text-[11px] font-semibold transition ${
                    unitCreateForm.idMode === "custom"
                      ? "bg-white text-violet-700 shadow-sm"
                      : "text-slate-500"
                  }`}
                >
                  Custom IDs
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {unitCreateForm.idMode === "generated" ? (
                  <label className={labelClass}>
                    Number of units
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
                    Unit IDs <span className="font-normal text-slate-400">· one per line</span>
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
                  Initial location <span className="font-normal text-slate-400">· optional</span>
                  <input
                    value={unitCreateForm.location}
                    maxLength={240}
                    onChange={(event) =>
                      setUnitCreateForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                    placeholder="Workshop · Cabinet 2"
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Acquired on
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
                  Shared metadata <span className="font-normal text-slate-400">· JSON</span>
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
                disabled={creatingUnits}
                className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
              >
                {creatingUnits ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Register {unitCreateForm.idMode === "generated" ? "units" : "custom IDs"}
              </button>
            </form>

            <div className="min-w-0">
              {stock.units.length ? (
                <div className="divide-y divide-slate-100">
                  {stock.units.map((unit) => {
                    const editing = editingUnitId === unit.id && unitEditForm;
                    return (
                      <div key={unit.id} className="p-4 sm:p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500">
                              <Barcode className="size-[18px]" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-mono text-xs font-semibold text-slate-900">
                                  {unit.code}
                                </p>
                                <span
                                  className={`inline-flex h-5 items-center rounded-full px-2 text-[9px] font-bold uppercase tracking-wide ${unitStatusClass(unit.status)}`}
                                >
                                  {statusLabels[unit.status] ?? unit.status}
                                </span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
                                <span className="flex items-center gap-1">
                                  <MapPin className="size-3" aria-hidden="true" />
                                  {unit.location || "No location"}
                                </span>
                                <span className="flex items-center gap-1">
                                  <CalendarDays className="size-3" aria-hidden="true" />
                                  Acquired {formatDate(unit.acquiredAt)}
                                </span>
                                <span>Moved {formatDate(unit.lastMovedAt, true)}</span>
                              </div>
                              {unit.installation ? (
                                <Link
                                  href={`/inventory/${unit.installation.assemblyResourceId}/stock`}
                                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[10px] font-semibold text-blue-800 transition hover:bg-blue-100"
                                >
                                  <Layers3 className="size-3" aria-hidden="true" />
                                  Installed in {unit.installation.assemblyName}
                                  {unit.installation.outputUnitCode
                                    ? ` · ${unit.installation.outputUnitCode}`
                                    : ""}
                                </Link>
                              ) : null}
                              {Object.keys(unit.metadata ?? {}).length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {Object.entries(unit.metadata)
                                    .slice(0, 4)
                                    .map(([key, value]) => (
                                      <span
                                        key={key}
                                        className="rounded-md bg-slate-100 px-2 py-1 text-[9px] text-slate-600"
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
                              onClick={() => void navigator.clipboard.writeText(unit.code)}
                              className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
                              aria-label={`Copy unit ID ${unit.code}`}
                              title="Copy unit ID"
                            >
                              <Copy className="size-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(unit.installation)}
                              onClick={() =>
                                editing ? (setEditingUnitId(null), setUnitEditForm(null)) : beginUnitEdit(unit)
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
                              title={
                                unit.installation
                                  ? "Installed units are managed through their assembly history."
                                  : undefined
                              }
                            >
                              {editing ? (
                                <X className="size-3" aria-hidden="true" />
                              ) : (
                                <Pencil className="size-3" aria-hidden="true" />
                              )}
                              {editing ? "Close" : "Update"}
                            </button>
                          </div>
                        </div>

                        {editing && unitEditForm ? (
                          <form
                            onSubmit={saveUnit}
                            className="mt-4 rounded-xl border border-violet-100 bg-violet-50/45 p-4"
                          >
                            <div className="mb-3 flex items-start gap-2 rounded-lg bg-white/80 px-3 py-2 text-[10px] leading-4 text-slate-500">
                              <Info className="mt-0.5 size-3 shrink-0 text-violet-600" aria-hidden="true" />
                              Moving between Available and any other status automatically creates
                              a dated ±1 stock movement. Location or metadata edits create a zero-value audit entry.
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <label className={labelClass}>
                                Status
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
                                      {statusLabels[status]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className={labelClass}>
                                Location
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
                                Effective date
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
                              <label className={`${labelClass} sm:col-span-2`}>
                                Reason <span className="font-normal text-slate-400">· optional</span>
                                <input
                                  value={unitEditForm.reason}
                                  onChange={(event) =>
                                    setUnitEditForm((current) =>
                                      current ? { ...current, reason: event.target.value } : current,
                                    )
                                  }
                                  placeholder="e.g. Assigned to project North"
                                  className={inputClass}
                                />
                              </label>
                              <label className={labelClass}>
                                Internal note
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
                              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>
                                Metadata <span className="font-normal text-slate-400">· JSON</span>
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
                            <div className="mt-4 flex flex-col-reverse gap-2 border-t border-violet-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-[9px] text-slate-400">
                                Registered {formatDate(unit.createdAt, true)} · Updated {formatDate(unit.updatedAt, true)}
                              </p>
                              <button
                                type="submit"
                                disabled={savingUnit}
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-violet-600 px-3.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                              >
                                {savingUnit ? (
                                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Save className="size-3.5" aria-hidden="true" />
                                )}
                                Save unit
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
                  <Barcode className="mx-auto size-7 text-slate-300" aria-hidden="true" />
                  <h3 className="mt-4 text-sm font-semibold text-slate-700">No unit records yet</h3>
                  <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-400">
                    Register generated IDs or enter the asset codes already attached to your
                    physical inventory.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {pendingMovement ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="outgoing-confirmation-title"
            className="w-full max-w-md rounded-2xl border border-white/20 bg-white p-5 shadow-2xl sm:p-6"
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-rose-50 text-rose-700">
              <PackageMinus className="size-5" aria-hidden="true" />
            </span>
            <h2
              id="outgoing-confirmation-title"
              className="mt-4 text-lg font-semibold tracking-[-0.02em] text-slate-950"
            >
              Confirm outgoing stock
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              This booking removes {pluralize(Math.abs(pendingMovement.delta), unitName)} from
              available inventory. Review the balance before confirming.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                  Before
                </p>
                <p className="mt-1 text-base font-semibold text-slate-800">{currentQuantity}</p>
              </div>
              <div className="border-x border-slate-200">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                  Change
                </p>
                <p className="mt-1 text-base font-semibold text-rose-700">
                  {pendingMovement.delta}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                  After
                </p>
                <p className="mt-1 text-base font-semibold text-slate-800">
                  {currentQuantity + pendingMovement.delta}
                </p>
              </div>
            </div>
            {currentQuantity + pendingMovement.delta <= minimum ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] leading-4 text-amber-800">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                This leaves stock at or below the configured minimum of {minimum}.
              </div>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingMovement(null)}
                disabled={postingMovement}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => void postMovement(pendingMovement)}
                disabled={postingMovement}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-700 px-4 text-xs font-semibold text-white shadow-sm hover:bg-rose-800 disabled:opacity-50"
              >
                {postingMovement ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <PackageMinus className="size-4" aria-hidden="true" />
                )}
                Confirm stock out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
