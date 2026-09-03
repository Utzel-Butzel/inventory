"use client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clock3,
  LoaderCircle,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "partially-received"
  | "received"
  | "cancelled";
type TrackingMode = "bulk" | "serialized";
type OrderFilter = "active" | "all" | "received" | "cancelled";

type PurchaseOrderLine = {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  resourceCurrency: string;
  baseUnitName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number;
  orderedPurchaseQuantity: number | null;
  receivedPurchaseQuantity: number | null;
  openPurchaseQuantity: number | null;
  expectedAt: string | null;
  note: string | null;
  trackingMode: TrackingMode;
  unitPriceCents: number | null;
  priceCurrency: string | null;
  totalPriceCents: number | null;
};

type PurchaseOrder = {
  id: string;
  contactId: string | null;
  reference: string | null;
  supplier: string | null;
  status: PurchaseOrderStatus;
  orderedAt: string;
  expectedAt: string | null;
  note: string | null;
  createdBy: string | null;
  lines: PurchaseOrderLine[];
  totalOrdered: number;
  totalReceived: number;
  totalOpen: number;
};

type OrdersEnvelope = {
  orders?: PurchaseOrder[];
  data?: { orders?: PurchaseOrder[] } | PurchaseOrder[];
};

type DraftLine = {
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  orderedQuantity: string;
  expectedAt: string;
  note: string;
  unitPrice: string;
  priceCurrency: string;
  baseUnitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number;
};

type StockPurchaseConfig = {
  resourceId: string;
  unitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
};

type StockOverviewEnvelope = {
  items?: StockPurchaseConfig[];
};

type OrderForm = {
  reference: string;
  contactId: string;
  supplier: string;
  orderedAt: string;
  expectedAt: string;
  note: string;
};

type ReceiptForm = {
  orderId: string;
  lineId: string;
  resourceName: string;
  trackingMode: TrackingMode;
  maxQuantity: number;
  quantity: string;
  baseUnitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number;
  receivedAt: string;
  location: string;
  note: string;
  unitCodes: string;
  totalPrice: string;
  priceCurrency: string;
};

type SupplierContact = {
  id: string;
  name: string;
  company: string | null;
};

const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const labelClass = "block text-[11px] font-semibold text-muted-strong";

const statusLabelKeys: Record<PurchaseOrderStatus, string> = {
  draft: "orders.status.draft",
  ordered: "orders.status.ordered",
  "partially-received": "orders.status.partiallyReceived",
  received: "orders.status.received",
  cancelled: "orders.status.cancelled",
};

const filterLabelKeys: Record<OrderFilter, string> = {
  active: "orders.filters.open",
  all: "orders.filters.all",
  received: "orders.filters.received",
  cancelled: "orders.filters.cancelled",
};

function statusTone(status: PurchaseOrderStatus) {
  if (status === "received") return "success" as const;
  if (status === "ordered" || status === "partially-received") return "brand" as const;
  if (status === "cancelled") return "danger" as const;
  return "neutral" as const;
}

function localDateTime(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateInput(value: Date = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toIsoDate(value: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatDate(value: string | null, locale: string, includeTime = false) {
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

function formatMoney(cents: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function moneyToCents(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount < 0) return Number.NaN;
  return Math.round(amount * 100);
}

function normalizeOrders(payload: OrdersEnvelope | PurchaseOrder[]) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  return payload.orders ?? payload.data?.orders ?? [];
}

function parsedCodes(value: string) {
  return value
    .split(/[\n,]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function newOrderForm(): OrderForm {
  return {
    reference: "",
    contactId: "",
    supplier: "",
    orderedAt: localDateTime(),
    expectedAt: "",
    note: "",
  };
}

function lineFromResource(
  resource: ClientResource,
  config?: StockPurchaseConfig,
): DraftLine {
  const purchaseUnitFactor =
    config?.purchaseUnitName && config.purchaseUnitFactor
      ? config.purchaseUnitFactor
      : 1;
  return {
    resourceId: resource.id,
    resourceName: resource.name,
    resourceSku: resource.sku,
    orderedQuantity: "1",
    expectedAt: "",
    note: "",
    unitPrice:
      resource.valueCents === null
        ? ""
        : ((resource.valueCents * purchaseUnitFactor) / 100).toFixed(2),
    priceCurrency: resource.currency,
    baseUnitName: config?.unitName ?? "unit",
    purchaseUnitName: config?.purchaseUnitName ?? null,
    purchaseUnitFactor,
  };
}

function isActive(status: PurchaseOrderStatus) {
  return status === "draft" || status === "ordered" || status === "partially-received";
}

function effectiveLineOpen(line: PurchaseOrderLine) {
  return Math.max(0, line.openQuantity ?? line.orderedQuantity - line.receivedQuantity);
}

export function PurchaseOrdersManager({
  resourceId,
  compact = false,
  onStockChanged,
}: {
  resourceId?: string;
  compact?: boolean;
  onStockChanged?: () => void;
}) {
  const { t, i18n } = useT("stock");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [filter, setFilter] = useState<OrderFilter>("active");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [orderForm, setOrderForm] = useState<OrderForm>(newOrderForm);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [scopedResource, setScopedResource] = useState<ClientResource | null>(null);
  const [stockConfigs, setStockConfigs] = useState<
    Record<string, StockPurchaseConfig>
  >({});
  const [stockConfigsLoaded, setStockConfigsLoaded] = useState(false);
  const [supplierContacts, setSupplierContacts] = useState<SupplierContact[]>([]);

  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<ClientResource[]>([]);
  const [searchingItems, setSearchingItems] = useState(false);
  const [itemSearchOpen, setItemSearchOpen] = useState(false);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm | null>(null);
  const createRequestRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const receiptRequestRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const loadOrders = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const payload = await fetchJson<OrdersEnvelope | PurchaseOrder[]>(
        "/api/v1/purchase-orders?limit=100",
        { cache: "no-store" },
      );
      setOrders(normalizeOrders(payload));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("orders.errors.loadOrders"),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<StockOverviewEnvelope>("/api/v1/stock", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((payload) => {
        setStockConfigs(
          Object.fromEntries(
            (payload.items ?? []).map((item) => [item.resourceId, item]),
          ),
        );
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setStockConfigs({});
        }
      })
      .finally(() => setStockConfigsLoaded(true));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ contacts: SupplierContact[] }>(
      "/api/v1/contacts?role=supplier",
      { cache: "no-store", signal: controller.signal },
    )
      .then((payload) => setSupplierContacts(payload.contacts ?? []))
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setSupplierContacts([]);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!resourceId) {
      setScopedResource(null);
      return;
    }
    const controller = new AbortController();
    void fetchJson<{ resource: ClientResource }>(`/api/v1/resources/${resourceId}`, {
      signal: controller.signal,
    })
      .then((payload) => setScopedResource(payload.resource))
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("orders.errors.loadItem"),
          );
        }
      });
    return () => controller.abort();
  }, [resourceId, t]);

  useEffect(() => {
    if (!scopedResource || !stockConfigsLoaded || draftLines.length) return;
    setDraftLines([
      lineFromResource(scopedResource, stockConfigs[scopedResource.id]),
    ]);
  }, [draftLines.length, scopedResource, stockConfigs, stockConfigsLoaded]);

  useEffect(() => {
    if (resourceId) return;
    const cleanQuery = itemQuery.trim();
    if (cleanQuery.length < 2) {
      setItemResults([]);
      setSearchingItems(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchingItems(true);
      try {
        const search = new URLSearchParams({ q: cleanQuery, page: "1", pageSize: "8" });
        const payload = await fetchJson<{ resources: ClientResource[] }>(
          `/api/v1/resources?${search}`,
          { signal: controller.signal },
        );
        const selected = new Set(draftLines.map((line) => line.resourceId));
        setItemResults(payload.resources.filter((resource) => !selected.has(resource.id)));
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) {
          setItemResults([]);
        }
      } finally {
        setSearchingItems(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draftLines, itemQuery, resourceId]);

  const scopedOrders = useMemo(
    () =>
      resourceId
        ? orders.filter((order) =>
            order.lines.some((line) => line.resourceId === resourceId),
          )
        : orders,
    [orders, resourceId],
  );

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return scopedOrders.filter((order) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "active"
            ? isActive(order.status)
            : order.status === filter;
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return [
        order.reference,
        order.supplier,
        ...order.lines.map((line) => `${line.resourceName} ${line.resourceSku ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery);
    });
  }, [filter, locale, query, scopedOrders]);

  const metrics = useMemo(() => {
    const activeOrders = scopedOrders.filter((order) => isActive(order.status));
    const openUnits = activeOrders.reduce(
      (total, order) =>
        total +
        order.lines
          .filter((line) => !resourceId || line.resourceId === resourceId)
          .reduce((lineTotal, line) => lineTotal + effectiveLineOpen(line), 0),
      0,
    );
    const overdue = activeOrders.filter((order) => {
      if (!order.expectedAt) return false;
      return new Date(order.expectedAt).getTime() < Date.now() && order.totalOpen > 0;
    }).length;
    return { active: activeOrders.length, openUnits, overdue };
  }, [resourceId, scopedOrders]);

  function resetCreateForm() {
    setOrderForm(newOrderForm());
    setDraftLines(
      scopedResource
        ? [lineFromResource(scopedResource, stockConfigs[scopedResource.id])]
        : [],
    );
    setItemQuery("");
    setItemResults([]);
  }

  function addDraftLine(resource: ClientResource) {
    setDraftLines((current) => [
      ...current,
      lineFromResource(resource, stockConfigs[resource.id]),
    ]);
    setItemQuery("");
    setItemResults([]);
    setItemSearchOpen(false);
  }

  function updateDraftLine(
    resourceIdToUpdate: string,
    values: Partial<
      Pick<
        DraftLine,
        "orderedQuantity" | "expectedAt" | "note" | "unitPrice"
      >
    >,
  ) {
    setDraftLines((current) =>
      current.map((line) =>
        line.resourceId === resourceIdToUpdate ? { ...line, ...values } : line,
      ),
    );
  }

  async function createOrder(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!draftLines.length) {
      setError(t("orders.errors.addLine"));
      return;
    }
    const invalidLine = draftLines.find((line) => {
      const quantity = Number(line.orderedQuantity);
      return !Number.isInteger(quantity) || quantity < 1;
    });
    if (invalidLine) {
      setError(
        t("orders.errors.wholeQuantity", { name: invalidLine.resourceName }),
      );
      return;
    }
    const invalidPriceLine = draftLines.find((line) =>
      Number.isNaN(moneyToCents(line.unitPrice)),
    );
    if (invalidPriceLine) {
      setError(t("orders.errors.validPrice", { name: invalidPriceLine.resourceName }));
      return;
    }
    const orderedAt = toIsoDateTime(orderForm.orderedAt);
    if (!orderedAt) {
      setError(t("orders.errors.validOrderDate"));
      return;
    }

    setCreating(true);
    try {
      const requestBody = {
        reference: orderForm.reference.trim() || null,
        contactId: orderForm.contactId || undefined,
        supplier: orderForm.supplier.trim() || undefined,
        status: "ordered" as const,
        orderedAt,
        expectedAt: toIsoDate(orderForm.expectedAt),
        note: orderForm.note.trim() || undefined,
        lines: draftLines.map((line) => ({
          resourceId: line.resourceId,
          ...(line.purchaseUnitName
            ? { purchaseQuantity: Number(line.orderedQuantity) }
            : { orderedQuantity: Number(line.orderedQuantity) }),
          expectedAt: toIsoDate(line.expectedAt),
          note: line.note.trim() || undefined,
          ...(moneyToCents(line.unitPrice) === null
            ? {}
            : {
                unitPriceCents: moneyToCents(line.unitPrice),
                priceCurrency: line.priceCurrency,
              }),
        })),
      };
      const fingerprint = JSON.stringify(requestBody);
      const request =
        createRequestRef.current?.fingerprint === fingerprint
          ? createRequestRef.current
          : { key: crypto.randomUUID(), fingerprint };
      createRequestRef.current = request;
      await fetchJson("/api/v1/purchase-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": request.key,
        },
        body: fingerprint,
      });
      createRequestRef.current = null;
      await loadOrders(true);
      resetCreateForm();
      setCreateOpen(false);
      setNotice(t("orders.notices.created"));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("orders.errors.create"),
      );
    } finally {
      setCreating(false);
    }
  }

  function beginReceipt(order: PurchaseOrder, line: PurchaseOrderLine) {
    const openQuantity = effectiveLineOpen(line);
    const usesPurchaseUnit =
      Boolean(line.purchaseUnitName) && line.openPurchaseQuantity !== null;
    const displayedOpenQuantity = usesPurchaseUnit
      ? line.openPurchaseQuantity!
      : openQuantity;
    const receiptLimit =
      line.trackingMode === "serialized"
        ? Math.floor(1_000 / (usesPurchaseUnit ? line.purchaseUnitFactor : 1))
        : 1_000;
    const initialQuantity = Math.min(receiptLimit, displayedOpenQuantity);
    setReceiptForm({
      orderId: order.id,
      lineId: line.id,
      resourceName: line.resourceName,
      trackingMode: line.trackingMode,
      maxQuantity: initialQuantity,
      quantity: String(initialQuantity),
      baseUnitName: line.baseUnitName,
      purchaseUnitName: usesPurchaseUnit ? line.purchaseUnitName : null,
      purchaseUnitFactor: usesPurchaseUnit ? line.purchaseUnitFactor : 1,
      receivedAt: localDateTime(),
      location: "",
      note: "",
      unitCodes: "",
      totalPrice:
        line.unitPriceCents === null
          ? ""
          : ((line.unitPriceCents * initialQuantity) / 100).toFixed(2),
      priceCurrency: line.priceCurrency ?? line.resourceCurrency,
    });
  }

  async function receiveLine(event: FormEvent) {
    event.preventDefault();
    if (!receiptForm) return;
    setError(null);
    setNotice(null);
    const quantity = Number(receiptForm.quantity);
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > receiptForm.maxQuantity
    ) {
      setError(
        t("orders.errors.receiptRange", {
          maximum: numberFormat.format(receiptForm.maxQuantity),
        }),
      );
      return;
    }
    const receivedAt = toIsoDateTime(receiptForm.receivedAt);
    if (!receivedAt) {
      setError(t("orders.errors.validReceiptDate"));
      return;
    }
    const unitCodes = parsedCodes(receiptForm.unitCodes);
    const baseQuantity = quantity * receiptForm.purchaseUnitFactor;
    if (
      receiptForm.trackingMode === "serialized" &&
      unitCodes.length !== baseQuantity
    ) {
      setError(
        t("orders.errors.unitCodeCount", {
          count: baseQuantity,
          value: numberFormat.format(baseQuantity),
        }),
      );
      return;
    }
    const totalPriceCents = moneyToCents(receiptForm.totalPrice);
    if (Number.isNaN(totalPriceCents)) {
      setError(t("orders.errors.validReceiptPrice"));
      return;
    }
    if (new Set(unitCodes).size !== unitCodes.length) {
      setError(t("orders.errors.uniqueCodes"));
      return;
    }

    setReceiving(true);
    try {
      const requestBody = {
        ...(receiptForm.purchaseUnitName
          ? { purchaseQuantity: quantity }
          : { quantity }),
        receivedAt,
        location: receiptForm.location.trim() || undefined,
        note: receiptForm.note.trim() || undefined,
        unitCodes:
          receiptForm.trackingMode === "serialized" ? unitCodes : undefined,
        ...(totalPriceCents === null
          ? {}
          : { totalPriceCents, priceCurrency: receiptForm.priceCurrency }),
      };
      const fingerprint = JSON.stringify(requestBody);
      const request =
        receiptRequestRef.current?.fingerprint === fingerprint
          ? receiptRequestRef.current
          : { key: crypto.randomUUID(), fingerprint };
      receiptRequestRef.current = request;
      await fetchJson(
        `/api/v1/purchase-orders/${receiptForm.orderId}/lines/${receiptForm.lineId}/receipts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": request.key,
          },
          body: fingerprint,
        },
      );
      receiptRequestRef.current = null;
      const receivedName = receiptForm.resourceName;
      setReceiptForm(null);
      await loadOrders(true);
      onStockChanged?.();
      setNotice(
        t("orders.notices.received", {
          count: quantity,
          value: numberFormat.format(quantity),
          name: receivedName,
          unit: receiptForm.purchaseUnitName ?? receiptForm.baseUnitName,
        }),
      );
    } catch (receiptError) {
      setError(
        receiptError instanceof Error
          ? receiptError.message
          : t("orders.errors.receive"),
      );
    } finally {
      setReceiving(false);
    }
  }

  function toggleExpanded(orderId: string) {
    setExpandedOrders((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  const filterCounts: Record<OrderFilter, number> = {
    all: scopedOrders.length,
    active: scopedOrders.filter((order) => isActive(order.status)).length,
    received: scopedOrders.filter((order) => order.status === "received").length,
    cancelled: scopedOrders.filter((order) => order.status === "cancelled").length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-brand">
            <Truck className="size-3.5" aria-hidden="true" />{" "}
            {t("orders.eyebrow")}
          </div>
          <h1 className={cn("font-semibold tracking-[-0.04em] text-foreground", compact ? "text-xl" : "text-[28px] sm:text-[32px]")}>{resourceId ? t("orders.titleForItem") : t("orders.title")}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{t("orders.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void loadOrders(true)} disabled={refreshing || loading}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
            <span className="hidden sm:inline">{refreshing ? t("orders.actions.refreshing") : t("orders.actions.refresh")}</span>
          </Button>
          <Button onClick={() => setCreateOpen((current) => !current)}>
            {createOpen ? <X className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            {createOpen ? t("orders.actions.closeForm") : t("orders.actions.newOrder")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={t("orders.actions.dismissError")}><X className="size-4" aria-hidden="true" /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          <span className="flex items-center gap-2"><Check className="size-4 shrink-0" aria-hidden="true" /> {notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("orders.actions.dismissMessage")}><X className="size-4" aria-hidden="true" /></button>
        </div>
      ) : null}

      {!compact ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-5">
            <div className="flex items-center justify-between"><p className="text-[12px] font-semibold text-muted">{t("orders.metrics.openOrders")}</p><span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand"><ShoppingCart className="size-[17px]" aria-hidden="true" /></span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-foreground">{metrics.active}</p>
            <p className="mt-1 text-[11px] text-muted">{t("orders.metrics.openOrdersDetail")}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between"><p className="text-[12px] font-semibold text-muted">{t("orders.metrics.unitsIncoming")}</p><span className="grid size-9 place-items-center rounded-xl bg-success-soft text-success"><PackageCheck className="size-[17px]" aria-hidden="true" /></span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-foreground">{numberFormat.format(metrics.openUnits)}</p>
            <p className="mt-1 text-[11px] text-muted">{t("orders.metrics.unitsIncomingDetail")}</p>
          </Card>
          <Card className={cn("p-5", metrics.overdue > 0 && "border-warning-border bg-warning-soft")}>
            <div className="flex items-center justify-between"><p className="text-[12px] font-semibold text-muted">{t("orders.metrics.overdue")}</p><span className={cn("grid size-9 place-items-center rounded-xl", metrics.overdue ? "bg-warning-soft text-warning" : "bg-surface-muted text-muted")}><Clock3 className="size-[17px]" aria-hidden="true" /></span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-foreground">{metrics.overdue}</p>
            <p className="mt-1 text-[11px] text-muted">{t("orders.metrics.overdueDetail")}</p>
          </Card>
        </div>
      ) : null}

      {createOpen ? (
        <Card className="overflow-visible">
          <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><ShoppingCart className="size-4" aria-hidden="true" /></span>
            <div><h2 className="text-sm font-semibold text-foreground">{t("orders.create.title")}</h2><p className="mt-0.5 text-[12px] text-muted">{t("orders.create.description")}</p></div>
          </div>
          <form onSubmit={createOrder}>
            <div className="grid gap-4 border-b border-border p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
              <label className={labelClass}>{t("orders.create.supplier")}<select value={orderForm.contactId} onChange={(event) => { const contact = supplierContacts.find((candidate) => candidate.id === event.target.value); setOrderForm((current) => ({ ...current, contactId: event.target.value, supplier: contact ? (contact.company ?? contact.name) : "" })); }} className={`${inputClass} mt-1.5`}><option value="">{t("orders.create.supplierManual")}</option>{supplierContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.company ? `${contact.company} · ${contact.name}` : contact.name}</option>)}</select>{!orderForm.contactId ? <input value={orderForm.supplier} onChange={(event) => setOrderForm((current) => ({ ...current, supplier: event.target.value }))} placeholder={t("orders.create.supplierPlaceholder")} maxLength={240} className={`${inputClass} mt-2`} /> : null}</label>
              <label className={labelClass}>{t("orders.create.reference")} <span className="font-normal text-muted">· {t("orders.optional")}</span><input value={orderForm.reference} onChange={(event) => setOrderForm((current) => ({ ...current, reference: event.target.value }))} placeholder="PO-1048" maxLength={160} className={`${inputClass} mt-1.5`} /></label>
              <label className={labelClass}>{t("orders.create.orderedAt")}<input type="datetime-local" required value={orderForm.orderedAt} onChange={(event) => setOrderForm((current) => ({ ...current, orderedAt: event.target.value }))} className={`${inputClass} mt-1.5`} /></label>
              <label className={labelClass}>{t("orders.create.expectedArrival")} <span className="font-normal text-muted">· {t("orders.optional")}</span><input type="date" min={dateInput()} value={orderForm.expectedAt} onChange={(event) => setOrderForm((current) => ({ ...current, expectedAt: event.target.value }))} className={`${inputClass} mt-1.5`} /></label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>{t("orders.create.orderNote")} <span className="font-normal text-muted">· {t("orders.optional")}</span><textarea rows={2} value={orderForm.note} onChange={(event) => setOrderForm((current) => ({ ...current, note: event.target.value }))} maxLength={20000} placeholder={t("orders.create.orderNotePlaceholder")} className={`${inputClass} mt-1.5 h-auto resize-y py-3`} /></label>
            </div>

            {!resourceId ? (
              <div className="relative border-b border-border p-4 sm:p-5">
                <label className="relative block">
                  <span className="sr-only">{t("orders.create.searchItemsLabel")}</span>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                  <input value={itemQuery} onFocus={() => setItemSearchOpen(true)} onChange={(event) => { setItemQuery(event.target.value); setItemSearchOpen(true); }} placeholder={t("orders.create.searchItemsPlaceholder")} className={`${inputClass} pl-10 pr-10`} />
                  {searchingItems ? <LoaderCircle className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-brand" aria-hidden="true" /> : null}
                </label>
                {itemSearchOpen && itemQuery.trim().length >= 2 ? (
                  <div className="absolute inset-x-4 top-[calc(100%-14px)] z-30 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-md)] sm:inset-x-5">
                    {itemResults.length ? <div className="max-h-72 overflow-y-auto p-1.5">{itemResults.map((resource) => <button key={resource.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => addDraftLine(resource)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-hover"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted"><Package className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-foreground">{resource.name}</span><span className="mt-0.5 block truncate text-[10px] text-muted">{resource.sku || t("orders.noSku")} · {t("orders.create.available", { quantity: numberFormat.format(resource.quantity) })}</span></span><Plus className="size-4 text-brand" aria-hidden="true" /></button>)}</div> : <div className="px-4 py-5 text-center text-[12px] text-muted">{searchingItems ? t("orders.create.searching") : t("orders.create.noItemsFound")}</div>}
                  </div>
                ) : null}
              </div>
            ) : null}

            {draftLines.length ? (
              <div className="divide-y divide-border">
                {draftLines.map((line) => (
                  <div key={line.resourceId} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(190px,1fr)_110px_140px_160px_minmax(160px,1fr)_auto] lg:items-start">
                    <div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted"><Package className="size-[18px]" aria-hidden="true" /></span><div className="min-w-0 pt-0.5"><Link href={`/inventory/${line.resourceId}`} className="block truncate text-[13px] font-semibold text-foreground hover:text-brand">{line.resourceName}</Link><p className="mt-1 truncate text-[10px] text-muted">{line.resourceSku || t("orders.noSku")}</p></div></div>
                    <label className={labelClass}>{t("orders.create.orderQuantity")}<div className="relative"><input type="number" min="1" max="2000000000" step="1" required value={line.orderedQuantity} onChange={(event) => updateDraftLine(line.resourceId, { orderedQuantity: event.target.value })} className={`${inputClass} mt-1.5 pr-20 tabular-nums`} /><span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[10px] text-muted">{line.purchaseUnitName ?? line.baseUnitName}</span></div>{line.purchaseUnitName ? <span className="mt-1 block text-[9px] font-normal text-muted">{t("orders.create.purchaseUnitConversion", { factor: numberFormat.format(line.purchaseUnitFactor), unit: line.baseUnitName })}</span> : null}</label>
                    <label className={labelClass}>{t("orders.create.unitPrice")} <span className="font-normal text-muted">· {t("orders.optional")}</span><div className="relative"><input type="number" min="0" max="20000000" step="0.01" inputMode="decimal" value={line.unitPrice} onChange={(event) => updateDraftLine(line.resourceId, { unitPrice: event.target.value })} placeholder="0.00" className={`${inputClass} mt-1.5 pr-12 tabular-nums`} /><span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[10px] text-muted">{line.priceCurrency}</span></div></label>
                    <label className={labelClass}>{t("orders.create.lineEta")} <span className="font-normal text-muted">· {t("orders.optional")}</span><input type="date" value={line.expectedAt} onChange={(event) => updateDraftLine(line.resourceId, { expectedAt: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
                    <label className={labelClass}>{t("orders.create.lineNote")} <span className="font-normal text-muted">· {t("orders.optional")}</span><input value={line.note} onChange={(event) => updateDraftLine(line.resourceId, { note: event.target.value })} maxLength={20000} placeholder={t("orders.create.lineNotePlaceholder")} className={`${inputClass} mt-1.5`} /></label>
                    {!resourceId ? <button type="button" onClick={() => setDraftLines((current) => current.filter((item) => item.resourceId !== line.resourceId))} className="grid size-9 place-items-center rounded-lg border border-danger-border bg-surface text-danger hover:bg-danger-soft lg:mt-[22px]" aria-label={t("orders.create.removeLine", { name: line.resourceName })}><X className="size-3.5" aria-hidden="true" /></button> : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Package className="size-5" aria-hidden="true" />} title={t("orders.create.addLineTitle")} description={t("orders.create.addLineDescription")} className="min-h-48" />
            )}

            <div className="flex flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-[11px] text-muted">{t("orders.create.summary", { itemCount: draftLines.length, count: draftLines.reduce((total, line) => total + (Number(line.orderedQuantity) || 0), 0), items: numberFormat.format(draftLines.length), units: numberFormat.format(draftLines.reduce((total, line) => total + (Number(line.orderedQuantity) || 0), 0)) })}</p>
              <div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => { resetCreateForm(); setCreateOpen(false); }}>{t("orders.actions.cancel")}</Button><Button type="submit" disabled={creating || !draftLines.length}>{creating ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ShoppingCart className="size-4" aria-hidden="true" />}{creating ? t("orders.actions.creating") : t("orders.actions.createOrder")}</Button></div>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
          <label className="relative min-w-0 flex-1 xl:max-w-md"><span className="sr-only">{t("orders.search.label")}</span><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("orders.search.placeholder")} className={`${inputClass} bg-surface-subtle pl-10 pr-10`} />{query ? <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-hover" aria-label={t("orders.search.clear")}><X className="size-3.5" aria-hidden="true" /></button> : null}</label>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1 sm:flex">{(Object.keys(filterLabelKeys) as OrderFilter[]).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition", filter === value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground")}>{t(filterLabelKeys[value])} <span className={filter === value ? "text-brand" : "text-muted"}>{numberFormat.format(filterCounts[value])}</span></button>)}</div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : filteredOrders.length ? (
          <div className="divide-y divide-border">
            {filteredOrders.map((order) => {
              const visibleLines = resourceId ? order.lines.filter((line) => line.resourceId === resourceId) : order.lines;
              const totalOrdered = visibleLines.reduce((total, line) => total + line.orderedQuantity, 0);
              const totalReceived = visibleLines.reduce((total, line) => total + line.receivedQuantity, 0);
              const totalOpen = visibleLines.reduce((total, line) => total + effectiveLineOpen(line), 0);
              const progress = totalOrdered ? Math.min(100, (totalReceived / totalOrdered) * 100) : 0;
              const expanded = expandedOrders.has(order.id) || compact || filteredOrders.length <= 3;
              return (
                <article key={order.id} className={cn("transition", isActive(order.status) && totalOpen > 0 && "bg-surface-subtle")}>
                  <button type="button" onClick={() => toggleExpanded(order.id)} className="flex w-full flex-col gap-4 px-4 py-4 text-left sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", order.status === "received" ? "bg-success-soft text-success" : order.status === "cancelled" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand")}>{order.status === "received" ? <CircleCheck className="size-[18px]" aria-hidden="true" /> : <Truck className="size-[18px]" aria-hidden="true" />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[13px] font-semibold text-foreground">{order.supplier || t("orders.list.supplierNotSet")}</h3><Badge tone={statusTone(order.status)}>{t(statusLabelKeys[order.status])}</Badge></div><p className="mt-1 text-[10px] text-muted">{order.reference || t("orders.list.orderFallback", { id: order.id.slice(0, 8) })} · {t("orders.list.orderedDate", { date: formatDate(order.orderedAt, locale) })}</p><div className="mt-3 h-1.5 w-52 max-w-full overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-brand-solid transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-1.5 text-[9px] text-muted">{t("orders.list.progress", { received: numberFormat.format(totalReceived), open: numberFormat.format(totalOpen), ordered: numberFormat.format(totalOrdered) })}</p></div></div>
                    <div className="flex items-center justify-between gap-4 pl-[52px] sm:justify-end sm:pl-0"><div className="text-right"><p className="text-[10px] font-medium text-muted">{order.expectedAt ? t("orders.list.expected", { date: formatDate(order.expectedAt, locale) }) : t("orders.list.noEta")}</p><p className="mt-1 text-[9px] text-muted">{t("orders.list.lines", { count: visibleLines.length, value: numberFormat.format(visibleLines.length) })}</p></div>{expanded ? <ChevronUp className="size-4 text-muted" aria-hidden="true" /> : <ChevronDown className="size-4 text-muted" aria-hidden="true" />}</div>
                  </button>

                  {expanded ? (
                    <div className="border-t border-border bg-surface">
                      {order.note ? <p className="border-b border-border px-5 py-3 text-[11px] leading-5 text-muted">{order.note}</p> : null}
                      <div className="divide-y divide-border">
                        {visibleLines.map((line) => {
                          const openQuantity = effectiveLineOpen(line);
                          const displayedOrderedQuantity =
                            line.orderedPurchaseQuantity ?? line.orderedQuantity;
                          const displayedOpenQuantity =
                            line.openPurchaseQuantity ?? openQuantity;
                          const displayedUnitName =
                            line.purchaseUnitName ?? line.baseUnitName;
                          const lineReceiptOpen = receiptForm?.orderId === order.id && receiptForm.lineId === line.id;
                          return (
                            <div key={line.id}>
                              <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(220px,1fr)_95px_95px_130px_140px_auto] lg:items-center">
                                <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted"><Package className="size-4" aria-hidden="true" /></span><div className="min-w-0"><Link href={`/inventory/${line.resourceId}/stock`} className="block truncate text-[12px] font-semibold text-foreground hover:text-brand">{line.resourceName}</Link><p className="mt-0.5 truncate text-[9px] text-muted">{line.resourceSku || t("orders.noSku")} · {t(`orders.tracking.${line.trackingMode}`)}</p>{line.purchaseUnitName ? <p className="mt-1 text-[9px] text-muted">{t("orders.list.purchaseUnitConversion", { purchaseUnit: line.purchaseUnitName, factor: numberFormat.format(line.purchaseUnitFactor), baseUnit: line.baseUnitName })}</p> : null}{line.note ? <p className="mt-1.5 text-[10px] text-muted">{line.note}</p> : null}</div></div>
                                <div className="flex items-center justify-between lg:block"><span className="text-[9px] font-semibold uppercase tracking-wide text-muted">{t("orders.list.ordered")}</span><p className="mt-0.5 text-[12px] font-semibold tabular-nums text-foreground">{numberFormat.format(displayedOrderedQuantity)} {displayedUnitName}</p></div>
                                <div className="flex items-center justify-between lg:block"><span className="text-[9px] font-semibold uppercase tracking-wide text-muted">{t("orders.list.open")}</span><p className={cn("mt-0.5 text-[12px] font-semibold tabular-nums", openQuantity ? "text-brand" : "text-success")}>{numberFormat.format(displayedOpenQuantity)} {displayedUnitName}</p></div>
                                <div className="flex items-center justify-between lg:block"><span className="text-[9px] font-semibold uppercase tracking-wide text-muted">{t("orders.list.eta")}</span><p className="mt-0.5 text-[11px] font-medium text-muted">{formatDate(line.expectedAt ?? order.expectedAt, locale)}</p></div>
                                <div className="flex items-center justify-between lg:block"><span className="text-[9px] font-semibold uppercase tracking-wide text-muted">{t("orders.list.price")}</span><p className="mt-0.5 text-[11px] font-semibold tabular-nums text-foreground">{line.totalPriceCents !== null && line.priceCurrency ? formatMoney(line.totalPriceCents, line.priceCurrency, locale) : "—"}</p>{line.unitPriceCents !== null && line.priceCurrency ? <p className="mt-0.5 text-[9px] text-muted">{formatMoney(line.unitPriceCents, line.priceCurrency, locale)} / {displayedUnitName}</p> : null}</div>
                                {openQuantity > 0 && (order.status === "ordered" || order.status === "partially-received") ? <Button size="sm" variant={lineReceiptOpen ? "ghost" : "secondary"} onClick={() => lineReceiptOpen ? setReceiptForm(null) : beginReceipt(order, line)}>{lineReceiptOpen ? <X className="size-3.5" aria-hidden="true" /> : <PackageCheck className="size-3.5" aria-hidden="true" />}{lineReceiptOpen ? t("orders.actions.close") : t("orders.actions.receive")}</Button> : <Badge tone={order.status === "cancelled" ? "danger" : openQuantity ? "neutral" : "success"}>{order.status === "cancelled" ? t("orders.status.cancelled") : openQuantity ? t("orders.status.pending") : t("orders.status.complete")}</Badge>}
                              </div>

                              {lineReceiptOpen && receiptForm ? (
                                <form onSubmit={receiveLine} className="border-t border-brand-border bg-brand-soft px-4 py-4 sm:px-5">
                                  <div className="mb-4 flex items-start gap-2 rounded-lg bg-surface/80 px-3 py-2.5 text-[10px] leading-4 text-muted"><PackageCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" /><span>{t("orders.receipt.description", { name: receiptForm.resourceName })}</span></div>
                                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                                    <label className={labelClass}>{t("orders.receipt.quantity")}<div className="relative"><input type="number" min="1" max={receiptForm.maxQuantity} step="1" required value={receiptForm.quantity} onChange={(event) => setReceiptForm((current) => current ? { ...current, quantity: event.target.value } : current)} className={`${inputClass} mt-1.5 pr-20 tabular-nums`} /><span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[10px] text-muted">{receiptForm.purchaseUnitName ?? receiptForm.baseUnitName}</span></div><span className="mt-1 block text-[9px] font-normal text-muted">{t("orders.receipt.maximum", { maximum: numberFormat.format(receiptForm.maxQuantity) })}{receiptForm.purchaseUnitName ? ` · ${t("orders.receipt.baseQuantity", { quantity: numberFormat.format(Number(receiptForm.quantity || 0) * receiptForm.purchaseUnitFactor), unit: receiptForm.baseUnitName })}` : ""}</span></label>
                                    <label className={labelClass}>{t("orders.receipt.receivedAt")}<input type="datetime-local" required value={receiptForm.receivedAt} onChange={(event) => setReceiptForm((current) => current ? { ...current, receivedAt: event.target.value } : current)} className={`${inputClass} mt-1.5`} /></label>
                                    <label className={labelClass}>{t("orders.receipt.location")} <span className="font-normal text-muted">· {t("orders.optional")}</span><input value={receiptForm.location} maxLength={240} onChange={(event) => setReceiptForm((current) => current ? { ...current, location: event.target.value } : current)} placeholder={t("orders.receipt.locationPlaceholder")} className={`${inputClass} mt-1.5`} /></label>
                                    <label className={labelClass}>{t("orders.receipt.note")} <span className="font-normal text-muted">· {t("orders.optional")}</span><input value={receiptForm.note} maxLength={20000} onChange={(event) => setReceiptForm((current) => current ? { ...current, note: event.target.value } : current)} placeholder={t("orders.receipt.notePlaceholder")} className={`${inputClass} mt-1.5`} /></label>
                                    <label className={labelClass}>{t("orders.receipt.totalPrice")} <span className="font-normal text-muted">· {t("orders.optional")}</span><div className="relative"><input type="number" min="0" max="20000000" step="0.01" inputMode="decimal" value={receiptForm.totalPrice} onChange={(event) => setReceiptForm((current) => current ? { ...current, totalPrice: event.target.value } : current)} placeholder="0.00" className={`${inputClass} mt-1.5 pr-12 tabular-nums`} /><span className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-[10px] text-muted">{receiptForm.priceCurrency}</span></div></label>
                                    {receiptForm.trackingMode === "serialized" ? <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>{t("orders.receipt.unitCodes")}<textarea rows={4} value={receiptForm.unitCodes} onChange={(event) => setReceiptForm((current) => current ? { ...current, unitCodes: event.target.value } : current)} placeholder={t("orders.receipt.unitCodesPlaceholder")} className={`${inputClass} mt-1.5 h-auto resize-y py-3 font-mono text-xs`} /><span className="mt-1 block text-[9px] font-normal text-muted">{t("orders.receipt.exactCodes", { count: (Number(receiptForm.quantity) || 0) * receiptForm.purchaseUnitFactor, value: numberFormat.format((Number(receiptForm.quantity) || 0) * receiptForm.purchaseUnitFactor) })}</span></label> : null}
                                  </div>
                                  <div className="mt-4 flex justify-end gap-2 border-t border-brand-border pt-4"><Button type="button" variant="ghost" size="sm" onClick={() => setReceiptForm(null)}>{t("orders.actions.cancel")}</Button><Button type="submit" size="sm" disabled={receiving}>{receiving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <PackageCheck className="size-3.5" aria-hidden="true" />}{receiving ? t("orders.actions.receiving") : t("orders.actions.receiveIntoStock")}</Button></div>
                                </form>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface-subtle px-5 py-3 text-[9px] text-muted"><span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden="true" /> {t("orders.list.orderedDate", { date: formatDate(order.orderedAt, locale, true) })}</span>{order.expectedAt ? <span className="flex items-center gap-1"><Truck className="size-3" aria-hidden="true" /> {t("orders.list.expected", { date: formatDate(order.expectedAt, locale) })}</span> : null}<span>{order.createdBy || t("orders.list.system")}</span><span className="ml-auto font-mono">{order.id.slice(0, 8)}</span></div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={scopedOrders.length ? <Search className="size-5" aria-hidden="true" /> : <Truck className="size-5" aria-hidden="true" />}
            title={scopedOrders.length ? t("orders.empty.noMatchesTitle") : resourceId ? t("orders.empty.noItemOrdersTitle") : t("orders.empty.noOrdersTitle")}
            description={scopedOrders.length ? t("orders.empty.noMatchesDescription") : t("orders.empty.noOrdersDescription")}
            action={!scopedOrders.length ? <Button variant="secondary" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden="true" /> {t("orders.actions.createFirstOrder")}</Button> : <Button variant="secondary" onClick={() => { setQuery(""); setFilter("active"); }}>{t("orders.actions.clearFilters")}</Button>}
          />
        )}
      </Card>

      {compact && metrics.openUnits > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-brand-border bg-brand-soft px-3.5 py-3 text-[10px] leading-4 text-brand"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden="true" /><span>{t("orders.inTransit", { count: metrics.openUnits, value: numberFormat.format(metrics.openUnits) })}</span></div>
      ) : null}
    </div>
  );
}
