"use client";

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
  Server,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  label: string;
  description: string;
}> = [
  { value: "read", label: "Read", description: "View resources and media" },
  { value: "write", label: "Write", description: "Create, edit, and merge" },
  { value: "ai", label: "AI", description: "Run analysis and generation" },
];

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

function formatDate(value: string | null | undefined, empty = "Never") {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function StatusPill({ ready, label }: { ready: boolean; label?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        ready
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
          : "bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200"
      }`}
    >
      {ready ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
      {label ?? (ready ? "Ready" : "Not configured")}
    </span>
  );
}

function LoadingBlock() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading runtime configuration">
      {Array.from({ length: 4 }, (_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-2xl border border-zinc-200/80 bg-zinc-50"
        />
      ))}
    </div>
  );
}

export function ApiTokenManager({ isAdmin }: { isAdmin: boolean }) {
  const imageModelPreference = useImageModelPreference();
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
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
          getErrorMessage(statusPayload, "Could not load runtime configuration."),
        );
      }
      setRuntime(statusPayload as RuntimeStatus);
      if (isAdmin) {
        const tokenResponse = await fetch("/api/tokens", { cache: "no-store" });
        const tokenPayload = await tokenResponse.json().catch(() => null);
        if (!tokenResponse.ok) {
          throw new Error(getErrorMessage(tokenPayload, "Could not load API tokens."));
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
      setLoadError(error instanceof Error ? error.message : "Could not load settings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin]);

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
      setFormError("Give this token a name so it is easy to recognize later.");
      return;
    }
    if (expiry === "custom" && !expiresAt) {
      setFormError("Choose a valid expiration date and time.");
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setFormError("Expiration must be in the future.");
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
        throw new Error(getErrorMessage(payload, "Could not create the token."));
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
      setFormError(error instanceof Error ? error.message : "Could not create the token.");
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
      setActionError("Clipboard access was blocked. Select and copy the text manually.");
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
        throw new Error(getErrorMessage(payload, "Could not revoke the token."));
      }
      setTokens((current) => current.filter((token) => token.id !== id));
      setConfirmRevoke(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not revoke the token.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="runtime-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="runtime-heading" className="text-base font-semibold text-zinc-950">
              Runtime configuration
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              A live view of services enabled by this deployment&apos;s environment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh settings"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : loadError && !runtime ? (
          <div className="flex items-start justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Settings could not be loaded</p>
                <p className="mt-1 text-rose-700">{loadError}</p>
              </div>
            </div>
            <button type="button" onClick={() => void load()} className="font-semibold hover:underline">
              Retry
            </button>
          </div>
        ) : runtime ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-zinc-300 hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  {runtime.storage.provider === "local" ? <HardDrive className="size-5" /> : <Cloud className="size-5" />}
                </span>
                <StatusPill ready={runtime.storage.configured} />
              </div>
              <p className="mt-5 text-sm font-semibold text-zinc-900">File storage</p>
              <p className="mt-1 text-sm capitalize text-zinc-600">{runtime.storage.provider} provider</p>
            </div>

            <div className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-zinc-300 hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-600">
                  <Sparkles className="size-5" />
                </span>
                <StatusPill ready={runtime.ai.analysis} />
              </div>
              <p className="mt-5 text-sm font-semibold text-zinc-900">AI analysis</p>
              <p className="mt-1 text-sm text-zinc-600">Metadata and batch enrichment</p>
            </div>

            <div className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-zinc-300 hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-fuchsia-50 text-fuchsia-600">
                  <Database className="size-5" />
                </span>
                <StatusPill ready={runtime.ai.imageGeneration} />
              </div>
              <p className="mt-5 text-sm font-semibold text-zinc-900">Image generation</p>
              <p className="mt-1 text-sm capitalize text-zinc-600">
                {imageModelPreference.selectedModel?.provider ?? runtime.ai.imageProvider} provider
              </p>
              <ImageModelSelector
                preference={imageModelPreference}
                description="Used for covers created in this browser."
                className="mt-4 border-t border-zinc-100 pt-3"
              />
            </div>

            <div className="group rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-zinc-300 hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
                  <ShieldCheck className="size-5" />
                </span>
                <StatusPill
                  ready={runtime.auth.password || runtime.auth.auth0}
                  label={runtime.auth.auth0 ? "Auth0" : runtime.auth.password ? "Password" : undefined}
                />
              </div>
              <p className="mt-5 text-sm font-semibold text-zinc-900">Authentication</p>
              <p className="mt-1 text-sm text-zinc-600">
                {runtime.auth.password && runtime.auth.auth0
                  ? "Password and Auth0 enabled"
                  : "Workspace sign-in provider"}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {isAdmin ? (
        <section
          aria-labelledby="api-access-heading"
          className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
        >
        <div className="flex flex-col gap-4 border-b border-zinc-200/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-950 text-white shadow-sm">
              <KeyRound className="size-5" />
            </span>
            <div>
              <h2 id="api-access-heading" className="font-semibold text-zinc-950">API access</h2>
              <p className="mt-1 text-sm text-zinc-600">Scoped bearer tokens for scripts and integrations.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormOpen((current) => !current);
              setFormError(null);
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            {formOpen ? <X className="size-4" /> : <Plus className="size-4" />}
            {formOpen ? "Close" : "Create token"}
          </button>
        </div>

        {createdToken ? (
          <div className="border-b border-amber-200 bg-amber-50/70 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
                <div>
                  <h3 className="font-semibold text-amber-950">Save your token now</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-amber-800">
                    This secret is shown once and cannot be recovered. Store it in a password manager or secret vault before closing this panel.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreatedToken(null);
                  setCopied(null);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-amber-700 transition hover:bg-amber-100"
                aria-label="Dismiss generated token"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-amber-200 bg-white p-2 pl-3 shadow-sm">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-800 sm:text-sm">
                  {createdToken.secret}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText(createdToken.secret, "secret")}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800"
                >
                  {copied === "secret" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === "secret" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-sm">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-medium text-zinc-400">
                  <SquareTerminal className="size-3.5" />
                  Quick test
                </span>
                <button
                  type="button"
                  onClick={() => void copyText(curlExample, "curl")}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/10 hover:text-white"
                >
                  {copied === "curl" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === "curl" ? "Copied" : "Copy curl"}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 text-xs leading-6 text-zinc-300"><code>{curlExample}</code></pre>
            </div>
          </div>
        ) : null}

        {formOpen ? (
          <form onSubmit={createToken} className="border-b border-zinc-200/80 bg-zinc-50/70 p-5 sm:p-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div>
                <label htmlFor="token-name" className="text-sm font-semibold text-zinc-900">Token name</label>
                <p className="mt-1 text-xs text-zinc-600">Use a name that identifies the integration.</p>
                <input
                  id="token-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  placeholder="Warehouse sync"
                  autoFocus
                  className="mt-3 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 shadow-sm outline-none transition placeholder:text-zinc-600 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-zinc-900">Expiration</legend>
                <p className="mt-1 text-xs text-zinc-600">Shorter-lived credentials reduce exposure.</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                  {([
                    ["never", "Never"],
                    ["30-days", "30 days"],
                    ["90-days", "90 days"],
                    ["custom", "Custom"],
                  ] as Array<[ExpiryOption, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setExpiry(value)}
                      className={`h-10 rounded-xl border px-3 text-xs font-semibold transition ${
                        expiry === value
                          ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {expiry === "custom" ? (
                  <input
                    type="datetime-local"
                    value={customExpiry}
                    onChange={(event) => setCustomExpiry(event.target.value)}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    className="mt-2 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                    aria-label="Custom expiration date"
                  />
                ) : null}
              </fieldset>
            </div>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold text-zinc-900">Scopes</legend>
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
                          ? "border-indigo-300 bg-indigo-50/70 ring-1 ring-inset ring-indigo-200"
                          : "border-zinc-200 bg-white hover:border-zinc-300"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border ${
                          selected ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 bg-white"
                        }`}
                      >
                        {selected ? <Check className="size-3.5" /> : null}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-zinc-900">{scope.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-zinc-600">{scope.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {formError ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-rose-700" role="alert">
                <AlertTriangle className="size-4 shrink-0" />
                {formError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="h-10 rounded-xl px-4 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-200/70 hover:text-zinc-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {creating ? "Creating…" : "Create token"}
              </button>
            </div>
          </form>
        ) : null}

        {actionError ? (
          <div className="mx-5 mt-5 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 sm:mx-6" role="alert">
            <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error"><X className="size-4" /></button>
          </div>
        ) : null}

        <div className="p-2 sm:p-3">
          {loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-zinc-100" />)}
            </div>
          ) : tokens.length === 0 ? (
            <div className="grid min-h-56 place-items-center px-4 py-10 text-center">
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-600">
                  <LockKeyhole className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-zinc-900">No active API tokens</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-zinc-600">Create a scoped token when you are ready to connect a script or another service.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {tokens.map((token) => (
                <div key={token.id} className="rounded-xl px-3 py-4 transition hover:bg-zinc-50 sm:px-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm">
                        <Server className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-zinc-950">{token.name}</h3>
                          {token.scopes.map((scope) => (
                            <span key={scope} className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{scope}</span>
                          ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                          <code className="font-mono text-zinc-700">{token.prefix}</code>
                          <span>Created {formatDate(token.createdAt, "Unknown")}</span>
                          <span>Expires {formatDate(token.expiresAt)}</span>
                          <span>Last used {formatDate(token.lastUsedAt, "Never")}</span>
                        </div>
                      </div>
                    </div>

                    {confirmRevoke === token.id ? (
                      <div className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 sm:flex-row sm:items-center">
                        <span className="px-1 text-xs font-medium text-rose-800">Revoke this token?</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmRevoke(null)}
                            className="h-8 rounded-lg px-3 text-xs font-semibold text-zinc-600 transition hover:bg-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void revokeToken(token.id)}
                            disabled={revoking === token.id}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                          >
                            {revoking === token.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            Revoke
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(token.id)}
                        className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg px-3 text-xs font-semibold text-zinc-600 transition hover:bg-rose-50 hover:text-rose-700 lg:self-auto"
                      >
                        <Trash2 className="size-3.5" />
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </section>
      ) : null}
    </div>
  );
}
