"use client";

import type { TFunction } from "i18next";
import {
  ChevronDown,
  Layers3,
  Link2,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import { Badge, Button, Card, Skeleton, cn } from "@/components/ui";
import { fetchJson, type ClientResource } from "@/lib/client-types";

type OptionValue = {
  id: string;
  label: string;
  code: string;
  componentResourceId: string | null;
  componentName: string | null;
  isDefault: boolean;
  position: number;
};

type OptionGroup = {
  id: string;
  key: string;
  name: string;
  bomSlotKey: string | null;
  position: number;
  values: OptionValue[];
};

type ResourceOptionsResponse = {
  role: "primary" | "variant";
  currentResourceId: string;
  primary: { id: string; name: string; sku: string | null };
  groups: OptionGroup[];
  currentSelection: Array<{
    groupId: string;
    groupName: string;
    valueId: string;
    valueLabel: string;
  }>;
  bomSlots: Array<{
    slotKey: string;
    position: number;
    componentResourceId: string;
    componentName: string;
  }>;
  combinationCount: number;
  generatedVariantCount: number;
  familyVariantCount: number;
  definitionsLocked: boolean;
};

type DraftValue = {
  localId: string;
  label: string;
  code: string;
  componentResourceId: string;
  isDefault: boolean;
};

type DraftGroup = {
  localId: string;
  name: string;
  key: string;
  bomSlotKey: string;
  values: DraftValue[];
};

type ResourceListResponse = {
  resources: ClientResource[];
  pagination: { pages: number };
};

const inputClass =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground outline-none transition placeholder:text-muted focus:border-success focus:ring-4 focus:ring-success-border";
const labelClass = "block text-[13px] font-semibold text-muted-strong";

const localId = () => crypto.randomUUID();
const emptyValue = (isDefault = false): DraftValue => ({
  localId: localId(),
  label: "",
  code: "",
  componentResourceId: "",
  isDefault,
});
const emptyGroup = (): DraftGroup => ({
  localId: localId(),
  name: "",
  key: "",
  bomSlotKey: "",
  values: [emptyValue(true), emptyValue(false)],
});
const keyFromName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 64);
const codeFromLabel = (label: string) =>
  label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const validKey = /^[a-z][a-z0-9_-]{0,63}$/;
const validCode = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;

function validateDraft(draft: DraftGroup[], t: TFunction) {
  for (const [groupIndex, group] of draft.entries()) {
    const groupLabel = group.name.trim() || String(groupIndex + 1);
    if (!group.name.trim() || !validKey.test(group.key)) {
      return t("options.errors.invalidGroup", { group: groupLabel });
    }
    const labels = group.values.map((value) => value.label.trim().toLocaleLowerCase());
    const codes = group.values.map((value) => value.code.trim().toUpperCase());
    for (const [valueIndex, value] of group.values.entries()) {
      if (!value.label.trim() || !validCode.test(value.code.trim().toUpperCase())) {
        return t("options.errors.invalidValue", {
          group: groupLabel,
          value: valueIndex + 1,
        });
      }
      if (group.bomSlotKey && !value.componentResourceId) {
        return t("options.errors.missingComponent", {
          group: groupLabel,
          value: valueIndex + 1,
        });
      }
    }
    if (new Set(labels).size !== labels.length || new Set(codes).size !== codes.length) {
      return t("options.errors.duplicateValues", { group: groupLabel });
    }
  }
  return null;
}

async function loadEveryResource() {
  const first = await fetchJson<ResourceListResponse>(
    "/api/v1/resources?page=1&pageSize=100",
    { cache: "no-store" },
  );
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, first.pagination.pages - 1) }, (_, index) =>
      fetchJson<ResourceListResponse>(
        `/api/v1/resources?page=${index + 2}&pageSize=100`,
        { cache: "no-store" },
      ),
    ),
  );
  return [first, ...remaining].flatMap((page) => page.resources);
}

const draftFromResponse = (options: ResourceOptionsResponse): DraftGroup[] =>
  options.groups.map((group) => ({
    localId: group.id,
    name: group.name,
    key: group.key,
    bomSlotKey: group.bomSlotKey ?? "",
    values: group.values.map((value) => ({
      localId: value.id,
      label: value.label,
      code: value.code,
      componentResourceId: value.componentResourceId ?? "",
      isDefault: value.isDefault,
    })),
  }));

export function ResourceOptionGroupsManager({
  resourceId,
  canEdit,
  canCreate,
  embedded = false,
}: {
  resourceId: string;
  canEdit: boolean;
  canCreate: boolean;
  embedded?: boolean;
}) {
  const { t, i18n } = useT("inventory");
  const locale = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [options, setOptions] = useState<ResourceOptionsResponse | null>(null);
  const [draft, setDraft] = useState<DraftGroup[]>([]);
  const [resources, setResources] = useState<ClientResource[]>([]);
  const [expanded, setExpanded] = useState(embedded);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingResources, setLoadingResources] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await fetchJson<ResourceOptionsResponse>(
        `/api/v1/resources/${resourceId}/options`,
        { cache: "no-store" },
      );
      setOptions(loaded);
      setDraft(draftFromResponse(loaded));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("options.errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [resourceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const beginEditing = async () => {
    if (!options) return;
    setExpanded(true);
    setEditing(true);
    setError(null);
    setNotice(null);
    setDraft(options.groups.length ? draftFromResponse(options) : [emptyGroup()]);
    if (!resources.length) {
      setLoadingResources(true);
      try {
        setResources(
          (await loadEveryResource()).filter(
            (resource) => resource.id !== options.primary.id,
          ),
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("options.errors.resources"),
        );
      } finally {
        setLoadingResources(false);
      }
    }
  };

  const draftCombinationCount = useMemo(
    () =>
      draft.length
        ? draft.reduce((total, group) => total * group.values.length, 1)
        : 0,
    [draft],
  );

  const patchGroup = (groupId: string, patch: Partial<DraftGroup>) =>
    setDraft((current) =>
      current.map((group) =>
        group.localId === groupId ? { ...group, ...patch } : group,
      ),
    );

  const patchValue = (
    groupId: string,
    valueId: string,
    patch: Partial<DraftValue>,
  ) =>
    setDraft((current) =>
      current.map((group) => {
        if (group.localId !== groupId) return group;
        return {
          ...group,
          values: group.values.map((value) =>
            value.localId === valueId ? { ...value, ...patch } : value,
          ),
        };
      }),
    );

  const selectDefault = (groupId: string, valueId: string) =>
    setDraft((current) =>
      current.map((group) => {
        if (group.localId !== groupId) return group;
        const slot = options?.bomSlots.find(
          (candidate) => candidate.slotKey === group.bomSlotKey,
        );
        return {
          ...group,
          values: group.values.map((value) => ({
            ...value,
            isDefault: value.localId === valueId,
            componentResourceId:
              value.localId === valueId && slot
                ? slot.componentResourceId
                : value.componentResourceId,
          })),
        };
      }),
    );

  const selectSlot = (groupId: string, slotKey: string) => {
    const slot = options?.bomSlots.find((candidate) => candidate.slotKey === slotKey);
    const defaultResource = resources.find(
      (resource) => resource.id === slot?.componentResourceId,
    );
    setDraft((current) =>
      current.map((group) =>
        group.localId === groupId
          ? {
              ...group,
              bomSlotKey: slotKey,
              values: group.values.map((value) => ({
                ...value,
                componentResourceId: slotKey
                  ? value.isDefault
                    ? slot?.componentResourceId ?? ""
                    : value.componentResourceId
                  : "",
                label:
                  slotKey && value.isDefault
                    ? value.label || slot?.componentName || ""
                    : value.label,
                code:
                  slotKey && value.isDefault
                    ? value.code ||
                      codeFromLabel(defaultResource?.sku || slot?.componentName || "")
                    : value.code,
              })),
            }
          : group,
      ),
    );
  };

  const save = async () => {
    setError(null);
    setNotice(null);
    const completedDraft = draft.map((group) => ({
      ...group,
      values: group.values.map((value) => {
        const component = resources.find(
          (resource) => resource.id === value.componentResourceId,
        );
        return {
          ...value,
          label: value.label || component?.name || "",
          code:
            value.code ||
            codeFromLabel(component?.sku || component?.name || ""),
        };
      }),
    }));
    setDraft(completedDraft);
    const validationError = validateDraft(completedDraft, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      const saved = await fetchJson<ResourceOptionsResponse>(
        `/api/v1/resources/${resourceId}/options`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groups: completedDraft.map((group, groupPosition) => ({
              key: group.key,
              name: group.name,
              bomSlotKey: group.bomSlotKey || null,
              position: groupPosition,
              values: group.values.map((value, valuePosition) => ({
                label: value.label,
                code: value.code,
                componentResourceId: value.componentResourceId || null,
                isDefault: value.isDefault,
                position: valuePosition,
              })),
            })),
          }),
        },
      );
      setOptions(saved);
      setDraft(draftFromResponse(saved));
      setEditing(false);
      setNotice(t("options.notices.saved"));
      window.dispatchEvent(new Event("resource-family-changed"));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t("options.errors.save"),
      );
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (!options) return;
    const count = Math.max(0, options.combinationCount - 1);
    if (
      !window.confirm(
        t("options.generate.confirm", {
          count,
          value: number.format(count),
        }),
      )
    ) {
      return;
    }
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fetchJson<{ generatedVariantCount: number }>(
        `/api/v1/resources/${resourceId}/options`,
        { method: "POST" },
      );
      setNotice(
        t("options.notices.generated", {
          count: result.generatedVariantCount,
          value: number.format(result.generatedVariantCount),
        }),
      );
      await load();
      setExpanded(true);
      window.dispatchEvent(new Event("resource-family-changed"));
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : t("options.errors.generate"),
      );
    } finally {
      setGenerating(false);
    }
  };

  if (
    !embedded &&
    !loading &&
    !error &&
    options &&
    !options.groups.length &&
    !canEdit
  ) {
    return null;
  }

  return (
    <OptionGroupsManagerShell embedded={embedded}>
      <OptionGroupsHeader
        options={options}
        number={number}
        expanded={expanded}
        collapsible={!embedded}
        onToggle={() => setExpanded((current) => !current)}
      />

        {expanded ? (
          <div className="border-t border-border">
            {error ? (
              <div className="flex items-start justify-between gap-4 border-b border-danger-border bg-danger-soft px-5 py-3 text-xs text-danger sm:px-6">
                <span>{error}</span>
                <button type="button" onClick={() => setError(null)} aria-label={t("options.actions.dismissError")}>
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {notice ? (
              <div className="border-b border-success-border bg-success-soft px-5 py-3 text-xs text-success sm:px-6">
                {notice}
              </div>
            ) : null}
            {loading ? (
              <div className="space-y-2 p-5" aria-label={t("options.loading")}>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : options ? (
              <>
                {options.role === "variant" ? (
                  <div className="px-5 py-4 text-xs text-muted sm:px-6">
                    <Link href={`/inventory/${options.primary.id}`} className="font-semibold text-brand hover:underline">
                      {t("options.actions.openPrimary", { name: options.primary.name })}
                    </Link>
                    <p className="mt-1 leading-5">{t("options.variantHelp")}</p>
                  </div>
                ) : editing ? (
                  <OptionEditor
                    draft={draft}
                    options={options}
                    resources={resources}
                    loadingResources={loadingResources}
                    combinationCount={draftCombinationCount}
                    patchGroup={patchGroup}
                    patchValue={patchValue}
                    selectDefault={selectDefault}
                    selectSlot={selectSlot}
                    setDraft={setDraft}
                  />
                ) : options.groups.length ? (
                  <OptionSummary options={options} />
                ) : (
                  <div className="px-5 py-5 text-xs text-muted sm:px-6">
                    <p className="font-semibold text-foreground">{t("options.empty.title")}</p>
                    <p className="mt-1 max-w-3xl leading-5">{t("options.empty.description")}</p>
                  </div>
                )}

                {options.role === "primary" ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-subtle px-5 py-3 sm:px-6">
                    <p className="text-[13px] text-muted">
                      {options.groups.length
                        ? t("options.combinations", {
                            count: editing ? draftCombinationCount : options.combinationCount,
                            value: number.format(editing ? draftCombinationCount : options.combinationCount),
                          })
                        : t("options.defaultHint")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {editing ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => {
                              setEditing(false);
                              setDraft(draftFromResponse(options));
                            }}
                          >
                            {t("options.actions.cancel")}
                          </Button>
                          <Button size="sm" disabled={saving || loadingResources} onClick={() => void save()}>
                            {saving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                            {saving ? t("options.actions.saving") : t("options.actions.save")}
                          </Button>
                        </>
                      ) : (
                        <>
                          {canEdit && !options.definitionsLocked && options.familyVariantCount === 0 ? (
                            <Button size="sm" variant="secondary" onClick={() => void beginEditing()}>
                              {options.groups.length ? t("options.actions.edit") : t("options.actions.configure")}
                            </Button>
                          ) : null}
                          {canEdit && canCreate && options.groups.length && !options.definitionsLocked ? (
                            <Button size="sm" disabled={generating} onClick={() => void generate()}>
                              {generating ? (
                                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Sparkles className="size-3.5" aria-hidden="true" />
                              )}
                              {generating ? t("options.actions.generating") : t("options.actions.generate")}
                            </Button>
                          ) : null}
                          {options.definitionsLocked ? <Badge tone="success">{t("options.locked")}</Badge> : null}
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
    </OptionGroupsManagerShell>
  );
}

function OptionGroupsManagerShell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: React.ReactNode;
}) {
  if (embedded) return <div className="min-w-0">{children}</div>;
  return (
    <section className="mx-auto w-full max-w-[1450px] px-4 pb-6 sm:px-6 lg:px-8">
      <Card className="overflow-hidden shadow-[var(--shadow-sm)]">
        {children}
      </Card>
    </section>
  );
}

function OptionGroupsHeader({
  options,
  number,
  expanded,
  collapsible,
  onToggle,
}: {
  options: ResourceOptionsResponse | null;
  number: Intl.NumberFormat;
  expanded: boolean;
  collapsible: boolean;
  onToggle: () => void;
}) {
  const { t } = useT("inventory");
  const content = (
    <>
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <Layers3 className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">
            {t("options.title")}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted">
            {options?.role === "variant"
              ? t("options.variantDescription", { name: options.primary.name })
              : t("options.description")}
          </span>
          {options?.currentSelection.length ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {options.currentSelection.map((selection) => (
                <Badge key={selection.groupId} tone="brand">
                  {selection.groupName}: {selection.valueLabel}
                </Badge>
              ))}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {options?.groups.length ? (
          <Badge>
            {t("options.groupCount", {
              count: options.groups.length,
              value: number.format(options.groups.length),
            })}
          </Badge>
        ) : null}
        {collapsible ? (
          <ChevronDown
            className={cn(
              "size-4 text-muted transition",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        ) : null}
      </span>
    </>
  );
  const className =
    "flex w-full items-start justify-between gap-4 px-5 py-4 text-left sm:px-6";

  if (!collapsible) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={className}
      aria-expanded={expanded}
    >
      {content}
    </button>
  );
}

function OptionSummary({ options }: { options: ResourceOptionsResponse }) {
  const { t } = useT("inventory");
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
      {options.groups.map((group) => (
        <div key={group.id} className="rounded-xl border border-border bg-surface-subtle p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">{group.name}</p>
            {group.bomSlotKey ? (
              <Badge tone="brand"><Link2 className="mr-1 size-3" aria-hidden="true" />{t("options.bomMapped")}</Badge>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {group.values.map((value) => (
              <Badge key={value.id} tone={value.isDefault ? "success" : "neutral"}>
                {value.label}{value.isDefault ? ` · ${t("options.default")}` : ""}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function OptionEditor({
  draft,
  options,
  resources,
  loadingResources,
  combinationCount,
  patchGroup,
  patchValue,
  selectDefault,
  selectSlot,
  setDraft,
}: {
  draft: DraftGroup[];
  options: ResourceOptionsResponse;
  resources: ClientResource[];
  loadingResources: boolean;
  combinationCount: number;
  patchGroup: (id: string, patch: Partial<DraftGroup>) => void;
  patchValue: (groupId: string, valueId: string, patch: Partial<DraftValue>) => void;
  selectDefault: (groupId: string, valueId: string) => void;
  selectSlot: (groupId: string, slotKey: string) => void;
  setDraft: React.Dispatch<React.SetStateAction<DraftGroup[]>>;
}) {
  const { t } = useT("inventory");
  const sortedResources = useMemo(
    () => [...resources].sort((left, right) => left.name.localeCompare(right.name)),
    [resources],
  );
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="rounded-xl border border-brand-border bg-brand-soft/35 px-4 py-3 text-[13px] leading-5 text-muted-strong">
        {t("options.editor.help")}
      </div>
      {draft.map((group, groupIndex) => (
        <div key={group.localId} className="rounded-xl border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_0.8fr_1.2fr_auto] lg:items-end">
            <label className={labelClass}>
              {t("options.fields.groupName")}
              <input
                className={inputClass}
                value={group.name}
                placeholder={t("options.editor.groupPlaceholder")}
                onChange={(event) => {
                  const name = event.target.value;
                  patchGroup(group.localId, {
                    name,
                    key: group.key ? group.key : keyFromName(name),
                  });
                }}
              />
            </label>
            <label className={labelClass}>
              {t("options.fields.key")}
              <input className={inputClass} value={group.key} onChange={(event) => patchGroup(group.localId, { key: keyFromName(event.target.value) })} />
            </label>
            <label className={labelClass}>
              {t("options.fields.bomSlot")}
              <select className={inputClass} value={group.bomSlotKey} onChange={(event) => selectSlot(group.localId, event.target.value)}>
                <option value="">{t("options.editor.noBomSlot")}</option>
                {options.bomSlots.map((slot) => (
                  <option key={slot.slotKey} value={slot.slotKey}>{slot.componentName}</option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDraft((current) => current.filter((candidate) => candidate.localId !== group.localId))}
              aria-label={t("options.actions.removeGroup", { name: group.name || groupIndex + 1 })}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {group.values.map((value, valueIndex) => (
              <div key={value.localId} className="grid gap-2 rounded-lg bg-surface-subtle p-2 sm:grid-cols-[auto_1fr_0.65fr_1.25fr_auto] sm:items-center">
                <label className="flex items-center gap-2 text-[13px] font-medium text-muted-strong">
                  <input type="radio" name={`default-${group.localId}`} checked={value.isDefault} onChange={() => selectDefault(group.localId, value.localId)} />
                  {t("options.default")}
                </label>
                <input
                  className={inputClass}
                  value={value.label}
                  placeholder={t("options.editor.valuePlaceholder")}
                  onChange={(event) => {
                    const label = event.target.value;
                    patchValue(group.localId, value.localId, {
                      label,
                      code: value.code ? value.code : codeFromLabel(label),
                    });
                  }}
                  aria-label={t("options.fields.valueLabel", { index: valueIndex + 1 })}
                />
                <input
                  className={inputClass}
                  value={value.code}
                  placeholder={t("options.fields.code")}
                  onChange={(event) => patchValue(group.localId, value.localId, { code: codeFromLabel(event.target.value) })}
                  aria-label={t("options.fields.code")}
                />
                {group.bomSlotKey ? (
                  <select
                    className={inputClass}
                    value={value.componentResourceId}
                    disabled={loadingResources || value.isDefault}
                    onChange={(event) => {
                      const componentResourceId = event.target.value;
                      const component = sortedResources.find(
                        (resource) => resource.id === componentResourceId,
                      );
                      patchValue(group.localId, value.localId, {
                        componentResourceId,
                        label: value.label || component?.name || "",
                        code:
                          value.code ||
                          codeFromLabel(component?.sku || component?.name || ""),
                      });
                    }}
                    aria-label={t("options.fields.component")}
                  >
                    <option value="">{loadingResources ? t("options.editor.loadingComponents") : t("options.editor.selectComponent")}</option>
                    {sortedResources.map((resource) => (
                      <option key={resource.id} value={resource.id}>{resource.name}{resource.sku ? ` · ${resource.sku}` : ""}</option>
                    ))}
                  </select>
                ) : (
                  <span className="px-2 text-[13px] text-muted">{t("options.editor.catalogOnly")}</span>
                )}
                <button
                  type="button"
                  disabled={group.values.length <= 2}
                  onClick={() => {
                    const remaining = group.values.filter(
                      (candidate) => candidate.localId !== value.localId,
                    );
                    patchGroup(group.localId, {
                      values:
                        value.isDefault && remaining.length
                          ? remaining.map((candidate, index) => ({
                              ...candidate,
                              isDefault: index === 0,
                            }))
                          : remaining,
                    });
                  }}
                  className="grid size-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30"
                  aria-label={t("options.actions.removeValue", { label: value.label || valueIndex + 1 })}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={
              group.values.length >= 8 ||
              (combinationCount / group.values.length) *
                (group.values.length + 1) >
                100
            }
            onClick={() => patchGroup(group.localId, { values: [...group.values, emptyValue(false)] })}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("options.actions.addValue")}
          </Button>
        </div>
      ))}
      <Button size="sm" variant="secondary" disabled={draft.length >= 4 || combinationCount * 2 > 100} onClick={() => setDraft((current) => [...current, emptyGroup()])}>
        <Plus className="size-3.5" aria-hidden="true" />
        {t("options.actions.addGroup")}
      </Button>
    </div>
  );
}
