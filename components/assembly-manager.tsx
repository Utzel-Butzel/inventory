"use client";

import {
  OrganizationLink as Link,
  useOrganizationAllowsNegativeStock,
} from "@/components/organization-routing";
import type { TFunction } from "i18next";
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
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { ResponsiveMediaImage } from "@/components/responsive-media-image";
import { fetchJson, type ClientResource } from "@/lib/client-types";
import {
  availableBomQuantityUnits,
  bomQuantityFromDisplay,
  bomQuantityToDisplay,
  bomQuantityUnitName,
  normalizeBomQuantityUnit,
  type BomQuantityUnit,
  type BomQuantityUnitConfiguration,
} from "@/lib/bom-quantity-units";

type TrackingMode = "bulk" | "serialized";
type AssemblyMode = "full" | "bom" | "build";

type AvailableUnit = {
  id: string;
  code: string;
  location: string | null;
};

type ResourceCover = {
  id?: string;
  url: string;
  altText: string;
  width?: number | null;
  height?: number | null;
};

type BomResource = {
  id: string;
  name: string;
  quantity: number;
  trackingMode: TrackingMode;
};

type BomComponentChoice = {
  resourceId: string;
  name: string;
  sku: string | null;
  availableQuantity: number;
  trackingMode: TrackingMode;
  cover: ResourceCover | null;
  availableUnits: AvailableUnit[];
  isPrimary: boolean;
};

type BomComponent = {
  id: string;
  slotKey: string;
  resourceId: string;
  name: string;
  sku: string | null;
  quantityPerAssembly: number;
  quantityUnit: BomQuantityUnit;
  unitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
  position: number;
  note: string | null;
  availableQuantity: number;
  trackingMode: TrackingMode;
  cover: ResourceCover | null;
  availableUnits: AvailableUnit[];
  choices: BomComponentChoice[];
  origin?: "local" | "base" | "inherited" | "override" | "variant";
};

type BomInheritance = {
  primaryResourceId: string;
  primaryName: string;
  overrideCount: number;
};

type BomData = {
  resource: BomResource;
  components: BomComponent[];
  buildableQuantity: number;
  inheritance?: BomInheritance | null;
};

type BuildComponent = {
  resourceId: string | null;
  name?: string;
  resourceName?: string;
  quantity?: number;
  quantityConsumed?: number;
  unitCodes?: string[];
  costs?: Record<string, number>;
  unpricedQuantity?: number;
  costEstimated?: boolean;
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
  materialCosts?: Record<string, number>;
  unpricedComponentQuantity?: number;
  costEstimated?: boolean;
};

type BomEnvelope = BomData & {
  bom?: BomData;
  data?: BomData;
};

type BuildsEnvelope = {
  builds?: AssemblyBuild[];
  data?: { builds?: AssemblyBuild[] } | AssemblyBuild[];
};

type ComponentStockSummary = BomQuantityUnitConfiguration & {
  resourceId: string;
};

const defaultQuantityConfiguration: BomQuantityUnitConfiguration = {
  unitName: "unit",
  purchaseUnitName: null,
  purchaseUnitFactor: null,
};

type BuildForm = {
  quantity: string;
  occurredAt: string;
  location: string;
  note: string;
  outputUnitCodes: string;
};

const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const labelClass = "block text-[11px] font-semibold text-muted-strong";

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

function formatDate(value: string, includeTime = false, locale?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatMoney(cents: number, currency: string, locale?: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatCosts(costs: Record<string, number> | undefined, locale?: string) {
  const entries = Object.entries(costs ?? {});
  if (!entries.length) return "—";
  return entries
    .map(([currency, cents]) => formatMoney(cents, currency, locale))
    .join(" + ");
}

function normalizeBom(payload: BomEnvelope, t: TFunction<"assembly">): BomData {
  const source = payload.bom ?? payload.data ?? payload;
  if (!source.resource) throw new Error(t("errors.invalidBom"));
  return {
    resource: source.resource,
    components: [...(source.components ?? [])]
      .map((component) => ({
        ...component,
        slotKey: component.slotKey ?? component.id,
        unitName: component.unitName ?? "unit",
        purchaseUnitName: component.purchaseUnitName ?? null,
        purchaseUnitFactor: component.purchaseUnitFactor ?? null,
        quantityUnit: normalizeBomQuantityUnit(
          component.quantityPerAssembly,
          component.quantityUnit,
          {
            unitName: component.unitName ?? "unit",
            purchaseUnitName: component.purchaseUnitName ?? null,
            purchaseUnitFactor: component.purchaseUnitFactor ?? null,
          },
        ),
        choices: component.choices?.length
          ? component.choices
          : [
              {
                resourceId: component.resourceId,
                name: component.name,
                sku: component.sku,
                availableQuantity: component.availableQuantity,
                trackingMode: component.trackingMode,
                cover: component.cover,
                availableUnits: component.availableUnits,
                isPrimary: true,
              },
            ],
      }))
      .sort((left, right) => left.position - right.position),
    buildableQuantity: Math.max(0, source.buildableQuantity ?? 0),
    inheritance: source.inheritance ?? null,
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
      slotKey: component.slotKey,
      resourceId: component.resourceId,
      quantityPerAssembly: component.quantityPerAssembly,
      quantityUnit: component.quantityUnit,
      position,
      note: component.note?.trim() || null,
    })),
  );
}

function componentQuantityConfiguration(
  component: Pick<
    BomComponent,
    "unitName" | "purchaseUnitName" | "purchaseUnitFactor"
  >,
): BomQuantityUnitConfiguration {
  return {
    unitName: component.unitName,
    purchaseUnitName: component.purchaseUnitName,
    purchaseUnitFactor: component.purchaseUnitFactor,
  };
}

function displayedComponentQuantity(component: BomComponent) {
  return bomQuantityToDisplay(
    component.quantityPerAssembly,
    component.quantityUnit,
    componentQuantityConfiguration(component),
  );
}

function parsedCodes(value: string) {
  return value
    .split(/[\n,]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function ResourceThumbnail({
  cover,
  className,
}: {
  cover: ResourceCover | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-surface-muted text-muted",
        className,
      )}
    >
      {cover?.url && cover.url !== failedUrl ? (
        <ResponsiveMediaImage
          media={cover}
          alt=""
          widths={[96, 192]}
          sizes="36px"
          onError={() => setFailedUrl(cover.url)}
          className="size-full object-cover"
        />
      ) : (
        <Package className="size-4" aria-hidden="true" />
      )}
    </span>
  );
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
    <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">{description}</p>
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
  hideWhenEmpty = false,
}: {
  resourceId: string;
  mode?: AssemblyMode;
  onStockChanged?: () => void;
  hideWhenEmpty?: boolean;
}) {
  const allowNegativeStock = useOrganizationAllowsNegativeStock();
  const { t, i18n } = useT(["assembly", "common"]);
  const locale = i18n.resolvedLanguage ?? i18n.language;
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
  const [resettingBom, setResettingBom] = useState(false);
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
  const [componentResourceSelections, setComponentResourceSelections] =
    useState<Record<string, string>>({});
  const buildRequestRef = useRef<{ key: string; fingerprint: string } | null>(null);

  const loadBom = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoadingBom(true);
      try {
        const payload = await fetchJson<BomEnvelope>(bomEndpoint, {
          cache: "no-store",
        });
        const normalized = normalizeBom(payload, t);
        setBom(normalized);
        setComponents(normalized.components);
        setComponentResourceSelections((current) =>
          Object.fromEntries(
            normalized.components.map((component) => {
              const preserved = current[component.slotKey];
              return [
                component.slotKey,
                component.choices.some(
                  (choice) => choice.resourceId === preserved,
                )
                  ? preserved
                  : component.resourceId,
              ];
            }),
          ),
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : t("assembly:errors.loadBom"),
        );
      } finally {
        setLoadingBom(false);
      }
    },
    [bomEndpoint, t],
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
          loadError instanceof Error ? loadError.message : t("assembly:errors.loadBuilds"),
        );
      } finally {
        setLoadingBuilds(false);
      }
    },
    [buildsEndpoint, showBuild, t],
  );

  useEffect(() => {
    void loadBom();
    void loadBuilds();
  }, [loadBom, loadBuilds]);

  useEffect(() => {
    const reloadBom = () => void loadBom(true);
    window.addEventListener("resource-bom-changed", reloadBom);
    return () => window.removeEventListener("resource-bom-changed", reloadBom);
  }, [loadBom]);

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
          media: "cover",
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
          allowNegativeStock && component.trackingMode === "bulk"
            ? 1_000
            : Math.floor(
                component.availableQuantity /
                  Math.max(1, component.quantityPerAssembly),
              ),
        ),
      ),
    );
  }, [allowNegativeStock, components]);

  const buildQuantity = Math.max(0, Number(buildForm.quantity) || 0);
  const preview = useMemo(
    () =>
      (bom?.components ?? []).map((component) => {
        const selectedResourceId =
          componentResourceSelections[component.slotKey] ??
          component.resourceId;
        const selectedChoice =
          component.choices.find(
            (choice) => choice.resourceId === selectedResourceId,
          ) ?? component.choices[0]!;
        const required = component.quantityPerAssembly * buildQuantity;
        return {
          ...component,
          resourceId: selectedChoice.resourceId,
          name: selectedChoice.name,
          sku: selectedChoice.sku,
          availableQuantity: selectedChoice.availableQuantity,
          trackingMode: selectedChoice.trackingMode,
          cover: selectedChoice.cover,
          availableUnits: selectedChoice.availableUnits,
          required,
          remaining: selectedChoice.availableQuantity - required,
          shortage: required > selectedChoice.availableQuantity,
          blockingShortage:
            required > selectedChoice.availableQuantity &&
            (!allowNegativeStock || selectedChoice.trackingMode === "serialized"),
        };
      }),
    [allowNegativeStock, bom?.components, buildQuantity, componentResourceSelections],
  );
  const selectedBuildable = useMemo(
    () =>
      preview.length
        ? Math.max(
            0,
            Math.min(
              ...preview.map((component) =>
                allowNegativeStock && component.trackingMode === "bulk"
                  ? 1_000
                  : Math.floor(
                      component.availableQuantity /
                        Math.max(1, component.quantityPerAssembly),
                    ),
              ),
            ),
          )
        : 0,
    [allowNegativeStock, preview],
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
      preview.every((component) => !component.blockingShortage) &&
      serializedSelectionsValid &&
      outputCodesValid,
  );

  async function addComponent(resource: ClientResource) {
    let quantityConfiguration = defaultQuantityConfiguration;
    try {
      const response = await fetchJson<{ stock: ComponentStockSummary[] }>(
        `/api/v1/resources/stock-summaries?id=${encodeURIComponent(resource.id)}`,
        { cache: "no-store" },
      );
      quantityConfiguration = response.stock[0] ?? defaultQuantityConfiguration;
    } catch {
      // A component can still be added in its base unit without stock metadata.
    }
    const slotKey = crypto.randomUUID();
    setComponents((current) => [
      ...current,
      {
        id: `draft-${slotKey}`,
        slotKey,
        resourceId: resource.id,
        name: resource.name,
        sku: resource.sku,
        quantityPerAssembly: 1,
        quantityUnit: "base",
        ...quantityConfiguration,
        position: current.length,
        note: null,
        availableQuantity: resource.quantity,
        trackingMode: "bulk",
        cover: resource.cover
          ? {
              id: resource.cover.id,
              url: resource.cover.url,
              altText: resource.cover.altText,
              width: resource.cover.width,
              height: resource.cover.height,
            }
          : null,
        availableUnits: [],
        choices: [
          {
            resourceId: resource.id,
            name: resource.name,
            sku: resource.sku,
            availableQuantity: resource.quantity,
            trackingMode: "bulk",
            cover: resource.cover
              ? {
                  id: resource.cover.id,
                  url: resource.cover.url,
                  altText: resource.cover.altText,
                  width: resource.cover.width,
                  height: resource.cover.height,
                }
              : null,
            availableUnits: [],
            isPrimary: true,
          },
        ],
        origin: bom?.inheritance ? "variant" : "local",
      },
    ]);
    setQuery("");
    setSearchResults([]);
    setSearchOpen(false);
  }

  function updateComponent(
    slotKeyToUpdate: string,
    values: Partial<
      Pick<BomComponent, "quantityPerAssembly" | "quantityUnit" | "note">
    >,
  ) {
    setComponents((current) =>
      current.map((component) =>
        component.slotKey === slotKeyToUpdate
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
      setError(t("assembly:errors.componentQuantity"));
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
            slotKey: component.slotKey,
            resourceId: component.resourceId,
            quantityPerAssembly: component.quantityPerAssembly,
            quantityUnit: component.quantityUnit,
            position,
            note: component.note?.trim() || undefined,
          })),
        }),
      });
      const normalized = normalizeBom(payload, t);
      setBom(normalized);
      setComponents(normalized.components);
      setNotice(t("assembly:notices.bomSaved"));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t("assembly:errors.saveBom"),
      );
    } finally {
      setSavingBom(false);
    }
  }

  async function resetBomToPrimary() {
    if (!bom?.inheritance || bom.inheritance.overrideCount < 1) return;
    if (
      !window.confirm(
        t("assembly:bom.inheritance.resetConfirm", {
          name: bom.inheritance.primaryName,
        }),
      )
    ) {
      return;
    }

    setResettingBom(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await fetchJson<BomEnvelope>(bomEndpoint, {
        method: "DELETE",
      });
      const normalized = normalizeBom(payload, t);
      setBom(normalized);
      setComponents(normalized.components);
      setNotice(t("assembly:notices.bomReset"));
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : t("assembly:errors.resetBom"),
      );
    } finally {
      setResettingBom(false);
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
      setError(t("assembly:errors.invalidDate"));
      return;
    }
    if (
      !window.confirm(
        t("assembly:build.confirm", {
          count: buildQuantity,
          name: bom.resource.name,
        }),
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
        componentResourceSelections,
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
      setNotice(t("assembly:notices.built", { count: buildQuantity, name: bom.resource.name }));
    } catch (buildError) {
      setError(
        buildError instanceof Error ? buildError.message : t("assembly:errors.build"),
      );
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
          icon={<AlertTriangle className="size-5 text-danger" aria-hidden="true" />}
          title={t("assembly:unavailable.title")}
          description={error ?? t("assembly:unavailable.description")}
          action={
            <Button variant="secondary" onClick={() => void loadBom()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t("common:actions.retry")}
            </Button>
          }
        />
      </Card>
    );
  }

  if (hideWhenEmpty && !bom.components.length) {
    return null;
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={t("assembly:aria.dismissError")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          <span className="flex items-center gap-2">
            <Check className="size-4 shrink-0" aria-hidden="true" /> {notice}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t("assembly:aria.dismissMessage")}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {mode === "full" ? (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" />
            {refreshing
              ? t("assembly:actions.refreshing")
              : t("assembly:actions.refresh")}
          </Button>
        </div>
      ) : null}

      {showBom ? (
        <Card className="overflow-visible">
          <SectionHeading
            icon={<Boxes className="size-4" aria-hidden="true" />}
            title={t("assembly:bom.title")}
            description={t("assembly:bom.description")}
            trailing={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={draftBuildable > 0 ? "success" : "warning"}>
                  {t("assembly:buildableNow", { count: draftBuildable })}
                </Badge>
                <Button
                  size="sm"
                  onClick={() => void saveBom()}
                  disabled={!dirty || savingBom || resettingBom}
                >
                  {savingBom ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-3.5" aria-hidden="true" />
                  )}
                  {t("assembly:actions.saveBom")}
                </Button>
              </div>
            }
          />

          {bom.inheritance ? (
            <div className="flex flex-col gap-3 border-b border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <Link
                  href={`/inventory/${bom.inheritance.primaryResourceId}`}
                  className="text-[12px] font-semibold text-foreground hover:text-brand"
                >
                  {t("assembly:bom.inheritance.basedOn", {
                    name: bom.inheritance.primaryName,
                  })}
                </Link>
                <p className="mt-0.5 text-[11px] leading-4 text-muted">
                  {t("assembly:bom.inheritance.description")}
                </p>
              </div>
              {bom.inheritance.overrideCount > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void resetBomToPrimary()}
                  disabled={resettingBom || savingBom}
                >
                  <RotateCcw
                    className={cn("size-3.5", resettingBom && "animate-spin")}
                    aria-hidden="true"
                  />
                  {resettingBom
                    ? t("assembly:actions.resettingPrimary")
                    : t("assembly:actions.resetToPrimary")}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="border-b border-border p-4 sm:p-5">
            <label className="relative block">
              <span className="sr-only">{t("assembly:search.label")}</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                value={query}
                onFocus={() => setSearchOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                placeholder={t("assembly:search.placeholder")}
                className={`${inputClass} pl-10 pr-10`}
              />
              {searching ? (
                <LoaderCircle className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-brand" aria-hidden="true" />
              ) : query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSearchResults([]);
                  }}
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-surface-muted"
                  aria-label={t("assembly:search.clear")}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}

              {searchOpen && query.trim().length >= 2 ? (
                <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-md)]">
                  {searching ? (
                    <div className="px-4 py-5 text-center text-[12px] text-muted">
                      {t("assembly:search.searching")}
                    </div>
                  ) : searchResults.length ? (
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      {searchResults.map((resource) => (
                        <button
                          key={resource.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void addComponent(resource)}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-hover"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                            <Package className="size-4" aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-foreground">{resource.name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-muted">
                              {resource.sku || t("assembly:labels.noSku")} · {t("assembly:availableCount", { count: resource.quantity })}
                            </span>
                          </span>
                          <Plus className="size-4 shrink-0 text-brand" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-5 text-center text-[12px] text-muted">
                      {t("assembly:search.empty")}
                    </div>
                  )}
                </div>
              ) : null}
            </label>
          </div>

          {components.length ? (
            <div className="divide-y divide-border">
              {components.map((component, index) => {
                const enough = component.availableQuantity >= component.quantityPerAssembly;
                const variantOrigin =
                  bom.inheritance &&
                  (component.origin === "inherited" ||
                    component.origin === "override" ||
                    component.origin === "variant")
                    ? component.origin
                    : null;
                return (
                  <div key={component.slotKey} className="p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-[minmax(210px,1fr)_240px_140px_auto] lg:items-start">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted">
                          {component.trackingMode === "serialized" ? (
                            <Barcode className="size-[18px]" aria-hidden="true" />
                          ) : (
                            <Package className="size-[18px]" aria-hidden="true" />
                          )}
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <Link
                              href={`/inventory/${component.resourceId}`}
                              className="min-w-0 truncate text-[13px] font-semibold text-foreground hover:text-brand"
                            >
                              {component.name}
                            </Link>
                            {variantOrigin ? (
                              <Badge
                                tone={
                                  variantOrigin === "override"
                                    ? "brand"
                                    : variantOrigin === "variant"
                                      ? "warning"
                                      : "neutral"
                                }
                                className="min-h-5 shrink-0 px-2 py-0 text-[10px]"
                              >
                                {t(
                                  `assembly:bom.inheritance.origins.${variantOrigin}`,
                                )}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-[10px] text-muted">
                            {component.sku || t("assembly:labels.noSku")} · {t(`assembly:tracking.${component.trackingMode}`)}
                          </p>
                        </div>
                      </div>

                      <div>
                        <div className="grid grid-cols-[minmax(0,1fr)_108px] gap-2">
                          <label className={labelClass}>
                            {t("assembly:labels.perFinishedItem")}
                            <input
                              type="number"
                              min="1"
                              max="2000000000"
                              step="1"
                              value={displayedComponentQuantity(component)}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                                try {
                                  updateComponent(component.slotKey, {
                                    quantityPerAssembly: bomQuantityFromDisplay(
                                      value,
                                      component.quantityUnit,
                                      componentQuantityConfiguration(component),
                                    ),
                                  });
                                } catch {
                                  updateComponent(component.slotKey, {
                                    quantityPerAssembly: value,
                                  });
                                }
                              }}
                              className={`${inputClass} mt-1.5 tabular-nums`}
                            />
                          </label>
                          <label className={labelClass}>
                            {t("assembly:labels.quantityUnit")}
                            <select
                              value={component.quantityUnit}
                              onChange={(event) => {
                                const nextUnit = event.target.value as BomQuantityUnit;
                                const configuration =
                                  componentQuantityConfiguration(component);
                                const nextQuantity =
                                  nextUnit === "purchase" &&
                                  normalizeBomQuantityUnit(
                                    component.quantityPerAssembly,
                                    nextUnit,
                                    configuration,
                                  ) !== "purchase"
                                    ? bomQuantityFromDisplay(
                                        1,
                                        nextUnit,
                                        configuration,
                                      )
                                    : component.quantityPerAssembly;
                                updateComponent(component.slotKey, {
                                  quantityPerAssembly: nextQuantity,
                                  quantityUnit: nextUnit,
                                });
                              }}
                              className={`${inputClass} mt-1.5`}
                            >
                              {availableBomQuantityUnits(
                                componentQuantityConfiguration(component),
                              ).map((unit) => (
                                <option key={unit} value={unit}>
                                  {bomQuantityUnitName(
                                    unit,
                                    componentQuantityConfiguration(component),
                                  )}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {component.purchaseUnitName &&
                        component.purchaseUnitFactor ? (
                          <p className="mt-1 text-[9px] leading-4 text-muted">
                            {t("assembly:purchaseUnitConversion", {
                              purchaseUnit: component.purchaseUnitName,
                              count: component.purchaseUnitFactor,
                              baseUnit: component.unitName,
                            })}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <p className={labelClass}>{t("assembly:labels.available")}</p>
                        <div className="mt-1.5 flex h-10 items-center gap-2 rounded-xl border border-border bg-surface-subtle px-3">
                          <span className={cn("text-sm font-semibold tabular-nums", enough ? "text-foreground" : "text-danger")}>
                            {component.availableQuantity} {component.unitName}
                          </span>
                          <Badge tone={enough ? "success" : "danger"} className="ml-auto">
                            {enough
                              ? t("assembly:labels.ready")
                              : t("assembly:labels.short")}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 lg:pt-[22px]">
                        <button
                          type="button"
                          onClick={() => moveComponent(index, -1)}
                          disabled={index === 0}
                          className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-hover disabled:opacity-30"
                          aria-label={t("assembly:aria.moveUp", { name: component.name })}
                        >
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveComponent(index, 1)}
                          disabled={index === components.length - 1}
                          className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-hover disabled:opacity-30"
                          aria-label={t("assembly:aria.moveDown", { name: component.name })}
                        >
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setComponents((current) =>
                              current.filter((item) => item.slotKey !== component.slotKey),
                            )
                          }
                          className="grid size-9 place-items-center rounded-lg border border-danger-border bg-surface text-danger hover:bg-danger-soft"
                          aria-label={t("assembly:aria.remove", { name: component.name })}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    <label className={`${labelClass} mt-3 block lg:ml-[52px]`}>
                      {t("assembly:labels.assemblyNote")} {" "}
                      <span className="font-normal text-muted">
                        · {t("assembly:labels.optional")}
                      </span>
                      <input
                        value={component.note ?? ""}
                        maxLength={1000}
                        onChange={(event) =>
                          updateComponent(component.slotKey, { note: event.target.value })
                        }
                        placeholder={t("assembly:placeholders.assemblyNote")}
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
              title={t("assembly:bom.emptyTitle")}
              description={t("assembly:bom.emptyDescription")}
              className="min-h-56"
            />
          )}

          {dirty ? (
            <div className="flex flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-[11px] text-muted">
                {t("assembly:bom.unsavedDescription")}
              </p>
              <Button
                size="sm"
                onClick={() => void saveBom()}
                disabled={savingBom || resettingBom}
              >
                {savingBom ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
                {t("assembly:actions.saveChanges")}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {showBuild ? (
        <Card className="overflow-hidden">
          <SectionHeading
            icon={<Factory className="size-4" aria-hidden="true" />}
            title={t("assembly:build.title")}
            description={t("assembly:build.description")}
            trailing={
              <Badge tone={selectedBuildable > 0 ? "success" : "warning"}>
                {t("assembly:buildable", { count: selectedBuildable })}
              </Badge>
            }
          />

          {!bom.components.length ? (
            <EmptyState
              icon={<Factory className="size-5" aria-hidden="true" />}
              title={t("assembly:build.missingBomTitle")}
              description={t("assembly:build.missingBomDescription")}
              className="min-h-56"
            />
          ) : (
            <form onSubmit={submitBuild}>
              <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className={labelClass}>
                      {t("assembly:labels.buildQuantity")}
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
                      {t("assembly:labels.buildDate")}
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
                    {t("assembly:labels.finishedLocation")} {" "}
                    <span className="font-normal text-muted">
                      · {t("assembly:labels.optional")}
                    </span>
                    <input
                      value={buildForm.location}
                      maxLength={240}
                      onChange={(event) =>
                        setBuildForm((current) => ({ ...current, location: event.target.value }))
                      }
                      placeholder={t("assembly:placeholders.location")}
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                  <label className={labelClass}>
                    {t("assembly:labels.buildNote")} {" "}
                    <span className="font-normal text-muted">
                      · {t("assembly:labels.optional")}
                    </span>
                    <textarea
                      rows={3}
                      value={buildForm.note}
                      maxLength={4000}
                      onChange={(event) =>
                        setBuildForm((current) => ({ ...current, note: event.target.value }))
                      }
                      placeholder={t("assembly:placeholders.buildNote")}
                      className={`${inputClass} mt-1.5 h-auto resize-y py-3 leading-5`}
                    />
                  </label>
                  {bom.resource.trackingMode === "serialized" ? (
                    <label className={labelClass}>
                      {t("assembly:labels.finishedCodes")}
                      <textarea
                        rows={4}
                        value={buildForm.outputUnitCodes}
                        onChange={(event) =>
                          setBuildForm((current) => ({
                            ...current,
                            outputUnitCodes: event.target.value,
                          }))
                        }
                        placeholder={t("assembly:placeholders.codes")}
                        className={`${inputClass} mt-1.5 h-auto resize-y py-3 font-mono text-xs`}
                      />
                      <span className={cn("mt-1.5 block text-[10px]", outputCodesValid ? "text-muted" : "text-danger")}>
                        {t("assembly:build.codeHint", { count: buildQuantity })}
                      </span>
                    </label>
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="overflow-hidden rounded-xl border border-border">
                    <div className="hidden grid-cols-[minmax(180px,1fr)_90px_90px_90px] gap-3 border-b border-border bg-surface-subtle px-4 py-2.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-muted sm:grid">
                      <span>{t("assembly:labels.component")}</span>
                      <span>{t("assembly:labels.required")}</span>
                      <span>{t("assembly:labels.available")}</span>
                      <span>{t("assembly:labels.afterBuild")}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {preview.map((component) => (
                        <div key={component.slotKey} className={cn("grid gap-3 px-4 py-3 sm:grid-cols-[minmax(180px,1fr)_90px_90px_90px] sm:items-center", component.blockingShortage && "bg-danger-soft")}>
                          <div className="min-w-0">
                            {component.choices.length > 1 ? (
                              <label className="mb-2 block text-[9px] font-semibold uppercase tracking-[0.08em] text-muted">
                                {t("assembly:labels.componentConfiguration")}
                                <span className="relative mt-1.5 block">
                                  <ResourceThumbnail
                                    cover={component.cover}
                                    className="pointer-events-none absolute left-1.5 top-1/2 z-10 size-7 -translate-y-1/2 rounded-md"
                                  />
                                  <select
                                    value={component.resourceId}
                                    onChange={(event) => {
                                      setComponentResourceSelections((current) => ({
                                        ...current,
                                        [component.slotKey]: event.target.value,
                                      }));
                                      setComponentUnitIds({});
                                      buildRequestRef.current = null;
                                    }}
                                    className={`${inputClass} pl-11 normal-case tracking-normal`}
                                  >
                                    {component.choices.map((choice) => (
                                      <option
                                        key={choice.resourceId}
                                        value={choice.resourceId}
                                      >
                                        {choice.name}
                                        {choice.isPrimary
                                          ? ` ${t("assembly:build.primaryConfiguration")}`
                                          : ""}
                                        {` · ${t("assembly:availableCount", {
                                          count: choice.availableQuantity,
                                        })}`}
                                      </option>
                                    ))}
                                  </select>
                                </span>
                              </label>
                            ) : (
                              <div className="flex min-w-0 items-center gap-3">
                                <ResourceThumbnail
                                  cover={component.cover}
                                />
                                <div className="min-w-0">
                                  <Link href={`/inventory/${component.resourceId}/stock`} className="block truncate text-[12px] font-semibold text-foreground hover:text-brand">{component.name}</Link>
                                  <p className="mt-0.5 text-[9px] text-muted">
                                    {t("assembly:perFinishedQuantity", {
                                      count: displayedComponentQuantity(component),
                                      unit: bomQuantityUnitName(
                                        component.quantityUnit,
                                        componentQuantityConfiguration(component),
                                      ),
                                    })}
                                  </p>
                                </div>
                              </div>
                            )}
                            {component.choices.length > 1 ? (
                              <>
                                <Link href={`/inventory/${component.resourceId}/stock`} className="block truncate text-[12px] font-semibold text-foreground hover:text-brand">{component.name}</Link>
                                <p className="mt-0.5 text-[9px] text-muted">
                                  {t("assembly:perFinishedQuantity", {
                                    count: displayedComponentQuantity(component),
                                    unit: bomQuantityUnitName(
                                      component.quantityUnit,
                                      componentQuantityConfiguration(component),
                                    ),
                                  })}
                                </p>
                              </>
                            ) : null}
                          </div>
                          <div className="flex items-center justify-between sm:block"><span className="text-[9px] uppercase text-muted sm:hidden">{t("assembly:labels.required")}</span><span className="text-[12px] font-semibold tabular-nums text-foreground">{component.required}</span></div>
                          <div className="flex items-center justify-between sm:block"><span className="text-[9px] uppercase text-muted sm:hidden">{t("assembly:labels.available")}</span><span className={cn("text-[12px] font-semibold tabular-nums", component.shortage ? "text-danger" : "text-foreground")}>{component.availableQuantity}</span></div>
                          <div className="flex items-center justify-between sm:block"><span className="text-[9px] uppercase text-muted sm:hidden">{t("assembly:labels.afterBuild")}</span><span className={cn("text-[12px] font-semibold tabular-nums", component.remaining < 0 ? "text-danger" : component.remaining === 0 ? "text-warning" : "text-success")}>{component.remaining}</span></div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {preview.filter((component) => component.trackingMode === "serialized").map((component) => {
                    const selected = componentUnitIds[component.resourceId] ?? [];
                    return (
                      <div key={component.resourceId} className="mt-4 rounded-xl border border-brand-border bg-brand-soft p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold text-brand-strong">
                              {t("assembly:build.selectUnits", { name: component.name })}
                            </p>
                            <p className="mt-0.5 text-[10px] text-brand">
                              {t("assembly:build.selectedCount", {
                                selected: selected.length,
                                required: component.required,
                              })}
                            </p>
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
                                className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition", checked ? "border-brand bg-surface text-brand" : "border-brand-border bg-surface/60 text-muted hover:border-brand-border")}
                              >
                                <span className={cn("grid size-4 shrink-0 place-items-center rounded border", checked ? "border-focus bg-brand-solid text-on-brand" : "border-border-strong bg-surface")}>{checked ? <Check className="size-3" aria-hidden="true" /> : null}</span>
                                <span className="min-w-0"><span className="block truncate font-mono text-[10px] font-semibold">{unit.code}</span><span className="mt-0.5 block truncate text-[9px] opacity-70">{unit.location || t("assembly:labels.noLocation")}</span></span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-border bg-surface-subtle px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="text-[11px] text-muted">
                  {dirty ? (
                    <span className="font-medium text-warning">
                      {t("assembly:build.saveFirst")}
                    </span>
                  ) : preview.some((component) => component.blockingShortage) ? (
                    <span className="font-medium text-danger">
                      {t("assembly:build.insufficientStock")}
                    </span>
                  ) : (
                    <span>
                      {t("assembly:build.summary", {
                        count: buildQuantity,
                        components: preview.reduce(
                          (total, component) => total + component.required,
                          0,
                        ),
                      })}
                    </span>
                  )}
                </div>
                <Button type="submit" disabled={!canBuild || postingBuild}>
                  {postingBuild ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Factory className="size-4" aria-hidden="true" />}
                  {postingBuild
                    ? t("assembly:actions.building")
                    : t("assembly:actions.build", {
                        count: buildQuantity || "",
                      })}
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
            title={t("assembly:history.title")}
            description={t("assembly:history.description")}
            trailing={
              builds.length ? (
                <Badge tone="neutral">
                  {t("assembly:history.shown", { count: builds.length })}
                </Badge>
              ) : undefined
            }
          />
          {loadingBuilds ? (
            <div className="space-y-3 p-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : builds.length ? (
            <div className="divide-y divide-border">
              {builds.slice(0, 12).map((build) => (
                <div key={build.id} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success"><Factory className="size-[18px]" aria-hidden="true" /></span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-foreground">
                          {t("assembly:history.built", {
                            count: build.quantity,
                            name: bom.resource.name,
                          })}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
                          <span className="flex items-center gap-1"><CalendarDays className="size-3" aria-hidden="true" /> {formatDate(build.occurredAt, true, locale)}</span>
                          {build.location ? <span className="flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" /> {build.location}</span> : null}
                          <span>{build.createdBy || t("assembly:labels.system")}</span>
                        </div>
                        {build.note ? <p className="mt-2 text-[11px] leading-5 text-muted">{build.note}</p> : null}
                        <p className="mt-2 text-[11px] font-semibold text-brand">
                          {t("assembly:history.materialCost")}: {" "}
                          {formatCosts(build.materialCosts, locale)}
                          {build.costEstimated
                            ? ` · ${t("assembly:history.estimated")}`
                            : ""}
                        </p>
                        {(build.unpricedComponentQuantity ?? 0) > 0 ? (
                          <p className="mt-1 text-[10px] font-medium text-warning">
                            {t("assembly:history.unpricedComponents", {
                              count: build.unpricedComponentQuantity,
                            })}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[9px] text-muted">{build.id.slice(0, 8)}</span>
                  </div>
                  {build.components?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 pl-[52px]">
                      {build.components.map((component, index) => (
                        <span key={component.resourceId ?? `${build.id}-${index}`} className="rounded-lg bg-surface-muted px-2.5 py-1 text-[10px] text-muted">{component.quantityConsumed ?? component.quantity ?? 0} × {component.name ?? component.resourceName ?? component.resourceId?.slice(0, 8) ?? t("assembly:labels.deletedComponent")} · {formatCosts(component.costs, locale)}{component.costEstimated ? ` (${t("assembly:history.estimated")})` : ""}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Clock3 className="size-5" aria-hidden="true" />}
              title={t("assembly:history.emptyTitle")}
              description={t("assembly:history.emptyDescription")}
              className="min-h-52"
            />
          )}
          {builds.length > 12 ? (
            <div className="border-t border-border bg-surface-subtle px-5 py-3 text-right">
              <Link href={`/inventory/${resourceId}/stock`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand">
                {t("assembly:history.openStock")}
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
