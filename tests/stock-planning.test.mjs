import assert from "node:assert/strict";
import test from "node:test";
import { DAY_MS, planStock } from "../lib/stock-planning.ts";
import { DEMO_RESOURCES, DEMO_STOCK_MOVEMENTS, DEMO_STOCK_SETTINGS } from "../scripts/demo-seed-manifest.mjs";

const now = new Date("2026-10-27T12:00:00Z");
const date = (day) => new Date(now.getTime() + day * DAY_MS).toISOString();
const input = (overrides = {}) => ({
  resourceId: "pcb", name: "PCB", subtitle: "", sku: "PCB-1", quantity: 100,
  unitName: "pieces", minimumStock: 0, reorderQuantity: 0, leadTimeDays: 5,
  purchaseUnitName: null, purchaseUnitFactor: null,
  observedDays: 90, consumed: 900, recentConsumed: 300, demandDays: 30,
  receipts: [], ...overrides,
});
const options = { safetyDays: 0, coverageDays: 30, demandMultiplier: 1 };
const plan = (overrides = {}, config = options) => planStock(input(overrides), now, config);

test("100 PCBs at 10 per day last 10 days; a five-day lead time sets the order deadline", () => {
  const result = plan();
  assert.equal(result.dailyUsage, 10);
  assert.equal(result.stockoutAt, date(10));
  assert.equal(result.reorderAt, date(5));
  assert.equal(result.status, "soon");
  assert.equal(result.suggestedQuantity, 250);
});

test("buffer and minimum stock advance ordering without changing physical stockout", () => {
  const result = plan({ minimumStock: 20 }, { ...options, safetyDays: 3 });
  assert.equal(result.stockoutAt, date(10));
  assert.equal(result.reorderAt, date(0));
  assert.equal(result.status, "order");
  assert.equal(result.suggestedQuantity, 300);
});

test("a timely receipt extends coverage, but a late receipt cannot hide the first shortage", () => {
  assert.equal(plan({ receipts: [{ quantity: 100, expectedAt: date(5) }] }).stockoutAt, date(20));
  const late = plan({ quantity: 20, receipts: [{ quantity: 1000, expectedAt: date(8) }] });
  assert.equal(late.stockoutAt, date(2));
  assert.equal(late.status, "critical");
  assert.equal(late.suggestedQuantity, 60, "bridge demand until the existing order arrives");
});

test("simultaneous and just-in-time receipts do not introduce a phantom gap", () => {
  const result = plan({ receipts: [
    { quantity: 50, expectedAt: date(10) }, { quantity: 50, expectedAt: date(10) },
  ] });
  assert.equal(result.stockoutAt, date(20));
  assert.deepEqual(result.timeline.filter((point) => point.day === 10).map((point) => point.quantity), [0, 100]);
});

test("overdue and undated purchases remain visible but cannot be treated as available", () => {
  const result = plan({ receipts: [{ quantity: 100, expectedAt: date(-1) }, { quantity: 200, expectedAt: null }] });
  assert.equal(result.stockoutAt, date(10));
  assert.equal(result.overdueQuantity, 100);
  assert.equal(result.undatedQuantity, 200);
  assert.equal(result.onOrder, 300);
  assert.equal(result.nextExpectedAt, null);
});

test("a delivery expected earlier today is still scheduled for today", () => {
  const result = plan({ receipts: [{ quantity: 100, expectedAt: "2026-10-27T08:00:00Z" }] });
  assert.equal(result.overdueQuantity, 0);
  assert.equal(result.stockoutAt, date(20));
});

test("no recorded consumption is unknown, not healthy or infinite coverage", () => {
  const result = plan({ consumed: 0, recentConsumed: 0, demandDays: 0 });
  assert.equal(result.status, "review");
  assert.equal(result.confidence, "none");
  assert.equal(result.stockoutAt, null);
  assert.equal(result.reorderAt, null);
});

test("empty and negative stock remain critical without a consumption history", () => {
  for (const quantity of [0, -10]) {
    const result = plan({ quantity, consumed: 0, recentConsumed: 0, demandDays: 0 });
    assert.equal(result.stockoutAt, date(0));
    assert.equal(result.status, "critical");
  }
});

test("without demand, merely reaching minimum stock does not invent an ordering deadline", () => {
  const result = plan({ minimumStock: 100, consumed: 0, recentConsumed: 0, demandDays: 0 });
  assert.equal(result.status, "review");
  assert.equal(result.reorderAt, null);
  assert.equal(result.suggestedQuantity, 0);
  const below = plan({ minimumStock: 110, consumed: 0, recentConsumed: 0, demandDays: 0 });
  assert.equal(below.status, "order");
  assert.equal(below.suggestedQuantity, 10);
});

test("missing lead time is explicit and never produces a spurious order date", () => {
  const result = plan({ quantity: 1000, leadTimeDays: 0 });
  assert.equal(result.leadTimeKnown, false);
  assert.equal(result.status, "review");
  assert.equal(result.reorderAt, null);
});

test("short histories use their observed span and have lower evidence quality", () => {
  const result = plan({ observedDays: 10, consumed: 50, recentConsumed: 50, demandDays: 5 });
  assert.equal(result.dailyUsage, 5);
  assert.equal(result.stockoutAt, date(20));
  assert.equal(result.confidence, "low");
  assert.equal(result.status, "review");
});

test("recent increases and demand scenarios advance depletion", () => {
  assert.equal(plan({ recentConsumed: 600 }).dailyUsage, 20);
  assert.equal(plan({}, { ...options, demandMultiplier: 2 }).stockoutAt, date(5));
  assert.equal(plan({}, { ...options, demandMultiplier: 0.5 }).stockoutAt, date(20));
});

test("purchase packs round upward and respect the fixed reorder quantity", () => {
  const result = plan({ purchaseUnitName: "tray", purchaseUnitFactor: 12, reorderQuantity: 301 });
  assert.equal(result.suggestedQuantity, 312);
  assert.equal(result.suggestedPurchaseQuantity, 26);
  assert.equal(plan({ quantity: 10000, reorderQuantity: 100 }).suggestedQuantity, 0);
});

test("split deliveries preserve the first uncovered interval and later recovery", () => {
  const result = plan({ quantity: 30, receipts: [{ quantity: 20, expectedAt: date(2) }, { quantity: 100, expectedAt: date(8) }] });
  assert.equal(result.stockoutAt, date(5));
  const atEight = result.timeline.filter((point) => point.day === 8);
  assert.equal(atEight[0].quantity, -30);
  assert.equal(atEight[1].quantity, 70);
});

test("long lead times can require ordering now even beyond the visible stockout horizon", () => {
  const result = plan({ quantity: 2000, leadTimeDays: 210 });
  assert.equal(result.stockoutAt, null);
  assert.equal(result.reorderAt, date(0));
  assert.equal(result.status, "critical");
});

test("healthy coverage needs usable history, lead time and confirmed deliveries", () => {
  assert.equal(plan({ quantity: 1000 }).status, "healthy");
  assert.equal(plan({ quantity: 1000, receipts: [{ quantity: 100, expectedAt: null }] }).status, "review");
});

// Chart data shares the exact stock projection used for ordering decisions.
const { reconstructStockHistory, planningChartSeries, stockChartValue } = await import("../lib/stock-planning-chart.ts");

test("historical balances reverse receipts, demand and corrections from the current snapshot", () => {
  assert.deepEqual(reconstructStockHistory(100, 3, [
    { ageDays: 0, delta: 50 }, { ageDays: 0, delta: -10 },
    { ageDays: 1, delta: -20 }, { ageDays: 2, delta: 5 },
    { ageDays: 3, delta: 999 }, { ageDays: -1, delta: 999 },
  ]), [{ day: -3, quantity: 75 }, { day: -2, quantity: 80 }, { day: -1, quantity: 60 }, { day: 0, quantity: 100 }]);
  assert.deepEqual(reconstructStockHistory(100, 0, []), [{ day: 0, quantity: 100 }]);
  assert.equal(reconstructStockHistory(100, 200, []).length, 91);
});

test("chart lookups preserve delivery jumps and step through historical balances", () => {
  const points = [{ day: 0, quantity: 100 }, { day: 5, quantity: 50 }, { day: 5, quantity: 150 }, { day: 10, quantity: 100 }];
  assert.equal(stockChartValue(points, 4, true), 60);
  assert.equal(stockChartValue(points, 5, true), 150);
  assert.equal(stockChartValue(points, 6, true), 140);
  assert.equal(stockChartValue(points, 4), 100);
  assert.equal(stockChartValue(points, -1), null);
  assert.equal(stockChartValue(points, 11), null);
});

test("chart horizons interpolate endpoints and keep actual receipt markers without mutating plans", () => {
  const item = plan({ receipts: [{ quantity: 100, expectedAt: date(5) }] });
  const original = structuredClone(item);
  const series = planningChartSeries(item, 30);
  assert.deepEqual(series.projection.at(-1), { day: 30, quantity: -100 });
  assert.deepEqual(series.deliveries, [{ day: 5, quantity: 150 }]);
  assert.equal(series.projection.some((point) => point.day > 30), false);
  assert.deepEqual(item, original);
});

test("relative comparison uses today's stock; missing demand never fabricates a forecast", () => {
  const series = planningChartSeries(plan({ quantity: 200 }), 30, "relative");
  assert.equal(series.current, 100);
  assert.equal(series.projection.at(-1).quantity, -50);
  assert.equal(planningChartSeries(plan({ quantity: 0 }), 30, "relative"), null);
  assert.equal(planningChartSeries(plan({ quantity: -5 }), 30, "relative"), null);
  assert.deepEqual(planningChartSeries(plan({ consumed: 0, recentConsumed: 0 }), 90).projection, []);
});

test("demo ledgers show real demand, restocking and a delivery gap without counting tool loans as consumption", () => {
  const plans = DEMO_STOCK_SETTINGS.map((settings) => {
    const resource = DEMO_RESOURCES.find(({ id }) => id === settings.resourceId);
    const movements = DEMO_STOCK_MOVEMENTS.filter(({ resourceId }) => resourceId === resource.id);
    const demand = movements.filter(({ type, daysAgo }) => daysAgo < 90 && ["issue", "waste", "assembly-consumption"].includes(type));
    const history = reconstructStockHistory(resource.quantity, 90, movements.map(({ daysAgo, delta }) => ({ ageDays: daysAgo, delta })));
    assert.equal(history.length, 91);
    assert.ok(history.every(({ quantity }) => quantity >= 0));
    assert.equal(history.at(-1).quantity, resource.quantity);
    assert.ok(history.some((point, index) => index > 0 && point.quantity > history[index - 1].quantity));
    assert.ok(history.some((point, index) => index > 0 && point.quantity < history[index - 1].quantity));
    return planStock(input({
      ...settings, quantity: resource.quantity, history,
      consumed: demand.reduce((sum, movement) => sum + movement.quantity, 0),
      recentConsumed: demand.filter(({ daysAgo }) => daysAgo < 30).reduce((sum, movement) => sum + movement.quantity, 0),
      demandDays: new Set(demand.map(({ daysAgo }) => daysAgo)).size,
      receipts: resource.sku === "VERB-KB-200-S" ? [{ quantity: 100, expectedAt: date(5) }] : [],
    }), now);
  });
  const screws = plans.find(({ resourceId }) => resourceId.endsWith("204"));
  const ties = plans.find(({ resourceId }) => resourceId.endsWith("205"));
  assert.equal(screws.confidence, "high");
  assert.equal(screws.dailyUsage, 6.6);
  assert.equal(screws.status, "order");
  assert.equal(ties.confidence, "high");
  assert.equal(ties.dailyUsage, 7.2);
  assert.ok(ties.recentDailyUsage > ties.averageDailyUsage * 1.5);
  assert.ok(ties.stockoutDay > 4 && ties.stockoutDay < 5, "first shortage precedes the scheduled delivery");
  assert.equal(ties.status, "critical");
  for (const tool of plans.filter(({ resourceId }) => ![screws.resourceId, ties.resourceId].includes(resourceId))) {
    assert.equal(tool.consumed, 0, "loans, returns and maintenance are not permanent demand");
  }
});
