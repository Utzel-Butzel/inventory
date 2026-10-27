"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { AlertTriangle, Check, ImagePlus, LoaderCircle, X } from "lucide-react";
import { prepareBulkCountPhoto } from "@/lib/bulk-count-photo";
import {
  bulkCountInputSchema,
  bulkCountResponseSchema,
  maximumBulkCountImageBytes,
  minimumBulkCountImages,
  type BulkCountAppliedResult,
  type BulkCountResponse,
} from "@/lib/inventory-bulk-count";

type Props = {
  itemId: string;
  itemName: string;
  unitName: string;
  disabled?: boolean;
  allowZero?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onCount: (result: BulkCountAppliedResult) => void;
};

type Dimensions = { lengthMm: string; widthMm: string; heightMm: string };
const emptyDimensions = (): Dimensions => ({ lengthMm: "", widthMm: "", heightMm: "" });
const axes = ["lengthMm", "widthMm", "heightMm"] as const;
const views = ["top", "side", "opposite", "end", "detail"] as const;
const inputClass = "mt-1 w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm text-foreground disabled:opacity-50";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50";

function ImagePreview({ file, alt }: { file: File; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt} className="aspect-[4/3] w-full rounded-lg object-contain bg-surface-muted" /> : null;
}

export function BulkCountCapture({ itemId, itemName, unitName, disabled, allowZero = false, onBusyChange, onCount }: Props) {
  const { t, i18n } = useT("counting");
  const id = useId();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  const [photos, setPhotos] = useState<Array<File | null>>(() => views.map(() => null));
  const [container, setContainer] = useState<Dimensions>(emptyDimensions);
  const [part, setPart] = useState<Dimensions>(emptyDimensions);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkCountResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef<string | null>(null);
  const generation = useRef(0);

  useEffect(() => () => {
    generation.current += 1;
    controller.current?.abort();
  }, []);

  useEffect(() => {
    onBusyChange?.(busy || preparing);
    return () => onBusyChange?.(false);
  }, [busy, preparing, onBusyChange]);

  function invalidate() {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    attempt.current = null;
    setResult(null);
    setApplied(false);
    setError(null);
  }

  async function selectPhoto(index: number, file: File | undefined) {
    if (!file) return;
    invalidate();
    const version = generation.current;
    setPreparing(true);
    try {
      if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) throw new Error(t("errors.imageFormat"));
      if (file.size > maximumBulkCountImageBytes) throw new Error(t("bulk.errors.upload"));
      const prepared = await prepareBulkCountPhoto(file);
      if (prepared.size > maximumBulkCountImageBytes) throw new Error(t("bulk.errors.upload"));
      if (version === generation.current) setPhotos((current) => current.map((entry, i) => i === index ? prepared : entry));
    } catch (error) {
      if (version === generation.current) setError(error instanceof Error ? error.message : t("errors.preparePhoto"));
    } finally {
      if (version === generation.current) setPreparing(false);
    }
  }

  async function estimate() {
    if (busy || preparing || disabled) return;
    const dimensions = (value: Dimensions) => axes.every((axis) => !value[axis].trim())
      ? null : Object.fromEntries(axes.map((axis) => [axis, Number(value[axis].replace(",", "."))]));
    const parsed = bulkCountInputSchema.safeParse({
      itemId,
      itemHint: itemName,
      language: (i18n.resolvedLanguage ?? i18n.language).startsWith("de") ? "de" : "en",
      containerDimensions: dimensions(container),
      partDimensions: dimensions(part),
    });
    if (!parsed.success) { setError(t("bulk.errors.dimensions")); return; }
    const selected = photos.filter((photo): photo is File => photo !== null);
    if (selected.length < minimumBulkCountImages) { setError(t("bulk.errors.photos")); return; }
    const requestController = new AbortController();
    controller.current = requestController;
    const version = generation.current;
    const key = attempt.current ?? crypto.randomUUID();
    attempt.current = key;
    const timeout = window.setTimeout(() => requestController.abort(), 115_000);
    setBusy(true);
    setError(null);
    setResult(null);
    setApplied(false);
    try {
      const body = new FormData();
      body.append("input", JSON.stringify(parsed.data));
      for (const photo of selected) body.append("images", photo);
      const response = await fetch("/api/v1/ai/count/bulk", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body,
        signal: requestController.signal,
      });
      const payload: unknown = await response.json();
      if (version !== generation.current) return;
      if (!response.ok) {
        const code = payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string" ? payload.code : "analysisFailed";
        const known = ["upload", "duplicatePhotos", "invalidRequest", "notConfigured", "unavailable", "conflict", "processing", "disabled", "rateLimit", "budget", "analysisFailed"];
        // Keep the key for processing/transport failures; an explicit terminal
        // provider failure can be retried as a new paid attempt by the user.
        if (payload && typeof payload === "object" && "terminal" in payload && payload.terminal === true) attempt.current = null;
        if (code === "conflict") attempt.current = null;
        throw new Error(t(`bulk.errors.${known.includes(code) ? code : "analysisFailed"}`));
      }
      const validated = bulkCountResponseSchema.safeParse(payload);
      if (!validated.success) throw new Error(t("bulk.errors.analysisFailed"));
      setResult(validated.data);
      attempt.current = null;
    } catch (error) {
      if (version === generation.current) setError(requestController.signal.aborted ? t("bulk.errors.timeout") : error instanceof Error ? error.message : t("bulk.errors.analysisFailed"));
    } finally {
      window.clearTimeout(timeout);
      if (version === generation.current) setBusy(false);
      if (controller.current === requestController) controller.current = null;
    }
  }

  const locked = busy || preparing || disabled;
  const estimateResult = result?.estimate;

  return <div className="space-y-4">
    <div className="rounded-xl border border-brand-border bg-brand-soft p-3.5 text-xs leading-5 text-muted-strong">
      <p className="font-semibold text-foreground">{t("bulk.intro")}</p>
      <p className="mt-1">{t("bulk.guide")}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      {views.map((view, index) => <div key={view} className="min-w-0">
        <label htmlFor={`${id}-${view}`} className="mb-1.5 block text-xs font-semibold text-foreground">{t(`bulk.views.${view}`)}</label>
        <input id={`${id}-${view}`} type="file" accept="image/*,.heic,.heif" capture="environment" disabled={locked} className="sr-only"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void selectPhoto(index, file); }} />
        {photos[index] ? <div className="relative">
          <ImagePreview file={photos[index]} alt={t(`bulk.views.${view}`)} />
          <button type="button" disabled={locked} aria-label={t("bulk.removePhoto", { view: t(`bulk.views.${view}`) })}
            onClick={() => { invalidate(); setPhotos((current) => current.map((photo, i) => i === index ? null : photo)); }}
            className="absolute right-1 top-1 rounded-lg bg-slate-950/80 p-1.5 text-white disabled:opacity-40"><X className="size-4" /></button>
        </div> : <label htmlFor={locked ? undefined : `${id}-${view}`} className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-surface-subtle px-3 text-center text-xs text-muted ${locked ? "opacity-50" : "cursor-pointer hover:border-brand-border"}`}>
          <ImagePlus className="size-5" aria-hidden="true" />{t("bulk.addPhoto")}
        </label>}
      </div>)}
    </div>
    <p className="text-[11px] leading-4 text-muted">{t("bulk.privacy")}</p>
    <details className="rounded-xl border border-border p-3.5">
      <summary className="cursor-pointer text-xs font-semibold text-muted-strong">{t("bulk.dimensionsTitle")}</summary>
      <p className="mt-2 text-xs leading-5 text-muted">{t("bulk.dimensionsHelp")}</p>
      {([ ["container", container, setContainer], ["part", part, setPart] ] as const).map(([name, values, setValues]) => <fieldset key={name} className="mt-3" disabled={locked}>
        <legend className="text-xs font-semibold text-foreground">{t(`bulk.${name}Dimensions`)}</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">{axes.map((axis) => <label key={axis} className="text-[11px] text-muted">
          {t(`bulk.axes.${axis}`)}
          <input type="text" inputMode="decimal" value={values[axis]} maxLength={10} className={inputClass}
            onChange={(event) => { invalidate(); setValues((current) => ({ ...current, [axis]: event.target.value })); }} />
        </label>)}</div>
      </fieldset>)}
    </details>
    <button type="button" disabled={locked || photos.filter(Boolean).length < minimumBulkCountImages} onClick={() => void estimate()}
      className={`${buttonClass} bg-brand-solid text-on-brand hover:bg-brand-hover`}>
      {busy || preparing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
      {busy ? t("bulk.analyzing") : preparing ? t("upload.preparing") : t("bulk.analyze")}
    </button>
    {error ? <p role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs leading-5 text-danger">{error}</p> : null}
    {result ? <div aria-live="polite" className="space-y-3 rounded-xl border border-warning-border bg-warning-soft p-4">
      {estimateResult ? <>
        <p className="text-xs font-semibold text-muted-strong">{t("bulk.resultTitle")}</p>
        <p className="text-2xl font-bold tabular-nums text-foreground">{t("bulk.approximate", { value: number.format(estimateResult.count), unit: unitName })}</p>
        <p className="text-sm tabular-nums text-muted-strong">{t("bulk.range", { lower: number.format(estimateResult.lowerBound), upper: number.format(estimateResult.upperBound) })}</p>
      </> : <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="size-4 shrink-0" />{t("bulk.insufficient")}</p>}
      <p className="text-xs leading-5 text-muted-strong">{result.explanation}</p>
      <p className="text-xs font-semibold leading-5 text-warning">{t("bulk.accuracy")}</p>
      {result.analysis ? <details className="rounded-lg border border-warning-border p-3 text-xs leading-5 text-muted-strong">
        <summary className="cursor-pointer font-semibold">{t("bulk.analysisTitle")}</summary>
        <p className="mt-2">{t("bulk.analysisHelp")}</p>
        {result.analysis.methods.map((method) => <div key={method.strategy} className="mt-3">
          <p className="font-semibold">{t(`bulk.methods.${method.strategy}`)}: {method.estimate ? number.format(method.estimate.count) : t("bulk.noEstimate")}</p>
          <p>{method.observation.explanation}</p>
          <ul className="mt-1 list-disc pl-4">{method.observation.views.map((view) => <li key={view.image}>
            {t("bulk.imageEvidence", { image: view.image })}: {view.evidence}
          </li>)}</ul>
        </div>)}
      </details> : null}
      {([ ["assumptions", result.assumptions], ["warnings", result.warnings], ["captureAdvice", result.captureAdvice] ] as const).map(([name, entries]) => entries.length ? <div key={name} className="text-xs leading-5 text-muted-strong">
        <p className="font-semibold">{t(`bulk.${name}`)}</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">{entries.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
      </div> : null)}
      {estimateResult && (estimateResult.count > 0 || allowZero) ? <button type="button" disabled={disabled || applied} className={`${buttonClass} bg-brand-solid text-on-brand hover:bg-brand-hover`}
        onClick={() => { onCount({ method: "bulk_visual", ...estimateResult, model: result.model }); setApplied(true); }}>
        {applied ? <Check className="size-4" aria-hidden="true" /> : null}{t(applied ? "bulk.applied" : "bulk.apply")}
      </button> : null}
      <p className="text-[11px] text-muted">{t("bulk.model", { model: result.model })}</p>
    </div> : null}
  </div>;
}
