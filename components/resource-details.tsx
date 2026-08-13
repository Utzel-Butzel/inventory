"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  ArrowLeft,
  Barcode,
  Box,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Hash,
  ImageIcon,
  Layers3,
  Languages,
  LoaderCircle,
  MapPin,
  Package,
  Paperclip,
  Pencil,
  Sparkles,
  Tag,
  Trash2,
  Warehouse,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CustomFieldValueDisplay } from "@/components/custom-field-inputs";
import { ResourceShareButton } from "@/components/resource-share-button";
import { UsdzModelViewer } from "@/components/usdz-model-viewer";
import {
  fetchJson,
  type ClientMedia,
  type ClientResource,
  type ClientResourceLocalization,
} from "@/lib/client-types";
import type {
  CustomFieldDefinition,
  CustomFieldValue,
} from "@/lib/custom-field-contract";
import { getObjectCapturePresentation } from "@/lib/object-capture-presentation";
import { isUsdzMedia } from "@/lib/usdz";

const statusStyles: Record<string, string> = {
  available: "bg-success-soft text-success ring-success-border",
  "in-use": "bg-info-soft text-info ring-info-border",
  maintenance: "bg-warning-soft text-warning ring-warning-border",
  archived: "bg-surface-muted text-muted ring-border-strong/40",
};

const formatValue = (cents: number | null, currency: string, locale: string) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      }).format(cents / 100);

const formatDate = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const humanize = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());

const formatCustomValue = (
  value: unknown,
  booleanLabels: { yes: string; no: string },
): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") {
    return value ? booleanLabels.yes : booleanLabels.no;
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatCustomValue(item, booleanLabels)).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function DetailField({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: typeof Package;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 gap-3 rounded-xl border border-border bg-surface-subtle/70 p-3.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
        <div className={`mt-1 truncate text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function MediaCard({ item, kindLabel }: { item: ClientMedia; kindLabel: string }) {
  const { t } = useT("inventory");
  const Icon = item.kind === "document" ? FileText : Paperclip;

  if (isUsdzMedia(item)) {
    return (
      <UsdzModelViewer
        src={item.url}
        name={item.name}
        labels={{
          loading: t("modelViewer.loading"),
          unavailable: t("modelViewer.unavailable"),
          viewInAr: t("modelViewer.viewInAr"),
          download: t("modelViewer.download"),
          interaction: t("modelViewer.interaction", { name: item.name }),
        }}
      />
    );
  }

  if (item.kind === "image") {
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-surface-muted"
      >
        {/* Stored images use an authenticated same-origin route and cannot use next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.altText || item.name}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
        />
      </a>
    );
  }

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-28 items-center gap-3 rounded-2xl border border-border bg-surface-subtle p-4 transition hover:border-border-strong hover:bg-surface"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface text-muted shadow-sm">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-foreground">{item.name}</span>
        <span className="mt-1 block text-xs uppercase text-muted">{kindLabel}</span>
      </span>
    </a>
  );
}

export function ResourceDetails({
  resourceId,
  canEdit,
  canDelete,
  canShare,
  canViewStock,
}: {
  resourceId: string;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canViewStock: boolean;
}) {
  const router = useRouter();
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const decimal = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const [resource, setResource] = useState<ClientResource | null>(null);
  const [localization, setLocalization] =
    useState<ClientResourceLocalization | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<
    CustomFieldDefinition[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResource = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, definitionResponse] = await Promise.all([
        fetchJson<{
          resource: ClientResource;
          localization: ClientResourceLocalization;
        }>(
          `/api/v1/resources/${resourceId}${selectedLanguage ? `?language=${encodeURIComponent(selectedLanguage)}` : ""}`,
          { cache: "no-store" },
        ),
        fetchJson<{ definitions: CustomFieldDefinition[] }>(
          "/api/v1/custom-fields?entityType=inventory",
          { cache: "no-store" },
        ).catch(() => ({ definitions: [] })),
      ]);
      setResource(response.resource);
      setLocalization(response.localization);
      setCustomFieldDefinitions(definitionResponse.definitions);
    } catch {
      setError(t("details.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [resourceId, selectedLanguage, t]);

  useEffect(() => {
    void loadResource();
  }, [loadResource]);

  const mapHref = useMemo(() => {
    if (resource?.gpsLatitude === null || resource?.gpsLongitude === null) return null;
    if (resource?.gpsLatitude === undefined || resource?.gpsLongitude === undefined) return null;
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(resource.gpsLatitude)}&mlon=${encodeURIComponent(resource.gpsLongitude)}#map=18/${encodeURIComponent(resource.gpsLatitude)}/${encodeURIComponent(resource.gpsLongitude)}`;
  }, [resource]);

  const deleteItem = async () => {
    if (
      !resource ||
      !window.confirm(t("details.confirmDelete", { name: resource.name }))
    ) {
      return;
    }
    try {
      await fetchJson(`/api/v1/resources/${resource.id}`, { method: "DELETE" });
      router.push("/inventory");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("details.errors.delete"),
      );
    }
  };

  if (loading) {
    return (
      <div
        className="grid min-h-[60vh] place-items-center text-muted"
        aria-label={t("details.loading")}
      >
        <LoaderCircle className="animate-spin" />
      </div>
    );
  }

  if (error || !resource) {
    return (
      <div className="mx-auto w-full max-w-[1450px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-danger-border bg-danger-soft p-5 text-sm text-danger">
          {error ?? t("details.errors.notFound")}
        </div>
        <Link href="/inventory" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-strong">
          <ArrowLeft className="size-4" /> {t("details.back")}
        </Link>
      </div>
    );
  }

  const customFields = Object.entries(resource.customFields ?? {}).map(([key, value]) => ({
    key,
    value: value as CustomFieldValue,
    definition: customFieldDefinitions.find((definition) => definition.key === key),
  }));
  const typeLabel = (value: string) =>
    t(`typeSingular.${value}`, { defaultValue: humanize(value) });
  const statusLabel = (value: string) =>
    t(`statuses.${value}`, { defaultValue: humanize(value) });
  const mediaKindLabel = (value: string) =>
    t(`mediaKinds.${value}`, { defaultValue: humanize(value) });
  const { model: objectModel, gallery: galleryMedia } =
    getObjectCapturePresentation(resource.media, resource.cover?.id ?? null);

  return (
    <div className="mx-auto w-full max-w-[1450px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Link href="/inventory" className="inline-flex items-center gap-1 transition hover:text-foreground">
              <ArrowLeft className="size-3.5" /> {t("details.breadcrumb.inventory")}
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="truncate">{t("details.breadcrumb.details")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              {resource.name}
            </h1>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}
            >
              {statusLabel(resource.status)}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            {t("details.updatedWithId", {
              date: formatDate(resource.updatedAt, locale),
              id: resource.id.slice(0, 8),
            })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {localization && localization.availableLanguages.length > 1 ? (
            <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-muted-strong">
              <Languages className="size-4 text-brand" />
              <span className="sr-only">{t("details.contentLanguage")}</span>
              <select
                value={localization.languageCode}
                onChange={(event) => setSelectedLanguage(event.target.value)}
                className="bg-transparent pr-1 outline-none"
                aria-label={t("details.contentLanguage")}
              >
                {localization.availableLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.label}
                    {language.isDefault ? t("details.defaultLanguageSuffix") : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canShare ? (
            <ResourceShareButton
              resourceId={resource.id}
              resourceName={resource.name}
            />
          ) : null}
          {canViewStock ? (
            <Link
              href={`/inventory/${resource.id}/stock`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-brand-border bg-brand-soft px-3.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
            >
              <Warehouse className="size-4" /> {t("details.actions.stock")}
            </Link>
          ) : null}
          {canEdit ? (
            <Link
              href={`/inventory/${resource.id}/edit`}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong shadow-sm transition hover:bg-success"
            >
              <Pencil className="size-4" /> {t("details.actions.edit")}
            </Link>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => void deleteItem()}
              className="grid size-10 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:border-danger-border hover:bg-danger-soft hover:text-danger"
              aria-label={t("details.actions.delete")}
              title={t("details.actions.delete")}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      {localization && !localization.isDefault && localization.fallbackFields.length ? (
        <div className="mb-5 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-xs leading-5 text-warning">
          {t("details.translationFallback", {
            count: localization.fallbackFields.length,
            value: integer.format(localization.fallbackFields.length),
          })}
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
            {objectModel ? (
              <div className="grid border-b border-border lg:grid-cols-2">
                {resource.cover ? (
                  <div className="relative aspect-square overflow-hidden bg-[radial-gradient(circle_at_50%_35%,var(--color-surface),var(--color-surface-muted))] lg:aspect-auto lg:min-h-80">
                    {/* Stored images use an authenticated same-origin route and cannot use next/image. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resource.cover.url}
                      alt={resource.cover.altText || resource.name}
                      className="h-full w-full object-contain"
                    />
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-semibold text-muted shadow-sm">
                      <ImageIcon className="size-3.5" aria-hidden="true" />
                      {t("details.articleImage")}
                    </span>
                  </div>
                ) : (
                  <div className="grid aspect-square place-items-center bg-gradient-to-br from-success-soft to-surface-muted px-8 text-center text-muted lg:aspect-auto lg:min-h-80">
                    <div>
                      <ImageIcon
                        className="mx-auto size-12"
                        strokeWidth={1.25}
                        aria-hidden="true"
                      />
                      <p className="mt-3 text-sm font-semibold text-muted-strong">
                        {t("details.noArticleImage")}
                      </p>
                      {canEdit ? (
                        <Link
                          href={`/inventory/${resource.id}/edit`}
                          className="mt-2 inline-flex text-xs font-semibold text-success hover:text-success"
                        >
                          {t("details.addArticleImage")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                )}
                <UsdzModelViewer
                  src={objectModel.url}
                  name={objectModel.name}
                  className="min-h-80 self-stretch rounded-none border-0"
                  labels={{
                    loading: t("modelViewer.loading"),
                    unavailable: t("modelViewer.unavailable"),
                    viewInAr: t("modelViewer.viewInAr"),
                    download: t("modelViewer.download"),
                    interaction: t("modelViewer.interaction", {
                      name: objectModel.name,
                    }),
                  }}
                />
              </div>
            ) : resource.cover ? (
              <div className="aspect-[16/9] overflow-hidden bg-surface-muted sm:aspect-[2/1]">
                {/* Stored images use an authenticated same-origin route and cannot use next/image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resource.cover.url}
                  alt={resource.cover.altText || resource.name}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="grid aspect-[16/7] place-items-center bg-gradient-to-br from-success-soft to-surface-muted text-muted">
                <Box className="size-14" strokeWidth={1.25} />
              </div>
            )}
            <div className="p-5 sm:p-6">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-success">
                <Package className="size-4" /> {t("details.sections.overview")}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-muted-strong">
                {resource.description || t("details.emptyDescription")}
              </p>
            </div>
          </section>

          {galleryMedia.length ? (
            <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ImageIcon className="size-4 text-success" />
                  {resource.cover || objectModel
                    ? t("details.sections.additionalMedia")
                    : t("details.sections.media")}
                </h2>
                <span className="text-xs text-muted">
                  {t("details.files", {
                    count: galleryMedia.length,
                    value: integer.format(galleryMedia.length),
                  })}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {galleryMedia.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    kindLabel={mediaKindLabel(item.kind)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {resource.notes ? (
            <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="size-4 text-success" /> {t("details.sections.notes")}
              </h2>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-strong">{resource.notes}</p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-5">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">
              {t("details.sections.itemDetails")}
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <DetailField icon={Layers3} label={t("fields.type")} value={typeLabel(resource.type)} />
              <DetailField
                icon={Hash}
                label={t("fields.quantity")}
                value={t("item.units", {
                  count: resource.quantity,
                  value: integer.format(resource.quantity),
                })}
              />
              <DetailField icon={Barcode} label={t("fields.sku")} value={resource.sku || "—"} mono />
              <DetailField icon={Barcode} label={t("fields.barcode")} value={resource.barcode || "—"} mono />
              <DetailField icon={Barcode} label={t("fields.serialNumber")} value={resource.serialNumber || "—"} mono />
              <DetailField icon={MapPin} label={t("fields.location")} value={resource.location || "—"} />
              <DetailField
                icon={CircleDollarSign}
                label={t("fields.value")}
                value={formatValue(resource.valueCents, resource.currency, locale)}
              />
              <DetailField
                icon={Sparkles}
                label={t("fields.priority")}
                value={t("details.priority", { value: integer.format(resource.priority) })}
              />
              <DetailField
                icon={CalendarDays}
                label={t("fields.created")}
                value={formatDate(resource.createdAt, locale)}
              />
            </div>
          </section>

          {resource.tags.length || resource.categories.length ? (
            <section className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Tag className="size-4 text-success" /> {t("details.sections.classification")}
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {resource.categories.map((category) => (
                  <span key={category.name} className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">
                    {category.name}
                  </span>
                ))}
                {resource.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-muted-strong">
                    #{tag}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {customFields.length ? (
            <section className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {t("details.sections.customFields")}
              </h2>
              <dl className="mt-4 divide-y divide-border">
                {customFields.map(({ key, value, definition }) => (
                  <div key={key} className="grid grid-cols-[minmax(110px,.8fr)_minmax(0,1.2fr)] gap-4 py-3 text-sm">
                    <dt className="text-muted">{definition?.label ?? humanize(key)}</dt>
                    <dd className="break-words text-right font-medium text-foreground">
                      {definition ? (
                        <CustomFieldValueDisplay definition={definition} value={value} />
                      ) : (
                        formatCustomValue(value, {
                          yes: t("values.yes"),
                          no: t("values.no"),
                        })
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MapPin className="size-4 text-success" /> {t("details.sections.position")}
            </h2>
            {mapHref ? (
              <>
                <p className="mt-3 font-mono text-xs leading-5 text-muted">
                  {resource.gpsLatitude?.toFixed(6)}, {resource.gpsLongitude?.toFixed(6)}
                  {resource.gpsAltitude === null
                    ? ""
                    : ` · ${decimal.format(resource.gpsAltitude)} m`}
                </p>
                <a href={mapHref} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-success hover:text-success">
                  {t("details.openOnMap")} <ChevronRight className="size-3.5" />
                </a>
              </>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted">
                {t("details.noPosition")}
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5 text-xs text-muted">
            <p className="flex items-center gap-2">
              <Clock3 className="size-3.5" />
              {t("details.lastUpdated", {
                date: formatDate(resource.updatedAt, locale),
              })}
            </p>
            <p className="mt-2 break-all font-mono">{resource.id}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
