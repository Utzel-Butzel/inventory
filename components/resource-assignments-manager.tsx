"use client";

import {
  CalendarDays,
  Clock3,
  HandCoins,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Settings2,
  Undo2,
  UserRound,
  XCircle,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { useOrganizationAllowsNegativeStock } from "@/components/organization-routing";
import { fetchJson } from "@/lib/client-types";

type AssignmentKind = "checkout" | "assignment" | "reservation";
type AssignmentStatus = "active" | "returned" | "cancelled";

type Assignment = {
  id: string;
  resourceId: string;
  stockUnitId: string | null;
  kind: AssignmentKind;
  status: AssignmentStatus;
  stockApplied: boolean;
  overdue: boolean;
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
  lending: LendingSettings;
  availability: {
    availableQuantity: number;
    activeQuantity: number;
    reservedQuantity: number;
  };
  recipients: {
    users: Array<{ id: string; name: string; email: string }>;
  };
  availableUnits: Array<{
    id: string;
    code: string;
    status: string;
    location: string | null;
  }>;
  assignments: Assignment[];
};

type LendingSettings = {
  enabled: boolean;
  approvalRequired: boolean;
  defaultDurationDays: number;
  maxDurationDays: number;
};

type AssignmentForm = {
  kind: AssignmentKind;
  quantity: string;
  stockUnitId: string;
  recipientType: "user" | "label";
  recipientUserId: string;
  recipient: string;
  startsAt: string;
  dueAt: string;
  note: string;
};

const emptyForm: AssignmentForm = {
  kind: "assignment",
  quantity: "1",
  stockUnitId: "",
  recipientType: "label",
  recipientUserId: "",
  recipient: "",
  startsAt: "",
  dueAt: "",
  note: "",
};

const emptyLendingSettings: LendingSettings = {
  enabled: false,
  approvalRequired: true,
  defaultDurationDays: 7,
  maxDurationDays: 30,
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

const localDateTimeValue = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

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
  const allowNegativeStock = useOrganizationAllowsNegativeStock();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const [data, setData] = useState<AssignmentData | null>(null);
  const [form, setForm] = useState<AssignmentForm>(emptyForm);
  const [lendingForm, setLendingForm] = useState<LendingSettings>(
    emptyLendingSettings,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLending, setSavingLending] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  const completionKeys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<AssignmentData>(
        `/api/v1/resources/${resourceId}/assignments`,
        { cache: "no-store" },
      );
      setData(response);
      setLendingForm(response.lending);
      setForm((current) => {
        if (!response.lending.enabled && current.kind !== "assignment") {
          return { ...current, kind: "assignment", startsAt: "", dueAt: "" };
        }
        if (
          response.lending.enabled &&
          current.kind === "assignment" &&
          !current.recipient &&
          !current.recipientUserId &&
          !current.startsAt &&
          !current.dueAt
        ) {
          const startsAt = localDateTimeValue(new Date());
          return {
            ...current,
            kind: "checkout",
            startsAt,
            dueAt: localDateTimeValue(
              new Date(
                new Date(startsAt).getTime() +
                  response.lending.defaultDurationDays * 86_400_000,
              ),
            ),
          };
        }
        return current;
      });
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

  const setAssignmentKind = (kind: AssignmentKind) => {
    setForm((current) => {
      if (kind === "assignment") {
        return { ...current, kind, startsAt: "", dueAt: "" };
      }
      const startsAt =
        kind === "reservation"
          ? localDateTimeValue(new Date(Date.now() + 24 * 60 * 60 * 1_000))
          : localDateTimeValue(new Date());
      const duration = data?.lending.defaultDurationDays ?? 7;
      const dueAt = localDateTimeValue(
        new Date(new Date(startsAt).getTime() + duration * 86_400_000),
      );
      return {
        ...current,
        kind,
        startsAt: current.startsAt || startsAt,
        dueAt: current.dueAt || dueAt,
        stockUnitId: kind === "reservation" ? "" : current.stockUnitId,
      };
    });
  };

  async function saveLendingSettings() {
    if (!canEdit) return;
    setSavingLending(true);
    setError(null);
    try {
      const response = await fetchJson<{ lending: LendingSettings }>(
        `/api/v1/resources/${resourceId}/lending`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(lendingForm),
        },
      );
      setLendingForm(response.lending);
      setData((current) =>
        current ? { ...current, lending: response.lending } : current,
      );
      if (!response.lending.enabled) setAssignmentKind("assignment");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("assignments.errors.settings"),
      );
    } finally {
      setSavingLending(false);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canEdit) return;
    const quantity = data.trackingMode === "serialized" ? 1 : Number(form.quantity);
    const recipient =
      form.recipientType === "user"
        ? { type: "user" as const, userId: form.recipientUserId }
        : { type: "label" as const, label: form.recipient.trim() };
    const payload = {
      kind: form.kind,
      quantity,
      ...(data.trackingMode === "serialized" && form.kind !== "reservation"
        ? { stockUnitId: form.stockUnitId }
        : {}),
      recipient,
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
      setForm({
        ...emptyForm,
        kind: data.lending.enabled ? "checkout" : "assignment",
      });
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

  async function activateReservation(
    assignment: Assignment,
    stockUnitId?: string,
  ) {
    const operation = `${assignment.id}:checkout:${stockUnitId ?? "bulk"}`;
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
        body: JSON.stringify({
          action: "checkout",
          ...(stockUnitId ? { stockUnitId } : {}),
        }),
      });
      completionKeys.current.delete(operation);
      await load();
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : t("assignments.errors.checkout"),
      );
    } finally {
      setCompletingId(null);
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

        {canEdit && data ? (
          <div className="border-b border-border bg-surface-subtle/40 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-9 place-items-center rounded-xl border border-border bg-surface text-muted-strong">
                  <Settings2 className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <input
                      type="checkbox"
                      checked={lendingForm.enabled}
                      onChange={(event) =>
                        setLendingForm((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border accent-[var(--color-success)]"
                      disabled={savingLending}
                    />
                    {t("assignments.lending.enabled")}
                  </label>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                    {t("assignments.lending.description")}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[180px_180px_auto] sm:items-end">
                <label className={labelClass}>
                  {t("assignments.lending.defaultDuration")}
                  <input
                    type="number"
                    min={1}
                    max={lendingForm.maxDurationDays}
                    value={lendingForm.defaultDurationDays}
                    onChange={(event) =>
                      setLendingForm((current) => ({
                        ...current,
                        defaultDurationDays: Number(event.target.value),
                      }))
                    }
                    className={inputClass}
                    disabled={savingLending}
                  />
                </label>
                <label className={labelClass}>
                  {t("assignments.lending.maxDuration")}
                  <input
                    type="number"
                    min={lendingForm.defaultDurationDays}
                    max={3650}
                    value={lendingForm.maxDurationDays}
                    onChange={(event) =>
                      setLendingForm((current) => ({
                        ...current,
                        maxDurationDays: Number(event.target.value),
                      }))
                    }
                    className={inputClass}
                    disabled={savingLending}
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void saveLendingSettings()}
                  disabled={savingLending}
                >
                  {savingLending ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {t("assignments.lending.save")}
                </Button>
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 pl-12 text-xs font-medium text-muted-strong">
              <input
                type="checkbox"
                checked={lendingForm.approvalRequired}
                onChange={(event) =>
                  setLendingForm((current) => ({
                    ...current,
                    approvalRequired: event.target.checked,
                  }))
                }
                className="size-4 rounded border-border accent-[var(--color-success)]"
                disabled={savingLending}
              />
              {t("assignments.lending.approvalRequired")}
            </label>
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
                  {data.availability.reservedQuantity > 0 ? (
                    <span>
                      {t("assignments.availability.reserved", {
                        count: data.availability.reservedQuantity,
                      })}
                    </span>
                  ) : null}
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
                    onCheckout={(stockUnitId) =>
                      void activateReservation(assignment, stockUnitId)
                    }
                    trackingMode={data?.trackingMode ?? "bulk"}
                    availableUnits={data?.availableUnits ?? []}
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
                      onCheckout={() => undefined}
                      trackingMode={data?.trackingMode ?? "bulk"}
                      availableUnits={[]}
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
                    onChange={(event) =>
                      setAssignmentKind(event.target.value as AssignmentKind)
                    }
                    className={inputClass}
                    disabled={saving}
                  >
                    <option value="assignment">{t("assignments.kinds.assignment")}</option>
                    {data?.lending.enabled ? (
                      <>
                        <option value="checkout">{t("assignments.kinds.checkout")}</option>
                        <option value="reservation">{t("assignments.kinds.reservation")}</option>
                      </>
                    ) : null}
                  </select>
                </label>

                <label className={labelClass}>
                  {t("assignments.form.recipientType")}
                  <select
                    value={form.recipientType}
                    onChange={(event) =>
                      setField("recipientType", event.target.value)
                    }
                    className={inputClass}
                    disabled={saving}
                  >
                    <option value="label">{t("assignments.form.externalRecipient")}</option>
                    {data?.recipients.users.length ? (
                      <option value="user">{t("assignments.form.registeredUser")}</option>
                    ) : null}
                  </select>
                </label>

                {form.recipientType === "user" ? (
                  <label className={labelClass}>
                    {t("assignments.form.recipient")}
                    <select
                      required
                      value={form.recipientUserId}
                      onChange={(event) =>
                        setField("recipientUserId", event.target.value)
                      }
                      className={inputClass}
                      disabled={saving}
                    >
                      <option value="">{t("assignments.form.chooseUser")}</option>
                      {data?.recipients.users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} · {user.email}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
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
                )}

                {data?.trackingMode === "serialized" && form.kind !== "reservation" ? (
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
                ) : data?.trackingMode === "serialized" ? (
                  <p className="rounded-xl border border-border bg-surface px-3 py-2 text-xs leading-5 text-muted">
                    {t("assignments.form.reservationUnitLater")}
                  </p>
                ) : (
                  <label className={labelClass}>
                    {t("assignments.form.quantity")}
                    <input
                      required
                      type="number"
                      min={1}
                      max={
                        allowNegativeStock
                          ? undefined
                          : data?.availability.availableQuantity ?? undefined
                      }
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
                      required={form.kind === "reservation"}
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
                      required={form.kind !== "assignment"}
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
                    (form.kind !== "reservation" &&
                      !allowNegativeStock &&
                      data.availability.availableQuantity < 1) ||
                    (form.recipientType === "user" && !form.recipientUserId) ||
                    (data.trackingMode === "serialized" &&
                      form.kind !== "reservation" &&
                      !data.availableUnits.length)
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
  onCheckout,
  trackingMode,
  availableUnits,
  locale,
}: {
  assignment: Assignment;
  canEdit: boolean;
  completing: boolean;
  onComplete: (status: "returned" | "cancelled") => void;
  onCheckout: (stockUnitId?: string) => void;
  trackingMode: "bulk" | "serialized";
  availableUnits: Array<{
    id: string;
    code: string;
    status: string;
    location: string | null;
  }>;
  locale: string;
}) {
  const { t } = useT("resource");
  const [checkoutUnitId, setCheckoutUnitId] = useState("");
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
            {assignment.overdue ? (
              <Badge tone="danger">{t("assignments.statuses.overdue")}</Badge>
            ) : null}
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
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            {assignment.kind === "reservation" ? (
              <div className="flex flex-wrap justify-end gap-2">
                {trackingMode === "serialized" ? (
                  <select
                    value={checkoutUnitId}
                    onChange={(event) => setCheckoutUnitId(event.target.value)}
                    className="h-9 min-w-44 rounded-lg border border-border bg-surface px-2 text-xs text-foreground"
                    disabled={completing}
                    aria-label={t("assignments.form.serializedUnit")}
                  >
                    <option value="">{t("assignments.form.chooseUnit")}</option>
                    {availableUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code}{unit.location ? ` · ${unit.location}` : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onCheckout(checkoutUnitId || undefined)}
                  disabled={
                    completing ||
                    (trackingMode === "serialized" && !checkoutUnitId)
                  }
                >
                  {completing ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <HandCoins className="size-3.5" aria-hidden="true" />
                  )}
                  {t("assignments.actions.checkout")}
                </Button>
              </div>
            ) : (
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
            )}
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
