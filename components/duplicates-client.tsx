"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  GitMerge,
  Hash,
  ImageIcon,
  Layers3,
  LoaderCircle,
  MapPin,
  Package,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

type MediaItem = {
  id: string;
  url: string;
  name: string;
  mimeType: string;
};

type Category = {
  name: string;
  color?: string;
};

type DuplicateResource = {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  sku: string | null;
  quantity: number;
  location: string | null;
  serialNumber: string | null;
  tags: string[];
  categories: Category[];
  updatedAt: string;
  media: MediaItem[];
  cover: MediaItem | null;
};

type DuplicatePair = {
  left: DuplicateResource;
  right: DuplicateResource;
  score: number;
  reason: string;
};

type PendingMerge = {
  pairKey: string;
  keep: DuplicateResource;
  remove: DuplicateResource;
};

function pairKey(pair: DuplicatePair) {
  return `${pair.left.id}:${pair.right.id}`;
}

function formatDate(value: string, locale: string, unknown: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unknown;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function sentenceCase(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function ResourceImage({ resource }: { resource: DuplicateResource }) {
  const [failed, setFailed] = useState(false);
  const image = resource.cover ?? resource.media.find((item) => item.mimeType.startsWith("image/"));

  if (!image || failed) {
    return (
      <div className="grid aspect-[4/3] w-full place-items-center bg-gradient-to-br from-surface-muted to-surface-subtle text-muted">
        <ImageIcon className="size-9" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt={image.name || resource.name}
      onError={() => setFailed(true)}
      className="aspect-[4/3] w-full bg-surface-muted object-cover"
    />
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  muted = false,
}: {
  icon: typeof Hash;
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1.1rem_5.5rem_minmax(0,1fr)] items-start gap-2 text-xs">
      <Icon className="mt-0.5 size-3.5 text-muted" />
      <span className="text-muted">{label}</span>
      <span className={`min-w-0 break-words font-medium ${muted ? "text-muted" : "text-muted-strong"}`}>
        {value}
      </span>
    </div>
  );
}

function ResourcePanel({ resource, side }: { resource: DuplicateResource; side: "left" | "right" }) {
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const descriptors = [...resource.categories.map((category) => category.name), ...resource.tags];
  const typeLabel = t(`typeSingular.${resource.type}`, {
    defaultValue: resource.type,
  });
  const statusLabel = t(`statuses.${resource.status}`, {
    defaultValue: sentenceCase(resource.status),
  });

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow-sm)]">
      <div className="relative overflow-hidden">
        <ResourceImage resource={resource} />
        <span className="absolute left-3 top-3 rounded-lg bg-zinc-950/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-sm backdrop-blur">
          {side === "left" ? t("duplicates.recordA") : t("duplicates.recordB")}
        </span>
        <span className="absolute bottom-3 right-3 rounded-full bg-surface/90 px-2.5 py-1 text-xs font-semibold capitalize text-muted-strong shadow-sm backdrop-blur">
          {typeLabel}
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-[-0.015em] text-foreground" title={resource.name}>
              {resource.name}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {t("duplicates.updated", {
                date: formatDate(resource.updatedAt, locale, t("values.unknown")),
              })}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-success ring-1 ring-inset ring-success-border">
            {statusLabel}
          </span>
        </div>

        {resource.description ? (
          <p className="mt-4 line-clamp-3 text-xs leading-5 text-muted">{resource.description}</p>
        ) : null}

        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <DetailRow
            icon={Hash}
            label={t("fields.sku")}
            value={resource.sku ?? t("values.notSet")}
            muted={!resource.sku}
          />
          <DetailRow
            icon={Package}
            label={t("fields.quantity")}
            value={t("item.units", {
              count: resource.quantity,
              value: integer.format(resource.quantity),
            })}
          />
          <DetailRow
            icon={MapPin}
            label={t("fields.location")}
            value={resource.location ?? t("values.notSet")}
            muted={!resource.location}
          />
          <DetailRow
            icon={Layers3}
            label={t("details.sections.media")}
            value={t("details.files", {
              count: resource.media.length,
              value: integer.format(resource.media.length),
            })}
          />
        </div>

        <div className="mt-4 flex min-h-7 flex-wrap gap-1.5">
          {descriptors.length ? (
            descriptors.slice(0, 6).map((descriptor, index) => (
              <span key={`${descriptor}-${index}`} className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-[10px] font-medium text-muted">
                <Tag className="size-2.5" />
                {descriptor}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted">
              {t("duplicates.noDescriptors")}
            </span>
          )}
          {descriptors.length > 6 ? (
            <span className="rounded-md bg-surface-muted px-2 py-1 text-[10px] font-medium text-muted">+{descriptors.length - 6}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function DuplicatesClient() {
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }),
    [locale],
  );
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<"scan" | "merge" | null>(null);
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const [merging, setMerging] = useState(false);
  const [successName, setSuccessName] = useState<string | null>(null);

  const loadDuplicates = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/duplicates", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error("SCAN_FAILED");
      }
      setDuplicates(
        Array.isArray((payload as { duplicates?: unknown })?.duplicates)
          ? ((payload as { duplicates: DuplicatePair[] }).duplicates ?? [])
          : [],
      );
    } catch {
      setError("scan");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDuplicates();
  }, [loadDuplicates]);

  function requestMerge(pair: DuplicatePair, keep: "left" | "right") {
    setError(null);
    setSuccessName(null);
    setPendingMerge({
      pairKey: pairKey(pair),
      keep: keep === "left" ? pair.left : pair.right,
      remove: keep === "left" ? pair.right : pair.left,
    });
  }

  async function confirmMerge() {
    if (!pendingMerge) return;
    setMerging(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepResourceId: pendingMerge.keep.id,
          removeResourceId: pendingMerge.remove.id,
        }),
      });
      if (!response.ok) {
        throw new Error("MERGE_FAILED");
      }

      const keptName = pendingMerge.keep.name;
      const removedId = pendingMerge.remove.id;
      const keptId = pendingMerge.keep.id;
      setDuplicates((current) =>
        current.filter(
          (pair) =>
            pair.left.id !== removedId &&
            pair.right.id !== removedId &&
            pairKey(pair) !== pendingMerge.pairKey &&
            !(pair.left.id === keptId && pair.right.id === keptId),
        ),
      );
      setPendingMerge(null);
      setSuccessName(keptName);
    } catch {
      setError("merge");
    } finally {
      setMerging(false);
    }
  }

  return (
    <section aria-labelledby="matches-heading" className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-surface p-4 shadow-[var(--shadow-sm)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <SearchCheck className="size-5" />
          </span>
          <div>
            <h2 id="matches-heading" className="text-sm font-semibold text-foreground">
              {loading
                ? t("duplicates.scanningInventory")
                : t("duplicates.matchCount", {
                    count: duplicates.length,
                    value: integer.format(duplicates.length),
                  })}
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              {t("duplicates.rankingDescription")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadDuplicates(true)}
          disabled={loading || refreshing || merging}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-muted-strong shadow-sm transition hover:border-border-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? t("duplicates.scanning") : t("duplicates.runScan")}
        </button>
      </div>

      {successName ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-success-border bg-success-soft p-4 text-sm text-success" role="status">
          <span className="flex items-start gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0" />
            {t("duplicates.success", { name: successName })}
          </span>
          <button
            type="button"
            onClick={() => setSuccessName(null)}
            className="text-success"
            aria-label={t("duplicates.dismissConfirmation")}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-danger-border bg-danger-soft p-4 text-sm text-danger" role="alert">
          <span className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t(`duplicates.errors.${error}`)}
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-danger"
            aria-label={t("duplicates.dismissError")}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4" aria-label={t("duplicates.loadingMatches")}>
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="rounded-3xl border border-border bg-surface p-4 sm:p-5">
              <div className="mb-4 h-8 w-56 animate-pulse rounded-lg bg-surface-muted" />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="h-[420px] animate-pulse rounded-2xl bg-surface-muted" />
                <div className="h-[420px] animate-pulse rounded-2xl bg-surface-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : !error && duplicates.length === 0 ? (
        <div className="grid min-h-[420px] place-items-center rounded-3xl border border-dashed border-border-strong bg-gradient-to-b from-surface to-surface-subtle px-6 py-14 text-center">
          <div>
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-soft text-success ring-1 ring-inset ring-success-border">
              <Sparkles className="size-6" />
            </span>
            <h2 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
              {t("duplicates.empty.title")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
              {t("duplicates.empty.description")}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {duplicates.map((pair, index) => {
            const key = pairKey(pair);
            const isConfirming = pendingMerge?.pairKey === key;
            const percent = Math.round(Math.min(1, Math.max(0, pair.score)) * 100);

            return (
              <article key={key} className="overflow-hidden rounded-3xl border border-border/80 bg-surface-subtle/70 shadow-[var(--shadow-md)]">
                <header className="flex flex-col gap-3 border-b border-border/80 bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><GitMerge className="size-4" /></span>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {t("duplicates.potentialMatch", {
                          value: integer.format(index + 1),
                        })}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted">{pair.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-gradient-to-r from-brand-solid to-brand-hover" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-muted-strong">
                      {t("duplicates.matchPercent", {
                        value: percentFormatter.format(percent / 100),
                      })}
                    </span>
                  </div>
                </header>

                <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2">
                  <ResourcePanel resource={pair.left} side="left" />
                  <ResourcePanel resource={pair.right} side="right" />
                </div>

                {isConfirming && pendingMerge ? (
                  <div className="border-t border-danger-border bg-danger-soft px-4 py-5 sm:px-6">
                    <div className="mx-auto max-w-4xl">
                      <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger"><ShieldAlert className="size-5" /></span>
                        <div>
                          <h4 className="font-semibold text-danger">
                            {t("duplicates.confirm.title")}
                          </h4>
                          <p className="mt-1 text-sm leading-6 text-danger">
                            <strong>{pendingMerge.keep.name}</strong>{" "}
                            {t("duplicates.confirm.keepSuffix")}{" "}
                            <strong>{pendingMerge.remove.name}</strong>{" "}
                            {t("duplicates.confirm.removeSuffix")}
                          </p>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-danger">
                            {t("duplicates.confirm.irreversible")}
                          </p>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => setPendingMerge(null)}
                          disabled={merging}
                          className="h-10 rounded-xl px-4 text-sm font-semibold text-muted transition hover:bg-surface/70 disabled:opacity-50"
                        >
                          {t("duplicates.confirm.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmMerge()}
                          disabled={merging}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-on-strong shadow-sm transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {merging ? <LoaderCircle className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
                          {merging
                            ? t("duplicates.confirm.merging")
                            : t("duplicates.confirm.submit", {
                                name: pendingMerge.keep.name,
                              })}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <footer className="border-t border-border/80 bg-surface p-3 sm:p-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => requestMerge(pair, "left")}
                        disabled={merging}
                        className="group flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 text-left transition hover:border-brand-border hover:bg-brand-soft/50 disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                            {t("duplicates.keepRecordA")}
                          </span>
                          <span className="block truncate text-sm font-semibold text-muted-strong">{pair.left.name}</span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestMerge(pair, "right")}
                        disabled={merging}
                        className="group flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 text-left transition hover:border-brand-border hover:bg-brand-soft/50 disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">
                            {t("duplicates.keepRecordB")}
                          </span>
                          <span className="block truncate text-sm font-semibold text-muted-strong">{pair.right.name}</span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" />
                      </button>
                    </div>
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
