"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  Minus,
  PackageOpen,
  Pencil,
  Plus,
  Printer,
  ScanQrCode,
  Search,
  Wifi,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import {
  LabelDesigner,
  type LabelSetupDraft,
} from "@/components/label-designer";
import { canEncodeQr } from "@/components/label-codes";
import { LabelRenderer } from "@/components/label-renderer";
import { Button, Card, Skeleton } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";
import {
  hasVisibleQrImageOverlap,
  type LabelElement,
  type LabelSetupDto,
} from "@/lib/label-setup-contract";
import { resourceShortUrl } from "@/lib/resource-short-link";

import styles from "./label-printer.module.css";

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

const EMPTY_PAGINATION: Pagination = {
  page: 1,
  pageSize: 100,
  total: 0,
  pages: 1,
};

const DEFAULT_ELEMENTS: LabelElement[] = [
  { type: "qr", x: 3, y: 14, width: 40, height: 72, visible: true },
  { type: "image", x: 3, y: 14, width: 40, height: 72, visible: false, fit: "cover" },
  { type: "name", x: 46, y: 8, width: 51, height: 20, visible: true, fontSizeMm: 3.3, align: "left" },
  { type: "identifier", x: 46, y: 31, width: 51, height: 10, visible: true, fontSizeMm: 2.2, align: "left" },
  { type: "barcode", x: 46, y: 45, width: 51, height: 17, visible: true },
  { type: "url", x: 46, y: 66, width: 51, height: 21, visible: true, fontSizeMm: 1.55, align: "left" },
  { type: "location", x: 46, y: 90, width: 51, height: 7, visible: false, fontSizeMm: 1.55, align: "left" },
];

export function LabelPrinter({ canWrite = false }: { canWrite?: boolean }) {
  const { t } = useT("labels");
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
  const [setups, setSetups] = useState<LabelSetupDto[]>([]);
  const [setupId, setSetupId] = useState("");
  const [setupsLoading, setSetupsLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [designerDraft, setDesignerDraft] = useState<LabelSetupDraft | null>(null);
  const [designerSaving, setDesignerSaving] = useState(false);
  const [designerError, setDesignerError] = useState<string | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [imageRetryToken, setImageRetryToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setSetupsLoading(true);
    setSetupError(null);
    void fetchJson<{ labelSetups: LabelSetupDto[] }>("/api/v1/label-setups", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((result) => {
        setSetups(result.labelSetups);
        setSetupId((current) =>
          result.labelSetups.some((setup) => setup.id === current)
            ? current
            : (result.labelSetups[0]?.id ?? ""),
        );
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setSetupError(
          loadError instanceof Error
            ? loadError.message
            : t("errors.loadSetups"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSetupsLoading(false);
      });
    return () => controller.abort();
  }, [t]);

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
      media: "cover",
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
            : t("errors.loadItems"),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedQuery, page, t]);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const activeSetup = useMemo(
    () => setups.find((setup) => setup.id === setupId) ?? setups[0] ?? null,
    [setupId, setups],
  );
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
  const setupHasQrImageOverlap = activeSetup
    ? hasVisibleQrImageOverlap(activeSetup.elements)
    : false;

  useEffect(() => {
    setPrintError(null);
  }, [activeSetup, labels]);

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

  const openNewSetup = () => {
    setDesignerError(null);
    setDesignerDraft({
      name: activeSetup
        ? t("setup.copyName", { name: activeSetup.name })
        : t("setup.defaultName"),
      widthMm: activeSetup?.widthMm ?? 62,
      heightMm: activeSetup?.heightMm ?? 35,
      elements: structuredClone(activeSetup?.elements ?? DEFAULT_ELEMENTS),
    });
  };

  const openDesigner = () => {
    if (!activeSetup) return openNewSetup();
    setDesignerError(null);
    setDesignerDraft(structuredClone(activeSetup));
  };

  const saveDesigner = async () => {
    if (!designerDraft || designerSaving) return;
    setDesignerSaving(true);
    setDesignerError(null);
    try {
      const payload = {
        name: designerDraft.name,
        widthMm: designerDraft.widthMm,
        heightMm: designerDraft.heightMm,
        elements: designerDraft.elements,
      };
      const result = designerDraft.id
        ? await fetchJson<{ labelSetup: LabelSetupDto }>(
            `/api/v1/label-setups/${designerDraft.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, revision: designerDraft.revision }),
            },
          )
        : await fetchJson<{ labelSetup: LabelSetupDto }>("/api/v1/label-setups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      setSetups((current) =>
        [...current.filter((setup) => setup.id !== result.labelSetup.id), result.labelSetup]
          .sort((left, right) => left.name.localeCompare(right.name)),
      );
      setSetupId(result.labelSetup.id);
      setDesignerDraft(null);
    } catch (saveError) {
      setDesignerError(
        saveError instanceof Error ? saveError.message : t("errors.saveSetup"),
      );
    } finally {
      setDesignerSaving(false);
    }
  };

  const deleteDesignerSetup = async () => {
    if (!designerDraft?.id || !designerDraft.revision || designerSaving) return;
    if (!window.confirm(t("setup.deleteConfirm", { name: designerDraft.name }))) {
      return;
    }
    setDesignerSaving(true);
    setDesignerError(null);
    try {
      await fetchJson<null>(
        `/api/v1/label-setups/${designerDraft.id}?revision=${designerDraft.revision}`,
        { method: "DELETE" },
      );
      const remaining = setups.filter((setup) => setup.id !== designerDraft.id);
      setSetups(remaining);
      setSetupId(remaining[0]?.id ?? "");
      setDesignerDraft(null);
    } catch (deleteError) {
      setDesignerError(
        deleteError instanceof Error
          ? deleteError.message
          : t("errors.deleteSetup"),
      );
    } finally {
      setDesignerSaving(false);
    }
  };

  const printLabels = async () => {
    if (!labels.length || !activeSetup || preparingPrint) return;
    setPrintError(null);
    if (setupHasQrImageOverlap) {
      setPrintError(t("errors.overlapShort"));
      return;
    }

    const qrEnabled = activeSetup.elements.some(
      (element) => element.type === "qr" && element.visible,
    );
    if (
      qrEnabled &&
      labels.some(({ resource }) =>
        !canEncodeQr(resourceShortUrl(origin, resource.id)),
      )
    ) {
      setPrintError(t("errors.urlTooLong"));
      return;
    }

    const imageEnabled = activeSetup.elements.some(
      (element) => element.type === "image" && element.visible,
    );
    if (imageEnabled) {
      const missingNames = Array.from(
        new Set(
          labels
            .filter(({ resource }) => !resource.cover?.url)
            .map(({ resource }) => resource.name),
        ),
      );
      if (missingNames.length) {
        const examples = missingNames.join(", ");
        setPrintError(
          t("errors.missingImages", {
            examples,
            count: missingNames.length,
          }),
        );
        return;
      }
    }

    setPreparingPrint(true);
    try {
      if (imageEnabled) {
        setImageRetryToken((current) => current + 1);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(
          `.${styles.printSurface} .printable-label-image`,
        ),
      );
      if (imageEnabled && images.length !== labels.length) {
        setPrintError(t("errors.imageRender"));
        return;
      }
      const imageResults = await Promise.all(
        images.map(async (image) => {
          if (!image.complete) {
            const loaded = await new Promise<boolean>((resolve) => {
              const finish = (result: boolean) => {
                window.clearTimeout(timeout);
                image.removeEventListener("load", handleLoad);
                image.removeEventListener("error", handleError);
                resolve(result);
              };
              const handleLoad = () => finish(true);
              const handleError = () => finish(false);
              const timeout = window.setTimeout(() => finish(false), 8_000);
              image.addEventListener("load", handleLoad, { once: true });
              image.addEventListener("error", handleError, { once: true });
              if (image.complete) finish(image.naturalWidth > 0);
            });
            if (!loaded) return false;
          }
          if (!image.complete || image.naturalWidth === 0) return false;
          if (typeof image.decode === "function") {
            const decoded = await Promise.race([
              image
                .decode()
                .then(() => true)
                .catch(() => false),
              new Promise<false>((resolve) => {
                window.setTimeout(() => resolve(false), 2_000);
              }),
            ]);
            if (!decoded) return false;
          }
          return image.naturalWidth > 0;
        }),
      );
      if (imageResults.some((ready) => !ready)) {
        setPrintError(t("errors.imageLoad"));
        return;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      window.print();
    } finally {
      setPreparingPrint(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            <ScanQrCode size={15} aria-hidden="true" /> {t("header.eyebrow")}
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
            {t("header.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {t("header.description")}
          </p>
        </div>
        <Button
          size="lg"
          onClick={printLabels}
          disabled={
            labels.length === 0 ||
            !activeSetup ||
            preparingPrint ||
            setupHasQrImageOverlap
          }
        >
          {preparingPrint ? (
            <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
          ) : (
            <Printer size={17} aria-hidden="true" />
          )}
          {preparingPrint
            ? t("print.preparing")
            : t("print.button", { count: labels.length })}
        </Button>
      </div>

      {setupHasQrImageOverlap || printError ? (
        <p
          role="alert"
          className={`mb-5 rounded-xl border px-4 py-3 text-sm leading-5 ${
            setupHasQrImageOverlap
              ? "border-warning-border bg-warning-soft text-warning"
              : "border-danger-border bg-danger-soft text-danger"
          }`}
        >
          {setupHasQrImageOverlap
            ? t("errors.overlap")
            : printError}
        </p>
      ) : null}

      {activeSetup ? (
        <style media="print">{`@page { size: ${activeSetup.widthMm}mm ${activeSetup.heightMm}mm; margin: 0; }`}</style>
      ) : null}

      <div className={styles.workspace}>
        <div className="space-y-4">
          <Card className={styles.panel}>
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("selection.title")}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {t("selection.description")}
                  </p>
                </div>
                {selected.size ? (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="shrink-0 text-xs font-semibold text-muted hover:text-foreground"
                  >
                    {t("selection.clear", { count: selected.size })}
                  </button>
                ) : null}
              </div>
              <label className="relative mt-4 block">
                <span className="sr-only">{t("selection.search")}</span>
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("selection.searchPlaceholder")}
                  className="h-10 w-full rounded-xl border border-border bg-surface-subtle pl-9 pr-9 text-sm text-foreground outline-none transition focus:border-focus focus:bg-surface focus:ring-4 focus:ring-focus/10"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={t("selection.clearSearch")}
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-hover hover:text-muted-strong"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </label>
            </div>

            <div className="flex items-center justify-between border-b border-border bg-surface-subtle/70 px-4 py-2.5">
              <button
                type="button"
                onClick={toggleVisible}
                disabled={resources.length === 0}
                className="inline-flex items-center gap-2 text-xs font-semibold text-muted disabled:opacity-40"
              >
                <span
                  className={`grid size-4 place-items-center rounded border ${
                    visibleSelected
                      ? "border-brand-solid bg-brand-solid text-on-brand"
                      : "border-border-strong bg-surface"
                  }`}
                >
                  {visibleSelected ? <Check size={11} aria-hidden="true" /> : null}
                </span>
                {t("selection.selectPage")}
              </button>
              <span className="text-[11px] text-muted">
                {t("selection.itemCount", { count: pagination.total })}
              </span>
            </div>

            {error ? (
              <div className="m-4 rounded-xl border border-danger-border bg-danger-soft px-3 py-2.5 text-xs text-danger">
                {error}
              </div>
            ) : null}

            <div className={styles.results}>
              {loading ? (
                <div
                  className="space-y-2 p-3"
                  aria-label={t("selection.loading")}
                >
                  {Array.from({ length: 7 }, (_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : resources.length === 0 ? (
                <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
                  <PackageOpen size={25} className="text-muted" aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    {t("selection.empty")}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t("selection.emptyDescription")}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {resources.map((resource) => {
                    const isSelected = selectedIds.has(resource.id);
                    return (
                      <button
                        type="button"
                        key={resource.id}
                        onClick={() => toggleResource(resource)}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                          isSelected ? "bg-brand-soft" : "hover:bg-surface-hover"
                        }`}
                        aria-pressed={isSelected}
                      >
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-md border ${
                            isSelected
                              ? "border-brand-solid bg-brand-solid text-on-brand"
                              : "border-border-strong bg-surface"
                          }`}
                        >
                          {isSelected ? <Check size={13} aria-hidden="true" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-foreground">
                            {resource.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted">
                            {resource.sku || t("selection.noSku")}
                            {resource.location ? ` · ${resource.location}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-1 text-[10px] font-semibold capitalize text-muted">
                          {resource.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {pagination.pages > 1 ? (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-[11px] text-muted">
                  {t("selection.pagination", {
                    page: pagination.page,
                    pages: pagination.pages,
                  })}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted disabled:opacity-35"
                    aria-label={t("selection.previousPage")}
                  >
                    <ChevronLeft size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    disabled={page >= pagination.pages}
                    onClick={() =>
                      setPage((current) => Math.min(pagination.pages, current + 1))
                    }
                    className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted disabled:opacity-35"
                    aria-label={t("selection.nextPage")}
                  >
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
          </Card>

          {selectedResources.length ? (
            <Card className={styles.panel}>
              <div className="border-b border-border px-4 py-3.5">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("copies.title")}
                </h2>
              </div>
              <div className="max-h-64 divide-y divide-border overflow-y-auto">
                {selectedResources.map((resource) => {
                  const count = copies[resource.id] ?? 1;
                  return (
                    <div key={resource.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-strong">
                        {resource.name}
                      </span>
                      <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
                        <button
                          type="button"
                          onClick={() => setCopyCount(resource.id, count - 1)}
                          className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-hover"
                          aria-label={t("copies.fewer", { name: resource.name })}
                        >
                          <Minus size={13} aria-hidden="true" />
                        </button>
                        <span className="w-8 text-center text-xs font-semibold tabular-nums text-foreground">
                          {count}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCopyCount(resource.id, count + 1)}
                          className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-hover"
                          aria-label={t("copies.more", { name: resource.name })}
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
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("setup.title")}
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted">
                  {t("setup.description")}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="block min-w-0 sm:w-[310px]">
                  <span className="sr-only">{t("setup.label")}</span>
                  <select
                    value={activeSetup?.id ?? ""}
                    onChange={(event) => setSetupId(event.target.value)}
                    disabled={setupsLoading || setups.length === 0}
                    className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-muted-strong outline-none focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle"
                  >
                    {setups.length === 0 ? (
                      <option value="">{t("setup.empty")}</option>
                    ) : null}
                    {setups.map((setup) => (
                      <option key={setup.id} value={setup.id}>
                        {setup.name} · {setup.widthMm} × {setup.heightMm} mm
                      </option>
                    ))}
                  </select>
                </label>
                {canWrite ? (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={openDesigner}
                      disabled={setupsLoading}
                      aria-label={
                        activeSetup
                          ? t("setup.designNamed", { name: activeSetup.name })
                          : t("setup.create")
                      }
                    >
                      <Pencil size={15} aria-hidden="true" />
                      {t("setup.design")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={openNewSetup}
                      disabled={setupsLoading}
                      aria-label={t("setup.createNew")}
                    >
                      <Copy size={15} aria-hidden="true" />
                      {t("setup.new")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            {setupError ? (
              <p role="alert" className="mt-3 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[11px] leading-5 text-danger">
                {setupError}
              </p>
            ) : activeSetup ? (
              <p className="mt-3 rounded-xl bg-surface-subtle px-3 py-2 text-[11px] leading-5 text-muted">
                {t("setup.summary", {
                  width: activeSetup.widthMm,
                  height: activeSetup.heightMm,
                  count: activeSetup.elements.filter((element) => element.visible)
                    .length,
                })}
                {activeSetup.elements.some((element) => element.type === "image" && element.visible)
                  ? t("setup.imagesEnabled")
                  : ""}
              </p>
            ) : null}
          </div>

          <div className={styles.previewViewport}>
            {setupsLoading ? (
              <div className="flex min-h-[500px] items-center justify-center">
                <Skeleton className="h-[132px] w-[234px] shadow-lg" />
              </div>
            ) : labels.length && activeSetup ? (
              <div className={`${styles.previewStack} ${styles.printSurface}`}>
                {labels.map(({ resource, copyIndex }) => (
                  <LabelRenderer
                    key={`${resource.id}-${copyIndex}`}
                    resource={resource}
                    setup={activeSetup}
                    origin={origin}
                    imageRetryToken={imageRetryToken}
                  />
                ))}
              </div>
            ) : !activeSetup ? (
              <div className="flex min-h-[500px] flex-col items-center justify-center px-6 text-center">
                <span className="grid size-14 place-items-center rounded-2xl border border-border bg-surface/80 text-muted shadow-sm">
                  <Pencil size={24} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-foreground">
                  {t("setup.emptyTitle")}
                </h3>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted">
                  {t("setup.emptyDescription")}
                </p>
                {canWrite ? (
                  <Button className="mt-4" onClick={openNewSetup}>
                    {t("setup.openDesigner")}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[500px] flex-col items-center justify-center text-center">
                <span className="grid size-14 place-items-center rounded-2xl border border-border bg-surface/80 text-muted shadow-sm">
                  <ScanQrCode size={25} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-foreground">
                  {t("preview.title")}
                </h3>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted">
                  {t("preview.description")}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-start gap-3 border-t border-border bg-surface p-4 sm:p-5">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
              <Wifi size={15} aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-xs font-semibold text-foreground">
                {t("printer.title")}
              </h3>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                {t("printer.description")}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {designerDraft ? (
        <LabelDesigner
          value={designerDraft}
          sampleResource={selectedResources[0] ?? resources[0] ?? null}
          saving={designerSaving}
          error={designerError}
          onChange={setDesignerDraft}
          onSave={saveDesigner}
          onClose={() => {
            if (!designerSaving) setDesignerDraft(null);
          }}
          onDelete={designerDraft.id ? deleteDesignerSetup : undefined}
        />
      ) : null}
    </div>
  );
}
