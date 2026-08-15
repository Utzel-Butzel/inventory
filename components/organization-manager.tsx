"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import {
  useOrganizationHref,
  useOrganizationReadOnly,
} from "@/components/organization-routing";
import { organizationPath } from "@/lib/organization-path";

type ManagedOrganization = {
  id: string;
  name: string;
  slug: string;
  role: string;
  roleName: string;
  isActive?: boolean;
  canManage?: boolean;
};

type OrganizationsResponse = {
  organizations?: ManagedOrganization[];
  activeOrganizationId?: string | null;
  organization?: { id: string } | null;
  activeOrganization?: { id: string } | null;
};

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

function roleFallback(role: string) {
  return role
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function OrganizationManager() {
  const { t } = useT("settings");
  const organizationHref = useOrganizationHref();
  const isReadOnly = useOrganizationReadOnly();
  const [organizations, setOrganizations] = useState<ManagedOrganization[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/v1/organizations", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("organizations.errors.load")));
      }
      const result = (payload ?? {}) as OrganizationsResponse;
      const nextOrganizations = Array.isArray(result.organizations)
        ? result.organizations
        : [];
      setOrganizations(nextOrganizations);
      setActiveOrganizationId(
        result.activeOrganizationId ??
          result.activeOrganization?.id ??
          result.organization?.id ??
          nextOrganizations.find((organization) => organization.isActive)?.id ??
          null,
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : t("organizations.errors.load"),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearMessages() {
    setNotice(null);
    setActionError(null);
  }

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    clearMessages();
    setCreating(true);
    try {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("organizations.errors.create")));
      }
      setNewName("");
      setCreateOpen(false);
      // Creation selects the new organization server-side. Reload the shell so
      // no client state from the previous authorization boundary survives.
      const createdOrganizationId = (payload as OrganizationsResponse)
        .organization?.id;
      window.location.assign(
        createdOrganizationId
          ? organizationPath(createdOrganizationId, "/settings/organization")
          : organizationHref("/settings/organization"),
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("organizations.errors.create"),
      );
    } finally {
      setCreating(false);
    }
  }

  function editOrganization(organization: ManagedOrganization) {
    clearMessages();
    setEditingId(organization.id);
    setEditingName(organization.name);
  }

  function closeEditor() {
    setEditingId(null);
    setEditingName("");
  }

  async function updateOrganization(
    event: React.FormEvent<HTMLFormElement>,
    organization: ManagedOrganization,
  ) {
    event.preventDefault();
    const name = editingName.trim();
    if (!name) return;

    clearMessages();
    setSaving(true);
    try {
      const response = await fetch(
        `/api/v1/organizations/${encodeURIComponent(organization.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(errorMessage(payload, t("organizations.errors.update")));
      }
      closeEditor();
      setNotice(t("organizations.notices.updated", { name }));
      if (organization.id === activeOrganizationId) {
        window.location.assign(organizationHref("/settings/organization"));
      } else {
        await load(true);
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t("organizations.errors.update"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "grid gap-6",
        !isReadOnly &&
          "xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]",
      )}
    >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand shadow-sm">
              <Building2 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-foreground">
                  {t("organizations.list.title")}
                </h2>
                {!loading ? (
                  <Badge>{t("organizations.list.count", { count: organizations.length })}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                {t("organizations.list.description")}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void load(true)}
            disabled={loading || refreshing}
            aria-label={t("organizations.actions.refresh")}
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {t("organizations.actions.refresh")}
          </Button>
        </div>

        {notice ? (
          <div className="mx-5 mt-5 flex items-start justify-between gap-3 rounded-xl border border-success-border bg-success-soft p-3 text-sm text-success sm:mx-6" role="status">
            <span className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {notice}
            </span>
            <button type="button" onClick={() => setNotice(null)} aria-label={t("organizations.actions.dismissNotice")}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {actionError ? (
          <div className="mx-5 mt-5 flex items-start justify-between gap-3 rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger sm:mx-6" role="alert">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {actionError}
            </span>
            <button type="button" onClick={() => setActionError(null)} aria-label={t("organizations.actions.dismissError")}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="p-3 sm:p-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }, (_, index) => (
                <Skeleton key={index} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : loadError ? (
            <div className="grid min-h-52 place-items-center p-6 text-center">
              <div>
                <AlertTriangle className="mx-auto size-6 text-danger" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-foreground">
                  {t("organizations.errors.loadTitle")}
                </p>
                <p className="mt-1 text-sm text-muted">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-3 text-sm font-semibold text-brand hover:underline"
                >
                  {t("organizations.actions.retry")}
                </button>
              </div>
            </div>
          ) : organizations.length === 0 ? (
            <EmptyState
              icon={<Building2 className="size-5" aria-hidden="true" />}
              title={t("organizations.list.emptyTitle")}
              description={t("organizations.list.emptyDescription")}
            />
          ) : (
            <div className="divide-y divide-border">
              {organizations.map((organization) => {
                const active = organization.id === activeOrganizationId;
                const editing = editingId === organization.id;
                const canManage =
                  !isReadOnly &&
                  (organization.canManage ??
                    (organization.role === "admin" ||
                      organization.role === "owner"));
                return (
                  <article key={organization.id} className="rounded-2xl px-3 py-4 transition hover:bg-surface-subtle sm:px-4">
                    {editing ? (
                      <form onSubmit={(event) => void updateOrganization(event, organization)}>
                        <label className="block">
                          <span className="text-xs font-semibold text-muted-strong">
                            {t("organizations.form.name")}
                          </span>
                          <input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            required
                            maxLength={160}
                            autoFocus
                            className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10"
                          />
                        </label>
                        <div className="mt-3 flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={closeEditor} disabled={saving}>
                            {t("organizations.actions.cancel")}
                          </Button>
                          <Button size="sm" type="submit" disabled={saving || !editingName.trim()}>
                            {saving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
                            {saving ? t("organizations.actions.saving") : t("organizations.actions.save")}
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-semibold text-foreground">
                              {organization.name}
                            </h3>
                            {active ? <Badge tone="brand">{t("organizations.list.active")}</Badge> : null}
                            <Badge>{organization.roleName || roleFallback(organization.role)}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {t("organizations.list.slug", { slug: organization.slug })}
                          </p>
                        </div>
                        {canManage ? (
                          <Button variant="ghost" size="sm" onClick={() => editOrganization(organization)}>
                            <Pencil className="size-3.5" aria-hidden="true" />
                            {t("organizations.actions.rename")}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {!isReadOnly ? <Card className="h-fit overflow-hidden">
        <div className="border-b border-border px-5 py-5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">
                {t("organizations.create.title")}
              </h2>
              <p className="mt-1 text-sm leading-5 text-muted">
                {t("organizations.create.description")}
              </p>
            </div>
            {!createOpen ? (
              <Button size="sm" onClick={() => { clearMessages(); setCreateOpen(true); }}>
                <Plus className="size-3.5" aria-hidden="true" />
                {t("organizations.actions.create")}
              </Button>
            ) : null}
          </div>
        </div>
        {createOpen ? (
          <form onSubmit={createOrganization} className="p-5 sm:p-6">
            <label className="block">
              <span className="text-xs font-semibold text-muted-strong">
                {t("organizations.form.name")}
              </span>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                required
                maxLength={160}
                autoFocus
                placeholder={t("organizations.form.namePlaceholder")}
                className="mt-2 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10"
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-muted">
              {t("organizations.form.slugHint")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setCreateOpen(false); setNewName(""); }} disabled={creating}>
                {t("organizations.actions.cancel")}
              </Button>
              <Button size="sm" type="submit" disabled={creating || !newName.trim()}>
                {creating ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                {creating ? t("organizations.actions.creating") : t("organizations.actions.create")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="px-5 py-5 text-xs leading-5 text-muted sm:px-6">
            {t("organizations.create.hint")}
          </div>
        )}
      </Card> : null}
    </div>
  );
}
