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

import { defaultCoverPrompt } from "@/lib/ai-prompts";
import { fetchJson, type ClientResource } from "@/lib/client-types";
import { prepareUpload, readImageGps } from "@/lib/client-media";
import { AssemblyManager } from "@/components/assembly-manager";
import { CustomFieldInputs } from "@/components/custom-field-inputs";
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
  "mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 disabled:bg-slate-50 disabled:text-slate-400";
const labelClass = "block text-xs font-semibold text-slate-700";

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

export function ResourceEditor({ resourceId }: { resourceId?: string }) {
  const router = useRouter();
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
  const [autoAnalyze, setAutoAnalyze] = useState(true);
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
      setError(loadError instanceof Error ? loadError.message : "Unable to load item.");
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

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
          : "Unable to load custom field definitions.",
      );
    } finally {
      setCustomFieldsLoading(false);
    }
  }, []);

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
      setError("Some files were skipped. Supported formats are images, video, and PDF.");
    }
    const prepared = await Promise.all(supported.slice(0, 12).map(prepareUpload));
    setFiles((current) => [...current, ...prepared].slice(0, 12));

    const firstImage = prepared.find((file) => file.type.startsWith("image/"));
    if (firstImage && !form.gpsLatitude && !form.gpsLongitude) {
      const gps = await readImageGps(firstImage);
      if (gps) {
        setForm((current) => ({
          ...current,
          gpsLatitude: String(gps.latitude),
          gpsLongitude: String(gps.longitude),
          gpsAltitude: gps.altitude === undefined ? current.gpsAltitude : String(gps.altitude),
        }));
        setNotice("Location was read from the image metadata. Please verify it.");
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
    name: form.name.trim() || "Untitled item",
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
      setNotice("AI analysis updated the title, description, tags and type.");
      return response.resource;
    } catch (analysisError) {
      setError(
        analysisError instanceof Error ? analysisError.message : "AI analysis failed.",
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
      setNotice("A new studio cover was generated and set as the first image.");
      return response.resource;
    } catch (coverError) {
      setError(coverError instanceof Error ? coverError.message : "Cover generation failed.");
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
      setError(`Complete the required custom field “${missingCustomField.label}”.`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (isNew) {
        if (!form.name.trim() && !files.some((file) => file.type.startsWith("image/"))) {
          throw new Error("Add a name or at least one image for AI analysis.");
        }
        const created = await fetchJson<{ resource: ClientResource }>("/api/v1/resources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
        await uploadMedia(created.resource.id);
        let latest = created.resource;
        if (autoAnalyze && files.some((file) => file.type.startsWith("image/"))) {
          latest = (await runAnalysis(created.resource.id, true)) ?? latest;
        }
        if (autoCover && files.some((file) => file.type.startsWith("image/"))) {
          latest = (await runCover(created.resource.id)) ?? latest;
        }
        router.push(`/inventory/${latest.id}`);
        router.refresh();
      } else {
        await fetchJson(`/api/v1/resources/${resourceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload()),
        });
        await uploadMedia(resourceId!);
        setFiles([]);
        await loadResource();
        setNotice("Changes saved.");
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save item.");
    } finally {
      setSaving(false);
    }
  };

  const removeMedia = async (mediaId: string) => {
    if (!resourceId || !window.confirm("Remove this file from the item?")) return;
    try {
      await fetchJson(`/api/v1/resources/${resourceId}/media/${mediaId}`, {
        method: "DELETE",
      });
      await loadResource();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Unable to remove file.");
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
      setError(moveError instanceof Error ? moveError.message : "Unable to reorder media.");
    }
  };

  const deleteItem = async () => {
    if (!resourceId || !window.confirm(`Delete “${resource?.name}”? This cannot be undone.`)) {
      return;
    }
    try {
      await fetchJson(`/api/v1/resources/${resourceId}`, { method: "DELETE" });
      router.push("/inventory");
      router.refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete item.");
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
      <div className="grid min-h-[60vh] place-items-center text-slate-400">
        <LoaderCircle className="animate-spin" />
      </div>
    );
  }

  return (
    <>
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-[1450px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Link href="/inventory" className="inline-flex items-center gap-1 hover:text-slate-800">
              <ArrowLeft size={13} /> Inventory
            </Link>
            <ChevronRight size={13} />
            <span className="truncate text-slate-600">{isNew ? "New item" : resource?.name}</span>
          </div>
          <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">
            {isNew ? "Add inventory item" : resource?.name}
          </h1>
          {!isNew && resource ? (
            <p className="mt-1 text-xs text-slate-400">
              Updated {new Date(resource.updatedAt).toLocaleString()} · ID {resource.id.slice(0, 8)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Create manually or let images do the first draft.</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isNew ? (
            <Link
              href={`/inventory/${resourceId}/stock`}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-100"
            >
              <Warehouse size={16} />
              Stock
            </Link>
          ) : null}
          {!isNew ? (
            <button
              type="button"
              onClick={deleteItem}
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              aria-label="Delete item"
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
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? "Saving…" : isNew ? "Create item" : "Save changes"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X size={16} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span className="flex items-center gap-2"><Check size={16} /> {notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)] sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-600"><Package size={17} /></div>
              <div><h2 className="text-sm font-semibold text-slate-950">Core details</h2><p className="text-xs text-slate-400">Identity, category and availability</p></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={`${labelClass} sm:col-span-2`}>
                Item name
                <input
                  value={form.name}
                  onChange={(event) => setField("name", event.target.value)}
                  placeholder={files.length ? "Leave blank to generate from images" : "e.g. Festool track saw TS 55"}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Type
                <select value={form.type} onChange={(event) => setField("type", event.target.value)} className={inputClass}>
                  {!inventoryTypes.some((type) => type.key === form.type) ? (
                    <option value={form.type}>{form.type}</option>
                  ) : null}
                  {inventoryTypes.map((type) => (
                    <option key={type.key} value={type.key}>{type.label}</option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Status
                <select value={form.status} onChange={(event) => setField("status", event.target.value)} className={inputClass}>
                  <option value="available">Available</option><option value="in-use">In use</option><option value="maintenance">Maintenance</option><option value="archived">Archived</option>
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                Description
                <textarea
                  value={form.description}
                  onChange={(event) => setField("description", event.target.value)}
                  placeholder="What is it, what comes with it, and what should someone know before using it?"
                  rows={7}
                  className={`${inputClass} h-auto resize-y py-3 leading-6`}
                />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                Tags <span className="font-normal text-slate-400">· comma separated</span>
                <input value={form.tags} onChange={(event) => setField("tags", event.target.value)} placeholder="woodworking, power-tool, 230v" className={inputClass} />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                Categories <span className="font-normal text-slate-400">· comma separated</span>
                <input value={form.categories} onChange={(event) => setField("categories", event.target.value)} placeholder="Workshop, Production" className={inputClass} />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)] sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-700">
                  <Braces size={17} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">Custom fields</h2>
                  <p className="text-xs text-slate-400">
                    Fields configured for this inventory type and its categories
                  </p>
                </div>
              </div>
              {!customFieldsLoading && !customFieldsError ? (
                <span className="hidden rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-700 sm:inline-flex">
                  {applicableCustomFieldDefinitions.length}{" "}
                  {applicableCustomFieldDefinitions.length === 1 ? "field" : "fields"}
                </span>
              ) : null}
            </div>

            {customFieldsLoading ? (
              <div className="grid gap-4 sm:grid-cols-2" aria-label="Loading custom fields">
                {Array.from({ length: 2 }, (_, index) => (
                  <div key={index}>
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
                    <div className="mt-2 h-11 animate-pulse rounded-xl bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : customFieldsError ? (
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 sm:flex-row sm:items-center sm:justify-between">
                <span>{customFieldsError}</span>
                <button
                  type="button"
                  onClick={() => void loadCustomFieldDefinitions()}
                  className="shrink-0 font-semibold underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            ) : applicableCustomFieldDefinitions.length ? (
              <CustomFieldInputs
                definitions={applicableCustomFieldDefinitions}
                values={customFields}
                onChange={setCustomFields}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-8 text-center">
                <Braces className="mx-auto size-5 text-slate-300" aria-hidden="true" />
                <p className="mt-2 text-xs font-semibold text-slate-600">
                  No custom fields apply to this item
                </p>
                <p className="mx-auto mt-1 max-w-md text-[11px] leading-4 text-slate-400">
                  Administrators can configure fields for {form.type} records or matching
                  categories in Settings.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)] sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700"><ImageIcon size={17} /></div><div><h2 className="text-sm font-semibold text-slate-950">Media</h2><p className="text-xs text-slate-400">Images, video and PDFs · {totalMedia} file{totalMedia === 1 ? "" : "s"}</p></div></div>
            </div>

            {itemMedia.length ? (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {itemMedia.map((item, index) => {
                  const Icon = mediaIcon(item.kind);
                  return (
                    <div key={item.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      <div className="aspect-square overflow-hidden">
                        {item.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.url} alt={item.altText || item.name} className="h-full w-full object-cover" />
                        ) : item.kind === "video" ? (
                          <video src={item.url} className="h-full w-full object-cover" muted preload="metadata" />
                        ) : (
                          <div className="grid h-full place-items-center text-slate-400"><Icon size={34} strokeWidth={1.5} /></div>
                        )}
                      </div>
                      <div className="absolute inset-x-2 top-2 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${index === 0 ? "bg-emerald-600 text-white" : "bg-white/90 text-slate-600"}`}>{index === 0 ? "Cover" : index + 1}</span>
                        {item.source === "ai" ? <span className="rounded-full bg-violet-600 px-2 py-1 text-[10px] font-bold text-white">AI</span> : null}
                      </div>
                      <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                        <button type="button" disabled={index === 0} onClick={() => void moveMedia(item.id, -1)} className="grid h-7 w-7 place-items-center rounded-lg bg-white/95 text-slate-600 shadow disabled:opacity-30" aria-label="Move file earlier"><ArrowUp size={13} /></button>
                        <button type="button" disabled={index === itemMedia.length - 1} onClick={() => void moveMedia(item.id, 1)} className="grid h-7 w-7 place-items-center rounded-lg bg-white/95 text-slate-600 shadow disabled:opacity-30" aria-label="Move file later"><ArrowDown size={13} /></button>
                        <button type="button" onClick={() => void removeMedia(item.id)} className="grid h-7 w-7 place-items-center rounded-lg bg-white/95 text-rose-600 shadow" aria-label="Remove file"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {previews.length ? (
              <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {previews.map((preview, index) => (
                  <div key={preview} className="relative aspect-square overflow-hidden rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50">
                    {files[index]?.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={preview} alt="Pending upload" className="h-full w-full object-cover opacity-90" />
                    ) : (
                      <div className="grid h-full place-items-center text-emerald-700"><Paperclip size={24} /></div>
                    )}
                    <button type="button" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-slate-950/75 text-white" aria-label="Remove pending file"><X size={12} /></button>
                  </div>
                ))}
              </div>
            ) : null}

            <label
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-7 text-center transition ${dragging ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100/70"}`}
            >
              <input type="file" multiple accept="image/*,video/*,application/pdf" onChange={onFileInput} className="sr-only" />
              <UploadCloud size={24} className="mb-2 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Drop files here or browse</span>
              <span className="mt-1 text-xs text-slate-400">JPG, PNG, WebP, HEIC, MP4, MOV or PDF · up to 12 files</span>
            </label>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4"><div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-700"><CircleDollarSign size={17} /></div><div><h2 className="text-sm font-semibold text-slate-950">Operations</h2><p className="text-xs text-slate-400">Tracking, value and internal notes</p></div></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelClass}>SKU<input value={form.sku} onChange={(event) => setField("sku", event.target.value)} placeholder="TOOL-0042" className={inputClass} /></label>
              <label className={labelClass}>Serial number<input value={form.serialNumber} onChange={(event) => setField("serialNumber", event.target.value)} className={inputClass} /></label>
              {isNew ? (
                <label className={labelClass}>Opening quantity<input type="number" min="0" value={form.quantity} onChange={(event) => setField("quantity", event.target.value)} className={inputClass} /></label>
              ) : (
                <div className={labelClass}>
                  Current stock
                  <Link
                    href={`/inventory/${resourceId}/stock`}
                    className="mt-1.5 flex h-11 items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-3.5 text-sm font-semibold text-violet-800 transition hover:bg-violet-100"
                  >
                    <span className="inline-flex items-center gap-2"><Warehouse size={15} />{form.quantity} units</span>
                    <span className="text-xs">Manage stock →</span>
                  </Link>
                </div>
              )}
              <label className={`${labelClass} sm:col-span-2`}>Location<input value={form.location} onChange={(event) => setField("location", event.target.value)} placeholder="Workshop · Shelf A3" className={inputClass} /></label>
              <label className={labelClass}>Priority<select value={form.priority} onChange={(event) => setField("priority", event.target.value)} className={inputClass}><option value="1">1 · Low</option><option value="2">2</option><option value="3">3 · Normal</option><option value="4">4</option><option value="5">5 · High</option></select></label>
              <label className={labelClass}>Value<div className="mt-1.5 flex"><input type="number" min="0" step="0.01" value={form.value} onChange={(event) => setField("value", event.target.value)} className={`${inputClass} mt-0 rounded-r-none`} /><input value={form.currency} onChange={(event) => setField("currency", event.target.value.slice(0, 3))} className="h-11 w-20 rounded-r-xl border border-l-0 border-slate-200 bg-slate-50 px-3 text-center text-xs font-bold uppercase text-slate-600 outline-none" aria-label="Currency" /></div></label>
              <label className={`${labelClass} sm:col-span-2 lg:col-span-3`}>Internal notes<textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={4} className={`${inputClass} h-auto py-3`} /></label>
            </div>
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-5">
          <section className="overflow-hidden rounded-2xl border border-violet-200 bg-[radial-gradient(circle_at_100%_0%,rgba(167,139,250,.26),transparent_42%),linear-gradient(145deg,#fff,#faf8ff)] p-5 shadow-[0_12px_40px_rgba(109,40,217,0.07)]">
            <div className="mb-4 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-600/20"><Sparkles size={19} /></div><div><h2 className="text-sm font-semibold text-slate-950">AI catalogue studio</h2><p className="text-xs text-violet-700">Vision analysis + image editing</p></div></div>
            {isNew ? (
              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-xl border border-violet-100 bg-white/80 p-3"><input type="checkbox" checked={autoAnalyze} onChange={(event) => setAutoAnalyze(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" /><span><span className="block text-xs font-semibold text-slate-800">Analyze images</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Generate title, description, type, tags and alt text.</span></span></label>
                <label className="flex items-start gap-3 rounded-xl border border-violet-100 bg-white/80 p-3"><input type="checkbox" checked={autoCover} onChange={(event) => setAutoCover(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-600" /><span><span className="block text-xs font-semibold text-slate-800">Generate studio cover</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Create a clean square hero image from the first photo.</span></span></label>
                {autoCover ? (
                  <ImageModelSelector
                    preference={imageModelPreference}
                    disabled={Boolean(aiAction)}
                    className="rounded-xl border border-violet-100 bg-white/80 p-3"
                  />
                ) : null}
                <p className="text-[11px] leading-4 text-slate-400">AI runs only after the original files are safely stored. You can always edit the result.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <button type="button" disabled={!hasImage || Boolean(aiAction)} onClick={() => void runAnalysis(resourceId, true)} className="flex w-full items-center justify-between rounded-xl bg-violet-600 px-3.5 py-3 text-left text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-40"><span className="flex items-center gap-2">{aiAction === "analyze" ? <LoaderCircle size={15} className="animate-spin" /> : <Bot size={15} />}Analyze & rewrite fields</span><ChevronRight size={15} /></button>
                <div className="rounded-xl border border-violet-100 bg-white/80 p-3">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Cover direction
                    <textarea value={coverPrompt} onChange={(event) => setCoverPrompt(event.target.value)} rows={5} className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-white p-2.5 text-xs leading-5 text-slate-700 outline-none focus:border-violet-400" />
                  </label>
                  <ImageModelSelector
                    preference={imageModelPreference}
                    disabled={Boolean(aiAction)}
                    className="mt-3"
                  />
                  <button type="button" disabled={!hasImage || Boolean(aiAction)} onClick={() => void runCover(resourceId)} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-800 transition hover:bg-violet-100 disabled:opacity-40">{aiAction === "cover" ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />}Generate new cover</button>
                </div>
                {!hasImage ? <p className="text-[11px] text-amber-700">Upload and save an image to enable AI actions.</p> : null}
                {resource?.aiMetadata ? <div className="flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-[10px] text-violet-700"><span>Last model</span><span className="max-w-40 truncate font-mono">{resource.aiMetadata.model ?? "AI"}</span></div> : null}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2"><MapPin size={16} className="text-emerald-700" /><h2 className="text-sm font-semibold text-slate-950">Position</h2></div>
            {!isNew && resourceId ? (
              <Link href={`/map?resource=${resourceId}`} className="mb-4 flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-100">
                <span className="inline-flex items-center gap-2"><MapPin size={14} />Edit point or outline on map</span>
                <ChevronRight size={14} />
              </Link>
            ) : (
              <p className="mb-3 text-[11px] leading-4 text-slate-400">Save the item first to draw its point or outline in the map editor.</p>
            )}
            {resource?.mapFeatures.length ? <p className="mb-3 text-[11px] leading-4 text-violet-700">Coordinates are derived from the saved map geometry. Edit them on the map to keep both views in sync.</p> : null}
            <label className={labelClass}>Latitude<input type="number" step="any" value={form.gpsLatitude} onChange={(event) => setField("gpsLatitude", event.target.value)} placeholder="51.0504" disabled={Boolean(resource?.mapFeatures.length)} className={inputClass} /></label>
            <label className={`${labelClass} mt-3`}>Longitude<input type="number" step="any" value={form.gpsLongitude} onChange={(event) => setField("gpsLongitude", event.target.value)} placeholder="13.7373" disabled={Boolean(resource?.mapFeatures.length)} className={inputClass} /></label>
            <label className={`${labelClass} mt-3`}>Altitude <span className="font-normal text-slate-400">· metres</span><input type="number" step="any" value={form.gpsAltitude} onChange={(event) => setField("gpsAltitude", event.target.value)} className={inputClass} /></label>
            {mapHref ? <a href={mapHref} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900">Open on map <ChevronRight size={13} /></a> : <p className="mt-3 text-[11px] leading-4 text-slate-400">GPS can be read from image metadata, or entered manually.</p>}
          </section>

          {!isNew && resource ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Record</h2>
              <button type="button" onClick={() => void navigator.clipboard.writeText(resource.id).then(() => setNotice("Record ID copied."))} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-left"><span className="min-w-0"><span className="block text-[10px] text-slate-400">Resource ID</span><span className="block truncate font-mono text-xs text-slate-600">{resource.id}</span></span><Copy size={14} className="ml-3 shrink-0 text-slate-400" /></button>
              <button type="button" onClick={() => void loadResource()} className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-900"><RefreshCcw size={13} /> Reload from server</button>
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
