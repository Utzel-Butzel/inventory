import type { ChainAction } from "@/lib/action-chain-contract";
import type { WorkflowDraft } from "./types";

export function legacyWorkflowActions(draft: WorkflowDraft): ChainAction[] {
  if (draft.actions?.length) return draft.actions;
  const common = { id: "main", label: draft.name || "Aktion", enabled: true, when: null, target: { source: "selected" as const } };
  const code = { source: "scan" as const, field: "identifier" as const };
  let action: ChainAction;
  if (draft.operation.type === "unit") action = { ...common, type: "unit", code, mode: draft.createMissingUnit ? "upsert" : "update", status: draft.unitStatus, properties: [], applyFlowValues: true };
  else if (draft.operation.type === "assembly-build") action = { ...common, type: "assembly-build", code, quantity: draft.quantityInputKey ? { source: "input", key: draft.quantityInputKey } : { source: "literal", value: draft.operation.quantity }, properties: [], applyFlowValues: true, components: [] };
  else action = { ...common, type: "stock-adjustment", delta: draft.quantityInputKey ? { source: "input", key: draft.quantityInputKey } : { source: "literal", value: draft.operation.delta }, factor: draft.quantityInputKey && draft.operation.delta < 0 ? -1 : 1 };
  return [action, ...(draft.triggerWebhook ? [{ id: "webhook", type: "webhook" as const, label: "Webhook", enabled: true, when: null, eventName: draft.webhookEventName, properties: [] }] : [])];
}

export function newChainAction(type: ChainAction["type"], label: string): ChainAction {
  const common = { id: `action_${crypto.randomUUID().replaceAll("-", "")}`, label, enabled: true, when: null };
  const target = { source: "selected" as const };
  const code = { source: "scan" as const, field: "identifier" as const };
  if (type === "find-unit") return { ...common, type, target, code, allowMissing: false };
  if (type === "unit") return { ...common, type, target, code, mode: "upsert", status: null, properties: [], applyFlowValues: true };
  if (type === "assembly-build") return { ...common, type, target, code, quantity: { source: "literal", value: 1 }, properties: [], components: [], applyFlowValues: true };
  if (type === "stock-adjustment") return { ...common, type, target, delta: { source: "literal", value: 1 }, factor: 1 };
  if (type === "set-location") return { ...common, type, target, code, location: { source: "literal", value: "" }, structured: true };
  if (type === "webhook") return { ...common, type, eventName: "inventory.action.executed", properties: [] };
  return { ...common, type, message: "Prüfung fehlgeschlagen.", check: { mode: "all", rules: [{ left: code, operator: "exists" }] } };
}

export function chainTargetResourceId(action: ChainAction, selectedId: string, previous: ChainAction[]): string {
  if (!("target" in action)) return "";
  if (action.target.source === "selected") return selectedId;
  if (action.target.source === "resource") return action.target.resourceId;
  const targetId = action.target.actionId;
  const index = previous.findIndex((item) => item.id === targetId);
  return index < 0 ? "" : chainTargetResourceId(previous[index], selectedId, previous.slice(0, index));
}
