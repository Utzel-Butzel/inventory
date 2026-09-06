"use client";
import { useT } from "next-i18next/client";
import type { ActionValue, ActionConditions, ChainAction } from "@/lib/action-chain-contract";
import type { InputField, StockItem } from "./types";
import { inputClass, labelClass } from "./fields";
import { Button } from "@/components/ui";

export type ValueEditorContext = { inputs: InputField[]; previous: ChainAction[]; resources: StockItem[]; disabled: boolean };
export function ChainValueEditor({ value, onChange, label, inputs, previous, resources, disabled, resourceValue = false }: ValueEditorContext & { value: ActionValue; onChange: (value: ActionValue) => void; label: string; resourceValue?: boolean }) {
  const { t } = useT("scanner");
  const source = value.source === "scan" ? `scan:${value.field}` : value.source;
  return <div className="space-y-2">
    <label className={labelClass}>{label}
      <select className={inputClass} aria-label={`${label}: ${t("chain.source")}`} value={source} disabled={disabled} onChange={(event) => {
        const source = event.target.value;
        onChange(source === "literal" ? { source, value: "" } : source === "input" ? { source, key: inputs[0]?.key ?? "" } : source === "result" ? { source, actionId: previous[0]?.id ?? "", path: resourceValue ? "resourceId" : "code" } : { source: "scan", field: source === "scan:raw" ? "raw" : "identifier" });
      }}>
        <option value="literal">{t("chain.literal")}</option><option value="scan:identifier">{t("chain.identifier")}</option><option value="scan:raw">{t("chain.raw")}</option>
        <option value="input" disabled={!inputs.length}>{t("chain.input")}</option><option value="result" disabled={!previous.length}>{t("chain.result")}</option>
      </select>
    </label>
    {value.source === "literal" ? resourceValue ? <select aria-label={label} className={inputClass} disabled={disabled} value={String(value.value ?? "")} onChange={(e) => onChange({ source: "literal", value: e.target.value })}><option value="">{t("chain.choose")}</option>{resources.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.name}</option>)}</select> : <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <select aria-label={`${label}: ${t("chain.valueType")}`} className={inputClass} disabled={disabled} value={value.value === null ? "null" : typeof value.value} onChange={(e) => onChange({ source: "literal", value: e.target.value === "number" ? 0 : e.target.value === "boolean" ? true : e.target.value === "null" ? null : "" })}><option value="string">{t("chain.text")}</option><option value="number">{t("chain.number")}</option><option value="boolean">{t("chain.boolean")}</option><option value="null">{t("chain.empty")}</option></select>
      {typeof value.value === "boolean" ? <select aria-label={label} className={inputClass} disabled={disabled} value={String(value.value)} onChange={(e) => onChange({ source: "literal", value: e.target.value === "true" })}><option value="true">{t("chain.yes")}</option><option value="false">{t("chain.no")}</option></select> : <input aria-label={label} className={inputClass} disabled={disabled || value.value === null} type={typeof value.value === "number" ? "number" : "text"} value={value.value ?? ""} onChange={(e) => onChange({ source: "literal", value: typeof value.value === "number" ? Number(e.target.value) : e.target.value })} />}
    </div> : value.source === "input" ? <select aria-label={label} className={inputClass} value={value.key} disabled={disabled} onChange={(e) => onChange({ ...value, key: e.target.value })}><option value="">{t("chain.choose")}</option>{inputs.map((field) => <option value={field.key} key={field.key}>{field.label}</option>)}</select> : value.source === "result" ? <div className="grid gap-2 sm:grid-cols-2">
      <select aria-label={t("chain.previousAction")} className={inputClass} disabled={disabled} value={value.actionId} onChange={(e) => onChange({ ...value, actionId: e.target.value })}><option value="">{t("chain.choose")}</option>{previous.map((action) => <option key={action.id} value={action.id}>{action.label}</option>)}</select>
      <select aria-label={t("chain.resultField")} className={inputClass} disabled={disabled} value={value.path.startsWith("metadata.") ? "metadata" : value.path.startsWith("customFields.") ? "customFields" : value.path} onChange={(e) => onChange({ ...value, path: ["metadata", "customFields"].includes(e.target.value) ? `${e.target.value}.field` : e.target.value })}>{["resourceId", "unitId", "code", "found", "status", "quantity", "metadata", "customFields"].map((path) => <option key={path} value={path}>{t(`chain.resultFields.${path}`)}</option>)}</select>
      {value.path.includes(".") ? <input aria-label={t("chain.propertyKey")} className={inputClass} disabled={disabled} value={value.path.slice(value.path.indexOf(".") + 1)} onChange={(e) => onChange({ ...value, path: `${value.path.split(".")[0]}.${e.target.value}` })} /> : null}
    </div> : null}
  </div>;
}

export function ChainConditionsEditor({ value, onChange, label, ...context }: ValueEditorContext & { value: ActionConditions | null; onChange: (value: ActionConditions | null) => void; label: string }) {
  const { t } = useT("scanner");
  const newRule = () => ({ left: context.inputs.length ? { source: "input" as const, key: context.inputs[0].key } : { source: "scan" as const, field: "identifier" as const }, operator: "exists" as const });
  return <div className="rounded-lg border border-border p-3">
    <label className="flex items-center gap-2 text-[12px] font-semibold"><input type="checkbox" disabled={context.disabled} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked ? { mode: "all", rules: [newRule()] } : null)} />{label}</label>
    {value ? <div className="mt-3 space-y-3"><select aria-label={t("chain.conditionMode")} className={inputClass} disabled={context.disabled} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as "all" | "any" })}><option value="all">{t("chain.allConditions")}</option><option value="any">{t("chain.anyCondition")}</option></select>
      {value.rules.map((rule, index) => {
        const update = (next: typeof rule) => onChange({ ...value, rules: value.rules.map((item, i) => i === index ? next : item) });
        return <div className="space-y-2 rounded-lg bg-surface-subtle p-3" key={index}>
          <ChainValueEditor {...context} label={t("chain.compareValue")} value={rule.left} onChange={(left) => update({ ...rule, left })} />
          <select aria-label={t("chain.operator")} className={inputClass} value={rule.operator} disabled={context.disabled} onChange={(e) => { const operator = e.target.value as typeof rule.operator; update({ ...rule, operator, ...(!["exists", "missing"].includes(operator) && !rule.right ? { right: { source: "literal", value: "" } } : {}) }); }}>{["equals", "not-equals", "exists", "missing", "gt", "gte", "lt", "lte"].map((operator) => <option key={operator} value={operator}>{t(`chain.operators.${operator}`)}</option>)}</select>
          {!["exists", "missing"].includes(rule.operator) ? <ChainValueEditor {...context} label={t("chain.comparison")} value={rule.right ?? { source: "literal", value: "" }} onChange={(right) => update({ ...rule, right })} /> : null}
          <Button variant="ghost" size="sm" disabled={context.disabled} onClick={() => onChange(value.rules.length === 1 ? null : { ...value, rules: value.rules.filter((_, i) => i !== index) })}>{t("chain.removeCondition")}</Button>
        </div>;
      })}
      <Button variant="secondary" size="sm" disabled={context.disabled || value.rules.length >= 8} onClick={() => onChange({ ...value, rules: [...value.rules, newRule()] })}>{t("chain.addCondition")}</Button>
    </div> : null}
  </div>;
}
