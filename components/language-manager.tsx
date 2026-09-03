"use client";

import {
  Archive,
  Check,
  Languages,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";

import { Button, Card } from "@/components/ui";
import {
  EstimatedAiCost,
  useAiCostEstimateCatalog,
} from "@/components/ai-cost-estimate";
import { fetchJson } from "@/lib/client-types";

type ContentLanguage = {
  code: string;
  label: string;
  isDefault: boolean;
  autoTranslate: boolean;
  instructions: string;
  position: number;
  archivedAt: string | null;
};

const emptyDraft = {
  code: "",
  label: "",
  autoTranslate: true,
  instructions: "",
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:bg-surface-subtle";

export function LanguageManager() {
  const { t } = useT("settings");
  const aiCostEstimates = useAiCostEstimateCatalog();
  const translationCostEstimate = aiCostEstimates?.operations.translation;
  const [languages, setLanguages] = useState<ContentLanguage[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [bulkTranslating, setBulkTranslating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<{ languages: ContentLanguage[] }>(
        "/api/v1/languages?includeArchived=true",
        { cache: "no-store" },
      );
      setLanguages(response.languages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("languages.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createLanguage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingCode("new");
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<{ language: ContentLanguage }>(
        "/api/v1/languages",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      setLanguages((current) => [...current, response.language]);
      setDraft(emptyDraft);
      setCreating(false);
      setNotice(t("languages.notices.added", { name: response.language.label }));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t("languages.errors.add"));
    } finally {
      setSavingCode(null);
    }
  }

  async function saveLanguage(
    language: ContentLanguage,
    patch?: Partial<ContentLanguage> & { archived?: boolean },
  ) {
    setSavingCode(language.code);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<{ language: ContentLanguage }>(
        `/api/v1/languages/${encodeURIComponent(language.code)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            patch ?? {
              label: language.label,
              autoTranslate: language.autoTranslate,
              instructions: language.instructions,
              position: language.position,
            },
          ),
        },
      );
      setLanguages((current) =>
        current.map((item) =>
          item.code === language.code ? response.language : item,
        ),
      );
      if (patch?.isDefault) await load();
      setNotice(t("languages.notices.updated", { name: response.language.label }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("languages.errors.update"));
    } finally {
      setSavingCode(null);
    }
  }

  async function archiveLanguage(language: ContentLanguage) {
    if (!window.confirm(t("languages.archiveConfirm", { name: language.label }))) {
      return;
    }
    setSavingCode(language.code);
    setError(null);
    try {
      const response = await fetchJson<{ language: ContentLanguage }>(
        `/api/v1/languages/${encodeURIComponent(language.code)}`,
        { method: "DELETE" },
      );
      setLanguages((current) =>
        current.map((item) =>
          item.code === language.code ? response.language : item,
        ),
      );
      setNotice(t("languages.notices.archived", { name: language.label }));
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : t("languages.errors.archive"));
    } finally {
      setSavingCode(null);
    }
  }

  const updateLocal = (code: string, patch: Partial<ContentLanguage>) =>
    setLanguages((current) =>
      current.map((language) =>
        language.code === code ? { ...language, ...patch } : language,
      ),
    );

  async function translateExistingInventory() {
    setBulkTranslating(true);
    setBulkProgress(t("languages.queueing"));
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<{
        result: { resources: number; jobs: number };
      }>("/api/v1/translations/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setNotice(
        response.result.jobs
          ? t("languages.jobsQueued", response.result)
          : t("languages.noJobs"),
      );
    } catch (translationError) {
      setError(
        translationError instanceof Error
          ? translationError.message
          : t("languages.errors.translate"),
      );
    } finally {
      setBulkTranslating(false);
      setBulkProgress(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand">
              <Languages className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">{t("languages.title")}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                {t("languages.description")}
              </p>
              <EstimatedAiCost
                estimate={translationCostEstimate}
                className="mt-1"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {languages.some((language) => !language.isDefault && !language.archivedAt) ? (
              <span className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => void translateExistingInventory()}
                  disabled={bulkTranslating}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-brand-border bg-brand-soft px-3 text-xs font-semibold text-brand hover:bg-brand-soft disabled:opacity-50"
                >
                  {bulkTranslating ? <LoaderCircle className="size-4 animate-spin" /> : <Languages className="size-4" />}
                  {bulkTranslating ? t("languages.translating") : t("languages.translateInventory")}
                </button>
                <EstimatedAiCost estimate={translationCostEstimate} />
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              className="grid size-10 place-items-center rounded-xl border border-border text-muted hover:bg-surface-subtle"
              aria-label={t("languages.refresh")}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <Button type="button" onClick={() => setCreating((value) => !value)}>
              {creating ? <X className="size-4" /> : <Plus className="size-4" />}
              {creating ? t("languages.close") : t("languages.add")}
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
        {bulkProgress ? (
          <div className="border-b border-brand-border bg-brand-soft px-5 py-3 text-sm text-brand">
            {bulkProgress}
          </div>
        ) : null}

        {creating ? (
          <form onSubmit={createLanguage} className="border-b border-brand-border bg-brand-soft/40 p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
              <label className="text-xs font-semibold text-muted-strong">
                {t("languages.languageCode")}
                <input
                  required
                  value={draft.code}
                  onChange={(event) => setDraft((current) => ({ ...current, code: event.target.value }))}
                  placeholder={t("languages.codePlaceholder")}
                  className={`${inputClass} font-mono`}
                />
              </label>
              <label className="text-xs font-semibold text-muted-strong">
                {t("languages.visibleName")}
                <input
                  required
                  value={draft.label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                  placeholder={t("languages.namePlaceholder")}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-semibold text-muted-strong sm:col-span-2">
                {t("languages.guidance")} <span className="font-normal text-muted">{t("languages.guidanceHint")}</span>
                <textarea
                  value={draft.instructions}
                  onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
                  placeholder={t("languages.guidancePlaceholder")}
                  rows={3}
                  className={`${inputClass} h-auto py-2.5 leading-5`}
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-strong">
                <input
                  type="checkbox"
                  checked={draft.autoTranslate}
                  onChange={(event) => setDraft((current) => ({ ...current, autoTranslate: event.target.checked }))}
                  className="size-4 rounded border-border-strong text-brand"
                />
                {t("languages.autoOnSave")}
                <EstimatedAiCost estimate={translationCostEstimate} />
              </label>
              <Button type="submit" disabled={savingCode === "new"}>
                {savingCode === "new" ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {t("languages.add")}
              </Button>
            </div>
          </form>
        ) : null}

        {loading && !languages.length ? (
          <div className="grid min-h-40 place-items-center text-muted">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {languages.map((language) => (
              <div key={language.code} className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="flex min-w-[170px] items-center gap-3 lg:pt-1.5">
                    <span className="rounded-lg bg-surface-muted px-2.5 py-1.5 font-mono text-xs font-bold text-muted-strong">
                      {language.code}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{language.label}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {language.archivedAt
                          ? t("languages.status.archived")
                          : language.isDefault
                            ? t("languages.status.canonical")
                            : language.autoTranslate
                              ? t("languages.status.automatic")
                              : t("languages.status.manual")}
                      </p>
                    </div>
                  </div>
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
                    <label className="text-xs font-semibold text-muted-strong">
                      {t("languages.name")}
                      <input
                        value={language.label}
                        disabled={Boolean(language.archivedAt)}
                        onChange={(event) => updateLocal(language.code, { label: event.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="text-xs font-semibold text-muted-strong">
                      {t("languages.order")}
                      <input
                        type="number"
                        min={0}
                        value={language.position}
                        disabled={Boolean(language.archivedAt)}
                        onChange={(event) => updateLocal(language.code, { position: Number(event.target.value) })}
                        className={inputClass}
                      />
                    </label>
                    <label className="text-xs font-semibold text-muted-strong sm:col-span-2">
                      {t("languages.guidance")}
                      <textarea
                        value={language.instructions}
                        disabled={language.isDefault || Boolean(language.archivedAt)}
                        onChange={(event) => updateLocal(language.code, { instructions: event.target.value })}
                        rows={2}
                        className={`${inputClass} h-auto py-2.5 leading-5`}
                      />
                    </label>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[250px] lg:justify-end lg:pt-6">
                    {language.archivedAt ? (
                      <button
                        type="button"
                        onClick={() => void saveLanguage(language, { archived: false })}
                        disabled={savingCode === language.code}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand-border bg-brand-soft px-3 text-xs font-semibold text-brand hover:bg-brand-soft disabled:opacity-50"
                      >
                        <RefreshCw className="size-3.5" /> {t("languages.restore")}
                      </button>
                    ) : !language.isDefault ? (
                      <>
                        <label className="mr-1 flex items-center gap-2 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={language.autoTranslate}
                            onChange={(event) => updateLocal(language.code, { autoTranslate: event.target.checked })}
                            className="size-4 rounded border-border-strong text-brand"
                          />
                          {t("languages.auto")}
                        </label>
                        <button
                          type="button"
                          onClick={() => void saveLanguage(language, { isDefault: true })}
                          disabled={savingCode === language.code}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-muted hover:border-brand-border hover:text-brand disabled:opacity-50"
                          title={t("languages.makeDefaultTitle")}
                        >
                          <Check className="size-3.5" /> {t("languages.makeDefault")}
                        </button>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[12px] font-semibold text-success">
                        <Check className="size-3" /> {t("languages.default")}
                      </span>
                    )}
                    {!language.archivedAt ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveLanguage(language)}
                          disabled={savingCode === language.code}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-strong px-3 text-xs font-semibold text-on-strong disabled:opacity-50"
                        >
                          {savingCode === language.code ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                          {t("languages.save")}
                        </button>
                        {!language.isDefault ? (
                          <button
                            type="button"
                            onClick={() => void archiveLanguage(language)}
                            disabled={savingCode === language.code}
                            className="grid size-9 place-items-center rounded-lg border border-border text-muted hover:border-danger-border hover:bg-danger-soft hover:text-danger"
                            aria-label={t("languages.archive", { name: language.label })}
                          >
                            <Archive className="size-3.5" />
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="rounded-2xl border border-brand-border bg-brand-soft/60 p-5 text-sm leading-6 text-brand">
        <p className="font-semibold">{t("languages.explanation.title")}</p>
        <p className="mt-1 text-brand">
          {t("languages.explanation.body")}
        </p>
      </div>
    </div>
  );
}
