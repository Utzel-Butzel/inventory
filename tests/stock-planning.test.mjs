import assert from "node:assert/strict";
import test from "node:test";
import { DAY_MS, planStock } from "../lib/stock-planning.ts";

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
