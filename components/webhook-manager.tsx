"use client";

import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";

type WebhookEventType =
  | "inventory.resource.created"
  | "inventory.resource.updated"
  | "inventory.resource.deleted"
  | "inventory.resource.merged"
  | "inventory.stock.movement.created"
  | "inventory.action.executed";

type WebhookEndpoint = {
  id: string;
  name: string;
  target: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
};

type WebhookDelivery = {
  id: string;
  event?: {
    id?: string;
    type?: WebhookEventType | string;
    occurredAt?: string;
  } | null;
  eventType?: WebhookEventType | string;
  status?: string;
  httpStatus?: number | null;
  responseStatus?: number | null;
  attempts?: number;
  error?: string | null;
  createdAt: string;
  deliveredAt?: string | null;
  nextAttemptAt?: string | null;
};

type WebhookDraft = {
  name: string;
  url: string;
  eventTypes: WebhookEventType[];
  enabled: boolean;
};

type DeliveryViewStatus =
  | "pending"
  | "processing"
  | "retrying"
  | "succeeded"
  | "failed";

const eventTypes: WebhookEventType[] = [
  "inventory.resource.created",
  "inventory.resource.updated",
  "inventory.resource.deleted",
  "inventory.resource.merged",
  "inventory.stock.movement.created",
  "inventory.action.executed",
];

const emptyDraft: WebhookDraft = {
  name: "",
  url: "",
  eventTypes: [...eventTypes],
  enabled: true,
};

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10";

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function formatDate(
  value: string | null | undefined,
  empty: string,
  locale?: string,
) {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function deliveryStatus(delivery: WebhookDelivery): DeliveryViewStatus {
  const status = delivery.status?.toLocaleLowerCase("en-US");
  if (status === "success" || status === "succeeded" || status === "delivered") {
    return "succeeded";
  }
  if (status === "processing" || status === "in_progress") {
    return "processing";
  }
  if (status === "retrying" || status === "retry" || status === "scheduled") {
    return "retrying";
  }
  if (status === "failed" || status === "dead" || status === "dead_letter") {
    return "failed";
  }
  if (delivery.deliveredAt) return "succeeded";
  if (delivery.error && delivery.nextAttemptAt) return "retrying";
  if (delivery.error) return "failed";
  return "pending";
}

function deliveryTone(
  status: DeliveryViewStatus,
): "brand" | "success" | "warning" | "danger" | "neutral" {
  if (status === "succeeded") return "success";
  if (status === "processing") return "brand";
  if (status === "retrying") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

export function WebhookManager() {
  const { t, i18n } = useT("settings");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoadFailed, setListLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editorId, setEditorId] = useState<string | "new" | null>(null);
  const [editorBaseline, setEditorBaseline] = useState<WebhookEndpoint | null>(
    null,
  );
  const [draft, setDraft] = useState<WebhookDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    id: string;
    kind: "delete" | "rotate";
  } | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [openDeliveries, setOpenDeliveries] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<
    Record<string, WebhookDelivery[]>
  >({});
  const [deliveryLoadingIds, setDeliveryLoadingIds] = useState<string[]>([]);
  const [deliveryLoadFailed, setDeliveryLoadFailed] = useState<
    Record<string, boolean>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editorRef = useRef<HTMLFormElement>(null);
  const editorNameRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const editorReturnFocusRef = useRef<HTMLElement | null>(null);
  const deliveryLoadingRef = useRef(new Set<string>());

  const load = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/v1/webhooks", { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, t("webhooks.errors.load")));
        }
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as { webhooks?: unknown })?.webhooks)
            ? (payload as { webhooks: WebhookEndpoint[] }).webhooks
            : [];
        setWebhooks(list as WebhookEndpoint[]);
        setListLoadFailed(false);
      } catch (loadError) {
        setListLoadFailed(true);
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("webhooks.errors.load"),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editorId) return;
    const frame = window.requestAnimationFrame(() => {
      editorNameRef.current?.focus({ preventScroll: true });
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorId]);

  useEffect(() => {
    if (!secret) return;
    const frame = window.requestAnimationFrame(() => {
      secretRef.current?.focus({ preventScroll: true });
      secretRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [secret]);

  useEffect(() => {
    if (!confirmAction) return;
    const frame = window.requestAnimationFrame(() => {
      confirmRef.current?.focus({ preventScroll: true });
      confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [confirmAction]);

  const enabledCount = useMemo(
    () => webhooks.filter((item) => item.enabled).length,
    [webhooks],
  );

  const mutationLocked = Boolean(
    secret || editorId || confirmAction || actionKey || saving || loading || refreshing,
  );

  function beginCreate() {
    if (mutationLocked) return;
    editorReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setEditorId("new");
    setEditorBaseline(null);
    setDraft({ ...emptyDraft, eventTypes: [...eventTypes] });
    setError(null);
    setNotice(null);
  }

  function beginEdit(webhook: WebhookEndpoint) {
    if (mutationLocked) return;
    editorReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setEditorId(webhook.id);
    setEditorBaseline(webhook);
    setDraft({
      name: webhook.name,
      url: "",
      eventTypes: [...webhook.eventTypes],
      enabled: webhook.enabled,
    });
    setError(null);
    setNotice(null);
  }

  function closeEditor() {
    if (saving) return;
    setEditorId(null);
    setEditorBaseline(null);
    setDraft({ ...emptyDraft, eventTypes: [...eventTypes] });
    window.requestAnimationFrame(() => editorReturnFocusRef.current?.focus());
  }

  function dismissSecret() {
    setSecret(null);
    window.requestAnimationFrame(() =>
      document.getElementById("webhook-create-button")?.focus(),
    );
  }

  function closeConfirmation(
    webhookId: string,
    kind: "delete" | "rotate",
  ) {
    setConfirmAction(null);
    window.requestAnimationFrame(() =>
      document.getElementById(`webhook-${kind}-${webhookId}`)?.focus(),
    );
  }

  function toggleEvent(eventType: WebhookEventType) {
    setDraft((current) => ({
      ...current,
      eventTypes: current.eventTypes.includes(eventType)
        ? current.eventTypes.filter((item) => item !== eventType)
        : [...current.eventTypes, eventType],
    }));
  }

  async function saveWebhook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!draft.name.trim()) {
      setError(t("webhooks.errors.nameRequired"));
      return;
    }
    if (editorId === "new" && !draft.url.trim()) {
      setError(t("webhooks.errors.urlRequired"));
      return;
    }
    if (draft.url.trim() && !isValidUrl(draft.url.trim())) {
      setError(t("webhooks.errors.urlInvalid"));
      return;
    }
    if (draft.eventTypes.length === 0) {
      setError(t("webhooks.errors.eventsRequired"));
      return;
    }

    const editing = editorId !== "new" && editorId !== null;
    const body: Partial<WebhookDraft> = editing
      ? {
          ...(draft.name.trim() !== editorBaseline?.name
            ? { name: draft.name.trim() }
            : {}),
          ...(JSON.stringify(draft.eventTypes) !==
          JSON.stringify(editorBaseline?.eventTypes)
            ? { eventTypes: draft.eventTypes }
            : {}),
          ...(draft.enabled !== editorBaseline?.enabled
            ? { enabled: draft.enabled }
            : {}),
          ...(draft.url.trim() ? { url: draft.url.trim() } : {}),
        }
      : {
          name: draft.name.trim(),
          url: draft.url.trim(),
          eventTypes: draft.eventTypes,
          enabled: draft.enabled,
        };

    if (editing && Object.keys(body).length === 0) {
      closeEditor();
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        editing ? `/api/v1/webhooks/${editorId}` : "/api/v1/webhooks",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(
            payload,
            t(editing ? "webhooks.errors.update" : "webhooks.errors.create"),
          ),
        );
      }

      const saved = (payload as { webhook?: WebhookEndpoint } | null)?.webhook;
      if (saved) {
        setWebhooks((current) =>
          editing
            ? current.map((item) => (item.id === saved.id ? saved : item))
            : [saved, ...current],
        );
      } else {
        await load(true);
      }
      if (!editing) {
        const createdSecret = (payload as { secret?: unknown } | null)?.secret;
        if (typeof createdSecret === "string") {
          setSecret({ name: draft.name.trim(), value: createdSecret });
          setCopied(false);
        }
      }
      setNotice(
        t(editing ? "webhooks.notices.updated" : "webhooks.notices.created", {
          name: draft.name.trim(),
        }),
      );
      setEditorId(null);
      setEditorBaseline(null);
      setDraft({ ...emptyDraft, eventTypes: [...eventTypes] });
      if (editing) {
        window.requestAnimationFrame(() => editorReturnFocusRef.current?.focus());
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t(editing ? "webhooks.errors.update" : "webhooks.errors.create"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateEnabled(webhook: WebhookEndpoint) {
    const key = `toggle:${webhook.id}`;
    setActionKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/webhooks/${webhook.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, t("webhooks.errors.toggle")));
      }
      const updated = (payload as { webhook?: WebhookEndpoint } | null)?.webhook;
      setWebhooks((current) =>
        current.map((item) =>
          item.id === webhook.id
            ? (updated ?? { ...item, enabled: !webhook.enabled })
            : item,
        ),
      );
      setNotice(
        t(
          webhook.enabled
            ? "webhooks.notices.disabled"
            : "webhooks.notices.enabled",
          { name: webhook.name },
        ),
      );
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : t("webhooks.errors.toggle"),
      );
    } finally {
      setActionKey(null);
    }
  }

  async function testWebhook(webhook: WebhookEndpoint) {
    const key = `test:${webhook.id}`;
    setActionKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/webhooks/${webhook.id}/test`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, t("webhooks.errors.test")));
      }
      setNotice(t("webhooks.notices.tested", { name: webhook.name }));
      await load(true);
      if (openDeliveries.includes(webhook.id)) {
        await loadDeliveries(webhook.id);
      }
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : t("webhooks.errors.test"),
      );
    } finally {
      setActionKey(null);
    }
  }

  async function rotateSecret(webhook: WebhookEndpoint) {
    const key = `rotate:${webhook.id}`;
    setActionKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/webhooks/${webhook.id}/rotate-secret`,
        { method: "POST" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, t("webhooks.errors.rotate")));
      }
      const value = (payload as { secret?: unknown } | null)?.secret;
      if (typeof value !== "string") {
        throw new Error(t("webhooks.errors.rotate"));
      }
      setSecret({ name: webhook.name, value });
      setCopied(false);
      setNotice(t("webhooks.notices.rotated", { name: webhook.name }));
      setConfirmAction(null);
    } catch (rotateError) {
      setError(
        rotateError instanceof Error
          ? rotateError.message
          : t("webhooks.errors.rotate"),
      );
    } finally {
      setActionKey(null);
    }
  }

  async function deleteWebhook(webhook: WebhookEndpoint) {
    const key = `delete:${webhook.id}`;
    setActionKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/webhooks/${webhook.id}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, t("webhooks.errors.delete")));
      }
      setWebhooks((current) => current.filter((item) => item.id !== webhook.id));
      setOpenDeliveries((current) =>
        current.filter((item) => item !== webhook.id),
      );
      setConfirmAction(null);
      if (editorId === webhook.id) closeEditor();
      setNotice(t("webhooks.notices.deleted", { name: webhook.name }));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("webhooks.errors.delete"),
      );
    } finally {
      setActionKey(null);
    }
  }

  async function loadDeliveries(webhookId: string) {
    if (deliveryLoadingRef.current.has(webhookId)) return;
    deliveryLoadingRef.current.add(webhookId);
    setDeliveryLoadingIds((current) =>
      current.includes(webhookId) ? current : [...current, webhookId],
    );
    setDeliveryLoadFailed((current) => ({
      ...current,
      [webhookId]: false,
    }));
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/webhooks/${webhookId}/deliveries`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, t("webhooks.errors.deliveries")),
        );
      }
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { deliveries?: unknown })?.deliveries)
          ? (payload as { deliveries: WebhookDelivery[] }).deliveries
          : [];
      setDeliveries((current) => ({
        ...current,
        [webhookId]: list as WebhookDelivery[],
      }));
    } catch (deliveryError) {
      setDeliveryLoadFailed((current) => ({
        ...current,
        [webhookId]: true,
      }));
      setError(
        deliveryError instanceof Error
          ? deliveryError.message
          : t("webhooks.errors.deliveries"),
      );
    } finally {
      deliveryLoadingRef.current.delete(webhookId);
      setDeliveryLoadingIds((current) =>
        current.filter((item) => item !== webhookId),
      );
    }
  }

  async function retryDelivery(
    webhook: WebhookEndpoint,
    delivery: WebhookDelivery,
  ) {
    if (!webhook.enabled || mutationLocked) return;
    const key = `retry:${delivery.id}`;
    setActionKey(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/webhooks/${webhook.id}/deliveries/${delivery.id}/retry`,
        { method: "POST" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, t("webhooks.errors.retry")));
      }
      setNotice(t("webhooks.notices.retried", { name: webhook.name }));
      await loadDeliveries(webhook.id);
    } catch (retryError) {
      setError(
        retryError instanceof Error
          ? retryError.message
          : t("webhooks.errors.retry"),
      );
    } finally {
      setActionKey(null);
    }
  }

  async function toggleDeliveries(webhookId: string) {
    if (openDeliveries.includes(webhookId)) {
      setOpenDeliveries((current) =>
        current.filter((item) => item !== webhookId),
      );
      return;
    }
    setOpenDeliveries((current) => [...current, webhookId]);
    if (!deliveries[webhookId]) await loadDeliveries(webhookId);
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError(t("webhooks.errors.clipboard"));
    }
  }

  const editingWebhook =
    editorId && editorId !== "new"
      ? webhooks.find((item) => item.id === editorId)
      : null;

  return (
    <div className="space-y-5">
      {secret ? (
        <Card className="border-warning-border bg-warning-soft/40 p-5 sm:p-6">
          <div
            ref={secretRef}
            role="status"
            aria-live="assertive"
            aria-labelledby="webhook-secret-title"
            tabIndex={-1}
            className="flex items-start gap-3 outline-none"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-warning shadow-sm">
              <KeyRound className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-warning">
                    {t("webhooks.secret.eyebrow")}
                  </p>
                  <h2
                    id="webhook-secret-title"
                    className="mt-1 text-base font-semibold text-foreground"
                  >
                    {t("webhooks.secret.title", { name: secret.name })}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={dismissSecret}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground"
                  aria-label={t("webhooks.secret.dismiss")}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 max-w-3xl text-[15px] leading-5 text-muted-strong">
                {t("webhooks.secret.description")}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 break-all rounded-xl border border-border bg-surface px-3.5 py-3 text-xs text-foreground shadow-sm">
                  {secret.value}
                </code>
                <Button variant="secondary" onClick={() => void copySecret()}>
                  {copied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  {t(copied ? "webhooks.secret.copied" : "webhooks.secret.copy")}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {error ? (
        <div
          className="flex items-start justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-surface/50"
            aria-label={t("webhooks.actions.dismissError")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {notice ? (
        <div
          className="flex items-start justify-between gap-3 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success"
          role="status"
        >
          <span className="flex items-center gap-2">
            <Check className="size-4 shrink-0" aria-hidden="true" />
            {notice}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-surface/50"
            aria-label={t("webhooks.actions.dismissNotice")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">
              {t("webhooks.list.title")}
            </h2>
            {!loading && !(listLoadFailed && webhooks.length === 0) ? (
              <Badge tone={enabledCount ? "success" : "neutral"}>
                {t("webhooks.list.activeCount", { count: enabledCount })}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[15px] leading-5 text-muted">
            {t("webhooks.list.description")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => void load(true)}
            disabled={mutationLocked}
            aria-label={t("webhooks.actions.refresh")}
          >
            <RefreshCw
              className={cn("size-4", refreshing && "animate-spin")}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">
              {t("webhooks.actions.refresh")}
            </span>
          </Button>
          <Button
            id="webhook-create-button"
            onClick={beginCreate}
            disabled={mutationLocked}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("webhooks.actions.create")}
          </Button>
        </div>
      </div>

      {editorId ? (
        <Card className="overflow-hidden border-brand/30">
          <form
            ref={editorRef}
            onSubmit={(event) => void saveWebhook(event)}
            aria-labelledby="webhook-editor-title"
            tabIndex={-1}
            className="outline-none"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-surface-subtle px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  {editorId === "new" ? (
                    <Plus className="size-4" aria-hidden="true" />
                  ) : (
                    <Pencil className="size-4" aria-hidden="true" />
                  )}
                </span>
                <div>
                  <h3
                    id="webhook-editor-title"
                    className="text-sm font-semibold text-foreground"
                  >
                    {t(
                      editorId === "new"
                        ? "webhooks.form.createTitle"
                        : "webhooks.form.editTitle",
                    )}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {t(
                      editorId === "new"
                        ? "webhooks.form.createDescription"
                        : "webhooks.form.editDescription",
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                disabled={saving}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
                aria-label={t("webhooks.actions.close")}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold text-muted-strong">
                  {t("webhooks.form.name")}
                  <input
                    ref={editorNameRef}
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    maxLength={120}
                    autoComplete="off"
                    placeholder={t("webhooks.form.namePlaceholder")}
                    className={inputClass}
                  />
                  <span className="mt-1.5 block font-normal leading-5 text-muted">
                    {t("webhooks.form.nameHint")}
                  </span>
                </label>
                <label className="text-xs font-semibold text-muted-strong">
                  {t("webhooks.form.url")}
                  <input
                    type="url"
                    value={draft.url}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    autoComplete="url"
                    placeholder={
                      editorId === "new"
                        ? t("webhooks.form.urlPlaceholder")
                        : t("webhooks.form.urlEditPlaceholder")
                    }
                    className={inputClass}
                  />
                  <span className="mt-1.5 block font-normal leading-5 text-muted">
                    {editingWebhook
                      ? t("webhooks.form.currentTarget", {
                          target: editingWebhook.target,
                        })
                      : t("webhooks.form.urlHint")}
                  </span>
                </label>
              </div>

              <fieldset>
                <legend className="text-xs font-semibold text-muted-strong">
                  {t("webhooks.form.events")}
                </legend>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {t("webhooks.form.eventsHint")}
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {eventTypes.map((eventType) => {
                    const checked = draft.eventTypes.includes(eventType);
                    return (
                      <label
                        key={eventType}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition",
                          checked
                            ? "border-brand/30 bg-brand-soft/60"
                            : "border-border bg-surface hover:border-border-strong",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEvent(eventType)}
                          className="mt-0.5 size-4 rounded border-border accent-[var(--color-brand-solid)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-[15px] font-semibold text-foreground">
                            {t(`webhooks.events.${eventType}.label`)}
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-4 text-muted">
                            {t(`webhooks.events.${eventType}.description`)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border bg-surface-subtle p-4">
                <span>
                  <span className="block text-[15px] font-semibold text-foreground">
                    {t("webhooks.form.enabled")}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    {t("webhooks.form.enabledHint")}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                  className="mt-1 size-4 shrink-0 rounded border-border accent-[var(--color-brand-solid)]"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-4 sm:px-6">
              <Button variant="ghost" onClick={closeEditor} disabled={saving}>
                {t("webhooks.actions.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : editorId === "new" ? (
                  <Plus className="size-4" aria-hidden="true" />
                ) : (
                  <Check className="size-4" aria-hidden="true" />
                )}
                {t(
                  saving
                    ? "webhooks.actions.saving"
                    : editorId === "new"
                      ? "webhooks.actions.create"
                      : "webhooks.actions.save",
                )}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {loading ? (
        <div className="space-y-3" aria-label={t("webhooks.list.loading")}>
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-60 rounded-2xl" />
          ))}
        </div>
      ) : listLoadFailed && webhooks.length === 0 ? null : webhooks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Webhook className="size-5" aria-hidden="true" />}
            title={t("webhooks.list.emptyTitle")}
            description={t("webhooks.list.emptyDescription")}
            action={
              <Button onClick={beginCreate} disabled={mutationLocked}>
                <Plus className="size-4" aria-hidden="true" />
                {t("webhooks.actions.create")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook) => {
            const deliveriesOpen = openDeliveries.includes(webhook.id);
            const webhookDeliveries = deliveries[webhook.id] ?? [];
            const deliveryLoading = deliveryLoadingIds.includes(webhook.id);
            const confirming =
              confirmAction?.id === webhook.id ? confirmAction.kind : null;
            return (
              <Card key={webhook.id} className="overflow-hidden">
                <div className="p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn(
                          "grid size-10 shrink-0 place-items-center rounded-xl",
                          webhook.enabled
                            ? "bg-brand-soft text-brand"
                            : "bg-surface-muted text-muted",
                        )}
                      >
                        <Webhook className="size-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[17px] font-semibold text-foreground">
                            {webhook.name}
                          </h3>
                          <Badge tone={webhook.enabled ? "success" : "neutral"}>
                            {t(
                              webhook.enabled
                                ? "webhooks.status.enabled"
                                : "webhooks.status.disabled",
                            )}
                          </Badge>
                          {webhook.failureCount > 0 ? (
                            <Badge tone="warning">
                              {t("webhooks.status.failureCount", {
                                count: webhook.failureCount,
                              })}
                            </Badge>
                          ) : null}
                        </div>
                        <code
                          className="mt-2 block max-w-full truncate text-xs text-muted-strong"
                          title={webhook.target}
                        >
                          {webhook.target}
                        </code>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void updateEnabled(webhook)}
                      disabled={mutationLocked}
                    >
                      {actionKey === `toggle:${webhook.id}` ? (
                        <LoaderCircle
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Power className="size-3.5" aria-hidden="true" />
                      )}
                      {t(
                        webhook.enabled
                          ? "webhooks.actions.disable"
                          : "webhooks.actions.enable",
                      )}
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-surface-subtle p-3">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">
                        {t("webhooks.health.lastSuccess")}
                      </p>
                      <p className="mt-1.5 text-xs font-medium text-foreground">
                        {formatDate(
                          webhook.lastSuccessAt,
                          t("webhooks.health.never"),
                          locale,
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl bg-surface-subtle p-3">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">
                        {t("webhooks.health.lastFailure")}
                      </p>
                      <p className="mt-1.5 text-xs font-medium text-foreground">
                        {formatDate(
                          webhook.lastFailureAt,
                          t("webhooks.health.never"),
                          locale,
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl bg-surface-subtle p-3">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">
                        {t("webhooks.health.created")}
                      </p>
                      <p className="mt-1.5 text-xs font-medium text-foreground">
                        {formatDate(
                          webhook.createdAt,
                          t("webhooks.health.unknown"),
                          locale,
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {webhook.eventTypes.map((eventType) => (
                      <Badge key={eventType} tone="brand">
                        {t(`webhooks.events.${eventType}.label`)}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-border pt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => beginEdit(webhook)}
                      disabled={mutationLocked}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                      {t("webhooks.actions.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void testWebhook(webhook)}
                      disabled={mutationLocked || !webhook.enabled}
                    >
                      {actionKey === `test:${webhook.id}` ? (
                        <LoaderCircle
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Send className="size-3.5" aria-hidden="true" />
                      )}
                      {t("webhooks.actions.test")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void toggleDeliveries(webhook.id)}
                      disabled={deliveryLoading}
                      aria-expanded={deliveriesOpen}
                      aria-controls={`webhook-deliveries-${webhook.id}`}
                    >
                      {deliveryLoading ? (
                        <LoaderCircle
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Activity className="size-3.5" aria-hidden="true" />
                      )}
                      {t("webhooks.actions.deliveries")}
                      {deliveriesOpen ? (
                        <ChevronUp className="size-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="size-3.5" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      id={`webhook-rotate-${webhook.id}`}
                      onClick={() =>
                        setConfirmAction({ id: webhook.id, kind: "rotate" })
                      }
                      disabled={mutationLocked}
                      aria-expanded={confirming === "rotate"}
                      aria-controls={`webhook-confirm-${webhook.id}`}
                    >
                      <RotateCw className="size-3.5" aria-hidden="true" />
                      {t("webhooks.actions.rotate")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="sm:ml-auto"
                      id={`webhook-delete-${webhook.id}`}
                      onClick={() =>
                        setConfirmAction({ id: webhook.id, kind: "delete" })
                      }
                      disabled={mutationLocked}
                      aria-expanded={confirming === "delete"}
                      aria-controls={`webhook-confirm-${webhook.id}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      {t("webhooks.actions.delete")}
                    </Button>
                  </div>

                  {confirming ? (
                    <div
                      ref={confirmRef}
                      id={`webhook-confirm-${webhook.id}`}
                      role="alertdialog"
                      aria-labelledby={`webhook-confirm-title-${webhook.id}`}
                      aria-describedby={`webhook-confirm-description-${webhook.id}`}
                      tabIndex={-1}
                      className={cn(
                        "mt-3 flex flex-col gap-3 rounded-xl border p-4 outline-none sm:flex-row sm:items-center sm:justify-between",
                        confirming === "delete"
                          ? "border-danger-border bg-danger-soft"
                          : "border-warning-border bg-warning-soft",
                      )}
                    >
                      <div>
                        <p
                          id={`webhook-confirm-title-${webhook.id}`}
                          className="text-[15px] font-semibold text-foreground"
                        >
                          {t(
                            confirming === "delete"
                              ? "webhooks.confirm.deleteTitle"
                              : "webhooks.confirm.rotateTitle",
                          )}
                        </p>
                        <p
                          id={`webhook-confirm-description-${webhook.id}`}
                          className="mt-1 text-xs leading-5 text-muted-strong"
                        >
                          {t(
                            confirming === "delete"
                              ? "webhooks.confirm.deleteDescription"
                              : "webhooks.confirm.rotateDescription",
                            { name: webhook.name },
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            closeConfirmation(webhook.id, confirming)
                          }
                          disabled={actionKey !== null}
                        >
                          {t("webhooks.actions.cancel")}
                        </Button>
                        <Button
                          variant={confirming === "delete" ? "danger" : "primary"}
                          size="sm"
                          onClick={() =>
                            void (confirming === "delete"
                              ? deleteWebhook(webhook)
                              : rotateSecret(webhook))
                          }
                          disabled={actionKey !== null}
                        >
                          {actionKey === `${confirming}:${webhook.id}` ? (
                            <LoaderCircle
                              className="size-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : confirming === "delete" ? (
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          ) : (
                            <RotateCw className="size-3.5" aria-hidden="true" />
                          )}
                          {t(
                            confirming === "delete"
                              ? "webhooks.actions.confirmDelete"
                              : "webhooks.actions.confirmRotate",
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {deliveriesOpen ? (
                  <div
                    id={`webhook-deliveries-${webhook.id}`}
                    aria-busy={deliveryLoading}
                    className="border-t border-border bg-surface-subtle px-5 py-5 sm:px-6"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {t("webhooks.deliveries.title")}
                        </h4>
                        <p className="mt-1 text-xs text-muted">
                          {t("webhooks.deliveries.description")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadDeliveries(webhook.id)}
                        disabled={deliveryLoading || mutationLocked}
                        className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
                        aria-label={t("webhooks.deliveries.refresh")}
                      >
                        <RefreshCw
                          className={cn(
                            "size-3.5",
                            deliveryLoading && "animate-spin",
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    </div>

                    {deliveryLoading && !deliveries[webhook.id] ? (
                      <div className="mt-4 space-y-2">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-16" />
                      </div>
                    ) : deliveryLoadFailed[webhook.id] &&
                      webhookDeliveries.length === 0 ? null
                    : webhookDeliveries.length === 0 ? (
                      <div className="mt-4 rounded-xl border border-dashed border-border bg-surface px-4 py-8 text-center">
                        <Clock3
                          className="mx-auto size-5 text-muted"
                          aria-hidden="true"
                        />
                        <p className="mt-2 text-[15px] font-semibold text-foreground">
                          {t("webhooks.deliveries.emptyTitle")}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {t("webhooks.deliveries.emptyDescription")}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4 space-y-2">
                        {webhookDeliveries.map((delivery) => {
                          const status = deliveryStatus(delivery);
                          const httpStatus =
                            delivery.httpStatus ?? delivery.responseStatus;
                          const eventType =
                            delivery.event?.type ?? delivery.eventType;
                          return (
                            <div
                              key={delivery.id}
                              className="rounded-xl border border-border bg-surface p-3.5"
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <Badge tone={deliveryTone(status)}>
                                    {t(`webhooks.deliveries.status.${status}`)}
                                  </Badge>
                                  <span className="text-xs font-semibold text-foreground">
                                    {eventType === "inventory.webhook.test"
                                      ? t("webhooks.events.inventory.webhook.test.label")
                                      : eventType && eventTypes.includes(eventType as WebhookEventType)
                                        ? t(`webhooks.events.${eventType}.label`)
                                        : eventType || t("webhooks.deliveries.unknownEvent")}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[13px] text-muted">
                                  {formatDate(
                                    delivery.deliveredAt ?? delivery.createdAt,
                                    t("webhooks.health.unknown"),
                                    locale,
                                  )}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-strong">
                                <span>
                                  {t("webhooks.deliveries.httpStatus")}: {httpStatus ?? "—"}
                                </span>
                                <span>
                                  {t("webhooks.deliveries.attempts", {
                                    count: delivery.attempts ?? 0,
                                  })}
                                </span>
                                {delivery.nextAttemptAt &&
                                (status === "pending" || status === "retrying") ? (
                                  <span>
                                    {t("webhooks.deliveries.nextAttempt", {
                                      date: formatDate(
                                        delivery.nextAttemptAt,
                                        "—",
                                        locale,
                                      ),
                                    })}
                                  </span>
                                ) : null}
                              </div>
                              {delivery.error ? (
                                <p className="mt-2 break-words rounded-lg bg-danger-soft px-2.5 py-2 text-[13px] leading-4 text-danger">
                                  {delivery.error}
                                </p>
                              ) : null}
                              {status === "failed" && webhook.enabled ? (
                                <div className="mt-3">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                      void retryDelivery(webhook, delivery)
                                    }
                                    disabled={mutationLocked || deliveryLoading}
                                  >
                                    {actionKey === `retry:${delivery.id}` ? (
                                      <LoaderCircle
                                        className="size-3.5 animate-spin"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <RotateCw
                                        className="size-3.5"
                                        aria-hidden="true"
                                      />
                                    )}
                                    {t("webhooks.actions.retryDelivery")}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <Card className="flex items-start gap-3 bg-surface-subtle p-4">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        <p className="text-xs leading-5 text-muted-strong">
          {t("webhooks.securityNote")}
        </p>
      </Card>
    </div>
  );
}
