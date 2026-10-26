"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  LoaderCircle,
  PackageOpen,
  Pencil,
  Plus,
  Printer,
  ScanQrCode,
  Search,
  Usb,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "next-i18next/client";

import {
  LabelDesigner,
  type LabelSetupDraft,
} from "@/components/label-designer";
import { canEncodeQr } from "@/components/label-codes";
import { waitForLabelImageCrops } from "@/lib/label-image-crop";
import { labelUsesPlaceholder } from "@/lib/label-rich-text";
import { availableLabelSetupName, LABEL_SETUP_NAME_CONFLICT } from "@/lib/label-setup-name";
import { LabelCopyCount } from "@/components/label-copy-count";
import { repeatLabelCopies } from "@/lib/label-print-copies";
import { LabelTextFields } from "@/components/label-text-fields";
import { LabelRenderer } from "@/components/label-renderer";
import { Button, Card, Skeleton } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";
import {
  hasVisibleQrImageOverlap,
  labelSetupCreateSchema,
  type LabelElement,
  type LabelSetupDto,
} from "@/lib/label-setup-contract";
import { applyLabelTextOverride, type LabelTextOverride, labelTargetKey, labelTargetName, labelTargetUrl, type LabelResource } from "@/lib/label-target";
import { LabelStockUnitPicker } from "@/components/label-stock-unit-picker";
import { combinePtouchLabels, PTOUCH_TAPES, PTOUCH_PIXELS_PER_MM, ptouchPrintableDots, type PtouchTape } from "@/lib/ptouch-raster";

import { SharedLabelPrinter } from "@/components/shared-label-printer";
import { sendSharedLabels } from "@/lib/shared-label-print-client";
import { mediaImageVariantUrl } from "@/lib/media-image";
import { serializePreparedLabel, deserializePreparedLabel, type PreparedLabel } from "@/lib/label-workspace-client";
import type { LabelWorkspace } from "@/lib/label-workspace-contract";
import { labelNeedsProductImage } from "@/lib/label-image-source";
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
  { type: "subtitle", x: 46, y: 76, width: 51, height: 14, visible: false, fontSizeMm: 2.2, fontFamily: "sans", textOverflow: "shrink" },
  { type: "identifier", x: 46, y: 31, width: 51, height: 10, visible: true, fontSizeMm: 2.2, align: "left" },
  { type: "barcode", x: 46, y: 45, width: 51, height: 17, visible: true },
  { type: "url", x: 46, y: 66, width: 51, height: 21, visible: true, fontSizeMm: 1.55, align: "left" },
  { type: "location", x: 46, y: 90, width: 51, height: 7, visible: false, fontSizeMm: 1.55, align: "left" },
];

export function LabelPrinter({ canWrite = false, canManagePrinters = false, initialResourceId }: { canWrite?: boolean; canManagePrinters?: boolean; initialResourceId?: string }) {
  const { t } = useT("labels");
  const [origin, setOrigin] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [pagination, setPagination] = useState<Pagination>(EMPTY_PAGINATION);
  const [selected, setSelected] = useState<Map<string, LabelResource>>(
    () => new Map(),
  );
  const [textOverrides, setTextOverrides] = useState<Record<string, LabelTextOverride>>({});
  const [editingPrepared, setEditingPrepared] = useState<PreparedLabel | null>(null);
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [setups, setSetups] = useState<LabelSetupDto[]>([]);
  const [setupId, setSetupId] = useState("");
  const [setupsLoading, setSetupsLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [inversionOverride, setInversionOverride] = useState<{ key: string; inverted: boolean } | null>(null);
  const [designerDraft, setDesignerDraft] = useState<LabelSetupDraft | null>(null);
  const [designerSaving, setDesignerSaving] = useState(false);
  const designerSaveLock = useRef(false);
  const [designerError, setDesignerError] = useState<string | null>(null);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<"browser" | "ptouch" | "shared">("browser");
  const [tape, setTape] = useState<PtouchTape>(24);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [sharedPrinter, setSharedPrinter] = useState("");
  const selectedPrinter = printTarget === "shared" ? sharedPrinter : printer;
  const isRasterPrint = printTarget !== "browser";
  const [connecting, setConnecting] = useState(false);
  const [printSuccess, setPrintSuccess] = useState(false);
  const [seriesCopies, setSeriesCopies] = useState(1);
  const [preparedLabels, setPreparedLabels] = useState<PreparedLabel[]>([]);
  const maxSeriesCopies = Math.max(1, Math.floor(100 / Math.max(1, preparedLabels.length)));
  const effectiveSeriesCopies = Math.min(seriesCopies, maxSeriesCopies);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const printLock = useRef(false);
  const [imageRetryToken, setImageRetryToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [savingQueue, setSavingQueue] = useState(false);
  const queueRevision = useRef(0);
  const queueLock = useRef(false);
  const preferenceWrites = useRef(Promise.resolve());
  const preferenceKey = useRef("");
  const [preferenceRetry, setPreferenceRetry] = useState(0);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const controller = new AbortController();
    void fetchJson<LabelWorkspace>("/api/v1/label-workspace", { cache: "no-store", signal: controller.signal })
      .then(workspace => {
        if (controller.signal.aborted) return;
        queueRevision.current = workspace.revision;
        setPreparedLabels(workspace.labels.map(deserializePreparedLabel));
        const prefs = workspace.preferences;
        if (prefs.setupId !== undefined) setSetupId(prefs.setupId);
        if (prefs.printTarget) setPrintTarget(prefs.printTarget);
        else { try {
          const old = localStorage.getItem("inventory.labelPrintTarget");
          if (old === "ptouch" || old === "shared") { setPrintTarget(old); if (!prefs.setupId) setSetupId("ptouch-preset"); }
        } catch { /* Optional migration from the old browser preference. */ } }
        if (prefs.tape) setTape(prefs.tape as PtouchTape);
        if (prefs.printer) setPrinter(prefs.printer);
        if (prefs.sharedPrinter) setSharedPrinter(prefs.sharedPrinter);
        setWorkspaceReady(true);
      }).catch(error => { if (!controller.signal.aborted) setWorkspaceError(String(error)); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!workspaceReady || setupsLoading) return;
    const preferences = { setupId, printTarget, tape, printer, sharedPrinter };
    const key = JSON.stringify(preferences) + preferenceRetry;
    if (key === preferenceKey.current) return;
    preferenceKey.current = key;
    setSavingPreferences(true);
    // Preserve the order of rapid selection changes, including a slower network.
    preferenceWrites.current = preferenceWrites.current.then(async () => {
      try {
        await fetchJson("/api/v1/label-workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preferences", preferences }) });
        if (preferenceKey.current === key) setPreferenceError(null);
      } catch (error) { if (preferenceKey.current === key) setPreferenceError(String(error)); }
      finally { if (preferenceKey.current === key) setSavingPreferences(false); }
    });
  }, [workspaceReady, setupsLoading, setupId, printTarget, tape, printer, sharedPrinter, preferenceRetry]);

  const saveQueue = async (labels: PreparedLabel[]) => {
    if (!workspaceReady || queueLock.current) throw new Error(t("workspace.busy"));
    queueLock.current = true;
    setSavingQueue(true);
    setWorkspaceError(null);
    try {
      const saved = await fetchJson<LabelWorkspace>("/api/v1/label-workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue", revision: queueRevision.current, labels: labels.map(serializePreparedLabel) }) });
      queueRevision.current = saved.revision;
      setPreparedLabels(saved.labels.map(deserializePreparedLabel));
    } finally { queueLock.current = false; setSavingQueue(false); }
  };
  const removePrepared = (ids: string[]) => {
    void saveQueue(preparedLabels.filter(label => !ids.includes(label.id)))
      .then(() => setQueueNotice(null)).catch(error => setWorkspaceError(String(error)));
  };

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
          !!current
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

  useEffect(() => {
    if (!initialResourceId) return;
    const controller = new AbortController();
    void fetchJson<{ resource: ClientResource }>(
      `/api/v1/resources/${encodeURIComponent(initialResourceId)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(({ resource }) => {
        if (!controller.signal.aborted) {
          setSelected(new Map([[resource.id, resource]]));
        }
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setPrintError(loadError instanceof Error ? loadError.message : t("errors.loadItems"));
      });
    return () => controller.abort();
  }, [initialResourceId, t]);

  const selectedIds = useMemo(() => new Set(selected.keys()), [selected]);
  const ptouchSetup = useMemo<LabelSetupDto>(() => ({
    id: "ptouch-preset", name: t(tape === 24 ? "direct.photoPreset" : "direct.preset", { tape }), widthMm: tape === 24 ? 80 : 56,
    heightMm: tape === 24 ? 18 : Math.floor(ptouchPrintableDots(tape) / PTOUCH_PIXELS_PER_MM * 10) / 10,
    revision: 1, createdAt: "", updatedAt: "",
    elements: tape === 24 ? [
      { type: "qr", x: 3.125, y: 0, width: 22.5, height: 100, visible: true, quietZoneModules: 0 },
      { type: "name", x: 30, y: 100 / 90, width: 46.25, height: 530 / 9, visible: true, fontSizeMm: 5.6, minFontSizeMm: 3.5, fontFamily: "barlow-semi-condensed", lineHeight: 0.92, textOverflow: "shrink" },
      { type: "subtitle", x: 30, y: 60, width: 46.25, height: 220 / 9, visible: true, fontSizeMm: 3.3, minFontSizeMm: 1.5, fontFamily: "barlow-semi-condensed", lineHeight: 1, textOverflow: "shrink" },
      { type: "image", x: 78.75, y: 0, width: 21.25, height: 100, visible: true, fit: "contain" },
    ] : [
      { type: "qr", x: 0, y: 0, width: 29, height: 100, visible: true, quietZoneModules: 4 },
      { type: "name", x: 32, y: 8, width: 66, height: 45, visible: true, fontSizeMm: 3, minFontSizeMm: 1.8, textOverflow: "shrink" },
      { type: "subtitle", x: 32, y: 52, width: 66, height: 22, visible: true, fontSizeMm: 2.2, minFontSizeMm: 1.5, fontFamily: "sans", textOverflow: "shrink" },
      { type: "identifier", x: 32, y: 78, width: 66, height: 20, visible: true, fontSizeMm: 2.2, minFontSizeMm: 1.4, textOverflow: "shrink" },
    ],
  }), [t, tape]);
  const availableSetups = useMemo(() => isRasterPrint ? [ptouchSetup, ...setups] : setups, [isRasterPrint, ptouchSetup, setups]);
  const activeSetup = useMemo(
    () => {
      const setup = availableSetups.find((setup) => setup.id === setupId) ?? availableSetups[0] ?? null;
      return setup && inversionOverride?.key === `${setup.id}:${setup.revision}` ? { ...setup, inverted: inversionOverride.inverted } : setup;
    },
    [setupId, availableSetups, inversionOverride],
  );
  const visibleSelected =
    resources.length > 0 && resources.every((resource) => selectedIds.has(resource.id));
  const selectedResources = useMemo(() => Array.from(selected.values()), [selected]);
  const labels = useMemo(
    () =>
      selectedResources.flatMap((resource) =>
        Array.from(
          { length: copies[labelTargetKey(resource)] ?? 1 },
          (_, copyIndex) => ({ resource: applyLabelTextOverride(resource, textOverrides[labelTargetKey(resource)]), copyIndex }),
        ),
      ),
    [copies, selectedResources, textOverrides],
  );
  const setupHasQrImageOverlap = activeSetup
    ? hasVisibleQrImageOverlap(activeSetup.elements)
    : false;

  useEffect(() => {
    setPrintError(null);
    setPrintSuccess(false);
  }, [activeSetup, labels, printTarget, tape]);

  const connectPrinter = async () => {
    setConnecting(true);
    setPrintError(null);
    try {
      const { findPtouchPrinters } = await import("@/lib/qz-label-printer");
      const found = await findPtouchPrinters();
      setPrinters(found);
      setPrinter(current => found.includes(current) ? current : found.find((name) => /Inventory|RAW/i.test(name)) ?? found[0] ?? "");
      if (!found.length) setPrintError(t("direct.noPrinter"));
    } catch (error) {
      setPrintError(t("direct.connectionError", { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setConnecting(false);
    }
  };

  const toggleResource = (resource: LabelResource) => {
    const key = labelTargetKey(resource);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(key)) next.delete(key);
      else next.set(key, resource);
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
      [id]: Math.min(100, Math.max(1, Math.round(nextCount))),
    }));
  };

  const clearSelection = () => {
    setSelected(new Map());
    setCopies({});
    setTextOverrides({});
  };

  const openNewSetup = async () => {
    if (setupsLoading) return;
    setDesignerError(null);
    setSetupError(null);
    setSetupsLoading(true);
    try {
      // Another tab may have saved a copy since this page was opened.
      const { labelSetups } = await fetchJson<{ labelSetups: LabelSetupDto[] }>(
        "/api/v1/label-setups", { cache: "no-store" },
      );
      setSetups(labelSetups);
      setDesignerDraft({
        name: availableLabelSetupName(
          activeSetup ? t("setup.copyName", { name: activeSetup.name }) : t("setup.defaultName"),
          labelSetups.map((setup) => setup.name),
        ),
        widthMm: activeSetup?.widthMm ?? 62,
        heightMm: activeSetup?.heightMm ?? 35,
        elements: structuredClone(activeSetup?.elements ?? DEFAULT_ELEMENTS),
        inverted: activeSetup?.inverted ?? false,
      });
    } catch {
      setSetupError(t("errors.loadSetups"));
    } finally {
      setSetupsLoading(false);
    }
  };

  const openDesigner = () => {
    if (!activeSetup) return openNewSetup();
    if (activeSetup.id === "ptouch-preset") return openNewSetup();
    setDesignerError(null);
    setDesignerDraft(structuredClone(activeSetup));
  };

  const saveDesigner = async (asNew = false) => {
    if (!designerDraft || designerSaveLock.current) return;
    designerSaveLock.current = true;
    setDesignerSaving(true);
    setDesignerError(null);
    try {
      let name = designerDraft.name;
      if (asNew) {
        const { labelSetups } = await fetchJson<{ labelSetups: LabelSetupDto[] }>("/api/v1/label-setups", { cache: "no-store" });
        const names = labelSetups.map(setup => setup.name);
        const base = names.some(existing => existing.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
          ? t("setup.copyName", { name }) : name;
        name = availableLabelSetupName(base, names);
      }
      const payload = {
        name,
        widthMm: designerDraft.widthMm,
        heightMm: designerDraft.heightMm,
        elements: designerDraft.elements,
        inverted: designerDraft.inverted ?? false,
      };
      const result = designerDraft.id && !asNew
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
        saveError instanceof Error && saveError.message === LABEL_SETUP_NAME_CONFLICT
          ? t("errors.setupNameExists")
          : saveError instanceof Error ? saveError.message : t("errors.saveSetup"),
      );
    } finally {
      designerSaveLock.current = false;
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

  const batchError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "PTOUCH_BATCH_SIZE") return t("queue.tooLarge");
    if (message === "PTOUCH_BATCH_COUNT") return t("direct.limit");
    if (message === "PTOUCH_BATCH_MEDIA") return t("queue.sameTape");
    return message;
  };

  const printDesignerSample = async (node: HTMLElement, setup: LabelSetupDto, resource: LabelResource, copies: number) => {
    if (printLock.current) throw new Error(t("workspace.busy"));
    if (!Number.isInteger(copies) || copies < 1 || copies > 100) throw new Error(t("direct.limit"));
    if (!labelSetupCreateSchema.safeParse({ name: setup.name || "Test", widthMm: setup.widthMm, heightMm: setup.heightMm, elements: setup.elements, inverted: setup.inverted }).success)
      throw new Error(t("designer.invalidSample"));
    if (labelNeedsProductImage(setup.elements) && !resource.cover?.url)
      throw new Error(t("errors.missingImages", { count: 1, examples: resource.name }));
    const qrEnabled = setup.elements.some(element => element.type === "qr" && element.visible);
    if (qrEnabled && !canEncodeQr(labelTargetUrl(origin, resource))) throw new Error(t("errors.urlTooLong"));
    if (isRasterPrint) {
      if (!selectedPrinter) throw new Error(t(printTarget === "shared" ? "shared.choose" : "direct.connectFirst"));
      if (Math.round(setup.heightMm * PTOUCH_PIXELS_PER_MM) > ptouchPrintableDots(tape) || setup.widthMm > 996)
        throw new Error(t("direct.tooLarge", { height: (ptouchPrintableDots(tape) / PTOUCH_PIXELS_PER_MM).toFixed(1) }));
    }
    printLock.current = true;
    try {
      await waitForLabelImageCrops(node);
      await Promise.race([
        Promise.all(Array.from(node.querySelectorAll("img"), image => image.decode())),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(t("errors.imageRender"))), 8000)),
      ]);
      if (!isRasterPrint) {
        const { printBrowserLabel } = await import("@/lib/label-browser-print");
        await printBrowserLabel(node, setup.widthMm, setup.heightMm, copies);
        return;
      }
      const { renderPtouchLabel, sendPtouchLabels } = await import("@/lib/qz-label-printer");
      const rendered = await renderPtouchLabel(node, setup.widthMm, setup.heightMm, tape, qrEnabled ? labelTargetUrl(origin, resource) : undefined);
      const printData = repeatLabelCopies([rendered.data], copies);
      if (printTarget === "shared") await sendSharedLabels(sharedPrinter, tape, printData);
      else await sendPtouchLabels(printer, printData);
    } finally { printLock.current = false; }
  };

  const printPrepared = async () => {
    if (!preparedLabels.length || printLock.current || editingPrepared) return;
    if (!selectedPrinter) { setPrintError(t(printTarget === "shared" ? "shared.choose" : "direct.connectFirst")); return; }
    if (preparedLabels.some(label => label.tape !== tape)) {
      setPrintError(t("queue.loadTape", { tape: preparedLabels[0].tape }));
      return;
    }
    printLock.current = true;
    setPreparingPrint(true);
    setPrintError(null);
    setPrintSuccess(false);
    setQueueNotice(null);
    try {
      const latest = await fetchJson<LabelWorkspace>("/api/v1/label-workspace", { cache: "no-store" });
      if (latest.revision !== queueRevision.current) {
        setWorkspaceError(t("workspace.changed"));
        return;
      }
      const { sendPtouchLabels } = await import("@/lib/qz-label-printer");
      const printData = repeatLabelCopies(preparedLabels.map(label => label.data), effectiveSeriesCopies);
      if (printTarget === "shared") await sendSharedLabels(sharedPrinter, tape, printData);
      else await sendPtouchLabels(printer, printData);
      // Printing has already been acknowledged. A cleanup failure must never be presented as a failed print.
      try { await saveQueue([]); setSeriesCopies(1); }
      catch (error) {
        setWorkspaceError(t("workspace.printedCleanup", { detail: String(error) }));
        setWorkspaceReady(false);
      }
      setPrintSuccess(true);
      setQueueNotice(t(printTarget === "shared" ? "shared.sent" : "queue.sent"));
    } catch (error) {
      // Retain the list on failure; never automatically repeat a physical job.
      setPrintError(t("direct.printError", { detail: batchError(error) }));
    } finally {
      printLock.current = false;
      setPreparingPrint(false);
    }
  };

  const printLabels = async (prepare = false) => {
    if (!labels.length || !activeSetup || printLock.current) return;
    setPrintError(null);
    setPrintSuccess(false);
    if (isRasterPrint) {
      if (!prepare && !selectedPrinter) { setPrintError(t(printTarget === "shared" ? "shared.choose" : "direct.connectFirst")); return; }
      if (labels.length + (prepare ? preparedLabels.length : 0) > 100) { setPrintError(t("direct.limit")); return; }
      if (prepare && preparedLabels.some(label => label.tape !== tape)) { setPrintError(t("queue.sameTape")); return; }
      if (Math.round(activeSetup.heightMm * PTOUCH_PIXELS_PER_MM) > ptouchPrintableDots(tape) || activeSetup.widthMm > 996 || activeSetup.widthMm < 1) {
        setPrintError(t("direct.tooLarge", { height: (ptouchPrintableDots(tape) / PTOUCH_PIXELS_PER_MM).toFixed(1) }));
        return;
      }
    }
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
        !canEncodeQr(labelTargetUrl(origin, resource)),
      )
    ) {
      setPrintError(t("errors.urlTooLong"));
      return;
    }

    const imageCount = activeSetup.elements.filter(
      (element) => element.type === "image" && element.visible,
    ).length;
    const imageEnabled = imageCount > 0;
    if (labelNeedsProductImage(activeSetup.elements)) {
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

    printLock.current = true;
    setPreparingPrint(true);
    try {
      if (imageEnabled) {
        setImageRetryToken((current) => current + 1);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }
      await waitForLabelImageCrops(document.querySelector(`.${styles.printSurface}`) ?? document);
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(
          `.${styles.printSurface} .printable-label-image`,
        ),
      );
      if (images.length !== labels.length * imageCount) {
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
      if (isRasterPrint) {
        const { renderPtouchLabel, sendPtouchLabels } = await import("@/lib/qz-label-printer");
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(`.${styles.printSurface} > article`));
        if (nodes.length !== labels.length) throw new Error(t("direct.renderError"));
        const rendered: PreparedLabel[] = [];
        // Prepare every label before submitting any job, including image/QR checks.
        for (let index = 0; index < nodes.length; index += 1) {
          const result = await renderPtouchLabel(nodes[index], activeSetup.widthMm, activeSetup.heightMm, tape,
            qrEnabled ? labelTargetUrl(origin, labels[index].resource) : undefined);
          rendered.push({ ...result, id: crypto.randomUUID(), name: labelTargetName(labels[index].resource),
            template: activeSetup.name, tape, widthMm: activeSetup.widthMm,
            resource: structuredClone(labels[index].resource),
            original: structuredClone(selected.get(labelTargetKey(labels[index].resource))!),
            setup: structuredClone(activeSetup) });
        }
        if (prepare) {
          const next = [...preparedLabels, ...rendered];
          combinePtouchLabels(next.map(label => label.data));
          await saveQueue(next);
          setQueueNotice(t("queue.added", { count: rendered.length }));
          clearSelection();
        } else {
          if (printTarget === "shared") await sendSharedLabels(sharedPrinter, tape, rendered.map(label => label.data));
          else await sendPtouchLabels(printer, rendered.map(label => label.data));
          setPrintSuccess(true);
        }
      } else {
        window.print();
      }
    } catch (error) {
      setPrintError(t(prepare ? "queue.prepareError" : "direct.printError", { detail: batchError(error) }));
    } finally {
      printLock.current = false;
      setPreparingPrint(false);
    }
  };

  return (
    <div className={styles.page}>
      {workspaceError || preferenceError ? <div role="alert" className="mb-4 rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
        <p>{workspaceError || preferenceError}</p>
        <Button className="mt-2" variant="secondary" onClick={() => workspaceError ? window.location.reload() : setPreferenceRetry(n => n + 1)}>{t(workspaceError ? "workspace.reload" : "workspace.retry")}</Button>
      </div> : null}
      <div className={styles.workspaceShell} inert={!workspaceReady || savingQueue} aria-busy={!workspaceReady || savingQueue}>
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
          <p role="status" className="mt-1 text-xs text-muted">{t(!workspaceReady ? "workspace.loading" : savingQueue || savingPreferences ? "workspace.saving" : preferenceError ? "workspace.unsaved" : "workspace.saved")}</p>
        </div>
        {(isRasterPrint || preparedLabels.length > 0) ? <a href="#prepared-labels" className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-medium">{t("queue.title")} · {preparedLabels.length}</a> : null}
      </div>

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium">
            {t("direct.destination")}
            <select className="ml-3 rounded-lg border border-border bg-surface p-2" value={printTarget} disabled={preparingPrint || connecting}
              onChange={(event) => {
                const target = event.target.value as "browser" | "ptouch" | "shared";
                setPrintTarget(target);
                if (target === "browser" && setupId === "ptouch-preset") setSetupId(setups[0]?.id ?? "");
                else if (!setupId && target !== "browser") setSetupId("ptouch-preset");
              }}>
              <option value="browser">{t("direct.browser")}</option>
              <option value="shared">{t("shared.destination")}</option>
              <option value="ptouch">Brother PT-P710BT · USB / QZ Tray</option>
            </select>
          </label>
          {isRasterPrint ? <>
            <label className="text-sm font-medium">{t("direct.tape")}
              <select className="ml-3 rounded-lg border border-border bg-surface p-2" value={tape} disabled={preparingPrint || printTarget === "shared"}
                onChange={(event) => setTape(Number(event.target.value) as PtouchTape)}>
                {PTOUCH_TAPES.map((width) => <option key={width} value={width}>{width} mm</option>)}
              </select>
            </label>
            {printTarget === "ptouch" ? <><Button variant="secondary" onClick={() => void connectPrinter()} disabled={connecting || preparingPrint}>
              {connecting ? <LoaderCircle size={16} className="animate-spin" /> : <Usb size={16} />}
              {connecting ? t("direct.connecting") : t("direct.connect")}
            </Button>
            {printers.length ? <label className="text-sm"><span className="sr-only">{t("direct.printer")}</span>
              <select className="rounded-lg border border-border bg-surface p-2" value={printer} disabled={preparingPrint} onChange={(event) => setPrinter(event.target.value)}>
                {printers.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label> : null}</> : null}
          </> : null}
        </div>
        {printTarget === "ptouch" ? <details className="mt-3 text-xs leading-5 text-muted"><summary className="cursor-pointer">{t("printer.title")}</summary><p>{t("direct.help", { height: (ptouchPrintableDots(tape) / PTOUCH_PIXELS_PER_MM).toFixed(1) })} <a href="https://qz.io/download/" target="_blank" rel="noreferrer" className="underline">{t("direct.download")}</a></p></details> : null}
        {printTarget === "shared" ? <SharedLabelPrinter canManage={canManagePrinters} printerId={sharedPrinter} tape={tape} disabled={preparingPrint} onSelect={p=>{setSharedPrinter(p.id);setTape(p.tape);}} /> : null}
        {printSuccess ? <p role="status" className="mt-3 text-sm text-brand">{t(printTarget === "shared" ? "shared.sent" : "direct.sent")}</p> : null}
      </Card>


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

      {editingPrepared ? <PreparedLabelEditor label={editingPrepared} origin={origin}
        onCancel={() => setEditingPrepared(null)}
        onSave={async (updated) => {
          const next = preparedLabels.map(label => label.id === updated.id ? updated : label);
          combinePtouchLabels(next.map(label => label.data));
          await saveQueue(next);
          setEditingPrepared(null);
        }} /> : null}

      <div className={styles.workspace} inert={preparingPrint || connecting}>
        <div className="space-y-4">
          <Card className={styles.panel}>
            <div className="border-b border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("selection.title")}
                  </h2>
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
              <span className="text-[12px] text-muted">
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
                      <div key={resource.id}>
                        <button
                          type="button"
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
                          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-white">
                            {resource.cover ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={mediaImageVariantUrl(resource.cover, 96, "contain")} alt="" loading="lazy" className="size-full object-contain p-1" />
                            ) : <PackageOpen size={20} className="text-muted" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-foreground">
                              {resource.name}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-muted">
                              {resource.sku || t("selection.noSku")}
                              {resource.location ? ` · ${resource.location}` : ""}
                            </span>
                          </span>
                        </button>
                        <LabelStockUnitPicker resource={resource} selectedIds={selectedIds} onToggle={toggleResource} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {pagination.pages > 1 ? (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-[12px] text-muted">
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


        </div>

        <div className={`${styles.previewColumn} min-w-0 space-y-4`}>
        <Card className={`${styles.panel} ${styles.previewPanel}`}>
          <div className="border-b border-border p-4 sm:p-5">
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("setup.title")}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="block min-w-0 flex-1 basis-52">
                  <span className="sr-only">{t("setup.label")}</span>
                  <select
                    value={activeSetup?.id ?? ""}
                    onChange={(event) => setSetupId(event.target.value)}
                    disabled={setupsLoading || availableSetups.length === 0}
                    className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-muted-strong outline-none focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle"
                  >
                    {availableSetups.length === 0 ? (
                      <option value="">{t("setup.empty")}</option>
                    ) : null}
                    {availableSetups.map((setup) => (
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
              <p role="alert" className="mt-3 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[12px] leading-5 text-danger">
                {setupError}
              </p>
            ) : activeSetup ? (
              <p className="mt-3 rounded-xl bg-surface-subtle px-3 py-2 text-[12px] leading-5 text-muted">
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

          {activeSetup ? <div className="border-t border-border px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={activeSetup.inverted ?? false} disabled={preparingPrint || connecting} onChange={event => setInversionOverride({ key: `${activeSetup.id}:${activeSetup.revision}`, inverted: event.target.checked })} />
              {t("print.inverted")}
            </label>
            <p className="mt-1 text-xs text-muted">{t("print.invertedTemporary")}</p>
            {activeSetup.inverted ? <p className="mt-1 text-xs text-muted">{t("print.invertedHint")}</p> : null}
          </div> : null}

          <div className={styles.previewViewport}>
            {setupsLoading ? (
              <div className="flex min-h-[240px] items-center justify-center">
                <Skeleton className="h-[132px] w-[234px] shadow-lg" />
              </div>
            ) : labels.length && activeSetup ? (
              <div className={`${styles.previewStack} ${styles.printSurface}`}>
                {labels.map(({ resource, copyIndex }) => (
                  <LabelRenderer
                    key={`${labelTargetKey(resource)}-${copyIndex}`}
                    resource={resource}
                    setup={activeSetup}
                    origin={origin}
                    imageRetryToken={imageRetryToken}
                  />
                ))}
              </div>
            ) : !activeSetup ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center px-6 text-center">
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
              <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
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

          <details className="border-t border-border px-5 py-3 text-xs text-muted">
            <summary className="cursor-pointer font-medium">{t("printer.title")}</summary>
            <p className="mt-2 leading-5">{t("printer.description")}</p>
          </details>
        </Card>
          {selectedResources.length ? (
            <Card className={styles.panel}>
              <div className="border-b border-border px-4 py-3.5">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("text.heading")}
                </h2>
              </div>
              <p className="px-4 py-3 text-xs leading-5 text-muted">{t("text.hint")}</p>
              {activeSetup && !labelUsesPlaceholder(activeSetup.elements, "Subtitle") ? <p className="px-4 pb-3 text-xs text-warning">{t("text.hiddenSubtitle")}</p> : null}
              <div className="max-h-[28rem] divide-y divide-border overflow-y-auto">
                {selectedResources.map((resource) => {
                  const count = copies[labelTargetKey(resource)] ?? 1;
                  return (
                    <div key={labelTargetKey(resource)} className="px-4 py-3">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-strong">
                        {labelTargetName(resource)}
                      </span>
                      <button type="button" onClick={() => toggleResource(resource)} aria-label={t("selection.remove", { name: labelTargetName(resource) })} className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-hover">
                        <X size={13} aria-hidden="true" />
                      </button>
                      <LabelCopyCount label={t("copies.title")} value={count} onChange={next => setCopyCount(labelTargetKey(resource), next)} disabled={preparingPrint || connecting} />
                    </div>
                    <LabelTextFields resource={applyLabelTextOverride(resource, textOverrides[labelTargetKey(resource)])}
                      onChange={change => setTextOverrides(current => ({ ...current, [labelTargetKey(resource)]: { ...current[labelTargetKey(resource)], ...change } }))}
                      onReset={() => setTextOverrides(current => { const next = { ...current }; delete next[labelTargetKey(resource)]; return next; })} />
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}
        <div className="flex flex-wrap gap-2">
        {isRasterPrint ? <Button size="lg" onClick={() => void printLabels(true)}
          disabled={!labels.length || !activeSetup || preparingPrint || connecting || setupHasQrImageOverlap}>
          <Plus size={17} aria-hidden="true" /> {t("queue.prepare", { count: labels.length })}
        </Button> : null}
        <Button
          size="lg"
          variant={isRasterPrint ? "secondary" : "primary"}
          onClick={() => void printLabels()}
          disabled={
            labels.length === 0 ||
            !activeSetup ||
            preparingPrint ||
            connecting ||
            (isRasterPrint && !selectedPrinter) ||
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
        </div>
      </div>

      {(isRasterPrint || preparedLabels.length > 0) ? (
        <Card id="prepared-labels" className="mt-5 scroll-mt-4 overflow-hidden" aria-label={t("queue.title")}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 className="text-sm font-semibold">{t("queue.title")} · {preparedLabels.length}/100</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{t("queue.description")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {preparedLabels.length > 0 ? <LabelCopyCount label={t("queue.seriesCopies")} value={effectiveSeriesCopies} max={maxSeriesCopies} onChange={setSeriesCopies} disabled={preparingPrint || connecting} /> : null}
              <Button variant="secondary" disabled={!preparedLabels.length || preparingPrint || connecting}
                onClick={() => removePrepared(preparedLabels.map(label => label.id))}>{t("queue.clear")}</Button>
              <Button disabled={!isRasterPrint || !preparedLabels.length || !selectedPrinter || preparingPrint || connecting || !!editingPrepared || preparedLabels[0]?.tape !== tape}
                onClick={() => void printPrepared()}><Printer size={16} aria-hidden="true" />{t("queue.print", { count: preparedLabels.length * effectiveSeriesCopies })}</Button>
            </div>
          </div>
          {queueNotice ? <p role="status" className="px-4 pt-3 text-sm text-brand">{queueNotice}</p> : null}
          {preparedLabels.length ? <>
            <p className="px-4 pt-3 text-xs text-muted">{t("queue.summary", { tape: preparedLabels[0].tape,
              length: Math.ceil(preparedLabels.reduce((sum, label) => sum + label.widthMm + 4, 0) * effectiveSeriesCopies + 25) })}</p>
            {preparedLabels[0].tape !== tape ? <p role="alert" className="px-4 pt-2 text-sm text-warning">{t("queue.loadTape", { tape: preparedLabels[0].tape })}</p> : null}
            <ol className="max-h-96 divide-y divide-border overflow-y-auto p-4">
              {preparedLabels.map((label, index) => <li key={label.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="text-xs text-muted">{index + 1}.</span>
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-semibold">{label.name}</p>
                  <p className="text-xs text-muted">{label.template} · {label.widthMm} mm</p>
                  {/* This data URL is the frozen print raster, including the physical tape edges. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={label.preview} alt={t("queue.preview", { name: label.name })}
                    className="mt-2 h-auto max-h-24 max-w-full bg-white" />
                </div>
                <Button variant="secondary" disabled={preparingPrint || connecting}
                  onClick={() => setEditingPrepared(structuredClone(label))}>
                  <Pencil size={16} aria-hidden="true" />{t("text.edit")}
                </Button>
                <Button variant="secondary" disabled={preparingPrint || connecting}
                  aria-label={t("queue.remove", { index: index + 1, name: label.name })}
                  onClick={() => removePrepared([label.id])}>
                  <X size={16} aria-hidden="true" />
                </Button>
              </li>)}
            </ol>
          </> : <p className="p-4 text-sm text-muted">{t("queue.empty")}</p>}
          <p className="border-t border-border px-4 py-3 text-xs text-muted">{t("queue.session")}</p>
        </Card>
      ) : null}

      {designerDraft ? (
        <LabelDesigner
          value={designerDraft}
          sampleResource={selectedResources[0] ? applyLabelTextOverride(selectedResources[0], textOverrides[labelTargetKey(selectedResources[0])]) : resources[0] ?? null}
          sampleResources={selectedResources.length ? selectedResources.map(resource => applyLabelTextOverride(resource, textOverrides[labelTargetKey(resource)])) : resources}
          origin={origin || "https://inventory.example"}
          saving={designerSaving}
          error={designerError}
          onChange={setDesignerDraft}
          onSave={() => void saveDesigner()}
          onSaveAsNew={() => void saveDesigner(true)}
          onTestPrint={printDesignerSample}
          testPrintDestination={printTarget === "shared" ? t("shared.destination") : printTarget === "ptouch" ? `${printer || "QZ Tray"} · ${tape} mm` : t("direct.browser")}
          testPrintSuccess={t(printTarget === "browser" ? "designer.browserPrintOpened" : printTarget === "shared" ? "shared.sent" : "direct.sent")}
          onClose={() => {
            if (!designerSaving) setDesignerDraft(null);
          }}
          onDelete={designerDraft.id ? deleteDesignerSetup : undefined}
        />
      ) : null}
      </div>
    </div>
  );
}

function PreparedLabelEditor({ label, origin, onSave, onCancel }: {
  label: PreparedLabel;
  origin: string;
  onSave: (label: PreparedLabel) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useT("labels");
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const [resource, setResource] = useState(label.resource);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const node = preview.current?.querySelector<HTMLElement>("article");
      if (!node) throw new Error(t("direct.renderError"));
      await waitForLabelImageCrops(node);
      const images = Array.from(node.querySelectorAll<HTMLImageElement>("img"));
      await Promise.race([
        Promise.all(images.map(image => image.decode())),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error(t("errors.imageRender"))), 8000)),
      ]);
      const { renderPtouchLabel } = await import("@/lib/qz-label-printer");
      const rendered = await renderPtouchLabel(node, label.setup.widthMm, label.setup.heightMm, label.tape,
        label.setup.elements.some(element => element.type === "qr" && element.visible) ? labelTargetUrl(origin, resource) : undefined);
      await onSave({ ...label, ...rendered, resource, name: labelTargetName(resource) });
    } catch (error) {
      setError(t("text.error", { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return <dialog ref={dialog} aria-labelledby="prepared-label-title" onCancel={event => { event.preventDefault(); if (!savingRef.current) onCancel(); }}
    className="fixed inset-0 m-auto max-h-[90vh] w-[min(95vw,42rem)] overflow-auto rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/40">
    <h2 id="prepared-label-title" className="text-lg font-semibold">{t("text.edit")}</h2>
    <p className="my-3 text-xs text-muted">{t("text.hint")}</p>
    <fieldset disabled={saving}>
      <LabelTextFields resource={resource} onChange={change => setResource(current => applyLabelTextOverride(current, change))}
        onReset={() => setResource(applyLabelTextOverride(resource, { name: label.original.name, subtitle: label.original.subtitle ?? "" }))} />
    </fieldset>
    {!labelUsesPlaceholder(label.setup.elements, "Subtitle") ? <p className="mt-3 text-xs text-warning">{t("text.hiddenSubtitle")}</p> : null}
    <div ref={preview} className="my-5 overflow-auto bg-surface-subtle p-4">
      <LabelRenderer resource={resource} setup={label.setup} origin={origin} />
    </div>
    {error ? <p role="alert" className="my-3 text-sm text-danger">{error}</p> : null}
    <div className="flex justify-end gap-2">
      <Button variant="secondary" disabled={saving} onClick={onCancel}>{t("text.cancel")}</Button>
      <Button disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : null}{t("text.save")}</Button>
    </div>
  </dialog>;
}
