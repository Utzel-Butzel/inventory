"use client";

import {
  ArrowRight,
  Barcode,
  Boxes,
  GitBranch,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  Unlink,
  Warehouse,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import {
  OrganizationLink as Link,
  useOrganizationHref,
} from "@/components/organization-routing";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type FamilyRole = "standalone" | "primary" | "variant";

type ResourceFamilyMember = {
  id: string;
  name: string;
  type: string;
  status: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  trackingMode: "bulk" | "serialized";
  updatedAt: string;
  overriddenFields: string[];
};

type ResourceFamilyResponse = {
  role: FamilyRole;
  currentResourceId: string;
  primary: ResourceFamilyMember;
  variants: ResourceFamilyMember[];
  legacyVariantCount: number;
  optionGroupCount: number;
};

type CreateForm = {
  name: string;
  sku: string;
  barcode: string;
};

const emptyForm: CreateForm = { name: "", sku: "", barcode: "" };

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-success focus:ring-4 focus:ring-success-border";
const labelClass = "block text-[13px] font-semibold text-muted-strong";

type ResourceListResponse = {
  resources: ClientResource[];
  pagination: { pages: number };
};

async function loadEveryResource() {
  const first = await fetchJson<ResourceListResponse>(
    "/api/v1/resources?page=1&pageSize=100",
    { cache: "no-store" },
  );
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, first.pagination.pages - 1) }, (_, index) =>
      fetchJson<ResourceListResponse>(
        `/api/v1/resources?page=${index + 2}&pageSize=100`,
        { cache: "no-store" },
      ),
    ),
  );
  return [first, ...remaining].flatMap((page) => page.resources);
}

const humanize = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

const statusTone = (status: string) => {
  if (status === "available") return "success" as const;
  if (status === "maintenance") return "warning" as const;
  if (status === "archived") return "neutral" as const;
  return "brand" as const;
};

export function ResourceFamilyManager({
  resourceId,
  canCreate,
  canEdit,
  canViewStock,
  embedded = false,
}: {
  resourceId: string;
  canCreate: boolean;
  canEdit: boolean;
  canViewStock: boolean;
  embedded?: boolean;
}) {
  const router = useRouter();
  const organizationHref = useOrganizationHref();
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [family, setFamily] = useState<ResourceFamilyResponse | null>(null);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [candidateResources, setCandidateResources] = useState<
    ClientResource[]
  >([]);
  const [candidateResourceId, setCandidateResourceId] = useState("");
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFamily(
        await fetchJson<ResourceFamilyResponse>(
          `/api/v1/resources/${resourceId}/family`,
          { cache: "no-store" },
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("family.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [resourceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const reload = () => void load();
    window.addEventListener("resource-family-changed", reload);
    return () => window.removeEventListener("resource-family-changed", reload);
  }, [load]);

  const siblings = useMemo(
    () =>
      family?.role === "variant"
        ? family.variants.filter(
            (member) => member.id !== family.currentResourceId,
          )
        : [],
    [family],
  );

  const availableCandidates = useMemo(() => {
    const familyIds = new Set([
      family?.primary.id,
      ...(family?.variants.map((member) => member.id) ?? []),
    ]);
    return candidateResources
      .filter(
        (resource) =>
          resource.status !== "archived" && !familyIds.has(resource.id),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, locale) ||
          left.id.localeCompare(right.id),
      );
  }, [candidateResources, family, locale]);

  const closeForm = () => {
    setForm(emptyForm);
    setFormOpen(false);
    setError(null);
  };

  const closeConnect = () => {
    setConnectOpen(false);
    setCandidateResourceId("");
    setError(null);
  };

  const openConnect = async () => {
    setFormOpen(false);
    setConnectOpen(true);
    setCandidateResources([]);
    setCandidateResourceId("");
    setError(null);
    setLoadingCandidates(true);
    try {
      setCandidateResources(await loadEveryResource());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("family.errors.loadCandidates"),
      );
    } finally {
      setLoadingCandidates(false);
    }
  };

  const createVariant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError(t("family.errors.nameRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<{ variant: ResourceFamilyMember }>(
        `/api/v1/resources/${resourceId}/family`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            sku: form.sku.trim() || null,
            barcode: form.barcode.trim() || null,
          }),
        },
      );
      router.push(organizationHref(`/inventory/${response.variant.id}/edit`));
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("family.errors.create"),
      );
    } finally {
      setSaving(false);
    }
  };

  const connectExisting = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!candidateResourceId) {
      setError(t("family.errors.existingRequired"));
      return;
    }
    const selected = availableCandidates.find(
      (resource) => resource.id === candidateResourceId,
    );

    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson<{ variant: ResourceFamilyMember }>(
        `/api/v1/resources/${resourceId}/family`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ existingResourceId: candidateResourceId }),
        },
      );
      setConnectOpen(false);
      setCandidateResourceId("");
      setNotice(
        t("family.connect.success", {
          name: selected?.name ?? t("family.connect.selectedItem"),
        }),
      );
      window.dispatchEvent(new Event("resource-family-changed"));
      router.refresh();
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : t("family.errors.connect"),
      );
    } finally {
      setConnecting(false);
    }
  };

  const detachVariant = async () => {
    if (!family || family.role !== "variant") return;
    if (
      !window.confirm(
        t("family.detach.confirm", { name: family.primary.name }),
      )
    ) {
      return;
    }

    setDetaching(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson<{
        detached: {
          resourceId: string;
          materializedBomLineCount: number;
        };
      }>(`/api/v1/resources/${resourceId}/family`, {
        method: "DELETE",
      });
      setNotice(t("family.detach.success", { name: family.primary.name }));
      await load();
      window.dispatchEvent(new Event("resource-family-changed"));
      router.refresh();
    } catch (detachError) {
      setError(
        detachError instanceof Error
          ? detachError.message
          : t("family.errors.detach"),
      );
    } finally {
      setDetaching(false);
    }
  };

  const titleDescription = family
    ? family.role === "variant"
      ? t("family.variantDescription", { name: family.primary.name })
      : t("family.description")
    : t("family.description");

  // A read-only standalone item has no family action or context to show. Keep
  // the default detail page quiet until a family actually exists.
  if (
    !embedded &&
    !loading &&
    !error &&
    !notice &&
    family?.role !== "variant" &&
    family?.variants.length === 0 &&
    !canCreate &&
    !canEdit
  ) {
    return null;
  }

  return (
    <FamilyManagerShell embedded={embedded}>
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <GitBranch className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">
                {t("family.title")}
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-muted">
                {titleDescription}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-12 sm:pl-0">
            {family?.role !== "variant" && family?.legacyVariantCount ? (
              <Badge tone="warning">
                {t("family.legacyCount", {
                  count: family.legacyVariantCount,
                  value: number.format(family.legacyVariantCount),
                })}
              </Badge>
            ) : null}
            {family && family.variants.length ? (
              <Badge>
                {t("family.variantCount", {
                  count: family.variants.length,
                  value: number.format(family.variants.length),
                })}
              </Badge>
            ) : null}
            {canCreate &&
            family?.role !== "variant" &&
            family?.optionGroupCount === 0 &&
            !formOpen &&
            !connectOpen ? (
              <Button
                size="sm"
                onClick={() => {
                  setError(null);
                  setConnectOpen(false);
                  setFormOpen(true);
                }}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t("family.actions.add")}
              </Button>
            ) : null}
            {canEdit &&
            family?.role !== "variant" &&
            family?.optionGroupCount === 0 &&
            !formOpen &&
            !connectOpen ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void openConnect()}
              >
                <Link2 className="size-3.5" aria-hidden="true" />
                {t("family.actions.connectExisting")}
              </Button>
            ) : null}
            {canEdit && family?.role === "variant" ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={detaching}
                onClick={() => void detachVariant()}
              >
                {detaching ? (
                  <LoaderCircle
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Unlink className="size-3.5" aria-hidden="true" />
                )}
                {detaching
                  ? t("family.actions.detaching")
                  : t("family.actions.detach")}
              </Button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="flex items-start justify-between gap-4 border-b border-danger-border bg-danger-soft px-5 py-3 text-xs text-danger sm:px-6">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={t("family.actions.dismissError")}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {notice ? (
          <div className="border-b border-success-border bg-success-soft px-5 py-3 text-xs text-success sm:px-6">
            {notice}
          </div>
        ) : null}

        {formOpen ? (
          <form
            onSubmit={createVariant}
            className="border-b border-brand-border bg-brand-soft/35 px-5 py-4 sm:px-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs font-semibold text-foreground">
                  {t("family.create.title")}
                </h3>
                <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted">
                  {t("family.create.inheritanceHelp")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground"
                aria-label={t("family.actions.cancel")}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.25fr)_minmax(180px,1fr)_minmax(180px,1fr)_auto] lg:items-end">
              <label className={labelClass}>
                {t("family.fields.name")}
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder={t("family.create.namePlaceholder")}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("family.fields.sku")} · {t("family.optional")}
                <input
                  value={form.sku}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sku: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                <span className="inline-flex items-center gap-1">
                  <Barcode className="size-3" aria-hidden="true" />
                  {t("family.fields.barcode")} · {t("family.optional")}
                </span>
                <input
                  value={form.barcode}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      barcode: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
              </label>
              <Button type="submit" disabled={saving} className="sm:w-fit">
                {saving ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                {saving
                  ? t("family.actions.creating")
                  : t("family.actions.createAndEdit")}
              </Button>
            </div>
          </form>
        ) : null}

        {connectOpen ? (
          <form
            onSubmit={connectExisting}
            className="border-b border-brand-border bg-brand-soft/35 px-5 py-4 sm:px-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xs font-semibold text-foreground">
                  {t("family.connect.title")}
                </h3>
                <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted">
                  {t("family.connect.help", { name: family?.primary.name })}
                </p>
              </div>
              <button
                type="button"
                onClick={closeConnect}
                disabled={connecting}
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground"
                aria-label={t("family.actions.cancel")}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className={`${labelClass} min-w-0 flex-1`}>
                {t("family.connect.itemLabel")}
                <select
                  required
                  value={candidateResourceId}
                  disabled={loadingCandidates || connecting}
                  onChange={(event) =>
                    setCandidateResourceId(event.target.value)
                  }
                  className={inputClass}
                >
                  <option value="">
                    {loadingCandidates
                      ? t("family.connect.loading")
                      : availableCandidates.length
                        ? t("family.connect.placeholder")
                        : t("family.connect.empty")}
                  </option>
                  {availableCandidates.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                      {resource.sku ? ` · ${resource.sku}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="submit"
                disabled={
                  connecting || loadingCandidates || !candidateResourceId
                }
                className="sm:w-fit"
              >
                {connecting ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Link2 className="size-4" aria-hidden="true" />
                )}
                {connecting
                  ? t("family.actions.connecting")
                  : t("family.actions.connect")}
              </Button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <div
            className="space-y-2 p-4 sm:px-5"
            aria-label={t("family.loading")}
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : family ? (
          family.role === "variant" ? (
            <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
              <div className="p-4 sm:p-5">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                  {t("family.primaryItem")}
                </p>
                <FamilyMemberRow
                  member={family.primary}
                  label={t("family.variantOf", { name: family.primary.name })}
                  canEdit={canEdit}
                  canViewStock={canViewStock}
                  number={number}
                />
              </div>
              <div className="p-4 sm:p-5">
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                  {t("family.siblings")}
                </p>
                {siblings.length ? (
                  <div className="space-y-2">
                    {siblings.map((member) => (
                      <FamilyMemberRow
                        key={member.id}
                        member={member}
                        canEdit={canEdit}
                        canViewStock={canViewStock}
                        number={number}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-16 items-center rounded-xl border border-dashed border-border px-4 text-xs text-muted">
                    {t("family.noSiblings")}
                  </div>
                )}
              </div>
            </div>
          ) : family.variants.length ? (
            <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
              {family.variants.map((member) => (
                <FamilyMemberRow
                  key={member.id}
                  member={member}
                  canEdit={canEdit}
                  canViewStock={canViewStock}
                  number={number}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-24 items-center gap-3 px-5 py-5 sm:px-6">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted">
                <Boxes className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {t("family.empty.title")}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-muted">
                  {t("family.empty.description")}
                </p>
              </div>
            </div>
          )
        ) : null}
    </FamilyManagerShell>
  );
}

function FamilyManagerShell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: React.ReactNode;
}) {
  if (embedded) return <div className="min-w-0">{children}</div>;
  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-6 sm:px-6 lg:px-8">
      <Card className="overflow-hidden shadow-[var(--shadow-sm)]">
        {children}
      </Card>
    </section>
  );
}

function FamilyMemberRow({
  member,
  label,
  canEdit,
  canViewStock,
  number,
}: {
  member: ResourceFamilyMember;
  label?: string;
  canEdit: boolean;
  canViewStock: boolean;
  number: Intl.NumberFormat;
}) {
  const { t } = useT("inventory");
  const statusLabel = t(`statuses.${member.status}`, {
    defaultValue: humanize(member.status),
  });
  const typeLabel = t(`typeSingular.${member.type}`, {
    defaultValue: humanize(member.type),
  });

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface-subtle/60 px-3.5 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/inventory/${member.id}`}
            className="truncate text-sm font-semibold text-foreground hover:text-brand"
          >
            {member.name}
          </Link>
          <Badge tone={statusTone(member.status)}>{statusLabel}</Badge>
          {member.overriddenFields.length ? (
            <Badge tone="brand">
              {t("family.overrides", {
                count: member.overriddenFields.length,
                value: number.format(member.overriddenFields.length),
              })}
            </Badge>
          ) : null}
        </div>
        {label ? (
          <p className="mt-1 truncate text-[12px] font-medium text-brand">
            {label}
          </p>
        ) : null}
        <p className="mt-1 truncate text-[12px] text-muted">
          {typeLabel} · {t(`family.tracking.${member.trackingMode}`)} ·{" "}
          {t("item.units", {
            count: member.quantity,
            value: number.format(member.quantity),
          })}
          {member.sku ? ` · ${member.sku}` : ""}
          {!member.sku && member.barcode ? ` · ${member.barcode}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={`/inventory/${member.id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-semibold text-muted-strong hover:border-border-strong hover:text-foreground"
        >
          {t("family.actions.open")}
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
        {canEdit ? (
          <Link
            href={`/inventory/${member.id}/edit`}
            className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
            aria-label={t("family.actions.edit", { name: member.name })}
            title={t("family.actions.edit", { name: member.name })}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
        {canViewStock ? (
          <Link
            href={`/inventory/${member.id}/stock`}
            className="grid size-8 place-items-center rounded-lg border border-brand-border bg-brand-soft text-brand hover:bg-brand-soft"
            aria-label={t("family.actions.stock", { name: member.name })}
            title={t("family.actions.stock", { name: member.name })}
          >
            <Warehouse className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
