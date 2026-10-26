import type { PlanningPoint, StockPlan } from "./stock-planning.ts";

export type ChartScale = "quantity" | "relative";

/** Reverse net stock movements from today's snapshot; never extend before observations. */
export function reconstructStockHistory(
  quantity: number,
  observedDays: number,
  movements: { ageDays: number; delta: number }[],
): PlanningPoint[] {
  const days = Math.max(0, Math.min(90, Math.floor(observedDays)));
  const deltas = new Map<number, number>();
  for (const movement of movements) {
    if (movement.ageDays < 0 || movement.ageDays >= days) continue;
    deltas.set(movement.ageDays, (deltas.get(movement.ageDays) ?? 0) + movement.delta);
  }
  const points = [{ day: 0, quantity }];
  let balance = quantity;
  for (let age = 0; age < days; age++) {
    balance -= deltas.get(age) ?? 0;
    points.push({ day: -age - 1, quantity: balance });
  }
  return points.reverse();
}

/** Historical balances are steps; forecasts interpolate consumption between receipt jumps. */
export function stockChartValue(points: PlanningPoint[], day: number, interpolate = false): number | null {
  if (!points.length || day < points[0].day || day > points[points.length - 1].day) return null;
  let previous = points[0];
  for (const point of points) {
    if (point.day > day) {
      if (!interpolate) return previous.quantity;
      return previous.quantity + (point.quantity - previous.quantity) * (day - previous.day) / (point.day - previous.day);
    }
    previous = point;
  }
  return previous.quantity;
}

export function planningChartSeries(item: StockPlan, horizon: number, scale: ChartScale = "quantity") {
  // Zero/negative current stock has no meaningful "today = 100%" comparison.
  const denominator = scale === "relative" ? item.quantity > 0 ? item.quantity / 100 : null : 1;
  if (denominator === null) return null;
  const history = item.history?.length ? item.history : [{ day: 0, quantity: item.quantity }];
  const projection = item.dailyUsage > 0 ? item.timeline.filter((point) => point.day <= horizon) : [];
  if (projection.length && projection[projection.length - 1].day < horizon) {
    const quantity = stockChartValue(item.timeline, horizon, true);
    if (quantity !== null) projection.push({ day: horizon, quantity });
  }
  const normalize = (point: PlanningPoint) => ({ day: point.day, quantity: point.quantity / denominator });
  return {
    history: history.map(normalize), projection: projection.map(normalize),
    current: item.quantity / denominator, safety: item.safetyStock / denominator,
    deliveries: projection.filter((point, index) => index > 0 && point.day === projection[index - 1].day && point.quantity > projection[index - 1].quantity).map(normalize),
  };
}

export function stockChartPath(points: PlanningPoint[], x: (day: number) => number, y: (value: number) => number, step = false) {
  return points.map((point, index) => index === 0
    ? `M ${x(point.day)} ${y(point.quantity)}`
    : step ? `H ${x(point.day)} V ${y(point.quantity)}` : `L ${x(point.day)} ${y(point.quantity)}`).join(" ");
}
