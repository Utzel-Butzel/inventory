"use client";

import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MapPin,
  PackageOpen,
  UserRound,
} from "lucide-react";
import { useT } from "next-i18next/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { Badge, Button, Card, EmptyState, cn } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

type CalendarEntry = {
  id: string;
  source: "internal-request" | "reservation";
  sourceId: string;
  reference: string | null;
  status: "submitted" | "approved" | "fulfilled" | "reserved";
  title: string;
  subtitle: string;
  resourceId: string;
  quantity: number;
  startsAt: string;
  dueAt: string | null;
};

type CalendarResponse = {
  entries: CalendarEntry[];
  range: { from: string; to: string };
};

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function startOfCalendarGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - mondayOffset);
  return first;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function overlapsDay(entry: CalendarEntry, day: Date) {
  const nextDay = addDays(day, 1);
  return (
    new Date(entry.startsAt).getTime() < nextDay.getTime() &&
    (entry.dueAt === null || new Date(entry.dueAt).getTime() > day.getTime())
  );
}

function statusTone(status: CalendarEntry["status"]) {
  if (status === "approved") return "brand" as const;
  if (status === "fulfilled") return "success" as const;
  if (status === "submitted") return "warning" as const;
  return "neutral" as const;
}

function entryAccent(status: CalendarEntry["status"]) {
  if (status === "approved") return "border-l-brand bg-brand-soft/60 text-brand";
  if (status === "fulfilled") return "border-l-success bg-success-soft/60 text-success";
  if (status === "submitted") return "border-l-warning bg-warning-soft/60 text-warning";
  return "border-l-border-strong bg-surface-muted text-muted-strong";
}

export function ReservationCalendar() {
  const { t, i18n } = useT("requests");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const today = useMemo(() => startOfDay(new Date()), []);
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDay, setSelectedDay] = useState(today);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const gridStart = useMemo(() => startOfCalendarGrid(month), [month]);
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)),
    [gridStart],
  );
  const rangeEnd = useMemo(() => addDays(gridStart, 42), [gridStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const parameters = new URLSearchParams({
      from: gridStart.toISOString(),
      to: rangeEnd.toISOString(),
    });
    try {
      const response = await fetchJson<CalendarResponse>(
        `/api/v1/internal-requests/calendar?${parameters.toString()}`,
        { cache: "no-store" },
      );
      setEntries(response.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("calendar.error"));
    } finally {
      setLoading(false);
    }
  }, [gridStart, rangeEnd, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
          new Date(2024, 0, 1 + index),
        ),
      ),
    [locale],
  );
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
      }).format(month),
    [locale, month],
  );
  const selectedLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(selectedDay),
    [locale, selectedDay],
  );
  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => overlapsDay(entry, selectedDay)),
    [entries, selectedDay],
  );

  function changeMonth(offset: number) {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(nextMonth);
    setSelectedDay(nextMonth);
  }

  function goToToday() {
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(today);
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand">
          {t("calendar.eyebrow")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
          {t("calendar.title")}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
          {t("calendar.description")}
        </p>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => void load()} className="font-semibold hover:underline">
            {t("calendar.retry")}
          </button>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => changeMonth(-1)}
              aria-label={t("calendar.previous")}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="secondary" size="sm" onClick={goToToday}>
              {t("calendar.today")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => changeMonth(1)}
              aria-label={t("calendar.next")}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold capitalize text-foreground">{monthLabel}</h2>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
            {(["submitted", "approved", "fulfilled", "reserved"] as const).map(
              (status) => (
                <span key={status} className="inline-flex items-center gap-1.5 text-muted-strong">
                  <span className={cn("size-2 rounded-full", {
                    submitted: "bg-warning",
                    approved: "bg-brand-solid",
                    fulfilled: "bg-success",
                    reserved: "bg-border-strong",
                  }[status])} />
                  {t(`status.${status}`)}
                </span>
              ),
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[840px]">
            <div className="grid grid-cols-7 border-b border-border bg-surface-subtle">
              {weekdayLabels.map((label) => (
                <div key={label} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {label}
                </div>
              ))}
            </div>
            <div className="relative grid grid-cols-7">
              {days.map((day, dayIndex) => {
                const dayEntries = entries.filter((entry) => overlapsDay(entry, day));
                const selected = sameDay(day, selectedDay);
                const isToday = sameDay(day, today);
                const inMonth = day.getMonth() === month.getMonth();
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    aria-pressed={selected}
                    aria-label={new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(day)}
                    className={cn(
                      "min-h-32 border-b border-r border-border p-2 text-left align-top transition focus:z-10 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-focus",
                      dayIndex % 7 === 0 && "border-l-0",
                      !inMonth && "bg-surface-subtle/65",
                      selected && "bg-brand-soft/30 ring-1 ring-inset ring-brand-border",
                    )}
                  >
                    <span
                      className={cn(
                        "mb-2 grid size-6 place-items-center rounded-full text-[12px] font-semibold",
                        isToday
                          ? "bg-brand-solid text-on-brand"
                          : inMonth
                            ? "text-foreground"
                            : "text-muted",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    <span className="block space-y-1">
                      {dayEntries.slice(0, 3).map((entry) => (
                        <span
                          key={entry.id}
                          className={cn(
                            "block truncate rounded-md border-l-2 px-1.5 py-1 text-[11px] font-medium",
                            entryAccent(entry.status),
                          )}
                        >
                          {number.format(entry.quantity)} × {entry.title}
                        </span>
                      ))}
                      {dayEntries.length > 3 ? (
                        <span className="block px-1.5 text-[11px] font-semibold text-muted">
                          {t("calendar.more", { count: dayEntries.length - 3 })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
              {loading ? (
                <div className="absolute inset-0 grid place-items-center bg-surface/70 backdrop-blur-[1px]">
                  <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-xs font-semibold text-muted-strong shadow-lg">
                    <LoaderCircle className="size-4 animate-spin text-brand" />
                    {t("calendar.loading")}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
              {t("calendar.selected")}
            </p>
            <h2 className="mt-1 text-sm font-semibold capitalize text-foreground">{selectedLabel}</h2>
          </div>
          <Badge tone="neutral">{t("calendar.entryCount", { count: selectedEntries.length })}</Badge>
        </div>
        {selectedEntries.length ? (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 sm:p-5">
            {selectedEntries.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-border bg-surface-subtle p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{entry.title}</p>
                    <p className="mt-0.5 truncate text-[12px] text-muted">
                      {entry.reference ?? t("calendar.directReservation")}
                    </p>
                  </div>
                  <Badge tone={statusTone(entry.status)}>{t(`status.${entry.status}`)}</Badge>
                </div>
                <div className="mt-3 space-y-2 text-[12px] text-muted-strong">
                  <p className="flex items-center gap-2">
                    <Clock3 className="size-3.5 shrink-0 text-muted" />
                    <span>{formatDateTime(entry.startsAt)} – {entry.dueAt ? formatDateTime(entry.dueAt) : t("calendar.noEnd")}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    {entry.source === "internal-request" ? <MapPin className="size-3.5 shrink-0 text-muted" /> : <UserRound className="size-3.5 shrink-0 text-muted" />}
                    <span className="truncate">{entry.subtitle}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <PackageOpen className="size-3.5 shrink-0 text-muted" />
                    {t("calendar.quantity", { count: entry.quantity })}
                  </p>
                </div>
                <Link
                  href={entry.source === "internal-request" ? "/requests" : `/inventory/${entry.resourceId}/stock`}
                  className="mt-4 inline-flex text-xs font-semibold text-brand hover:underline"
                >
                  {entry.source === "internal-request" ? t("calendar.openRequest") : t("calendar.openStock")}
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            className="min-h-56"
            icon={<CalendarDays className="size-5" />}
            title={t("calendar.emptyTitle")}
            description={t("calendar.emptyDescription")}
          />
        )}
      </Card>
    </div>
  );
}
