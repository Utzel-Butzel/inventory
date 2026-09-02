"use client";

import {
  Barcode,
  Boxes,
  ExternalLink,
  Eye,
  LoaderCircle,
  MapPin,
  Package,
  Search,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useT } from "next-i18next/client";
import { useEffect, useId, useState } from "react";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { ResponsiveMediaImage } from "@/components/responsive-media-image";
import { Badge, cn } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

export type InventorySelectItem = {
  id: string;
  name: string;
  sku?: string | null;
  type?: string | null;
  status?: string | null;
  description?: string | null;
  barcode?: string | null;
  location?: string | null;
  quantity?: number;
  trackingMode?: string | null;
  cover?: {
    id?: string;
    url: string;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type InventorySelectProps = {
  items: InventorySelectItem[];
  selectedIds: readonly string[];
  onSelect: (item: InventorySelectItem) => void;
  query: string;
  onQueryChange: (query: string) => void;
  label: string;
  placeholder: string;
  emptyText: string;
  searchingText: string;
  selectedText: string;
  searching?: boolean;
  disabled?: boolean;
  itemMeta?: (item: InventorySelectItem) => string;
  className?: string;
};

const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";

function displayStatus(status: string | null | undefined, t: TFunction) {
  if (!status) return "—";
  const key = status === "in-use" ? "inUse" : status;
  const translated = t(`statuses.${key}`);
  return translated === `statuses.${key}` ? status : translated;
}

function InventoryQuickPreview({
  item,
  onClose,
}: {
  item: InventorySelectItem;
  onClose: () => void;
}) {
  const { t } = useT("resource");
  const titleId = useId();
  const [resource, setResource] = useState<ClientResource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchJson<ClientResource>(`/api/v1/resources/${item.id}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((result) => setResource(result))
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("inventorySelect.preview.loadError"),
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [item.id, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const preview = resource ?? item;
  const cover = resource?.cover ?? item.cover;
  const description = resource?.description ?? item.description;
  const fields = [
    {
      label: t("inventorySelect.preview.fields.sku"),
      value: preview.sku || "—",
    },
    {
      label: t("inventorySelect.preview.fields.type"),
      value: preview.type || "—",
    },
    {
      label: t("inventorySelect.preview.fields.status"),
      value: displayStatus(preview.status, t),
    },
    {
      label: t("inventorySelect.preview.fields.quantity"),
      value:
        typeof preview.quantity === "number" ? String(preview.quantity) : "—",
    },
    {
      label: t("inventorySelect.preview.fields.location"),
      value: preview.location || "—",
    },
    {
      label: t("inventorySelect.preview.fields.barcode"),
      value: preview.barcode || "—",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-overlay p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-border bg-surface shadow-2xl sm:rounded-3xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t("inventorySelect.preview.eyebrow")}
            </p>
            <h2 id={titleId} className="mt-1 truncate text-base font-semibold text-foreground">
              {preview.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("inventorySelect.preview.close")}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-muted">
            {cover?.url ? (
              <ResponsiveMediaImage
                media={cover}
                alt={cover.altText || preview.name}
                widths={[384, 640, 960]}
                sizes="(min-width: 640px) 544px, 100vw"
                className="aspect-[16/9] w-full object-cover"
              />
            ) : (
              <div className="grid aspect-[16/9] place-items-center text-muted">
                <Package className="size-10" aria-hidden="true" />
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {t("inventorySelect.preview.loading")}
            </div>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-warning-border bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning">
              {t("inventorySelect.preview.partial")}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {fields.map((field) => (
              <div key={field.label} className="rounded-xl border border-border bg-surface-subtle px-3 py-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                  {field.label}
                </p>
                <p className="mt-1 break-words text-[11px] font-medium text-foreground">
                  {field.value}
                </p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border px-3.5 py-3">
            <p className="text-[10px] font-semibold text-muted-strong">
              {t("inventorySelect.preview.fields.description")}
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-5 text-muted">
              {description?.trim() || t("inventorySelect.preview.noDescription")}
            </p>
          </div>

          <Link
            href={`/inventory/${item.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[11px] font-semibold text-foreground transition hover:bg-surface-hover"
          >
            {t("inventorySelect.preview.openItem")}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}

export function InventorySelect({
  items,
  selectedIds,
  onSelect,
  query,
  onQueryChange,
  label,
  placeholder,
  emptyText,
  searchingText,
  selectedText,
  searching = false,
  disabled = false,
  itemMeta,
  className,
}: InventorySelectProps) {
  const { t } = useT("resource");
  const [previewItem, setPreviewItem] = useState<InventorySelectItem | null>(null);

  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold text-muted-strong">
        {label}
        <span className="relative mt-1.5 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={placeholder}
            className={`${inputClass} pl-9`}
            disabled={disabled}
          />
        </span>
      </label>

      <div className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-xl border border-border p-1.5">
        {searching ? (
          <div className="flex min-h-20 items-center justify-center gap-2 text-[11px] text-muted">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            {searchingText}
          </div>
        ) : items.length ? (
          items.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-1 rounded-lg transition",
                  selected ? "bg-brand-soft text-brand" : "hover:bg-surface-hover",
                )}
              >
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(item)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-muted text-muted">
                    {item.cover?.url ? (
                      <ResponsiveMediaImage
                        media={item.cover}
                        alt=""
                        widths={[96, 192]}
                        sizes="40px"
                        className="h-full w-full object-cover"
                      />
                    ) : item.trackingMode === "serialized" ? (
                      <Barcode className="size-4" aria-hidden="true" />
                    ) : item.type === "place" ? (
                      <MapPin className="size-4" aria-hidden="true" />
                    ) : item.type === "project" ? (
                      <Boxes className="size-4" aria-hidden="true" />
                    ) : (
                      <Package className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">
                      {item.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[9px] text-muted">
                      {itemMeta?.(item) || item.sku || item.type || "—"}
                    </span>
                  </span>
                  {selected ? (
                    <Badge tone="brand" className="min-h-5 shrink-0 px-1.5 text-[9px]">
                      {selectedText}
                    </Badge>
                  ) : null}
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setPreviewItem(item)}
                  aria-label={t("inventorySelect.preview.open", { name: item.name })}
                  title={t("inventorySelect.preview.button")}
                  className="mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })
        ) : (
          <div className="flex min-h-20 items-center justify-center px-4 text-center text-[11px] leading-4 text-muted">
            {emptyText}
          </div>
        )}
      </div>

      {previewItem ? (
        <InventoryQuickPreview item={previewItem} onClose={() => setPreviewItem(null)} />
      ) : null}
    </div>
  );
}
