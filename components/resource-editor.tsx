"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  FileText,
  ImageIcon,
  LoaderCircle,
  MapPin,
  Package,
  Paperclip,
  RefreshCcw,
  Save,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  Warehouse,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useT } from "next-i18next/client";

import { defaultCoverPrompt } from "@/lib/ai-prompts";
import { fetchJson, type ClientResource } from "@/lib/client-types";
import { prepareUpload, readImageGps } from "@/lib/client-media";
import { AssemblyManager } from "@/components/assembly-manager";
import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { ResourceTranslations } from "@/components/resource-translations";
import {
  ImageModelSelector,
  useImageModelPreference,
} from "@/components/image-model-selector";
import {
  isCustomFieldDefinitionApplicable,
  type CustomFieldDefinition,
  type CustomFieldValues,
} from "@/lib/custom-field-contract";

type FormState = {
  name: string;
  description: string;
  type: string;
  status: string;
  sku: string;
  quantity: string;
  location: string;
  serialNumber: string;
  value: string;
  currency: string;
  priority: string;
  tags: string;
  categories: string;
  gpsLatitude: string;
  gpsLongitude: string;
  gpsAltitude: string;
  notes: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  type: "object",
  status: "available",
  sku: "",
  quantity: "1",
  location: "",
  serialNumber: "",
  value: "",
  currency: "EUR",
  priority: "3",
  tags: "",
  categories: "",
  gpsLatitude: "",
  gpsLongitude: "",
  gpsAltitude: "",
  notes: "",
};

const fallbackTypes = [
  "tool",
  "object",
  "furniture",
  "vehicle",
  "place",
  "clothing",
  "person",
  "project",
  "other",
];

type InventoryTypeOption = {
  key: string;
  label: string;
  archivedAt: string | null;
};

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-success focus:ring-4 focus:ring-success-border disabled:bg-surface-subtle disabled:text-muted";
const labelClass = "block text-xs font-semibold text-muted-strong";

const toForm = (resource: ClientResource): FormState => ({
  name: resource.name,
  description: resource.description,
  type: resource.type,
  status: resource.status,
  sku: resource.sku ?? "",
  quantity: String(resource.quantity),
  location: resource.location ?? "",
  serialNumber: resource.serialNumber ?? "",
  value:
    resource.valueCents === null ? "" : (resource.valueCents / 100).toFixed(2),
  currency: resource.currency,
  priority: String(resource.priority),
  tags: resource.tags.join(", "),
  categories: resource.categories.map((category) => category.name).join(", "),
  gpsLatitude: resource.gpsLatitude === null ? "" : String(resource.gpsLatitude),
  gpsLongitude: resource.gpsLongitude === null ? "" : String(resource.gpsLongitude),
  gpsAltitude: resource.gpsAltitude === null ? "" : String(resource.gpsAltitude),
  notes: resource.notes,
});

const mediaIcon = (kind: string) => {
  if (kind === "image") return ImageIcon;
  if (kind === "document") return FileText;
  return Paperclip;
};

const customFieldDefinitionsFromResponse = (payload: unknown) => {
  if (Array.isArray(payload)) return payload as CustomFieldDefinition[];
  if (!payload || typeof payload !== "object") return [];
  const candidate = (payload as { definitions?: unknown }).definitions;
  return Array.isArray(candidate) ? (candidate as CustomFieldDefinition[]) : [];
};

export function ResourceEditor({
  resourceId,
  canDelete = false,
  canUseAi = false,
  canManageSpatial = false,
}: {
  resourceId?: string;
  canDelete?: boolean;
  canUseAi?: boolean;
  canManageSpatial?: boolean;
}) {
  const router = useRouter();
  const { t, i18n } = useT("resource");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const isNew = !resourceId;
  const imageModelPreference = useImageModelPreference();
  const [resource, setResource] = useState<ClientResource | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [inventoryTypes, setInventoryTypes] = useState<InventoryTypeOption[]>(
    () => fallbackTypes.map((key) => ({
      key,
      label: key[0]!.toUpperCase() + key.slice(1),
      archivedAt: null,
    })),
  );
  const [customFields, setCustomFields] = useState<CustomFieldValues>({});
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<
    CustomFieldDefinition[] | null
  >(null);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(true);
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(resourceId));
  const [saving, setSaving] = useState(false);
  const [aiAction, setAiAction] = useState<"analyze" | "cover" | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(canUseAi);
  const [autoCover, setAutoCover] = useState(false);
  const [coverPrompt, setCoverPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const loadResource = useCallback(async () => {
    if (!resourceId) return;
    setLoading(true);
    try {
      const response = await fetchJson<{ resource: ClientResource }>(
        `/api/v1/resources/${resourceId}`,
      );
      setResource(response.resource);
      setForm(toForm(response.resource));
      setCustomFields(response.resource.customFields ?? {});
      setCoverPrompt(defaultCoverPrompt(response.resource.name));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.load"));
    } finally {
      setLoading(false);
    }
  }, [resourceId, t]);

  const loadCustomFieldDefinitions = useCallback(async () => {
    setCustomFieldsLoading(true);
    setCustomFieldsError(null);
    try {
      const response = await fetchJson<unknown>(
        "/api/v1/custom-fields?entityType=inventory",
        { cache: "no-store" },
      );
      setCustomFieldDefinitions(
        customFieldDefinitionsFromResponse(response).filter(
          (definition) =>
            definition.entityType === "inventory" && definition.archivedAt === null,
        ),
      );
    } catch (loadError) {
      setCustomFieldDefinitions(null);
      setCustomFieldsError(
        loadError instanceof Error
          ? loadError.message
          : t("errors.loadCustomFields"),
      );
    } finally {
      setCustomFieldsLoading(false);
    }
  }, [t]);

  const loadInventoryTypes = useCallback(async () => {
    try {
      const response = await fetchJson<{ types: InventoryTypeOption[] }>(
        "/api/v1/inventory-types",
        { cache: "no-store" },
      );
      if (response.types.length) setInventoryTypes(response.types);
    } catch {
      // Keep the built-in fallback so item editing remains available while
      // settings are temporarily unavailable or before the migration runs.
    }
  }, []);

  useEffect(() => {
    void loadResource();
  }, [loadResource]);

  useEffect(() => {
    void loadCustomFieldDefinitions();
  }, [loadCustomFieldDefinitions]);

  useEffect(() => {
    void loadInventoryTypes();
  }, [loadInventoryTypes]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const setField = (field: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const categoryNames = useMemo(
    () =>
      form.categories
        .split(",")
        .map((category) => category.trim())
        .filter(Boolean),
    [form.categories],
  );

  const applicableCustomFieldDefinitions = useMemo(
    () =>
      (customFieldDefinitions ?? []).filter((definition) =>
        isCustomFieldDefinitionApplicable(definition, {
          type: form.type,
          categories: categoryNames,
        }),
      ),
    [categoryNames, customFieldDefinitions, form.type],
  );

  const payloadCustomFields = useMemo(() => {
    if (customFieldDefinitions === null) return undefined;
    const applicableKeys = new Set(
      applicableCustomFieldDefinitions.map((definition) => definition.key),
    );
    return Object.fromEntries(
      Object.entries(customFields).filter(([key]) => applicableKeys.has(key)),
    ) as CustomFieldValues;
  }, [applicableCustomFieldDefinitions, customFieldDefinitions, customFields]);

  const acceptFiles = async (incoming: File[]) => {
    setError(null);
    const supported = incoming.filter(
      (file) =>
        file.type.startsWith("image/") ||
        file.type.startsWith("video/") ||
        file.type === "application/pdf",
    );
    if (supported.length !== incoming.length) {
      setError(t("errors.unsupportedFiles"));
    }
    const prepared = await Promise.all(supported.slice(0, 12).map(prepareUpload));
    setFiles((current) => [...current, ...prepared].slice(0, 12));

    const firstImage = prepared.find((file) => file.type.startsWith("image/"));
    if (
      canManageSpatial &&
      firstImage &&
      !form.gpsLatitude &&
      !form.gpsLongitude
    ) {
      const gps = await readImageGps(firstImage);
      if (gps) {
        setForm((current) => ({
          ...current,
          gpsLatitude: String(gps.latitude),
          gpsLongitude: String(gps.longitude),
          gpsAltitude: gps.altitude === undefined ? current.gpsAltitude : String(gps.altitude),
        }));
        setNotice(t("notices.locationRead"));
      }
    }
  };

  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    void acceptFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void acceptFiles(Array.from(event.dataTransfer.files));
  };

  const payload = () => ({
    name: form.name.trim() || t("fallback.untitled"),
    description: form.description.trim(),
    type: form.type,
    status: form.status,
    sku: form.sku.trim() || null,
    // Existing stock is changed through dated bookings so the audit trail stays intact.
    quantity: isNew ? Number(form.quantity || 1) : undefined,
    location: form.location.trim() || null,
    serialNumber: form.serialNumber.trim() || null,
    valueCents: form.value ? Math.round(Number(form.value) * 100) : null,
    currency: form.currency.toUpperCase(),
    priority: Number(form.priority),
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean),
    categories: form.categories
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name })),
    customFields: payloadCustomFields,
    gpsLatitude: form.gpsLatitude ? Number(form.gpsLatitude) : null,
    gpsLongitude: form.gpsLongitude ? Number(form.gpsLongitude) : null,
    gpsAltitude: form.gpsAltitude ? Number(form.gpsAltitude) : null,
    notes: form.notes.trim(),
  });

  const uploadMedia = async (id: string) => {
    if (!files.length) return;
    const body = new FormData();
    files.forEach((file) => body.append("files", file, file.name));
    await fetchJson(`/api/v1/resources/${id}/media`, { method: "POST", body });
  };

  const runAnalysis = async (id = resourceId, overwrite = true) => {
    if (!id) return null;
    setAiAction("analyze");
    setError(null);
    try {
      const response = await fetchJson<{ resource: ClientResource }>(
        `/api/v1/resources/${id}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overwrite }),
        },
      );
      setResource(response.resource);
      setForm(toForm(response.resource));
      setCustomFields(response.resource.customFields ?? {});
      setCoverPrompt(defaultCoverPrompt(response.resource.name));
      setNotice(t("notices.analysisComplete"));
      return response.resource;
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : t("errors.analysis"),
      );
      return null;
    } finally {
      setAiAction(null);
    }
  };

  const runCover = async (id = resourceId) => {
    if (!id) return null;
    setAiAction("cover");
    setError(null);
    try {
      const response = await fetchJson<{ resource: ClientResource }>(
        `/api/v1/resources/${id}/cover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: coverPrompt || undefined,
            ...(imageModelPreference.selectedModelId
              ? { modelId: imageModelPreference.selectedModelId }
              : {}),
          }),
        },
      );
      setResource(response.resource);
      setNotice(t("notices.coverComplete"));
      return response.resource;
    } catch (coverError) {
      setError(
        coverError instanceof Error ? coverError.message : t("errors.cover"),
      );
      return null;
    } finally {
      setAiAction(null);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const missingCustomField = applicableCustomFieldDefinitions.find((definition) => {
      if (!definition.required) return false;
      const value = customFields[definition.key];
      return (
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      );
    });
    if (missingCustomField) {
      setError(
        t("errors.requiredCustomField", { label: missingCustomField.label }),
      );
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (isNew) {
        if (!form.name.trim() && !files.some((file) => file.type.startsWith("image/"))) {
          throw new Error(t("errors.nameOrImage"));
        }
        const created = await fetchJson<{ resource: ClientResource }>("/api/v1/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
        await uploadMedia(created.resource.id);
        let latest = created.resource;
        if (
          canUseAi &&
          autoAnalyze &&
          files.some((file) => file.type.startsWith("image/"))
        ) {
          latest = (await runAnalysis(created.resource.id, true)) ?? latest;
        }
        if (
          canUseAi &&
          autoCover &&
          files.some((file) => file.type.startsWith("image/"))
        ) {
          latest = (await runCover(created.resource.id)) ?? latest;
        }
        router.push(`/inventory/${latest.id}`);
        router.refresh();
      } else {
        const saved = await fetchJson<{
          translation?: { status: string; error?: string };
        }>(`/api/v1/resources/${resourceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
        await uploadMedia(resourceId!);
        setFiles([]);
        await loadResource();
        setNotice(
          saved.translation?.status === "queued"
            ? t("notices.savedTranslations")
            : t("notices.saved"),
        );
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const removeMedia = async (mediaId: string) => {
    if (!resourceId || !window.confirm(t("confirm.removeFile"))) return;
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/media/${mediaId}`, {
        method: "DELETE",
      });
      await loadResource();
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : t("errors.removeFile"),
      );
    }
  };

  const moveMedia = async (mediaId: string, direction: -1 | 1) => {
    if (!resourceId || !resource) return;
    const order = resource.media.map((item) => item.id);
    const index = order.indexOf(mediaId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    try {
      const response = await fetchJson<{ resource: ClientResource }>(
        `/api/v1/resources/${resourceId}/media`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order }),
        },
      );
      setResource(response.resource);
    } catch (moveError) {
      setError(
        moveError instanceof Error ? moveError.message : t("errors.reorderMedia"),
      );
    }
  };

  const deleteItem = async () => {
    if (
      !resourceId ||
      !window.confirm(t("confirm.delete", { name: resource?.name ?? "" }))
    ) {
      return;
    }
    try {
      await fetchJson(`/api/v1/resources/${resourceId}`, { method: "DELETE" });
      router.push("/inventory");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : t("errors.delete"),
      );
    }
  };

  const itemMedia = resource?.media ?? [];
  const totalMedia = itemMedia.length + files.length;
  const hasImage =
    itemMedia.some((item) => item.kind === "image") ||
    files.some((file) => file.type.startsWith("image/"));
  const mapHref = useMemo(() => {
    if (!form.gpsLatitude || !form.gpsLongitude) return null;
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(form.gpsLatitude)}&mlon=${encodeURIComponent(form.gpsLongitude)}#map=18/${encodeURIComponent(form.gpsLatitude)}/${encodeURIComponent(form.gpsLongitude)}`;
  }, [form.gpsLatitude, form.gpsLongitude]);

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-muted">
        <LoaderCircle className="animate-spin" />
      </div>
    );
  }

  return (
    <>
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-[1450px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-muted-strong">
              <ArrowLeft size={13} /> {t("header.inventory")}
            </Link>
            <ChevronRight size={13} />
            {isNew ? (
              <span className="truncate text-muted">{t("header.newItem")}</span>
            ) : (
              <>
                <Link href={`/inventory/${resourceId}`} className="truncate hover:text-muted-strong">
                  {resource?.name}
                </Link>
                <ChevronRight size={13} />
                <span className="text-muted">{t("header.edit")}</span>
              </>
            )}
          </div>
          <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl">
            {isNew ? t("header.addItem") : resource?.name}
          </h1>
          {!isNew && resource ? (
            <p className="mt-1 text-xs text-muted">
              {t("header.updated", {
                date: new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(resource.updatedAt)),
                id: resource.id.slice(0, 8),
              })}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">{t("header.description")}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isNew && canDelete ? (
            <Link
              href={`/inventory/${resourceId}/stock`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-brand-border bg-brand-soft px-3.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
            >
              <Warehouse size={16} />
              {t("header.stock")}
            </Link>
          ) : null}
          {!isNew ? (
            <button
              type="button"
              onClick={deleteItem}
              className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-surface text-muted transition hover:border-danger-border hover:bg-danger-soft hover:text-danger"
              aria-label={t("actions.deleteItem")}
            >
              <Trash2 size={17} />
            </button>
          ) : null}
          <button
            type="submit"
            disabled={
              saving ||
              Boolean(aiAction) ||
              customFieldsLoading ||
              Boolean(customFieldsError)
            }
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-strong px-4 text-sm font-semibold text-on-strong shadow-sm transition hover:bg-success disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
            {saving
              ? t("actions.saving")
              : isNew
                ? t("actions.createItem")
                : t("actions.saveChanges")}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label={t("actions.dismissError")}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          <span className="flex items-center gap-2"><Check size={16} /> {notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t("actions.dismissMessage")}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-border pb-4">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-surface-muted text-muted"><Package size={17} /></div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {t("details.title")}
                </h2>
                <p className="text-xs text-muted">{t("details.description")}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={`${labelClass} sm:col-span-2`}>
                {t("details.name")}
                <input
                  value={form.name}
                  onChange={(event) => setField("name", event.target.value)}
                  placeholder={
                    files.length
                      ? t("details.nameAiPlaceholder")
                      : t("details.namePlaceholder")
                  }
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                {t("details.type")}
                <select value={form.type} onChange={(event) => setField("type", event.target.value)} className={inputClass}>
                  {!inventoryTypes.some((type) => type.key === form.type) ? (
                    <option value={form.type}>{form.type}</option>
                  ) : null}
                  {inventoryTypes.map((type) => (
                    <option key={type.key} value={type.key}>
                      {fallbackTypes.includes(type.key) &&
                      type.label.toLowerCase() === type.key
                        ? t(`types.${type.key}`)
                        : type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                {t("details.status")}
                <select value={form.status} onChange={(event) => setField("status", event.target.value)} className={inputClass}>
                  <option value="available">{t("statuses.available")}</option>
                  <option value="in-use">{t("statuses.inUse")}</option>
                  <option value="maintenance">{t("statuses.maintenance")}</option>
                  <option value="archived">{t("statuses.archived")}</option>
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                {t("details.itemDescription")}
                <textarea
                  value={form.description}
                  onChange={(event) => setField("description", event.target.value)}
                  placeholder={t("details.descriptionPlaceholder")}
                  rows={7}
                  className={`${inputClass} h-auto resize-y py-3 leading-6`}
                />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                {t("details.tags")} {" "}
                <span className="font-normal text-muted">
                  · {t("details.commaSeparated")}
                </span>
                <input value={form.tags} onChange={(event) => setField("tags", event.target.value)} placeholder={t("details.tagsPlaceholder")} className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                {t("details.categories")} {" "}
                <span className="font-normal text-muted">
                  · {t("details.commaSeparated")}
                </span>
                <input value={form.categories} onChange={(event) => setField("categories", event.target.value)} placeholder={t("details.categoriesPlaceholder")} className={inputClass} />
              </label>
            </div>
          </section>

          {!isNew && resourceId ? (
            <ResourceTranslations
              resourceId={resourceId}
              resourceUpdatedAt={resource?.updatedAt}
            />
          ) : null}

          <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Braces size={17} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("customFields.title")}
                  </h2>
                  <p className="text-xs text-muted">
                    {t("customFields.description")}
                  </p>
                </div>
              </div>
              {!customFieldsLoading && !customFieldsError ? (
                <span className="hidden rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold text-brand sm:inline-flex">
                  {t("customFields.count", {
                    count: applicableCustomFieldDefinitions.length,
                  })}
                </span>
              ) : null}
            </div>

            {customFieldsLoading ? (
              <div
                className="grid gap-4 sm:grid-cols-2"
                aria-label={t("customFields.loading")}
              >
                {Array.from({ length: 2 }, (_, index) => (
                  <div key={index}>
                    <div className="h-3 w-24 animate-pulse rounded bg-surface-hover" />
                    <div className="mt-2 h-11 animate-pulse rounded-xl bg-surface-muted" />
                  </div>
                ))}
              </div>
            ) : customFieldsError ? (
              <div className="flex flex-col gap-3 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-xs leading-5 text-warning sm:flex-row sm:items-center sm:justify-between">
                <span>{customFieldsError}</span>
                <button
                  type="button"
                  onClick={() => void loadCustomFieldDefinitions()}
                  className="shrink-0 font-semibold underline underline-offset-2"
                >
                  {t("actions.retry")}
                </button>
              </div>
            ) : applicableCustomFieldDefinitions.length ? (
              <CustomFieldInputs
                definitions={applicableCustomFieldDefinitions}
                values={customFields}
                onChange={setCustomFields}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-surface-subtle/60 px-5 py-8 text-center">
                <Braces className="mx-auto size-5 text-muted" aria-hidden="true" />
                <p className="mt-2 text-xs font-semibold text-muted">
                  {t("customFields.empty")}
                </p>
                <p className="mx-auto mt-1 max-w-md text-[11px] leading-4 text-muted">
                  {t("customFields.emptyDescription", { type: form.type })}
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-info-soft text-info">
                  <ImageIcon size={17} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {t("media.title")}
                  </h2>
                  <p className="text-xs text-muted">
                    {t("media.description", { count: totalMedia })}
                  </p>
                </div>
              </div>
            </div>

            {itemMedia.length ? (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {itemMedia.map((item, index) => {
                  const Icon = mediaIcon(item.kind);
                  return (
                    <div key={item.id} className="group relative overflow-hidden rounded-2xl border border-border bg-surface-subtle">
                      <div className="aspect-square overflow-hidden">
                        {item.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.url} alt={item.altText || item.name} className="h-full w-full object-cover" />
                        ) : item.kind === "video" ? (
                          <video src={item.url} className="h-full w-full object-cover" muted preload="metadata" />
                        ) : (
                          <div className="grid h-full place-items-center text-muted"><Icon size={34} strokeWidth={1.5} /></div>
                        )}
                      </div>
                      <div className="absolute inset-x-2 top-2 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${index === 0 ? "bg-success text-on-strong" : "bg-surface/90 text-muted"}`}>
                          {index === 0 ? t("media.cover") : index + 1}
                        </span>
                        {item.source === "ai" ? <span className="rounded-full bg-brand-solid px-2 py-1 text-[10px] font-bold text-on-brand">{t("media.ai")}</span> : null}
                      </div>
                      <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                        <button type="button" disabled={index === 0} onClick={() => void moveMedia(item.id, -1)} className="grid h-7 w-7 place-items-center rounded-lg bg-surface/95 text-muted shadow disabled:opacity-30" aria-label={t("media.moveEarlier")}><ArrowUp size={13} /></button>
                        <button type="button" disabled={index === itemMedia.length - 1} onClick={() => void moveMedia(item.id, 1)} className="grid h-7 w-7 place-items-center rounded-lg bg-surface/95 text-muted shadow disabled:opacity-30" aria-label={t("media.moveLater")}><ArrowDown size={13} /></button>
                        <button type="button" onClick={() => void removeMedia(item.id)} className="grid h-7 w-7 place-items-center rounded-lg bg-surface/95 text-danger shadow" aria-label={t("media.remove")}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {previews.length ? (
              <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {previews.map((preview, index) => (
                  <div key={preview} className="relative aspect-square overflow-hidden rounded-xl border-2 border-dashed border-success-border bg-success-soft">
                    {files[index]?.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview} alt={t("media.pendingUpload")} className="h-full w-full object-cover opacity-90" />
                    ) : (
                      <div className="grid h-full place-items-center text-success"><Paperclip size={24} /></div>
                    )}
                    <button type="button" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-slate-950/75 text-white" aria-label={t("media.removePending")}><X size={12} /></button>
                  </div>
                ))}
              </div>
            ) : null}

            <label
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition ${dragging ? "border-success-border bg-success-soft" : "border-border bg-surface-subtle hover:border-border-strong hover:bg-surface-muted/70"}`}
            >
              <input type="file" multiple accept="image/*,video/*,application/pdf" onChange={onFileInput} className="sr-only" />
              <UploadCloud size={24} className="mb-2 text-muted" />
              <span className="text-sm font-semibold text-muted-strong">
                {t("media.drop")}
              </span>
              <span className="mt-1 text-xs text-muted">
                {t("media.formats")}
              </span>
            </label>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-border pb-4">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-warning-soft text-warning"><CircleDollarSign size={17} /></div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t("operations.title")}</h2>
                <p className="text-xs text-muted">{t("operations.description")}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelClass}>{t("operations.sku")}<input value={form.sku} onChange={(event) => setField("sku", event.target.value)} placeholder={t("operations.skuPlaceholder")} className={inputClass} /></label>
              <label className={labelClass}>{t("operations.serialNumber")}<input value={form.serialNumber} onChange={(event) => setField("serialNumber", event.target.value)} className={inputClass} /></label>
              {isNew ? (
                <label className={labelClass}>{t("operations.openingQuantity")}<input type="number" min="0" value={form.quantity} onChange={(event) => setField("quantity", event.target.value)} className={inputClass} /></label>
              ) : (
                <div className={labelClass}>
                  {t("operations.currentStock")}
                  <Link
                    href={`/inventory/${resourceId}/stock`}
                    className="mt-1.5 flex h-11 items-center justify-between rounded-xl border border-brand-border bg-brand-soft px-3.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
                  >
                    <span className="inline-flex items-center gap-2"><Warehouse size={15} />{t("operations.units", { count: Number(form.quantity) })}</span>
                    <span className="text-xs">{t("operations.manageStock")} →</span>
                  </Link>
                </div>
              )}
              <label className={`${labelClass} sm:col-span-2`}>{t("operations.location")}<input value={form.location} onChange={(event) => setField("location", event.target.value)} placeholder={t("operations.locationPlaceholder")} className={inputClass} /></label>
              <label className={labelClass}>{t("operations.priority")}<select value={form.priority} onChange={(event) => setField("priority", event.target.value)} className={inputClass}><option value="1">1 · {t("operations.priorityLow")}</option><option value="2">2</option><option value="3">3 · {t("operations.priorityNormal")}</option><option value="4">4</option><option value="5">5 · {t("operations.priorityHigh")}</option></select></label>
              <label className={labelClass}>{t("operations.value")}<div className="mt-1.5 flex"><input type="number" min="0" step="0.01" value={form.value} onChange={(event) => setField("value", event.target.value)} className={`${inputClass} mt-0 rounded-r-none`} /><input value={form.currency} onChange={(event) => setField("currency", event.target.value.slice(0, 3))} className="h-11 w-20 rounded-r-xl border border-l-0 border-border bg-surface-subtle px-3 text-center text-xs font-bold uppercase text-muted outline-none" aria-label={t("operations.currency")} /></div></label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>{t("operations.notes")}<textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={4} className={`${inputClass} h-auto py-3`} /></label>
            </div>
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-5">
          {canUseAi ? (
          <section className="overflow-hidden rounded-2xl border border-brand-border bg-gradient-to-br from-brand-soft to-surface p-5 shadow-[var(--shadow-md)]">
            <div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-solid text-on-brand shadow-lg shadow-[var(--shadow-sm)]"><Sparkles size={19} /></div><div><h2 className="text-sm font-semibold text-foreground">{t("ai.title")}</h2><p className="text-xs text-brand">{t("ai.description")}</p></div></div>
            {isNew ? (
              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-xl border border-brand-border bg-surface/80 p-3"><input type="checkbox" checked={autoAnalyze} onChange={(event) => setAutoAnalyze(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-solid" /><span><span className="block text-xs font-semibold text-muted-strong">{t("ai.analyzeImages")}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted">{t("ai.analyzeDescription")}</span></span></label>
                <label className="flex items-start gap-3 rounded-xl border border-brand-border bg-surface/80 p-3"><input type="checkbox" checked={autoCover} onChange={(event) => setAutoCover(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-solid" /><span><span className="block text-xs font-semibold text-muted-strong">{t("ai.generateCover")}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted">{t("ai.coverDescription")}</span></span></label>
                {autoCover ? (
                  <ImageModelSelector
                    preference={imageModelPreference}
                    disabled={Boolean(aiAction)}
                    className="rounded-xl border border-brand-border bg-surface/80 p-3"
                  />
                ) : null}
                <p className="text-[11px] leading-4 text-muted">{t("ai.safety")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <button type="button" disabled={!hasImage || Boolean(aiAction)} onClick={() => void runAnalysis(resourceId, true)} className="flex w-full items-center justify-between rounded-xl bg-brand-solid px-3.5 py-3 text-left text-xs font-semibold text-on-brand shadow-sm transition hover:bg-brand-hover disabled:bg-muted disabled:text-background disabled:opacity-100"><span className="flex items-center gap-2">{aiAction === "analyze" ? <LoaderCircle size={15} className="animate-spin" /> : <Bot size={15} />}{t("ai.rewrite")}</span><ChevronRight size={15} /></button>
                <div className="rounded-xl border border-brand-border bg-surface/80 p-3">
                  <label className="text-[11px] font-semibold text-muted">
                    {t("ai.coverDirection")}
                    <textarea value={coverPrompt} onChange={(event) => setCoverPrompt(event.target.value)} rows={5} className="mt-2 w-full resize-none rounded-lg border border-border bg-surface p-2.5 text-xs leading-5 text-muted-strong outline-none focus:border-focus" />
                  </label>
                  <ImageModelSelector
                    preference={imageModelPreference}
                    disabled={Boolean(aiAction)}
                    className="mt-3"
                  />
                  <button type="button" disabled={!hasImage || Boolean(aiAction)} onClick={() => void runCover(resourceId)} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-border bg-brand-soft px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand-soft disabled:border-border-strong disabled:bg-surface-muted disabled:text-muted disabled:opacity-100">{aiAction === "cover" ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />}{t("ai.generateNewCover")}</button>
                </div>
                {!hasImage ? <p className="text-[11px] text-warning">{t("ai.imageRequired")}</p> : null}
                {resource?.aiMetadata ? <div className="flex items-center justify-between rounded-lg bg-brand-soft px-3 py-2 text-[10px] text-brand"><span>{t("ai.lastModel")}</span><span className="max-w-40 truncate font-mono">{resource.aiMetadata.model ?? "AI"}</span></div> : null}
              </div>
            )}
          </section>
          ) : null}

          {canManageSpatial ? (
          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="mb-4 flex items-center gap-2"><MapPin size={16} className="text-success" /><h2 className="text-sm font-semibold text-foreground">{t("position.title")}</h2></div>
            {!isNew && resourceId ? (
              <Link href={`/map?resource=${resourceId}`} className="mb-4 flex items-center justify-between rounded-xl border border-brand-border bg-brand-soft px-3 py-2.5 text-xs font-semibold text-brand transition hover:bg-brand-soft">
                <span className="inline-flex items-center gap-2"><MapPin size={14} />{t("position.editMap")}</span>
                <ChevronRight size={14} />
              </Link>
            ) : (
              <p className="mb-3 text-[11px] leading-4 text-muted">{t("position.saveFirst")}</p>
            )}
            {resource?.mapFeatures.length ? <p className="mb-3 text-[11px] leading-4 text-brand">{t("position.geometryNotice")}</p> : null}
            <label className={labelClass}>{t("position.latitude")}<input type="number" step="any" value={form.gpsLatitude} onChange={(event) => setField("gpsLatitude", event.target.value)} placeholder="51.0504" disabled={Boolean(resource?.mapFeatures.length)} className={inputClass} /></label>
            <label className={`${labelClass} mt-3`}>{t("position.longitude")}<input type="number" step="any" value={form.gpsLongitude} onChange={(event) => setField("gpsLongitude", event.target.value)} placeholder="13.7373" disabled={Boolean(resource?.mapFeatures.length)} className={inputClass} /></label>
            <label className={`${labelClass} mt-3`}>{t("position.altitude")} <span className="font-normal text-muted">· {t("position.metres")}</span><input type="number" step="any" value={form.gpsAltitude} onChange={(event) => setField("gpsAltitude", event.target.value)} className={inputClass} /></label>
            {mapHref ? <a href={mapHref} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-success hover:text-success">{t("position.openMap")} <ChevronRight size={13} /></a> : <p className="mt-3 text-[11px] leading-4 text-muted">{t("position.gpsHelp")}</p>}
          </section>
          ) : null}

          {!isNew && resource ? (
            <section className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{t("record.title")}</h2>
              <button type="button" onClick={() => void navigator.clipboard.writeText(resource.id).then(() => setNotice(t("notices.idCopied")))} className="flex w-full items-center justify-between rounded-xl bg-surface-subtle px-3 py-2.5 text-left"><span className="min-w-0"><span className="block text-[10px] text-muted">{t("record.id")}</span><span className="block truncate font-mono text-xs text-muted">{resource.id}</span></span><Copy size={14} className="ml-3 shrink-0 text-muted" /></button>
              <button type="button" onClick={() => void loadResource()} className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-muted hover:text-foreground"><RefreshCcw size={13} /> {t("record.reload")}</button>
            </section>
          ) : null}
        </aside>
      </div>
    </form>
    {resourceId ? (
      <section className="mx-auto w-full max-w-[1450px] px-4 pb-8 sm:px-6 lg:px-8">
        <AssemblyManager resourceId={resourceId} mode="bom" />
      </section>
    ) : null}
    </>
  );
}
