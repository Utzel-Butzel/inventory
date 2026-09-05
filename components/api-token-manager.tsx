"use client";

import { CollectionViewToolbar, ListViewResults, useCollectionView } from "@/components/list-view";


import {
  AlertTriangle,
  Check,
  CircleCheck,
  CircleX,
  Cloud,
  Copy,
  Database,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  ScanSearch,
  Server,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import {
  ImageModelSelector,
  useImageModelPreference,
} from "@/components/image-model-selector";

type ApiScope = "read" | "write" | "ai";

type RuntimeStatus = {
  storage: {
    provider: string;
    configured: boolean;
  };
  ai: {
    analysis: boolean;
    imageGeneration: boolean;
    imageProvider: string;
  };
  auth: {
    password: boolean;
    auth0: boolean;
    providers?: Array<{ id: string; name: string }>;
  };
};

type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  expiresAt: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
};

type CreatedToken = {
  token: ApiToken;
  secret: string;
};

type ExpiryOption = "never" | "30-days" | "90-days" | "custom";

const scopeOptions: Array<{
  value: ApiScope;
}> = [{ value: "read" }, { value: "write" }, { value: "ai" }];

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

function StatusPill({
  ready,
  label,
  readyLabel,
  notConfiguredLabel,
}: {
  ready: boolean;
  label?: string;
  readyLabel: string;
  notConfiguredLabel: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        ready
          ? "bg-success-soft text-success ring-1 ring-inset ring-success-border"
          : "bg-surface-muted text-muted ring-1 ring-inset ring-border"
      }`}
    >
      {ready ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
      {label ?? (ready ? readyLabel : notConfiguredLabel)}
    </span>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={label}>
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-2xl border border-border/80 bg-surface-subtle"
        />
      ))}
    </div>
  );
}

export function ApiTokenManager({ isAdmin }: { isAdmin: boolean }) {
  const { t, i18n } = useT("settings");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const imageModelPreference = useImageModelPreference();
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const collection = useCollectionView("settings.api-tokens", tokens, {
    search: (item) => [item.name, item.prefix].join(" "),
    sorts: [
      { value: "name", label: t("common:listView.fields.name"), get: (item) => item.name },
      { value: "createdAt", label: t("common:listView.fields.createdAt"), get: (item) => item.createdAt }
    ],
    filters: [{ key: "scope", label: t("common:listView.permissions"), get: (item) => item.scopes, options: ["read", "write", "ai"].map((value) => ({ value, label: value })) }],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["read"]);
  const [expiry, setExpiry] = useState<ExpiryOption>("never");
  const [customExpiry, setCustomExpiry] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState<"secret" | "curl" | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);

    try {
      const statusResponse = await fetch("/api/settings/status", {
        cache: "no-store",
      });
      const statusPayload = await statusResponse.json().catch(() => null);

      if (!statusResponse.ok) {
        throw new Error(
          getErrorMessage(statusPayload, t("api.errors.loadRuntime")),
        );
      }
      setRuntime(statusPayload as RuntimeStatus);
      if (isAdmin) {
        const tokenResponse = await fetch("/api/tokens", { cache: "no-store" });
        const tokenPayload = await tokenResponse.json().catch(() => null);
        if (!tokenResponse.ok) {
          throw new Error(getErrorMessage(tokenPayload, t("api.errors.loadTokens")));
        }
        setTokens(
          Array.isArray((tokenPayload as { tokens?: unknown })?.tokens)
            ? ((tokenPayload as { tokens: ApiToken[] }).tokens ?? [])
            : [],
        );
      } else {
        setTokens([]);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("api.errors.loadSettings"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const expiresAt = useMemo(() => {
    if (expiry === "never") return null;
    if (expiry === "custom") {
      if (!customExpiry) return null;
      const date = new Date(customExpiry);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const days = expiry === "30-days" ? 30 : 90;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
  }, [customExpiry, expiry]);

  const curlExample = useMemo(() => {
    if (!createdToken) return "";
    const origin = typeof window === "undefined" ? "https://your-inventory.example" : window.location.origin;
    return [
      `curl "${origin}/api/v1/resources" \\`,
      `  -H "Authorization: Bearer ${createdToken.secret}"`,
    ].join("\n");
  }, [createdToken]);

  function toggleScope(scope: ApiScope) {
    setScopes((current) => {
      if (current.includes(scope)) {
        return current.length === 1 ? current : current.filter((item) => item !== scope);
      }
      return [...current, scope];
    });
  }

  async function createToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError(t("api.errors.nameRequired"));
      return;
    }
    if (expiry === "custom" && !expiresAt) {
      setFormError(t("api.errors.expiryInvalid"));
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setFormError(t("api.errors.expiryFuture"));
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes, expiresAt }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, t("api.errors.create")));
      }

      const result = payload as CreatedToken;
      setCreatedToken(result);
      setTokens((current) => [result.token, ...current]);
      setName("");
      setScopes(["read"]);
      setExpiry("never");
      setCustomExpiry("");
      setFormOpen(false);
      setCopied(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("api.errors.create"));
    } finally {
      setCreating(false);
    }
  }

  async function copyText(value: string, target: "secret" | "curl") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied((current) => (current === target ? null : current)), 2_000);
    } catch {
      setActionError(t("api.errors.clipboard"));
    }
  }

  async function revokeToken(id: string) {
    setRevoking(id);
    setActionError(null);
    try {
      const response = await fetch(`/api/tokens/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(getErrorMessage(payload, t("api.errors.revoke")));
      }
      setTokens((current) => current.filter((token) => token.id !== id));
      setConfirmRevoke(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("api.errors.revoke"));
    } finally {
      setRevoking(null);
    }
  }

  const authenticationProviderNames = runtime
    ? [
        ...(runtime.auth.password ? [t("api.runtime.password")] : []),
        ...(runtime.auth.providers?.map((provider) => provider.name) ??
          (runtime.auth.auth0 ? ["Auth0"] : [])),
      ]
    : [];

  return (
    <div className="space-y-8">
      <section aria-labelledby="runtime-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="runtime-heading" className="text-base font-semibold text-foreground">
              {t("api.runtime.title")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("api.runtime.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-muted shadow-sm transition hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t("api.runtime.refresh")}
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <LoadingBlock label={t("api.runtime.loading")} />
        ) : loadError && !runtime ? (
          <div className="flex items-start justify-between gap-4 rounded-2xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">{t("api.runtime.loadTitle")}</p>
                <p className="mt-1 text-danger">{loadError}</p>
              </div>
            </div>
            <button type="button" onClick={() => void load()} className="font-semibold hover:underline">
              {t("common:actions.retry")}
            </button>
          </div>
        ) : runtime ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="group rounded-2xl border border-border/80 bg-surface p-4 shadow-[var(--shadow-sm)] transition hover:border-border-strong hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-info-soft text-info">
                  {runtime.storage.provider === "local" ? <HardDrive className="size-5" /> : <Cloud className="size-5" />}
                </span>
                <StatusPill
                  ready={runtime.storage.configured}
                  readyLabel={t("api.runtime.ready")}
                  notConfiguredLabel={t("api.runtime.notConfigured")}
                />
              </div>
              <p className="mt-5 text-sm font-semibold text-foreground">{t("api.runtime.fileStorage")}</p>
              <p className="mt-1 text-sm capitalize text-muted">
                {t("api.runtime.provider", { provider: runtime.storage.provider })}
              </p>
            </div>

            <div className="group rounded-2xl border border-border/80 bg-surface p-4 shadow-[var(--shadow-sm)] transition hover:border-border-strong hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                  <ScanSearch className="size-5" />
                </span>
                <StatusPill
                  ready={runtime.ai.analysis}
                  readyLabel={t("api.runtime.ready")}
                  notConfiguredLabel={t("api.runtime.notConfigured")}
                />
              </div>
              <p className="mt-5 text-sm font-semibold text-foreground">{t("api.runtime.aiAnalysis")}</p>
              <p className="mt-1 text-sm text-muted">{t("api.runtime.aiAnalysisDescription")}</p>
            </div>

            <div className="group rounded-2xl border border-border/80 bg-surface p-4 shadow-[var(--shadow-sm)] transition hover:border-border-strong hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Database className="size-5" />
                </span>
                <StatusPill
                  ready={runtime.ai.imageGeneration}
                  readyLabel={t("api.runtime.ready")}
                  notConfiguredLabel={t("api.runtime.notConfigured")}
                />
              </div>
              <p className="mt-5 text-sm font-semibold text-foreground">{t("api.runtime.imageGeneration")}</p>
              <p className="mt-1 text-sm capitalize text-muted">
                {t("api.runtime.provider", {
                  provider: imageModelPreference.selectedModel?.provider ?? runtime.ai.imageProvider,
                })}
              </p>
              <ImageModelSelector
                preference={imageModelPreference}
                description={t("api.runtime.imageModelDescription")}
                className="mt-4 border-t border-border pt-3"
              />
            </div>

            <div className="group rounded-2xl border border-border/80 bg-surface p-4 shadow-[var(--shadow-sm)] transition hover:border-border-strong hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-warning-soft text-warning">
                  <ShieldCheck className="size-5" />
                </span>
                <StatusPill
                  ready={authenticationProviderNames.length > 0}
                  label={
                    authenticationProviderNames.length === 1
                      ? authenticationProviderNames[0]
                      : undefined
                  }
                  readyLabel={t("api.runtime.ready")}
                  notConfiguredLabel={t("api.runtime.notConfigured")}
                />
              </div>
              <p className="mt-5 text-sm font-semibold text-foreground">{t("api.runtime.authentication")}</p>
              <p className="mt-1 text-sm text-muted">
                {authenticationProviderNames.length > 1
                  ? t("api.runtime.bothAuth")
                  : t("api.runtime.authDescription")}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {isAdmin ? (
        <section
          aria-labelledby="api-access-heading"
          className="rounded-3xl border border-border/80 bg-surface shadow-[var(--shadow-md)]"
        >
        <div className="flex flex-col gap-4 border-b border-border/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-strong text-on-strong shadow-sm">
              <KeyRound className="size-5" />
            </span>
            <div>
              <h2 id="api-access-heading" className="font-semibold text-foreground">{t("api.access.title")}</h2>
              <p className="mt-1 text-sm text-muted">{t("api.access.description")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormOpen((current) => !current);
              setFormError(null);
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong shadow-sm transition hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2 focus:ring-offset-surface"
          >
            {formOpen ? <X className="size-4" /> : <Plus className="size-4" />}
            {formOpen ? t("api.access.close") : t("api.access.create")}
          </button>
        </div>

        {createdToken ? (
          <div className="border-b border-warning-border bg-warning-soft/70 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
                <div>
                  <h3 className="font-semibold text-warning">{t("api.access.saveNow")}</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-warning">
                    {t("api.access.saveNowDescription")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreatedToken(null);
                  setCopied(null);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-warning transition hover:bg-warning-soft"
                aria-label={t("api.access.dismissGenerated")}
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-warning-border bg-surface p-2 pl-3 shadow-sm">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-strong sm:text-sm">
                  {createdToken.secret}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText(createdToken.secret, "secret")}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-strong px-3 text-xs font-semibold text-on-strong transition hover:opacity-85"
                >
                  {copied === "secret" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === "secret" ? t("api.access.copied") : t("api.access.copy")}
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-border-strong bg-strong shadow-sm">
              <div className="flex items-center justify-between border-b border-on-strong/10 px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-medium text-on-strong/70">
                  <SquareTerminal className="size-3.5" />
                  {t("api.access.quickTest")}
                </span>
                <button
                  type="button"
                  onClick={() => void copyText(curlExample, "curl")}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-on-strong/70 transition hover:bg-on-strong/10 hover:text-on-strong"
                >
                  {copied === "curl" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === "curl" ? t("api.access.copied") : t("api.access.copyCurl")}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 text-xs leading-6 text-on-strong/75"><code>{curlExample}</code></pre>
            </div>
          </div>
        ) : null}

        {formOpen ? (
          <form onSubmit={createToken} className="border-b border-border/80 bg-surface-subtle/70 p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div>
                <label htmlFor="token-name" className="text-sm font-semibold text-foreground">{t("api.access.name")}</label>
                <p className="mt-1 text-xs text-muted">{t("api.access.nameDescription")}</p>
                <input
                  id="token-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  placeholder={t("api.access.namePlaceholder")}
                  autoFocus
                  className="mt-3 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10"
                />
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-foreground">{t("api.access.expiration")}</legend>
                <p className="mt-1 text-xs text-muted">{t("api.access.expirationDescription")}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                  {([
                    "never",
                    "30-days",
                    "90-days",
                    "custom",
                  ] as ExpiryOption[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setExpiry(value)}
                      className={`h-10 rounded-xl border px-3 text-xs font-semibold transition ${
                        expiry === value
                          ? "border-brand-solid bg-brand-solid text-on-brand shadow-sm"
                          : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
                      }`}
                    >
                      {t(`api.access.expiry.${value}`)}
                    </button>
                  ))}
                </div>
                {expiry === "custom" ? (
                  <input
                    type="datetime-local"
                    value={customExpiry}
                    onChange={(event) => setCustomExpiry(event.target.value)}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10"
                    aria-label={t("api.access.customExpiration")}
                  />
                ) : null}
              </fieldset>
            </div>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold text-foreground">{t("api.access.scopes")}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {scopeOptions.map((scope) => {
                  const selected = scopes.includes(scope.value);
                  return (
                    <button
                      key={scope.value}
                      type="button"
                      onClick={() => toggleScope(scope.value)}
                      aria-pressed={selected}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-brand-border bg-brand-soft/70 ring-1 ring-inset ring-focus/10"
                          : "border-border bg-surface hover:border-border-strong"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${
                          selected ? "border-brand-solid bg-brand-solid text-on-brand" : "border-border-strong bg-surface"
                        }`}
                      >
                        {selected ? <Check className="size-3.5" /> : null}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-foreground">{t(`api.access.scope.${scope.value}.label`)}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted">{t(`api.access.scope.${scope.value}.description`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {formError ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-danger" role="alert">
                <AlertTriangle className="size-4 shrink-0" />
                {formError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="h-10 rounded-xl px-4 text-sm font-semibold text-muted transition hover:bg-surface-hover/70 hover:text-foreground"
              >
                {t("api.access.cancel")}
              </button>
              <button
                type="submit"
                disabled={creating}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong shadow-sm transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {creating ? t("api.access.creating") : t("api.access.create")}
              </button>
            </div>
          </form>
        ) : null}

        {actionError ? (
          <div className="mx-5 mt-5 flex items-start justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger sm:mx-6" role="alert">
            <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} aria-label={t("api.access.dismissError")}><X className="size-4" /></button>
          </div>
        ) : null}

        <div className="px-3 pt-3"><CollectionViewToolbar collection={collection} /></div>
        <ListViewResults list={collection.list}>
        <div className="p-2 sm:p-3">
          {loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-surface-muted" />)}
            </div>
          ) : tokens.length === 0 ? (
            <div className="grid min-h-56 place-items-center px-4 py-10 text-center">
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface-muted text-muted">
                  <LockKeyhole className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-foreground">{t("api.access.emptyTitle")}</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-muted">{t("api.access.emptyDescription")}</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {collection.visibleItems.map((token) => (
                <div data-list-row key={token.id} className="rounded-xl px-3 py-4 transition hover:bg-surface-subtle sm:px-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface text-muted shadow-sm">
                        <Server className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">{token.name}</h3>
                          {token.scopes.map((scope) => (
                            <span key={scope} className="rounded-md bg-surface-muted px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">{scope}</span>
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                          <code className="font-mono text-muted-strong">{token.prefix}</code>
                          <span>{t("api.access.created", { date: formatDate(token.createdAt, t("api.access.unknown"), locale) })}</span>
                          <span>{t("api.access.expires", { date: formatDate(token.expiresAt, t("api.access.never"), locale) })}</span>
                          <span>{t("api.access.lastUsed", { date: formatDate(token.lastUsedAt, t("api.access.never"), locale) })}</span>
                        </div>
                      </div>
                    </div>

                    {confirmRevoke === token.id ? (
                      <div className="flex flex-col gap-2 rounded-xl border border-danger-border bg-danger-soft p-2.5 sm:flex-row sm:items-center">
                        <span className="px-1 text-xs font-medium text-danger">{t("api.access.revokeConfirm")}</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmRevoke(null)}
                            className="h-8 rounded-lg px-3 text-xs font-semibold text-muted transition hover:bg-surface"
                          >
                            {t("api.access.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void revokeToken(token.id)}
                            disabled={revoking === token.id}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-danger px-3 text-xs font-semibold text-on-strong transition hover:opacity-85 disabled:opacity-60"
                          >
                            {revoking === token.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            {t("api.access.revoke")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(token.id)}
                        className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg px-3 text-xs font-semibold text-muted transition hover:bg-danger-soft hover:text-danger lg:self-auto"
                      >
                        <Trash2 className="size-3.5" />
                        {t("api.access.revoke")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
          </ListViewResults>
      </section>
      ) : null}
    </div>
  );
}
