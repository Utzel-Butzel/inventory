"use client";

import {
  Archive,
  Boxes,
  Check,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { Button, Card } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

type InventoryType = {
  key: string;
  label: string;
  description: string;
  color: string;
  icon: string;
  canContain: boolean;
  spatialContainment: boolean;
  position: number;
  isSystem: boolean;
  archivedAt: string | null;
};

type Draft = Pick<
  InventoryType,
  | "key"
  | "label"
  | "description"
  | "color"
  | "icon"
  | "canContain"
  | "spatialContainment"
  | "position"
>;

type InventoryTypePatch = Partial<InventoryType> & {
  archived?: boolean;
};

const emptyDraft: Draft = {
  key: "",
  label: "",
  description: "",
  color: "#635bff",
  icon: "box",
  canContain: false,
  spatialContainment: false,
  position: 100,
};

const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle";

const slug = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

export function InventoryTypeManager() {
  const { t } = useT("settings");
  const [types, setTypes] = useState<InventoryType[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<{ types: InventoryType[] }>(
        "/api/v1/inventory-types?includeArchived=true",
        { cache: "no-store" },
      );
      setTypes(response.types);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("inventoryTypes.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const key = draft.key.trim() || slug(draft.label);
    setSavingKey("new");
    try {
      const response = await fetchJson<{ type: InventoryType }>(
        "/api/v1/inventory-types",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...draft, key }),
        },
      );
      setTypes((current) =>
        [...current, response.type].sort(
          (left, right) => left.position - right.position || left.label.localeCompare(right.label),
        ),
      );
      setDraft(emptyDraft);
      setCreating(false);
      setNotice(t("inventoryTypes.notices.created", { name: response.type.label }));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("inventoryTypes.errors.create"));
    } finally {
      setSavingKey(null);
    }
  }

  async function saveType(type: InventoryType, patch: InventoryTypePatch) {
    setSavingKey(type.key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<{ type: InventoryType }>(
        `/api/v1/inventory-types/${encodeURIComponent(type.key)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      setTypes((current) =>
        current.map((item) => (item.key === type.key ? response.type : item)),
      );
      setNotice(t("inventoryTypes.notices.updated", { name: response.type.label }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("inventoryTypes.errors.update"));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand">
            <Boxes className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-foreground">{t("inventoryTypes.title")}</h2>
            <p className="mt-1 text-sm text-muted">
              {t("inventoryTypes.description")}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="grid size-10 place-items-center rounded-xl border border-border text-muted hover:bg-surface-subtle"
            aria-label={t("inventoryTypes.refresh")}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <Button type="button" onClick={() => setCreating((value) => !value)}>
            {creating ? <X className="size-4" /> : <Plus className="size-4" />}
            {creating ? t("inventoryTypes.close") : t("inventoryTypes.add")}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="border-b border-danger-border bg-danger-soft px-5 py-3 text-sm text-danger">{error}</div>
      ) : null}
      {notice ? (
        <div className="flex items-center gap-2 border-b border-success-border bg-success-soft px-5 py-3 text-sm text-success">
          <Check className="size-4" /> {notice}
        </div>
      ) : null}

      {creating ? (
        <form onSubmit={createType} className="border-b border-brand-border bg-brand-soft/40 p-5 sm:p-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-semibold text-muted-strong">
              {t("inventoryTypes.visibleName")}
              <input
                required
                value={draft.label}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    label: event.target.value,
                    key: current.key || slug(event.target.value),
                  }))
                }
                placeholder={t("inventoryTypes.visibleNamePlaceholder")}
                className={`mt-1.5 ${inputClass}`}
              />
            </label>
            <label className="text-xs font-semibold text-muted-strong">
              {t("inventoryTypes.stableKey")}
              <input
                required
                value={draft.key}
                onChange={(event) => setDraft((current) => ({ ...current, key: slug(event.target.value) }))}
                placeholder={t("inventoryTypes.stableKeyPlaceholder")}
                className={`mt-1.5 font-mono ${inputClass}`}
              />
            </label>
            <label className="text-xs font-semibold text-muted-strong">
              {t("inventoryTypes.color")}
              <input
                type="color"
                value={draft.color}
                onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
                className="mt-1.5 h-10 w-full rounded-xl border border-border bg-surface p-1"
              />
            </label>
            <label className="text-xs font-semibold text-muted-strong">
              {t("inventoryTypes.order")}
              <input
                type="number"
                min={0}
                value={draft.position}
                onChange={(event) => setDraft((current) => ({ ...current, position: Number(event.target.value) }))}
                className={`mt-1.5 ${inputClass}`}
              />
            </label>
            <label className="text-xs font-semibold text-muted-strong md:col-span-2 xl:col-span-4">
              {t("inventoryTypes.descriptionLabel")}
              <input
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder={t("inventoryTypes.descriptionPlaceholder")}
                className={`mt-1.5 ${inputClass}`}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-strong">
              <input
                type="checkbox"
                checked={draft.canContain}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    canContain: event.target.checked,
                    spatialContainment: event.target.checked
                      ? current.spatialContainment
                      : false,
                  }))
                }
              />
              {t("inventoryTypes.canContain")}
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-strong">
              <input
                type="checkbox"
                checked={draft.spatialContainment}
                disabled={!draft.canContain}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, spatialContainment: event.target.checked }))
                }
              />
              {t("inventoryTypes.automaticMapAssignment")}
            </label>
            <Button type="submit" disabled={savingKey === "new"} className="ml-auto">
              {savingKey === "new" ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t("inventoryTypes.create")}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="divide-y divide-border">
        {types.map((type) => (
          <TypeRow
            key={type.key}
            type={type}
            saving={savingKey === type.key}
            onSave={(patch) => void saveType(type, patch)}
          />
        ))}
      </div>
    </Card>
  );
}

function TypeRow({
  type,
  saving,
  onSave,
}: {
  type: InventoryType;
  saving: boolean;
  onSave: (patch: InventoryTypePatch) => void;
}) {
  const { t } = useT("settings");
  const [label, setLabel] = useState(type.label);
  const changed = label.trim() && label.trim() !== type.label;
  useEffect(() => setLabel(type.label), [type.label]);

  return (
    <div className={`grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto] lg:items-center ${type.archivedAt ? "bg-surface-subtle opacity-65" : ""}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />
        <div className="min-w-0 flex-1">
          <input
            value={label}
            disabled={Boolean(type.archivedAt)}
            onChange={(event) => setLabel(event.target.value)}
            className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-foreground outline-none hover:border-border focus:border-brand-border focus:bg-surface"
          />
          <p className="truncate px-2 font-mono text-[11px] text-muted">{type.key}</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        <input
          type="checkbox"
          checked={type.canContain}
          disabled={saving || Boolean(type.archivedAt)}
          onChange={(event) =>
            onSave({
              canContain: event.target.checked,
              ...(!event.target.checked ? { spatialContainment: false } : {}),
            })
          }
        />
        {t("inventoryTypes.container")}
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        <input
          type="checkbox"
          checked={type.spatialContainment}
          disabled={saving || !type.canContain || Boolean(type.archivedAt)}
          onChange={(event) => onSave({ spatialContainment: event.target.checked })}
        />
        {t("inventoryTypes.autoFromMap")}
      </label>
      <div className="flex justify-end gap-2">
        {changed ? (
          <button
            type="button"
            onClick={() => onSave({ label: label.trim() })}
            disabled={saving}
            className="grid size-9 place-items-center rounded-lg bg-strong text-on-strong"
            aria-label={t("inventoryTypes.save", { name: type.label })}
          >
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onSave({ archived: !type.archivedAt })}
          disabled={saving || type.key === "other"}
          className="grid size-9 place-items-center rounded-lg border border-border text-muted hover:bg-surface-subtle disabled:opacity-40"
          aria-label={
            type.archivedAt
              ? t("inventoryTypes.restore", { name: type.label })
              : t("inventoryTypes.archive", { name: type.label })
          }
        >
          {type.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
        </button>
      </div>
    </div>
  );
}
