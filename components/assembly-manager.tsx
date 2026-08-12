"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Barcode,
  Boxes,
  CalendarDays,
  Check,
  Clock3,
  Factory,
  History,
  LoaderCircle,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type TrackingMode = "bulk" | "serialized";
type AssemblyMode = "full" | "bom" | "build";

type AvailableUnit = {
  id: string;
  code: string;
  location: string | null;
};

type BomResource = {
  id: string;
  name: string;
  quantity: number;
  trackingMode: TrackingMode;
};

type BomComponent = {
  id: string;
  resourceId: string;
  name: string;
  sku: string | null;
  quantityPerAssembly: number;
  position: number;
  note: string | null;
  availableQuantity: number;
  trackingMode: TrackingMode;
  availableUnits: AvailableUnit[];
};

type BomData = {
  resource: BomResource;
  components: BomComponent[];
  buildableQuantity: number;
};

type BuildComponent = {
  resourceId: string | null;
  name?: string;
  resourceName?: string;
  quantity?: number;
  quantityConsumed?: number;
  unitCodes?: string[];
};

type AssemblyBuild = {
  id: string;
  quantity: number;
  occurredAt: string;
  location: string | null;
  note: string | null;
  createdBy: string | null;
  components?: BuildComponent[];
  outputUnits?: Array<{ id?: string; code: string }>;
};

type BomEnvelope = BomData & {
  bom?: BomData;
  data?: BomData;
};

type BuildsEnvelope = {
  builds?: AssemblyBuild[];
  data?: { builds?: AssemblyBuild[] } | AssemblyBuild[];
};

type BuildForm = {
  quantity: string;
  occurredAt: string;
  location: string;
  note: string;
  outputUnitCodes: string;
};

const inputClass =
  "h-10 w-full rounded-xl border border-[#dfe2e7] bg-white px-3 text-sm text-[#30343a] outline-none transition placeholder:text-[#5f6672] hover:border-[#cfd3da] focus:border-[#776fff] focus:ring-3 focus:ring-[#635bff]/10 disabled:cursor-not-allowed disabled:bg-[#f5f6f8] disabled:text-[#5f6672]";
const labelClass = "block text-[11px] font-semibold text-[#555c67]";

function localDateTime(value: Date | string = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatDate(value: string, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function normalizeBom(payload: BomEnvelope): BomData {
  const source = payload.bom ?? payload.data ?? payload;
  if (!source.resource) throw new Error("The BOM response is missing its resource.");
  return {
    resource: source.resource,
    components: [...(source.components ?? [])].sort(
      (left, right) => left.position - right.position,
    ),
    buildableQuantity: Math.max(0, source.buildableQuantity ?? 0),
  };
}

function normalizeBuilds(payload: BuildsEnvelope | AssemblyBuild[]) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  return payload.builds ?? payload.data?.builds ?? [];
}

function componentSnapshot(components: BomComponent[]) {
  return JSON.stringify(
    components.map((component, position) => ({
      resourceId: component.resourceId,
      quantityPerAssembly: component.quantityPerAssembly,
      position,
      note: component.note?.trim() || null,
    })),
  );
}

function parsedCodes(value: string) {
  return value
    .split(/[\n,]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function SectionHeading({
  icon,
  title,
  description,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[#eceef1] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f0f2f4] text-[#5f6672]">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#292c31]">{title}</h2>
          <p className="mt-0.5 text-[12px] leading-5 text-[#5f6672]">{description}</p>
        </div>
      </div>
      {trailing ? <div className="shrink-0 pl-12 sm:pl-0">{trailing}</div> : null}
    </div>
  );
}

export function AssemblyManager({
  resourceId,
  mode = "full",
  onStockChanged,
}: {
  resourceId: string;
  mode?: AssemblyMode;
  onStockChanged?: () => void;
}) {
  const bomEndpoint = `/api/v1/resources/${resourceId}/bom`;
  const buildsEndpoint = `/api/v1/resources/${resourceId}/stock/builds`;
  const showBom = mode === "full" || mode === "bom";
  const showBuild = mode === "full" || mode === "build";

  const [bom, setBom] = useState<BomData | null>(null);
  const [components, setComponents] = useState<BomComponent[]>([]);
  const [builds, setBuilds] = useState<AssemblyBuild[]>([]);
  const [loadingBom, setLoadingBom] = useState(true);
  const [loadingBuilds, setLoadingBuilds] = useState(showBuild);
  const [savingBom, setSavingBom] = useState(false);
  const [postingBuild, setPostingBuild] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ClientResource[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [buildForm, setBuildForm] = useState<BuildForm>({
    quantity: "1",
    occurredAt: localDateTime(),
    location: "",
    note: "",
    outputUnitCodes: "",
  });
  const [componentUnitIds, setComponentUnitIds] = useState<
    Record<string, string[]>
  >({});
  const buildRequestRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const loadBom = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoadingBom(true);
      try {
        const payload = await fetchJson<BomEnvelope>(bomEndpoint, {
          cache: "no-store",
        });
        const normalized = normalizeBom(payload);
        setBom(normalized);
        setComponents(normalized.components);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load the bill of materials.",
        );
      } finally {
        setLoadingBom(false);
      }
    },
    [bomEndpoint],
  );

  const loadBuilds = useCallback(
    async (quiet = false) => {
      if (!showBuild) return;
      if (!quiet) setLoadingBuilds(true);
      try {
        const payload = await fetchJson<BuildsEnvelope | AssemblyBuild[]>(buildsEndpoint, {
          cache: "no-store",
        });
        setBuilds(normalizeBuilds(payload));
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load recent builds.",
        );
      } finally {
        setLoadingBuilds(false);
      }
    },
    [buildsEndpoint, showBuild],
  );

  useEffect(() => {
    void loadBom();
    void loadBuilds();
  }, [loadBom, loadBuilds]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const search = new URLSearchParams({
          q: cleanQuery,
          page: "1",
          pageSize: "8",
        });
        const payload = await fetchJson<{ resources: ClientResource[] }>(
          `/api/v1/resources?${search}`,
          { signal: controller.signal },
        );
        const selected = new Set(components.map((component) => component.resourceId));
        setSearchResults(
          payload.resources.filter(
            (resource) => resource.id !== resourceId && !selected.has(resource.id),
          ),
        );
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) {
          setSearchResults([]);
        }
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [components, query, resourceId]);

  const dirty = Boolean(
    bom && componentSnapshot(components) !== componentSnapshot(bom.components),
  );

  const draftBuildable = useMemo(() => {
    if (!components.length) return 0;
    return Math.max(
      0,
      Math.min(
        ...components.map((component) =>
          Math.floor(component.availableQuantity / Math.max(1, component.quantityPerAssembly)),
        ),
      ),
    );
  }, [components]);

  const buildQuantity = Math.max(0, Number(buildForm.quantity) || 0);
  const preview = useMemo(
    () =>
      (bom?.components ?? []).map((component) => {
        const required = component.quantityPerAssembly * buildQuantity;
        return {
          ...component,
          required,
          remaining: component.availableQuantity - required,
          shortage: required > component.availableQuantity,
        };
      }),
    [bom?.components, buildQuantity],
  );

  useEffect(() => {
    setComponentUnitIds((current) => {
      const next: Record<string, string[]> = {};
      for (const component of preview) {
        if (component.trackingMode !== "serialized") continue;
        const availableIds = new Set(component.availableUnits.map((unit) => unit.id));
        const preserved = (current[component.resourceId] ?? []).filter((id) =>
          availableIds.has(id),
        );
        const required = component.required;
        const selected = preserved.slice(0, required);
        for (const unit of component.availableUnits) {
          if (selected.length >= required) break;
          if (!selected.includes(unit.id)) selected.push(unit.id);
        }
        next[component.resourceId] = selected;
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [preview]);

  const outputCodes = parsedCodes(buildForm.outputUnitCodes);
  const serializedSelectionsValid = preview.every(
    (component) =>
      component.trackingMode !== "serialized" ||
      (componentUnitIds[component.resourceId]?.length ?? 0) === component.required,
  );
  const outputCodesValid =
    bom?.resource.trackingMode !== "serialized" ||
    outputCodes.length === 0 ||
    outputCodes.length === buildQuantity;
  const canBuild = Boolean(
    bom &&
      bom.components.length &&
      Number.isInteger(buildQuantity) &&
      buildQuantity > 0 &&
      buildQuantity <= 1_000 &&
      !dirty &&
      preview.every((component) => !component.shortage) &&
      serializedSelectionsValid &&
      outputCodesValid,
  );

  function addComponent(resource: ClientResource) {
    setComponents((current) => [
      ...current,
      {
        id: `draft-${resource.id}`,
        resourceId: resource.id,
        name: resource.name,
        sku: resource.sku,
        quantityPerAssembly: 1,
        position: current.length,
        note: null,
        availableQuantity: resource.quantity,
        trackingMode: "bulk",
        availableUnits: [],
      },
    ]);
    setQuery("");
    setSearchResults([]);
    setSearchOpen(false);
  }

  function updateComponent(
    resourceIdToUpdate: string,
    values: Partial<Pick<BomComponent, "quantityPerAssembly" | "note">>,
  ) {
    setComponents((current) =>
      current.map((component) =>
        component.resourceId === resourceIdToUpdate
          ? { ...component, ...values }
          : component,
      ),
    );
  }

  function moveComponent(index: number, direction: -1 | 1) {
    setComponents((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((component, position) => ({ ...component, position }));
    });
  }

  async function saveBom() {
    if (!bom) return;
    if (
      components.some(
        (component) =>
          !Number.isInteger(component.quantityPerAssembly) || component.quantityPerAssembly < 1,
      )
    ) {
      setError("Every component quantity must be a whole number of at least one.");
      return;
    }
    setSavingBom(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await fetchJson<BomEnvelope>(bomEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          components: components.map((component, position) => ({
            resourceId: component.resourceId,
            quantityPerAssembly: component.quantityPerAssembly,
            position,
            note: component.note?.trim() || undefined,
          })),
        }),
      });
      const normalized = normalizeBom(payload);
      setBom(normalized);
      setComponents(normalized.components);
      setNotice("Bill of materials saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the BOM.");
    } finally {
      setSavingBom(false);
    }
  }

  function toggleUnit(componentId: string, unitId: string, required: number) {
    setComponentUnitIds((current) => {
      const selected = current[componentId] ?? [];
      const nextSelected = selected.includes(unitId)
        ? selected.filter((id) => id !== unitId)
        : selected.length < required
          ? [...selected, unitId]
          : selected;
      return { ...current, [componentId]: nextSelected };
    });
  }

  async function submitBuild(event: FormEvent) {
    event.preventDefault();
    if (!bom || !canBuild) return;
    const occurredAt = toIso(buildForm.occurredAt);
    if (buildForm.occurredAt && !occurredAt) {
      setError("Choose a valid build date and time.");
      return;
    }
    if (
      !window.confirm(
        `Build ${buildQuantity} ${bom.resource.name}${buildQuantity === 1 ? "" : "s"} and consume the listed components?`,
      )
    ) {
      return;
    }

    setPostingBuild(true);
    setError(null);
    setNotice(null);
    try {
      const requestBody = {
        quantity: buildQuantity,
        occurredAt,
        location: buildForm.location.trim() || undefined,
        note: buildForm.note.trim() || undefined,
        componentUnitIds,
        outputUnitCodes:
          bom.resource.trackingMode === "serialized" && outputCodes.length
            ? outputCodes
            : undefined,
      };
      const fingerprint = JSON.stringify(requestBody);
      const request =
        buildRequestRef.current?.fingerprint === fingerprint
          ? buildRequestRef.current
          : { key: crypto.randomUUID(), fingerprint };
      buildRequestRef.current = request;
      await fetchJson(buildsEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": request.key,
        },
        body: fingerprint,
      });
      buildRequestRef.current = null;
      setBuildForm({
        quantity: "1",
        occurredAt: localDateTime(),
        location: "",
        note: "",
        outputUnitCodes: "",
      });
      await Promise.all([loadBom(true), loadBuilds(true)]);
      onStockChanged?.();
      setNotice(
        `${buildQuantity} ${bom.resource.name}${buildQuantity === 1 ? "" : "s"} built successfully.`,
      );
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Unable to build assembly.");
    } finally {
      setPostingBuild(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    await Promise.all([loadBom(true), loadBuilds(true)]);
    setRefreshing(false);
  }

  if (loadingBom) {
    return (
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
          </div>
          <Skeleton className="mt-5 h-28 w-full" />
        </Card>
      </div>
    );
  }

  if (!bom) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="size-5 text-[#c34755]" aria-hidden="true" />}
          title="Assembly data is unavailable"
          description={error ?? "The bill of materials could not be loaded."}
          action={
            <Button variant="secondary" onClick={() => void loadBom()}>
              <RefreshCw className="size-4" aria-hidden="true" /> Retry
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-[#efd6d9] bg-[#fff5f6] px-4 py-3 text-sm text-[#b83243]">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-[#ccebdd] bg-[#effaf5] px-4 py-3 text-sm text-[#11734d]">
          <span className="flex items-center gap-2">
            <Check className="size-4 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {mode === "full" ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh assembly"}
          </Button>
        </div>
      ) : null}

      {showBom ? (
        <Card className="overflow-visible">
          <SectionHeading
            icon={<Boxes className="size-4" aria-hidden="true" />}
            title="Components & bill of materials"
            description="Define the exact inventory consumed by one finished item."
            trailing={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={draftBuildable > 0 ? "success" : "warning"}>
                  {draftBuildable} buildable now
                </Badge>
                <Button
                  size="sm"
                  onClick={() => void saveBom()}
                  disabled={!dirty || savingBom}
                >
                  {savingBom ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  Save BOM
                </Button>
              </div>
            }
          />

          <div className="border-b border-[#eceef1] p-4 sm:p-5">
            <label className="relative block">
              <span className="sr-only">Search inventory components</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#5f6672]" aria-hidden="true" />
              <input
                value={query}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                placeholder="Search inventory to add a component…"
                className={`${inputClass} pl-10 pr-10`}
              />
              {searching ? (
                <LoaderCircle className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#776fff]" aria-hidden="true" />
              ) : query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSearchResults([]);
                  }}
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[#5f6672] hover:bg-[#f0f2f4]"
                  aria-label="Clear component search"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}

              {searchOpen && query.trim().length >= 2 ? (
                <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-[#dfe2e7] bg-white shadow-[var(--shadow-md)]">
                  {searching ? (
                    <div className="px-4 py-5 text-center text-[12px] text-[#5f6672]">Searching inventory…</div>
                  ) : searchResults.length ? (
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {searchResults.map((resource) => (
                        <button
                          key={resource.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => addComponent(resource)}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f5f6f8]"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eeedff] text-[#5147d9]">
                            <Package className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[#30343a]">{resource.name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[#5f6672]">
                              {resource.sku || "No SKU"} · {resource.quantity} available
                            </span>
                          </span>
                          <Plus className="size-4 shrink-0 text-[#5147d9]" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-5 text-center text-[12px] text-[#5f6672]">No unselected items found.</div>
                  )}
                </div>
              ) : null}
            </label>
          </div>

          {components.length ? (
            <div className="divide-y divide-[#eceef1]">
              {components.map((component, index) => {
                const enough = component.availableQuantity >= component.quantityPerAssembly;
                return (
                  <div key={component.resourceId} className="p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(210px,1fr)_130px_140px_auto] lg:items-start">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f0f2f4] text-[#5f6672]">
                          {component.trackingMode === "serialized" ? (
                            <Barcode className="size-[18px]" aria-hidden="true" />
                          ) : (
                            <Package className="size-[18px]" aria-hidden="true" />
                          )}
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <Link
                            href={`/inventory/${component.resourceId}`}
                            className="block truncate text-[13px] font-semibold text-[#30343a] hover:text-[#5147d9]"
                          >
                            {component.name}
                          </Link>
                          <p className="mt-1 truncate text-[10px] text-[#5f6672]">
                            {component.sku || "No SKU"} · {component.trackingMode}
                          </p>
                        </div>
                      </div>

                      <label className={labelClass}>
                        Per finished item
                        <input
                          type="number"
                          min="1"
                          max="1000000"
                          step="1"
                          value={component.quantityPerAssembly}
                          onChange={(event) =>
                            updateComponent(component.resourceId, {
                              quantityPerAssembly: Number(event.target.value),
                            })
                          }
                          className={`${inputClass} mt-1.5 tabular-nums`}
                        />
                      </label>

                      <div>
                        <p className={labelClass}>Available</p>
                        <div className="mt-1.5 flex h-10 items-center gap-2 rounded-xl border border-[#e4e7eb] bg-[#fafbfc] px-3">
                          <span className={cn("text-sm font-semibold tabular-nums", enough ? "text-[#30343a]" : "text-[#b83243]")}>{component.availableQuantity}</span>
                          <Badge tone={enough ? "success" : "danger"} className="ml-auto">
                            {enough ? "Ready" : "Short"}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 lg:pt-[22px]">
                        <button
                          type="button"
                          onClick={() => moveComponent(index, -1)}
                          disabled={index === 0}
                          className="grid size-9 place-items-center rounded-lg border border-[#dfe2e7] bg-white text-[#5f6672] hover:bg-[#f5f6f8] disabled:opacity-30"
                          aria-label={`Move ${component.name} up`}
                        >
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveComponent(index, 1)}
                          disabled={index === components.length - 1}
                          className="grid size-9 place-items-center rounded-lg border border-[#dfe2e7] bg-white text-[#5f6672] hover:bg-[#f5f6f8] disabled:opacity-30"
                          aria-label={`Move ${component.name} down`}
                        >
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setComponents((current) =>
                              current.filter((item) => item.resourceId !== component.resourceId),
                            )
                          }
                          className="grid size-9 place-items-center rounded-lg border border-[#f1c7cc] bg-white text-[#b83243] hover:bg-[#fff5f6]"
                          aria-label={`Remove ${component.name}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <label className={`${labelClass} mt-3 block lg:ml-[52px]`}>
                      Assembly note <span className="font-normal text-[#5f6672]">· optional</span>
                      <input
                        value={component.note ?? ""}
                        maxLength={1000}
                        onChange={(event) =>
                          updateComponent(component.resourceId, { note: event.target.value })
                        }
                        placeholder="Placement, revision, or preparation detail"
                        className={`${inputClass} mt-1.5`}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Boxes className="size-5" aria-hidden="true" />}
              title="No components yet"
              description="Search inventory above to define what one finished item consumes."
              className="min-h-56"
            />
          )}

          {dirty ? (
            <div className="flex flex-col gap-3 border-t border-[#eceef1] bg-[#fafbfc] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-[11px] text-[#5f6672]">Unsaved BOM changes do not affect stock or builds.</p>
              <Button size="sm" onClick={() => void saveBom()} disabled={savingBom}>
                {savingBom ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
                Save changes
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {showBuild ? (
        <Card className="overflow-hidden">
          <SectionHeading
            icon={<Factory className="size-4" aria-hidden="true" />}
            title="Build finished stock"
            description="Consume every required component and receive the finished item in one audited transaction."
            trailing={
              <Badge tone={bom.buildableQuantity > 0 ? "success" : "warning"}>
                {bom.buildableQuantity} buildable
              </Badge>
            }
          />

          {!bom.components.length ? (
            <EmptyState
              icon={<Factory className="size-5" aria-hidden="true" />}
              title="A bill of materials is required"
              description="Add and save components before finished stock can be built."
              className="min-h-56"
            />
          ) : (
            <form onSubmit={submitBuild}>
              <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className={labelClass}>
                      Build quantity
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        step="1"
                        required
                        value={buildForm.quantity}
                        onChange={(event) =>
                          setBuildForm((current) => ({ ...current, quantity: event.target.value }))
                        }
                        className={`${inputClass} mt-1.5 tabular-nums`}
                      />
                    </label>
                    <label className={labelClass}>
                      Build date
                      <input
                        type="datetime-local"
                        required
                        value={buildForm.occurredAt}
                        onChange={(event) =>
                          setBuildForm((current) => ({ ...current, occurredAt: event.target.value }))
                        }
                        className={`${inputClass} mt-1.5`}
                      />
                    </label>
                  </div>
                  <label className={labelClass}>
                    Finished-stock location <span className="font-normal text-[#5f6672]">· optional</span>
                    <input
                      value={buildForm.location}
                      maxLength={240}
                      onChange={(event) =>
                        setBuildForm((current) => ({ ...current, location: event.target.value }))
                      }
                      placeholder="Workshop · Finished goods"
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                  <label className={labelClass}>
                    Build note <span className="font-normal text-[#5f6672]">· optional</span>
                    <textarea
                      rows={3}
                      value={buildForm.note}
                      maxLength={4000}
                      onChange={(event) =>
                        setBuildForm((current) => ({ ...current, note: event.target.value }))
                      }
                      placeholder="Batch, work order, or quality note"
                      className={`${inputClass} mt-1.5 h-auto resize-y py-3 leading-5`}
                    />
                  </label>
                  {bom.resource.trackingMode === "serialized" ? (
                    <label className={labelClass}>
                      Finished unit codes
                      <textarea
                        rows={4}
                        value={buildForm.outputUnitCodes}
                        onChange={(event) =>
                          setBuildForm((current) => ({
                            ...current,
                            outputUnitCodes: event.target.value,
                          }))
                        }
                        placeholder="One code per line"
                        className={`${inputClass} mt-1.5 h-auto resize-y py-3 font-mono text-xs`}
                      />
                      <span className={cn("mt-1.5 block text-[10px]", outputCodesValid ? "text-[#5f6672]" : "text-[#b83243]")}>Optional. Leave blank to generate codes, or enter exactly {buildQuantity} unique {buildQuantity === 1 ? "code" : "codes"}.</span>
                    </label>
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="overflow-hidden rounded-xl border border-[#e4e7eb]">
                    <div className="hidden grid-cols-[minmax(180px,1fr)_90px_90px_90px] gap-3 border-b border-[#eceef1] bg-[#fafbfc] px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-[#5f6672] sm:grid">
                      <span>Component</span><span>Required</span><span>Available</span><span>After build</span>
                    </div>
                    <div className="divide-y divide-[#eceef1]">
                      {preview.map((component) => (
                        <div key={component.resourceId} className={cn("grid gap-3 px-4 py-3 sm:grid-cols-[minmax(180px,1fr)_90px_90px_90px] sm:items-center", component.shortage && "bg-[#fffafa]")}>
                          <div className="min-w-0">
                            <Link href={`/inventory/${component.resourceId}/stock`} className="block truncate text-[12px] font-semibold text-[#30343a] hover:text-[#5147d9]">{component.name}</Link>
                            <p className="mt-0.5 text-[9px] text-[#5f6672]">{component.quantityPerAssembly} per finished item</p>
                          </div>
                          <div className="flex items-center justify-between sm:block"><span className="text-[9px] uppercase text-[#5f6672] sm:hidden">Required</span><span className="text-[12px] font-semibold tabular-nums text-[#30343a]">{component.required}</span></div>
                          <div className="flex items-center justify-between sm:block"><span className="text-[9px] uppercase text-[#5f6672] sm:hidden">Available</span><span className={cn("text-[12px] font-semibold tabular-nums", component.shortage ? "text-[#b83243]" : "text-[#30343a]")}>{component.availableQuantity}</span></div>
                          <div className="flex items-center justify-between sm:block"><span className="text-[9px] uppercase text-[#5f6672] sm:hidden">After build</span><span className={cn("text-[12px] font-semibold tabular-nums", component.remaining < 0 ? "text-[#b83243]" : component.remaining === 0 ? "text-[#9b5300]" : "text-[#11734d]")}>{component.remaining}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {preview.filter((component) => component.trackingMode === "serialized").map((component) => {
                    const selected = componentUnitIds[component.resourceId] ?? [];
                    return (
                      <div key={component.resourceId} className="mt-4 rounded-xl border border-[#dedaFF] bg-[#f8f7ff] p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold text-[#343064]">Select {component.name} units</p>
                            <p className="mt-0.5 text-[10px] text-[#75709d]">{selected.length} of {component.required} selected</p>
                          </div>
                          <Badge tone={selected.length === component.required ? "success" : "warning"}>{selected.length}/{component.required}</Badge>
                        </div>
                        <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                          {component.availableUnits.map((unit) => {
                            const checked = selected.includes(unit.id);
                            return (
                              <button
                                key={unit.id}
                                type="button"
                                onClick={() => toggleUnit(component.resourceId, unit.id, component.required)}
                                className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition", checked ? "border-[#8f88ff] bg-white text-[#5147d9]" : "border-[#dfddec] bg-white/60 text-[#5f6672] hover:border-[#c5c0ff]")}
                              >
                                <span className={cn("grid size-4 shrink-0 place-items-center rounded border", checked ? "border-[#635bff] bg-[#5147d9] text-white" : "border-[#cfd3da] bg-white")}>{checked ? <Check className="size-3" aria-hidden="true" /> : null}</span>
                                <span className="min-w-0"><span className="block truncate font-mono text-[10px] font-semibold">{unit.code}</span><span className="mt-0.5 block truncate text-[9px] opacity-70">{unit.location || "No location"}</span></span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-[#eceef1] bg-[#fafbfc] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="text-[11px] text-[#5f6672]">
                  {dirty ? (
                    <span className="font-medium text-[#9b5300]">Save BOM changes before building.</span>
                  ) : preview.some((component) => component.shortage) ? (
                    <span className="font-medium text-[#b83243]">Not enough available stock for this build.</span>
                  ) : (
                    <span>{buildQuantity} finished · {preview.reduce((total, component) => total + component.required, 0)} component units consumed</span>
                  )}
                </div>
                <Button type="submit" disabled={!canBuild || postingBuild}>
                  {postingBuild ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Factory className="size-4" aria-hidden="true" />}
                  {postingBuild ? "Building…" : `Build ${buildQuantity || ""}`}
                </Button>
              </div>
            </form>
          )}
        </Card>
      ) : null}

      {showBuild ? (
        <Card className="overflow-hidden">
          <SectionHeading
            icon={<History className="size-4" aria-hidden="true" />}
            title="Recent builds"
            description="Audited assembly transactions and their consumed components."
            trailing={builds.length ? <Badge tone="neutral">{builds.length} shown</Badge> : undefined}
          />
          {loadingBuilds ? (
            <div className="space-y-3 p-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : builds.length ? (
            <div className="divide-y divide-[#eceef1]">
              {builds.slice(0, 12).map((build) => (
                <div key={build.id} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e8f7f0] text-[#138a5b]"><Factory className="size-[18px]" aria-hidden="true" /></span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[#30343a]">Built {build.quantity} {bom.resource.name}{build.quantity === 1 ? "" : "s"}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#5f6672]">
                          <span className="flex items-center gap-1"><CalendarDays className="size-3" aria-hidden="true" /> {formatDate(build.occurredAt, true)}</span>
                          {build.location ? <span className="flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" /> {build.location}</span> : null}
                          <span>{build.createdBy || "System"}</span>
                        </div>
                        {build.note ? <p className="mt-2 text-[11px] leading-5 text-[#5f6672]">{build.note}</p> : null}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] text-[#5f6672]">{build.id.slice(0, 8)}</span>
                  </div>
                  {build.components?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 pl-[52px]">
                      {build.components.map((component, index) => (
                        <span key={component.resourceId ?? `${build.id}-${index}`} className="rounded-lg bg-[#f0f2f4] px-2.5 py-1 text-[10px] text-[#5f6672]">{component.quantityConsumed ?? component.quantity ?? 0} × {component.name ?? component.resourceName ?? component.resourceId?.slice(0, 8) ?? "Deleted component"}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Clock3 className="size-5" aria-hidden="true" />}
              title="No builds recorded"
              description="Completed assembly builds will appear here with their component audit trail."
              className="min-h-52"
            />
          )}
          {builds.length > 12 ? (
            <div className="border-t border-[#eceef1] bg-[#fafbfc] px-5 py-3 text-right">
              <Link href={`/inventory/${resourceId}/stock`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#5147d9]">Open stock history <ArrowRight className="size-3" aria-hidden="true" /></Link>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
