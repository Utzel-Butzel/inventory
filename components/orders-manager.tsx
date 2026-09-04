"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  HandCoins,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import {
  CurrencyInput,
  Field,
  FormActions,
  Input,
  NumberInput,
  SearchInput,
  Select,
  Textarea,
} from "@/components/form-controls";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { PurchaseOrdersManager } from "@/components/purchase-orders-manager";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Skeleton,
  cn,
} from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type OrderType = "purchase" | "sale" | "loan";
type TradeOrderType = Exclude<OrderType, "purchase">;

type ShipmentStatus =
  | "draft"
  | "ready"
  | "shipped"
  | "in_transit"
  | "delivered"
  | "exception"
  | "returned"
  | "cancelled";

type Shipment = {
  id: string;
  orderId: string;
  carrierCode: string;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  shippedAt: string | null;
  deliveredAt: string | null;
  note: string;
  createdAt: string;
  lines: Array<{
    id: string;
    orderLineId: string;
    resourceId: string;
    resourceName: string;
    quantity: number;
    units: Array<{
      orderLineUnitId: string;
      stockUnitId: string;
      code: string;
    }>;
  }>;
  events: Array<{
    id: string;
    fromStatus: ShipmentStatus | null;
    toStatus: ShipmentStatus;
    note: string;
    actor: string | null;
    occurredAt: string;
  }>;
  totalQuantity: number;
};

type Contact = {
  id: string;
  name: string;
  company: string | null;
  roles: Array<"customer" | "supplier">;
};

type OrderLine = {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  quantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  openQuantity: number;
  reservedQuantity: number;
  openReservationQuantity: number;
  openReturnQuantity: number;
  unitPriceCents: number | null;
  priceCurrency: string | null;
  totalPriceCents: number | null;
  expectedAt: string | null;
  note: string;
  trackingMode: "bulk" | "serialized";
  unitName: string;
  units: OrderLineUnit[];
};

type OrderLineUnit = {
  id: string;
  stockUnitId: string;
  code: string;
  status: "reserved" | "fulfilled" | "returned";
  stockStatus:
    | "available"
    | "reserved"
    | "in-use"
    | "maintenance"
    | "consumed"
    | "lost"
    | "retired";
  reservedAt: string;
  fulfilledAt: string | null;
  returnedAt: string | null;
};

type SerializedUnitPanel = {
  line: {
    id: string;
    resourceId: string;
    resourceName: string;
    quantity: number;
    fulfilledQuantity: number;
    returnedQuantity: number;
  };
  availableUnits: Array<{
    id: string;
    code: string;
    status: "available";
    location: string | null;
  }>;
  assignments: OrderLineUnit[];
};

type Order = {
  id: string;
  type: OrderType;
  contactId: string | null;
  contactName: string;
  reference: string | null;
  status: string;
  orderedAt: string;
  expectedAt: string | null;
  note: string;
  lines: OrderLine[];
  shipments: Shipment[];
  totalQuantity: number;
  totalFulfilled: number;
  totalReturned: number;
};

type DraftLine = {
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  quantity: string;
  unitPrice: string;
  currency: string;
  note: string;
};

type TradeOrderForm = {
  contactId: string;
  reference: string;
  orderedAt: string;
  expectedAt: string;
  note: string;
  lines: DraftLine[];
};

function randomId() {
  return crypto.randomUUID();
}

function localDateTime(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDate(value = new Date()) {
  return localDateTime(value).slice(0, 10);
}

function tradeOrderDefaults(contactId = ""): TradeOrderForm {
  const due = new Date();
  due.setDate(due.getDate() + 7);
  return {
    contactId,
    reference: "",
    orderedAt: localDateTime(),
    expectedAt: localDate(due),
    note: "",
    lines: [],
  };
}

function iso(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function formatDateTime(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (["fulfilled", "returned", "delivered"].includes(status)) {
    return "success" as const;
  }
  if (status === "cancelled") return "danger" as const;
  if (["overdue", "partially-returned", "exception"].includes(status)) {
    return "warning" as const;
  }
  if (["confirmed", "reserved", "issued", "partially-issued", "partially-fulfilled", "ready", "shipped", "in_transit"].includes(status)) {
    return "brand" as const;
  }
  return "neutral" as const;
}

export function OrdersManager({ type = "purchase" }: { type?: OrderType }) {
  const { t } = useT("orders");
  const tabs: Array<{
    type: OrderType;
    href: string;
    icon: typeof Truck;
  }> = [
    { type: "purchase", href: "/operations/purchases", icon: Truck },
    { type: "sale", href: "/operations/sales", icon: ShoppingCart },
    { type: "loan", href: "/operations/loans", icon: HandCoins },
  ];

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap gap-1 p-1.5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.type}
              href={tab.href}
              aria-current={type === tab.type ? "page" : undefined}
              className={cn(
                "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition sm:flex-none",
                type === tab.type
                  ? "bg-brand-soft text-brand shadow-sm"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(`types.${tab.type}`)}
            </Link>
          );
        })}
      </Card>
      {type === "purchase" ? (
        <PurchaseOrdersManager />
      ) : (
        <TradeOrdersManager key={type} type={type} />
      )}
    </div>
  );
}

function TradeOrdersManager({ type }: { type: TradeOrderType }) {
  const { t, i18n } = useT("orders");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "de";
  const [orders, setOrders] = useState<Order[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingLineId, setActingLineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<ClientResource[]>([]);
  const [searching, setSearching] = useState(false);
  const [movementQuantities, setMovementQuantities] = useState<
    Record<string, string>
  >({});
  const [unitPanelLineId, setUnitPanelLineId] = useState<string | null>(null);
  const [unitPanel, setUnitPanel] = useState<SerializedUnitPanel | null>(null);
  const [unitPanelLoading, setUnitPanelLoading] = useState(false);
  const [selectedUnitIds, setSelectedUnitIds] = useState<
    Record<string, string>
  >({});
  const [actingUnitKey, setActingUnitKey] = useState<string | null>(null);
  const {
    control,
    formState: { errors: formErrors },
    getValues,
    handleSubmit,
    register,
    reset,
    setValue,
  } = useForm<TradeOrderForm>({
    defaultValues: tradeOrderDefaults(),
    mode: "onBlur",
  });
  const {
    append: appendLine,
    fields: lineFields,
    remove: removeLine,
  } = useFieldArray({ control, name: "lines" });
  const draftLines = useWatch({ control, name: "lines" });
  const createKey = useRef<string | null>(null);
  const movementKeys = useRef(new Map<string, string>());

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [orderPayload, contactPayload] = await Promise.all([
        fetchJson<{ orders: Order[] }>(`/api/v1/orders?type=${type}&limit=100`, {
          cache: "no-store",
        }),
        fetchJson<{ contacts: Contact[] }>("/api/v1/contacts?role=customer", {
          cache: "no-store",
        }),
      ]);
      setOrders(orderPayload.orders ?? []);
      setContacts(contactPayload.contacts ?? []);
      if (!getValues("contactId")) {
        setValue("contactId", contactPayload.contacts?.[0]?.id ?? "");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getValues, setValue, t, type]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = itemQuery.trim();
    if (query.length < 2) {
      setItemResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: query, page: "1", pageSize: "8" });
        const payload = await fetchJson<{ resources: ClientResource[] }>(
          `/api/v1/resources?${params}`,
          { signal: controller.signal },
        );
        const selected = new Set(draftLines.map((line) => line.resourceId));
        setItemResults(
          (payload.resources ?? []).filter((resource) => !selected.has(resource.id)),
        );
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) {
          setItemResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draftLines, itemQuery]);

  const metrics = useMemo(() => {
    const active = orders.filter(
      (order) => !["fulfilled", "returned", "cancelled"].includes(order.status),
    );
    return {
      active: active.length,
      open: active.reduce(
        (total, order) =>
          total + order.lines.reduce((sum, line) => sum + line.openQuantity, 0),
        0,
      ),
      overdue: active.filter((order) => order.status === "overdue").length,
      readyShipments: orders.reduce(
        (total, order) =>
          total + order.shipments.filter((shipment) => shipment.status === "ready").length,
        0,
      ),
    };
  }, [orders]);

  function resetForm() {
    reset(tradeOrderDefaults(getValues("contactId")));
    setItemQuery("");
    createKey.current = null;
  }

  function addItem(resource: ClientResource) {
    appendLine({
      resourceId: resource.id,
      resourceName: resource.name,
      resourceSku: resource.sku,
      quantity: "1",
      unitPrice:
        type === "sale" && resource.valueCents !== null
          ? (resource.valueCents / 100).toFixed(2)
          : "",
      currency: resource.currency,
      note: "",
    });
    setItemQuery("");
    setItemResults([]);
  }

  async function create(form: TradeOrderForm) {
    setError(null);
    setNotice(null);
    if (!form.contactId || !form.lines.length) {
      setError(t("errors.missingContactOrLines"));
      return;
    }
    const lines = form.lines.map((line) => ({
      resourceId: line.resourceId,
      quantity: Number(line.quantity),
      note: line.note || undefined,
      unitPriceCents:
        type === "sale" && line.unitPrice.trim()
          ? Math.round(Number(line.unitPrice.replace(",", ".")) * 100)
          : undefined,
      priceCurrency:
        type === "sale" && line.unitPrice.trim() ? line.currency : undefined,
    }));
    if (
      lines.some(
        (line) =>
          !Number.isInteger(line.quantity) ||
          line.quantity < 1 ||
          (line.unitPriceCents !== undefined &&
            (!Number.isFinite(line.unitPriceCents) || line.unitPriceCents < 0)),
      )
    ) {
      setError(t("errors.invalidLines"));
      return;
    }
    const payload = {
      type,
      contactId: form.contactId,
      reference: form.reference || null,
      orderedAt: iso(form.orderedAt),
      expectedAt:
        type === "loan" ? iso(`${form.expectedAt}T12:00:00`) : null,
      note: form.note,
      lines,
    };
    const body = JSON.stringify(payload);
    createKey.current ??= randomId();
    setSaving(true);
    try {
      await fetchJson("/api/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createKey.current,
        },
        body,
      });
      createKey.current = null;
      resetForm();
      setFormOpen(false);
      await load(true);
      setNotice(t("notices.created", { type: t(`types.${type}`) }));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("errors.create"));
    } finally {
      setSaving(false);
    }
  }

  async function move(order: Order, line: OrderLine, action: "issue" | "return") {
    const maximum = action === "return" ? line.openReturnQuantity : line.openQuantity;
    const quantity = Number(movementQuantities[line.id] || maximum);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
      setError(t("errors.invalidMovementQuantity", { maximum }));
      return;
    }
    const operation = `${line.id}:${action}:${quantity}`;
    const key = movementKeys.current.get(operation) ?? randomId();
    movementKeys.current.set(operation, key);
    setActingLineId(line.id);
    setError(null);
    try {
      await fetchJson(
        `/api/v1/orders/${order.id}/lines/${line.id}/movements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify({ action, quantity }),
        },
      );
      movementKeys.current.delete(operation);
      setMovementQuantities((current) => ({ ...current, [line.id]: "" }));
      await load(true);
      setNotice(t(`notices.${action}`, { quantity, name: line.resourceName }));
    } catch (movementError) {
      setError(
        movementError instanceof Error ? movementError.message : t("errors.movement"),
      );
    } finally {
      setActingLineId(null);
    }
  }

  async function openUnitPanel(order: Order, line: OrderLine) {
    if (unitPanelLineId === line.id) {
      setUnitPanelLineId(null);
      setUnitPanel(null);
      return;
    }
    setUnitPanelLineId(line.id);
    setUnitPanel(null);
    setUnitPanelLoading(true);
    setError(null);
    try {
      const payload = await fetchJson<SerializedUnitPanel>(
        `/api/v1/orders/${order.id}/lines/${line.id}/units`,
        { cache: "no-store" },
      );
      setUnitPanel(payload);
      setSelectedUnitIds((current) => ({
        ...current,
        [line.id]: payload.availableUnits[0]?.id ?? "",
      }));
    } catch (unitError) {
      setError(
        unitError instanceof Error ? unitError.message : t("errors.unitsLoad"),
      );
    } finally {
      setUnitPanelLoading(false);
    }
  }

  async function applyUnitAction(
    order: Order,
    line: OrderLine,
    action: "reserve" | "release" | "issue" | "return",
    unitId: string,
  ) {
    if (!unitId) return;
    const actionKey = `${line.id}:${unitId}:${action}`;
    setActingUnitKey(actionKey);
    setError(null);
    setNotice(null);
    try {
      const payload = await fetchJson<{
        changed: number;
        units: SerializedUnitPanel;
      }>(`/api/v1/orders/${order.id}/lines/${line.id}/units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, unitIds: [unitId] }),
      });
      setUnitPanel(payload.units);
      setSelectedUnitIds((current) => ({
        ...current,
        [line.id]: payload.units.availableUnits[0]?.id ?? "",
      }));
      await load(true);
      const affected =
        payload.units.assignments.find((unit) => unit.stockUnitId === unitId)
          ?.code ??
        payload.units.availableUnits.find((unit) => unit.id === unitId)?.code ??
        unitPanel?.availableUnits.find((unit) => unit.id === unitId)?.code ??
        unitId;
      setNotice(t(`notices.unit.${action}`, { code: affected }));
    } catch (unitError) {
      setError(
        unitError instanceof Error ? unitError.message : t("errors.unitAction"),
      );
    } finally {
      setActingUnitKey(null);
    }
  }

  async function cancel(order: Order) {
    setError(null);
    try {
      await fetchJson(`/api/v1/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      await load(true);
      setNotice(t("notices.cancelled"));
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : t("errors.update"));
    }
  }

  const Icon = type === "sale" ? ShoppingCart : HandCoins;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand">
            <Icon className="size-4" aria-hidden="true" />
            {t(`eyebrow.${type}`)}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t(`title.${type}`)}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            {t(`description.${type}`)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
            {t("actions.refresh")}
          </Button>
          <Button onClick={() => setFormOpen((current) => !current)}>
            {formOpen ? <X className="size-4" /> : <Plus className="size-4" />}
            {formOpen ? t("actions.close") : t("actions.new")}
          </Button>
        </div>
      </header>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}
      {notice ? (
        <Alert tone="success">{notice}</Alert>
      ) : null}

      <div className={cn("grid gap-3 sm:grid-cols-3", type === "sale" && "lg:grid-cols-4")}>
        <Metric icon={Icon} label={t("metrics.active")} value={metrics.active} />
        <Metric icon={Package} label={t("metrics.open")} value={metrics.open} />
        <Metric icon={CalendarClock} label={t("metrics.overdue")} value={metrics.overdue} warning={metrics.overdue > 0} />
        {type === "sale" ? (
          <Metric icon={Truck} label={t("metrics.readyShipments")} value={metrics.readyShipments} />
        ) : null}
      </div>

      {formOpen ? (
        <Card className="overflow-visible p-0">
          <form onSubmit={(event) => void handleSubmit(create)(event)} noValidate>
            <div className="grid gap-4 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4 lg:p-5">
              <Field label={t("fields.contact")} error={formErrors.contactId?.message} required>
                <Select {...register("contactId", { required: t("validation.contactRequired") })}>
                  <option value="">{t("fields.chooseContact")}</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.company ? `${contact.company} · ${contact.name}` : contact.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("fields.reference")} error={formErrors.reference?.message}>
                <Input {...register("reference", { maxLength: { value: 160, message: t("validation.maxLength", { max: 160 }) } })} maxLength={160} placeholder={type === "sale" ? "SO-1001" : "LOAN-1001"} />
              </Field>
              <Field label={t("fields.orderedAt")} error={formErrors.orderedAt?.message} required>
                <Input type="datetime-local" {...register("orderedAt", { required: t("validation.orderedAtRequired") })} />
              </Field>
              {type === "loan" ? (
                <Field label={t("fields.dueAt")} error={formErrors.expectedAt?.message} required>
                  <Input type="date" min={localDate()} {...register("expectedAt", { required: t("validation.dueAtRequired") })} />
                </Field>
              ) : null}
              <Field label={t("fields.note")} error={formErrors.note?.message} className="sm:col-span-2 lg:col-span-4">
                <Textarea {...register("note", { maxLength: { value: 20_000, message: t("validation.maxLength", { max: 20_000 }) } })} rows={2} maxLength={20_000} />
              </Field>
            </div>

            <div className="relative border-b border-border p-4 lg:p-5">
              <SearchInput aria-label={t("fields.searchInventory")} loading={searching} value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder={t("fields.searchInventory")} />
              {itemQuery.trim().length >= 2 ? (
                <div className="absolute inset-x-4 top-[calc(100%-14px)] z-20 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg lg:inset-x-5">
                  {itemResults.length ? itemResults.map((resource) => (
                    <button key={resource.id} type="button" onClick={() => addItem(resource)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-surface-hover">
                      <span><span className="block text-sm font-semibold text-foreground">{resource.name}</span><span className="text-xs text-muted">{resource.sku || t("fields.noSku")} · {resource.quantity} {t("fields.available")}</span></span>
                      <Plus className="size-4 text-brand" />
                    </button>
                  )) : <p className="px-3 py-4 text-center text-sm text-muted">{t("empty.noInventory")}</p>}
                </div>
              ) : null}
            </div>

            <div className="divide-y divide-border">
              {lineFields.map((line, index) => (
                <div key={line.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(180px,1fr)_110px_140px_minmax(160px,1fr)_auto] sm:items-end lg:p-5">
                  <div className="min-w-0 self-center"><p className="truncate text-sm font-semibold text-foreground">{line.resourceName}</p><p className="truncate text-xs text-muted">{line.resourceSku || t("fields.noSku")}</p></div>
                  <Field label={t("fields.quantity")} error={formErrors.lines?.[index]?.quantity?.message} required><NumberInput min="1" step="1" inputMode="numeric" {...register(`lines.${index}.quantity`, { required: t("validation.quantityRequired"), validate: (value) => Number.isInteger(Number(value)) && Number(value) >= 1 || t("validation.quantityInvalid") })} /></Field>
                  {type === "sale" ? <Field label={t("fields.unitPrice")} error={formErrors.lines?.[index]?.unitPrice?.message}><CurrencyInput currency={line.currency} {...register(`lines.${index}.unitPrice`, { validate: (value) => !value.trim() || Number.isFinite(Number(value.replace(",", "."))) && Number(value.replace(",", ".")) >= 0 || t("validation.priceInvalid") })} className="tabular-nums" /></Field> : <span />}
                  <Field label={t("fields.lineNote")} error={formErrors.lines?.[index]?.note?.message}><Input {...register(`lines.${index}.note`, { maxLength: { value: 20_000, message: t("validation.maxLength", { max: 20_000 }) } })} /></Field>
                  <IconButton variant="danger" onClick={() => removeLine(index)} aria-label={t("actions.removeLine", { name: line.resourceName })}><X className="size-4" /></IconButton>
                </div>
              ))}
              {!lineFields.length ? <EmptyState className="min-h-40" icon={<Package className="size-5" />} title={t("empty.linesTitle")} description={t("empty.linesDescription")} /> : null}
            </div>
            <FormActions className="p-4 lg:px-5">
              <Button type="button" variant="ghost" onClick={() => { resetForm(); setFormOpen(false); }}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={saving || !contacts.length || !lineFields.length}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{t("actions.create")}</Button>
            </FormActions>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        ) : orders.length ? (
          <div className="divide-y divide-border">
            {orders.map((order) => {
              const open = expanded.has(order.id) || orders.length <= 3;
              return (
                <article key={order.id}>
                  <button type="button" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(order.id)) next.delete(order.id); else next.add(order.id); return next; })} className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left hover:bg-surface-hover sm:px-5">
                    <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm text-foreground">{order.contactName}</strong><Badge tone={statusTone(order.status)}>{t(`status.${order.status}`)}</Badge></span><span className="mt-1 block text-xs text-muted">{order.reference || order.id.slice(0, 8)} · {formatDate(order.orderedAt, locale)}{order.expectedAt ? ` · ${t("list.due", { date: formatDate(order.expectedAt, locale) })}` : ""}</span></span>
                    <span className="flex shrink-0 items-center gap-3"><span className="text-xs text-muted">{t("list.progress", { fulfilled: order.totalFulfilled, total: order.totalQuantity })}</span>{open ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}</span>
                  </button>
                  {open ? (
                    <div className="border-t border-border bg-surface-subtle">
                      {order.note ? <p className="border-b border-border px-5 py-3 text-xs text-muted">{order.note}</p> : null}
                      <div className="divide-y divide-border">
                        {order.lines.map((line) => {
                          const canIssue =
                            line.openQuantity > 0 &&
                            (type === "sale"
                              ? ["confirmed", "partially-fulfilled"].includes(order.status)
                              : ["reserved", "partially-issued"].includes(order.status));
                          const canReturn =
                            line.openReturnQuantity > 0 &&
                            (type === "sale"
                              ? ["partially-fulfilled", "fulfilled", "partially-returned"].includes(order.status)
                              : ["partially-issued", "issued", "partially-returned", "overdue"].includes(order.status));
                          const canReserve =
                            line.openReservationQuantity > 0 &&
                            (type === "sale"
                              ? ["confirmed", "partially-fulfilled"].includes(order.status)
                              : ["reserved", "partially-issued"].includes(order.status));
                          const maximum = Math.max(
                            canIssue ? line.openQuantity : 0,
                            canReturn ? line.openReturnQuantity : 0,
                          );
                          const unitPanelOpen = unitPanelLineId === line.id;
                          const selectedUnitId = selectedUnitIds[line.id] ?? "";
                          return (
                            <div key={line.id} className="bg-surface">
                              <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(210px,1fr)_110px_110px_100px_minmax(220px,auto)] lg:items-center">
                                <div className="min-w-0">
                                  <Link href={`/inventory/${line.resourceId}/stock`} className="truncate text-sm font-semibold text-foreground hover:text-brand">
                                    {line.resourceName}
                                  </Link>
                                  <p className="mt-0.5 text-xs text-muted">
                                    {line.resourceSku || t("fields.noSku")} · {line.trackingMode === "serialized" ? t("tracking.serialized") : line.unitName}
                                  </p>
                                  {line.trackingMode === "serialized" && line.units.length ? (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      {line.units.map((unit) => (
                                        <Badge key={unit.id} tone={statusTone(unit.status)}>
                                          {unit.code} · {t(`status.${unit.status}`)}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                <p className="text-xs text-muted">
                                  <span className="block text-[11px] font-semibold uppercase">{t("list.issued")}</span>
                                  <strong className="text-sm text-foreground">{line.fulfilledQuantity} / {line.quantity}</strong>
                                </p>
                                <p className="text-xs text-muted">
                                  <span className="block text-[11px] font-semibold uppercase">{t("list.returned")}</span>
                                  <strong className="text-sm text-foreground">{line.returnedQuantity} / {line.fulfilledQuantity}</strong>
                                </p>
                                {line.unitPriceCents !== null && line.priceCurrency ? (
                                  <p className="text-sm font-semibold text-foreground">
                                    {new Intl.NumberFormat(locale, { style: "currency", currency: line.priceCurrency }).format(line.unitPriceCents / 100)}
                                  </p>
                                ) : <span />}
                                <div className="flex flex-wrap justify-end gap-2">
                                  {line.trackingMode === "serialized" ? (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      disabled={unitPanelLoading && unitPanelOpen}
                                      onClick={() => void openUnitPanel(order, line)}
                                    >
                                      {unitPanelLoading && unitPanelOpen ? <LoaderCircle className="size-3.5 animate-spin" /> : <Package className="size-3.5" />}
                                      {t("actions.manageUnits")}
                                    </Button>
                                  ) : null}
                                  {line.trackingMode === "bulk" && (canIssue || canReturn) ? <NumberInput aria-label={t("fields.movementQuantity")} min="1" max={maximum} step="1" inputMode="numeric" value={movementQuantities[line.id] ?? ""} onChange={(event) => setMovementQuantities((current) => ({ ...current, [line.id]: event.target.value }))} placeholder={String(maximum)} className="w-20" /> : null}
                                  {line.trackingMode === "bulk" && canIssue ? <Button size="sm" variant="secondary" disabled={actingLineId === line.id} onClick={() => void move(order, line, "issue")}>{actingLineId === line.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUpFromLine className="size-3.5" />}{t("actions.issue")}</Button> : null}
                                  {line.trackingMode === "bulk" && canReturn ? <Button size="sm" variant="secondary" disabled={actingLineId === line.id} onClick={() => void move(order, line, "return")}>{actingLineId === line.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}{t("actions.return")}</Button> : null}
                                  {line.trackingMode === "bulk" && !canIssue && !canReturn ? <Badge tone={line.openQuantity === 0 ? "success" : "neutral"}>{line.openQuantity === 0 ? t("list.complete") : t("list.pending")}</Badge> : null}
                                </div>
                              </div>

                              {unitPanelOpen ? (
                                <div className="border-t border-border bg-surface-subtle px-4 py-4 sm:px-5">
                                  {unitPanelLoading ? (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <Skeleton className="h-28" />
                                      <Skeleton className="h-28" />
                                    </div>
                                  ) : unitPanel?.line.id === line.id ? (
                                    <div className="grid gap-4 lg:grid-cols-2">
                                      <section className="rounded-xl border border-border bg-surface p-4">
                                        <h3 className="text-sm font-semibold text-foreground">{t("units.availableTitle")}</h3>
                                        <p className="mt-1 text-xs text-muted">{t("units.availableDescription")}</p>
                                        {unitPanel.availableUnits.length ? (
                                          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                            <Select
                                              aria-label={t("fields.availableUnit")}
                                              value={selectedUnitId}
                                              onChange={(event) => setSelectedUnitIds((current) => ({ ...current, [line.id]: event.target.value }))}
                                              className="min-w-0 flex-1"
                                            >
                                              {unitPanel.availableUnits.map((unit) => (
                                                <option key={unit.id} value={unit.id}>
                                                  {unit.code}{unit.location ? ` · ${unit.location}` : ""}
                                                </option>
                                              ))}
                                            </Select>
                                            {canReserve ? (
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={!selectedUnitId || actingUnitKey !== null}
                                                onClick={() => void applyUnitAction(order, line, "reserve", selectedUnitId)}
                                              >
                                                {actingUnitKey === `${line.id}:${selectedUnitId}:reserve` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                                                {t("actions.reserve")}
                                              </Button>
                                            ) : null}
                                            {canIssue && line.openReservationQuantity > 0 ? (
                                              <Button
                                                size="sm"
                                                disabled={!selectedUnitId || actingUnitKey !== null}
                                                onClick={() => void applyUnitAction(order, line, "issue", selectedUnitId)}
                                              >
                                                {actingUnitKey === `${line.id}:${selectedUnitId}:issue` ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUpFromLine className="size-3.5" />}
                                                {t("actions.issue")}
                                              </Button>
                                            ) : null}
                                          </div>
                                        ) : (
                                          <p className="mt-3 text-sm text-muted">{t("units.noAvailable")}</p>
                                        )}
                                      </section>

                                      <section className="rounded-xl border border-border bg-surface p-4">
                                        <h3 className="text-sm font-semibold text-foreground">{t("units.assignedTitle")}</h3>
                                        <p className="mt-1 text-xs text-muted">{t("units.assignedDescription")}</p>
                                        {unitPanel.assignments.length ? (
                                          <div className="mt-3 divide-y divide-border">
                                            {unitPanel.assignments.map((unit) => (
                                              <div key={unit.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                                                <span className="min-w-0">
                                                  <strong className="block truncate text-sm text-foreground">{unit.code}</strong>
                                                  <span className="text-xs text-muted">{t(`status.${unit.status}`)}</span>
                                                </span>
                                                <span className="flex flex-wrap gap-2">
                                                  {unit.status === "reserved" && canIssue ? (
                                                    <Button size="sm" disabled={actingUnitKey !== null} onClick={() => void applyUnitAction(order, line, "issue", unit.stockUnitId)}>
                                                      {actingUnitKey === `${line.id}:${unit.stockUnitId}:issue` ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowUpFromLine className="size-3.5" />}
                                                      {t("actions.issue")}
                                                    </Button>
                                                  ) : null}
                                                  {unit.status === "reserved" ? (
                                                    <Button size="sm" variant="ghost" disabled={actingUnitKey !== null} onClick={() => void applyUnitAction(order, line, "release", unit.stockUnitId)}>
                                                      {actingUnitKey === `${line.id}:${unit.stockUnitId}:release` ? <LoaderCircle className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                                                      {t("actions.release")}
                                                    </Button>
                                                  ) : null}
                                                  {unit.status === "fulfilled" && canReturn ? (
                                                    <Button size="sm" variant="secondary" disabled={actingUnitKey !== null} onClick={() => void applyUnitAction(order, line, "return", unit.stockUnitId)}>
                                                      {actingUnitKey === `${line.id}:${unit.stockUnitId}:return` ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                                                      {t("actions.return")}
                                                    </Button>
                                                  ) : null}
                                                  {unit.status === "returned" ? <Badge tone="success">{t("status.returned")}</Badge> : null}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="mt-3 text-sm text-muted">{t("units.noAssigned")}</p>
                                        )}
                                      </section>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {type === "sale" ? (
                        <SalesShipments
                          order={order}
                          locale={locale}
                          onChanged={() => load(true)}
                          reportError={setError}
                          reportNotice={setNotice}
                        />
                      ) : null}
                      {!order.lines.some((line) => line.fulfilledQuantity > 0) && order.status !== "cancelled" ? <div className="flex justify-end border-t border-border px-5 py-3"><Button size="sm" variant="ghost" onClick={() => void cancel(order)}><X className="size-3.5" />{t("actions.cancelOrder")}</Button></div> : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState className="min-h-72" icon={<ArrowDownToLine className="size-5" />} title={t(`empty.${type}Title`)} description={t(`empty.${type}Description`)} action={<Button variant="secondary" onClick={() => setFormOpen(true)}><Plus className="size-4" />{t("actions.new")}</Button>} />
        )}
      </Card>
    </div>
  );
}

function SalesShipments({
  order,
  locale,
  onChanged,
  reportError,
  reportNotice,
}: {
  order: Order;
  locale: string;
  onChanged: () => Promise<void>;
  reportError: (message: string | null) => void;
  reportNotice: (message: string | null) => void;
}) {
  const { t } = useT("orders");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actingShipmentId, setActingShipmentId] = useState<string | null>(null);
  const [carrierCode, setCarrierCode] = useState("dhl");
  const [service, setService] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [note, setNote] = useState("");
  const createKey = useRef<string | null>(null);

  const activeShipments = order.shipments.filter(
    (shipment) => shipment.status !== "cancelled",
  );
  const packedByLine = new Map<string, number>();
  const packedUnitIds = new Set<string>();
  for (const shipment of activeShipments) {
    for (const line of shipment.lines) {
      packedByLine.set(
        line.orderLineId,
        (packedByLine.get(line.orderLineId) ?? 0) + line.quantity,
      );
      for (const unit of line.units) packedUnitIds.add(unit.stockUnitId);
    }
  }
  const shippableLines = order.lines.flatMap<{
    orderLineId: string;
    name: string;
    quantity: number;
    unitIds?: string[];
  }>((line) => {
    const remaining = Math.max(
      0,
      line.fulfilledQuantity -
        line.returnedQuantity -
        (packedByLine.get(line.id) ?? 0),
    );
    if (!remaining) return [];
    if (line.trackingMode === "serialized") {
      const unitIds = line.units
        .filter(
          (unit) =>
            unit.status === "fulfilled" && !packedUnitIds.has(unit.stockUnitId),
        )
        .slice(0, remaining)
        .map((unit) => unit.stockUnitId);
      return unitIds.length
        ? [{ orderLineId: line.id, name: line.resourceName, quantity: unitIds.length, unitIds }]
        : [];
    }
    return [{ orderLineId: line.id, name: line.resourceName, quantity: remaining }];
  });
  const shippableQuantity = shippableLines.reduce(
    (total, line) => total + line.quantity,
    0,
  );

  function resetForm() {
    setCarrierCode("dhl");
    setService("");
    setTrackingNumber("");
    setTrackingUrl("");
    setNote("");
    createKey.current = null;
  }

  async function createShipment() {
    if (!trackingNumber.trim() || !shippableLines.length) return;
    createKey.current ??= randomId();
    setSaving(true);
    reportError(null);
    reportNotice(null);
    try {
      await fetchJson(`/api/v1/orders/${order.id}/shipments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createKey.current,
        },
        body: JSON.stringify({
          carrierCode,
          service: service.trim() || undefined,
          trackingNumber: trackingNumber.trim(),
          trackingUrl: trackingUrl.trim() || undefined,
          status: "ready",
          note,
          lines: shippableLines.map((line) => ({
            orderLineId: line.orderLineId,
            quantity: line.quantity,
            ...(line.unitIds ? { unitIds: line.unitIds } : {}),
          })),
        }),
      });
      resetForm();
      setFormOpen(false);
      await onChanged();
      reportNotice(t("shipments.notices.created"));
    } catch (shipmentError) {
      reportError(
        shipmentError instanceof Error
          ? shipmentError.message
          : t("shipments.errors.create"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(shipment: Shipment, status: ShipmentStatus) {
    setActingShipmentId(shipment.id);
    reportError(null);
    reportNotice(null);
    try {
      await fetchJson(`/api/v1/orders/${order.id}/shipments/${shipment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await onChanged();
      reportNotice(t(`shipments.notices.${status}`));
    } catch (shipmentError) {
      reportError(
        shipmentError instanceof Error
          ? shipmentError.message
          : t("shipments.errors.update"),
      );
    } finally {
      setActingShipmentId(null);
    }
  }

  return (
    <section className="border-t border-border bg-surface-subtle px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Truck className="size-4 text-brand" aria-hidden="true" />
            {t("shipments.title")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {t("shipments.description")}
          </p>
        </div>
        {shippableQuantity > 0 && !["cancelled", "returned"].includes(order.status) ? (
          <Button
            size="sm"
            variant={formOpen ? "ghost" : "secondary"}
            onClick={() => setFormOpen((current) => !current)}
          >
            {formOpen ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {formOpen
              ? t("shipments.actions.close")
              : t("shipments.actions.create", { count: shippableQuantity })}
          </Button>
        ) : null}
      </div>

      {formOpen ? (
        <Card className="mt-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t("shipments.fields.carrier")} required>
              <Select value={carrierCode} onChange={(event) => setCarrierCode(event.target.value)}>
                {(["dhl", "dpd", "ups", "gls", "hermes", "other"] as const).map(
                  (carrier) => (
                    <option key={carrier} value={carrier}>
                      {t(`shipments.carriers.${carrier}`)}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label={t("shipments.fields.trackingNumber")} required>
              <Input
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                maxLength={180}
              />
            </Field>
            <Field label={t("shipments.fields.service")}>
              <Input
                value={service}
                onChange={(event) => setService(event.target.value)}
                maxLength={120}
                placeholder={t("shipments.fields.servicePlaceholder")}
              />
            </Field>
            <Field label={t("shipments.fields.trackingUrl")}>
              <Input
                type="url"
                value={trackingUrl}
                onChange={(event) => setTrackingUrl(event.target.value)}
                maxLength={2048}
                placeholder="https://…"
              />
            </Field>
            <Field label={t("shipments.fields.note")} className="sm:col-span-2 lg:col-span-4">
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={20_000}
              />
            </Field>
          </div>
          <div className="mt-4 rounded-xl border border-border bg-surface-subtle p-3">
            <p className="text-xs font-semibold text-foreground">
              {t("shipments.included")}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {shippableLines.map((line) => (
                <li key={line.orderLineId}>
                  {line.quantity} × {line.name}
                  {line.unitIds?.length
                    ? ` · ${line.unitIds
                        .map(
                          (unitId) =>
                            order.lines
                              .find((orderLine) => orderLine.id === line.orderLineId)
                              ?.units.find((unit) => unit.stockUnitId === unitId)?.code ??
                            unitId,
                        )
                        .join(", ")}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
          <FormActions className="mt-4">
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              {t("actions.cancel")}
            </Button>
            <Button
              type="button"
              disabled={saving || !trackingNumber.trim()}
              onClick={() => void createShipment()}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("shipments.actions.saveReady")}
            </Button>
          </FormActions>
        </Card>
      ) : null}

      {order.shipments.length ? (
        <div className="mt-4 grid gap-3">
          {order.shipments.map((shipment) => (
            <article key={shipment.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-foreground">
                      {t(`shipments.carriers.${shipment.carrierCode}`, {
                        defaultValue: shipment.carrierCode.toUpperCase(),
                      })}
                      {shipment.service ? ` · ${shipment.service}` : ""}
                    </strong>
                    <Badge tone={statusTone(shipment.status)}>
                      {t(`status.${shipment.status}`)}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    {shipment.trackingNumber ? (
                      shipment.trackingUrl ? (
                        <a
                          href={shipment.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                        >
                          {shipment.trackingNumber}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span>{shipment.trackingNumber}</span>
                      )
                    ) : null}
                    <span>
                      {t("shipments.quantity", { count: shipment.totalQuantity })}
                    </span>
                    <span>
                      {shipment.shippedAt
                        ? t("shipments.shippedAt", {
                            date: formatDateTime(shipment.shippedAt, locale),
                          })
                        : t("shipments.createdAt", {
                            date: formatDateTime(shipment.createdAt, locale),
                          })}
                    </span>
                    {shipment.deliveredAt ? (
                      <span>
                        {t("shipments.deliveredAt", {
                          date: formatDateTime(shipment.deliveredAt, locale),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {shipment.status === "ready" ? (
                    <Button
                      size="sm"
                      disabled={actingShipmentId !== null}
                      onClick={() => void updateStatus(shipment, "shipped")}
                    >
                      {actingShipmentId === shipment.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />}
                      {t("shipments.actions.markShipped")}
                    </Button>
                  ) : null}
                  {shipment.status === "shipped" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actingShipmentId !== null}
                      onClick={() => void updateStatus(shipment, "in_transit")}
                    >
                      {actingShipmentId === shipment.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />}
                      {t("shipments.actions.markInTransit")}
                    </Button>
                  ) : null}
                  {["shipped", "in_transit", "exception"].includes(shipment.status) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actingShipmentId !== null}
                      onClick={() => void updateStatus(shipment, "delivered")}
                    >
                      {actingShipmentId === shipment.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      {t("shipments.actions.markDelivered")}
                    </Button>
                  ) : null}
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {shipment.lines.map((line) => (
                  <li key={line.id}>
                    {line.quantity} × {line.resourceName}
                    {line.units.length
                      ? ` · ${line.units.map((unit) => unit.code).join(", ")}`
                      : ""}
                  </li>
                ))}
              </ul>
              {shipment.note ? (
                <p className="mt-3 text-xs leading-5 text-muted">{shipment.note}</p>
              ) : null}
              {shipment.events.length ? (
                <details className="mt-3 border-t border-border pt-3 text-xs text-muted">
                  <summary className="cursor-pointer font-semibold text-foreground">
                    {t("shipments.history", { count: shipment.events.length })}
                  </summary>
                  <ol className="mt-2 space-y-1.5">
                    {[...shipment.events].reverse().map((event) => (
                      <li key={event.id}>
                        {formatDateTime(event.occurredAt, locale)} · {t(`status.${event.toStatus}`)}
                        {event.note ? ` · ${event.note}` : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          {shippableQuantity
            ? t("shipments.emptyReady")
            : t("shipments.emptyUnfulfilled")}
        </p>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof Truck; label: string; value: number; warning?: boolean }) {
  return (
    <Card className={cn("p-5", warning && "border-warning-border bg-warning-soft")}>
      <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted">{label}</span><Icon className={cn("size-5", warning ? "text-warning" : "text-brand")} /></div>
      <p className="mt-4 text-2xl font-semibold text-foreground">{value}</p>
    </Card>
  );
}
