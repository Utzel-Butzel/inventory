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
import { useCallback, useEffect, useState } from "react";

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

function getErrorMessage(payload: unknown, fallback: string) {
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

function pairKey(pair: DuplicatePair) {
  return `${pair.left.id}:${pair.right.id}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function sentenceCase(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function ResourceImage({ resource }: { resource: DuplicateResource }) {
  const [failed, setFailed] = useState(false);
  const image = resource.cover ?? resource.media.find((item) => item.mimeType.startsWith("image/"));

  if (!image || failed) {
    return (
      <div className="grid aspect-[4/3] w-full place-items-center bg-gradient-to-br from-zinc-100 to-zinc-50 text-zinc-300">
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
      className="aspect-[4/3] w-full bg-zinc-100 object-cover"
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
      <Icon className="mt-0.5 size-3.5 text-zinc-400" />
      <span className="text-zinc-400">{label}</span>
      <span className={`min-w-0 break-words font-medium ${muted ? "text-zinc-400" : "text-zinc-700"}`}>
        {value}
      </span>
    </div>
  );
}

function ResourcePanel({ resource, side }: { resource: DuplicateResource; side: "left" | "right" }) {
  const descriptors = [...resource.categories.map((category) => category.name), ...resource.tags];

  return (
    <article className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="relative overflow-hidden">
        <ResourceImage resource={resource} />
        <span className="absolute left-3 top-3 rounded-lg bg-zinc-950/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-sm backdrop-blur">
          {side === "left" ? "Record A" : "Record B"}
        </span>
        <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold capitalize text-zinc-700 shadow-sm backdrop-blur">
          {resource.type}
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold tracking-[-0.015em] text-zinc-950" title={resource.name}>
              {resource.name}
            </h3>
            <p className="mt-1 text-xs text-zinc-400">Updated {formatDate(resource.updatedAt)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
            {sentenceCase(resource.status)}
          </span>
        </div>

        {resource.description ? (
          <p className="mt-4 line-clamp-3 text-xs leading-5 text-zinc-500">{resource.description}</p>
        ) : null}

        <div className="mt-5 space-y-3 border-t border-zinc-100 pt-4">
          <DetailRow icon={Hash} label="SKU" value={resource.sku ?? "Not set"} muted={!resource.sku} />
          <DetailRow icon={Package} label="Quantity" value={`${resource.quantity} ${resource.quantity === 1 ? "unit" : "units"}`} />
          <DetailRow icon={MapPin} label="Location" value={resource.location ?? "Not set"} muted={!resource.location} />
          <DetailRow icon={Layers3} label="Media" value={`${resource.media.length} ${resource.media.length === 1 ? "file" : "files"}`} />
        </div>

        <div className="mt-4 flex min-h-7 flex-wrap gap-1.5">
          {descriptors.length ? (
            descriptors.slice(0, 6).map((descriptor, index) => (
              <span key={`${descriptor}-${index}`} className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-600">
                <Tag className="size-2.5" />
                {descriptor}
              </span>
            ))
          ) : (
            <span className="text-xs text-zinc-400">No tags or categories</span>
          )}
          {descriptors.length > 6 ? (
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500">+{descriptors.length - 6}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function DuplicatesClient() {
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  const [merging, setMerging] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const loadDuplicates = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/duplicates", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not scan for duplicates."));
      }
      setDuplicates(
        Array.isArray((payload as { duplicates?: unknown })?.duplicates)
          ? ((payload as { duplicates: DuplicatePair[] }).duplicates ?? [])
          : [],
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not scan for duplicates.");
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
    setSuccess(null);
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
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not merge these records."));
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
      setSuccess(`Merged successfully. “${keptName}” is now the source record.`);
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : "Could not merge these records.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <section aria-labelledby="matches-heading" className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_4px_20px_rgba(15,23,42,0.035)] sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
            <SearchCheck className="size-5" />
          </span>
          <div>
            <h2 id="matches-heading" className="text-sm font-semibold text-zinc-950">
              {loading ? "Scanning inventory…" : `${duplicates.length} potential ${duplicates.length === 1 ? "match" : "matches"}`}
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500">Matches are ranked using SKU and name similarity.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadDuplicates(true)}
          disabled={loading || refreshing || merging}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Scanning…" : "Run scan"}
        </button>
      </div>

      {success ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">
          <span className="flex items-start gap-2.5"><Check className="mt-0.5 size-4 shrink-0" />{success}</span>
          <button type="button" onClick={() => setSuccess(null)} className="text-emerald-700" aria-label="Dismiss confirmation"><X className="size-4" /></button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
          <span className="flex items-start gap-2.5"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-rose-700" aria-label="Dismiss error"><X className="size-4" /></button>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4" aria-label="Loading duplicate matches">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="rounded-3xl border border-zinc-200 bg-white p-4 sm:p-5">
              <div className="mb-4 h-8 w-56 animate-pulse rounded-lg bg-zinc-100" />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="h-[420px] animate-pulse rounded-2xl bg-zinc-100" />
                <div className="h-[420px] animate-pulse rounded-2xl bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      ) : !error && duplicates.length === 0 ? (
        <div className="grid min-h-[420px] place-items-center rounded-3xl border border-dashed border-zinc-300 bg-gradient-to-b from-white to-zinc-50 px-6 py-14 text-center">
          <div>
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Sparkles className="size-6" />
            </span>
            <h2 className="mt-5 text-lg font-semibold tracking-tight text-zinc-950">Everything looks tidy</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">No likely duplicate records were found. Run the scan again after importing or creating more inventory.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {duplicates.map((pair, index) => {
            const key = pairKey(pair);
            const isConfirming = pendingMerge?.pairKey === key;
            const percent = Math.round(Math.min(1, Math.max(0, pair.score)) * 100);

            return (
              <article key={key} className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-zinc-50/70 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                <header className="flex flex-col gap-3 border-b border-zinc-200/80 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600"><GitMerge className="size-4" /></span>
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-950">Potential match {index + 1}</h3>
                      <p className="mt-0.5 text-xs text-zinc-500">{pair.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-zinc-700">{percent}% match</span>
                  </div>
                </header>

                <div className="grid gap-3 p-3 sm:p-4 md:grid-cols-2">
                  <ResourcePanel resource={pair.left} side="left" />
                  <ResourcePanel resource={pair.right} side="right" />
                </div>

                {isConfirming && pendingMerge ? (
                  <div className="border-t border-rose-200 bg-rose-50 px-4 py-5 sm:px-6">
                    <div className="mx-auto max-w-4xl">
                      <div className="flex items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700"><ShieldAlert className="size-5" /></span>
                        <div>
                          <h4 className="font-semibold text-rose-950">Permanently merge these records?</h4>
                          <p className="mt-1 text-sm leading-6 text-rose-800">
                            <strong>{pendingMerge.keep.name}</strong> will be kept. Media, quantity, tags, and missing details from <strong>{pendingMerge.remove.name}</strong> will be moved into it, then the second record will be permanently deleted.
                          </p>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-rose-700">This action cannot be undone.</p>
                        </div>
                      </div>
                      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={() => setPendingMerge(null)}
                          disabled={merging}
                          className="h-10 rounded-xl px-4 text-sm font-semibold text-zinc-600 transition hover:bg-white/70 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmMerge()}
                          disabled={merging}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {merging ? <LoaderCircle className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
                          {merging ? "Merging…" : `Keep “${pendingMerge.keep.name}” and delete the other`}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <footer className="border-t border-zinc-200/80 bg-white p-3 sm:p-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => requestMerge(pair, "left")}
                        disabled={merging}
                        className="group flex min-h-12 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50"
                      >
                        <span className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Keep record A</span><span className="block truncate text-sm font-semibold text-zinc-800">{pair.left.name}</span></span>
                        <ArrowRight className="size-4 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestMerge(pair, "right")}
                        disabled={merging}
                        className="group flex min-h-12 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50"
                      >
                        <span className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Keep record B</span><span className="block truncate text-sm font-semibold text-zinc-800">{pair.right.name}</span></span>
                        <ArrowRight className="size-4 shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
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
