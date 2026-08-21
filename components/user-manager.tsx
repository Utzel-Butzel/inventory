"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "next-auth/react";
import { useT } from "next-i18next/client";

import type { UserRole } from "@/db/schema";

type ManagedUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  passwordUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

type ManagedRole = {
  key: UserRole;
  name: string;
  description: string;
  memberCount: number;
};

const fallbackRoles: ManagedRole[] = [
  { key: "admin", name: "Admin", description: "Full workspace access", memberCount: 0 },
  { key: "editor", name: "Editor", description: "Inventory and operations", memberCount: 0 },
  { key: "viewer", name: "Viewer", description: "Read-only access", memberCount: 0 },
];

function errorMessage(payload: unknown, fallback: string) {
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

function formatDate(value: string | null, empty: string, locale: string) {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function initials(name: string, email: string, fallback: string) {
  const source = name.trim() || email.split("@")[0] || fallback;
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
    : source.slice(0, 2)
  ).toUpperCase();
}

export function UserManager() {
  const { t, i18n } = useT(["settings", "common"]);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>(fallbackRoles);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>("editor");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("users.errors.loadWorkspace")));
      }
      const result = payload as {
        users?: ManagedUser[];
        roles?: ManagedRole[];
        currentUserId?: string | null;
      };
      setUsers(Array.isArray(result.users) ? result.users : []);
      if (Array.isArray(result.roles) && result.roles.length) {
        setRoles(result.roles);
        setRole((current) =>
          result.roles!.some((option) => option.key === current)
            ? current
            : (result.roles![0]?.key ?? "viewer"),
        );
      }
      setCurrentUserId(result.currentUserId ?? null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("users.errors.load"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(
    () => users.filter((user) => user.isActive).length,
    [users],
  );

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("users.errors.create")));
      }
      const created = (payload as { user: ManagedUser }).user;
      setUsers((current) =>
        [...current, created].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      );
      setName("");
      setEmail("");
      setPassword("");
      setRole("editor");
      setShowPassword(false);
      setFormOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("users.errors.create"));
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(id: string, changes: Record<string, unknown>) {
    setSavingId(id);
    setActionError(null);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("users.errors.update")));
      }
      const updated = (payload as { user: ManagedUser }).user;
      setUsers((current) =>
        current.map((user) => (user.id === updated.id ? updated : user)),
      );
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("users.errors.update"));
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function submitPasswordReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;
    setResetError(null);
    setSavingId(resetUser.id);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(resetUser.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("users.errors.reset")));
      }
      const updated = (payload as { user: ManagedUser }).user;
      setUsers((current) =>
        current.map((user) => (user.id === updated.id ? updated : user)),
      );
      if (resetUser.id === currentUserId) {
        await signOut({ redirectTo: "/login" });
        return;
      }
      setResetUser(null);
      setResetPassword("");
      setShowResetPassword(false);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : t("users.errors.reset"));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section
      aria-labelledby="users-heading"
      className="overflow-hidden rounded-3xl border border-border/80 bg-surface shadow-[var(--shadow-md)]"
    >
      <div className="flex flex-col gap-4 border-b border-border/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand shadow-sm shadow-[var(--shadow-sm)]">
            <Users className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="users-heading" className="font-semibold text-foreground">
                {t("users.title")}
              </h2>
              {!loading ? (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted">
                  {t("users.activeCount", { count: activeCount })}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              {t("users.description")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-muted shadow-sm transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
            aria-label={t("users.refresh")}
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              setFormOpen((current) => !current);
              setFormError(null);
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-solid px-4 text-sm font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover"
          >
            {formOpen ? <X className="size-4" /> : <UserPlus className="size-4" />}
            {formOpen ? t("users.close") : t("users.add")}
          </button>
        </div>
      </div>

      {formOpen ? (
        <form onSubmit={createUser} className="border-b border-brand-border bg-brand-soft/45 p-5 sm:p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="text-xs font-semibold text-muted-strong">{t("users.fullName")}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={160}
                autoFocus
                placeholder={t("users.namePlaceholder")}
                className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-strong">{t("users.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={320}
                autoComplete="off"
                placeholder={t("users.emailPlaceholder")}
                className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-strong">{t("users.temporaryPassword")}</span>
              <span className="relative mt-2 block">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                  placeholder={t("users.passwordPlaceholder")}
                  className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 pr-11 text-sm text-foreground shadow-sm outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-muted-strong"
                  aria-label={showPassword ? t("users.hidePassword") : t("users.showPassword")}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-strong">{t("users.role")}</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10"
              >
                {roles.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted">
              {t("users.passwordDelivery")}
            </p>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong transition hover:opacity-85 disabled:opacity-60"
            >
              {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {creating ? t("users.creating") : t("users.createAccount")}
            </button>
          </div>
          {formError ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-danger" role="alert">
              <AlertTriangle className="size-4 shrink-0" /> {formError}
            </p>
          ) : null}
        </form>
      ) : null}

      {actionError ? (
        <div className="mx-5 mt-5 flex items-start justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger sm:mx-6" role="alert">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {actionError}
          </span>
          <button type="button" onClick={() => setActionError(null)} aria-label={t("users.dismissError")}>
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="p-2 sm:p-3">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-surface-muted" />
            ))}
          </div>
        ) : loadError ? (
          <div className="grid min-h-44 place-items-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto size-6 text-danger" />
              <p className="mt-3 text-sm font-semibold text-foreground">{t("users.loadTitle")}</p>
              <p className="mt-1 text-sm text-muted">{loadError}</p>
              <button type="button" onClick={() => void load()} className="mt-3 text-sm font-semibold text-brand hover:underline">
                {t("users.retry")}
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {users.map((user) => {
              const isCurrent = user.id === currentUserId;
              const saving = savingId === user.id;
              return (
                <article key={user.id} className={`rounded-2xl px-3 py-4 transition hover:bg-surface-subtle sm:px-4 ${user.isActive ? "" : "opacity-60"}`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`grid size-11 shrink-0 place-items-center rounded-full text-xs font-bold ${user.isActive ? "bg-brand-soft text-brand" : "bg-surface-hover text-muted"}`}>
                        {initials(user.name, user.email, t("common:state.unknown"))}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">{user.name}</h3>
                          {isCurrent ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">{t("users.you")}</span> : null}
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${user.isActive ? "bg-success-soft text-success" : "bg-surface-muted text-muted"}`}>
                            {user.isActive ? <CheckCircle2 className="size-3" /> : <UserX className="size-3" />}
                            {user.isActive ? t("users.active") : t("users.disabled")}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted">{user.email}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                          <span>{t("users.lastSignIn", { date: formatDate(user.lastLoginAt, t("users.never"), locale) })}</span>
                          <span>{t("users.added", { date: formatDate(user.createdAt, t("users.never"), locale) })}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex items-center gap-2">
                        <span className="sr-only">{t("users.roleFor", { name: user.name })}</span>
                        <ShieldCheck className="size-4 text-muted" />
                        <select
                          value={user.role}
                          disabled={saving || isCurrent}
                          onChange={(event) => void updateUser(user.id, { role: event.target.value })}
                          title={roles.find((option) => option.key === user.role)?.description}
                          className="h-9 min-w-28 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold capitalize text-muted-strong outline-none focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-subtle"
                        >
                          {roles.map((option) => (
                            <option key={option.key} value={option.key}>{option.name}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setResetUser(user);
                          setResetPassword("");
                          setResetError(null);
                        }}
                        disabled={saving}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
                      >
                        <KeyRound className="size-3.5" /> {t("users.resetPassword")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateUser(user.id, { isActive: !user.isActive })}
                        disabled={saving || isCurrent}
                        className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${user.isActive ? "text-danger hover:bg-danger-soft" : "text-success hover:bg-success-soft"}`}
                      >
                        {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : user.isActive ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
                        {user.isActive ? t("users.disable") : t("users.enable")}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-surface-subtle/60 px-5 py-4 sm:px-6">
        <p className="text-xs leading-5 text-muted">
          {t("users.externalAuthNote")}
        </p>
      </div>

      {resetUser ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-overlay p-4 backdrop-blur-sm" role="presentation">
          <form onSubmit={submitPasswordReset} className="w-full max-w-md rounded-3xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-foreground">{t("users.resetPassword")}</h3>
                <p className="mt-1 text-sm text-muted">{t("users.resetDescription", { name: resetUser.name })}</p>
              </div>
              <button type="button" onClick={() => setResetUser(null)} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-muted-strong" aria-label={t("users.close")}>
                <X className="size-4" />
              </button>
            </div>
            <label className="mt-5 block">
              <span className="text-xs font-semibold text-muted-strong">{t("users.newPassword")}</span>
              <span className="relative mt-2 block">
                <input
                  type={showResetPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                  autoFocus
                  placeholder={t("users.passwordPlaceholder")}
                  className="h-11 w-full rounded-xl border border-border bg-surface px-3.5 pr-11 text-sm text-foreground shadow-sm outline-none focus:border-focus focus:ring-4 focus:ring-focus/10"
                />
                <button type="button" onClick={() => setShowResetPassword((current) => !current)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-muted-strong" aria-label={showResetPassword ? t("users.hidePassword") : t("users.showPassword")}>
                  {showResetPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            {resetError ? <p className="mt-3 flex items-center gap-2 text-sm text-danger" role="alert"><AlertTriangle className="size-4" />{resetError}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setResetUser(null)} className="h-10 rounded-xl px-4 text-sm font-semibold text-muted hover:bg-surface-muted">{t("users.cancel")}</button>
              <button type="submit" disabled={savingId === resetUser.id} className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong hover:opacity-85 disabled:opacity-60">
                {savingId === resetUser.id ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {t("users.savePassword")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
