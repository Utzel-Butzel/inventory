import { fetchJson } from "@/lib/client-types";
import type { AnalysisData, AnalysisNode, AnalysisStock } from "./connection-analysis";
import type { ConnectionDiagramBomComponent, ConnectionDiagramBomParent, ConnectionDiagramResource, ConnectionUnitCost } from "./resource-connection-diagram";

const LIMIT = 200;
type ReadJson = <T>(url: string, options: { signal: AbortSignal; cache: "no-store" }) => Promise<T>;

/** Analysis follows recipes independently of the diagram's visible depth. */
export async function loadConnectionAnalysis(
  roots: readonly ConnectionDiagramResource[], canViewStock: boolean, signal: AbortSignal, read: ReadJson = fetchJson,
): Promise<AnalysisData> {
  const nodes = new Map<string, AnalysisNode>();
  const queued = new Map(roots.map(resource => [resource.id, resource]));
  while (queued.size && nodes.size < LIMIT) {
    signal.throwIfAborted();
    const batch = [...queued.values()].slice(0, Math.min(6, LIMIT - nodes.size));
    batch.forEach(resource => { queued.delete(resource.id); nodes.set(resource.id, { resource, components: null }); });
    const results = await Promise.allSettled(batch.map(resource => read<{ components: ConnectionDiagramBomComponent[] }>(
      `/api/v1/resources/${resource.id}/bom`, { signal, cache: "no-store" })));
    signal.throwIfAborted();
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      nodes.set(batch[index].id, { resource: batch[index], components: result.value.components });
      for (const component of result.value.components) if (!nodes.has(component.resourceId) && !queued.has(component.resourceId))
        queued.set(component.resourceId, { id: component.resourceId, name: component.name, subtitle: component.subtitle });
    });
  }
  const stocks = new Map<string, AnalysisStock>(), costs = new Map<string, ConnectionUnitCost>();
  const ids = [...nodes.keys()];
  for (let offset = 0; offset < ids.length; offset += 45) {
    signal.throwIfAborted();
    const search = new URLSearchParams(ids.slice(offset, offset + 45).map(id => ["id", id]));
    const results = await Promise.allSettled([
      read<{ costs: ConnectionUnitCost[] }>(`/api/v1/resources/cost-summaries?${search}`, { signal, cache: "no-store" }),
      canViewStock ? read<{ stock: AnalysisStock[] }>(`/api/v1/resources/stock-summaries?${search}`, { signal, cache: "no-store" }) : Promise.resolve({ stock: [] as AnalysisStock[] }),
    ]);
    signal.throwIfAborted();
    if (results[0].status === "fulfilled") results[0].value.costs.forEach(cost => costs.set(cost.resourceId, cost));
    if (results[1].status === "fulfilled") results[1].value.stock.forEach(stock => stocks.set(stock.resourceId, stock));
  }
  return { nodes, stocks, costs, truncated: queued.size > 0 };
}

export type DependencyData = { resources: ConnectionDiagramResource[]; edges: { from: string; to: string }[]; incomplete: boolean };
export async function loadConnectionDependencies(root: ConnectionDiagramResource, signal: AbortSignal, read: ReadJson = fetchJson): Promise<DependencyData> {
  const resources = new Map([[root.id, root]]), queued = [root.id], visited = new Set<string>();
  const edges: DependencyData["edges"] = [];
  let incomplete = false;
  while (queued.length && visited.size < LIMIT) {
    const batch = queued.splice(0, Math.min(6, LIMIT - visited.size));
    batch.forEach(id => visited.add(id));
    const results = await Promise.allSettled(batch.map(id => read<{ parents: ConnectionDiagramBomParent[] }>(
      `/api/v1/resources/${id}/bom-parents`, { signal, cache: "no-store" })));
    signal.throwIfAborted();
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") { incomplete = true; return; }
      for (const parent of result.value.parents) {
        if (!resources.has(parent.resourceId)) {
          resources.set(parent.resourceId, { id: parent.resourceId, name: parent.name, subtitle: parent.subtitle });
          queued.push(parent.resourceId);
        }
        edges.push({ from: batch[index], to: parent.resourceId });
      }
    });
  }
  return { resources: [...resources.values()], edges, incomplete: incomplete || queued.length > 0 };
}
