"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "next-i18next/client";
import { useOrganizationId } from "@/components/organization-routing";
import { Button } from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import {
  aiPromptPlaceholders,
  defaultAiPromptCollection,
  type AiPromptCollection,
  type AiPromptKind,
  type AiPromptSelection,
} from "@/lib/ai-prompt-templates";

export function useAiPromptTemplates() {
  const organizationId = useOrganizationId();
  const [state, setState] = useState<{
    collection: AiPromptCollection;
    organizationId: string | undefined;
  } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    fetchJson<{ collection: AiPromptCollection }>("/api/v1/ai/prompts", {
      cache: "no-store",
      headers: organizationId ? { "x-organization-id": organizationId } : {},
    })
      .then(({ collection }) => {
        if (active) {
          setState({ collection, organizationId });
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [organizationId, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    collection:
      state && state.organizationId === organizationId ? state.collection : null,
    error,
    retry,
  };
}
export type AiPromptLibrary = ReturnType<typeof useAiPromptTemplates>;

export function AiPromptPicker({
  kind,
  value = {},
  onChange,
  library,
  disabled = false,
}: {
  kind: AiPromptKind;
  value?: AiPromptSelection;
  onChange: (value: AiPromptSelection) => void;
  library: AiPromptLibrary;
  disabled?: boolean;
}) {
  const { t } = useT("settings");
  const collection = library.collection ?? defaultAiPromptCollection();
  const selectedId = value.promptTemplateId ?? collection.defaults[kind];
  const templates = collection.templates.filter(
    (template) => template.kind === kind,
  );
  const selected = templates.find((template) => template.id === selectedId);
  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-border bg-surface p-3">
      <label className="block text-xs font-semibold text-muted-strong">
        {t("prompts.select", { kind: t(`prompts.kinds.${kind}`) })}
        <select
          value={selectedId}
          onChange={(event) =>
            onChange({ promptTemplateId: event.target.value })
          }
          disabled={disabled || !library.collection}
          className="mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground"
        >
          {!selected ? (
            <option value={selectedId}>{t("prompts.unavailable")}</option>
          ) : null}
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
              {template.id === collection.defaults[kind] && template.name !== t("prompts.default")
                ? ` · ${t("prompts.default")}`
                : ""}
            </option>
          ))}
        </select>
      </label>
      {library.error ? (
        <div role="alert" className="text-xs text-danger">
          {t("prompts.loadError")}{" "}
          <button type="button" className="underline" onClick={library.retry}>
            {t("prompts.reload")}
          </button>
        </div>
      ) : !library.collection ? (
        <p className="text-xs text-muted">{t("prompts.loading")}</p>
      ) : null}
      {selected ? (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted">
            {t("prompts.customize")}
            {value.prompt !== undefined ? ` · ${t("prompts.modified")}` : ""}
          </summary>
          <label className="mt-3 block text-xs text-muted-strong">
            {t("prompts.text")}
            <textarea
              value={value.prompt ?? selected.prompt}
              onChange={(event) =>
                onChange({
                  promptTemplateId: selected.id,
                  prompt: event.target.value,
                })
              }
              disabled={disabled}
              maxLength={5000}
              rows={7}
              className="mt-1 w-full rounded-xl border border-border bg-surface-subtle p-3 font-mono text-xs"
            />
          </label>
          <p className="mt-2 break-words text-xs text-muted">
            {t("prompts.placeholderHint")}{" "}
            {aiPromptPlaceholders.map((name) => `{{${name}}}`).join(", ")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={disabled}
            onClick={() => onChange({ promptTemplateId: selected.id })}
          >
            {t("prompts.resetSelection")}
          </Button>
        </details>
      ) : null}
    </div>
  );
}
