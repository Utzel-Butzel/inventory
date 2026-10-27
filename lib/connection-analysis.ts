import type { ConnectionDiagramBomComponent, ConnectionDiagramResource, ConnectionUnitCost } from "./resource-connection-diagram";

export type AnalysisMode = "structure" | "build" | "dependencies" | "compare" | "cost" | "quality";
export type AnalysisStock = { resourceId: string; quantity: number; availableQuantity: number; reservedQuantity: number; unitName: string };
export type AnalysisNode = { resource: ConnectionDiagramResource; components: ConnectionDiagramBomComponent[] | null };
export type AnalysisData = {
  nodes: ReadonlyMap<string, AnalysisNode>;
  stocks: ReadonlyMap<string, AnalysisStock>;
  costs: ReadonlyMap<string, ConnectionUnitCost>;
  truncated: boolean;
};
export type AnalysisIssue = { code: "unloaded" | "cycle" | "quantity" | "duplicate" | "price" | "currency" | "difference" | "overflow" | "noRecipe"; resourceId: string; relatedId?: string };
export type PlanRow = { resourceId: string; required: number; available: number | null; reserved: number; used: number; toBuild: number; missing: number | null; unit: string };

const validQuantity = (value: number) => Number.isSafeInteger(value) && value > 0;

/** Recipe quantities are already in base stock units, including purchase-unit BOMs. */
function recipeOrder(nodes: AnalysisData["nodes"], roots: readonly string[]) {
  const visiting = new Set<string>(), visited = new Set<string>();
  const order: string[] = [], issues: AnalysisIssue[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) { issues.push({ code: "cycle", resourceId: id }); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = nodes.get(id);
    if (!node || node.components === null) issues.push({ code: "unloaded", resourceId: id });
    const seen = new Set<string>();
    for (const component of node?.components ?? []) {
      if (!validQuantity(component.quantityPerAssembly)) issues.push({ code: "quantity", resourceId: id, relatedId: component.resourceId });
      if (seen.has(component.resourceId)) issues.push({ code: "duplicate", resourceId: id, relatedId: component.resourceId });
      seen.add(component.resourceId);
      visit(component.resourceId);
    }
    visiting.delete(id); visited.add(id); order.push(id);
  };
  roots.forEach(visit);
  return { order: order.reverse(), issues };
}

/** Aggregate every parent before consuming shared stock once. No stock is mutated. */
export function planConnectionProduction(data: AnalysisData, quantities: ReadonlyMap<string, number>) {
  const roots = [...quantities].filter(([, quantity]) => quantity > 0).map(([id]) => id);
  const { order, issues } = recipeOrder(data.nodes, roots);
  const demand = new Map<string, number>();
  const rows: PlanRow[] = [];
  for (const id of order) {
    const components = data.nodes.get(id)?.components;
    const requested = quantities.get(id) ?? 0;
    if (requested && (!validQuantity(requested) || !components?.length)) {
      issues.push({ code: components?.length ? "quantity" : "noRecipe", resourceId: id });
    }
    const required = demand.get(id) ?? 0;
    const stock = data.stocks.get(id);
    const available = stock && Number.isFinite(stock.availableQuantity) ? Math.max(0, stock.availableQuantity) : null;
    const used = Math.min(required, available ?? 0);
    const remaining = required - used;
    if (required > 0 && available === null) issues.push({ code: "unloaded", resourceId: id });
    const toBuild = components?.length ? remaining : 0;
    if (required > 0) rows.push({ resourceId: id, required, available, reserved: stock?.reservedQuantity ?? 0, used, toBuild,
      missing: components === null || components === undefined || available === null ? null : components.length ? 0 : remaining,
      unit: stock?.unitName ?? "" });
    for (const component of components ?? []) {
      if (!validQuantity(component.quantityPerAssembly)) continue;
      const next = (demand.get(component.resourceId) ?? 0) + (toBuild + requested) * component.quantityPerAssembly;
      if (!Number.isSafeInteger(next)) issues.push({ code: "overflow", resourceId: component.resourceId });
      else demand.set(component.resourceId, next);
    }
  }
  const complete = !data.truncated && issues.length === 0;
  return { rows, issues, complete, feasible: roots.length > 0 && complete && rows.every(row => row.missing === 0),
    shortages: rows.filter(row => row.missing !== null && row.missing > 0) };
}

export function connectionBuildable(data: AnalysisData, id: string, limit = 1_000_000): number | null {
  if (!planConnectionProduction(data, new Map([[id, 1]])).complete) return null;
  let low = 0, high = limit;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (planConnectionProduction(data, new Map([[id, mid]])).feasible) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function connectionAncestors(nodes: AnalysisData["nodes"], selected: Iterable<string>) {
  const result = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of nodes) {
      if (!result.has(id) && node.components?.some(component => result.has(component.resourceId))) {
        result.add(id); changed = true;
      }
    }
  }
  return result;
}

export function compareConnectionVariants(data: AnalysisData, ids: readonly string[]) {
  const slots = new Map<string, Map<string, ConnectionDiagramBomComponent[]>>();
  for (const id of ids) {
    for (const component of data.nodes.get(id)?.components ?? []) {
      const key = component.slotKey ? `slot:${component.slotKey}` : `item:${component.resourceId}`;
      const cells = slots.get(key) ?? new Map<string, ConnectionDiagramBomComponent[]>();
      cells.set(id, [...(cells.get(id) ?? []), component]); slots.set(key, cells);
    }
  }
  return [...slots].map(([key, cells]) => {
    const signature = (id: string) => data.nodes.get(id)?.components == null ? "unknown" : JSON.stringify(
      (cells.get(id) ?? []).map(component => [component.resourceId, component.quantityPerAssembly, component.unitName ?? "unit"]).sort());
    return { key, cells, different: new Set(ids.map(signature)).size > 1, unknown: ids.some(id => data.nodes.get(id)?.components == null) };
  });
}

export function connectionCostReport(data: AnalysisData, rootId: string) {
  const currency = data.costs.get(rootId)?.currency ?? null;
  const issues: AnalysisIssue[] = [];
  const memo = new Map<string, { amount: number; complete: boolean; rolledUp: boolean; known: boolean }>();
  const price = (id: string, path: ReadonlySet<string>): { amount: number; complete: boolean; rolledUp: boolean; known: boolean } => {
    if (path.has(id)) { issues.push({ code: "cycle", resourceId: id }); return { amount: 0, complete: false, rolledUp: false, known: false }; }
    const cached = memo.get(id); if (cached) return cached;
    const own = data.costs.get(id);
    if (own?.unitPriceCents !== null && own?.unitPriceCents !== undefined && Number.isFinite(own.unitPriceCents)) {
      if (!currency || own.currency !== currency) { issues.push({ code: "currency", resourceId: id }); return { amount: 0, complete: false, rolledUp: false, known: false }; }
      const result = { amount: own.unitPriceCents, complete: true, rolledUp: false, known: true }; memo.set(id, result); return result;
    }
    const components = data.nodes.get(id)?.components;
    if (!components?.length) {
      issues.push({ code: components == null ? "unloaded" : "price", resourceId: id });
      return { amount: 0, complete: false, rolledUp: false, known: false };
    }
    let amount = 0, complete = true, known = false;
    for (const component of components) {
      if (!validQuantity(component.quantityPerAssembly)) { issues.push({ code: "quantity", resourceId: id }); complete = false; continue; }
      const child = price(component.resourceId, new Set([...path, id]));
      const next = amount + child.amount * component.quantityPerAssembly;
      if (!Number.isSafeInteger(next)) { issues.push({ code: "overflow", resourceId: id }); complete = false; }
      else { amount = next; known ||= child.known; }
      complete &&= child.complete;
    }
    const result = { amount, complete, rolledUp: true, known }; memo.set(id, result); return result;
  };
  const components = data.nodes.get(rootId)?.components;
  if (components == null) issues.push({ code: "unloaded", resourceId: rootId });
  const rows = (components ?? []).map(component => {
    const result = price(component.resourceId, new Set([rootId]));
    const valid = validQuantity(component.quantityPerAssembly);
    if (!valid) issues.push({ code: "quantity", resourceId: rootId, relatedId: component.resourceId });
    const amount = valid ? result.amount * component.quantityPerAssembly : 0;
    const safe = Number.isSafeInteger(amount);
    if (!safe) issues.push({ code: "overflow", resourceId: component.resourceId });
    return { resourceId: component.resourceId, quantity: component.quantityPerAssembly, amount: safe ? amount : 0,
      complete: result.complete && valid && safe, rolledUp: result.rolledUp, known: result.known && safe && valid };
  }).sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const complete = components != null && currency !== null && rows.every(row => row.complete) && Number.isSafeInteger(total)
    && (components.length > 0 || data.costs.get(rootId)?.unitPriceCents != null);
  return { currency, rows, total, complete, known: rows.length ? rows.some(row => row.known) : data.costs.get(rootId)?.unitPriceCents != null, issues, unitPrice: data.costs.get(rootId)?.unitPriceCents ?? null };
}

export function connectionQuality(data: AnalysisData, familyIds: readonly string[]) {
  const issues = recipeOrder(data.nodes, familyIds).issues;
  for (const [id, node] of data.nodes) {
    if (!data.costs.has(id)) issues.push({ code: "unloaded", resourceId: id });
    else if (node.components?.length === 0 && data.costs.get(id)?.unitPriceCents == null) issues.push({ code: "price", resourceId: id });
    const currency = data.costs.get(id)?.currency;
    for (const component of node.components ?? []) {
      if (currency && data.costs.get(component.resourceId)?.currency && data.costs.get(component.resourceId)?.currency !== currency)
        issues.push({ code: "currency", resourceId: component.resourceId, relatedId: id });
    }
  }
  // Quantity differences for the SAME component are a review hint, not an error.
  const quantities = new Map<string, Set<number>>();
  for (const id of familyIds) for (const component of data.nodes.get(id)?.components ?? []) {
    const values = quantities.get(component.resourceId) ?? new Set<number>();
    values.add(component.quantityPerAssembly); quantities.set(component.resourceId, values);
  }
  for (const [id, values] of quantities) if (values.size > 1) issues.push({ code: "difference", resourceId: id });
  return [...new Map(issues.map(issue => [`${issue.code}:${issue.resourceId}:${issue.relatedId ?? ""}`, issue])).values()];
}
