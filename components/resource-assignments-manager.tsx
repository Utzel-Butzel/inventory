"use client";

import {
  CalendarDays,
  Clock3,
  HandCoins,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Undo2,
  UserRound,
  XCircle,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

type AssignmentKind = "checkout" | "assignment" | "reservation";
type AssignmentStatus = "active" | "returned" | "cancelled";

type Assignment = {
  id: string;
  resourceId: string;
  stockUnitId: string | null;
  kind: AssignmentKind;
  status: AssignmentStatus;
  quantity: number;
  assignee: {
    type: "user" | "resource" | "label";
    id: string | null;
    label: string;
    detail: string | null;
  };
  stockUnit: {
    id: string;
    code: string;
    status: string | null;
  } | null;
  startsAt: string;
  dueAt: string | null;
  completedAt: string | null;
  note: string;
  createdBy: string | null;
  completedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type AssignmentData = {
  resource: { id: string; name: string; quantity: number };
  trackingMode: "bulk" | "serialized";
  availability: { availableQuantity: number; activeQuantity: number };
  availableUnits: Array<{
    id: string;
    code: string;
    status: string;
    location: string | null;
  }>;
  assignments: Assignment[];
};

type AssignmentForm = {
  kind: AssignmentKind;
  quantity: string;
  stockUnitId: string;
  recipient: string;
  startsAt: string;
  dueAt: string;
  note: string;
};

const emptyForm: AssignmentForm = {
  kind: "checkout",
  quantity: "1",
  stockUnitId: "",
  recipient: "",
  startsAt: "",
  dueAt: "",
  note: "",
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-success focus:ring-4 focus:ring-success-border disabled:bg-surface-muted disabled:text-muted";
const labelClass = "block text-xs font-semibold text-muted-strong";

const statusTone = (status: AssignmentStatus) => {
  if (status === "active") return "brand" as const;
  if (status === "returned") return "success" as const;
  return "neutral" as const;
};

const formatDate = (value: string | null, locale: string) =>
  value
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const newIdempotencyKey = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export function ResourceAssignmentsManager({
  resourceId,
  canEdit,
}: {
  resourceId: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useT("resource");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [data, setData] = useState<AssignmentData | null>(null);
  const [form, setForm] = useState<AssignmentForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const completionKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await fetchJson<AssignmentData>(
          `/api/v1/resources/${resourceId}/assignments`,
          { cache: "no-store" },
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("assignments.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [resourceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAssignments = useMemo(
    () => data?.assignments.filter((assignment) => assignment.status === "active") ?? [],
    [data],
  );
  const history = useMemo(
    () => data?.assignments.filter((assignment) => assignment.status !== "active") ?? [],
    [data],
  );

  const setField = (field: keyof AssignmentForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canEdit) return;
    const quantity = data.trackingMode === "serialized" ? 1 : Number(form.quantity);
    const payload = {
      kind: form.kind,
      quantity,
      ...(data.trackingMode === "serialized"
        ? { stockUnitId: form.stockUnitId }
        : {}),
      recipient: { type: "label" as const, label: form.recipient.trim() },
      ...(form.startsAt
        ? { startsAt: new Date(form.startsAt).toISOString() }
        : {}),
      ...(form.dueAt ? { dueAt: new Date(form.dueAt).toISOString() } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    };
    const fingerprint = JSON.stringify(payload);
    const idempotency =
      createRequest.current?.fingerprint === fingerprint
        ? createRequest.current
        : { fingerprint, key: newIdempotencyKey() };
    createRequest.current = idempotency;

    setSaving(true);
    setError(null);
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/assignments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotency.key,
        },
        body: JSON.stringify(payload),
      });
      createRequest.current = null;
      setForm(emptyForm);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("assignments.errors.create"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function completeAssignment(
    assignment: Assignment,
    status: "returned" | "cancelled",
  ) {
    const operation = `${assignment.id}:${status}`;
    const key = completionKeys.current.get(operation) ?? newIdempotencyKey();
    completionKeys.current.set(operation, key);
    setCompletingId(assignment.id);
    setError(null);
    try {
      await fetchJson(`/api/v1/assignments/${assignment.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ status }),
      });
      completionKeys.current.delete(operation);
      await load();
    } catch (completeError) {
      setError(
        completeError instanceof Error
          ? completeError.message
          : t("assignments.errors.complete"),
      );
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-8 sm:px-6 lg:px-8">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-solid text-on-brand">
              <HandCoins className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">
                {t("assignments.title")}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {t("assignments.description")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="grid size-10 place-items-center rounded-xl border border-border text-muted transition hover:bg-surface-subtle disabled:opacity-50"
            aria-label={t("assignments.refresh")}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error ? (
          <div role="alert" className="border-b border-danger-border bg-danger-soft px-5 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t("assignments.sections.active")}
              </h3>
              {data ? (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Badge tone="success">
                    {t("assignments.availability.available", {
                      count: data.availability.availableQuantity,
                    })}
                  </Badge>
                  <span>
                    {t("assignments.availability.allocated", {
                      count: data.availability.activeQuantity,
                    })}
                  </span>
                </div>
              ) : null}
            </div>

            {loading && !data ? (
              <div className="grid min-h-48 place-items-center text-muted">
                <LoaderCircle
                  className="size-5 animate-spin"
                  aria-label={t("assignments.loading")}
                />
              </div>
            ) : activeAssignments.length ? (
              <div className="space-y-2">
                {activeAssignments.map((assignment) => (
                  <AssignmentRow
                    key={assignment.id}
                    assignment={assignment}
                    canEdit={canEdit}
                    completing={completingId === assignment.id}
                    onComplete={(status) => void completeAssignment(assignment, status)}
                    locale={locale}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                className="min-h-48 rounded-xl border border-dashed border-border"
                icon={<PackageCheck className="size-5" aria-hidden="true" />}
                title={t("assignments.empty.title")}
                description={t("assignments.empty.description")}
              />
            )}

            {history.length ? (
              <div className="mt-7">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  {t("assignments.sections.history")}
                </h3>
                <div className="space-y-2">
                  {history.map((assignment) => (
                    <AssignmentRow
                      key={assignment.id}
                      assignment={assignment}
                      canEdit={false}
                      completing={false}
                      onComplete={() => undefined}
                      locale={locale}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <aside className="rounded-2xl border border-border bg-surface-subtle/60 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              {t("assignments.sections.new")}
            </h3>
            {!canEdit ? (
              <p className="mt-2 text-sm leading-6 text-muted">
                {t("assignments.readOnly")}
              </p>
            ) : (
              <form className="mt-4 space-y-4" onSubmit={(event) => void submitAssignment(event)}>
                <label className={labelClass}>
                  {t("assignments.form.action")}
                  <select
                    value={form.kind}
                    onChange={(event) => setField("kind", event.target.value)}
                    className={inputClass}
                    disabled={saving}
                  >
                    <option value="checkout">{t("assignments.kinds.checkout")}</option>
                    <option value="assignment">{t("assignments.kinds.assignment")}</option>
                    <option value="reservation">{t("assignments.kinds.reservation")}</option>
                  </select>
                </label>

                <label className={labelClass}>
                  {t("assignments.form.recipient")}
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-muted" />
                    <input
                      required
                      maxLength={240}
                      value={form.recipient}
                      onChange={(event) => setField("recipient", event.target.value)}
                      placeholder={t("assignments.form.recipientPlaceholder")}
                      className={`${inputClass} pl-9`}
                      disabled={saving}
                    />
                  </div>
                </label>

                {data?.trackingMode === "serialized" ? (
                  <label className={labelClass}>
                    {t("assignments.form.serializedUnit")}
                    <select
                      required
                      value={form.stockUnitId}
                      onChange={(event) => setField("stockUnitId", event.target.value)}
                      className={inputClass}
                      disabled={saving || !data.availableUnits.length}
                    >
                      <option value="">{t("assignments.form.chooseUnit")}</option>
                      {data.availableUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.code}{unit.location ? ` · ${unit.location}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className={labelClass}>
                    {t("assignments.form.quantity")}
                    <input
                      required
                      type="number"
                      min={1}
                      max={data?.availability.availableQuantity ?? undefined}
                      step={1}
                      value={form.quantity}
                      onChange={(event) => setField("quantity", event.target.value)}
                      className={inputClass}
                      disabled={saving}
                    />
                  </label>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>
                    {t("assignments.form.starts")}
                    <input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(event) => setField("startsAt", event.target.value)}
                      className={inputClass}
                      disabled={saving}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("assignments.form.due")}
                    <input
                      type="datetime-local"
                      min={form.startsAt || undefined}
                      value={form.dueAt}
                      onChange={(event) => setField("dueAt", event.target.value)}
                      className={inputClass}
                      disabled={saving}
                    />
                  </label>
                </div>

                <label className={labelClass}>
                  {t("assignments.form.note")}
                  <textarea
                    rows={3}
                    maxLength={20_000}
                    value={form.note}
                    onChange={(event) => setField("note", event.target.value)}
                    className="mt-1.5 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-success focus:ring-4 focus:ring-success-border disabled:bg-surface-muted"
                    disabled={saving}
                  />
                </label>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    saving ||
                    !data ||
                    data.availability.availableQuantity < 1 ||
                    (data.trackingMode === "serialized" && !data.availableUnits.length)
                  }
                >
                  {saving ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <HandCoins className="size-4" aria-hidden="true" />
                  )}
                  {t(`assignments.form.create.${form.kind}`)}
                </Button>
              </form>
            )}
          </aside>
        </div>
      </Card>
    </section>
  );
}

function AssignmentRow({
  assignment,
  canEdit,
  completing,
  onComplete,
  locale,
}: {
  assignment: Assignment;
  canEdit: boolean;
  completing: boolean;
  onComplete: (status: "returned" | "cancelled") => void;
  locale: string;
}) {
  const { t } = useT("resource");
  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {assignment.assignee.label}
            </span>
            <Badge tone={statusTone(assignment.status)}>
              {t(`assignments.statuses.${assignment.status}`)}
            </Badge>
            <Badge>{t(`assignments.kinds.${assignment.kind}`)}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <PackageCheck className="size-3.5" aria-hidden="true" />
              {assignment.stockUnit?.code ??
                t("assignments.units", { count: assignment.quantity })}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatDate(assignment.startsAt, locale)}
            </span>
            {assignment.dueAt ? (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3.5" aria-hidden="true" />
                {t("assignments.dueDate", {
                  date: formatDate(assignment.dueAt, locale),
                })}
              </span>
            ) : null}
          </div>
          {assignment.note ? (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted">
              {assignment.note}
            </p>
          ) : null}
        </div>

        {canEdit && assignment.status === "active" ? (
          <div className="flex shrink-0 gap-2">
            {assignment.kind !== "reservation" ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onComplete("returned")}
                disabled={completing}
              >
                {completing ? (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Undo2 className="size-3.5" aria-hidden="true" />
                )}
                {t("assignments.actions.return")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onComplete("cancelled")}
              disabled={completing}
            >
              <XCircle className="size-3.5" aria-hidden="true" />
              {t("assignments.actions.cancel")}
            </Button>
          </div>
        ) : assignment.completedAt ? (
          <span className="shrink-0 text-xs text-muted">
            {formatDate(assignment.completedAt, locale)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
