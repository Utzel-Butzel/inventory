"use client";

import Link from "next/link";
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
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  expectedAt: string | null;
  note: string | null;
  trackingMode: TrackingMode;
};

type PurchaseOrder = {
  id: string;
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
};

type OrderForm = {
  reference: string;
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
  receivedAt: string;
  location: string;
  note: string;
  unitCodes: string;
};

const inputClass =
  "h-10 w-full rounded-xl border border-[#dfe2e7] bg-white px-3 text-sm text-[#30343a] outline-none transition placeholder:text-[#5f6672] hover:border-[#cfd3da] focus:border-[#776fff] focus:ring-3 focus:ring-[#635bff]/10 disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#5f6672]";
const labelClass = "block text-[11px] font-semibold text-[#555c67]";

const statusLabels: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  ordered: "Ordered",
  "partially-received": "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

const filterLabels: Record<OrderFilter, string> = {
  active: "Open",
  all: "All",
  received: "Received",
  cancelled: "Cancelled",
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

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
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
    supplier: "",
    orderedAt: localDateTime(),
    expectedAt: "",
    note: "",
  };
}

function lineFromResource(resource: ClientResource): DraftLine {
  return {
    resourceId: resource.id,
    resourceName: resource.name,
    resourceSku: resource.sku,
    orderedQuantity: "1",
    expectedAt: "",
    note: "",
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
        loadError instanceof Error ? loadError.message : "Unable to load purchase orders.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

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
            loadError instanceof Error ? loadError.message : "Unable to load this inventory item.",
          );
        }
      });
    return () => controller.abort();
  }, [resourceId]);

  useEffect(() => {
    if (!scopedResource || draftLines.length) return;
    setDraftLines([lineFromResource(scopedResource)]);
  }, [draftLines.length, scopedResource]);

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
    const normalizedQuery = query.trim().toLocaleLowerCase();
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
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, query, scopedOrders]);

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
    setDraftLines(scopedResource ? [lineFromResource(scopedResource)] : []);
    setItemQuery("");
    setItemResults([]);
  }

  function addDraftLine(resource: ClientResource) {
    setDraftLines((current) => [...current, lineFromResource(resource)]);
    setItemQuery("");
    setItemResults([]);
    setItemSearchOpen(false);
  }

  function updateDraftLine(
    resourceIdToUpdate: string,
    values: Partial<Pick<DraftLine, "orderedQuantity" | "expectedAt" | "note">>,
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
      setError("Add at least one inventory item to this order.");
      return;
    }
    const invalidLine = draftLines.find((line) => {
      const quantity = Number(line.orderedQuantity);
      return !Number.isInteger(quantity) || quantity < 1;
    });
    if (invalidLine) {
      setError(`Enter a whole order quantity for ${invalidLine.resourceName}.`);
      return;
    }
    const orderedAt = toIsoDateTime(orderForm.orderedAt);
    if (!orderedAt) {
      setError("Choose a valid order date and time.");
      return;
    }

    setCreating(true);
    try {
      const requestBody = {
        reference: orderForm.reference.trim() || null,
        supplier: orderForm.supplier.trim() || undefined,
        status: "ordered" as const,
        orderedAt,
        expectedAt: toIsoDate(orderForm.expectedAt),
        note: orderForm.note.trim() || undefined,
        lines: draftLines.map((line) => ({
          resourceId: line.resourceId,
          orderedQuantity: Number(line.orderedQuantity),
          expectedAt: toIsoDate(line.expectedAt),
          note: line.note.trim() || undefined,
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
      setNotice("Purchase order created. Stock remains unchanged until receipt.");
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Unable to create the purchase order.",
      );
    } finally {
      setCreating(false);
    }
  }

  function beginReceipt(order: PurchaseOrder, line: PurchaseOrderLine) {
    const openQuantity = effectiveLineOpen(line);
    setReceiptForm({
      orderId: order.id,
      lineId: line.id,
      resourceName: line.resourceName,
      trackingMode: line.trackingMode,
      maxQuantity: Math.min(1_000, openQuantity),
      quantity: String(Math.min(1_000, openQuantity)),
      receivedAt: localDateTime(),
      location: "",
      note: "",
      unitCodes: "",
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
      setError(`Receive between 1 and ${receiptForm.maxQuantity} units.`);
      return;
    }
    const receivedAt = toIsoDateTime(receiptForm.receivedAt);
    if (!receivedAt) {
      setError("Choose a valid receipt date and time.");
      return;
    }
    const unitCodes = parsedCodes(receiptForm.unitCodes);
    if (
      receiptForm.trackingMode === "serialized" &&
      unitCodes.length !== quantity
    ) {
      setError(`Enter one unique unit code for each of the ${quantity} received units.`);
      return;
    }
    if (new Set(unitCodes).size !== unitCodes.length) {
      setError("Received unit codes must be unique.");
      return;
    }

    setReceiving(true);
    try {
      const requestBody = {
        quantity,
        receivedAt,
        location: receiptForm.location.trim() || undefined,
        note: receiptForm.note.trim() || undefined,
        unitCodes:
          receiptForm.trackingMode === "serialized" ? unitCodes : undefined,
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
        `${quantity} ${receivedName}${quantity === 1 ? "" : " units"} received into available stock.`,
      );
    } catch (receiptError) {
      setError(
        receiptError instanceof Error ? receiptError.message : "Unable to receive this order line.",
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
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-[#5147d9]">
            <Truck className="size-3.5" aria-hidden="true" /> Incoming stock
          </div>
          <h1 className={cn("font-semibold tracking-[-0.04em] text-[#1e2126]", compact ? "text-xl" : "text-[28px] sm:text-[32px]")}>{resourceId ? "Orders for this item" : "Purchase orders"}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#5f6672]">Track ordered quantities separately and add stock only when goods are received.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void loadOrders(true)} disabled={refreshing || loading}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
            <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </Button>
          <Button onClick={() => setCreateOpen((current) => !current)}>
            {createOpen ? <X className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            {createOpen ? "Close form" : "New order"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-[#efd6d9] bg-[#fff5f6] px-4 py-3 text-sm text-[#b83243]">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X className="size-4" aria-hidden="true" /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-[#ccebdd] bg-[#effaf5] px-4 py-3 text-sm text-[#11734d]">
          <span className="flex items-center gap-2"><Check className="size-4 shrink-0" aria-hidden="true" /> {notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X className="size-4" aria-hidden="true" /></button>
        </div>
      ) : null}

      {!compact ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-5">
            <div className="flex items-center justify-between"><p className="text-[12px] font-semibold text-[#5f6672]">Open orders</p><span className="grid size-9 place-items-center rounded-xl bg-[#eeedff] text-[#5147d9]"><ShoppingCart className="size-[17px]" aria-hidden="true" /></span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-[#24272c]">{metrics.active}</p>
            <p className="mt-1 text-[11px] text-[#5f6672]">Ordered or partially received</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between"><p className="text-[12px] font-semibold text-[#5f6672]">Units incoming</p><span className="grid size-9 place-items-center rounded-xl bg-[#e8f7f0] text-[#138a5b]"><PackageCheck className="size-[17px]" aria-hidden="true" /></span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-[#24272c]">{metrics.openUnits.toLocaleString()}</p>
            <p className="mt-1 text-[11px] text-[#5f6672]">Not counted as available yet</p>
          </Card>
          <Card className={cn("p-5", metrics.overdue > 0 && "border-[#f0ddbd] bg-[#fffaf2]")}>
            <div className="flex items-center justify-between"><p className="text-[12px] font-semibold text-[#5f6672]">Overdue</p><span className={cn("grid size-9 place-items-center rounded-xl", metrics.overdue ? "bg-[#fff2e2] text-[#b56b0c]" : "bg-[#f0f2f4] text-[#5f6672]")}><Clock3 className="size-[17px]" aria-hidden="true" /></span></div>
            <p className="mt-5 text-[28px] font-semibold tracking-[-0.04em] text-[#24272c]">{metrics.overdue}</p>
            <p className="mt-1 text-[11px] text-[#5f6672]">Open orders past their ETA</p>
          </Card>
        </div>
      ) : null}

      {createOpen ? (
        <Card className="overflow-visible">
          <div className="flex items-start gap-3 border-b border-[#eceef1] px-4 py-4 sm:px-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eeedff] text-[#5147d9]"><ShoppingCart className="size-4" aria-hidden="true" /></span>
            <div><h2 className="text-sm font-semibold text-[#292c31]">Create purchase order</h2><p className="mt-0.5 text-[12px] text-[#5f6672]">The order is tracked as incoming; it does not change available stock.</p></div>
          </div>
          <form onSubmit={createOrder}>
            <div className="grid gap-4 border-b border-[#eceef1] p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
              <label className={labelClass}>Supplier<input value={orderForm.supplier} onChange={(event) => setOrderForm((current) => ({ ...current, supplier: event.target.value }))} placeholder="Supplier name" maxLength={240} className={`${inputClass} mt-1.5`} /></label>
              <label className={labelClass}>Reference <span className="font-normal text-[#5f6672]">· optional</span><input value={orderForm.reference} onChange={(event) => setOrderForm((current) => ({ ...current, reference: event.target.value }))} placeholder="PO-1048" maxLength={160} className={`${inputClass} mt-1.5`} /></label>
              <label className={labelClass}>Ordered at<input type="datetime-local" required value={orderForm.orderedAt} onChange={(event) => setOrderForm((current) => ({ ...current, orderedAt: event.target.value }))} className={`${inputClass} mt-1.5`} /></label>
              <label className={labelClass}>Expected arrival <span className="font-normal text-[#5f6672]">· optional</span><input type="date" min={dateInput()} value={orderForm.expectedAt} onChange={(event) => setOrderForm((current) => ({ ...current, expectedAt: event.target.value }))} className={`${inputClass} mt-1.5`} /></label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>Order note <span className="font-normal text-[#5f6672]">· optional</span><textarea rows={2} value={orderForm.note} onChange={(event) => setOrderForm((current) => ({ ...current, note: event.target.value }))} maxLength={20000} placeholder="Terms, delivery instructions, or internal context" className={`${inputClass} mt-1.5 h-auto resize-y py-3`} /></label>
            </div>

            {!resourceId ? (
              <div className="relative border-b border-[#eceef1] p-4 sm:p-5">
                <label className="relative block">
                  <span className="sr-only">Search inventory items</span>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#5f6672]" aria-hidden="true" />
                  <input value={itemQuery} onFocus={() => setItemSearchOpen(true)} onChange={(event) => { setItemQuery(event.target.value); setItemSearchOpen(true); }} placeholder="Search inventory to add an order line…" className={`${inputClass} pl-10 pr-10`} />
                  {searchingItems ? <LoaderCircle className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#5147d9]" aria-hidden="true" /> : null}
                </label>
                {itemSearchOpen && itemQuery.trim().length >= 2 ? (
                  <div className="absolute inset-x-4 top-[calc(100%-14px)] z-30 overflow-hidden rounded-xl border border-[#dfe2e7] bg-white shadow-[var(--shadow-md)] sm:inset-x-5">
                    {itemResults.length ? <div className="max-h-72 overflow-y-auto p-1.5">{itemResults.map((resource) => <button key={resource.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => addDraftLine(resource)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[#f5f6f8]"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#f0f2f4] text-[#5f6672]"><Package className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[#30343a]">{resource.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#5f6672]">{resource.sku || "No SKU"} · {resource.quantity} available</span></span><Plus className="size-4 text-[#5147d9]" aria-hidden="true" /></button>)}</div> : <div className="px-4 py-5 text-center text-[12px] text-[#5f6672]">{searchingItems ? "Searching inventory…" : "No unselected items found."}</div>}
                  </div>
                ) : null}
              </div>
            ) : null}

            {draftLines.length ? (
              <div className="divide-y divide-[#eceef1]">
                {draftLines.map((line) => (
                  <div key={line.resourceId} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(190px,1fr)_130px_160px_minmax(180px,1fr)_auto] lg:items-start">
                    <div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f0f2f4] text-[#5f6672]"><Package className="size-[18px]" aria-hidden="true" /></span><div className="min-w-0 pt-0.5"><Link href={`/inventory/${line.resourceId}`} className="block truncate text-[13px] font-semibold text-[#30343a] hover:text-[#5147d9]">{line.resourceName}</Link><p className="mt-1 truncate text-[10px] text-[#5f6672]">{line.resourceSku || "No SKU"}</p></div></div>
                    <label className={labelClass}>Order quantity<input type="number" min="1" max="2000000000" step="1" required value={line.orderedQuantity} onChange={(event) => updateDraftLine(line.resourceId, { orderedQuantity: event.target.value })} className={`${inputClass} mt-1.5 tabular-nums`} /></label>
                    <label className={labelClass}>Line ETA <span className="font-normal text-[#5f6672]">· optional</span><input type="date" value={line.expectedAt} onChange={(event) => updateDraftLine(line.resourceId, { expectedAt: event.target.value })} className={`${inputClass} mt-1.5`} /></label>
                    <label className={labelClass}>Line note <span className="font-normal text-[#5f6672]">· optional</span><input value={line.note} onChange={(event) => updateDraftLine(line.resourceId, { note: event.target.value })} maxLength={20000} placeholder="Variant or packaging" className={`${inputClass} mt-1.5`} /></label>
                    {!resourceId ? <button type="button" onClick={() => setDraftLines((current) => current.filter((item) => item.resourceId !== line.resourceId))} className="grid size-9 place-items-center rounded-lg border border-[#f1c7cc] bg-white text-[#b83243] hover:bg-[#fff5f6] lg:mt-[22px]" aria-label={`Remove ${line.resourceName}`}><X className="size-3.5" aria-hidden="true" /></button> : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Package className="size-5" aria-hidden="true" />} title="Add an order line" description="Search inventory above and choose at least one item to order." className="min-h-48" />
            )}

            <div className="flex flex-col gap-3 border-t border-[#eceef1] bg-[#fafbfc] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-[11px] text-[#5f6672]">{draftLines.length} {draftLines.length === 1 ? "item" : "items"} · {draftLines.reduce((total, line) => total + (Number(line.orderedQuantity) || 0), 0).toLocaleString()} units ordered</p>
              <div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => { resetCreateForm(); setCreateOpen(false); }}>Cancel</Button><Button type="submit" disabled={creating || !draftLines.length}>{creating ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <ShoppingCart className="size-4" aria-hidden="true" />}{creating ? "Creating…" : "Create order"}</Button></div>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#e8eaed] p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
          <label className="relative min-w-0 flex-1 xl:max-w-md"><span className="sr-only">Search purchase orders</span><Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#5f6672]" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier, reference, or item…" className={`${inputClass} bg-[#f8f9fa] pl-10 pr-10`} />{query ? <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[#5f6672] hover:bg-[#eceef1]" aria-label="Clear order search"><X className="size-3.5" aria-hidden="true" /></button> : null}</label>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f0f2f4] p-1 sm:flex">{(Object.keys(filterLabels) as OrderFilter[]).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition", filter === value ? "bg-white text-[#34383e] shadow-sm" : "text-[#5f6672] hover:text-[#34383e]")}>{filterLabels[value]} <span className={filter === value ? "text-[#5147d9]" : "text-[#5f6672]"}>{filterCounts[value]}</span></button>)}</div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
        ) : filteredOrders.length ? (
          <div className="divide-y divide-[#e8eaed]">
            {filteredOrders.map((order) => {
              const visibleLines = resourceId ? order.lines.filter((line) => line.resourceId === resourceId) : order.lines;
              const totalOrdered = visibleLines.reduce((total, line) => total + line.orderedQuantity, 0);
              const totalReceived = visibleLines.reduce((total, line) => total + line.receivedQuantity, 0);
              const totalOpen = visibleLines.reduce((total, line) => total + effectiveLineOpen(line), 0);
              const progress = totalOrdered ? Math.min(100, (totalReceived / totalOrdered) * 100) : 0;
              const expanded = expandedOrders.has(order.id) || compact || filteredOrders.length <= 3;
              return (
                <article key={order.id} className={cn("transition", isActive(order.status) && totalOpen > 0 && "bg-[#fdfdff]")}>
                  <button type="button" onClick={() => toggleExpanded(order.id)} className="flex w-full flex-col gap-4 px-4 py-4 text-left sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-start gap-3"><span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", order.status === "received" ? "bg-[#e8f7f0] text-[#138a5b]" : order.status === "cancelled" ? "bg-[#fff0f2] text-[#c34755]" : "bg-[#eeedff] text-[#5147d9]")}>{order.status === "received" ? <CircleCheck className="size-[18px]" aria-hidden="true" /> : <Truck className="size-[18px]" aria-hidden="true" />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-[13px] font-semibold text-[#30343a]">{order.supplier || "Supplier not set"}</h3><Badge tone={statusTone(order.status)}>{statusLabels[order.status]}</Badge></div><p className="mt-1 text-[10px] text-[#5f6672]">{order.reference || `Order ${order.id.slice(0, 8)}`} · ordered {formatDate(order.orderedAt)}</p><div className="mt-3 h-1.5 w-52 max-w-full overflow-hidden rounded-full bg-[#e8eaed]"><div className="h-full rounded-full bg-[#5147d9] transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-1.5 text-[9px] text-[#5f6672]">{totalReceived} received · {totalOpen} open · {totalOrdered} ordered</p></div></div>
                    <div className="flex items-center justify-between gap-4 pl-[52px] sm:justify-end sm:pl-0"><div className="text-right"><p className="text-[10px] font-medium text-[#5f6672]">{order.expectedAt ? `Expected ${formatDate(order.expectedAt)}` : "No ETA"}</p><p className="mt-1 text-[9px] text-[#5f6672]">{visibleLines.length} {visibleLines.length === 1 ? "line" : "lines"}</p></div>{expanded ? <ChevronUp className="size-4 text-[#5f6672]" aria-hidden="true" /> : <ChevronDown className="size-4 text-[#5f6672]" aria-hidden="true" />}</div>
                  </button>

                  {expanded ? (
                    <div className="border-t border-[#eceef1] bg-white">
                      {order.note ? <p className="border-b border-[#eceef1] px-5 py-3 text-[11px] leading-5 text-[#5f6672]">{order.note}</p> : null}
                      <div className="divide-y divide-[#eceef1]">
                        {visibleLines.map((line) => {
                          const openQuantity = effectiveLineOpen(line);
                          const lineReceiptOpen = receiptForm?.orderId === order.id && receiptForm.lineId === line.id;
                          return (
                            <div key={line.id}>
                              <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(220px,1fr)_110px_110px_150px_auto] lg:items-center">
                                <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f0f2f4] text-[#5f6672]"><Package className="size-4" aria-hidden="true" /></span><div className="min-w-0"><Link href={`/inventory/${line.resourceId}/stock`} className="block truncate text-[12px] font-semibold text-[#30343a] hover:text-[#5147d9]">{line.resourceName}</Link><p className="mt-0.5 truncate text-[9px] text-[#5f6672]">{line.resourceSku || "No SKU"} · {line.trackingMode}</p>{line.note ? <p className="mt-1.5 text-[10px] text-[#5f6672]">{line.note}</p> : null}</div></div>
                                <div className="flex items-center justify-between lg:block"><span className="text-[9px] font-semibold uppercase tracking-wide text-[#5f6672]">Ordered</span><p className="mt-0.5 text-[12px] font-semibold tabular-nums text-[#30343a]">{line.orderedQuantity}</p></div>
                                <div className="flex items-center justify-between lg:block"><span className="text-[9px] font-semibold uppercase tracking-wide text-[#5f6672]">Open</span><p className={cn("mt-0.5 text-[12px] font-semibold tabular-nums", openQuantity ? "text-[#5147d9]" : "text-[#11734d]")}>{openQuantity}</p></div>
                                <div className="flex items-center justify-between lg:block"><span className="text-[9px] font-semibold uppercase tracking-wide text-[#5f6672]">ETA</span><p className="mt-0.5 text-[11px] font-medium text-[#5f6672]">{formatDate(line.expectedAt ?? order.expectedAt)}</p></div>
                                {openQuantity > 0 && (order.status === "ordered" || order.status === "partially-received") ? <Button size="sm" variant={lineReceiptOpen ? "ghost" : "secondary"} onClick={() => lineReceiptOpen ? setReceiptForm(null) : beginReceipt(order, line)}>{lineReceiptOpen ? <X className="size-3.5" aria-hidden="true" /> : <PackageCheck className="size-3.5" aria-hidden="true" />}{lineReceiptOpen ? "Close" : "Receive"}</Button> : <Badge tone={order.status === "cancelled" ? "danger" : openQuantity ? "neutral" : "success"}>{order.status === "cancelled" ? "Cancelled" : openQuantity ? "Pending" : "Complete"}</Badge>}
                              </div>

                              {lineReceiptOpen && receiptForm ? (
                                <form onSubmit={receiveLine} className="border-t border-[#dedaFF] bg-[#f8f7ff] px-4 py-4 sm:px-5">
                                  <div className="mb-4 flex items-start gap-2 rounded-lg bg-white/80 px-3 py-2.5 text-[10px] leading-4 text-[#5f6672]"><PackageCheck className="mt-0.5 size-3.5 shrink-0 text-[#5147d9]" aria-hidden="true" /><span>Receiving creates available stock and an immutable receipt movement. You can receive only part of the open quantity.</span></div>
                                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <label className={labelClass}>Quantity<input type="number" min="1" max={receiptForm.maxQuantity} step="1" required value={receiptForm.quantity} onChange={(event) => setReceiptForm((current) => current ? { ...current, quantity: event.target.value } : current)} className={`${inputClass} mt-1.5 tabular-nums`} /><span className="mt-1 block text-[9px] font-normal text-[#5f6672]">Up to {receiptForm.maxQuantity} this receipt</span></label>
                                    <label className={labelClass}>Received at<input type="datetime-local" required value={receiptForm.receivedAt} onChange={(event) => setReceiptForm((current) => current ? { ...current, receivedAt: event.target.value } : current)} className={`${inputClass} mt-1.5`} /></label>
                                    <label className={labelClass}>Stock location <span className="font-normal text-[#5f6672]">· optional</span><input value={receiptForm.location} maxLength={240} onChange={(event) => setReceiptForm((current) => current ? { ...current, location: event.target.value } : current)} placeholder="Workshop · Shelf A3" className={`${inputClass} mt-1.5`} /></label>
                                    <label className={labelClass}>Receipt note <span className="font-normal text-[#5f6672]">· optional</span><input value={receiptForm.note} maxLength={20000} onChange={(event) => setReceiptForm((current) => current ? { ...current, note: event.target.value } : current)} placeholder="Packing slip or condition" className={`${inputClass} mt-1.5`} /></label>
                                    {receiptForm.trackingMode === "serialized" ? <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>Unit codes<textarea rows={4} value={receiptForm.unitCodes} onChange={(event) => setReceiptForm((current) => current ? { ...current, unitCodes: event.target.value } : current)} placeholder="One unique unit code per line" className={`${inputClass} mt-1.5 h-auto resize-y py-3 font-mono text-xs`} /><span className="mt-1 block text-[9px] font-normal text-[#5f6672]">Enter exactly {Number(receiptForm.quantity) || 0} unique codes.</span></label> : null}
                                  </div>
                                  <div className="mt-4 flex justify-end gap-2 border-t border-[#dfddec] pt-4"><Button type="button" variant="ghost" size="sm" onClick={() => setReceiptForm(null)}>Cancel</Button><Button type="submit" size="sm" disabled={receiving}>{receiving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <PackageCheck className="size-3.5" aria-hidden="true" />}{receiving ? "Receiving…" : "Receive into stock"}</Button></div>
                                </form>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#eceef1] bg-[#fafbfc] px-5 py-3 text-[9px] text-[#5f6672]"><span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden="true" /> Ordered {formatDate(order.orderedAt, true)}</span>{order.expectedAt ? <span className="flex items-center gap-1"><Truck className="size-3" aria-hidden="true" /> Expected {formatDate(order.expectedAt)}</span> : null}<span>{order.createdBy || "System"}</span><span className="ml-auto font-mono">{order.id.slice(0, 8)}</span></div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={scopedOrders.length ? <Search className="size-5" aria-hidden="true" /> : <Truck className="size-5" aria-hidden="true" />}
            title={scopedOrders.length ? "No orders match these filters" : resourceId ? "No orders for this item" : "No purchase orders yet"}
            description={scopedOrders.length ? "Try another search or status filter." : "Create an order to track incoming stock without counting it as available."}
            action={!scopedOrders.length ? <Button variant="secondary" onClick={() => setCreateOpen(true)}><Plus className="size-4" aria-hidden="true" /> Create first order</Button> : <Button variant="secondary" onClick={() => { setQuery(""); setFilter("active"); }}>Clear filters</Button>}
          />
        )}
      </Card>

      {compact && metrics.openUnits > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-[#dedaFF] bg-[#f8f7ff] px-3.5 py-3 text-[10px] leading-4 text-[#5f5a85]"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#5147d9]" aria-hidden="true" /><span>{metrics.openUnits} ordered {metrics.openUnits === 1 ? "unit is" : "units are"} still in transit and excluded from available stock.</span></div>
      ) : null}
    </div>
  );
}
