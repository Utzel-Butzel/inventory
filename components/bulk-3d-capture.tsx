"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { LoaderCircle, X } from "lucide-react";
import { prepareBulkCountPhoto } from "@/lib/bulk-count-photo";
import { bulk3dInputSchema, bulk3dJobSchema, bulk3dStateSchema, bulk3dMaxImageBytes, type Bulk3dAppliedResult, type Bulk3dInput, type Bulk3dResult } from "@/lib/inventory-bulk-3d";
import { Bulk3dAnnotations, emptyBulk3dMarks } from "@/components/bulk-3d-annotations";
import { Bulk3dModel } from "@/components/bulk-3d-model";

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold disabled:opacity-50";
const views = ["top", "side", "opposite", "end"] as const;
const knownErrors = ["upload", "invalidRequest", "notConfigured", "unavailable", "duplicatePhotos", "conflict", "processing", "disabled", "rateLimit", "analysisFailed", "timeout", "expired", "notFound"];
const defaults: Bulk3dInput["assumptions"] = { shape: "cuboid", widthRatio: .8, heightRatio: .8, packing: .6, floorOffset: .6 };

async function wait(signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2500);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
}

export function Bulk3dCapture({ itemId, unitName, disabled, onBusyChange, onCount }: {
  itemId: string; unitName: string; disabled?: boolean; onBusyChange: (busy: boolean) => void; onCount: (result: Bulk3dAppliedResult) => void;
}) {
  const { t, i18n } = useT("counting");
  const id = useId();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<Array<File | null>>([null, null, null, null]);
  const [urls, setUrls] = useState<string[]>([]);
  const [marks, setMarks] = useState(emptyBulk3dMarks);
  const [assumptions, setAssumptions] = useState(defaults);
  const [preparing, setPreparing] = useState(false), [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("queued");
  const [job, setJob] = useState<{ jobId: string; expiresAt: string } | null>(null);
  const [result, setResult] = useState<Bulk3dResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [applied, setApplied] = useState(false);
  const controller = useRef<AbortController | null>(null), attempt = useRef<string | null>(null), generation = useRef(0);
  const locked = busy || preparing || Boolean(disabled);

  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/v1/ai/count/3d?itemId=${itemId}`, { signal: abort.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((value) => setAvailable(value.available === true)).catch(() => { if (!abort.signal.aborted) setAvailable(false); });
    return () => abort.abort();
  }, [itemId]);
  useEffect(() => {
    const next = photos.map((photo) => photo ? URL.createObjectURL(photo) : ""); setUrls(next);
    return () => next.forEach((url) => { if (url) URL.revokeObjectURL(url); });
  }, [photos]);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  useEffect(() => { onBusyChange(busy || preparing); return () => onBusyChange(false); }, [busy, preparing, onBusyChange]);
  function invalidate() {
    generation.current++; controller.current?.abort(); attempt.current = null; setJob(null); setResult(null); setError(null); setAcknowledged(false); setApplied(false);
  }
  async function selectPhoto(index: number, file: File | undefined) {
    if (!file || locked) return;
    invalidate(); const version = generation.current; setPreparing(true);
    try {
      if (file.size > bulk3dMaxImageBytes) throw new Error(t("threeD.errors.upload"));
      const prepared = await prepareBulkCountPhoto(file);
      if (prepared.size > bulk3dMaxImageBytes) throw new Error(t("threeD.errors.upload"));
      if (version !== generation.current) return;
      setPhotos((old) => old.map((value, i) => i === index ? prepared : value));
      if (index === 0) setMarks(emptyBulk3dMarks());
    } catch { if (version === generation.current) setError(t("threeD.errors.upload")); }
    finally { if (version === generation.current) setPreparing(false); }
  }
  async function run() {
    if (locked || !available) return;
    const parsed = bulk3dInputSchema.safeParse({ itemId, language: (i18n.resolvedLanguage ?? i18n.language).startsWith("de") ? "de" : "en", marks, assumptions });
    if (!parsed.success || photos.slice(0, 3).some((photo) => !photo)) { setError(t("threeD.errors.marks")); return; }
    const abort = new AbortController(); controller.current = abort;
    const version = generation.current;
    setBusy(true); setError(null); setResult(null); setAcknowledged(false); setApplied(false);
    let current = job;
    const request = async (url: string, options?: RequestInit) => {
      const response = await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
      const value = await response.json();
      if (!response.ok) {
        const code = typeof value.code === "string" && knownErrors.includes(value.code) ? value.code : "unavailable";
        if (["expired", "notFound", "conflict"].includes(code)) { attempt.current = null; setJob(null); }
        throw new Error(t(`threeD.errors.${code}`));
      }
      return value;
    };
    try {
      if (!current) {
        setPhase("queued");
        const form = new FormData(); form.append("input", JSON.stringify(parsed.data));
        for (const photo of photos) if (photo) form.append("images", photo);
        attempt.current ??= crypto.randomUUID();
        current = bulk3dJobSchema.parse(await request("/api/v1/ai/count/3d", { method: "POST", body: form, headers: { "Idempotency-Key": attempt.current } }));
        if (version !== generation.current) return;
        setJob(current);
      }
      const deadline = Date.now()+630_000;
      while (Date.now() < deadline) {
        const state = bulk3dStateSchema.parse(await request(`/api/v1/ai/count/3d/${current.jobId}`));
        if (version !== generation.current) return;
        if (state.status === "completed") { setResult(state.result); attempt.current = null; return; }
        if (state.status === "failed") { setJob(null); attempt.current = null; throw new Error(t(`threeD.errors.${state.code}`)); }
        setPhase(state.status); await wait(abort.signal);
      }
      throw new Error(t("threeD.errors.timeout"));
    } catch (caught) {
      if (version === generation.current) setError(caught instanceof Error && !["AbortError", "TimeoutError", "ZodError", "TypeError"].includes(caught.name) ? caught.message : t("threeD.errors.unavailable"));
    } finally { if (version === generation.current) setBusy(false); }
  }
  return <div className="space-y-4">
    <div className="rounded-xl border border-warning-border bg-warning-soft p-3.5 text-xs leading-5 text-muted-strong">
      <p className="font-semibold">{t("threeD.intro")}</p><p className="mt-1">{t("threeD.guide")}</p>
    </div>
    {available === false ? <p role="status" className="rounded-xl border border-border p-3 text-xs text-muted-strong">{t("threeD.errors.notConfigured")}</p> : null}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {views.map((view, index) => <div key={view}>
        <label htmlFor={`${id}-${view}`} className="mb-1 block text-xs font-semibold">{t(`bulk.views.${view}`)}</label>
        <input id={`${id}-${view}`} type="file" accept="image/*,.heic,.heif" disabled={locked} className="block w-full text-xs text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-surface-muted file:px-2 file:py-2 file:text-foreground"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void selectPhoto(index, file); }} />
        {urls[index] ? <div className="relative mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[index]} alt={t(`bulk.views.${view}`)} className="aspect-[4/3] w-full rounded-lg bg-surface-muted object-contain" />
          <button type="button" disabled={locked} aria-label={t("bulk.removePhoto", { view: t(`bulk.views.${view}`) })} className="absolute right-1 top-1 rounded-lg bg-surface p-1 text-foreground" onClick={() => {
            invalidate(); setPhotos((old) => old.map((file, i) => i === index ? null : file)); if (index === 0) setMarks(emptyBulk3dMarks());
          }}><X className="size-4" /></button>
        </div> : null}
      </div>)}
    </div>
    <p className="text-xs leading-5 text-muted">{t("threeD.privacy")}</p>
    {urls[0] ? <Bulk3dAnnotations key={urls[0]} src={urls[0]} marks={marks} disabled={locked} onChange={(value) => { invalidate(); setMarks(value); }} /> : null}
    <label className="block text-xs font-semibold">{t("threeD.shapeLabel")}
      <select disabled={locked} value={assumptions.shape} onChange={(event) => { invalidate(); setAssumptions((old) => ({ ...old, shape: event.target.value as Bulk3dInput["assumptions"]["shape"] })); }} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2 text-sm">
        {(["cuboid", "ellipsoid", "triangular_prism"] as const).map((shape) => <option key={shape} value={shape}>{t(`threeD.shapes.${shape}`)}</option>)}
      </select>
    </label>
    <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-xs font-semibold">{t("threeD.assumptionsTitle")}</summary>
      <p className="mt-2 text-xs leading-5 text-muted">{t("threeD.assumptionsHelp")}</p>
      {(["widthRatio", "heightRatio", "packing", "floorOffset"] as const).map((key) => <label key={key} className="mt-3 block text-xs">
        {t(`threeD.parameters.${key}`)}: <span className="tabular-nums">{number.format(key === "floorOffset" ? assumptions[key] : assumptions[key]*100)}{key !== "floorOffset" ? "%" : ""}</span>
        <input type="range" disabled={locked} className="mt-2 block w-full" min={key === "floorOffset" ? 0 : .1} max={key === "packing" ? 1 : key === "floorOffset" ? 3 : 2} step="0.05" value={assumptions[key]}
          onChange={(event) => { invalidate(); setAssumptions((old) => ({ ...old, [key]: Number(event.target.value) })); }} />
      </label>)}
    </details>
    <button type="button" disabled={locked || !available || photos.slice(0, 3).some((p) => !p)} onClick={() => void run()} className={`${button} bg-brand-solid text-on-brand hover:bg-brand-hover`}>
      {busy || preparing ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {preparing ? t("upload.preparing") : busy ? t(`threeD.phases.${phase}`) : job && !result ? t("threeD.resume") : t("threeD.start")}
    </button>
    {busy ? <p role="status" className="text-xs text-muted">{t("threeD.waitHelp")}</p> : null}
    {error ? <p role="alert" className="rounded-xl border border-danger-border bg-danger-soft p-3 text-xs text-danger">{error}</p> : null}
    {result && job ? <div className="space-y-3 rounded-xl border border-warning-border p-4" aria-live="polite">
      <Bulk3dModel src={`/api/v1/ai/count/3d/${job.jobId}?asset=model`} />
      {result.estimate ? <>
        <p className="text-2xl font-bold tabular-nums">{t("bulk.approximate", { value: number.format(result.estimate.count), unit: unitName })}</p>
        <p className="text-sm tabular-nums">{t("threeD.range", { lower: number.format(result.estimate.lowerBound), upper: number.format(result.estimate.upperBound) })}</p>
      </> : <p className="text-sm font-semibold">{t("bulk.insufficient")}</p>}
      <p className="text-xs font-semibold leading-5 text-warning">{t("threeD.accuracy")}</p>
      <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-muted-strong">{result.warningCodes.map((code) => <li key={code}>{t(`threeD.warnings.${code}`)}</li>)}</ul>
      {result.estimate ? <>
        <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={acknowledged} disabled={applied || disabled} onChange={(event) => setAcknowledged(event.target.checked)} />{t("threeD.acknowledge")}</label>
        <button type="button" disabled={!acknowledged || applied || disabled} className={`${button} bg-brand-solid text-on-brand`} onClick={() => {
          if (!result.estimate || !acknowledged) return; onCount({ method: "bulk_3d", model: result.model, ...result.estimate }); setApplied(true);
        }}>{t(applied ? "bulk.applied" : "bulk.apply")}</button>
      </> : null}
      <p className="text-xs text-muted">{t("threeD.provenance", { images: result.imageCount, samples: result.sampleCount })}</p>
    </div> : null}
  </div>;
}
