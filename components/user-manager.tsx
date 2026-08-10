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

const roles: Array<{
  value: UserRole;
  label: string;
  description: string;
}> = [
  { value: "admin", label: "Admin", description: "Users, tokens, and all inventory actions" },
  { value: "editor", label: "Editor", description: "Inventory, stock, uploads, and AI" },
  { value: "viewer", label: "Viewer", description: "Read-only access to shared inventory" },
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

function formatDate(value: string | null, empty = "Never") {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "User";
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
    : source.slice(0, 2)
  ).toUpperCase();
}

export function UserManager() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
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
        throw new Error(errorMessage(payload, "Could not load workspace users."));
      }
      const result = payload as {
        users?: ManagedUser[];
        currentUserId?: string | null;
      };
      setUsers(Array.isArray(result.users) ? result.users : []);
      setCurrentUserId(result.currentUserId ?? null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load users.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
        throw new Error(errorMessage(payload, "Could not create this user."));
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
      setFormError(error instanceof Error ? error.message : "Could not create this user.");
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
        throw new Error(errorMessage(payload, "Could not update this user."));
      }
      const updated = (payload as { user: ManagedUser }).user;
      setUsers((current) =>
        current.map((user) => (user.id === updated.id ? updated : user)),
      );
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update this user.");
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
        throw new Error(errorMessage(payload, "Could not reset this password."));
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
      setResetError(error instanceof Error ? error.message : "Could not reset this password.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section
      aria-labelledby="users-heading"
      className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-col gap-4 border-b border-zinc-200/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-200">
            <Users className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="users-heading" className="font-semibold text-zinc-950">
                Workspace users
              </h2>
              {!loading ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">
                  {activeCount} active
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Individual local accounts sharing the same inventory workspace.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            className="grid size-10 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-50"
            aria-label="Refresh users"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => {
              setFormOpen((current) => !current);
              setFormError(null);
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            {formOpen ? <X className="size-4" /> : <UserPlus className="size-4" />}
            {formOpen ? "Close" : "Add user"}
          </button>
        </div>
      </div>

      {formOpen ? (
        <form onSubmit={createUser} className="border-b border-indigo-100 bg-indigo-50/45 p-5 sm:p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Full name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={160}
                autoFocus
                placeholder="Ada Lovelace"
                className="mt-2 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={320}
                autoComplete="off"
                placeholder="ada@example.com"
                className="mt-2 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Temporary password</span>
              <span className="relative mt-2 block">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 pr-11 text-sm text-zinc-950 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-zinc-400 hover:text-zinc-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Role</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                className="mt-2 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              >
                {roles.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-zinc-500">
              Send the password through a secure channel. There is no public registration.
            </p>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
            >
              {creating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {creating ? "Creating…" : "Create account"}
            </button>
          </div>
          {formError ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-rose-700" role="alert">
              <AlertTriangle className="size-4 shrink-0" /> {formError}
            </p>
          ) : null}
        </form>
      ) : null}

      {actionError ? (
        <div className="mx-5 mt-5 flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 sm:mx-6" role="alert">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {actionError}
          </span>
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="p-2 sm:p-3">
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
            ))}
          </div>
        ) : loadError ? (
          <div className="grid min-h-44 place-items-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto size-6 text-rose-500" />
              <p className="mt-3 text-sm font-semibold text-zinc-900">Users could not be loaded</p>
              <p className="mt-1 text-sm text-zinc-500">{loadError}</p>
              <button type="button" onClick={() => void load()} className="mt-3 text-sm font-semibold text-indigo-600 hover:underline">
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {users.map((user) => {
              const isCurrent = user.id === currentUserId;
              const saving = savingId === user.id;
              return (
                <article key={user.id} className={`rounded-2xl px-3 py-4 transition hover:bg-zinc-50 sm:px-4 ${user.isActive ? "" : "opacity-60"}`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`grid size-11 shrink-0 place-items-center rounded-full text-xs font-bold ${user.isActive ? "bg-indigo-100 text-indigo-700" : "bg-zinc-200 text-zinc-500"}`}>
                        {initials(user.name, user.email)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-zinc-950">{user.name}</h3>
                          {isCurrent ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">You</span> : null}
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${user.isActive ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
                            {user.isActive ? <CheckCircle2 className="size-3" /> : <UserX className="size-3" />}
                            {user.isActive ? "Active" : "Disabled"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-zinc-500">{user.email}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                          <span>Last sign-in {formatDate(user.lastLoginAt)}</span>
                          <span>Added {formatDate(user.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex items-center gap-2">
                        <span className="sr-only">Role for {user.name}</span>
                        <ShieldCheck className="size-4 text-zinc-400" />
                        <select
                          value={user.role}
                          disabled={saving || isCurrent}
                          onChange={(event) => void updateUser(user.id, { role: event.target.value })}
                          title={roles.find((entry) => entry.value === user.role)?.description}
                          className="h-9 min-w-28 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-semibold capitalize text-zinc-700 outline-none focus:border-indigo-400 focus:ring-3 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-zinc-50"
                        >
                          {roles.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
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
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50"
                      >
                        <KeyRound className="size-3.5" /> Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateUser(user.id, { isActive: !user.isActive })}
                        disabled={saving || isCurrent}
                        className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${user.isActive ? "text-rose-600 hover:bg-rose-50" : "text-emerald-700 hover:bg-emerald-50"}`}
                      >
                        {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : user.isActive ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
                        {user.isActive ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-4 sm:px-6">
        <p className="text-xs leading-5 text-zinc-500">
          Auth0 identities are managed in Auth0. Their workspace role comes from the configured role claim or the deployment&apos;s Auth0 default role.
        </p>
      </div>

      {resetUser ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 p-4 backdrop-blur-sm" role="presentation">
          <form onSubmit={submitPasswordReset} className="w-full max-w-md rounded-3xl border border-white/40 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-zinc-950">Reset password</h3>
                <p className="mt-1 text-sm text-zinc-500">Set a new password for {resetUser.name}. Existing sessions will be signed out.</p>
              </div>
              <button type="button" onClick={() => setResetUser(null)} className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <label className="mt-5 block">
              <span className="text-xs font-semibold text-zinc-700">New password</span>
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
                  placeholder="At least 12 characters"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3.5 pr-11 text-sm text-zinc-950 shadow-sm outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
                <button type="button" onClick={() => setShowResetPassword((current) => !current)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-zinc-400 hover:text-zinc-700" aria-label={showResetPassword ? "Hide password" : "Show password"}>
                  {showResetPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            {resetError ? <p className="mt-3 flex items-center gap-2 text-sm text-rose-700" role="alert"><AlertTriangle className="size-4" />{resetError}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setResetUser(null)} className="h-10 rounded-xl px-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-100">Cancel</button>
              <button type="submit" disabled={savingId === resetUser.id} className="inline-flex h-10 items-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {savingId === resetUser.id ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                Save password
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
