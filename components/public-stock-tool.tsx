"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "next-i18next/client";
import {
  ArrowRight,
  Box,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Minus,
  PackageOpen,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { CodeScannerCamera } from "@/components/code-scanner-camera";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ResponsiveMediaImage } from "@/components/responsive-media-image";
import { LocalizedThemeToggle } from "@/components/theme-toggle";
import { Button, cn } from "@/components/ui";
import type { ScanCodeType } from "@/lib/scan-code-types";

type PublicMedia = {
  id: string;
  name: string;
  mimeType: string;
  kind: string;
  size: number;
  width: number | null;
  height: number | null;
  position: number;
  altText: string;
  url: string;
};

type PublicResource = {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  sku: string | null;
  quantity: number;
  location: string | null;
  tags: string[];
  categories: Array<{ name: string }>;
  customFields: Record<string, string | number | boolean | string[]>;
  media: PublicMedia[];
  cover: PublicMedia | null;
};

type CatalogResult = {
  resources: PublicResource[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  filters: { statuses: string[]; types: string[] };
};

type CatalogState = {
  q: string;
  status: string;
  type: string;
  stock: "all" | "in-stock" | "out-of-stock";
  sort: "updated" | "name" | "quantity-asc" | "quantity-desc";
};

type Workflow = {
  id: string;
  name: string;
  description: string;
  revision: number;
  resourceId: string;
  codeTypes: ScanCodeType[];
  targetSelectionMode: "all" | "radio" | "checkbox";
  operation:
    | { type: "unit" }
    | { type: "stock-adjustment"; delta: number }
    | { type: "assembly-build"; quantity: number };
};

type WorkflowTargetOption = {
  id: string;
  name: string;
  quantity: number;
  trackingMode: string;
  updatedAt: string;
};

type WorkflowTargetGroup = {
  resourceId: string;
  name: string;
  options: WorkflowTargetOption[];
};

type ExpectedWorkflowTarget = {
  resourceId: string;
  resourceUpdatedAt: string;
  unitId: string | null;
  unitUpdatedAt: string | null;
};

type WorkflowInput = {
  key: string;
  label: string;
  required: boolean;
  type: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string; color?: string }>;
};

type ScanResolution = {
  workflow: Workflow;
  resource: { id: string; name: string; quantity: number; trackingMode: string };
  identifier: string;
  operation: Workflow["operation"];
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  willCreate: boolean;
  inputFields: WorkflowInput[];
  fields?: WorkflowInput[];
  expectedResourceUpdatedAt: string;
  expectedUnitId: string | null;
  expectedUnitUpdatedAt: string | null;
  targetGroups: WorkflowTargetGroup[];
  selectedResourceIds: string[];
  expectedTargets: ExpectedWorkflowTarget[];
  resources: Array<{ id: string; name: string; quantity: number; trackingMode: string }>;
};

type Movement = {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  reason: string | null;
  note: string;
  occurredAt: string;
};

export type PublicStockSummary = {
  trackingMode: "bulk" | "serialized";
  unitName: string;
  movements: Movement[];
};

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-base text-foreground shadow-sm outline-none placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10";

function makeIdempotencyKey() {
  return crypto.randomUUID();
}

async function responseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

function titleCase(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PublicShareLogin({
  shareId,
  title,
}: {
  shareId: string;
  title: string;
}) {
  const { t } = useT("share");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(shareId)}/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, t("tool.login.error")));
      }
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t("tool.login.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <LocalizedThemeToggle />
        <LanguageSwitcher />
      </div>
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-3xl border border-border bg-surface p-6 shadow-md sm:p-8"
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">
          <LockKeyhole className="size-7" aria-hidden="true" />
        </span>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-brand">
          {t("tool.login.eyebrow")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-foreground">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {t("tool.login.description")}
        </p>
        <label className="mt-6 block text-sm font-semibold text-foreground">
          {t("tool.login.password")}
          <input
            autoFocus
            type="password"
            value={password}
            maxLength={128}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            className={`${inputClass} mt-2`}
          />
        </label>
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={!password || busy}>
          {busy ? <LoaderCircle className="size-5 animate-spin" /> : <LockKeyhole className="size-5" />}
          {t(busy ? "tool.login.submitting" : "tool.login.submit")}
        </Button>
      </form>
    </div>
  );
}

function PublicToolHeader({
  title,
  shareId,
  onScanner,
}: {
  title: string;
  shareId: string;
  onScanner: () => void;
}) {
  const { t } = useT("share");

  async function logout() {
    await fetch(`/api/public/shares/${encodeURIComponent(shareId)}/session`, {
      method: "DELETE",
    });
    window.location.reload();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex min-h-18 w-full max-w-[1240px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <Link href={`/share/${shareId}`} className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand">
            <Boxes className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">
              {t("tool.header.eyebrow")}
            </span>
            <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="lg" onClick={onScanner} className="px-3 sm:px-5">
            <ScanLine className="size-5" />
            <span className="hidden sm:inline">{t("tool.scanner.open")}</span>
          </Button>
          <span className="hidden sm:inline-flex"><LocalizedThemeToggle /></span>
          <span className="hidden md:inline-flex"><LanguageSwitcher /></span>
          <button
            type="button"
            onClick={() => void logout()}
            className="grid size-12 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:bg-surface-subtle hover:text-foreground"
            aria-label={t("tool.header.logout")}
          >
            <LogOut className="size-5" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function PublicStockCatalog({
  shareId,
  title,
  initialResult,
}: {
  shareId: string;
  title: string;
  initialResult: CatalogResult;
}) {
  const { t, i18n } = useT("share");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const storageKey = `inventory-public-stock-filters:${shareId}`;
  const [catalog, setCatalog] = useState(initialResult);
  const [state, setState] = useState<CatalogState>({
    q: "",
    status: "",
    type: "",
    stock: "all",
    sort: "updated",
  });
  const [page, setPage] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<CatalogState> | null;
      if (saved) {
        setState({
          q: typeof saved.q === "string" ? saved.q.slice(0, 240) : "",
          status: typeof saved.status === "string" ? saved.status : "",
          type: typeof saved.type === "string" ? saved.type : "",
          stock: ["all", "in-stock", "out-of-stock"].includes(saved.stock ?? "")
            ? (saved.stock as CatalogState["stock"])
            : "all",
          sort: ["updated", "name", "quantity-asc", "quantity-desc"].includes(saved.sort ?? "")
            ? (saved.sort as CatalogState["sort"])
            : "updated",
        });
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(storageKey, JSON.stringify(state));
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const parameters = new URLSearchParams({
        page: String(page),
        stock: state.stock,
        sort: state.sort,
      });
      if (state.q.trim()) parameters.set("q", state.q.trim());
      if (state.status) parameters.set("status", state.status);
      if (state.type) parameters.set("type", state.type);
      setLoading(true);
      setError(null);
      void fetch(
        `/api/public/shares/${encodeURIComponent(shareId)}/catalog?${parameters}`,
        { cache: "no-store", signal: controller.signal },
      )
        .then(async (response) => {
          if (response.status === 401) {
            window.location.reload();
            throw new Error(t("tool.catalog.sessionExpired"));
          }
          if (!response.ok) {
            throw new Error(await responseError(response, t("tool.catalog.loadError")));
          }
          return response.json() as Promise<CatalogResult>;
        })
        .then(setCatalog)
        .catch((failure: unknown) => {
          if (failure instanceof DOMException && failure.name === "AbortError") return;
          setError(failure instanceof Error ? failure.message : t("tool.catalog.loadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hydrated, page, reloadKey, shareId, state, storageKey, t]);

  function change<Key extends keyof CatalogState>(key: Key, value: CatalogState[Key]) {
    setState((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function resetFilters() {
    setState({ q: "", status: "", type: "", stock: "all", sort: "updated" });
    setPage(1);
  }

  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  return (
    <div className="min-h-dvh bg-background">
      <PublicToolHeader title={title} shareId={shareId} onScanner={() => setScannerOpen(true)} />
      <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              {t("tool.catalog.eyebrow")}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.035em] text-foreground">
              {t("tool.catalog.title")}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {t("tool.catalog.count", { count: catalog.pagination.total })}
            </p>
          </div>
          <p className="inline-flex items-center gap-2 text-xs text-muted">
            <SlidersHorizontal className="size-4" /> {t("tool.catalog.remembered")}
          </p>
        </div>

        <section className="mt-5 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.6fr)_repeat(4,minmax(130px,1fr))_auto]">
            <label className="relative block">
              <span className="sr-only">{t("tool.catalog.search")}</span>
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={state.q}
                onChange={(event) => change("q", event.target.value)}
                placeholder={t("tool.catalog.searchPlaceholder")}
                className={`${inputClass} pl-12`}
              />
            </label>
            <select value={state.status} onChange={(event) => change("status", event.target.value)} className={inputClass} aria-label={t("tool.catalog.status")}>
              <option value="">{t("tool.catalog.allStatuses")}</option>
              {catalog.filters.statuses.map((value) => <option key={value} value={value}>{t(`statuses.${value}`, { defaultValue: titleCase(value) })}</option>)}
            </select>
            <select value={state.type} onChange={(event) => change("type", event.target.value)} className={inputClass} aria-label={t("tool.catalog.type")}>
              <option value="">{t("tool.catalog.allTypes")}</option>
              {catalog.filters.types.map((value) => <option key={value} value={value}>{t(`types.${value}`, { defaultValue: titleCase(value) })}</option>)}
            </select>
            <select value={state.stock} onChange={(event) => change("stock", event.target.value as CatalogState["stock"])} className={inputClass} aria-label={t("tool.catalog.stock")}>
              <option value="all">{t("tool.catalog.allStock")}</option>
              <option value="in-stock">{t("tool.catalog.inStock")}</option>
              <option value="out-of-stock">{t("tool.catalog.outOfStock")}</option>
            </select>
            <select value={state.sort} onChange={(event) => change("sort", event.target.value as CatalogState["sort"])} className={inputClass} aria-label={t("tool.catalog.sort")}>
              <option value="updated">{t("tool.catalog.sortUpdated")}</option>
              <option value="name">{t("tool.catalog.sortName")}</option>
              <option value="quantity-desc">{t("tool.catalog.sortQuantityDesc")}</option>
              <option value="quantity-asc">{t("tool.catalog.sortQuantityAsc")}</option>
            </select>
            <Button variant="ghost" size="lg" onClick={resetFilters} aria-label={t("tool.catalog.reset")}>
              <RotateCcw className="size-5" />
            </Button>
          </div>
        </section>

        {error ? <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p> : null}
        <div className="relative mt-5 min-h-48">
          {loading ? <div className="absolute inset-x-0 top-0 z-10 h-1 overflow-hidden rounded-full bg-brand-soft"><div className="h-full w-1/2 animate-pulse rounded-full bg-brand-solid" /></div> : null}
          {catalog.resources.length ? (
            <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", loading && "opacity-60")}>
              {catalog.resources.map((resource) => (
                <Link key={resource.id} href={`/share/${shareId}/${resource.id}`} className="group min-h-48 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition active:scale-[0.99] hover:border-border-strong hover:shadow-md">
                  <div className="relative aspect-[16/10] overflow-hidden bg-surface-muted">
                    {resource.cover ? (
                      <ResponsiveMediaImage media={resource.cover} delivery="public" alt={resource.cover.altText || resource.name} widths={[384, 640, 960]} sizes="(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) 50vw, 25vw" className="size-full object-cover transition group-hover:scale-[1.02]" />
                    ) : (
                      <div className="grid size-full place-items-center text-muted"><Box className="size-12" strokeWidth={1.3} /></div>
                    )}
                    <span className={cn("absolute right-3 top-3 rounded-xl px-3 py-2 text-lg font-bold shadow-sm", resource.quantity > 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                      {number.format(resource.quantity)}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-foreground">{resource.name}</h2>
                        <p className="mt-1 truncate text-xs text-muted">{resource.sku || resource.location || t(`types.${resource.type}`, { defaultValue: titleCase(resource.type) })}</p>
                      </div>
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><ArrowRight className="size-5" /></span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-border-strong bg-surface text-center">
              <div className="px-6"><PackageOpen className="mx-auto size-12 text-muted" /><h2 className="mt-4 text-lg font-semibold">{t("tool.catalog.emptyTitle")}</h2><p className="mt-2 text-sm text-muted">{t("tool.catalog.emptyDescription")}</p></div>
            </div>
          )}
        </div>

        {catalog.pagination.pages > 1 ? (
          <nav className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5" aria-label={t("pagination.label")}>
            <Button variant="secondary" size="lg" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}><ChevronLeft className="size-5" />{t("pagination.previous")}</Button>
            <span className="text-sm text-muted">{t("pagination.position", { page: catalog.pagination.page, pages: catalog.pagination.pages })}</span>
            <Button variant="secondary" size="lg" onClick={() => setPage((current) => Math.min(catalog.pagination.pages, current + 1))} disabled={page >= catalog.pagination.pages}>{t("pagination.next")}<ChevronRight className="size-5" /></Button>
          </nav>
        ) : null}
      </main>
      <PublicStockScannerLauncher
        shareId={shareId}
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onInventoryChanged={() => setReloadKey((value) => value + 1)}
      />
    </div>
  );
}

export function PublicStockBookingPanel({
  shareId,
  resourceId,
  initialQuantity,
  summary,
  onOpenScanner,
}: {
  shareId: string;
  resourceId: string;
  initialQuantity: number;
  summary: PublicStockSummary;
  onOpenScanner?: () => void;
}) {
  const { t, i18n } = useT("share");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [balance, setBalance] = useState(initialQuantity);
  const [quantity, setQuantity] = useState(1);
  const [action, setAction] = useState<"in" | "out">("in");
  const [note, setNote] = useState("");
  const [movements, setMovements] = useState(summary.movements);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function book() {
    if (busy || summary.trackingMode === "serialized") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/public/shares/${encodeURIComponent(shareId)}/resources/${encodeURIComponent(resourceId)}/stock`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": makeIdempotencyKey(),
          },
          body: JSON.stringify({ action, quantity, note }),
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, t("tool.booking.error")));
      }
      const result = (await response.json()) as {
        resource: { quantity: number };
        movement: Movement;
      };
      setBalance(result.resource.quantity);
      setMovements((current) => [result.movement, ...current].slice(0, 8));
      setNote("");
      setNotice(t("tool.booking.success", { count: quantity }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("tool.booking.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-brand-border bg-surface shadow-sm">
      <div className="bg-brand-soft p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">{t("tool.booking.currentStock")}</p>
        <p className="mt-1 text-4xl font-bold tracking-tight text-brand-strong">{number.format(balance)}</p>
        <p className="mt-1 text-xs text-muted">{summary.unitName}</p>
      </div>
      <div className="space-y-4 p-5">
        {summary.trackingMode === "serialized" ? (
          <div className="rounded-xl border border-warning-border bg-warning-soft p-4 text-sm leading-6 text-warning">
            <p className="font-semibold">{t("tool.booking.serializedTitle")}</p>
            <p className="mt-1">{t("tool.booking.serializedDescription")}</p>
            {onOpenScanner ? <Button size="lg" className="mt-4 w-full" onClick={onOpenScanner}><ScanLine className="size-5" />{t("tool.scanner.open")}</Button> : null}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {(["in", "out"] as const).map((value) => (
                <button key={value} type="button" onClick={() => setAction(value)} className={cn("min-h-14 rounded-xl border px-4 text-base font-semibold transition", action === value ? value === "in" ? "border-success-border bg-success-soft text-success" : "border-danger-border bg-danger-soft text-danger" : "border-border bg-surface text-muted-strong")}>
                  {value === "in" ? `+ ${t("tool.booking.stockIn")}` : `− ${t("tool.booking.stockOut")}`}
                </button>
              ))}
            </div>
            <div>
              <label className="text-sm font-semibold text-foreground">{t("tool.booking.quantity")}</label>
              <div className="mt-2 grid grid-cols-[56px_1fr_56px] gap-2">
                <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} className="grid min-h-14 place-items-center rounded-xl border border-border bg-surface text-foreground"><Minus className="size-6" /></button>
                <input type="number" min={1} max={1_000_000} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(Math.min(1_000_000, Math.max(1, Number(event.target.value) || 1)))} className={`${inputClass} h-14 text-center text-xl font-bold`} />
                <button type="button" onClick={() => setQuantity((value) => Math.min(1_000_000, value + 1))} className="grid min-h-14 place-items-center rounded-xl border border-border bg-surface text-foreground"><Plus className="size-6" /></button>
              </div>
            </div>
            <label className="block text-sm font-semibold text-foreground">{t("tool.booking.note")}<textarea value={note} maxLength={2_000} rows={2} onChange={(event) => setNote(event.target.value)} placeholder={t("tool.booking.notePlaceholder")} className="mt-2 w-full resize-y rounded-xl border border-border bg-surface px-3.5 py-3 text-base text-foreground outline-none focus:border-focus" /></label>
            {error ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p> : null}
            {notice ? <p role="status" className="rounded-xl bg-success-soft px-3 py-2.5 text-sm text-success">{notice}</p> : null}
            <Button size="lg" className={cn("w-full", action === "out" && "bg-danger text-white hover:bg-danger")} onClick={() => void book()} disabled={busy}>
              {busy ? <LoaderCircle className="size-5 animate-spin" /> : action === "in" ? <Plus className="size-5" /> : <Minus className="size-5" />}
              {t(action === "in" ? "tool.booking.confirmIn" : "tool.booking.confirmOut", { count: quantity })}
            </Button>
          </>
        )}
        {movements.length ? (
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{t("tool.booking.recent")}</h3>
            <ul className="mt-2 divide-y divide-border">
              {movements.slice(0, 4).map((movement) => (
                <li key={movement.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <span className="min-w-0 truncate text-muted">{movement.note || movement.reason || titleCase(movement.type)}</span>
                  <span className={cn("shrink-0 font-bold", movement.delta > 0 ? "text-success" : "text-danger")}>{movement.delta > 0 ? "+" : ""}{number.format(movement.delta)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function PublicStockScannerLauncher({
  shareId,
  open,
  onOpenChange,
  onInventoryChanged,
}: {
  shareId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInventoryChanged?: () => void;
}) {
  const { t } = useT("share");
  const router = useRouter();
  const [mode, setMode] = useState<"product" | "workflow">("product");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ScanResolution | null>(null);
  const [rawCode, setRawCode] = useState("");
  const [rawCodeType, setRawCodeType] = useState<ScanCodeType | null>(null);
  const [inputs, setInputs] = useState<Record<string, string | number | boolean>>({});
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open || workflowsLoaded || loadingWorkflows) return;
    setLoadingWorkflows(true);
    void fetch(`/api/public/shares/${encodeURIComponent(shareId)}/workflows`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, t("tool.scanner.workflowsError")));
        return response.json() as Promise<{ workflows: Workflow[] }>;
      })
      .then((result) => {
        setWorkflows(result.workflows);
        setWorkflowId(result.workflows[0]?.id ?? "");
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t("tool.scanner.workflowsError")))
      .finally(() => {
        setLoadingWorkflows(false);
        setWorkflowsLoaded(true);
      });
  }, [loadingWorkflows, open, shareId, t, workflowsLoaded]);

  const reset = useCallback(() => {
    setResolution(null);
    setRawCode("");
    setRawCodeType(null);
    setInputs({});
    setError(null);
    setSuccess(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  async function scan(
    code: string,
    codeType: ScanCodeType | null = null,
    selectedResourceIds: string[] = [],
  ) {
    const normalized = code.trim();
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setRawCode(normalized);
    setRawCodeType(codeType);
    try {
      if (mode === "product") {
        const response = await fetch(`/api/public/shares/${encodeURIComponent(shareId)}/lookup?code=${encodeURIComponent(normalized)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response, t("tool.scanner.notFound")));
        const result = (await response.json()) as { resource: { id: string } };
        onOpenChange(false);
        router.push(`/share/${shareId}/${result.resource.id}`);
        return;
      }
      if (!workflowId) throw new Error(t("tool.scanner.chooseWorkflow"));
      const response = await fetch(`/api/public/shares/${encodeURIComponent(shareId)}/scans/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          code: normalized,
          codeType,
          selectedResourceIds,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, t("tool.scanner.resolveError")));
      const next = (await response.json()) as ScanResolution;
      next.inputFields = next.inputFields ?? next.fields ?? [];
      setResolution(next);
      setInputs(Object.fromEntries(next.inputFields.map((field) => [field.key, field.type === "checkbox" ? false : ""])));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("tool.scanner.resolveError"));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!resolution || busy) return;
    const cleaned: Record<string, string | number | boolean> = {};
    for (const field of resolution.inputFields) {
      const value = inputs[field.key];
      const empty = value === undefined || value === "";
      if ((field.type === "media" || field.type === "file") && field.required) {
        setError(t("tool.scanner.fileInputUnsupported", { field: field.label }));
        return;
      }
      if (field.required && empty) {
        setError(t("tool.scanner.required", { field: field.label }));
        return;
      }
      if (!empty && field.type !== "media" && field.type !== "file") {
        cleaned[field.key] = field.type === "number" ? Number(value) : value;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/shares/${encodeURIComponent(shareId)}/scans/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": makeIdempotencyKey() },
        body: JSON.stringify({
          workflowId: resolution.workflow.id,
          revision: resolution.workflow.revision,
          code: rawCode,
          codeType: rawCodeType,
          expectedResourceUpdatedAt: resolution.expectedResourceUpdatedAt,
          expectedUnitId: resolution.expectedUnitId,
          expectedUnitUpdatedAt: resolution.expectedUnitUpdatedAt,
          selectedResourceIds: resolution.selectedResourceIds,
          expectedTargets: resolution.expectedTargets,
          inputs: cleaned,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, t("tool.scanner.executeError")));
      setSuccess(t("tool.scanner.success", { name: resolution.workflow.name }));
      onInventoryChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("tool.scanner.executeError"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-overlay p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={t("tool.scanner.title")}>
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden bg-background shadow-2xl sm:rounded-3xl sm:border sm:border-border">
        <header className="flex min-h-18 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">{t("tool.scanner.eyebrow")}</p><h2 className="text-xl font-semibold text-foreground">{t("tool.scanner.title")}</h2></div>
          <button type="button" onClick={() => onOpenChange(false)} className="grid size-12 place-items-center rounded-xl border border-border bg-surface text-muted" aria-label={t("tool.scanner.close")}><X className="size-6" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-muted p-1.5">
            {(["product", "workflow"] as const).map((value) => (
              <button key={value} type="button" onClick={() => { setMode(value); reset(); }} className={cn("min-h-12 rounded-xl px-3 text-sm font-semibold", mode === value ? "bg-surface text-foreground shadow-sm" : "text-muted")}>
                {value === "product" ? t("tool.scanner.productMode") : t("tool.scanner.workflowMode")}
              </button>
            ))}
          </div>
          {mode === "workflow" ? (
            <label className="mt-4 block text-sm font-semibold text-foreground">{t("tool.scanner.workflow")}<select value={workflowId} disabled={loadingWorkflows || workflows.length === 0} onChange={(event) => { setWorkflowId(event.target.value); reset(); }} className={`${inputClass} mt-2`}><option value="">{t(loadingWorkflows ? "tool.scanner.loadingWorkflows" : workflowsLoaded && workflows.length === 0 ? "tool.scanner.noWorkflows" : "tool.scanner.chooseWorkflow")}</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>
          ) : null}
          <p className="mt-4 rounded-xl border border-info-border bg-info-soft px-4 py-3 text-sm leading-6 text-info">{t("tool.scanner.hardwareHint")}</p>
          {error ? <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p> : null}
          {success ? (
            <div className="mt-5 rounded-2xl border border-success-border bg-success-soft p-6 text-center text-success"><CheckCircle2 className="mx-auto size-12" /><p className="mt-3 text-lg font-semibold">{success}</p><Button size="lg" className="mt-5" onClick={reset}>{t("tool.scanner.scanAnother")}</Button></div>
          ) : resolution ? (
            <div className="mt-5 space-y-5">
              <section className="rounded-2xl border border-brand-border bg-brand-soft p-5"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand">{resolution.workflow.name}</p><h3 className="mt-1 text-xl font-semibold text-foreground">{(resolution.resources ?? [resolution.resource]).map((resource) => resource.name).join(", ")}</h3><div className="mt-4 flex items-center gap-3 text-2xl font-bold text-brand-strong"><span>{resolution.quantityBefore}</span><ArrowRight className="size-6" /><span>{resolution.quantityAfter}</span></div><p className="mt-1 font-mono text-xs text-muted">{resolution.identifier}</p></section>
              <PublicShareWorkflowTargets
                resolution={resolution}
                disabled={busy}
                onChange={(resourceIds) =>
                  void scan(rawCode, rawCodeType, resourceIds)
                }
              />
              {resolution.inputFields.length ? <section className="grid gap-4 sm:grid-cols-2">{resolution.inputFields.map((field) => <WorkflowField key={field.key} field={field} value={inputs[field.key]} onChange={(value) => setInputs((current) => ({ ...current, [field.key]: value }))} />)}</section> : null}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="secondary" size="lg" onClick={reset}>{t("tool.scanner.cancel")}</Button><Button size="lg" onClick={() => void execute()} disabled={busy}>{busy ? <LoaderCircle className="size-5 animate-spin" /> : <ScanLine className="size-5" />}{t("tool.scanner.execute")}</Button></div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-border bg-surface p-4 sm:p-5"><CodeScannerCamera allowedFormats={mode === "workflow" ? workflows.find((workflow) => workflow.id === workflowId)?.codeTypes : undefined} onDetected={(code, _source, codeType) => void scan(code, codeType)} disabled={busy || (mode === "workflow" && !workflowId)} autoFocusManual /></div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PublicStockScannerButton({ shareId }: { shareId: string }) {
  const { t } = useT("share");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="lg" onClick={() => setOpen(true)} className="px-3 sm:px-5">
        <ScanLine className="size-5" />
        <span className="hidden sm:inline">{t("tool.scanner.open")}</span>
      </Button>
      <PublicStockScannerLauncher
        shareId={shareId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function PublicShareWorkflowTargets({
  resolution,
  disabled,
  onChange,
}: {
  resolution: ScanResolution;
  disabled: boolean;
  onChange: (resourceIds: string[]) => void;
}) {
  const { t } = useT("share");
  const groups = resolution.targetGroups ?? [];
  if (
    groups.length < 2 &&
    !groups.some((group) => group.options.length > 1)
  ) {
    return null;
  }
  const selected = new Set(resolution.selectedResourceIds ?? []);
  const selectedForGroup = (group: WorkflowTargetGroup) =>
    group.options.find((option) => selected.has(option.id));
  const select = (group: WorkflowTargetGroup, resourceId?: string) => {
    const current = selectedForGroup(group);
    const remaining = resolution.selectedResourceIds.filter(
      (selectedId) =>
        !group.options.some((option) => option.id === selectedId),
    );
    if (resourceId) {
      onChange(
        resolution.workflow.targetSelectionMode === "radio"
          ? [resourceId]
          : [...remaining, resourceId],
      );
      return;
    }
    if (resolution.workflow.targetSelectionMode === "radio") {
      const next = current?.id ?? group.options[0]?.id;
      if (next) onChange([next]);
      return;
    }
    if (resolution.workflow.targetSelectionMode !== "checkbox") return;
    if (current && remaining.length === 0) return;
    onChange(
      current
        ? remaining
        : group.options[0]
          ? [...remaining, group.options[0].id]
          : remaining,
    );
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-foreground">
        {t("tool.scanner.targets")}
      </h3>
      <p className="mt-1 text-xs leading-5 text-muted">
        {t(`tool.scanner.targetModes.${resolution.workflow.targetSelectionMode}`)}
      </p>
      <div className="mt-3 space-y-3">
        {groups.map((group) => {
          const current = selectedForGroup(group);
          return (
            <div
              key={group.resourceId}
              className={cn(
                "rounded-xl border p-3.5",
                current
                  ? "border-brand-border bg-brand-soft/50"
                  : "border-border bg-surface-subtle",
              )}
            >
              <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                {resolution.workflow.targetSelectionMode === "all" ? (
                  <CheckCircle2 className="size-4 text-brand" />
                ) : (
                  <input
                    type={
                      resolution.workflow.targetSelectionMode === "radio"
                        ? "radio"
                        : "checkbox"
                    }
                    name={
                      resolution.workflow.targetSelectionMode === "radio"
                        ? "public-share-target"
                        : `public-share-target-${group.resourceId}`
                    }
                    checked={Boolean(current)}
                    disabled={disabled}
                    onChange={() => select(group)}
                    className="size-4 accent-brand-solid"
                  />
                )}
                {group.name}
              </label>
              {group.options.length > 1 && current ? (
                <div
                  role="radiogroup"
                  aria-label={t("tool.scanner.variationFor", {
                    name: group.name,
                  })}
                  className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2"
                >
                  {group.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={current.id === option.id}
                      disabled={disabled}
                      onClick={() => select(group, option.id)}
                      className={cn(
                        "min-h-10 rounded-lg border bg-surface px-3 text-left text-xs font-semibold",
                        current.id === option.id
                          ? "border-brand-border text-brand-strong"
                          : "border-border text-muted-strong",
                      )}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WorkflowField({
  field,
  value,
  onChange,
}: {
  field: WorkflowInput;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}) {
  const { t } = useT("share");
  if (field.type === "checkbox") {
    return <label className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-4 text-sm font-semibold"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="size-5" />{field.label}</label>;
  }
  if (field.type === "select" || field.type === "radio") {
    return <label className="text-sm font-semibold text-foreground">{field.label}{field.required ? " *" : ""}<select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={`${inputClass} mt-2`}><option value="">{t("tool.scanner.chooseValue")}</option>{(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
  }
  if (field.type === "media" || field.type === "file") {
    return <div className="rounded-xl border border-warning-border bg-warning-soft p-4 text-sm text-warning"><p className="font-semibold">{field.label}</p><p className="mt-1 text-xs leading-5">{t("tool.scanner.fileInputHint")}</p></div>;
  }
  return <label className="text-sm font-semibold text-foreground">{field.label}{field.required ? " *" : ""}{field.type === "textarea" ? <textarea rows={3} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} className="mt-2 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base outline-none focus:border-focus" /> : <input type={field.type === "number" ? "number" : "text"} inputMode={field.type === "number" ? "decimal" : undefined} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} className={`${inputClass} mt-2`} />}</label>;
}
