"use client";
import { useEffect, useState } from "react";
import { useT } from "next-i18next/client";
import { fetchJson } from "@/lib/client-types";
import { Button } from "@/components/ui";
import type { ChainAction } from "@/lib/action-chain-contract";
import { ChainValueEditor, type ValueEditorContext } from "./chain-value";
import { inputClass, labelClass } from "./fields";

type AssemblyAction = Extract<ChainAction, { type: "assembly-build" }>;
type Slot = { slotKey: string; name: string; componentResourceId?: string; choices?: Array<{ resourceId: string; name: string }> };
export function ChainComponentsEditor({ action, resourceId, onChange, ...context }: ValueEditorContext & { action: AssemblyAction; resourceId: string; onChange: (action: AssemblyAction) => void }) {
  const { t } = useT("scanner");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSlots([]); setError("");
    if (resourceId) void fetchJson<{ components: Slot[] }>(`/api/v1/resources/${resourceId}/bom`, { cache: "no-store" }).then((value) => { if (active) setSlots(value.components); }).catch((error) => { if (active) setError(error instanceof Error ? error.message : t("chain.loadFailed")); });
    return () => { active = false; };
  }, [resourceId, t]);
  const update = (slotKey: string, component?: AssemblyAction["components"][number]) => onChange({ ...action, components: [...action.components.filter((item) => item.slotKey !== slotKey), ...(component ? [component] : [])] });
  return <div className="space-y-3 border-t border-border pt-3">
    <h4 className="text-sm font-semibold">{t("chain.components")}</h4>
    <p className="text-xs leading-5 text-muted">{t("chain.componentHelp")}</p>
    {action.components.length ? <Button variant="ghost" size="sm" disabled={context.disabled} onClick={() => onChange({ ...action, components: [] })}>{t("chain.resetComponents")}</Button> : null}
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    {!resourceId ? <p className="text-xs text-muted">{t("chain.chooseAssembly")}</p> : null}
    {resourceId && !slots.length && !error ? <p className="text-xs text-muted">{t("chain.noComponents")}</p> : null}
    {slots.map((slot) => {
      const component = action.components.find((item) => item.slotKey === slot.slotKey);
      const mode = component?.unitFromAction ? "unit" : component?.choice ? "choice" : component?.resource ? "resource" : "default";
      return <div className="rounded-lg border border-border p-3" key={slot.slotKey}>
        <label className={labelClass}>{slot.name}<select className={inputClass} disabled={context.disabled} value={mode} onChange={(e) => update(slot.slotKey, e.target.value === "default" ? undefined : e.target.value === "unit" ? { slotKey: slot.slotKey, unitFromAction: context.previous.find((item) => item.type === "find-unit" || item.type === "unit")?.id ?? "" } : e.target.value === "choice" ? { slotKey: slot.slotKey, choice: { inputKey: context.inputs.find((item) => item.options.length)?.key ?? "", resources: {} } } : { slotKey: slot.slotKey, resource: { source: "literal", value: slot.choices?.[0]?.resourceId ?? "" } })}>
          <option value="default">{t("chain.componentDefault")}</option><option value="unit" disabled={!context.previous.length}>{t("chain.componentUnit")}</option><option value="resource">{t("chain.componentVariant")}</option><option value="choice" disabled={!context.inputs.some((item) => item.options.length)}>{t("chain.componentInput")}</option>
        </select></label>
        {mode === "unit" ? <select className={inputClass} aria-label={t("chain.previousAction")} disabled={context.disabled} value={component?.unitFromAction} onChange={(e) => update(slot.slotKey, { slotKey: slot.slotKey, unitFromAction: e.target.value })}><option value="">{t("chain.choose")}</option>{context.previous.filter((item) => ["find-unit", "unit", "assembly-build", "set-location"].includes(item.type)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : null}
        {mode === "resource" && component?.resource ? <ChainValueEditor {...context} resources={(slot.choices ?? []).map((item) => ({ ...item, trackingMode: "bulk" }))} value={component.resource} label={t("chain.componentVariant")} resourceValue onChange={(resource) => update(slot.slotKey, { slotKey: slot.slotKey, resource })} /> : null}
        {mode === "choice" && component?.choice ? <div className="mt-2 space-y-2">
          <select className={inputClass} aria-label={t("chain.input")} disabled={context.disabled} value={component.choice.inputKey} onChange={(e) => update(slot.slotKey, { slotKey: slot.slotKey, choice: { inputKey: e.target.value, resources: {} } })}><option value="">{t("chain.choose")}</option>{context.inputs.filter((field) => field.options.length).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select>
          {context.inputs.find((field) => field.key === component.choice?.inputKey)?.options.map((option) => <label key={option.value} className={labelClass}>{option.label}<select className={inputClass} disabled={context.disabled} value={component.choice?.resources[option.value] ?? ""} onChange={(e) => update(slot.slotKey, { slotKey: slot.slotKey, choice: { inputKey: component.choice!.inputKey, resources: { ...component.choice!.resources, [option.value]: e.target.value } } })}><option value="">{t("chain.choose")}</option>{slot.choices?.map((choice) => <option key={choice.resourceId} value={choice.resourceId}>{choice.name}</option>)}</select></label>)}
        </div> : null}
      </div>;
    })}
  </div>;
}
