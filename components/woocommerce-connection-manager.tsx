"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  PackageSearch,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, Skeleton } from "@/components/ui";

type WooCommerceConnection = {
  id: string;
  storeUrl: string;
  consumerKeyHint: string;
  status: "connected" | "error";
  syncEnabled: boolean;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastWebhookAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

type WooCommerceSyncOverview = {
  totalOrders: number;
  issueOrders: number;
  recentOrders: Array<{
    orderId: number;
    orderNumber: string;
    orderStatus: string;
    status: "succeeded" | "partial" | "failed";
    totalLines: number;
    syncedLines: number;
    lastError: string | null;
    updatedAt: string;
    issues: Array<{
      lineItemId: number;
      sku: string;
      status: "unmapped" | "error";
      error: string | null;
    }>;
  }>;
};

type ConnectionResponse = {
  connection: WooCommerceConnection | null;
  sync: WooCommerceSyncOverview | null;
  encryptionConfigured: boolean;
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

function formatDate(value: string | null, locale: string, empty: string) {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function WooCommerceConnectionManager() {
  const { t, i18n } = useT("settings");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [connection, setConnection] = useState<WooCommerceConnection | null>(
    null,
  );
  const [sync, setSync] = useState<WooCommerceSyncOverview | null>(null);
  const [encryptionConfigured, setEncryptionConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [updatingSync, setUpdatingSync] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [manualOrderId, setManualOrderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/v1/integrations/woocommerce", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | ConnectionResponse
          | null;
        if (!response.ok || !payload) {
          throw new Error(
            getErrorMessage(payload, t("woocommerce.errors.load")),
          );
        }
        setConnection(payload.connection);
        setSync(payload.sync);
        setEncryptionConfigured(payload.encryptionConfigured);
        if (!payload.connection) setEditing(true);
        setStoreUrl((current) => current || payload.connection?.storeUrl || "");
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("woocommerce.errors.load"),
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

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!storeUrl.trim() || !consumerKey.trim() || !consumerSecret.trim()) {
      setError(t("woocommerce.errors.required"));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/v1/integrations/woocommerce", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeUrl: storeUrl.trim(),
          consumerKey: consumerKey.trim(),
          consumerSecret: consumerSecret.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, t("woocommerce.errors.connect")),
        );
      }
      const result = payload as {
        connection: WooCommerceConnection;
        test?: { productCount?: number | null };
      };
      setConnection(result.connection);
      setSync(null);
      setStoreUrl(result.connection.storeUrl);
      setConsumerKey("");
      setConsumerSecret("");
      setEditing(false);
      const productCount = result.test?.productCount;
      setNotice(
        typeof productCount === "number"
          ? t("woocommerce.notices.connectedWithProducts", {
              count: productCount,
            })
          : t("woocommerce.notices.connected"),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("woocommerce.errors.connect"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStockSync(enabled: boolean) {
    setUpdatingSync(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/integrations/woocommerce", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncEnabled: enabled }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, t("woocommerce.errors.updateSync")),
        );
      }
      const result = payload as {
        connection: WooCommerceConnection;
        sync: WooCommerceSyncOverview;
      };
      setConnection(result.connection);
      setSync(result.sync);
      setNotice(
        enabled
          ? t("woocommerce.notices.syncEnabled")
          : t("woocommerce.notices.syncDisabled"),
      );
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : t("woocommerce.errors.updateSync"),
      );
    } finally {
      setUpdatingSync(false);
    }
  }

  async function runStockSync(orderId?: number) {
    setRunningSync(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/integrations/woocommerce/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderId ? { orderId } : {}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, t("woocommerce.errors.runSync")),
        );
      }
      const result = payload as { attempted: number; succeeded: number };
      await load(true);
      setManualOrderId("");
      setNotice(
        result.attempted === 0
          ? t("woocommerce.notices.noSyncIssues")
          : t("woocommerce.notices.syncRun", {
              attempted: result.attempted,
              succeeded: result.succeeded,
            }),
      );
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : t("woocommerce.errors.runSync"),
      );
    } finally {
      setRunningSync(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        "/api/v1/integrations/woocommerce/test",
        { method: "POST" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        void load(true);
        throw new Error(
          getErrorMessage(payload, t("woocommerce.errors.test")),
        );
      }
      const result = payload as {
        connection: WooCommerceConnection;
        test?: { productCount?: number | null };
      };
      setConnection(result.connection);
      const productCount = result.test?.productCount;
      setNotice(
        typeof productCount === "number"
          ? t("woocommerce.notices.testedWithProducts", {
              count: productCount,
            })
          : t("woocommerce.notices.tested"),
      );
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : t("woocommerce.errors.test"),
      );
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/v1/integrations/woocommerce", {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          getErrorMessage(payload, t("woocommerce.errors.disconnect")),
        );
      }
      setConnection(null);
      setSync(null);
      setStoreUrl("");
      setConsumerKey("");
      setConsumerSecret("");
      setEditing(true);
      setConfirmDisconnect(false);
      setNotice(t("woocommerce.notices.disconnected"));
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : t("woocommerce.errors.disconnect"),
      );
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-label={t("woocommerce.loading")}>
        <Skeleton className="h-52" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-4 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 rounded-md p-1 hover:bg-surface/60"
            aria-label={t("woocommerce.actions.dismiss")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      {!encryptionConfigured ? (
        <Card className="border-warning-border bg-warning-soft p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-warning" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {t("woocommerce.encryption.title")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-strong">
                {t("woocommerce.encryption.description")}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {connection ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <ShoppingBag className="size-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-foreground">
                    {t("woocommerce.connection.title")}
                  </h2>
                  <Badge
                    tone={connection.status === "connected" ? "success" : "danger"}
                  >
                    {t(`woocommerce.status.${connection.status}`)}
                  </Badge>
                </div>
                <a
                  href={connection.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-sm text-brand hover:underline"
                >
                  {connection.storeUrl}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(true)}
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {t("woocommerce.actions.refresh")}
            </Button>
          </div>

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-muted">
                {t("woocommerce.connection.consumerKey")}
              </p>
              <p className="mt-1 font-mono text-sm text-foreground">
                {connection.consumerKeyHint}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">
                {t("woocommerce.connection.lastChecked")}
              </p>
              <p className="mt-1 text-sm text-foreground">
                {formatDate(
                  connection.lastCheckedAt,
                  locale,
                  t("woocommerce.connection.never"),
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">
                {t("woocommerce.connection.lastSuccess")}
              </p>
              <p className="mt-1 text-sm text-foreground">
                {formatDate(
                  connection.lastSuccessAt,
                  locale,
                  t("woocommerce.connection.never"),
                )}
              </p>
            </div>
          </div>

          {connection.lastError ? (
            <div className="mx-5 mb-5 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
              {connection.lastError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border bg-surface-subtle px-5 py-4">
            <Button
              onClick={() => void testConnection()}
              disabled={testing || disconnecting}
            >
              {testing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plug className="size-4" />
              )}
              {testing
                ? t("woocommerce.actions.testing")
                : t("woocommerce.actions.test")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing((current) => !current);
                setStoreUrl(connection.storeUrl);
                setError(null);
              }}
            >
              <KeyRound className="size-4" />
              {t("woocommerce.actions.replace")}
            </Button>
            <Button
              variant="danger"
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnecting}
            >
              <Trash2 className="size-4" />
              {t("woocommerce.actions.disconnect")}
            </Button>
          </div>

          {confirmDisconnect ? (
            <div className="border-t border-danger-border bg-danger-soft px-5 py-4">
              <p className="text-sm font-semibold text-foreground">
                {t("woocommerce.disconnect.title")}
              </p>
              <p className="mt-1 text-sm text-muted-strong">
                {t("woocommerce.disconnect.description")}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void disconnect()}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  {t("woocommerce.disconnect.confirm")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmDisconnect(false)}
                  disabled={disconnecting}
                >
                  {t("woocommerce.actions.cancel")}
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {connection ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <PackageSearch className="size-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-foreground">
                    {t("woocommerce.stockSync.title")}
                  </h2>
                  <Badge tone={connection.syncEnabled ? "success" : "neutral"}>
                    {connection.syncEnabled
                      ? t("woocommerce.stockSync.enabled")
                      : t("woocommerce.stockSync.disabled")}
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
                  {t("woocommerce.stockSync.description")}
                </p>
              </div>
            </div>
            <Button
              variant={connection.syncEnabled ? "secondary" : "primary"}
              size="sm"
              onClick={() =>
                void updateStockSync(!connection.syncEnabled)
              }
              disabled={updatingSync || saving || disconnecting}
            >
              {updatingSync ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : connection.syncEnabled ? (
                <X className="size-3.5" />
              ) : (
                <Plug className="size-3.5" />
              )}
              {connection.syncEnabled
                ? t("woocommerce.stockSync.disable")
                : t("woocommerce.stockSync.enable")}
            </Button>
          </div>

          <div className="grid gap-4 px-5 py-5 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-muted">
                {t("woocommerce.stockSync.orders")}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {sync?.totalOrders ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">
                {t("woocommerce.stockSync.issues")}
              </p>
              <p
                className={`mt-1 text-sm font-semibold ${
                  (sync?.issueOrders ?? 0) > 0
                    ? "text-danger"
                    : "text-foreground"
                }`}
              >
                {sync?.issueOrders ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">
                {t("woocommerce.stockSync.lastWebhook")}
              </p>
              <p className="mt-1 text-sm text-foreground">
                {formatDate(
                  connection.lastWebhookAt,
                  locale,
                  t("woocommerce.connection.never"),
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted">
                {t("woocommerce.stockSync.lastSync")}
              </p>
              <p className="mt-1 text-sm text-foreground">
                {formatDate(
                  connection.lastSyncAt,
                  locale,
                  t("woocommerce.connection.never"),
                )}
              </p>
            </div>
          </div>

          <div className="border-t border-border bg-surface-subtle px-5 py-4 text-sm leading-6 text-muted-strong">
            <p>{t("woocommerce.stockSync.skuRule")}</p>
            <p>{t("woocommerce.stockSync.statusRule")}</p>
          </div>

          {connection.syncEnabled ? (
            <div className="border-t border-border px-5 py-5">
              <h3 className="text-sm font-semibold text-foreground">
                {t("woocommerce.stockSync.manualTitle")}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {t("woocommerce.stockSync.manualDescription")}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={manualOrderId}
                  onChange={(event) => setManualOrderId(event.target.value)}
                  placeholder={t("woocommerce.stockSync.orderIdPlaceholder")}
                  disabled={runningSync}
                  aria-label={t("woocommerce.stockSync.orderId")}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    const orderId = Number(manualOrderId);
                    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
                      setError(t("woocommerce.errors.orderId"));
                      return;
                    }
                    void runStockSync(orderId);
                  }}
                  disabled={runningSync || !manualOrderId.trim()}
                >
                  {runningSync ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  {t("woocommerce.stockSync.syncOrder")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void runStockSync()}
                  disabled={runningSync || (sync?.issueOrders ?? 0) === 0}
                >
                  <RefreshCw
                    className={`size-4 ${runningSync ? "animate-spin" : ""}`}
                  />
                  {t("woocommerce.stockSync.retryIssues")}
                </Button>
              </div>
            </div>
          ) : null}

          {sync?.recentOrders.length ? (
            <div className="border-t border-border px-5 py-5">
              <h3 className="text-sm font-semibold text-foreground">
                {t("woocommerce.stockSync.recentTitle")}
              </h3>
              <div className="mt-3 divide-y divide-border rounded-xl border border-border">
                {sync.recentOrders.map((order) => (
                  <div key={order.orderId} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          #{order.orderNumber}
                        </span>
                        <Badge
                          tone={
                            order.status === "succeeded"
                              ? "success"
                              : order.status === "partial"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {t(`woocommerce.stockSync.syncStatus.${order.status}`)}
                        </Badge>
                        <span className="text-xs text-muted">
                          {order.orderStatus}
                        </span>
                      </div>
                      <span className="text-xs text-muted">
                        {t("woocommerce.stockSync.lineProgress", {
                          synced: order.syncedLines,
                          total: order.totalLines,
                        })}
                      </span>
                    </div>
                    {order.issues.length ? (
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-danger">
                        {order.issues.slice(0, 3).map((issue) => (
                          <li key={issue.lineItemId}>
                            {issue.sku || t("woocommerce.stockSync.missingSku")}: {" "}
                            {issue.error}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {editing ? (
        <Card className="p-5 sm:p-6">
          <div className="mb-5">
            <h2 className="text-base font-semibold text-foreground">
              {connection
                ? t("woocommerce.form.replaceTitle")
                : t("woocommerce.form.connectTitle")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              {t("woocommerce.form.description")}
            </p>
            {connection?.syncEnabled ? (
              <p className="mt-2 text-sm leading-6 text-warning">
                {t("woocommerce.form.replacementWarning")}
              </p>
            ) : null}
          </div>
          <form onSubmit={save} className="space-y-4">
            <label className="block text-sm font-medium text-foreground">
              {t("woocommerce.form.storeUrl")}
              <input
                className={inputClass}
                type="url"
                inputMode="url"
                value={storeUrl}
                onChange={(event) => setStoreUrl(event.target.value)}
                placeholder={t("woocommerce.form.storeUrlPlaceholder")}
                required
                autoComplete="url"
                disabled={saving}
              />
              <span className="mt-1.5 block text-xs leading-5 text-muted">
                {t("woocommerce.form.storeUrlHint")}
              </span>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-foreground">
                {t("woocommerce.form.consumerKey")}
                <input
                  className={inputClass}
                  type="password"
                  value={consumerKey}
                  onChange={(event) => setConsumerKey(event.target.value)}
                  placeholder="ck_…"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  disabled={saving}
                />
              </label>
              <label className="block text-sm font-medium text-foreground">
                {t("woocommerce.form.consumerSecret")}
                <input
                  className={inputClass}
                  type="password"
                  value={consumerSecret}
                  onChange={(event) => setConsumerSecret(event.target.value)}
                  placeholder="cs_…"
                  required
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={saving}
                />
              </label>
            </div>
            <p className="flex items-start gap-2 text-xs leading-5 text-muted">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              {t("woocommerce.form.securityHint")}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" disabled={saving || !encryptionConfigured}>
                {saving ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                {saving
                  ? t("woocommerce.actions.connecting")
                  : connection
                    ? t("woocommerce.actions.saveReplacement")
                    : t("woocommerce.actions.connect")}
              </Button>
              {connection ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setConsumerKey("");
                    setConsumerSecret("");
                  }}
                  disabled={saving}
                >
                  {t("woocommerce.actions.cancel")}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-subtle text-muted-strong">
            <KeyRound className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              {t("woocommerce.guide.title")}
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-strong">
              <li>{t("woocommerce.guide.step1")}</li>
              <li>{t("woocommerce.guide.step2")}</li>
              <li>{t("woocommerce.guide.step3")}</li>
            </ol>
            <a
              href="https://woocommerce.com/document/woocommerce-rest-api/"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
            >
              {t("woocommerce.guide.documentation")}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}
