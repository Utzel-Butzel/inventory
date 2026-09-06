"use client";
import { useState } from "react";
import { useT } from "next-i18next/client";
import { ArrowUp, ArrowDown, Copy, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { actionChainReferenceErrors, type ChainAction } from "@/lib/action-chain-contract";
import { ChainValueEditor, ChainConditionsEditor } from "./chain-value";
import { ChainComponentsEditor } from "./chain-components";
import { legacyWorkflowActions, newChainAction, chainTargetResourceId } from "./chain-draft";
import { inputClass, labelClass, Toggle } from "./fields";
import type { StockItem, WorkflowStepProps } from "./types";

export function ChainActionsEditor({ draft, setDraft, editable, resources }: Omit<WorkflowStepProps, "integer" | "t"> & { resources: StockItem[] }) {
  const { t } = useT("scanner");
  const [notice, setNotice] = useState("");
  const actions = legacyWorkflowActions(draft);
  const update = (next: ChainAction[]) => { setNotice(""); setDraft((current) => ({ ...current, actions: next })); };
  const setAction = (index: number, action: ChainAction) => update(actions.map((item, i) => i === index ? action : item));
  const reorder = (index: number, direction: number) => {
    const next = [...actions];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    if (actionChainReferenceErrors(next, draft.inputFields.map((field) => field.key)).length) { setNotice(t("chain.reorderBlocked")); return; }
    update(next);
  };
  return <div className="space-y-4">
    <p className="text-xs leading-5 text-muted">{t("chain.description")}</p>
    <label className="flex items-start gap-2 rounded-lg bg-brand-soft p-3 text-xs leading-5"><input type="checkbox" className="mt-1" disabled={!editable} checked={draft.oncePerCode} onChange={(e) => setDraft((current) => ({ ...current, oncePerCode: e.target.checked }))} /><span>{t("chain.oncePerCode")}</span></label>
    {notice ? <p role="alert" className="text-xs text-danger">{notice}</p> : null}
    {actions.map((action, index) => {
      const previous = actions.slice(0, index);
      const context = { inputs: draft.inputFields, previous, resources, disabled: !editable };
      const change = (next: ChainAction) => setAction(index, next);
      const currentResourceId = chainTargetResourceId(action, draft.resourceIds[0] ?? "", previous);
      return <article key={action.id} className={`rounded-xl border border-border bg-surface p-4 ${action.enabled ? "" : "opacity-65"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-soft text-sm font-semibold text-brand">{index + 1}</span>
          <strong className="mr-auto text-sm">{t(`chain.types.${action.type}`)}</strong>
          <Toggle checked={action.enabled} disabled={!editable} label={t("chain.enableAction", { name: action.label })} onChange={(enabled) => change({ ...action, enabled })} />
          <Button variant="ghost" size="sm" aria-label={t("chain.moveUp")} disabled={!editable || index === 0} onClick={() => reorder(index, -1)}><ArrowUp className="size-4" /></Button>
          <Button variant="ghost" size="sm" aria-label={t("chain.moveDown")} disabled={!editable || index === actions.length - 1} onClick={() => reorder(index, 1)}><ArrowDown className="size-4" /></Button>
          <Button variant="ghost" size="sm" aria-label={t("chain.duplicate")} disabled={!editable || actions.length >= 24} onClick={() => { const copy = { ...structuredClone(action), id: newChainAction(action.type, action.label).id, label: `${action.label} (${t("chain.copy")})` }; update([...actions.slice(0, index + 1), copy, ...actions.slice(index + 1)]); }}><Copy className="size-4" /></Button>
          <Button variant="ghost" size="sm" aria-label={t("chain.removeAction")} disabled={!editable || actions.length === 1} onClick={() => { const next = actions.filter((_, i) => i !== index); if (actionChainReferenceErrors(next, draft.inputFields.map((field) => field.key)).length) setNotice(t("chain.removeBlocked")); else update(next); }}><Trash2 className="size-4 text-danger" /></Button>
        </div>
        <div className="mt-4 space-y-4">
          <label className={labelClass}>{t("chain.actionName")}<input className={inputClass} value={action.label} disabled={!editable} onChange={(e) => change({ ...action, label: e.target.value })} /></label>
          {"target" in action ? <div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>{t("chain.target")}<select className={inputClass} disabled={!editable} value={action.target.source} onChange={(e) => change({ ...action, target: e.target.value === "selected" ? { source: "selected" } : e.target.value === "resource" ? { source: "resource", resourceId: draft.resourceId } : { source: "result", actionId: previous.find((item) => "target" in item)?.id ?? "" } })}><option value="selected">{t("chain.selectedTarget")}</option><option value="resource">{t("chain.otherTarget")}</option><option value="result" disabled={!previous.some((item) => "target" in item)}>{t("chain.previousTarget")}</option></select></label>
            {action.target.source === "resource" ? <label className={labelClass}>{t("chain.otherTarget")}<select className={inputClass} disabled={!editable} value={action.target.resourceId} onChange={(e) => change({ ...action, target: { source: "resource", resourceId: e.target.value } })}><option value="">{t("chain.choose")}</option>{resources.map((item) => <option key={item.resourceId} value={item.resourceId}>{item.name}</option>)}</select></label> : action.target.source === "result" ? <label className={labelClass}>{t("chain.previousAction")}<select className={inputClass} disabled={!editable} value={action.target.actionId} onChange={(e) => change({ ...action, target: { source: "result", actionId: e.target.value } })}><option value="">{t("chain.choose")}</option>{previous.filter((item) => "target" in item).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
          </div> : null}
          {"code" in action && action.target.source !== "result" ? <ChainValueEditor {...context} label={t("chain.unitCode")} value={action.code} onChange={(code) => change({ ...action, code })} /> : null}
          {action.type === "find-unit" ? <label className="flex gap-2 text-xs"><input type="checkbox" disabled={!editable} checked={action.allowMissing} onChange={(e) => change({ ...action, allowMissing: e.target.checked })} />{t("chain.allowMissing")}</label> : null}
          {action.type === "unit" ? <div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>{t("chain.unitMode")}<select className={inputClass} disabled={!editable} value={action.mode} onChange={(e) => change({ ...action, mode: e.target.value as typeof action.mode })}>{["create", "update", "upsert"].map((mode) => <option key={mode} value={mode}>{t(`chain.unitModes.${mode}`)}</option>)}</select></label><label className={labelClass}>{t("chain.status")}<select className={inputClass} disabled={!editable} value={action.status ?? ""} onChange={(e) => change({ ...action, status: (e.target.value || null) as typeof action.status })}><option value="">{t("chain.keepStatus")}</option>{["available", "reserved", "in-use", "maintenance", "consumed", "lost", "retired"].map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}</select></label></div> : null}
          {action.type === "assembly-build" ? <><ChainValueEditor {...context} label={t("chain.quantity")} value={action.quantity} onChange={(quantity) => change({ ...action, quantity })} /><ChainComponentsEditor {...context} action={action} resourceId={currentResourceId} onChange={change} /></> : null}
          {action.type === "stock-adjustment" ? <><ChainValueEditor {...context} label={t("chain.delta")} value={action.delta} onChange={(delta) => change({ ...action, delta })} /><label className={labelClass}>{t("chain.factor")}<select className={inputClass} value={action.factor} disabled={!editable} onChange={(e) => change({ ...action, factor: Number(e.target.value) as 1 | -1 })}><option value={1}>{t("chain.factorPositive")}</option><option value={-1}>{t("chain.factorNegative")}</option></select></label></> : null}
          {action.type === "set-location" ? <><label className="flex gap-2 text-xs"><input type="checkbox" disabled={!editable} checked={action.structured} onChange={(e) => change({ ...action, structured: e.target.checked, location: { source: "literal", value: "" } })} />{t("chain.structuredLocation")}</label><ChainValueEditor {...context} resourceValue={action.structured} label={t("chain.location")} value={action.location} onChange={(location) => change({ ...action, location })} /></> : null}
          {action.type === "assert" ? <><ChainConditionsEditor {...context} label={t("chain.check")} value={action.check} onChange={(check) => { if (check) change({ ...action, check }); }} /><label className={labelClass}>{t("chain.failureMessage")}<input className={inputClass} disabled={!editable} value={action.message} onChange={(e) => change({ ...action, message: e.target.value })} /></label></> : null}
          {action.type === "webhook" ? <label className={labelClass}>{t("chain.eventName")}<input className={inputClass} disabled={!editable} value={action.eventName} onChange={(e) => change({ ...action, eventName: e.target.value })} /><span className="mt-1 block text-xs font-normal text-muted">{t("chain.webhookHelp")}</span></label> : null}
          {"applyFlowValues" in action ? <label className="flex gap-2 text-xs leading-5"><input type="checkbox" disabled={!editable} checked={action.applyFlowValues} onChange={(e) => change({ ...action, applyFlowValues: e.target.checked })} />{t("chain.applyFlowValues")}</label> : null}
          {"properties" in action ? <div className="space-y-3">
            {action.properties.map((property, propertyIndex) => <div key={propertyIndex} className="rounded-lg border border-border p-3">
              <label className={labelClass}>{t("chain.propertyKey")}<input className={inputClass} disabled={!editable} value={property.key} onChange={(e) => change({ ...action, properties: action.properties.map((item, i) => i === propertyIndex ? { ...item, key: e.target.value } : item) } as ChainAction)} /></label>
              {"storage" in property ? <select className={inputClass} aria-label={t("chain.storage")} disabled={!editable} value={property.storage} onChange={(e) => change({ ...action, properties: action.properties.map((item, i) => i === propertyIndex ? { ...item, storage: e.target.value } : item) } as ChainAction)}><option value="metadata">{t("chain.metadata")}</option><option value="custom-field">{t("chain.customField")}</option></select> : null}
              <ChainValueEditor {...context} label={t("chain.value")} value={property.value} onChange={(value) => change({ ...action, properties: action.properties.map((item, i) => i === propertyIndex ? { ...item, value } : item) } as ChainAction)} />
              <Button variant="ghost" size="sm" disabled={!editable} onClick={() => change({ ...action, properties: action.properties.filter((_, i) => i !== propertyIndex) } as ChainAction)}>{t("chain.removeProperty")}</Button>
            </div>)}
            <Button variant="secondary" size="sm" disabled={!editable || action.properties.length >= 24} onClick={() => change({ ...action, properties: [...action.properties, { key: `field${action.properties.length + 1}`, value: { source: "literal", value: "" }, ...(action.type !== "webhook" ? { storage: "metadata" } : {}) }] } as ChainAction)}>{t("chain.addProperty")}</Button>
          </div> : null}
          <ChainConditionsEditor {...context} label={t("chain.runConditionally")} value={action.when} onChange={(when) => change({ ...action, when })} />
        </div>
      </article>;
    })}
    <div className="flex flex-wrap gap-2">{(["find-unit", "unit", "assembly-build", "stock-adjustment", "set-location", "assert", "webhook"] as const).map((type) => <Button variant="secondary" size="sm" key={type} disabled={!editable || actions.length >= 24} onClick={() => update([...actions, newChainAction(type, t(`chain.types.${type}`))])}><Plus className="size-3.5" />{t(`chain.types.${type}`)}</Button>)}</div>
  </div>;
}
