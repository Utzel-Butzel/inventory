"use client";

import {
  AlertTriangle,
  Check,
  Languages,
  LoaderCircle,
  RefreshCw,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { fetchJson } from "@/lib/client-types";
import {
  EstimatedAiCost,
  multipliedAiCost,
  useAiCostEstimateCatalog,
  type DisplayAiCost,
} from "@/components/ai-cost-estimate";

type TranslationFieldState =
  | "current"
  | "stale"
  | "missing"
  | "pending"
  | "processing"
  | "failed"
  | "needs_review";

type TranslationField = {
  fieldKey: string;
  label: string;
  sourceText: string;
  translatedText: string | null;
  suggestion: string | null;
  state: TranslationFieldState;
  origin: "ai" | "manual" | null;
  model: string | null;
  updatedAt: string | null;
};

type TranslationLanguage = {
  code: string;
  label: string;
  autoTranslate: boolean;
  revision: number;
  status:
    | "current"
    | "stale"
    | "missing"
    | "pending"
    | "processing"
    | "failed"
    | "needs_review";
  currentCount: number;
  totalCount: number;
  lastError: string | null;
  fields: TranslationField[];
};

type TranslationOverview = {
  resourceId: string;
  contentRevision: number;
  defaultLanguage: { code: string; label: string };
  languages: TranslationLanguage[];
};

type TranslationOperation =
  | { action: "set"; fieldKey: string; translatedText: string }
  | { action: "accept_suggestion"; fieldKey: string }
  | { action: "use_ai"; fieldKey: string };

function TranslationFieldEditor({
  field,
  language,
  sourceLanguageLabel,
  busy,
  estimatedCost,
  onOperation,
}: {
  field: TranslationField;
  language: TranslationLanguage;
  sourceLanguageLabel: string;
  busy: boolean;
  estimatedCost?: DisplayAiCost;
  onOperation: (operation: TranslationOperation) => Promise<void>;
}) {
  const { t } = useT("resource");
  const [draft, setDraft] = useState(field.translatedText ?? "");

  useEffect(() => {
    setDraft(field.translatedText ?? "");
  }, [field.translatedText]);

  const stateTone =
    field.state === "current"
      ? "text-success"
      : field.state === "failed"
        ? "text-danger"
        : field.state === "pending" || field.state === "processing"
          ? "text-brand"
          : "text-warning";

  return (
    <div className="grid gap-3 py-4 text-xs sm:grid-cols-[130px_minmax(0,1fr)]">
      <div>
        <p className="font-semibold text-muted-strong">{field.label}</p>
        <p className={`mt-1 text-[11px] font-semibold uppercase tracking-wide ${stateTone}`}>
          {t(`translations.status.${field.state}`)}
        </p>
        {field.origin === "manual" ? (
          <p className="mt-1 text-[11px] text-muted">{t("translations.humanLocked")}</p>
        ) : null}
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
            {sourceLanguageLabel}
          </p>
          <p className="max-h-32 overflow-auto whitespace-pre-wrap leading-5 text-muted">
            {field.sourceText || "—"}
          </p>
        </div>
        <div className="rounded-lg border border-brand-border bg-brand-soft/50 px-3 py-2.5">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-brand">
            {language.label}
          </label>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(6, Math.max(2, draft.split("\n").length))}
            className="w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-2 text-xs leading-5 text-foreground outline-none focus:border-focus focus:ring-2 focus:ring-focus/10"
            placeholder={t("translations.notTranslated")}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || draft === (field.translatedText ?? "")}
              onClick={() =>
                void onOperation({
                  action: "set",
                  fieldKey: field.fieldKey,
                  translatedText: draft,
                })
              }
              className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand-solid px-2.5 text-[11px] font-semibold text-on-brand disabled:opacity-40"
            >
              {busy ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
              {t("translations.actions.saveHuman")}
            </button>
            {field.origin === "manual" ? (
              <span className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void onOperation({
                      action: "use_ai",
                      fieldKey: field.fieldKey,
                    })
                  }
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-semibold text-muted-strong disabled:opacity-40"
                >
                  <Languages className="size-3" />
                  {t("translations.actions.useAi")}
                </button>
                <EstimatedAiCost estimate={estimatedCost} />
              </span>
            ) : null}
          </div>
          {field.suggestion !== null ? (
            <div className="mt-3 rounded-lg border border-warning-border bg-warning-soft px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-warning">
                {t("translations.suggestion")}
              </p>
              <p className="mt-1 whitespace-pre-wrap leading-5 text-muted-strong">
                {field.suggestion}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void onOperation({
                    action: "accept_suggestion",
                    fieldKey: field.fieldKey,
                  })
                }
                className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg border border-warning-border bg-surface px-2.5 text-[11px] font-semibold text-warning disabled:opacity-40"
              >
                <Check className="size-3" />
                {t("translations.actions.acceptSuggestion")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ResourceTranslations({
  resourceId,
  resourceUpdatedAt,
}: {
  resourceId: string;
  resourceUpdatedAt?: string;
}) {
  const { t } = useT("resource");
  const aiCostEstimates = useAiCostEstimateCatalog();
  const translationCostEstimate = aiCostEstimates?.operations.translation;
  const [overview, setOverview] = useState<TranslationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [translatingCode, setTranslatingCode] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      if (!quiet) setError(null);
      try {
        const response = await fetchJson<{ translations: TranslationOverview }>(
          `/api/v1/resources/${resourceId}/translations${resourceUpdatedAt ? `?revision=${encodeURIComponent(resourceUpdatedAt)}` : ""}`,
          { cache: "no-store" },
        );
        setOverview(response.translations);
      } catch (loadError) {
        if (!quiet) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("translations.errors.load"),
          );
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [resourceId, resourceUpdatedAt, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const hasActiveJobs = overview?.languages.some((language) =>
    ["pending", "processing"].includes(language.status),
  );
  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setTimeout(() => void load(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [hasActiveJobs, load, overview]);

  async function translate(languageCode?: string, force = false) {
    setTranslatingCode(languageCode ?? "all");
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<{
        result: { status: string; languageCodes: string[] };
        translations: TranslationOverview;
      }>(`/api/v1/resources/${resourceId}/translations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(languageCode ? { languageCodes: [languageCode] } : {}),
          force,
        }),
      });
      setOverview(response.translations);
      setNotice(
        response.result.status === "queued"
          ? t("translations.notices.queued")
          : t("translations.notices.current"),
      );
    } catch (translationError) {
      setError(
        translationError instanceof Error
          ? translationError.message
          : t("translations.errors.ai"),
      );
    } finally {
      setTranslatingCode(null);
    }
  }

  async function updateField(
    language: TranslationLanguage,
    operation: TranslationOperation,
  ) {
    const operationKey = `${language.code}:${operation.fieldKey}`;
    setSavingField(operationKey);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<{ translations: TranslationOverview }>(
        `/api/v1/resources/${resourceId}/translations/${encodeURIComponent(language.code)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: language.revision,
            operations: [operation],
          }),
        },
      );
      setOverview(response.translations);
      setNotice(
        operation.action === "use_ai"
          ? t("translations.notices.queued")
          : t("translations.notices.savedHuman"),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : t("translations.errors.save"),
      );
      if (updateError instanceof Error && updateError.message.includes("changed")) {
        await load(true);
      }
    } finally {
      setSavingField(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-6">
      <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand">
            <Languages size={17} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {t("translations.title")}
            </h2>
            <p className="text-xs text-muted">{t("translations.description")}</p>
          </div>
        </div>
        {overview?.languages.length ? (
          <div className="flex flex-col items-stretch gap-1 sm:items-end">
            <button
              type="button"
              onClick={() => void translate()}
              disabled={Boolean(translatingCode)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-soft px-3 text-xs font-semibold text-brand transition hover:bg-brand-soft disabled:opacity-50"
            >
              {translatingCode === "all" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Languages className="size-3.5" />
              )}
              {t("translations.actions.translateStale")}
            </button>
            <EstimatedAiCost
              estimate={multipliedAiCost(
                translationCostEstimate,
                overview.languages.length,
              )}
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-xs leading-5 text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-success-border bg-success-soft px-4 py-3 text-xs text-success">
          <Check className="size-4" /> {notice}
        </div>
      ) : null}

      {loading && !overview ? (
        <div className="grid min-h-24 place-items-center text-muted">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      ) : !overview?.languages.length ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-subtle px-5 py-7 text-center text-xs leading-5 text-muted">
          {t("translations.empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {overview.languages.map((language) => {
            const complete = language.status === "current";
            const failed = language.status === "failed";
            return (
              <details
                key={language.code}
                className="group rounded-xl border border-border bg-surface-subtle/60"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5">
                  <span className="rounded-lg bg-surface px-2 py-1 font-mono text-[12px] font-bold text-muted shadow-sm">
                    {language.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">
                      {language.label}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted">
                      {t("translations.progress", {
                        current: language.currentCount,
                        total: language.totalCount,
                      })}
                      {language.autoTranslate
                        ? t("translations.automaticSuffix")
                        : t("translations.manualSuffix")}
                    </span>
                    <EstimatedAiCost
                      estimate={translationCostEstimate}
                      className="mt-0.5"
                    />
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      complete
                        ? "bg-success-soft text-success"
                        : failed
                          ? "bg-danger-soft text-danger"
                          : language.status === "pending" ||
                              language.status === "processing"
                            ? "bg-brand-soft text-brand"
                            : "bg-warning-soft text-warning"
                    }`}
                  >
                    {t(`translations.status.${language.status}`)}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      void translate(language.code, complete || failed);
                    }}
                    disabled={Boolean(translatingCode)}
                    className="grid size-8 place-items-center rounded-lg border border-border bg-surface text-muted hover:text-brand disabled:opacity-40"
                    aria-label={t("translations.actions.regenerate", {
                      language: language.label,
                    })}
                  >
                    {translatingCode === language.code ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </button>
                </summary>
                <div className="border-t border-border px-4 py-3">
                  {language.lastError ? (
                    <div className="mb-2 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger">
                      {language.lastError}
                    </div>
                  ) : null}
                  <div className="divide-y divide-border">
                    {language.fields.map((field) => (
                      <TranslationFieldEditor
                        key={field.fieldKey}
                        field={field}
                        language={language}
                        sourceLanguageLabel={overview.defaultLanguage.label}
                        busy={savingField === `${language.code}:${field.fieldKey}`}
                        estimatedCost={translationCostEstimate}
                        onOperation={(operation) =>
                          updateField(language, operation)
                        }
                      />
                    ))}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
