"use client";

import Link from "next/link";
import { useT } from "next-i18next/client";
import {
  Check,
  Copy,
  ExternalLink,
  Globe2,
  Link2,
  LockKeyhole,
  LoaderCircle,
  PackageOpen,
  Search,
  ShieldAlert,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";
import type {
  CustomFieldDefinition,
  CustomFieldValue,
  CustomFieldValues,
} from "@/lib/custom-field-contract";
import type { PublicShareFilter } from "@/lib/public-share-contract";

type PublicShareSummary = {
  id: string;
  name: string;
  scope: "inventory" | "item";
  resourceId: string | null;
  resourceName: string | null;
  filter: PublicShareFilter | null;
  accessMode: "view" | "stock";
  passwordProtected: boolean;
  createdBy: string | null;
  createdAt: string;
};

type ShareScope = PublicShareSummary["scope"];

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted";
const labelClass = "block text-xs font-semibold text-muted-strong";

function hasFilterValue(value: CustomFieldValue | undefined) {
  if (value === undefined || value === "") return false;
  return !Array.isArray(value) || value.length > 0;
}

function sharePath(id: string) {
  return `/share/${encodeURIComponent(id)}`;
}

export function PublicShareManager() {
  const { t, i18n } = useT(["settings", "common"]);
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const [shares, setShares] = useState<PublicShareSummary[]>([]);
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scope, setScope] = useState<ShareScope>("inventory");
  const [accessMode, setAccessMode] = useState<"view" | "stock">("view");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [filterFieldKey, setFilterFieldKey] = useState("");
  const [filterValues, setFilterValues] = useState<CustomFieldValues>({});
  const [resourceQuery, setResourceQuery] = useState("");
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [selectedResource, setSelectedResource] =
    useState<ClientResource | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedDefinition = useMemo(
    () => definitions.find((definition) => definition.key === filterFieldKey),
    [definitions, filterFieldKey],
  );
  const definitionsByKey = useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [shareResult, definitionResult] = await Promise.all([
        fetchJson<{ shares: PublicShareSummary[] }>("/api/v1/public-shares", {
          cache: "no-store",
        }),
        fetchJson<{ definitions: CustomFieldDefinition[] }>(
          "/api/v1/custom-fields?entityType=inventory",
          { cache: "no-store" },
        ),
      ]);
      setShares(shareResult.shares);
      setDefinitions(definitionResult.definitions);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : t("settings:sharing.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (scope !== "item") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({ page: "1", pageSize: "8" });
      if (resourceQuery.trim()) parameters.set("q", resourceQuery.trim());
      setResourcesLoading(true);
      setResourceError(null);
      void fetchJson<{ resources: ClientResource[] }>(
        `/api/v1/resources?${parameters.toString()}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then((result) => setResources(result.resources))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setResourceError(
            error instanceof Error
              ? error.message
              : t("settings:sharing.errors.loadItems"),
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setResourcesLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [resourceQuery, scope, t]);

  function resetForm() {
    setName("");
    setAccessMode("view");
    setPassword("");
    setFilterFieldKey("");
    setFilterValues({});
    setResourceQuery("");
    setSelectedResource(null);
    setFormError(null);
  }

  async function createShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError(t("settings:sharing.errors.nameRequired"));
      return;
    }

    let payload:
      | {
          scope: "inventory";
          name: string;
          filter: PublicShareFilter | null;
          accessMode: "view" | "stock";
          password?: string;
        }
      | { scope: "item"; name: string; resourceId: string };

    if (scope === "item") {
      if (!selectedResource) {
        setFormError(t("settings:sharing.errors.itemRequired"));
        return;
      }
      payload = {
        scope: "item",
        name: trimmedName,
        resourceId: selectedResource.id,
      };
    } else {
      if (accessMode === "stock" && password.length < 8) {
        setFormError(t("settings:sharing.errors.passwordRequired"));
        return;
      }
      const filterValue = filterFieldKey
        ? filterValues[filterFieldKey]
        : undefined;
      if (filterFieldKey && !hasFilterValue(filterValue)) {
        setFormError(t("settings:sharing.errors.filterValueRequired"));
        return;
      }
      payload = {
        scope: "inventory",
        name: trimmedName,
        accessMode,
        ...(accessMode === "stock" ? { password } : {}),
        filter:
          filterFieldKey && filterValue !== undefined
            ? { fieldKey: filterFieldKey, value: filterValue }
            : null,
      };
    }

    setCreating(true);
    try {
      const result = await fetchJson<{ share: PublicShareSummary }>(
        "/api/v1/public-shares",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setShares((current) => [
        result.share,
        ...current.filter((share) => share.id !== result.share.id),
      ]);
      setNotice(t("settings:sharing.notices.created", { name: result.share.name }));
      resetForm();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : t("settings:sharing.errors.create"),
      );
    } finally {
      setCreating(false);
    }
  }

  async function copyShare(id: string) {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(
        new URL(sharePath(id), window.location.origin).toString(),
      );
      setCopiedId(id);
      window.setTimeout(
        () => setCopiedId((current) => (current === id ? null : current)),
        1_800,
      );
    } catch {
      setActionError(t("settings:sharing.errors.clipboard"));
    }
  }

  async function revokeShare(id: string) {
    setActionError(null);
    setRevoking(id);
    try {
      await fetchJson<void>(`/api/v1/public-shares/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setShares((current) => current.filter((share) => share.id !== id));
      setConfirmRevoke(null);
      setNotice(t("settings:sharing.notices.revoked"));
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : t("settings:sharing.errors.revoke"),
      );
    } finally {
      setRevoking(null);
    }
  }

  function formatFilter(filter: PublicShareFilter) {
    const definition = definitionsByKey.get(filter.fieldKey);
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const formatted = values.map((value) => {
      if (typeof value === "boolean") {
        return value ? t("common:boolean.yes") : t("common:boolean.no");
      }
      if (typeof value === "string" && definition) {
        return (
          definition.options.find((option) => option.value === value)?.label ?? value
        );
      }
      return String(value);
    });
    return t("settings:sharing.list.filterDescription", {
      field: definition?.label ?? filter.fieldKey,
      value: formatted.join(", "),
    });
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(340px,1.05fr)]">
          <div className="border-b border-border bg-surface-subtle p-5 sm:p-6 lg:border-b-0 lg:border-r">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <Globe2 className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("settings:sharing.create.title")}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-muted">
                  {t("settings:sharing.create.description")}
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-warning-border bg-warning-soft/60 p-3.5">
              <div className="flex gap-2.5">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <p className="text-[12px] leading-5 text-warning">
                  {t("settings:sharing.create.warning")}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={createShare} className="space-y-5 p-5 sm:p-6">
            <fieldset>
              <legend className={labelClass}>
                {t("settings:sharing.create.scope")}
              </legend>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["inventory", "item"] as const).map((value) => {
                  const active = scope === value;
                  const Icon = value === "inventory" ? UsersRound : PackageOpen;
                  return (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 transition",
                        active
                          ? "border-brand-border bg-brand-soft text-brand"
                          : "border-border bg-surface text-muted-strong hover:border-border-strong hover:bg-surface-subtle",
                      )}
                    >
                      <input
                        type="radio"
                        name="share-scope"
                        value={value}
                        checked={active}
                        onChange={() => {
                          setScope(value);
                          if (value === "item") {
                            setAccessMode("view");
                            setPassword("");
                          }
                          setFormError(null);
                        }}
                        className="sr-only"
                      />
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="text-xs font-semibold">
                        {t(`settings:sharing.create.scopes.${value}`)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className={labelClass}>
              {t("settings:sharing.create.name")}
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("settings:sharing.create.namePlaceholder")}
                className={inputClass}
              />
            </label>

            {scope === "inventory" ? (
              <div className="space-y-4">
                <fieldset>
                  <legend className={labelClass}>
                    {t("settings:sharing.create.accessMode")}
                  </legend>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {(["view", "stock"] as const).map((value) => (
                      <label
                        key={value}
                        className={cn(
                          "flex min-h-14 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 transition",
                          accessMode === value
                            ? "border-brand-border bg-brand-soft text-brand"
                            : "border-border bg-surface text-muted-strong hover:border-border-strong",
                        )}
                      >
                        <input
                          type="radio"
                          name="share-access-mode"
                          value={value}
                          checked={accessMode === value}
                          onChange={() => {
                            setAccessMode(value);
                            if (value === "view") setPassword("");
                            setFormError(null);
                          }}
                          className="sr-only"
                        />
                        {value === "stock" ? (
                          <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
                        ) : (
                          <Globe2 className="size-4 shrink-0" aria-hidden="true" />
                        )}
                        <span>
                          <span className="block text-xs font-semibold">
                            {t(`settings:sharing.create.accessModes.${value}.label`)}
                          </span>
                          <span className="mt-0.5 block text-[11px] font-normal leading-4 text-muted">
                            {t(`settings:sharing.create.accessModes.${value}.description`)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {accessMode === "stock" ? (
                  <label className={labelClass}>
                    {t("settings:sharing.create.password")}
                    <input
                      type="password"
                      value={password}
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={t("settings:sharing.create.passwordPlaceholder")}
                      className={inputClass}
                    />
                    <span className="mt-1.5 block text-[11px] font-normal leading-4 text-muted">
                      {t("settings:sharing.create.passwordHint")}
                    </span>
                  </label>
                ) : null}
                <label className={labelClass}>
                  {t("settings:sharing.create.filter")}
                  <span className="ml-1 font-normal text-muted">
                    {t("settings:sharing.create.optional")}
                  </span>
                  <select
                    value={filterFieldKey}
                    onChange={(event) => {
                      setFilterFieldKey(event.target.value);
                      setFilterValues({});
                    }}
                    className={inputClass}
                  >
                    <option value="">
                      {t("settings:sharing.create.allInventory")}
                    </option>
                    {definitions.map((definition) => (
                      <option key={definition.id} value={definition.key}>
                        {definition.label}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedDefinition ? (
                  <div className="rounded-xl border border-border bg-surface-subtle p-4">
                    <p className="mb-3 text-[12px] leading-5 text-muted">
                      {t("settings:sharing.create.filterHint", {
                        field: selectedDefinition.label,
                      })}
                    </p>
                    <CustomFieldInputs
                      definitions={[selectedDefinition]}
                      values={filterValues}
                      onChange={setFilterValues}
                      className="sm:grid-cols-1"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <label className={labelClass}>
                  {t("settings:sharing.create.item")}
                  <span className="relative mt-1.5 block">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={resourceQuery}
                      onChange={(event) => setResourceQuery(event.target.value)}
                      placeholder={t("settings:sharing.create.itemPlaceholder")}
                      className={`${inputClass} mt-0 pl-10 pr-10`}
                    />
                    {resourcesLoading ? (
                      <LoaderCircle
                        className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-brand"
                        aria-label={t("settings:sharing.create.loadingItems")}
                      />
                    ) : null}
                  </span>
                </label>

                {selectedResource ? (
                  <div className="mt-2 flex items-center gap-3 rounded-xl border border-brand-border bg-brand-soft px-3.5 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-brand">
                      <Check className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-foreground">
                        {selectedResource.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {selectedResource.sku || selectedResource.location || selectedResource.type}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedResource(null)}
                      className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface hover:text-foreground"
                      aria-label={t("settings:sharing.create.clearItem")}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}

                {!selectedResource ? (
                  <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-border bg-surface p-1.5">
                    {resourceError ? (
                      <p className="px-3 py-3 text-xs text-danger">{resourceError}</p>
                    ) : resourcesLoading && resources.length === 0 ? (
                      <div className="space-y-1.5 p-1.5">
                        {Array.from({ length: 3 }, (_, index) => (
                          <Skeleton key={index} className="h-12 w-full" />
                        ))}
                      </div>
                    ) : resources.length ? (
                      resources.map((resource) => (
                        <button
                          key={resource.id}
                          type="button"
                          onClick={() => setSelectedResource(resource)}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-subtle"
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted">
                            <PackageOpen className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-foreground">
                              {resource.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted">
                              {resource.sku || resource.location || resource.type}
                            </span>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-4 text-center text-xs text-muted">
                        {t("settings:sharing.create.noItems")}
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {formError ? (
              <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-3 text-xs leading-5 text-danger">
                {formError}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={resetForm}
                disabled={creating}
              >
                {t("common:actions.reset")}
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="size-4" aria-hidden="true" />
                )}
                {creating
                  ? t("settings:sharing.create.creating")
                  : t("settings:sharing.create.submit")}
              </Button>
            </div>
          </form>
        </div>
      </Card>

      <section aria-labelledby="active-shares-title">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="active-shares-title" className="text-sm font-semibold text-foreground">
              {t("settings:sharing.list.title")}
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              {t("settings:sharing.list.description")}
            </p>
          </div>
          {!loading ? (
            <Badge tone="neutral">
              {t("settings:sharing.list.activeCount", { count: shares.length })}
            </Badge>
          ) : null}
        </div>

        {notice ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-xs text-success">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-surface/40"
              aria-label={t("settings:sharing.list.dismissNotice")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {actionError ? (
          <p role="alert" className="mb-3 rounded-xl bg-danger-soft px-4 py-3 text-xs text-danger">
            {actionError}
          </p>
        ) : null}

        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-3 p-5" aria-label={t("settings:sharing.list.loading")}>
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))}
            </div>
          ) : loadError ? (
            <EmptyState
              title={t("settings:sharing.list.loadTitle")}
              description={loadError}
              icon={<ShieldAlert className="size-5" aria-hidden="true" />}
              action={
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  {t("common:actions.retry")}
                </Button>
              }
            />
          ) : shares.length === 0 ? (
            <EmptyState
              title={t("settings:sharing.list.emptyTitle")}
              description={t("settings:sharing.list.emptyDescription")}
              icon={<Globe2 className="size-5" aria-hidden="true" />}
            />
          ) : (
            <div className="divide-y divide-border">
              {shares.map((share) => (
                <article key={share.id} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                      {share.scope === "inventory" ? (
                        <UsersRound className="size-5" aria-hidden="true" />
                      ) : (
                        <PackageOpen className="size-5" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-foreground">
                          {share.name}
                        </h3>
                        <Badge tone={share.scope === "inventory" ? "brand" : "neutral"}>
                          {t(`settings:sharing.list.scopes.${share.scope}`)}
                        </Badge>
                        {share.accessMode === "stock" ? (
                          <Badge tone="warning">
                            <LockKeyhole className="mr-1 size-3" aria-hidden="true" />
                            {t("settings:sharing.list.stockTool")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-[12px] text-muted-strong">
                        {share.scope === "item"
                          ? share.resourceName || t("settings:sharing.list.unavailableItem")
                          : share.filter
                            ? formatFilter(share.filter)
                            : t("settings:sharing.list.allInventory")}
                      </p>
                      <p className="mt-1.5 text-[11px] text-muted">
                        {t("settings:sharing.list.created", {
                          date: dateFormatter.format(new Date(share.createdAt)),
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void copyShare(share.id)}
                      >
                        {copiedId === share.id ? (
                          <Check className="size-3.5" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5" aria-hidden="true" />
                        )}
                        {copiedId === share.id
                          ? t("settings:sharing.list.copied")
                          : t("settings:sharing.list.copy")}
                      </Button>
                      <Link
                        href={sharePath(share.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[14px] font-medium text-foreground shadow-sm transition hover:border-border-strong hover:bg-surface-subtle"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        {t("settings:sharing.list.open")}
                      </Link>
                      {confirmRevoke === share.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmRevoke(null)}
                            disabled={revoking === share.id}
                          >
                            {t("common:actions.cancel")}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void revokeShare(share.id)}
                            disabled={revoking === share.id}
                          >
                            {revoking === share.id ? (
                              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            )}
                            {t("settings:sharing.list.confirmRevoke")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:bg-danger-soft hover:text-danger"
                          onClick={() => setConfirmRevoke(share.id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          {t("settings:sharing.list.revoke")}
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
