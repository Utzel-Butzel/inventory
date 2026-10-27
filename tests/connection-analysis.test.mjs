import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { planConnectionProduction, connectionBuildable, connectionCostReport, compareConnectionVariants, connectionQuality, connectionAncestors } from "../lib/connection-analysis.ts";
import { loadConnectionAnalysis, loadConnectionDependencies } from "../lib/connection-analysis-loader.ts";

const line = (id, quantity = 1, extra = {}) => ({ resourceId: id, name: id, quantityPerAssembly: quantity, unitName: "piece", ...extra });
const fixture = (recipes, stocks = {}, prices = {}) => ({
  nodes: new Map(Object.entries(recipes).map(([id, components]) => [id, { resource: { id, name: id }, components }])),
  stocks: new Map(Object.entries(stocks).map(([id, quantity]) => [id, { resourceId: id, quantity, availableQuantity: quantity, reservedQuantity: 0, unitName: "piece" }])),
  costs: new Map(Object.entries(prices).map(([id, price]) => [id, { resourceId: id, currency: "EUR", unitPriceCents: price }])),
  truncated: false,
});

test("variant mixes consume shared parts once and cannot add individual capacities", () => {
  const data = fixture({ natural: [line("pcb"), line("wood")], black: [line("pcb"), line("dark")], pcb: [], wood: [], dark: [] }, { pcb: 24, wood: 40, dark: 8 });
  const before = structuredClone(data);
  const result = planConnectionProduction(data, new Map([["natural", 20], ["black", 10]]));
  assert.equal(result.complete, true); assert.equal(result.feasible, false);
  assert.deepEqual(result.shortages.map(row => [row.resourceId, row.missing]).sort(), [["dark", 2], ["pcb", 6]]);
  assert.equal(connectionBuildable(data, "natural"), 24); assert.equal(connectionBuildable(data, "black"), 8);
  assert.deepEqual(data, before);
});

test("stocked subassemblies are used before exploding only the unmet need", () => {
  const data = fixture({ root: [line("module", 2)], module: [line("chip", 3)], chip: [] }, { root: 99, module: 3, chip: 12 });
  const result = planConnectionProduction(data, new Map([["root", 3]]));
  assert.equal(result.feasible, true);
  assert.equal(result.rows.find(row => row.resourceId === "module").toBuild, 3);
  assert.equal(result.rows.find(row => row.resourceId === "chip").required, 9);
  assert.equal(connectionBuildable(data, "root"), 3, "finished stock does not count as newly manufactured products");
});

test("converging paths aggregate demand before allocating stock regardless of root order", () => {
  const data = fixture({ a: [line("chip", 2)], b: [line("module")], module: [line("chip", 4)], chip: [] }, { chip: 10, module: 1 });
  for (const plan of [new Map([["a", 2], ["b", 3]]), new Map([["b", 3], ["a", 2]])]) {
    const result = planConnectionProduction(data, plan);
    assert.equal(result.rows.find(row => row.resourceId === "chip").required, 12);
    assert.equal(result.rows.find(row => row.resourceId === "chip").missing, 2);
  }
});

test("missing stocks, recipes and truncated graphs never imply certain buildability", () => {
  for (const data of [fixture({ root: [line("part")], part: null }, { part: 100 }), fixture({ root: [line("part")], part: [] }), { ...fixture({ root: [line("part")], part: [] }, { part: 100 }), truncated: true }]) {
    const result = planConnectionProduction(data, new Map([["root", 1]]));
    assert.equal(result.feasible, false); assert.equal(result.complete, false); assert.equal(connectionBuildable(data, "root"), null);
  }
  assert.equal(planConnectionProduction(fixture({ root: [] }), new Map([["root", 1]])).complete, false);
});

test("zero and negative stock produce shortages; base quantities are not multiplied by purchase factors again", () => {
  const data = fixture({ root: [line("tape", 20, { quantityUnit: "purchase", purchaseUnitFactor: 10 })], tape: [] }, { tape: -4 });
  const result = planConnectionProduction(data, new Map([["root", 2]]));
  assert.equal(result.complete, true); assert.equal(result.shortages[0].missing, 40);
});

test("production uses reservation-adjusted availability, not the raw stock balance", () => {
  const data = fixture({ root: [line("part")], part: [] }, { part: 10 });
  data.stocks.get("part").availableQuantity = 6; data.stocks.get("part").reservedQuantity = 4;
  const result = planConnectionProduction(data, new Map([["root", 8]]));
  assert.equal(result.shortages[0].missing, 2); assert.equal(result.shortages[0].reserved, 4);
});

test("cycles, duplicate lines, invalid quantities and overflow are explicit findings", () => {
  const cyclic = fixture({ a: [line("b")], b: [line("a")] }, { a: 0, b: 0 });
  assert.ok(connectionQuality(cyclic, ["a"]).some(issue => issue.code === "cycle"));
  assert.equal(planConnectionProduction(cyclic, new Map([["a", 1]])).complete, false);
  const data = fixture({ a: [line("b", 0), line("b", NaN)], b: [] }, { b: 0 });
  assert.ok(connectionQuality(data, ["a"]).some(issue => issue.code === "duplicate"));
  assert.equal(planConnectionProduction(data, new Map([["a", 1]])).complete, false);
  const huge = fixture({ a: [line("b", Number.MAX_SAFE_INTEGER)], b: [] }, { b: 1 });
  assert.ok(planConnectionProduction(huge, new Map([["a", 2]])).issues.some(issue => issue.code === "overflow"));
});

test("costed subassemblies and their parts are never counted twice", () => {
  const data = fixture({ root: [line("module", 2), line("case")], module: [line("chip", 4)], chip: [], case: [] }, {}, { root: 10000, module: 1000, chip: 100, case: 500 });
  const report = connectionCostReport(data, "root");
  assert.equal(report.total, 2500); assert.equal(report.complete, true);
  assert.equal(report.rows.find(row => row.resourceId === "module").rolledUp, false);
});

test("missing subassembly prices roll up children with quantities and allow zero prices", () => {
  const data = fixture({ root: [line("module", 2)], module: [line("chip", 4), line("free")], chip: [], free: [] }, {}, { root: null, module: null, chip: 100, free: 0 });
  const report = connectionCostReport(data, "root");
  assert.equal(report.total, 800); assert.equal(report.complete, true); assert.equal(report.rows[0].rolledUp, true);
});

test("unknown prices and mixed currencies cannot produce complete costs", () => {
  const data = fixture({ root: [line("a"), line("b")], a: [], b: [] }, {}, { root: 2000, a: 100, b: 500 });
  data.costs.get("b").currency = "USD";
  const report = connectionCostReport(data, "root");
  assert.equal(report.total, 100); assert.equal(report.complete, false); assert.equal(report.issues[0].code, "currency");
  data.costs.get("b").currency = "EUR"; data.costs.get("b").unitPriceCents = null;
  assert.equal(connectionCostReport(data, "root").complete, false);
  assert.equal(connectionCostReport(fixture({ part: [] }, {}, { part: null }), "part").complete, false);
  assert.equal(connectionCostReport(fixture({ part: [] }, {}, { part: 0 }), "part").complete, true);
  assert.equal(connectionCostReport(fixture({ root: [line("part")], part: [] }, {}, { root: null, part: null }), "root").known, false);
  assert.equal(connectionCostReport(fixture({ root: [line("part")], part: [] }, {}, { root: null, part: 0 }), "root").known, true, "a known zero price differs from an unknown price");
});

test("variant comparison uses recipe slots and distinguishes absent from unknown", () => {
  const data = fixture({ natural: [line("pcb"), line("wood", 1, { slotKey: "frame" })], black: [line("pcb"), line("dark", 1, { slotKey: "frame" })], unknown: null });
  const rows = compareConnectionVariants(data, ["natural", "black"]);
  assert.equal(rows.length, 2); assert.equal(rows.filter(row => row.different).length, 1);
  assert.equal(rows.find(row => row.key === "slot:frame").cells.get("black")[0].resourceId, "dark");
  assert.ok(compareConnectionVariants(data, ["natural", "unknown"]).every(row => row.unknown));
});

test("ancestor highlighting follows only BOM paths and includes intermediate assemblies", () => {
  const data = fixture({ root: [line("module")], module: [line("chip")], chip: [], unrelated: [] });
  assert.deepEqual(connectionAncestors(data.nodes, ["chip"]), new Set(["chip", "module", "root"]));
});

test("loader traverses beyond visible graph depth and batches scoped read requests", async () => {
  const calls = [];
  const read = async (url, options) => {
    assert.equal(options.cache, "no-store"); calls.push(url);
    const parsed = new URL(url, "http://localhost");
    if (url.includes("cost-summaries")) return { costs: parsed.searchParams.getAll("id").map(id => ({ resourceId: id, unitPriceCents: 10, currency: "EUR" })) };
    if (url.includes("stock-summaries")) return { stock: parsed.searchParams.getAll("id").map(id => ({ resourceId: id, quantity: 3, availableQuantity: 3, reservedQuantity: 0, unitName: "piece" })) };
    const id = Number(url.split("/").at(-2));
    return { components: id < 6 ? [line(String(id + 1))] : [] };
  };
  const data = await loadConnectionAnalysis([{ id: "0", name: "root" }], true, new AbortController().signal, read);
  assert.equal(data.nodes.size, 7); assert.deepEqual(data.nodes.get("6").components, []); assert.equal(data.stocks.size, 7);
  assert.equal(planConnectionProduction(data, new Map([["0", 1]])).complete, true);
  assert.ok(calls.every(url => url.startsWith("/api/v1/resources/")));
});

test("unavailable recipes remain unknown and users without stock access do not load stock", async () => {
  const data = await loadConnectionAnalysis([{ id: "a", name: "a" }], false, new AbortController().signal, async url => {
    assert.ok(!url.includes("stock-summaries"));
    if (url.includes("cost-summaries")) return { costs: [] };
    throw new Error("Forbidden");
  });
  assert.equal(data.nodes.get("a").components, null); assert.equal(data.stocks.size, 0);
});

test("analysis bounds requests and clearly reports truncation", async () => {
  const data = await loadConnectionAnalysis([{ id: "0", name: "0" }], false, new AbortController().signal, async url => {
    if (url.includes("cost-summaries")) { assert.ok(new URL(url, "http://localhost").searchParams.getAll("id").length <= 45); return { costs: [] }; }
    return { components: [line(String(Number(url.split("/").at(-2)) + 1))] };
  });
  assert.equal(data.nodes.size, 200); assert.equal(data.truncated, true);
});

test("dependency traversal follows actual parent relations, deduplicates diamonds and stops cycles", async () => {
  const parents = { chip: ["module", "root"], module: ["root"], root: ["chip"] };
  const requests = [];
  const data = await loadConnectionDependencies({ id: "chip", name: "chip" }, new AbortController().signal, async url => {
    const id = url.split("/").at(-2); requests.push(id); return { parents: parents[id].map(id => line(id)) };
  });
  assert.deepEqual(new Set(data.resources.map(item => item.id)), new Set(["chip", "module", "root"]));
  assert.equal(requests.length, 3); assert.equal(data.incomplete, false);
});

test("cancelled and failed dependency reads never masquerade as complete empty results", async () => {
  const result = await loadConnectionDependencies({ id: "a", name: "a" }, new AbortController().signal, async () => { throw new Error("Forbidden"); });
  assert.equal(result.incomplete, true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadConnectionAnalysis([{ id: "a", name: "a" }], false, controller.signal, async () => { throw new Error("should not fetch"); }), { name: "AbortError" });
});

test("reservation query excludes already applied stock deductions and scopes by organization", async () => {
  const source = await readFile(new URL("../lib/connection-stock.ts", import.meta.url), "utf8");
  assert.match(source, /eq\(inventoryAssignments\.stockApplied, false\)/);
  assert.match(source, /eq\(inventoryAssignments\.organizationId, organizationId\)/);
  assert.match(source, /eq\(inventoryAssignments\.status, "active"\)/);
});
