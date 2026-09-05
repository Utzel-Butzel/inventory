"use client";

import { CollectionViewToolbar, ListViewResults, useCollectionView } from "@/components/list-view";


import {
  OrganizationLink as Link,
  useOrganizationHref,
} from "@/components/organization-routing";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Eye,
  LoaderCircle,
  Lock,
  Plus,
  QrCode,
  Save,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react";
import { useT } from "next-i18next/client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";

import { WorkflowActionsStep } from "./stock-workflow/actions-step";
import {
  draftToPayload,
  payloadSignature,
  templateDraft,
  workflowToDraft,
} from "./stock-workflow/draft";
import { WorkflowExtractionStep } from "./stock-workflow/extraction-step";
import {
  NoticeBanner,
  Toggle,
  inputClass,
  labelClass,
  textAreaClass,
} from "./stock-workflow/fields";
import { WorkflowInputsStep } from "./stock-workflow/inputs-step";
import { WorkflowPreview } from "./stock-workflow/preview";
import {
  stockItemsFromResponse,
  stockUnitCustomFieldsFromResponse,
  workflowFromResponse,
  workflowsFromResponse,
} from "./stock-workflow/responses";
import { WorkflowTargetStep } from "./stock-workflow/target-step";
import { WorkflowTriggerStep } from "./stock-workflow/trigger-step";
import type {
  Notice,
  StockItem,
  StockUnitCustomField,
  WorkflowDraft,
  WorkflowRecord,
} from "./stock-workflow/types";
import { useWorkflowSample } from "./stock-workflow/use-workflow-sample";
import { validateDraft } from "./stock-workflow/validation";

type StockWorkflowBuilderProps = {
  canManage: boolean;
  view?: "list" | "editor";
  workflowId?: string | null;
};

export function StockWorkflowBuilder({
  canManage,
  view = "list",
  workflowId = null,
}: StockWorkflowBuilderProps) {
  const { t, i18n } = useT("scanner");
  const router = useRouter();
  const organizationHref = useOrganizationHref();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const firstDraft = useMemo(() => templateDraft(t), [t]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const collection = useCollectionView("settings.action-flows", workflows, {
    search: (item) => [item.name, item.description].join(" "),
    sorts: [{ value: "name", label: t("common:listView.fields.name"), get: (item) => item.name }],
    filters: [{ key: "status", label: t("common:listView.fields.status"), get: (item) => item.enabled ? "active" : "inactive", options: [{ value: "active", label: t("common:listView.active") }, { value: "inactive", label: t("common:listView.inactive") }] }],
  });
  const [resources, setResources] = useState<StockItem[]>([]);
  const [stockUnitCustomFields, setStockUnitCustomFields] = useState<StockUnitCustomField[]>([]);
  const [draft, setDraft] = useState<WorkflowDraft>(firstDraft);
  const [baseSignature, setBaseSignature] = useState(() => payloadSignature(firstDraft));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rotatingPublicUrl, setRotatingPublicUrl] = useState(false);
  const [copiedPublicUrl, setCopiedPublicUrl] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const sample = useWorkflowSample(setDraft, t);
  const [previewInputs, setPreviewInputs] = useState<Record<string, string>>({});
  const [targetQuery, setTargetQuery] = useState("");

  const applyWorkflow = useCallback((workflow: WorkflowRecord) => {
    const nextDraft = workflowToDraft(workflow);
    setDraft(nextDraft);
    setBaseSignature(payloadSignature(nextDraft));
    setConfirmDelete(false);
  }, []);

  const loadData = useCallback(
    async () => {
      setLoading(true);
      setNotice(null);
      try {
        const [workflowPayload, stockPayload, customFieldPayload] = await Promise.all([
          fetchJson<unknown>("/api/v1/stock/scan-workflows", { cache: "no-store" }),
          fetchJson<unknown>("/api/v1/stock", { cache: "no-store" }),
          fetchJson<unknown>("/api/v1/custom-fields?entityType=stock_unit", {
            cache: "no-store",
          }).catch(() => ({ definitions: [] })),
        ]);
        const nextWorkflows = workflowsFromResponse(workflowPayload);
        const nextResources = stockItemsFromResponse(stockPayload);
        setWorkflows(nextWorkflows);
        setResources(nextResources);
        setStockUnitCustomFields(
          stockUnitCustomFieldsFromResponse(customFieldPayload),
        );

        if (view === "editor" && workflowId) {
          const nextSelection = nextWorkflows.find(
            (workflow) => workflow.id === workflowId,
          );
          if (nextSelection) {
            applyWorkflow(nextSelection);
          } else {
            const nextDraft = templateDraft(t, nextResources[0]?.resourceId ?? "");
            setDraft(nextDraft);
            setBaseSignature(payloadSignature(nextDraft));
            setNotice({ tone: "error", message: t("workflows.errors.notFound") });
          }
        } else if (view === "editor") {
          const nextDraft = templateDraft(t, nextResources[0]?.resourceId ?? "");
          setDraft(nextDraft);
          setBaseSignature(payloadSignature(nextDraft));
        }
      } catch {
        setNotice({
          tone: "error",
          message: t("workflows.errors.load"),
        });
      } finally {
        setLoading(false);
      }
    },
    [applyWorkflow, t, view, workflowId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPreviewInputs((current) => {
      const next: Record<string, string> = {};
      for (const field of draft.inputFields) {
        const stillValid = field.options.some((option) => option.value === current[field.uid]);
        next[field.uid] = stillValid ? current[field.uid]! : field.options[0]?.value ?? "";
      }
      return next;
    });
  }, [draft.inputFields]);

  const dirty = payloadSignature(draft) !== baseSignature;
  const interactionBusy = saving || deleting || rotatingPublicUrl;
  const editable = canManage && !interactionBusy;
  const savedWorkflow = draft.id
    ? workflows.find((workflow) => workflow.id === draft.id) ?? null
    : null;
  const selectedResources = draft.resourceIds.flatMap((resourceId) => {
    const resource = resources.find((item) => item.resourceId === resourceId);
    return resource ? [resource] : [];
  });
  const publicTriggerPath = draft.publicTriggerId
    ? `/share/action/${draft.publicTriggerId}`
    : null;
  const publicTriggerLive = Boolean(
    savedWorkflow?.publicTriggerEnabled &&
    savedWorkflow.publicTriggerId === draft.publicTriggerId,
  );

  useEffect(() => {
    if (view !== "editor" || !dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, view]);

  const confirmDraftDiscard = () =>
    !dirty ||
    window.confirm(
      t("workflows.confirmDiscard"),
    );

  const persistDraft = async (
    nextDraft: WorkflowDraft,
    message: string,
  ): Promise<WorkflowRecord | null> => {
    const validationError = validateDraft(nextDraft, t);
    if (validationError) {
      setNotice({ tone: "error", message: validationError });
      return null;
    }
    if (!canManage) {
      setNotice({ tone: "error", message: t("workflows.notices.viewerReadOnly") });
      return null;
    }

    setSaving(true);
    setNotice(null);
    try {
      const payload = draftToPayload(nextDraft);
      const endpoint = nextDraft.id
        ? `/api/v1/stock/scan-workflows/${nextDraft.id}`
        : "/api/v1/stock/scan-workflows";
      const response = await fetchJson<unknown>(endpoint, {
        method: nextDraft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = workflowFromResponse(response);
      if (!saved) throw new Error(t("workflows.errors.unexpected"));
      setWorkflows((current) => {
        const exists = current.some((workflow) => workflow.id === saved.id);
        const next = exists
          ? current.map((workflow) => (workflow.id === saved.id ? saved : workflow))
          : [...current, saved];
        return next.sort((left, right) => left.name.localeCompare(right.name, locale));
      });
      const created = nextDraft.id === null;
      applyWorkflow(saved);
      setNotice({ tone: "success", message });
      if (created) {
        router.replace(
          organizationHref(`/settings/action-flows/${saved.id}`),
        );
      }
      return saved;
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("workflows.errors.save"),
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () =>
    void persistDraft(
      draft,
      t(draft.id ? "workflows.notices.updated" : "workflows.notices.created"),
    );

  const toggleSavedWorkflow = async () => {
    if (!savedWorkflow || !canManage || interactionBusy) return;
    const enabled = !savedWorkflow.enabled;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetchJson<unknown>(
        `/api/v1/stock/scan-workflows/${savedWorkflow.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: savedWorkflow.revision,
            enabled,
          }),
        },
      );
      const saved = workflowFromResponse(response);
      if (!saved) throw new Error(t("workflows.errors.unexpected"));
      setWorkflows((current) =>
        current.map((workflow) => (workflow.id === saved.id ? saved : workflow)),
      );
      setDraft((current) =>
        current.id === saved.id
          ? {
            ...current,
            revision: saved.revision,
            enabled: saved.enabled,
          }
          : current,
      );
      setBaseSignature(payloadSignature(workflowToDraft(saved)));
      setNotice({
        tone: "success",
        message: t(saved.enabled ? "workflows.notices.enabled" : "workflows.notices.paused"),
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("workflows.errors.update"),
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!savedWorkflow || !canManage || interactionBusy) return;
    setDeleting(true);
    setNotice(null);
    try {
      await fetchJson<unknown>(
        `/api/v1/stock/scan-workflows/${savedWorkflow.id}?revision=${encodeURIComponent(String(savedWorkflow.revision))}`,
        { method: "DELETE" },
      );
      const remaining = workflows.filter((workflow) => workflow.id !== savedWorkflow.id);
      setWorkflows(remaining);
      router.replace(organizationHref("/settings/action-flows"));
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : t("workflows.errors.delete"),
      });
    } finally {
      setDeleting(false);
    }
  };

  const copyPublicTriggerUrl = async () => {
    if (!publicTriggerPath) return;
    try {
      await navigator.clipboard.writeText(
        new URL(publicTriggerPath, window.location.origin).toString(),
      );
      setCopiedPublicUrl(true);
      window.setTimeout(() => setCopiedPublicUrl(false), 2_000);
    } catch {
      setNotice({ tone: "error", message: t("workflows.publicTrigger.copyError") });
    }
  };

  const rotatePublicTriggerUrl = async () => {
    if (!draft.id || !draft.revision || dirty || interactionBusy) return;
    if (!window.confirm(t("workflows.publicTrigger.rotateConfirm"))) return;
    setRotatingPublicUrl(true);
    setNotice(null);
    try {
      const response = await fetchJson<unknown>(
        `/api/v1/stock/scan-workflows/${draft.id}/public-trigger/rotate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: draft.revision }),
        },
      );
      const saved = workflowFromResponse(response);
      if (!saved) throw new Error(t("workflows.errors.unexpected"));
      setWorkflows((current) =>
        current.map((workflow) => (workflow.id === saved.id ? saved : workflow)),
      );
      applyWorkflow(saved);
      setNotice({ tone: "success", message: t("workflows.publicTrigger.rotated") });
    } catch (rotateError) {
      setNotice({
        tone: "error",
        message:
          rotateError instanceof Error
            ? rotateError.message
            : t("workflows.publicTrigger.rotateError"),
      });
    } finally {
      setRotatingPublicUrl(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-9 w-72 max-w-full" />
            <Skeleton className="mt-3 h-4 w-[520px] max-w-full" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton
          className={cn(
            "rounded-2xl",
            view === "list" ? "h-[480px]" : "h-[780px]",
          )}
        />
      </div>
    );
  }

  if (view === "list") {
    return (
      <div>
        <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.13em] text-muted">
              <Workflow className="size-3.5 text-brand" aria-hidden="true" />
              {t("workflows.header.eyebrow")}
            </div>
            <h1 className="text-[29px] font-semibold tracking-[-0.04em] text-foreground sm:text-[33px]">
              {t("workflows.header.title")}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
              {t("workflows.header.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!canManage ? (
              <Badge tone="neutral" className="h-9 gap-1.5 px-3">
                <Lock className="size-3.5" aria-hidden="true" />
                {t("workflows.header.readOnly")}
              </Badge>
            ) : (
              <Link
                href="/settings/action-flows/new"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-transparent bg-brand-solid px-4 text-sm font-semibold text-on-brand shadow-sm transition duration-150 hover:bg-brand-hover active:bg-brand-active"
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("workflows.header.newTemplate")}
              </Link>
            )}
          </div>
        </div>

        {notice ? <NoticeBanner notice={notice} /> : null}

        <CollectionViewToolbar collection={collection} />
        <ListViewResults list={collection.list}>
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">
                {t("workflows.sidebar.title")}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">
                {t("workflows.sidebar.configured", {
                  count: workflows.length,
                  value: integer.format(workflows.length),
                })}
              </p>
            </div>
          </div>

          {workflows.length ? (
            <div className="divide-y divide-border">
              {collection.visibleItems.map((workflow) => {
                const resource = resources.find(
                  (item) => item.resourceId === workflow.resourceId,
                );
                return (
                  <Link
                    data-list-row
                    key={workflow.id}
                    href={`/settings/action-flows/${workflow.id}`}
                    className="group flex items-center gap-3 px-4 py-4 transition hover:bg-surface-hover sm:gap-4 sm:px-5"
                  >
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-xl",
                        workflow.enabled
                          ? "bg-success-soft text-success"
                          : "bg-surface-muted text-muted",
                      )}
                    >
                      <QrCode className="size-[18px]" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14px] font-semibold text-foreground sm:text-sm">
                          {workflow.name}
                        </span>
                        <Badge tone={workflow.enabled ? "success" : "neutral"}>
                          {t(
                            workflow.enabled
                              ? "workflows.editor.enabled"
                              : "workflows.editor.paused",
                          )}
                        </Badge>
                      </span>
                      {workflow.description ? (
                        <span className="mt-1 block truncate text-[12px] text-muted">
                          {workflow.description}
                        </span>
                      ) : null}
                      <span className="mt-1 block truncate text-[11px] text-muted">
                        {t("workflows.sidebar.resourceRevision", {
                          resource:
                            resource?.name ??
                            t("workflows.fallbacks.resourceUnavailable"),
                          revision: integer.format(workflow.revision),
                        })}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-muted-strong transition group-hover:text-brand">
                      <span className="hidden sm:inline">
                        {t("workflows.sidebar.edit")}
                      </span>
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              className="min-h-72 py-10"
              icon={<Workflow className="size-5" aria-hidden="true" />}
              title={t("workflows.sidebar.emptyTitle")}
              description={
                canManage
                  ? t("workflows.sidebar.emptyManager")
                  : t("workflows.sidebar.emptyViewer")
              }
              action={
                canManage ? (
                  <Link
                    href="/settings/action-flows/new"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-brand-solid px-3 text-[14px] font-medium text-on-brand shadow-sm transition hover:bg-brand-hover"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t("workflows.header.newTemplate")}
                  </Link>
                ) : undefined
              }
            />
          )}

          <div className="border-t border-border bg-surface-subtle px-4 py-3 text-[11px] leading-4 text-muted sm:px-5">
            <span className="inline-flex items-center gap-1.5 font-medium text-muted">
              <ShieldCheck className="size-3.5 text-brand" aria-hidden="true" />
              {t("workflows.sidebar.safeTitle")}
            </span>
            <p className="mt-1">{t("workflows.sidebar.safeDescription")}</p>
          </div>
        </Card>
        </ListViewResults>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/settings/action-flows"
        onClick={(event) => {
          if (!confirmDraftDiscard()) event.preventDefault();
        }}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-strong transition hover:text-brand"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t("workflows.editor.backToList")}
      </Link>

      <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.13em] text-muted">
            <Workflow className="size-3.5 text-brand" aria-hidden="true" />
            {t("workflows.header.eyebrow")}
          </div>
          <h1 className="text-[29px] font-semibold tracking-[-0.04em] text-foreground sm:text-[33px]">
            {t("workflows.header.title")}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            {t("workflows.header.description")}
          </p>
        </div>
        {!canManage ? (
          <Badge tone="neutral" className="h-9 gap-1.5 px-3">
            <Lock className="size-3.5" aria-hidden="true" />
            {t("workflows.header.readOnly")}
          </Badge>
        ) : null}
      </div>

      {notice ? <NoticeBanner notice={notice} /> : null}

      {workflowId && !draft.id ? (
        <Card>
          <EmptyState
            className="min-h-72 py-10"
            icon={<AlertCircle className="size-5" aria-hidden="true" />}
            title={t("workflows.errors.notFoundTitle")}
            description={t("workflows.errors.notFound")}
            action={
              <Link
                href="/settings/action-flows"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[14px] font-medium text-foreground shadow-sm transition hover:bg-surface-subtle"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                {t("workflows.editor.backToList")}
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="min-w-0">
          <Card className="mb-4 overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[16px] font-semibold text-foreground">
                    {draft.id
                      ? draft.name || t("workflows.fallbacks.untitled")
                      : t("workflows.editor.newWorkflow")}
                  </h2>
                  <Badge tone={draft.enabled ? "success" : "neutral"}>
                    {t(draft.enabled ? "workflows.editor.enabled" : "workflows.editor.paused")}
                  </Badge>
                  {dirty ? <Badge tone="warning">{t("workflows.editor.unsaved")}</Badge> : null}
                  {!draft.id ? <Badge tone="brand">{t("workflows.editor.template")}</Badge> : null}
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  {draft.id
                    ? t("workflows.editor.revision", {
                      value: integer.format(draft.revision ?? 1),
                    })
                    : t("workflows.editor.basedOnTemplate")}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap items-center gap-2">
                  {draft.id ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void toggleSavedWorkflow()}
                      disabled={interactionBusy || !savedWorkflow}
                    >
                      {t(savedWorkflow?.enabled ? "workflows.editor.pause" : "workflows.editor.enable")}
                    </Button>
                  ) : null}
                  {draft.id ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmDelete(true)}
                      disabled={interactionBusy || !savedWorkflow}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      {t("workflows.editor.delete")}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={saveDraft}
                    disabled={interactionBusy || (Boolean(draft.id) && !dirty)}
                  >
                    {saving ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="size-3.5" aria-hidden="true" />
                    )}
                    {t(
                      saving
                        ? "workflows.editor.saving"
                        : draft.id
                          ? "workflows.editor.update"
                          : "workflows.editor.save",
                    )}
                  </Button>
                </div>
              ) : null}
            </div>

            {confirmDelete && savedWorkflow ? (
              <div className="flex flex-col gap-3 border-b border-danger-border bg-danger-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                  <p className="text-[13px] leading-5 text-danger">
                    {t("workflows.editor.confirmDelete", { name: savedWorkflow.name })}
                  </p>
                </div>
                <div className="flex gap-2 self-end sm:self-auto">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} disabled={interactionBusy}>
                    {t("workflows.editor.cancel")}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void deleteWorkflow()} disabled={interactionBusy}>
                    {deleting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                    {t(deleting ? "workflows.editor.deleting" : "workflows.editor.deleteWorkflow")}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <label className={labelClass}>
                {t("workflows.editor.name")}
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className={inputClass}
                  placeholder={t("workflows.editor.namePlaceholder")}
                  disabled={!editable}
                />
              </label>
              <div className="rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[12px] font-semibold text-muted-strong">{t("workflows.editor.enabledLabel")}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted">{t("workflows.editor.enabledDescription")}</p>
                  </div>
                  <Toggle
                    checked={draft.enabled}
                    onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
                    disabled={!editable || Boolean(draft.id)}
                    label={t("workflows.editor.enabledLabel")}
                  />
                </div>
              </div>
              <label className={cn(labelClass, "sm:col-span-2")}>
                {t("workflows.editor.description")}
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className={textAreaClass}
                  placeholder={t("workflows.editor.descriptionPlaceholder")}
                  disabled={!editable}
                />
              </label>
            </div>
          </Card>

          {!canManage ? (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5 text-[13px] leading-5 text-muted shadow-[var(--shadow-sm)]">
              <Eye className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
              {t("workflows.editor.viewerDescription")}
            </div>
          ) : null}

          <div className="space-y-[18px] rounded-2xl border border-border bg-surface-subtle p-3 sm:p-5">
            <WorkflowTriggerStep
              draft={draft}
              setDraft={setDraft}
              editable={editable}
              t={t}
              integer={integer}
              sample={sample}
              publicTrigger={{
                path: publicTriggerPath,
                live: publicTriggerLive,
                copied: copiedPublicUrl,
                rotating: rotatingPublicUrl,
                dirty,
                copy: copyPublicTriggerUrl,
                rotate: rotatePublicTriggerUrl,
              }}
            />

            <WorkflowExtractionStep
              draft={draft}
              setDraft={setDraft}
              editable={editable}
              t={t}
              integer={integer}
              stockUnitCustomFields={stockUnitCustomFields}
              sample={sample}
              interactionBusy={interactionBusy}
            />

            <WorkflowTargetStep
              draft={draft}
              setDraft={setDraft}
              editable={editable}
              t={t}
              integer={integer}
              resources={resources}
              selectedResources={selectedResources}
              locale={locale}
              targetQuery={targetQuery}
              setTargetQuery={setTargetQuery}
            />

            <WorkflowInputsStep
              draft={draft}
              setDraft={setDraft}
              editable={editable}
              canManage={canManage}
              t={t}
              integer={integer}
              stockUnitCustomFields={stockUnitCustomFields}
            />

            <WorkflowActionsStep
              draft={draft}
              setDraft={setDraft}
              editable={editable}
              canManage={canManage}
              t={t}
              integer={integer}
              stockUnitCustomFields={stockUnitCustomFields}
            />
          </div>

          <WorkflowPreview
            draft={draft}
            t={t}
            sample={sample}
            interactionBusy={interactionBusy}
            selectedResources={selectedResources}
            previewInputs={previewInputs}
            setPreviewInputs={setPreviewInputs}
          />
        </div>
      )}
    </div>
  );
}
