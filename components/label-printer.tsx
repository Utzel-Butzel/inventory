"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  PackageOpen,
  Plus,
  Printer,
  ScanQrCode,
  Search,
  Wifi,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  canEncodeCode128B,
  Code128Barcode,
  QrCode,
} from "@/components/label-codes";
import { Button, Card, Skeleton } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

import styles from "./label-printer.module.css";

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

type LabelFormatId = "roll-62-35" | "roll-62-50" | "large-102-152";

const LABEL_FORMATS: Array<{
  id: LabelFormatId;
  name: string;
  dimensions: string;
  description: string;
}> = [
  {
    id: "roll-62-35",
    name: "Brother 62 mm · compact",
    dimensions: "62 × 35 mm",
    description: "Short labels from a 62 mm continuous roll.",
  },
  {
    id: "roll-62-50",
    name: "Brother 62 mm · detailed",
    dimensions: "62 × 50 mm",
    description: "More room for long names and inventory URLs.",
  },
  {
    id: "large-102-152",
    name: "Brother large format",
    dimensions: "102 × 152 mm",
    description: "Large labels for boxes, shelving and shipping media.",
  },
];

const EMPTY_PAGINATION: Pagination = {
  page: 1,
  pageSize: 100,
  total: 0,
  pages: 1,
};

function labelClassName(format: LabelFormatId) {
  if (format === "roll-62-35") return styles.roll62Compact;
  if (format === "roll-62-50") return styles.roll62Detailed;
  return styles.large102;
}

function inventoryUrl(origin: string, id: string) {
  const path = `/inventory/${encodeURIComponent(id)}`;
  return origin ? `${origin}${path}` : path;
}

function qrValue(url: string, id: string) {
  return new TextEncoder().encode(url).length <= 213
    ? url
    : `inventory:resource/${id}`;
}

function LabelCard({
  resource,
  format,
  origin,
}: {
  resource: ClientResource;
  format: LabelFormatId;
  origin: string;
}) {
  const url = inventoryUrl(origin, resource.id);
  const visibleCode = resource.sku?.trim() || resource.id;
  const barcodeCode = canEncodeCode128B(visibleCode)
    ? visibleCode
    : resource.id;
  const encodedQrValue = qrValue(url, resource.id);
  const isLarge = format === "large-102-152";

  if (isLarge) {
    return (
      <article
        className={`${styles.label} ${labelClassName(format)}`}
        aria-label={`Printable label for ${resource.name}`}
      >
        <div className={styles.largeMeta}>
          <h2 className={styles.labelName}>{resource.name}</h2>
          <p className={styles.codeLine}>{resource.sku ? `SKU ${resource.sku}` : resource.id}</p>
        </div>
        <QrCode value={encodedQrValue} className={`${styles.qr} ${styles.largeQr}`} />
        <div className={styles.largeMeta}>
          <Code128Barcode value={barcodeCode} className={styles.barcode} />
          <p className={styles.url}>{url}</p>
        </div>
        <p className={styles.location}>
          {resource.location || `${resource.type} · ${resource.quantity} in inventory`}
        </p>
      </article>
    );
  }

  return (
    <article
      className={`${styles.label} ${labelClassName(format)}`}
      aria-label={`Printable label for ${resource.name}`}
    >
      <QrCode value={encodedQrValue} className={styles.qr} />
      <div
        className={
          format === "roll-62-35"
            ? styles.compactDetails
            : styles.detailedDetails
        }
      >
        <h2 className={styles.labelName}>{resource.name}</h2>
        <p className={styles.codeLine}>
          {resource.sku ? `SKU ${resource.sku}` : resource.id}
        </p>
        <Code128Barcode value={barcodeCode} className={styles.barcode} />
        <p className={styles.url}>{url}</p>
      </div>
    </article>
  );
}

export function LabelPrinter() {
  const [origin, setOrigin] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGINATION);
  const [selected, setSelected] = useState<Map<string, ClientResource>>(
    () => new Map(),
  );
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [format, setFormat] = useState<LabelFormatId>("roll-62-35");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams({
      page: String(page),
      pageSize: "100",
    });
    if (debouncedQuery) search.set("q", debouncedQuery);

    setLoading(true);
    setError(null);
    void fetchJson<{
      resources: ClientResource[];
      pagination: Pagination;
    }>(`/api/v1/resources?${search}`, { signal: controller.signal })
      .then((result) => {
        setResources(result.resources);
        setPagination(result.pagination);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load inventory items.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedQuery, page]);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const visibleSelected =
    resources.length > 0 && resources.every((resource) => selectedIds.has(resource.id));
  const selectedResources = useMemo(() => Array.from(selected.values()), [selected]);
  const labels = useMemo(
    () =>
      selectedResources.flatMap((resource) =>
        Array.from(
          { length: copies[resource.id] ?? 1 },
          (_, copyIndex) => ({ resource, copyIndex }),
        ),
      ),
    [copies, selectedResources],
  );

  const toggleResource = (resource: ClientResource) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(resource.id)) next.delete(resource.id);
      else next.set(resource.id, resource);
      return next;
    });
  };

  const toggleVisible = () => {
    setSelected((current) => {
      const next = new Map(current);
      if (visibleSelected) {
        resources.forEach((resource) => next.delete(resource.id));
      } else {
        resources.forEach((resource) => next.set(resource.id, resource));
      }
      return next;
    });
  };

  const setCopyCount = (id: string, nextCount: number) => {
    setCopies((current) => ({
      ...current,
      [id]: Math.min(99, Math.max(1, nextCount)),
    }));
  };

  const clearSelection = () => {
    setSelected(new Map());
    setCopies({});
  };

  return (
    <div className={styles.page}>
      <div className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#635bff]">
            <ScanQrCode size={15} aria-hidden="true" /> Label studio
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
            Print labels that scan.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Select inventory items, choose the loaded Brother media and print QR
            plus Code 128 labels directly through your browser.
          </p>
        </div>
        <Button
          size="lg"
          onClick={() => window.print()}
          disabled={labels.length === 0}
        >
          <Printer size={17} aria-hidden="true" />
          Print {labels.length || ""} {labels.length === 1 ? "label" : "labels"}
        </Button>
      </div>

      <div className={styles.workspace}>
        <div className="space-y-4">
          <Card className={styles.panel}>
            <div className="border-b border-slate-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">1. Select items</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Selection stays active while you search or change pages.
                  </p>
                </div>
                {selected.size ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="shrink-0 text-xs font-semibold text-slate-500 hover:text-slate-950"
                  >
                    Clear {selected.size}
                  </button>
                ) : null}
              </div>
              <label className="relative mt-4 block">
                <span className="sr-only">Search inventory</span>
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, SKU or location…"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 text-sm outline-none transition focus:border-[#776fff] focus:bg-white focus:ring-4 focus:ring-[#635bff]/10"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </label>
            </div>

            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <button
                type="button"
                onClick={toggleVisible}
                disabled={resources.length === 0}
                className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 disabled:opacity-40"
              >
                <span
                  className={`grid size-4 place-items-center rounded border ${
                    visibleSelected
                      ? "border-[#635bff] bg-[#635bff] text-white"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {visibleSelected ? <Check size={11} aria-hidden="true" /> : null}
                </span>
                Select page
              </button>
              <span className="text-[11px] text-slate-400">
                {pagination.total} {pagination.total === 1 ? "item" : "items"}
              </span>
            </div>

            {error ? (
              <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                {error}
              </div>
            ) : null}

            <div className={styles.results}>
              {loading ? (
                <div className="space-y-2 p-3" aria-label="Loading inventory">
                  {Array.from({ length: 7 }, (_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : resources.length === 0 ? (
                <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
                  <PackageOpen size={25} className="text-slate-300" aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">No matching items</p>
                  <p className="mt-1 text-xs text-slate-500">Try another name, SKU or location.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {resources.map((resource) => {
                    const isSelected = selectedIds.has(resource.id);
                    return (
                      <button
                        type="button"
                        key={resource.id}
                        onClick={() => toggleResource(resource)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                          isSelected ? "bg-[#f4f3ff]" : "hover:bg-slate-50"
                        }`}
                        aria-pressed={isSelected}
                      >
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-md border ${
                            isSelected
                              ? "border-[#635bff] bg-[#635bff] text-white"
                              : "border-slate-300 bg-white"
                          }`}
                        >
                          {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-slate-900">
                            {resource.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                            {resource.sku || "No SKU"}
                            {resource.location ? ` · ${resource.location}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold capitalize text-slate-500">
                          {resource.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {pagination.pages > 1 ? (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
                <span className="text-[11px] text-slate-500">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-35"
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= pagination.pages}
                    onClick={() =>
                      setPage((current) => Math.min(pagination.pages, current + 1))
                    }
                    className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-35"
                    aria-label="Next page"
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
          </Card>

          {selectedResources.length ? (
            <Card className={styles.panel}>
              <div className="border-b border-slate-200 px-4 py-3.5">
                <h2 className="text-sm font-semibold text-slate-950">Copies</h2>
              </div>
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
                {selectedResources.map((resource) => {
                  const count = copies[resource.id] ?? 1;
                  return (
                    <div key={resource.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                        {resource.name}
                      </span>
                      <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
                        <button
                          type="button"
                          onClick={() => setCopyCount(resource.id, count - 1)}
                          className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100"
                          aria-label={`Fewer copies of ${resource.name}`}
                        >
                          <Minus size={13} aria-hidden="true" />
                        </button>
                        <span className="w-8 text-center text-xs font-semibold tabular-nums text-slate-800">
                          {count}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCopyCount(resource.id, count + 1)}
                          className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100"
                          aria-label={`More copies of ${resource.name}`}
                        >
                          <Plus size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>

        <Card className={`${styles.panel} ${styles.previewPanel}`}>
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">2. Choose media</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Match this size to the paper selected in the Brother driver.
                </p>
              </div>
              <label className="block xl:w-[330px]">
                <span className="sr-only">Label size</span>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as LabelFormatId)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#776fff] focus:ring-4 focus:ring-[#635bff]/10"
                >
                  {LABEL_FORMATS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} · {option.dimensions}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
              {LABEL_FORMATS.find((option) => option.id === format)?.description}
            </p>
          </div>

          <div className={styles.previewViewport}>
            {labels.length ? (
              <div className={`${styles.previewStack} ${styles.printSurface}`}>
                {labels.map(({ resource, copyIndex }) => (
                  <LabelCard
                    key={`${resource.id}-${copyIndex}`}
                    resource={resource}
                    format={format}
                    origin={origin}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[500px] flex-col items-center justify-center text-center">
                <span className="grid size-14 place-items-center rounded-2xl border border-white bg-white/80 text-slate-400 shadow-sm">
                  <ScanQrCode size={25} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-800">Select an item to preview</h3>
                <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
                  Every label includes its name, SKU or stable ID, inventory URL,
                  QR code and Code 128 barcode.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3 border-t border-slate-200 bg-white p-4 sm:p-5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#eeedff] text-[#635bff]">
              <Wifi size={15} aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-xs font-semibold text-slate-800">Brother Wi-Fi printing</h3>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                Add the printer to this computer first. In the browser print dialog,
                select that Brother printer, the matching media size, 100% scale and
                no margins. Printing uses the installed system driver; this page does
                not send RAW commands directly to the printer.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
