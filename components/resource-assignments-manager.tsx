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
  "mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "block text-xs font-semibold text-slate-700";

const kindLabels: Record<AssignmentKind, string> = {
  checkout: "Checkout",
  assignment: "Assignment",
  reservation: "Reservation",
};

const statusTone = (status: AssignmentStatus) => {
  if (status === "active") return "brand" as const;
  if (status === "returned") return "success" as const;
  return "neutral" as const;
};

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
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
      setError(loadError instanceof Error ? loadError.message : "Unable to load assignments.");
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

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
      setError(saveError instanceof Error ? saveError.message : "Unable to create assignment.");
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
          : "Unable to complete assignment.",
      );
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-8 sm:px-6 lg:px-8">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-violet-600 text-white">
              <HandCoins className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-950">Assignments & reservations</h2>
              <p className="mt-1 text-sm text-slate-500">
                Check out, reserve, or permanently assign available inventory with a complete stock trail.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
            aria-label="Refresh assignments"
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error ? (
          <div role="alert" className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Active</h3>
              {data ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Badge tone="success">{data.availability.availableQuantity} available</Badge>
                  <span>{data.availability.activeQuantity} allocated</span>
                </div>
              ) : null}
            </div>

            {loading && !data ? (
              <div className="grid min-h-48 place-items-center text-slate-400">
                <LoaderCircle className="size-5 animate-spin" aria-label="Loading assignments" />
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
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                className="min-h-48 rounded-xl border border-dashed border-slate-200"
                icon={<PackageCheck className="size-5" aria-hidden="true" />}
                title="Nothing is currently allocated"
                description="New checkouts, assignments, and reservations will appear here."
              />
            )}

            {history.length ? (
              <div className="mt-7">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">History</h3>
                <div className="space-y-2">
                  {history.map((assignment) => (
                    <AssignmentRow
                      key={assignment.id}
                      assignment={assignment}
                      canEdit={false}
                      completing={false}
                      onComplete={() => undefined}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <aside className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <h3 className="text-sm font-semibold text-slate-950">New allocation</h3>
            {!canEdit ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">
                You have read-only access to assignments.
              </p>
            ) : (
              <form className="mt-4 space-y-4" onSubmit={(event) => void submitAssignment(event)}>
                <label className={labelClass}>
                  Action
                  <select
                    value={form.kind}
                    onChange={(event) => setField("kind", event.target.value)}
                    className={inputClass}
                    disabled={saving}
                  >
                    <option value="checkout">Checkout</option>
                    <option value="assignment">Assignment</option>
                    <option value="reservation">Reservation</option>
                  </select>
                </label>

                <label className={labelClass}>
                  Recipient
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute left-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-slate-400" />
                    <input
                      required
                      maxLength={240}
                      value={form.recipient}
                      onChange={(event) => setField("recipient", event.target.value)}
                      placeholder="Person, team, or project"
                      className={`${inputClass} pl-9`}
                      disabled={saving}
                    />
                  </div>
                </label>

                {data?.trackingMode === "serialized" ? (
                  <label className={labelClass}>
                    Serialized unit
                    <select
                      required
                      value={form.stockUnitId}
                      onChange={(event) => setField("stockUnitId", event.target.value)}
                      className={inputClass}
                      disabled={saving || !data.availableUnits.length}
                    >
                      <option value="">Choose a unit</option>
                      {data.availableUnits.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.code}{unit.location ? ` · ${unit.location}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className={labelClass}>
                    Quantity
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
                    Starts
                    <input
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(event) => setField("startsAt", event.target.value)}
                      className={inputClass}
                      disabled={saving}
                    />
                  </label>
                  <label className={labelClass}>
                    Due
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
                  Note
                  <textarea
                    rows={3}
                    maxLength={20_000}
                    value={form.note}
                    onChange={(event) => setField("note", event.target.value)}
                    className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:bg-slate-100"
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
                  Create {kindLabels[form.kind].toLowerCase()}
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
}: {
  assignment: Assignment;
  canEdit: boolean;
  completing: boolean;
  onComplete: (status: "returned" | "cancelled") => void;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-950">
              {assignment.assignee.label}
            </span>
            <Badge tone={statusTone(assignment.status)}>{assignment.status}</Badge>
            <Badge>{kindLabels[assignment.kind]}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <PackageCheck className="size-3.5" aria-hidden="true" />
              {assignment.stockUnit?.code ?? `${assignment.quantity} unit${assignment.quantity === 1 ? "" : "s"}`}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {formatDate(assignment.startsAt)}
            </span>
            {assignment.dueAt ? (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3.5" aria-hidden="true" /> Due {formatDate(assignment.dueAt)}
              </span>
            ) : null}
          </div>
          {assignment.note ? (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
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
                Return
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onComplete("cancelled")}
              disabled={completing}
            >
              <XCircle className="size-3.5" aria-hidden="true" /> Cancel
            </Button>
          </div>
        ) : assignment.completedAt ? (
          <span className="shrink-0 text-xs text-slate-400">
            {formatDate(assignment.completedAt)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
