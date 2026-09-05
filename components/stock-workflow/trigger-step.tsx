"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  LoaderCircle,
  QrCode,
  RefreshCcw,
  ScanLine,
} from "lucide-react";

import { CodeScannerCamera } from "@/components/code-scanner-camera";
import { Badge, Button, cn } from "@/components/ui";
import {
  scanCodeTypeLabels,
  scanCodeTypes,
  type ScanCodeType,
} from "@/lib/scan-code-types";

import { FlowStep, Toggle, inputClass, labelClass, textAreaClass } from "./fields";
import type { WorkflowStepProps } from "./types";
import type { WorkflowSample } from "./use-workflow-sample";

type WorkflowTriggerStepProps = WorkflowStepProps & {
  sample: WorkflowSample;
  publicTrigger: {
    path: string | null;
    live: boolean;
    copied: boolean;
    rotating: boolean;
    dirty: boolean;
    copy: () => Promise<void>;
    rotate: () => Promise<void>;
  };
};

export function WorkflowTriggerStep({
  draft,
  setDraft,
  editable,
  t,
  integer,
  sample,
  publicTrigger,
}: WorkflowTriggerStepProps) {
  const {
    setSampleScan,
    setSampleCodeType,
    setSampleSelection,
    showExampleScanner,
    setShowExampleScanner,
  } = sample;
  const {
    path: publicTriggerPath,
    live: publicTriggerLive,
    copied: copiedPublicUrl,
    rotating: rotatingPublicUrl,
    dirty,
    copy: copyPublicTriggerUrl,
    rotate: rotatePublicTriggerUrl,
  } = publicTrigger;
  const toggleCodeType = (codeType: ScanCodeType) => {
    setDraft((current) => ({
      ...current,
      codeTypes: current.codeTypes.includes(codeType)
        ? current.codeTypes.filter((candidate) => candidate !== codeType)
        : scanCodeTypes.filter(
          (candidate) =>
            candidate === codeType || current.codeTypes.includes(candidate),
        ),
    }));
  };

  return (
    <FlowStep
      number={integer.format(1)}
      icon={<QrCode className="size-[18px] sm:size-5" aria-hidden="true" />}
      title={t("workflows.steps.trigger.title")}
      description={t("workflows.steps.trigger.description")}
    >
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-subtle p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-surface text-brand shadow-sm ring-1 ring-border">
            <ScanLine className="size-[18px]" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-foreground">{t("workflows.steps.trigger.event")}</p>
            <p className="mt-0.5 text-[11px] text-muted">{t("workflows.steps.trigger.eventDescription")}</p>
          </div>
        </div>
        <Badge tone="brand">{t("workflows.steps.trigger.badge")}</Badge>
      </div>
      <div className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-muted-strong">
              {t("workflows.steps.trigger.codeTypes")}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              {t("workflows.steps.trigger.codeTypesDescription")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!editable}
            onClick={() => setShowExampleScanner((current) => !current)}
          >
            <ScanLine className="size-3.5" aria-hidden="true" />
            {t(
              showExampleScanner
                ? "workflows.steps.trigger.closeExampleScanner"
                : "workflows.steps.trigger.scanExample",
            )}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {scanCodeTypes.map((codeType) => {
            const selected = draft.codeTypes.includes(codeType);
            return (
              <button
                key={codeType}
                type="button"
                aria-pressed={selected}
                disabled={!editable}
                onClick={() => toggleCodeType(codeType)}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-xl border px-3 text-left text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
                  selected
                    ? "border-brand-border bg-brand-soft text-brand-strong"
                    : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border",
                    selected
                      ? "border-brand-solid bg-brand-solid text-on-brand"
                      : "border-border-strong",
                  )}
                >
                  {selected ? <Check className="size-3" aria-hidden="true" /> : null}
                </span>
                {scanCodeTypeLabels[codeType]}
              </button>
            );
          })}
        </div>
        {!draft.codeTypes.length ? (
          <p className="mt-2 text-[12px] text-danger">
            {t("workflows.validation.codeType")}
          </p>
        ) : null}
      </div>
      {showExampleScanner ? (
        <div className="mt-4 rounded-2xl border border-brand-border bg-surface p-3 sm:p-4">
          <CodeScannerCamera
            disabled={!editable}
            onDetected={(code, _source, codeType) => {
              setSampleScan(code);
              setSampleCodeType(codeType);
              setSampleSelection({ start: 0, end: 0 });
              if (codeType) {
                setDraft((current) => ({
                  ...current,
                  codeTypes: current.codeTypes.includes(codeType)
                    ? current.codeTypes
                    : scanCodeTypes.filter(
                      (candidate) =>
                        candidate === codeType ||
                        current.codeTypes.includes(candidate),
                    ),
                }));
              }
              setShowExampleScanner(false);
            }}
          />
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-border bg-surface p-3.5 sm:p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
            <Link2 className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-foreground">
              {t("workflows.publicTrigger.title")}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              {t("workflows.publicTrigger.description")}
            </p>
          </div>
          <Toggle
            checked={draft.publicTriggerEnabled}
            onChange={(publicTriggerEnabled) =>
              setDraft((current) => ({ ...current, publicTriggerEnabled }))
            }
            disabled={!editable}
            label={t("workflows.publicTrigger.toggle")}
          />
        </div>

        {draft.publicTriggerEnabled ? (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <label className={labelClass}>
              {t("workflows.publicTrigger.fixedCode")}
              <textarea
                value={draft.publicTriggerCode}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    publicTriggerCode: event.target.value,
                  }))
                }
                className={cn(textAreaClass, "min-h-20 font-mono text-[13px]")}
                placeholder={t("workflows.publicTrigger.fixedCodePlaceholder")}
                disabled={!editable}
              />
              <span className="mt-1 block text-[11px] leading-4 text-muted">
                {t("workflows.publicTrigger.fixedCodeDescription")}
              </span>
            </label>

            {publicTriggerPath && publicTriggerLive ? (
              <div className="rounded-xl border border-success-border bg-success-soft p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-success">
                  {t("workflows.publicTrigger.live")}
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={publicTriggerPath}
                    readOnly
                    aria-label={t("workflows.publicTrigger.url")}
                    className={cn(inputClass, "mt-0 min-w-0 flex-1 font-mono text-[12px]")}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void copyPublicTriggerUrl()}
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                    {t(
                      copiedPublicUrl
                        ? "workflows.publicTrigger.copied"
                        : "workflows.publicTrigger.copy",
                    )}
                  </Button>
                  <a
                    href={publicTriggerPath}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-[12px] font-semibold text-muted-strong transition hover:border-border-strong hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    {t("workflows.publicTrigger.open")}
                  </a>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] leading-4 text-success">
                    {t("workflows.publicTrigger.security")}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void rotatePublicTriggerUrl()}
                    disabled={!editable || dirty}
                  >
                    {rotatingPublicUrl ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCcw className="size-3.5" aria-hidden="true" />
                    )}
                    {t("workflows.publicTrigger.rotate")}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-[12px] leading-5 text-muted">
                {t("workflows.publicTrigger.saveToActivate")}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </FlowStep>
  );
}
