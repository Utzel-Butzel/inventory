"use client";

import {
  OrganizationLink as Link,
  useOrganizationHref,
} from "@/components/organization-routing";
import { useRouter } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  ArrowLeft,
  Barcode,
  Box,
  Building2,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Flag,
  Hash,
  ImageIcon,
  Layers3,
  Languages,
  LoaderCircle,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Package,
  Paperclip,
  Pencil,
  Rotate3d,
  Tag,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CustomFieldValueDisplay } from "@/components/custom-field-inputs";
import { MarkdownContent } from "@/components/markdown-content";
import { ResourceShareButton } from "@/components/resource-share-button";
import { UsdzModelViewer } from "@/components/usdz-model-viewer";
import {
  fetchJson,
  type ClientMedia,
  type ClientResource,
  type ClientResourceLocalization,
  type ClientRoomScanSummary,
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

const curatedArticleImages: Record<
  string,
  { url: string; altText: string }
> = {
  "a0530295-390a-457e-aa3f-06327e0e6fa7": {
    url: "/images/rooms/montage-article.jpg",
    altText: "Organized assembly workshop with workbenches and tool storage",
  },
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
    return value
      .map((item) => formatCustomValue(item, booleanLabels))
      .join(", ");
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
    <div className="flex min-w-0 gap-3 border-b border-border py-3 last:border-b-0">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <div
          className={`mt-1 truncate text-sm font-medium text-foreground ${mono ? "font-mono" : ""}`}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function RoomScanSummary({
  scan,
  locale,
  integer,
}: {
  scan: ClientRoomScanSummary;
  locale: string;
  integer: Intl.NumberFormat;
}) {
  const { t } = useT("inventory");
  const roomHref = `/spaces?room=${encodeURIComponent(scan.id)}`;
  const mapHref = scan.structureId
    ? `/map?structure=${encodeURIComponent(scan.structureId)}${
        scan.floorIdentifier
          ? `&floor=${encodeURIComponent(scan.floorIdentifier)}`
          : ""
      }`
    : null;

  return (
    <section className="overflow-hidden rounded-xl border border-brand-border bg-surface">
      <div className="bg-gradient-to-br from-brand-soft via-surface to-surface px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-brand">
              <Rotate3d className="size-4" aria-hidden="true" />
              {t("details.roomScan.eyebrow")}
            </p>
            <h2 className="mt-2 text-lg font-semibold text-foreground">
              {t("details.roomScan.title")}
            </h2>
          </div>
          <span className="rounded-full bg-success-soft px-2.5 py-1 text-[10px] font-semibold text-success ring-1 ring-inset ring-success-border">
            {t("details.roomScan.revision", {
              value: integer.format(scan.revision),
            })}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">
          {t("details.roomScan.description")}
        </p>
      </div>

      <dl className="grid grid-cols-2 border-y border-border">
        <div className="border-b border-r border-border p-4">
          <dt className="flex items-center gap-2 text-[11px] text-muted">
            <Building2 className="size-3.5" aria-hidden="true" />
            {t("details.roomScan.structure")}
          </dt>
          <dd className="mt-1 truncate text-sm font-semibold text-foreground">
            {scan.structureName ?? t("details.roomScan.individualRoom")}
          </dd>
        </div>
        <div className="border-b border-border p-4">
          <dt className="flex items-center gap-2 text-[11px] text-muted">
            <Layers3 className="size-3.5" aria-hidden="true" />
            {t("details.roomScan.floor")}
          </dt>
          <dd className="mt-1 truncate text-sm font-semibold text-foreground">
            {scan.floorIdentifier ?? t("details.roomScan.unassigned")}
          </dd>
        </div>
        <div className="border-r border-border p-4">
          <dt className="flex items-center gap-2 text-[11px] text-muted">
            <Package className="size-3.5" aria-hidden="true" />
            {t("details.roomScan.contents")}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {t("details.roomScan.placements", {
              count: scan.placementCount,
              value: integer.format(scan.placementCount),
            })}
          </dd>
        </div>
        <div className="p-4">
          <dt className="flex items-center gap-2 text-[11px] text-muted">
            <Camera className="size-3.5" aria-hidden="true" />
            {t("details.roomScan.capture")}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {t("details.roomScan.viewpoints", {
              count: scan.keyframeCount,
              value: integer.format(scan.keyframeCount),
            })}
          </dd>
        </div>
      </dl>

      <div className="p-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          <span>{formatDate(scan.capturedAt, locale)}</span>
          {scan.deviceModel ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{scan.deviceModel}</span>
            </>
          ) : null}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={roomHref}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-brand-solid px-3.5 text-xs font-semibold text-on-brand transition hover:bg-brand-hover"
          >
            <Rotate3d className="size-3.5" aria-hidden="true" />
            {t("details.roomScan.open3d")}
          </Link>
          {mapHref ? (
            <Link
              href={mapHref}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3.5 text-xs font-semibold text-muted-strong transition hover:bg-surface-hover hover:text-foreground"
            >
              <MapIcon className="size-3.5" aria-hidden="true" />
              {t("details.roomScan.viewMap")}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MediaCard({
  item,
  kindLabel,
  onOpenImage,
}: {
  item: ClientMedia;
  kindLabel: string;
  onOpenImage: (imageId: string) => void;
}) {
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
      <button
        type="button"
        onClick={() => onOpenImage(item.id)}
        aria-haspopup="dialog"
        aria-label={t("details.lightbox.open", { name: item.name })}
        className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-surface-muted text-left outline-none transition hover:border-border-strong focus-visible:ring-3 focus-visible:ring-focus/25"
      >
        {/* Stored images use an authenticated same-origin route and cannot use next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.altText || item.name}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
        />
        <span className="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/20 group-focus-visible:bg-black/20">
          <span className="grid size-10 scale-90 place-items-center rounded-full bg-black/55 text-white opacity-0 shadow-lg backdrop-blur-sm transition group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
            <Maximize2 className="size-4" aria-hidden="true" />
          </span>
        </span>
      </button>
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
        <span className="block truncate text-sm font-semibold text-foreground">
          {item.name}
        </span>
        <span className="mt-1 block text-xs uppercase text-muted">
          {kindLabel}
        </span>
      </span>
    </a>
  );
}

function ImageLightbox({
  images,
  initialImageId,
  onClose,
  labels,
}: {
  images: ClientMedia[];
  initialImageId: string;
  onClose: () => void;
  labels: {
    dialog: string;
    close: string;
    previous: string;
    next: string;
    position: (current: number, total: number) => string;
  };
}) {
  const initialIndex = Math.max(
    0,
    images.findIndex((image) => image.id === initialImageId),
  );
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const showPrevious = useCallback(() => {
    setSelectedIndex((current) =>
      current === 0 ? images.length - 1 : current - 1,
    );
  }, [images.length]);
  const showNext = useCallback(() => {
    setSelectedIndex((current) => (current + 1) % images.length);
  }, [images.length]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && images.length > 1) {
        event.preventDefault();
        showPrevious();
        return;
      }
      if (event.key === "ArrowRight" && images.length > 1) {
        event.preventDefault();
        showNext();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [images.length, onClose, showNext, showPrevious]);

  const activeImage = images[selectedIndex] ?? images[0];
  if (!activeImage) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur-md">
      <div
        className="absolute inset-0 cursor-zoom-out"
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialog}
        tabIndex={-1}
        className="pointer-events-none relative flex h-full w-full flex-col text-white"
      >
        <header className="pointer-events-auto relative z-10 flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0" aria-live="polite">
            <p className="truncate text-sm font-semibold text-white">
              {activeImage.name}
            </p>
            <p className="mt-0.5 text-xs text-white/60">
              {labels.position(selectedIndex + 1, images.length)}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white outline-none ring-1 ring-inset ring-white/15 transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
            aria-label={labels.close}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <figure className="flex min-h-0 flex-1 items-center justify-center px-4 pb-5 sm:px-20 sm:pb-6">
          {/* Stored images use an authenticated same-origin route and cannot use next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={activeImage.id}
            src={activeImage.url}
            alt={activeImage.altText || activeImage.name}
            draggable={false}
            className="pointer-events-auto max-h-full max-w-full select-none object-contain shadow-2xl"
          />
        </figure>

        {images.length > 1 ? (
          <nav aria-label={labels.dialog}>
            <button
              type="button"
              onClick={showPrevious}
              className="pointer-events-auto absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white outline-none ring-1 ring-inset ring-white/15 backdrop-blur-sm transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white sm:left-5 sm:size-12"
              aria-label={labels.previous}
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={showNext}
              className="pointer-events-auto absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white outline-none ring-1 ring-inset ring-white/15 backdrop-blur-sm transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white sm:right-5 sm:size-12"
              aria-label={labels.next}
            >
              <ChevronRight className="size-6" aria-hidden="true" />
            </button>
          </nav>
        ) : null}
      </section>
    </div>
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
  const organizationHref = useOrganizationHref();
  const { t, i18n } = useT("inventory");
  const { t: resourceT } = useT("resource");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [resource, setResource] = useState<ClientResource | null>(null);
  const [localization, setLocalization] =
    useState<ClientResourceLocalization | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("");
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<
    CustomFieldDefinition[]
  >([]);
  const [roomScan, setRoomScan] = useState<
    ClientRoomScanSummary | null | undefined
  >(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxImageId, setLightboxImageId] = useState<string | null>(null);
  const closeLightbox = useCallback(() => setLightboxImageId(null), []);

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

  useEffect(() => {
    if (!resource || resource.type !== "place") {
      setRoomScan(undefined);
      return;
    }
    const controller = new AbortController();
    setRoomScan(undefined);
    void fetchJson<{ scans: ClientRoomScanSummary[] }>("/api/v1/room-scans", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(({ scans }) => {
        setRoomScan(
          scans.find((scan) => scan.roomResourceId === resource.id) ?? null,
        );
      })
      .catch((loadError) => {
        if ((loadError as Error).name !== "AbortError") {
          // Spatial access is optional; the ordinary inventory detail remains usable.
          setRoomScan(undefined);
        }
      });
    return () => controller.abort();
  }, [resource]);

  const mapHref = useMemo(() => {
    if (resource?.gpsLatitude === null || resource?.gpsLongitude === null)
      return null;
    if (
      resource?.gpsLatitude === undefined ||
      resource?.gpsLongitude === undefined
    )
      return null;
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
      router.push(organizationHref("/inventory"));
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
        <Link
          href="/inventory"
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-strong"
        >
          <ArrowLeft className="size-4" /> {t("details.back")}
        </Link>
      </div>
    );
  }

  const customFields = Object.entries(resource.customFields ?? {}).map(
    ([key, value]) => ({
      key,
      value: value as CustomFieldValue,
      definition: customFieldDefinitions.find(
        (definition) => definition.key === key,
      ),
    }),
  );
  const typeLabel = (value: string) =>
    t(`typeSingular.${value}`, { defaultValue: humanize(value) });
  const statusLabel = (value: string) =>
    t(`statuses.${value}`, { defaultValue: humanize(value) });
  const mediaKindLabel = (value: string) =>
    t(`mediaKinds.${value}`, { defaultValue: humanize(value) });
  const { model: objectModel, gallery: galleryMedia } =
    getObjectCapturePresentation(resource.media, resource.cover?.id ?? null);
  const galleryImages = galleryMedia.filter((item) => item.kind === "image");
  const roomGuideImage = roomScan?.assets.find(
    (asset) => asset.kind === "guide_image",
  );
  const articleImage = resource.cover
    ? {
        url: resource.cover.url,
        altText: resource.cover.altText || resource.name,
      }
    : curatedArticleImages[resource.id] ??
      (roomGuideImage
        ? {
            url: roomGuideImage.url,
            altText: t("details.roomScan.guideImageAlt", {
              name: resource.name,
            }),
          }
        : null);
  const isRoom = resource.type === "place";
  const coordinateLabel =
    resource.gpsLatitude !== null && resource.gpsLongitude !== null
      ? `${resource.gpsLatitude.toFixed(5)}, ${resource.gpsLongitude.toFixed(5)}`
      : null;

  return (
    <div className="mx-auto w-full max-w-[1450px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Link
              href="/inventory"
              className="inline-flex items-center gap-1 transition hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />{" "}
              {t("details.breadcrumb.inventory")}
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="truncate">{t("details.breadcrumb.details")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">
              {resource.name}
            </h1>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${statusStyles[resource.status] ?? statusStyles.archived}`}
            >
              {statusLabel(resource.status)}
            </span>
          </div>
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
                    {language.isDefault
                      ? t("details.defaultLanguageSuffix")
                      : ""}
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
          {canViewStock && !isRoom ? (
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
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-solid px-4 text-sm font-semibold text-on-brand transition hover:bg-brand-hover"
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

      {localization &&
      !localization.isDefault &&
      localization.fallbackFields.length ? (
        <div className="mb-5 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-xs leading-5 text-warning">
          {t("details.translationFallback", {
            count: localization.fallbackFields.length,
            value: integer.format(localization.fallbackFields.length),
          })}
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.0fr)_minmax(340px,1.0fr)]">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-xl border border-border bg-surface">
            {objectModel ? (
              <div className="grid border-b border-border lg:grid-cols-2">
                {articleImage ? (
                  <div className="relative aspect-square self-start overflow-hidden bg-[radial-gradient(circle_at_50%_35%,var(--color-surface),var(--color-surface-muted))]">
                    {/* Stored images use an authenticated same-origin route and cannot use next/image. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={articleImage.url}
                      alt={articleImage.altText}
                      className="h-full w-full object-contain"
                    />
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-2.5 py-1 text-[10px] font-semibold text-muted shadow-sm">
                      <ImageIcon className="size-3.5" aria-hidden="true" />
                      {t("details.articleImage")}
                    </span>
                  </div>
                ) : (
                  <div className="grid aspect-square self-start place-items-center bg-gradient-to-br from-success-soft to-surface-muted px-8 text-center text-muted">
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
            ) : articleImage ? (
              <div
                className={`relative overflow-hidden bg-surface-muted ${
                  isRoom ? "aspect-[3/2]" : "aspect-square"
                }`}
              >
                {/* Stored images use an authenticated same-origin route and cannot use next/image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={articleImage.url}
                  alt={articleImage.altText}
                  className="h-full w-full object-cover"
                />
                {isRoom && roomScan ? (
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-5 pb-5 pt-16 text-white">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                        <Rotate3d className="size-3.5" aria-hidden="true" />
                        {t("details.roomScan.roomPlan")}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {roomScan.structureName ?? resource.location ?? resource.name}
                        {roomScan.floorIdentifier
                          ? ` · ${roomScan.floorIdentifier}`
                          : ""}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-black/35 px-2.5 py-1 text-[10px] font-semibold text-white/85 ring-1 ring-inset ring-white/20 backdrop-blur-sm">
                      {t("details.roomScan.revision", {
                        value: integer.format(roomScan.revision),
                      })}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className={`grid place-items-center bg-gradient-to-br from-success-soft to-surface-muted text-muted ${
                  isRoom ? "aspect-[3/2]" : "aspect-square"
                }`}
              >
                {isRoom ? (
                  <Rotate3d className="size-14" strokeWidth={1.25} />
                ) : (
                  <Box className="size-14" strokeWidth={1.25} />
                )}
              </div>
            )}
          </section>

          {galleryMedia.length ? (
            <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ImageIcon className="size-4 text-success" />
                  {articleImage || objectModel
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
                    onOpenImage={setLightboxImageId}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {resource.notes ? (
            <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText className="size-4 text-success" />{" "}
                {t("details.sections.notes")}
              </h2>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-strong">
                {resource.notes}
              </p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-5">
          {roomScan ? (
            <RoomScanSummary
              scan={roomScan}
              locale={locale}
              integer={integer}
            />
          ) : null}

          {resource.description ? (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {t("details.sections.overview")}
              </h2>
              <MarkdownContent value={resource.description} className="mt-3" />
            </section>
          ) : null}

          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">
              {isRoom
                ? t("details.sections.roomDetails")
                : t("details.sections.itemDetails")}
            </h2>
            <div className="grid sm:grid-cols-2 sm:gap-x-5 xl:grid-cols-1 2xl:grid-cols-2">
              <DetailField
                icon={Layers3}
                label={t("fields.type")}
                value={typeLabel(resource.type)}
              />
              <DetailField
                icon={Hash}
                label={t("fields.quantity")}
                value={t("item.units", {
                  count: resource.quantity,
                  value: integer.format(resource.quantity),
                })}
              />
              {resource.sku ? (
                <DetailField
                  icon={Barcode}
                  label={t("fields.sku")}
                  value={resource.sku}
                  mono
                />
              ) : null}
              {resource.barcode ? (
                <DetailField
                  icon={Barcode}
                  label={t("fields.barcode")}
                  value={resource.barcode}
                  mono
                />
              ) : null}
              {resource.serialNumber ? (
                <DetailField
                  icon={Barcode}
                  label={t("fields.serialNumber")}
                  value={resource.serialNumber}
                  mono
                />
              ) : null}
              {resource.location || coordinateLabel ? (
                <DetailField
                  icon={MapPin}
                  label={t("fields.location")}
                  value={
                    <>
                      {resource.location || coordinateLabel}
                      {resource.location && coordinateLabel ? (
                        <span className="mt-1 block font-mono text-xs font-normal text-muted">
                          {coordinateLabel}
                        </span>
                      ) : null}
                    </>
                  }
                />
              ) : null}
              {resource.valueCents !== null ? (
                <DetailField
                  icon={CircleDollarSign}
                  label={t("fields.value")}
                  value={formatValue(
                    resource.valueCents,
                    resource.currency,
                    locale,
                  )}
                />
              ) : null}
              <DetailField
                icon={Flag}
                label={t("fields.priority")}
                value={t("details.priority", {
                  value: integer.format(resource.priority),
                })}
              />
            </div>
            {mapHref ? (
              <a
                href={mapHref}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-success hover:text-success"
              >
                {t("details.openOnMap")} <ChevronRight className="size-3.5" />
              </a>
            ) : null}
          </section>

          {resource.tags.length || resource.categories.length ? (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Tag className="size-4 text-success" />{" "}
                {t("details.sections.classification")}
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {resource.categories.map((category) => (
                  <span
                    key={category.name}
                    className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold text-success"
                  >
                    {category.name}
                  </span>
                ))}
                {resource.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-muted-strong"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {customFields.length ? (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold text-foreground">
                {t("details.sections.customFields")}
              </h2>
              <dl className="mt-4 divide-y divide-border">
                {customFields.map(({ key, value, definition }) => (
                  <div
                    key={key}
                    className="grid grid-cols-[minmax(110px,.8fr)_minmax(0,1.2fr)] gap-4 py-3 text-sm"
                  >
                    <dt className="text-muted">
                      {definition?.label ?? humanize(key)}
                    </dt>
                    <dd className="break-words text-right font-medium text-foreground">
                      {definition ? (
                        <CustomFieldValueDisplay
                          definition={definition}
                          value={value}
                        />
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

          <details className="rounded-xl border border-border bg-surface text-xs text-muted">
            <summary className="cursor-pointer px-5 py-4 font-medium text-muted-strong">
              {resourceT("details.sections.technicalDetails")}
            </summary>
            <div className="space-y-2 border-t border-border px-5 py-4">
              <p className="flex items-center gap-2">
                <CalendarDays className="size-3.5" />
                {t("fields.created")}: {formatDate(resource.createdAt, locale)}
              </p>
              <p className="flex items-center gap-2">
                <Clock3 className="size-3.5" />
                {t("details.lastUpdated", {
                  date: formatDate(resource.updatedAt, locale),
                })}
              </p>
              <p className="break-all font-mono">{resource.id}</p>
            </div>
          </details>
        </aside>
      </div>

      {lightboxImageId && galleryImages.length ? (
        <ImageLightbox
          images={galleryImages}
          initialImageId={lightboxImageId}
          onClose={closeLightbox}
          labels={{
            dialog: t("details.lightbox.dialog"),
            close: t("details.lightbox.close"),
            previous: t("details.lightbox.previous"),
            next: t("details.lightbox.next"),
            position: (current, total) =>
              t("details.lightbox.position", {
                current: integer.format(current),
                total: integer.format(total),
              }),
          }}
        />
      ) : null}
    </div>
  );
}
