"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useT } from "next-i18next/client";
import { Button } from "@/components/ui";
import { useOrganizationId } from "@/components/organization-routing";
import {
  aiPromptCollectionSchema,
  aiPromptKinds,
  aiPromptPlaceholders,
  builtInPrompt,
  defaultAiPromptCollection,
  renderAiPrompt,
  unknownPromptPlaceholders,
  type AiPromptCollection,
  type AiPromptKind,
  type AiPromptTemplate,
} from "@/lib/ai-prompt-templates";
import { fetchJson } from "@/lib/client-types";

type Settings = { collection: AiPromptCollection; revision: number };
const fieldClass =
  "mt-1.5 min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground";

export function AiPromptManager() {
  const { t } = useT("settings");
  const organizationId = useOrganizationId();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [collection, setCollection] = useState<AiPromptCollection | null>(null);
  const [kind, setKind] = useState<AiPromptKind>("analysis");
  const [selectedId, setSelectedId] = useState("builtin-analysis");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let active = true;
    fetchJson<Settings>("/api/v1/ai/prompts", {
      cache: "no-store",
      headers: organizationId ? { "x-organization-id": organizationId } : {},
    })
      .then((result) => {
        if (active) {
          setSaved(result);
          setCollection(result.collection);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError(t("prompts.loadError"));
      });
    return () => {
      active = false;
    };
  }, [organizationId, attempt, t]);
  const selected = collection?.templates.find(
    (template) => template.id === selectedId,
  );
  const dirty =
    !!collection &&
    JSON.stringify(collection) !== JSON.stringify(saved?.collection);
  const valid = collection
    ? aiPromptCollectionSchema.safeParse(collection).success
    : false;
  const patch = (values: Partial<AiPromptTemplate>) => {
    setNotice("");
    setCollection(
      (current) =>
        current && {
          ...current,
          templates: current.templates.map((entry) =>
            entry.id === selectedId ? { ...entry, ...values } : entry,
          ),
        },
    );
  };
  async function save() {
    if (!collection || !saved || !valid) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/ai/prompts", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(organizationId ? { "x-organization-id": organizationId } : {}),
        },
        body: JSON.stringify({ collection, revision: saved.revision }),
      });
      if (!response.ok)
        throw new Error(
          t(response.status === 409 ? "prompts.conflict" : "prompts.saveError"),
        );
      const result = (await response.json()) as Settings;
      setSaved(result);
      setCollection(result.collection);
      setNotice(t("prompts.saved"));
    } catch (error) {
      setError(error instanceof Error ? error.message : t("prompts.saveError"));
    } finally {
      setSaving(false);
    }
  }
  function add() {
    if (!collection || !selected) return;
    let n = 1;
    while (
      collection.templates.some(
        (entry) =>
          entry.kind === kind &&
          entry.name.toLowerCase() ===
            `${t("prompts.newName")} ${n}`.toLowerCase(),
      )
    )
      n++;
    const entry = {
      ...selected,
      id: crypto.randomUUID(),
      name: `${t("prompts.newName")} ${n}`,
    };
    setCollection({
      ...collection,
      templates: [...collection.templates, entry],
    });
    setSelectedId(entry.id);
    setNotice("");
  }
  function insertPlaceholder(name: string) {
    if (!selected || !textarea.current) return;
    const token = `{{${name}}}`;
    const { selectionStart: start, selectionEnd: end } = textarea.current;
    patch({
      prompt:
        selected.prompt.slice(0, start) + token + selected.prompt.slice(end),
    });
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(
        start + token.length,
        start + token.length,
      );
    });
  }
  return (
    <div className="space-y-4">
      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft p-3 text-sm text-danger"
        >
          {error}{" "}
          <button
            type="button"
            className="underline"
            disabled={saving}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("prompts.reload")}
          </button>
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-xl bg-success-soft p-3 text-sm text-success"
        >
          {notice}
        </p>
      ) : null}
      {!collection || !selected ? (
        <p>{t("prompts.loading")}</p>
      ) : (
        <>
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <label className="block text-sm font-semibold">
              {t("prompts.category")}
              <select
                className={fieldClass}
                value={kind}
                onChange={(event) => {
                  const next = event.target.value as AiPromptKind;
                  setKind(next);
                  setSelectedId(collection.defaults[next]);
                  setNotice("");
                }}
              >
                {aiPromptKinds.map((value) => (
                  <option key={value} value={value}>
                    {t(`prompts.kinds.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <div className="space-y-2">
                <nav aria-label={t("prompts.templates")} className="space-y-1">
                  {collection.templates
                    .filter((entry) => entry.kind === kind)
                    .map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        aria-pressed={selectedId === entry.id}
                        onClick={() => setSelectedId(entry.id)}
                        className={`flex min-h-12 w-full flex-col items-start rounded-xl px-3 py-2 text-left text-sm ${selectedId === entry.id ? "bg-brand-soft text-brand" : "bg-surface hover:bg-surface-muted"}`}
                      >
                        <span className="w-full truncate font-semibold">
                          {entry.name || t("prompts.unnamed")}
                        </span>
                        {entry.id === collection.defaults[kind] ? (
                          <span className="text-xs">
                            {t("prompts.default")}
                          </span>
                        ) : null}
                      </button>
                    ))}
                </nav>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={collection.templates.length >= 50}
                  onClick={add}
                >
                  <Plus size={16} />
                  {t("prompts.add")}
                </Button>
              </div>
              <div className="min-w-0 space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <label className="block text-sm font-semibold">
                  {t("prompts.name")}
                  <input
                    className={fieldClass}
                    value={selected.name}
                    maxLength={80}
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={collection.defaults[kind] === selected.id}
                    onChange={(event) =>
                      setCollection({
                        ...collection,
                        defaults: {
                          ...collection.defaults,
                          [kind]: event.target.checked
                            ? selected.id
                            : `builtin-${kind}`,
                        },
                      })
                    }
                  />
                  {t("prompts.useDefault")}
                </label>
                <label className="block text-sm font-semibold">
                  {t("prompts.text")}
                  <textarea
                    ref={textarea}
                    className={`${fieldClass} min-h-64 font-mono text-xs leading-5`}
                    rows={12}
                    value={selected.prompt}
                    maxLength={5000}
                    onChange={(event) => patch({ prompt: event.target.value })}
                  />
                </label>
                <div>
                  <p className="text-xs text-muted">
                    {t("prompts.insertHint")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {aiPromptPlaceholders.map((name) => (
                      <button
                        type="button"
                        key={name}
                        title={t(`prompts.placeholders.${name}`)}
                        onClick={() => insertPlaceholder(name)}
                        className="min-h-9 rounded-lg border border-border px-2 font-mono text-xs text-brand"
                      >{`{{${name}}}`}</button>
                    ))}
                  </div>
                </div>
                {unknownPromptPlaceholders(selected.prompt).length ? (
                  <p role="alert" className="text-sm text-danger">
                    {t("prompts.unknown", {
                      names: unknownPromptPlaceholders(selected.prompt).join(
                        ", ",
                      ),
                    })}
                  </p>
                ) : null}
                <details>
                  <summary className="cursor-pointer text-sm font-medium">
                    {t("prompts.preview")}
                  </summary>
                  <p className="mt-2 text-xs text-muted">
                    {t("prompts.previewHint")}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-surface-subtle p-3 text-xs">
                    {renderAiPrompt(selected.prompt, {
                      name: "Bosch GSR 12V-15",
                      description: t("prompts.exampleDescription"),
                      type: "tool",
                      tags: "bosch, drill",
                      categories: "Tools",
                      sku: "TOOL-001",
                      barcode: "4000000000018",
                      serialNumber: "SN-123",
                      language: "German",
                      allowedTypes: "object, tool, furniture, other",
                    })}
                  </pre>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => patch({ prompt: builtInPrompt(kind) })}
                  >
                    <RotateCcw size={16} />
                    {t("prompts.resetPrompt")}
                  </Button>
                  {!selected.id.startsWith("builtin-") ? (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setCollection({
                          ...collection,
                          templates: collection.templates.filter(
                            (entry) => entry.id !== selected.id,
                          ),
                          defaults: {
                            ...collection.defaults,
                            [kind]:
                              collection.defaults[kind] === selected.id
                                ? `builtin-${kind}`
                                : collection.defaults[kind],
                          },
                        });
                        setSelectedId(`builtin-${kind}`);
                        setNotice("");
                      }}
                    >
                      <Trash2 size={16} />
                      {t("prompts.remove")}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            {dirty && !valid ? (
              <p role="alert" className="text-sm text-danger">
                {t("prompts.invalid")}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button onClick={() => void save()} disabled={!dirty || !valid}>
                <Save size={16} />
                {t(saving ? "prompts.saving" : "prompts.save")}
              </Button>
              <Button
                variant="secondary"
                disabled={!dirty}
                onClick={() => {
                  setCollection(saved!.collection);
                  setSelectedId(saved!.collection.defaults[kind]);
                  setNotice("");
                }}
              >
                {t("prompts.discard")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setCollection(defaultAiPromptCollection());
                  setSelectedId(`builtin-${kind}`);
                  setNotice(t("prompts.resetNotice"));
                }}
              >
                {t("prompts.resetAll")}
              </Button>
              {dirty ? (
                <span className="text-xs text-muted">
                  {t("prompts.unsaved")}
                </span>
              ) : null}
            </div>
          </fieldset>
        </>
      )}
    </div>
  );
}
