"use client";

import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShoppingBasket,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Alert, Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type RequestStatus =
  | "submitted"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";
type RequestAction = "approve" | "reject" | "cancel" | "fulfill";
type RequestFilter = "active" | "all" | RequestStatus;

type InternalRequest = {
  id: string;
  reference: string;
  status: RequestStatus;
  requester: { userId: string | null; name: string; email: string | null };
  delivery: { resourceId: string; name: string } | null;
  startsAt: string;
  dueAt: string;
  note: string;
  decisionNote: string;
  decidedBy: string | null;
  decidedAt: string | null;
  fulfilledBy: string | null;
  fulfilledAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  canCancel: boolean;
  lines: Array<{
    id: string;
    resource: {
      id: string;
      name: string;
      sku: string | null;
      status: string;
      currentQuantity: number;
      trackingMode: "bulk" | "serialized";
    };
    quantity: number;
    note: string;
  }>;
  events: Array<{
    id: string;
    type: RequestStatus;
    actor: string;
    note: string;
    occurredAt: string;
  }>;
};

type RequestsResponse = {
  requests: InternalRequest[];
  capabilities: { canCreate: boolean; canManage: boolean };
};

type DraftLine = {
  resourceId: string;
  name: string;
  sku: string | null;
  quantity: string;
  note: string;
};

const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const labelClass = "block text-[12px] font-semibold text-muted-strong";

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultWindow() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const due = new Date(start);
  due.setHours(17, 0, 0, 0);
  return { startsAt: localDateTime(start), dueAt: localDateTime(due) };
}

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function statusTone(status: RequestStatus) {
  if (status === "approved") return "brand" as const;
  if (status === "fulfilled") return "success" as const;
  if (status === "submitted") return "warning" as const;
  if (status === "rejected") return "danger" as const;
  return "neutral" as const;
}

function requestMatchesFilter(request: InternalRequest, filter: RequestFilter) {
  if (filter === "all") return true;
  if (filter === "active") {
    return request.status === "submitted" || request.status === "approved";
  }
  return request.status === filter;
}

export function InternalRequestsClient() {
  const { t, i18n } = useT("requests");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [requests, setRequests] = useState<InternalRequest[]>([]);
  const [capabilities, setCapabilities] = useState({ canCreate: false, canManage: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<RequestFilter>("active");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);

  const [initialWindow] = useState(defaultWindow);
  const [startsAt, setStartsAt] = useState(initialWindow.startsAt);
  const [dueAt, setDueAt] = useState(initialWindow.dueAt);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [delivery, setDelivery] = useState<ClientResource | null>(null);
  const [deliveryQuery, setDeliveryQuery] = useState("");
  const [deliveryResults, setDeliveryResults] = useState<ClientResource[]>([]);
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<ClientResource[]>([]);
  const [searching, setSearching] = useState<"items" | "delivery" | null>(null);
  const [creating, setCreating] = useState(false);
  const createRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<RequestsResponse>(
        "/api/v1/internal-requests?limit=200",
        { cache: "no-store" },
      );
      setRequests(response.requests);
      setCapabilities(response.capabilities);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!createOpen || !capabilities.canCreate) {
      setItemResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching("items");
      const parameters = new URLSearchParams({
        page: "1",
        pageSize: "8",
        loanable: "true",
      });
      if (itemQuery.trim()) parameters.set("q", itemQuery.trim());
      void fetchJson<{ resources: ClientResource[] }>(
        `/api/v1/resources?${parameters.toString()}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then((result) =>
          setItemResults(
            result.resources.filter(
              (resource) =>
                resource.status !== "archived" &&
                !lines.some((line) => line.resourceId === resource.id),
            ),
          ),
        )
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setSearching(null);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [capabilities.canCreate, createOpen, itemQuery, lines]);

  useEffect(() => {
    if (!createOpen || !capabilities.canCreate || !deliveryQuery.trim()) {
      setDeliveryResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching("delivery");
      const parameters = new URLSearchParams({
        page: "1",
        pageSize: "8",
        q: deliveryQuery.trim(),
      });
      void fetchJson<{ resources: ClientResource[] }>(
        `/api/v1/resources?${parameters.toString()}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then((result) =>
          setDeliveryResults(
            result.resources.filter((resource) => resource.status !== "archived"),
          ),
        )
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setSearching(null);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [capabilities.canCreate, createOpen, deliveryQuery]);

  const filteredRequests = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return requests.filter((request) => {
      if (!requestMatchesFilter(request, filter)) return false;
      if (!normalizedQuery) return true;
      return [
        request.reference,
        request.requester.name,
        request.delivery?.name,
        ...request.lines.map((line) => line.resource.name),
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLocaleLowerCase(locale).includes(normalizedQuery),
        );
    });
  }, [filter, locale, query, requests]);

  const formatDate = (value: string, includeTime = true) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      ...(includeTime ? { timeStyle: "short" } : {}),
    }).format(new Date(value));

  function resetCreateForm() {
    const window = defaultWindow();
    setStartsAt(window.startsAt);
    setDueAt(window.dueAt);
    setNote("");
    setLines([]);
    setDelivery(null);
    setDeliveryQuery("");
    setItemQuery("");
    createRequestRef.current = null;
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lines.length) {
      setError(t("errors.linesRequired"));
      return;
    }
    const payload = {
      startsAt: new Date(startsAt).toISOString(),
      dueAt: new Date(dueAt).toISOString(),
      deliveryResourceId: delivery?.id ?? null,
      note: note.trim(),
      lines: lines.map((line) => ({
        resourceId: line.resourceId,
        quantity: Number(line.quantity),
        note: line.note.trim(),
      })),
    };
    const fingerprint = JSON.stringify(payload);
    const requestIdentity =
      createRequestRef.current?.fingerprint === fingerprint
        ? createRequestRef.current
        : { fingerprint, key: newIdempotencyKey() };
    createRequestRef.current = requestIdentity;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson("/api/v1/internal-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestIdentity.key,
        },
        body: JSON.stringify(payload),
      });
      createRequestRef.current = null;
      resetCreateForm();
      setCreateOpen(false);
      setNotice(t("notices.created"));
      await load(true);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("errors.create"));
    } finally {
      setCreating(false);
    }
  }

  async function act(request: InternalRequest, action: RequestAction) {
    if (
      (action === "fulfill" && !window.confirm(t("confirm.fulfill", { reference: request.reference }))) ||
      (action === "reject" && !window.confirm(t("confirm.reject", { reference: request.reference }))) ||
      (action === "cancel" && !window.confirm(t("confirm.cancel", { reference: request.reference })))
    ) {
      return;
    }
    setActing(`${request.id}:${action}`);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/v1/internal-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setNotice(t(`notices.${action}`));
      await load(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("errors.action"));
    } finally {
      setActing(null);
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            {t("description")}
          </p>
        </div>
        {capabilities.canCreate ? (
          <Button onClick={() => setCreateOpen((open) => !open)}>
            {createOpen ? <X className="size-4" /> : <Plus className="size-4" />}
            {createOpen ? t("actions.close") : t("actions.new")}
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}
      {notice ? (
        <Alert tone="success">{notice}</Alert>
      ) : null}

      {createOpen ? (
        <Card className="overflow-hidden">
          <div className="border-b border-border px-5 py-4 sm:px-6">
            <h2 className="font-semibold text-foreground">{t("create.title")}</h2>
            <p className="mt-1 text-xs text-muted">{t("create.description")}</p>
          </div>
          <form onSubmit={(event) => void submitRequest(event)} className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  {t("form.startsAt")}
                  <input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={cn(inputClass, "mt-1.5")} disabled={creating} />
                </label>
                <label className={labelClass}>
                  {t("form.dueAt")}
                  <input required type="datetime-local" min={startsAt} value={dueAt} onChange={(event) => setDueAt(event.target.value)} className={cn(inputClass, "mt-1.5")} disabled={creating} />
                </label>
              </div>

              <div>
                <label className={labelClass} htmlFor="request-delivery-search">
                  {t("form.delivery")}
                </label>
                {delivery ? (
                  <div className="mt-1.5 flex items-center justify-between rounded-xl border border-border bg-surface-subtle px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                      <MapPin className="size-4 shrink-0 text-brand" />
                      <span className="truncate">{delivery.name}</span>
                    </span>
                    <button type="button" onClick={() => setDelivery(null)} className="rounded-lg p-1 text-muted hover:bg-surface-muted hover:text-foreground" aria-label={t("form.removeDelivery")}>
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative mt-1.5">
                    <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
                    <input id="request-delivery-search" value={deliveryQuery} onChange={(event) => setDeliveryQuery(event.target.value)} placeholder={t("form.deliveryPlaceholder")} className={cn(inputClass, "pl-9")} />
                    {deliveryQuery.trim() ? (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                        {searching === "delivery" ? (
                          <div className="grid h-16 place-items-center"><LoaderCircle className="size-4 animate-spin text-muted" /></div>
                        ) : deliveryResults.length ? deliveryResults.map((resource) => (
                          <button key={resource.id} type="button" onClick={() => { setDelivery(resource); setDeliveryQuery(""); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted">
                            <span className="truncate font-medium text-foreground">{resource.name}</span>
                            <span className="shrink-0 text-[11px] text-muted">{resource.type}</span>
                          </button>
                        )) : (
                          <p className="px-3 py-4 text-center text-xs text-muted">{t("form.noDeliveryResults")}</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <label className={labelClass}>
                {t("form.note")}
                <textarea rows={3} maxLength={20_000} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("form.notePlaceholder")} className={cn(inputClass, "mt-1.5 h-auto resize-y py-2.5")} disabled={creating} />
              </label>
            </div>

            <aside className="space-y-3 rounded-2xl border border-border bg-surface-subtle/60 p-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{t("form.items")}</h3>
                <p className="mt-1 text-[12px] text-muted">{t("form.itemsDescription")}</p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
                <input value={itemQuery} onChange={(event) => setItemQuery(event.target.value)} placeholder={t("form.itemSearch")} className={cn(inputClass, "pl-9")} />
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {searching === "items" ? (
                  <div className="grid h-16 place-items-center"><LoaderCircle className="size-4 animate-spin text-muted" /></div>
                ) : itemResults.map((resource) => (
                  <button key={resource.id} type="button" onClick={() => { setLines((current) => [...current, { resourceId: resource.id, name: resource.name, sku: resource.sku, quantity: "1", note: "" }]); setItemQuery(""); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-muted">
                    <span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{resource.name}</span><span className="block truncate text-[11px] text-muted">{resource.sku || t("form.noSku")} · {number.format(resource.quantity)}</span></span>
                    <Plus className="size-4 shrink-0 text-brand" />
                  </button>
                ))}
              </div>
              {lines.length ? (
                <div className="space-y-2 border-t border-border pt-3">
                  {lines.map((line) => (
                    <div key={line.resourceId} className="rounded-xl border border-border bg-surface p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0"><p className="truncate text-xs font-semibold text-foreground">{line.name}</p><p className="mt-0.5 text-[11px] text-muted">{line.sku || t("form.noSku")}</p></div>
                        <button type="button" onClick={() => setLines((current) => current.filter((candidate) => candidate.resourceId !== line.resourceId))} className="rounded-lg p-1 text-muted hover:bg-danger-soft hover:text-danger" aria-label={t("form.removeItem", { name: line.name })}><Trash2 className="size-3.5" /></button>
                      </div>
                      <div className="mt-2 grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                        <input aria-label={t("form.quantity")} type="number" min={1} max={2_000_000_000} step={1} value={line.quantity} onChange={(event) => setLines((current) => current.map((candidate) => candidate.resourceId === line.resourceId ? { ...candidate, quantity: event.target.value } : candidate))} className={cn(inputClass, "h-9")} />
                        <input aria-label={t("form.lineNote")} maxLength={20_000} value={line.note} onChange={(event) => setLines((current) => current.map((candidate) => candidate.resourceId === line.resourceId ? { ...candidate, note: event.target.value } : candidate))} placeholder={t("form.lineNotePlaceholder")} className={cn(inputClass, "h-9")} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted">{t("form.emptyItems")}</p>
              )}
              <Button type="submit" className="w-full" disabled={creating || !lines.length || !startsAt || !dueAt || new Date(dueAt) <= new Date(startsAt)}>
                {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                {t("actions.submit")}
              </Button>
            </aside>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filters.search")} className={cn(inputClass, "pl-9")} />
            </div>
            <select value={filter} onChange={(event) => setFilter(event.target.value as RequestFilter)} className={cn(inputClass, "w-auto min-w-32")} aria-label={t("filters.label")}>
              {(["active", "all", "submitted", "approved", "fulfilled", "rejected", "cancelled"] as const).map((value) => <option key={value} value={value}>{t(`filters.${value}`)}</option>)}
            </select>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            {t("actions.refresh")}
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-32 w-full" />)}</div>
        ) : filteredRequests.length ? (
          <div className="divide-y divide-border">
            {filteredRequests.map((request) => {
              const isExpanded = expanded.has(request.id);
              const isActing = acting?.startsWith(`${request.id}:`) ?? false;
              return (
                <article key={request.id} className="px-4 py-5 sm:px-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-muted-strong">{request.reference}</span>
                        <Badge tone={statusTone(request.status)}>{t(`status.${request.status}`)}</Badge>
                        <span className="text-xs text-muted">{t("list.lineCount", { count: request.lines.length })}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
                        <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5" />{request.requester.name}</span>
                        <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" />{formatDate(request.startsAt)} – {formatDate(request.dueAt)}</span>
                        {request.delivery ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{request.delivery.name}</span> : null}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {request.lines.slice(0, 4).map((line) => <span key={line.id} className="rounded-lg bg-surface-muted px-2.5 py-1 text-[12px] font-medium text-muted-strong">{number.format(line.quantity)} × {line.resource.name}</span>)}
                        {request.lines.length > 4 ? <span className="px-1 py-1 text-[12px] text-muted">+{request.lines.length - 4}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {capabilities.canManage && request.status === "submitted" ? <><Button size="sm" onClick={() => void act(request, "approve")} disabled={isActing}>{acting === `${request.id}:approve` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{t("actions.approve")}</Button><Button size="sm" variant="danger" onClick={() => void act(request, "reject")} disabled={isActing}>{t("actions.reject")}</Button></> : null}
                      {capabilities.canManage && request.status === "approved" ? <Button size="sm" onClick={() => void act(request, "fulfill")} disabled={isActing}>{acting === `${request.id}:fulfill` ? <LoaderCircle className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}{t("actions.fulfill")}</Button> : null}
                      {request.canCancel ? <Button size="sm" variant="ghost" onClick={() => void act(request, "cancel")} disabled={isActing}>{t("actions.cancel")}</Button> : null}
                      <Button size="sm" variant="secondary" onClick={() => toggleExpanded(request.id)}>{isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}{isExpanded ? t("actions.less") : t("actions.details")}</Button>
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                      <div className="space-y-2">
                        {request.lines.map((line) => (
                          <div key={line.id} className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{line.resource.name}</p><p className="mt-0.5 text-[12px] text-muted">{line.resource.sku || t("form.noSku")} · {t(`tracking.${line.resource.trackingMode}`)}{line.note ? ` · ${line.note}` : ""}</p></div>
                            <div className="text-left sm:text-right"><p className="text-sm font-semibold text-foreground">{number.format(line.quantity)}</p><p className="text-[11px] text-muted">{t("list.current", { count: line.resource.currentQuantity })}</p></div>
                          </div>
                        ))}
                        {request.note ? <p className="whitespace-pre-wrap rounded-xl bg-surface-muted px-3 py-2 text-xs leading-5 text-muted-strong">{request.note}</p> : null}
                      </div>
                      <ol className="space-y-3 border-l border-border pl-4">
                        {request.events.map((event) => (
                          <li key={event.id} className="relative text-xs"><span className="absolute -left-[21px] top-1 size-2 rounded-full bg-brand-solid" /><p className="font-semibold text-foreground">{t(`status.${event.type}`)}</p><p className="mt-0.5 text-[11px] text-muted">{formatDate(event.occurredAt)} · {event.actor}</p>{event.note ? <p className="mt-1 leading-5 text-muted-strong">{event.note}</p> : null}</li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState className="min-h-72" icon={<ShoppingBasket className="size-5" />} title={t("empty.title")} description={query || filter !== "active" ? t("empty.filtered") : t("empty.description")} />
        )}
      </Card>
    </div>
  );
}
