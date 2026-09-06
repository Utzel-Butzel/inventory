"use client";

import { AlertCircle, CheckCircle2, QrCode } from "lucide-react";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";

import { Badge, Card, cn } from "@/components/ui";
import { visibleFlowInputs } from "@/lib/action-chain-contract";
import { legacyWorkflowActions } from "./chain-draft";

import { inputClass, labelClass, textAreaClass, visiblePropertyValue } from "./fields";
import type { StockItem, WorkflowStepProps } from "./types";
import type { WorkflowSample } from "./use-workflow-sample";
import { extractIdentifier } from "./validation";
import { workflowVariantOptions } from "./variant-options";

type WorkflowPreviewProps = Pick<WorkflowStepProps, "draft" | "t"> & {
  sample: WorkflowSample;
  interactionBusy: boolean;
  selectedResources: StockItem[];
  resources: StockItem[];
  previewInputs: Record<string, string>;
  setPreviewInputs: Dispatch<SetStateAction<Record<string, string>>>;
};

export function WorkflowPreview({
  draft,
  t,
  sample,
  interactionBusy,
  selectedResources,
  resources,
  previewInputs,
  setPreviewInputs,
}: WorkflowPreviewProps) {
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const previewTargets = selectedResources.map((target) => {
    const options = workflowVariantOptions(draft, target, resources);
    return { target, options, selected: options.find((option) => option.resourceId === selectedVariants[target.resourceId]) ?? options[0] };
  });
  const { sampleScan, setSampleScan } = sample;
  const extractionResult = useMemo(
    () => extractIdentifier(sampleScan, draft.extraction, t),
    [draft.extraction, sampleScan, t],
  );
  const visibleInputs = visibleFlowInputs(draft.inputFields, {
    identifier: extractionResult.value ?? "", raw: sampleScan, results: {},
    inputs: Object.fromEntries(draft.inputFields.filter((field) => previewInputs[field.uid] !== undefined && previewInputs[field.uid] !== "").map((field) => [field.key, field.type === "number" ? Number(previewInputs[field.uid]) : field.type === "checkbox" ? previewInputs[field.uid] === "true" : previewInputs[field.uid]])),
  });
  return (
    <Card className="mt-4 overflow-hidden">
      <div className="border-b border-border bg-[linear-gradient(110deg,var(--color-brand-soft),var(--color-surface))] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-brand">
            <QrCode className="size-[18px]" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">{t("workflows.preview.title")}</h2>
            <p className="mt-0.5 text-[11px] text-muted">{t("workflows.preview.description")}</p>
          </div>
          <Badge tone="neutral" className="ml-auto">{t("workflows.preview.noWrite")}</Badge>
        </div>
      </div>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div>
          <label className={labelClass}>
            {t("workflows.preview.scannedValue")}
            <textarea
              value={sampleScan}
              onChange={(event) => setSampleScan(event.target.value)}
              className={cn(textAreaClass, "min-h-24 font-mono text-[13px]")}
              placeholder={t("workflows.preview.placeholder")}
              disabled={interactionBusy}
            />
          </label>
          {draft.allowVariantSelection ? previewTargets.map(({ target, options, selected }) => (
            <label key={target.resourceId} className={cn(labelClass, "mt-4")}>
              {t("workflows.steps.inputs.variants.optionsFor", { name: target.name })}
              <select
                className={inputClass}
                value={selected.resourceId}
                disabled={interactionBusy || options.length < 2}
                onChange={(event) => setSelectedVariants((current) => ({ ...current, [target.resourceId]: event.target.value }))}
              >
                {options.map((option) => <option key={option.resourceId} value={option.resourceId}>{option.name}</option>)}
              </select>
            </label>
          )) : null}
          {draft.inputFields.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {visibleInputs.map((field) => (
                <label key={field.uid} className={labelClass}>
                  {field.label || field.key || t("workflows.preview.inputFallback")}{field.required ? " *" : ""}
                  {field.type === "select" || field.type === "radio" ? (
                    <select
                      value={previewInputs[field.uid] ?? ""}
                      onChange={(event) => setPreviewInputs((current) => ({ ...current, [field.uid]: event.target.value }))}
                      className={inputClass}
                      disabled={interactionBusy}
                    >
                      <option value="">—</option>
                      {field.options.map((option) => (
                        <option key={option.uid} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : field.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      checked={previewInputs[field.uid] === "true"}
                      onChange={(event) =>
                        setPreviewInputs((current) => ({
                          ...current,
                          [field.uid]: String(event.target.checked),
                        }))
                      }
                      className="mt-3 size-4 accent-brand-solid"
                      disabled={interactionBusy}
                    />
                  ) : field.type === "media" || field.type === "file" ? (
                    <input
                      type="file"
                      multiple
                      accept={field.type === "media" ? "image/*,video/*" : "application/pdf,image/*"}
                      className={cn(inputClass, "py-2")}
                      disabled={interactionBusy}
                    />
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={previewInputs[field.uid] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(event) => setPreviewInputs((current) => ({ ...current, [field.uid]: event.target.value }))}
                      className={inputClass}
                      disabled={interactionBusy}
                    />
                  )}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-surface-subtle p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{t("workflows.preview.result")}</p>
          {extractionResult.error ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-[12px] leading-5 text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {extractionResult.error}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-success-border bg-success-soft p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-success">
                <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                {draft.identifierPropertyKey || t("workflows.preview.identifier")}
              </div>
              <p className="mt-1.5 break-all font-mono text-[14px] font-semibold text-success">{extractionResult.value}</p>
            </div>
          )}

          <div className="mt-4 space-y-2.5 text-[12px]">
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted">{t("workflows.preview.target")}</span>
              <strong className="text-right font-semibold text-muted-strong">
                {selectedResources.length
                  ? previewTargets.map(({ selected }) => selected.name).join(", ")
                  : t("workflows.preview.notSelected")}
              </strong>
            </div>
            <ol className="space-y-2" aria-label={t("chain.actionList")}>
              {legacyWorkflowActions(draft).map((action, index) => <li key={action.id} className="rounded-lg border border-border p-2">
                <strong>{index + 1}. {action.label}</strong>
                <p className="mt-1 text-muted">{t(`chain.types.${action.type}`)}{!action.enabled ? ` · ${t("chain.disabled")}` : action.when ? ` · ${t("chain.conditional")}` : ""}</p>
                {"target" in action ? <p className="mt-1 text-muted">{action.target.source === "selected" ? t("chain.selectedTarget") : action.target.source === "resource" ? resources.find((item) => action.target.source === "resource" && item.resourceId === action.target.resourceId)?.name : t("chain.previousTarget")}</p> : null}
              </li>)}
            </ol>
            <p className="text-xs leading-5 text-muted">{t("chain.editorPreviewHelp")}</p>
            {draft.fixedProperties.map((property) => (
              <div key={property.uid} className="flex items-start justify-between gap-3">
                <span className="text-muted">{property.label || property.key}</span>
                <strong className="text-right font-semibold text-muted-strong">{visiblePropertyValue(property, t)}</strong>
              </div>
            ))}
            {visibleInputs.map((field) => {
              const option = field.options.find((item) => item.value === previewInputs[field.uid]);
              return (
                <div key={field.uid} className="flex items-center justify-between gap-3">
                  <span className="text-muted">{field.label || field.key}</span>
                  <strong className="inline-flex items-center gap-1.5 text-right font-semibold text-muted-strong">
                    {option?.color ? <span className="size-2.5 rounded-full border border-border-strong" style={{ backgroundColor: option.color }} /> : null}
                    {option?.label ?? previewInputs[field.uid] ?? t("workflows.preview.notSelected")}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
}
