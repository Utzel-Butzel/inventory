"use client";

import {
  CalendarClock,
  ClockAlert,
  HandCoins,
  History,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Search,
  Undo2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "next-i18next/client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { Badge, Button, Card, EmptyState, cn } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

type LoanFilter = "active" | "overdue" | "reservations" | "history";

type Loan = {
  id: string;
  resourceId: string;
  stockUnitId: string | null;
  kind: "checkout" | "reservation";
  status: "active" | "returned" | "cancelled";
  stockApplied: boolean;
  overdue: boolean;
  quantity: number;
  assignee: {
    type: "user" | "resource" | "label";
    id: string | null;
    label: string;
    detail: string | null;
  };
  stockUnit: { id: string; code: string; status: string | null } | null;
  startsAt: string;
  dueAt: string | null;
  completedAt: string | null;
  note: string;
  resource: {
    id: string;
    name: string;
    sku: string | null;
    status: string;
  };
  trackingMode: "bulk" | "serialized";
};

type LoansResponse = {
  assignments: Loan[];
  capabilities: { canManage: boolean };
};

const newIdempotencyKey = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export function LoansOverview() {
  const { t, i18n } = useT("loans");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [data, setData] = useState<LoansResponse | null>(null);
  const [filter, setFilter] = useState<LoanFilter>("active");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutationKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await fetchJson<LoansResponse>("/api/v1/loans?limit=500", {
          cache: "no-store",
        }),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const assignments = data?.assignments ?? [];
    return {
      active: assignments.filter(
        (loan) =>
          loan.kind === "checkout" && loan.status === "active" && !loan.overdue,
      ).length,
      overdue: assignments.filter((loan) => loan.overdue).length,
      reservations: assignments.filter(
        (loan) => loan.kind === "reservation" && loan.status === "active",
      ).length,
      history: assignments.filter((loan) => loan.status !== "active").length,
    };
  }, [data]);

  const visibleLoans = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return (data?.assignments ?? []).filter((loan) => {
      const matchesFilter =
        filter === "active"
          ? loan.kind === "checkout" && loan.status === "active" && !loan.overdue
          : filter === "overdue"
            ? loan.overdue
            : filter === "reservations"
              ? loan.kind === "reservation" && loan.status === "active"
              : loan.status !== "active";
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return [
        loan.resource.name,
        loan.resource.sku,
        loan.assignee.label,
        loan.assignee.detail,
        loan.stockUnit?.code,
        loan.note,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLocaleLowerCase(locale).includes(normalizedQuery),
        );
    });
  }, [data, filter, locale, query]);

  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : "—";

  async function complete(loan: Loan, status: "returned" | "cancelled") {
    const operation = `${loan.id}:${status}`;
    const key = mutationKeys.current.get(operation) ?? newIdempotencyKey();
    mutationKeys.current.set(operation, key);
    setActingId(loan.id);
    setError(null);
    try {
      await fetchJson(`/api/v1/assignments/${loan.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ status }),
      });
      mutationKeys.current.delete(operation);
      await load();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : t("errors.update"),
      );
    } finally {
      setActingId(null);
    }
  }

  const filters: Array<{
    key: LoanFilter;
    icon: typeof HandCoins;
    count: number;
  }> = [
    { key: "active", icon: HandCoins, count: counts.active },
    { key: "overdue", icon: ClockAlert, count: counts.overdue },
    { key: "reservations", icon: CalendarClock, count: counts.reservations },
    { key: "history", icon: History, count: counts.history },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {t("title")}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            {t("description")}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {t("refresh")}
        </Button>
      </header>

      {error ? (
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {filters.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={cn(
                "rounded-2xl border p-4 text-left transition",
                filter === item.key
                  ? "border-brand bg-brand-soft shadow-sm"
                  : "border-border bg-surface hover:bg-surface-subtle",
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <Icon className="size-5 text-muted-strong" aria-hidden="true" />
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {item.count}
                </span>
              </span>
              <span className="mt-3 block text-sm font-semibold text-foreground">
                {t(`filters.${item.key}`)}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border p-4 sm:p-5">
          <label className="relative block max-w-lg">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search")}
              className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-success focus:ring-4 focus:ring-success-border"
            />
          </label>
        </div>

        {loading && !data ? (
          <div className="grid min-h-72 place-items-center text-muted">
            <LoaderCircle className="size-6 animate-spin" aria-label={t("loading")} />
          </div>
        ) : visibleLoans.length ? (
          <div className="divide-y divide-border">
            {visibleLoans.map((loan) => (
              <article key={loan.id} className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/inventory/${loan.resource.id}`} className="font-semibold text-foreground hover:text-brand">
                      {loan.resource.name}
                    </Link>
                    <Badge tone={loan.overdue ? "danger" : loan.kind === "reservation" ? "warning" : loan.status === "returned" ? "success" : "neutral"}>
                      {loan.overdue
                        ? t("status.overdue")
                        : t(`status.${loan.kind === "reservation" && loan.status === "active" ? "reserved" : loan.status}`)}
                    </Badge>
                    {loan.stockUnit ? <Badge>{loan.stockUnit.code}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-strong">
                    {loan.assignee.label}
                    {loan.assignee.detail ? ` · ${loan.assignee.detail}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>{t("quantity", { count: loan.quantity })}</span>
                    <span>{formatDate(loan.startsAt)}</span>
                    {loan.dueAt ? <span>{t("due", { date: formatDate(loan.dueAt) })}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {data?.capabilities.canManage && loan.status === "active" ? (
                    loan.kind === "checkout" ? (
                      <Button size="sm" variant="secondary" onClick={() => void complete(loan, "returned")} disabled={actingId === loan.id}>
                        {actingId === loan.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
                        {t("actions.return")}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => void complete(loan, "cancelled")} disabled={actingId === loan.id}>
                        <XCircle className="size-3.5" />
                        {t("actions.cancel")}
                      </Button>
                    )
                  ) : null}
                  <Link
                    href={`/inventory/${loan.resource.id}`}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-transparent px-3 text-[14px] font-medium text-muted-strong transition hover:bg-surface-muted hover:text-foreground"
                  >
                    {loan.kind === "reservation" && loan.status === "active"
                      ? t("actions.checkoutAtItem")
                      : t("actions.open")}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            className="min-h-72"
            icon={<PackageCheck className="size-5" />}
            title={t("empty.title")}
            description={query ? t("empty.filtered") : t(`empty.${filter}`)}
          />
        )}
      </Card>
    </div>
  );
}
