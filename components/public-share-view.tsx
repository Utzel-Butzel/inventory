import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Boxes,
  FileText,
  MapPin,
  PackageOpen,
  Search,
  Tag,
} from "lucide-react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LocalizedThemeToggle } from "@/components/theme-toggle";
import { MarkdownContent } from "@/components/markdown-content";
import { ResponsiveMediaImage } from "@/components/responsive-media-image";
import { UsdzModelViewer } from "@/components/usdz-model-viewer";
import {
  PublicStockBookingPanel,
  PublicStockScannerButton,
  type PublicStockSummary,
} from "@/components/public-stock-tool";
import type {
  PublicCustomFieldDefinition,
  PublicResource,
} from "@/lib/public-shares";
import { getT } from "@/lib/ui-i18n/server";
import { markdownToPlainText } from "@/lib/simple-markdown";
import { isUsdzMedia } from "@/lib/usdz";

const statusStyles: Record<string, string> = {
  available: "bg-success-soft text-success ring-success-border",
  "in-use": "bg-info-soft text-info ring-info-border",
  maintenance: "bg-warning-soft text-warning ring-warning-border",
  archived: "bg-surface-muted text-muted ring-border-strong",
};

const humanize = (value: string) =>
  value.replace(/[-_]+/g, " ").replace(/^./, (character) => character.toUpperCase());

function PublicHeader({
  title,
  eyebrow,
  viewOnly,
  stockToolShareId,
}: {
  title: string;
  eyebrow: string;
  viewOnly: string;
  stockToolShareId?: string;
}) {
  return (
    <header className="border-b border-border bg-surface/95">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-brand-solid text-on-brand">
            <Boxes className="size-[18px]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.13em] text-muted">
              {eyebrow}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {stockToolShareId ? (
            <PublicStockScannerButton shareId={stockToolShareId} />
          ) : null}
          <span className="hidden rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wider text-brand sm:inline-flex">
            {viewOnly}
          </span>
          <LocalizedThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}

function ResourceImage({
  resource,
  eager = false,
  detail = false,
}: {
  resource: PublicResource;
  eager?: boolean;
  detail?: boolean;
}) {
  if (resource.cover) {
    return (
      <ResponsiveMediaImage
        media={resource.cover}
        delivery="public"
        alt={resource.cover.altText || resource.name}
        widths={detail ? [640, 960, 1280] : [384, 640, 960]}
        sizes={
          detail
            ? "(max-width: 1023px) calc(100vw - 32px), 700px"
            : "(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) calc(50vw - 32px), (max-width: 1279px) 33vw, 25vw"
        }
        eager={eager}
        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
      />
    );
  }
  return (
    <div className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_30%_20%,var(--color-success-soft),transparent_46%),linear-gradient(135deg,var(--color-surface-subtle),var(--color-surface-muted))] text-muted">
      <Box className="size-12" strokeWidth={1.3} aria-hidden="true" />
    </div>
  );
}

export async function PublicInventoryView({
  shareId,
  title,
  filterLabel,
  resources,
  query,
  pagination,
}: {
  shareId: string;
  title: string;
  filterLabel: string | null;
  resources: PublicResource[];
  query: string;
  pagination: { page: number; pages: number; total: number };
}) {
  const { t, lng: locale } = await getT("share");
  const pageHref = (page: number) => {
    const parameters = new URLSearchParams();
    if (query) parameters.set("q", query);
    if (page > 1) parameters.set("page", String(page));
    const suffix = parameters.toString();
    return `/share/${shareId}${suffix ? `?${suffix}` : ""}`;
  };
  const eagerCoverId = resources.find((resource) => resource.cover)?.id;

  return (
    <div className="min-h-dvh bg-background">
      <PublicHeader
        title={title}
        eyebrow={t("header.sharedInventory")}
        viewOnly={t("header.viewOnly")}
      />
      <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6 lg:py-12">
        <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              {t("collection.eyebrow")}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              {title}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {t("collection.count", { count: pagination.total })}
              {filterLabel ? ` · ${filterLabel}` : ""}
            </p>
          </div>
          <form className="relative w-full sm:max-w-sm" action={`/share/${shareId}`}>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              name="q"
              defaultValue={query}
              maxLength={240}
              placeholder={t("collection.searchPlaceholder")}
              aria-label={t("collection.searchLabel")}
              className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3 text-sm text-foreground shadow-sm outline-none placeholder:text-muted focus:border-brand"
            />
          </form>
        </div>

        {resources.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {resources.map((resource) => (
              <Link
                key={resource.id}
                href={`/share/${shareId}/${resource.id}`}
                className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
              >
                <div className="relative aspect-square overflow-hidden bg-surface-muted">
                  <ResourceImage
                    resource={resource}
                    eager={resource.id === eagerCoverId}
                  />
                  <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[13px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}>
                    {t(`statuses.${resource.status}`, {
                      defaultValue: humanize(resource.status),
                    })}
                  </span>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="line-clamp-1 font-semibold text-foreground">{resource.name}</h2>
                    <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted transition group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted">
                    {markdownToPlainText(resource.description) ||
                      t("resource.noDescriptionShort")}
                  </p>
                  <p className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted">
                    <MapPin className="size-3.5" />
                    {resource.location || t("resource.noLocation")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid min-h-80 place-items-center rounded-3xl border border-dashed border-border-strong bg-surface px-6 text-center">
            <div>
              <PackageOpen className="mx-auto size-10 text-muted" />
              <h2 className="mt-4 text-lg font-semibold text-foreground">
                {t("collection.empty.title")}
              </h2>
              <p className="mt-2 text-sm text-muted">
                {query
                  ? t("collection.empty.search")
                  : t("collection.empty.default")}
              </p>
            </div>
          </div>
        )}

        {pagination.pages > 1 ? (
          <nav className="mt-7 flex items-center justify-between border-t border-border pt-5" aria-label={t("pagination.label")}>
            <p className="text-xs text-muted">
              {t("pagination.position", {
                page: new Intl.NumberFormat(locale).format(pagination.page),
                pages: new Intl.NumberFormat(locale).format(pagination.pages),
              })}
            </p>
            <div className="flex gap-2">
              {pagination.page > 1 ? (
                <Link className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground" href={pageHref(pagination.page - 1)}>{t("pagination.previous")}</Link>
              ) : null}
              {pagination.page < pagination.pages ? (
                <Link className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground" href={pageHref(pagination.page + 1)}>{t("pagination.next")}</Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </main>
    </div>
  );
}

function formatCustomValue(
  value: string | number | boolean | string[],
  definition?: PublicCustomFieldDefinition,
  locale = "en",
  yes = "Yes",
  no = "No",
) {
  if (typeof value === "boolean") return value ? yes : no;
  if (Array.isArray(value)) {
    return value
      .map((entry) => definition?.options.find((option) => option.value === entry)?.label ?? entry)
      .join(", ");
  }
  if (definition?.fieldType === "select" && typeof value === "string") {
    return definition.options.find((option) => option.value === value)?.label ?? value;
  }
  if (definition?.fieldType === "date" && typeof value === "string") {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  }
  if (definition?.fieldType === "datetime" && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  return String(value);
}

export async function PublicResourceView({
  shareId,
  shareTitle,
  showBack,
  resource,
  definitions,
  stockTool = null,
}: {
  shareId: string;
  shareTitle: string;
  showBack: boolean;
  resource: PublicResource;
  definitions: PublicCustomFieldDefinition[];
  stockTool?: PublicStockSummary | null;
}) {
  const { t, lng: locale } = await getT("share");
  const customFields = Object.entries(resource.customFields);
  return (
    <div className="min-h-dvh bg-background">
      <PublicHeader
        title={shareTitle}
        eyebrow={t("header.sharedInventory")}
        viewOnly={t(stockTool ? "tool.header.badge" : "header.viewOnly")}
        stockToolShareId={stockTool ? shareId : undefined}
      />
      <main className="mx-auto w-full max-w-[1120px] px-4 py-7 sm:px-6 lg:py-10">
        {showBack ? (
          <Link href={`/share/${shareId}`} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-foreground">
            <ArrowLeft className="size-4" /> {t("resource.back")}
          </Link>
        ) : null}
        <header className="mb-6 border-b border-border pb-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">{resource.name}</h1>
            <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}>
              {t(`statuses.${resource.status}`, {
                defaultValue: humanize(resource.status),
              })}
            </span>
          </div>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
          <div className="space-y-6">
            <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <div className="aspect-[16/9] overflow-hidden bg-surface-muted">
                <ResourceImage resource={resource} detail eager />
              </div>
              <div className="p-5 sm:p-6">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><FileText className="size-4 text-brand" /> {t("resource.overview")}</h2>
                {resource.description ? (
                  <MarkdownContent value={resource.description} className="mt-3" />
                ) : (
                  <p className="mt-3 text-sm leading-7 text-muted-strong">
                    {t("resource.noDescription")}
                  </p>
                )}
              </div>
            </section>
            {resource.media.length > 1 || (resource.media.length === 1 && !resource.cover) ? (
              <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-sm font-semibold text-foreground">{t("resource.media")}</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {resource.media.map((item) =>
                    isUsdzMedia(item) ? (
                      <UsdzModelViewer
                        key={item.id}
                        src={item.url}
                        name={item.name}
                        labels={{
                          loading: t("modelViewer.loading"),
                          unavailable: t("modelViewer.unavailable"),
                          viewInAr: t("modelViewer.viewInAr"),
                          download: t("modelViewer.download"),
                          interaction: t("modelViewer.interaction", {
                            name: item.name,
                          }),
                        }}
                      />
                    ) : item.kind === "image" &&
                      item.mimeType.startsWith("image/") &&
                      item.mimeType !== "image/svg+xml" ? (
                      <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-xl border border-border bg-surface-muted">
                        <ResponsiveMediaImage
                          media={item}
                          delivery="public"
                          alt={item.altText || item.name}
                          widths={[192, 384, 640]}
                          sizes="(max-width: 639px) calc(100vw - 64px), (max-width: 1023px) 50vw, 220px"
                          className="h-full w-full object-cover"
                        />
                      </a>
                    ) : (
                      <a key={item.id} href={item.url} className="flex min-h-24 items-center gap-3 rounded-xl border border-border p-4 text-sm font-semibold text-foreground">
                        <FileText className="size-5 text-muted" /> {item.name}
                      </a>
                    ),
                  )}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="space-y-5">
            {stockTool ? (
              <PublicStockBookingPanel
                shareId={shareId}
                resourceId={resource.id}
                initialQuantity={resource.quantity}
                summary={stockTool}
              />
            ) : null}
            <section className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">{t("resource.details")}</h2>
              <dl className="mt-4 divide-y divide-border text-sm">
                {[
                  [t("resource.fields.type"), t(`types.${resource.type}`, { defaultValue: humanize(resource.type) })],
                  [t("resource.fields.quantity"), t("resource.units", { count: resource.quantity })],
                  [t("resource.fields.sku"), resource.sku || "—"],
                  [t("resource.fields.location"), resource.location || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-3">
                    <dt className="text-muted">{label}</dt><dd className="text-right font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {resource.tags.length || resource.categories.length ? (
              <section className="rounded-2xl border border-border bg-surface p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Tag className="size-4 text-brand" /> {t("resource.classification")}</h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {resource.categories.map((category) => <span key={category.name} className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success">{category.name}</span>)}
                  {resource.tags.map((tag) => <span key={tag} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-muted-strong">#{tag}</span>)}
                </div>
              </section>
            ) : null}
            {customFields.length ? (
              <section className="rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-sm font-semibold text-foreground">{t("resource.customFields")}</h2>
                <dl className="mt-4 divide-y divide-border text-sm">
                  {customFields.map(([key, value]) => {
                    const definition = definitions.find((candidate) => candidate.key === key);
                    return <div key={key} className="flex justify-between gap-4 py-3"><dt className="text-muted">{definition?.label ?? humanize(key)}</dt><dd className="break-words text-right font-medium text-foreground">{formatCustomValue(value, definition, locale, t("boolean.yes"), t("boolean.no"))}</dd></div>;
                  })}
                </dl>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}

export async function PublicShareUnavailable() {
  const { t } = await getT("share");
  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-6 text-center">
      <LocalizedThemeToggle className="absolute right-5 top-5" />
      <div>
        <Boxes className="mx-auto size-11 text-muted" />
        <h1 className="mt-5 text-2xl font-semibold text-foreground">{t("unavailable.title")}</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted">{t("unavailable.description")}</p>
      </div>
    </div>
  );
}
