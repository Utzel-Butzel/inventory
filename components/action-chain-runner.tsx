"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "next-i18next/client";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { CodeScannerCamera } from "@/components/code-scanner-camera";
import { fetchJson } from "@/lib/client-types";
import { visibleFlowInputs } from "@/lib/action-chain-contract";
import type { ScanWorkflowDto } from "@/lib/scan-workflow-contract";
import type { ChainRunInput, ChainRunReport } from "@/lib/action-chain-engine";
import type { ScanWorkflowTargetGroup } from "@/lib/scan-workflows";
import { extractIdentifier } from "@/components/stock-workflow/validation";
import { extractionToDraft } from "@/components/stock-workflow/draft";
import { inputClass, labelClass } from "@/components/stock-workflow/fields";
import type { ScanCodeType } from "@/lib/scan-code-types";

type RunnerConfig = Pick<ScanWorkflowDto, "id" | "name" | "description" | "extraction" | "codeTypes" | "inputFields" | "targetSelectionMode"> & { fixedCode: string | null; targetGroups: ScanWorkflowTargetGroup[] };
export function ActionChainRunner({ workflowId, publicTriggerId, canExecute = true, onBusyChange }: { workflowId?: string; publicTriggerId?: string; canExecute?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const { t } = useT("scanner");
  const [config, setConfig] = useState<RunnerConfig | null>(null);
  const [code, setCode] = useState("");
  const [codeType, setCodeType] = useState<ScanCodeType | null>(null);
  const [inputs, setInputs] = useState<ChainRunInput["inputs"]>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ChainRunReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [requestBody, setRequestBody] = useState<ChainRunInput | null>(null);
  const executionKey = useRef("");
  const uploaded = useRef<Record<string, string[]>>({});
  const uploadKeys = useRef<Record<string, string>>({});
  const configUrl = publicTriggerId ? `/api/public/action-flows/${publicTriggerId}/chain` : `/api/v1/stock/scan-workflows/${workflowId}/runner`;
  const endpoint = publicTriggerId ? `/api/public/action-flows/${publicTriggerId}/chain` : "/api/v1/stock/action-chains";
  useEffect(() => {
    let active = true;
    setConfig(null); setError(""); uploaded.current = {}; uploadKeys.current = {}; executionKey.current = ""; setRequestBody(null);
    void fetchJson<{ workflow: RunnerConfig }>(configUrl, { cache: "no-store" }).then(({ workflow }) => {
      if (!active) return;
      setConfig(workflow); setCode(workflow.fixedCode ?? ""); setInputs({}); setFiles({}); setReport(null); setComplete(false);
      setSelected(Object.fromEntries(workflow.targetGroups.filter((_, i) => workflow.targetSelectionMode === "all" || (workflow.targetSelectionMode === "radio" && i === 0)).map((group) => [group.resourceId, group.options[0]?.id ?? ""])));
    }).catch((error) => { if (active) setError(error instanceof Error ? error.message : t("chain.loadFailed")); });
    return () => { active = false; };
  }, [configUrl, t]);
  const invalidate = () => { setReport(null); setComplete(false); setRequestBody(null); executionKey.current = ""; setError(""); };
  const context = { identifier: config ? extractIdentifier(code, extractionToDraft(config.extraction), t).value ?? "" : "", raw: code, inputs, results: {} };
  const visibleFields = config ? visibleFlowInputs(config.inputFields, context) : [];
  const preview = async () => {
    if (!config) return;
    setBusy(true); onBusyChange?.(true); setError(""); setReport(null);
    try {
      const selectedResourceIds = Object.values(selected).filter(Boolean);
      if (!selectedResourceIds.length) throw new Error(t("chain.chooseTarget"));
      const values = Object.fromEntries(visibleFields.filter((field) => Object.hasOwn(inputs, field.key)).map((field) => [field.key, inputs[field.key]]));
      for (const field of visibleFields) {
        if (field.type !== "media" && field.type !== "file") continue;
        if (publicTriggerId && (field.required || files[field.key]?.length)) throw new Error(t("chain.publicUploadUnsupported"));
        if (files[field.key]?.length && !uploaded.current[field.key]) {
          const body = new FormData();
          files[field.key].forEach((file) => body.append("files", file));
          const response = await fetchJson<{ uploaded: Array<{ id: string }> }>(`/api/v1/resources/${selectedResourceIds[0]}/media`, { method: "POST", body, headers: { "Idempotency-Key": uploadKeys.current[field.key] ??= crypto.randomUUID() } });
          uploaded.current[field.key] = response.uploaded.map((item) => item.id);
        }
        if (uploaded.current[field.key]) values[field.key] = uploaded.current[field.key];
      }
      const body: ChainRunInput = { workflowId: config.id, code, codeType, inputs: values, selectedResourceIds };
      const next = await fetchJson<ChainRunReport>(`${endpoint}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setReport(next); setRequestBody({ ...body, expectedPlanHash: next.planHash }); executionKey.current = crypto.randomUUID();
      if (next.replayed) setComplete(true);
    } catch (error) { setError(error instanceof Error ? error.message : t("chain.failed")); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  const execute = async () => {
    if (!requestBody || !canExecute || !executionKey.current) return;
    setBusy(true); onBusyChange?.(true); setError("");
    try {
      const next = await fetchJson<ChainRunReport>(`${endpoint}/execute`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": executionKey.current }, body: JSON.stringify(requestBody) });
      setReport(next); setComplete(true);
    } catch (error) { setError(error instanceof Error ? error.message : t("chain.failed")); }
    finally { setBusy(false); onBusyChange?.(false); }
  };
  return <Card className="space-y-5 p-5">
    {error ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{error}</p> : null}
    {!config && !error ? <LoaderCircle className="size-5 animate-spin" aria-label={t("chain.loading")} /> : null}
    {config && !complete ? <>
      {!config.fixedCode ? <><CodeScannerCamera disabled={busy} allowedFormats={config.codeTypes} onDetected={(code, _source, type) => { invalidate(); setCode(code); setCodeType(type); }} /><label className={labelClass}>{t("chain.scannedCode")}<input className={inputClass} value={code} disabled={busy} onChange={(e) => { invalidate(); setCode(e.target.value); setCodeType(null); }} /></label></> : null}
      {config.targetGroups.map((group) => <div key={group.resourceId} className="rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-semibold">{config.targetSelectionMode !== "all" ? <input type={config.targetSelectionMode === "radio" ? "radio" : "checkbox"} name="chain-target" checked={Boolean(selected[group.resourceId])} disabled={busy} onChange={(e) => { invalidate(); uploaded.current = {}; uploadKeys.current = {}; setSelected((current) => { if (config.targetSelectionMode === "radio") return { [group.resourceId]: group.options[0].id }; const next = { ...current }; if (e.target.checked) next[group.resourceId] = group.options[0].id; else delete next[group.resourceId]; return next; }); }} /> : null}{group.name}</label>
        {selected[group.resourceId] && group.options.length > 1 ? <select aria-label={t("chain.variantFor", { name: group.name })} className={inputClass} value={selected[group.resourceId]} disabled={busy} onChange={(e) => { invalidate(); uploaded.current = {}; uploadKeys.current = {}; setSelected((current) => ({ ...current, [group.resourceId]: e.target.value })); }}>{group.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select> : null}
      </div>)}
      <div className="grid gap-4 sm:grid-cols-2">{visibleFields.map((field) => {
        const change = (value: ChainRunInput["inputs"][string]) => { invalidate(); setInputs((current) => ({ ...current, [field.key]: value })); };
        return <label className={labelClass} key={field.key}>{field.label}{field.required ? " *" : ""}
          {field.type === "select" || field.type === "radio" ? <select className={inputClass} value={String(inputs[field.key] ?? "")} disabled={busy} onChange={(e) => change(e.target.value)}><option value="">{t("chain.choose")}</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "checkbox" ? <input type="checkbox" className="ml-3" checked={inputs[field.key] === true} disabled={busy} onChange={(e) => change(e.target.checked)} /> : field.type === "textarea" ? <textarea className={`${inputClass} h-24 py-2`} value={String(inputs[field.key] ?? "")} disabled={busy} onChange={(e) => change(e.target.value)} /> : field.type === "media" || field.type === "file" ? <><input className={inputClass} type="file" multiple accept={field.type === "media" ? "image/*,video/*" : undefined} disabled={busy || Boolean(publicTriggerId)} onChange={(e) => { invalidate(); delete uploaded.current[field.key]; delete uploadKeys.current[field.key]; setFiles((current) => ({ ...current, [field.key]: Array.from(e.target.files ?? []) })); }} />{publicTriggerId ? <span className="mt-1 block text-xs font-normal text-muted">{t("chain.publicUploadUnsupported")}</span> : null}</> : <input className={inputClass} placeholder={field.placeholder} type={field.type === "number" ? "number" : "text"} value={String(inputs[field.key] ?? "")} disabled={busy} onChange={(e) => change(field.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />}
        </label>;
      })}</div>
      <Button variant="secondary" disabled={busy || !code.trim()} onClick={() => void preview()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("chain.review")}</Button>
    </> : null}
    {report ? <section className="space-y-3" aria-label={t("chain.reviewTitle")}>
      <h3 className="flex items-center gap-2 font-semibold">{complete ? <CheckCircle2 className="size-5 text-success" /> : null}{t(complete ? report.replayed ? "chain.alreadyCompleted" : "chain.completed" : "chain.reviewTitle")}</h3>
      <ol className="space-y-3">{report.steps.map((step, index) => <li key={`${step.id}-${index}`} className="rounded-lg border border-border p-3 text-sm">
        <strong>{index + 1}. {step.label}</strong><span className="ml-2 text-xs text-muted">{t(step.skipped ? "chain.skipped" : `chain.types.${step.type}`)}</span>
        {!step.skipped ? <div className="mt-2 space-y-1 text-xs text-muted-strong">
          {step.target ? <p>{step.target}{step.code ? ` · ${step.code}` : ""}</p> : null}
          {step.eventName ? <p>{t("chain.eventName")}: {step.eventName}</p> : null}
          {step.quantityBefore !== undefined ? <p>{t("chain.stockChange", { before: step.quantityBefore, after: step.quantityAfter ?? step.quantityBefore })}</p> : null}
          {step.statusAfter ? <p>{t("chain.status")}: {step.statusBefore ? `${t(`statuses.${step.statusBefore}`)} → ` : ""}{t(`statuses.${step.statusAfter}`)}</p> : null}
          {step.locationAfter !== undefined ? <p>{t("chain.location")}: {step.locationBefore ?? "—"} → {step.locationAfter ?? "—"}</p> : null}
          {Object.entries({ ...step.metadata, ...step.customFields }).map(([key, value]) => <p key={key}>{key}: {typeof value === "object" ? JSON.stringify(value) : String(value)}</p>)}
          {step.components?.map((component, i) => <p key={i}>{t("chain.consume", { quantity: component.quantity, name: component.name })}{component.codes.length ? ` · ${component.codes.join(", ")}` : ""}</p>)}
        </div> : null}
      </li>)}</ol>
      {!complete ? <><p className="text-xs leading-5 text-muted">{t("chain.atomicHelp")}</p><Button disabled={busy || !canExecute} onClick={() => void execute()}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("chain.confirm")}</Button></> : <Button variant="secondary" onClick={() => { invalidate(); setCode(config?.fixedCode ?? ""); setInputs({}); setFiles({}); uploaded.current = {}; uploadKeys.current = {}; }}>{t("chain.next")}</Button>}
    </section> : null}
  </Card>;
}
