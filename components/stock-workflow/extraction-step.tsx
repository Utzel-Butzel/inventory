"use client";

import { OrganizationLink as Link } from "@/components/organization-routing";
import {
  AlertCircle,
  CheckCircle2,
  FileKey2,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge, Button, cn } from "@/components/ui";
import { scanCodeTypeLabels } from "@/lib/scan-code-types";

import { localId, updateDraftExtraction } from "./draft";
import {
  FlowStep,
  StockUnitCustomFieldSelect,
  StorageTargetSelect,
  inputClass,
  labelClass,
  textAreaClass,
} from "./fields";
import type { ExtractionMode, StockUnitCustomField, WorkflowStepProps } from "./types";
import type { WorkflowSample } from "./use-workflow-sample";

type WorkflowExtractionStepProps = WorkflowStepProps & {
  stockUnitCustomFields: StockUnitCustomField[];
  sample: WorkflowSample;
  interactionBusy: boolean;
};

export function WorkflowExtractionStep({
  draft,
  setDraft,
  editable,
  t,
  integer,
  stockUnitCustomFields,
  sample,
  interactionBusy,
}: WorkflowExtractionStepProps) {
  const {
    sampleScan,
    setSampleScan,
    sampleCodeType,
    setSampleSelection,
    aiInstruction,
    setAiInstruction,
    aiGenerating,
    aiExplanation,
    aiError,
    selectedSampleValue,
    applySelectionRegex,
    generateRegexWithAi,
  } = sample;
  const selectedIdentifierCustomField = stockUnitCustomFields.find(
    (field) => field.key === draft.identifierPropertyKey,
  );
  return (
    <FlowStep
      number={integer.format(2)}
      icon={<FileKey2 className="size-[18px] sm:size-5" aria-hidden="true" />}
      title={t("workflows.steps.extract.title")}
      description={t("workflows.steps.extract.description")}
    >
      <div className="mb-4 rounded-2xl border border-brand-border bg-[linear-gradient(135deg,var(--color-brand-soft),var(--color-surface))] p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <Sparkles className="size-4 text-brand" aria-hidden="true" />
              {t("workflows.regexStudio.title")}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              {t("workflows.regexStudio.description")}
            </p>
          </div>
          {sampleCodeType ? (
            <Badge tone="brand">{scanCodeTypeLabels[sampleCodeType]}</Badge>
          ) : (
            <Badge tone="neutral">{t("workflows.regexStudio.manual")}</Badge>
          )}
        </div>
        <label className={cn(labelClass, "mt-3 block")}>
          {t("workflows.regexStudio.sample")}
          <textarea
            value={sampleScan}
            onChange={(event) => {
              setSampleScan(event.target.value);
              setSampleSelection({ start: 0, end: 0 });
            }}
            onSelect={(event) =>
              setSampleSelection({
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              })
            }
            className={cn(textAreaClass, "min-h-24 font-mono text-[13px]")}
            disabled={interactionBusy}
          />
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            value={aiInstruction}
            onChange={(event) => setAiInstruction(event.target.value)}
            className={cn(inputClass, "mt-0")}
            placeholder={t("workflows.regexStudio.instructionPlaceholder")}
            disabled={!editable || aiGenerating}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={!editable || !selectedSampleValue || aiGenerating}
            onClick={() => applySelectionRegex()}
          >
            {t("workflows.regexStudio.useSelection")}
          </Button>
          <Button
            size="sm"
            disabled={
              !editable ||
              aiGenerating ||
              (!selectedSampleValue && !aiInstruction.trim())
            }
            onClick={() => void generateRegexWithAi()}
          >
            {aiGenerating ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-3.5" aria-hidden="true" />
            )}
            {t("workflows.regexStudio.generate")}
          </Button>
        </div>
        {selectedSampleValue ? (
          <p className="mt-2 break-all text-[11px] text-muted">
            {t("workflows.regexStudio.selected")}: {" "}
            <code className="rounded bg-surface px-1.5 py-0.5 text-foreground">
              {selectedSampleValue}
            </code>
          </p>
        ) : null}
        {aiExplanation ? (
          <p className="mt-2 text-[12px] leading-5 text-success">
            {aiExplanation}
          </p>
        ) : null}
        {aiError ? (
          <p role="alert" className="mt-2 text-[12px] leading-5 text-danger">
            {aiError}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1 sm:grid-cols-4">
        {(["full", "url-query", "prefix", "regex"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() =>
              setDraft((current) => updateDraftExtraction(current, { mode }))
            }
            disabled={!editable}
            aria-pressed={draft.extraction.mode === mode}
            className={cn(
              "h-9 rounded-lg px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed",
              draft.extraction.mode === mode
                ? "bg-surface text-brand-strong shadow-sm"
                : "text-muted hover:text-foreground disabled:opacity-65",
            )}
          >
            {t(`workflows.steps.extract.modes.${mode}`)}
          </button>
        ))}
      </div>

      {draft.extraction.mode === "url-query" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            {t("workflows.steps.extract.queryParameter")}
            <input
              value={draft.extraction.parameter}
              onChange={(event) =>
                setDraft((current) => updateDraftExtraction(current, { parameter: event.target.value }))
              }
              className={inputClass}
              placeholder={t("workflows.steps.extract.queryParameterPlaceholder")}
              disabled={!editable}
            />
          </label>
          <label className={labelClass}>
            {t("workflows.steps.extract.sourceOrigin")}
            <input
              value={draft.extraction.sourceOrigin}
              onChange={(event) =>
                setDraft((current) => updateDraftExtraction(current, { sourceOrigin: event.target.value }))
              }
              className={inputClass}
              placeholder={t("workflows.steps.extract.sourceOriginPlaceholder")}
              disabled={!editable}
            />
          </label>
          <label className={labelClass}>
            {t("workflows.steps.extract.sourcePath")}
            <input
              value={draft.extraction.sourcePath}
              onChange={(event) =>
                setDraft((current) => updateDraftExtraction(current, { sourcePath: event.target.value }))
              }
              className={inputClass}
              placeholder={t("workflows.steps.extract.sourcePathPlaceholder")}
              disabled={!editable}
            />
          </label>
        </div>
      ) : draft.extraction.mode === "prefix" ? (
        <div className="mt-4 max-w-md">
          <label className={labelClass}>
            {t("workflows.steps.extract.prefix")}
            <input
              value={draft.extraction.prefix}
              onChange={(event) =>
                setDraft((current) => updateDraftExtraction(current, { prefix: event.target.value }))
              }
              className={inputClass}
              placeholder={t("workflows.steps.extract.prefixPlaceholder")}
              disabled={!editable}
            />
          </label>
        </div>
      ) : draft.extraction.mode === "regex" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_100px_140px]">
          <label className={labelClass}>
            {t("workflows.steps.extract.regexPattern")}
            <input
              value={draft.extraction.pattern}
              onChange={(event) =>
                setDraft((current) => updateDraftExtraction(current, {
                  pattern: event.target.value,
                }))
              }
              className={cn(inputClass, "font-mono")}
              placeholder="^(?<value>.+)$"
              disabled={!editable}
            />
          </label>
          <label className={labelClass}>
            {t("workflows.steps.extract.regexFlags")}
            <input
              value={draft.extraction.flags}
              onChange={(event) =>
                setDraft((current) => updateDraftExtraction(current, {
                  flags: event.target.value,
                }))
              }
              className={cn(inputClass, "font-mono")}
              placeholder="iu"
              disabled={!editable}
            />
          </label>
          <label className={labelClass}>
            {t("workflows.steps.extract.regexGroup")}
            <input
              value={draft.extraction.group}
              onChange={(event) =>
                setDraft((current) => updateDraftExtraction(current, {
                  group: event.target.value,
                }))
              }
              className={cn(inputClass, "font-mono")}
              placeholder="value"
              disabled={!editable}
            />
          </label>
        </div>
      ) : null}
      <div className="mt-5 rounded-2xl border border-border bg-surface-subtle p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold text-foreground">
              {t("workflows.storage.identifierTitle")}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              {t("workflows.storage.identifierDescription")}
            </p>
          </div>
          <Badge tone="neutral">{t("workflows.storage.stockUnitBadge")}</Badge>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <StorageTargetSelect
            value={draft.identifierStorage}
            onChange={(identifierStorage) =>
              setDraft((current) => ({ ...current, identifierStorage }))
            }
            disabled={!editable}
            t={t}
          />
          {draft.identifierStorage === "custom-field" ? (
            <StockUnitCustomFieldSelect
              fields={stockUnitCustomFields}
              value={draft.identifierPropertyKey}
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  identifierPropertyKey: value,
                }))
              }
              disabled={!editable}
              t={t}
            />
          ) : (
            <label className={labelClass}>
              {draft.identifierStorage === "metadata"
                ? t("workflows.storage.metadataKey")
                : t("workflows.storage.executionKey")}
              <input
                value={draft.identifierPropertyKey}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    identifierPropertyKey: event.target.value,
                  }))
                }
                className={inputClass}
                placeholder={t("workflows.steps.extract.identifierKeyPlaceholder")}
                disabled={!editable}
              />
            </label>
          )}
        </div>
        {draft.identifierStorage === "custom-field" ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-brand-border bg-brand-soft px-3 py-2.5 text-[12px] leading-5 text-brand-strong">
            {selectedIdentifierCustomField ? (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            )}
            <p>
              {selectedIdentifierCustomField
                ? t("workflows.storage.selectedCustomField", {
                  label: selectedIdentifierCustomField.label,
                  key: draft.identifierPropertyKey,
                })
                : t("workflows.storage.selectConfiguredField")}{" "}
              <Link
                href="/settings/custom-fields"
                className="font-semibold underline underline-offset-2"
              >
                {t("workflows.storage.manageCustomFields")}
              </Link>
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[11px] leading-4 text-muted">
            {draft.identifierStorage === "metadata"
              ? t("workflows.storage.metadataHint")
              : t("workflows.storage.executionHint")}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-4 text-muted">
          {t("workflows.storage.inventoryItemScope")}
        </p>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-muted-strong">
              {t("workflows.storage.additionalFieldsTitle")}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted">
              {t("workflows.storage.additionalFieldsDescription")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!editable}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                extractedFields: [
                  ...current.extractedFields,
                  {
                    uid: localId("extracted"),
                    key: `codeField${current.extractedFields.length + 1}`,
                    label: `QR-Feld ${current.extractedFields.length + 1}`,
                    storage: "custom-field",
                    extraction: {
                      ...current.extraction,
                      mode: "url-query",
                      parameter: `field${current.extractedFields.length + 1}`,
                    },
                  },
                ],
              }))
            }
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("workflows.storage.addField")}
          </Button>
        </div>
        {draft.extractedFields.length ? (
          <div className="mt-3 space-y-2">
            {draft.extractedFields.map((field) => (
              <div key={field.uid} className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-3 sm:grid-cols-2 lg:grid-cols-5">
                {field.storage === "custom-field" ? (
                  <StockUnitCustomFieldSelect
                    fields={stockUnitCustomFields}
                    value={field.key}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        extractedFields: current.extractedFields.map((item) =>
                          item.uid === field.uid ? { ...item, key: value } : item,
                        ),
                      }))
                    }
                    disabled={!editable}
                    t={t}
                  />
                ) : (
                  <label className={labelClass}>
                    {t("workflows.storage.propertyKey")}
                    <input
                      value={field.key}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          extractedFields: current.extractedFields.map((item) =>
                            item.uid === field.uid
                              ? { ...item, key: event.target.value }
                              : item,
                          ),
                        }))
                      }
                      className={inputClass}
                      disabled={!editable}
                    />
                  </label>
                )}
                <label className={labelClass}>
                  Bezeichnung
                  <input
                    value={field.label}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        extractedFields: current.extractedFields.map((item) =>
                          item.uid === field.uid ? { ...item, label: event.target.value } : item,
                        ),
                      }))
                    }
                    className={inputClass}
                    disabled={!editable}
                  />
                </label>
                <label className={labelClass}>
                  Extraktion
                  <select
                    value={field.extraction.mode}
                    onChange={(event) =>
                      setDraft((current) => updateDraftExtraction(current, {
                        mode: event.target.value as ExtractionMode,
                      }, field.uid))
                    }
                    className={inputClass}
                    disabled={!editable}
                  >
                    <option value="url-query">URL-Parameter</option>
                    <option value="regex">Regulärer Ausdruck</option>
                    <option value="prefix">Präfix entfernen</option>
                    <option value="full">Vollständiger Wert</option>
                  </select>
                </label>
                <label className={labelClass}>
                  {field.extraction.mode === "prefix"
                    ? "Präfix"
                    : field.extraction.mode === "regex"
                      ? "Regex"
                      : "Parameter"}
                  <input
                    value={
                      field.extraction.mode === "prefix"
                        ? field.extraction.prefix
                        : field.extraction.mode === "regex"
                          ? field.extraction.pattern
                          : field.extraction.parameter
                    }
                    onChange={(event) =>
                      setDraft((current) => updateDraftExtraction(current, {
                        [field.extraction.mode === "prefix"
                          ? "prefix"
                          : field.extraction.mode === "regex"
                            ? "pattern"
                            : "parameter"]: event.target.value,
                      }, field.uid))
                    }
                    className={inputClass}
                    disabled={!editable || field.extraction.mode === "full"}
                  />
                </label>
                <div className="flex items-end gap-2">
                  <StorageTargetSelect
                    value={field.storage}
                    onChange={(storage) =>
                      setDraft((current) => ({
                        ...current,
                        extractedFields: current.extractedFields.map((item) =>
                          item.uid === field.uid ? { ...item, storage } : item,
                        ),
                      }))
                    }
                    disabled={!editable}
                    t={t}
                    compact
                    className="min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-lg text-danger hover:bg-danger-soft"
                    disabled={!editable}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        extractedFields: current.extractedFields.filter((item) => item.uid !== field.uid),
                      }))
                    }
                    aria-label="QR-Feld entfernen"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {field.extraction.mode === "regex" ? (
                  <div className="grid gap-2 sm:col-span-2 sm:grid-cols-[100px_140px_auto] lg:col-span-5">
                    <label className={labelClass}>
                      Flags
                      <input
                        value={field.extraction.flags}
                        onChange={(event) =>
                          setDraft((current) => updateDraftExtraction(current, {
                            flags: event.target.value,
                          }, field.uid))
                        }
                        className={cn(inputClass, "font-mono")}
                        disabled={!editable}
                      />
                    </label>
                    <label className={labelClass}>
                      Capture Group
                      <input
                        value={field.extraction.group}
                        onChange={(event) =>
                          setDraft((current) => updateDraftExtraction(current, {
                            group: event.target.value,
                          }, field.uid))
                        }
                        className={cn(inputClass, "font-mono")}
                        disabled={!editable}
                      />
                    </label>
                    <div className="flex items-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!editable || !selectedSampleValue}
                        onClick={() => applySelectionRegex(field.uid)}
                      >
                        {t("workflows.regexStudio.useSelectionForField")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </FlowStep>
  );
}
