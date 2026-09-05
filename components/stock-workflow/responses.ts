import type { StockItem, StockUnitCustomField, WorkflowRecord } from "./types";

export function workflowsFromResponse(payload: unknown): WorkflowRecord[] {
  if (Array.isArray(payload)) return payload as WorkflowRecord[];
  if (payload && typeof payload === "object") {
    const candidate = payload as {
      workflows?: unknown;
      items?: unknown;
      data?: unknown;
    };
    if (Array.isArray(candidate.workflows)) return candidate.workflows as WorkflowRecord[];
    if (Array.isArray(candidate.items)) return candidate.items as WorkflowRecord[];
    if (Array.isArray(candidate.data)) return candidate.data as WorkflowRecord[];
  }
  return [];
}

export function workflowFromResponse(payload: unknown): WorkflowRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as { workflow?: unknown; data?: unknown; id?: unknown };
  const candidate = wrapper.workflow ?? wrapper.data ?? payload;
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { id?: unknown }).id === "string"
  ) {
    return candidate as WorkflowRecord;
  }
  return null;
}

export function stockItemsFromResponse(payload: unknown): StockItem[] {
  if (!payload || typeof payload !== "object") return [];
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is StockItem =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof (item as StockItem).resourceId === "string" &&
        typeof (item as StockItem).name === "string" &&
        typeof (item as StockItem).trackingMode === "string",
      ),
  );
}

export function stockUnitCustomFieldsFromResponse(payload: unknown): StockUnitCustomField[] {
  if (!payload || typeof payload !== "object") return [];
  const definitions = (payload as { definitions?: unknown }).definitions;
  if (!Array.isArray(definitions)) return [];
  return definitions.filter(
    (definition): definition is StockUnitCustomField =>
      Boolean(
        definition &&
        typeof definition === "object" &&
        typeof (definition as StockUnitCustomField).key === "string" &&
        typeof (definition as StockUnitCustomField).label === "string" &&
        typeof (definition as StockUnitCustomField).fieldType === "string",
      ),
  );
}

