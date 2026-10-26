/** Pure, deterministic planning model. Quantities always use the stock base unit. */
export const DAY_MS = 86_400_000;
export const PLANNING_HORIZON_DAYS = 180;

export type PlanningReceipt = { quantity: number; expectedAt: string | null };
export type PlanningInput = {
  resourceId: string;
  name: string;
  subtitle: string;
  sku: string | null;
  quantity: number;
  unitName: string;
  minimumStock: number;
  reorderQuantity: number;
  leadTimeDays: number;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
  observedDays: number;
  consumed: number;
  recentConsumed: number;
  demandDays: number;
  receipts: PlanningReceipt[];
};
export type PlanningOptions = { safetyDays: number; coverageDays: number; demandMultiplier: number };
export const DEFAULT_PLANNING_OPTIONS: PlanningOptions = { safetyDays: 7, coverageDays: 30, demandMultiplier: 1 };
export type PlanningStatus = "critical" | "order" | "soon" | "review" | "healthy";

export function planStock(input: PlanningInput, now: Date, options = DEFAULT_PLANNING_OPTIONS) {
  const observedDays = Math.max(1, Math.min(90, input.observedDays));
  const averageDailyUsage = input.consumed / observedDays;
  const recentDailyUsage = input.recentConsumed / Math.min(30, observedDays);
  // A recent increase should not be hidden by the longer historical average.
  const dailyUsage = Math.max(averageDailyUsage, recentDailyUsage) * options.demandMultiplier;
  const confidence = input.consumed <= 0 ? "none" : observedDays < 30 || input.demandDays < 5
    ? "low" : observedDays >= 60 && input.demandDays >= 12 ? "high" : "medium";
  const leadTimeKnown = input.leadTimeDays > 0;
  const scheduled: { day: number; quantity: number }[] = [];
  let overdueQuantity = 0;
  let undatedQuantity = 0;
  for (const receipt of input.receipts) {
    if (receipt.quantity <= 0) continue;
    const time = receipt.expectedAt ? Date.parse(receipt.expectedAt) : NaN;
    if (!Number.isFinite(time)) undatedQuantity += receipt.quantity;
    // An ETA is a calendar date; a delivery due today remains usable today.
    else if (new Date(time).toISOString().slice(0, 10) < now.toISOString().slice(0, 10)) overdueQuantity += receipt.quantity;
    else scheduled.push({ day: Math.max(0, (time - now.getTime()) / DAY_MS), quantity: receipt.quantity });
  }
  scheduled.sort((a, b) => a.day - b.day);
  // Coalesce simultaneous receipts so a zero-length interval cannot cause a false gap.
  const events: typeof scheduled = [];
  for (const event of scheduled) {
    if (events.at(-1)?.day === event.day) events[events.length - 1].quantity += event.quantity;
    else events.push({ ...event });
  }
  const safetyStock = input.minimumStock + dailyUsage * options.safetyDays;
  const balanceAt = (day: number) => input.quantity - dailyUsage * day
    + events.reduce((sum, event) => sum + (event.day <= day ? event.quantity : 0), 0);
  // Find the FIRST crossing, even when later deliveries recover the balance.
  const firstCrossing = (threshold: number, horizon: number): number | null => {
    let day = 0;
    let balance = input.quantity;
    for (const event of [...events.filter((event) => event.day <= horizon), { day: horizon, quantity: 0 }]) {
      if (event.day > day) {
        if (balance <= threshold) return day;
        if (dailyUsage > 0) {
          const crossing = day + (balance - threshold) / dailyUsage;
          if (crossing < event.day) return crossing;
        }
      }
      balance -= dailyUsage * (event.day - day);
      balance += event.quantity;
      day = event.day;
    }
    return balance <= threshold ? day : null;
  };
  const orderingHorizon = Math.max(PLANNING_HORIZON_DAYS, input.leadTimeDays + options.coverageDays + options.safetyDays);
  const firstStockoutDay = firstCrossing(0, orderingHorizon);
  const stockoutDay = firstStockoutDay !== null && firstStockoutDay <= PLANNING_HORIZON_DAYS ? firstStockoutDay : null;
  const safetyDay = dailyUsage > 0 ? firstCrossing(safetyStock, orderingHorizon)
    : balanceAt(0) < input.minimumStock ? 0 : null;
  const reorderInDays = leadTimeKnown && safetyDay !== null ? Math.max(0, safetyDay - input.leadTimeDays) : null;
  const dateAt = (day: number | null) => day === null ? null : new Date(now.getTime() + day * DAY_MS).toISOString();

  // Size a new order to cover the lead time, selected coverage and safety buffer.
  // A large late delivery must not cancel the quantity needed to bridge an earlier gap.
  const targetDay = input.leadTimeDays + options.coverageDays;
  let required = Math.max(0, safetyStock - balanceAt(targetDay));
  for (const event of events) {
    if (event.day >= input.leadTimeDays && event.day <= targetDay) {
      required = Math.max(required, safetyStock - (balanceAt(event.day) - event.quantity));
    }
  }
  const factor = input.purchaseUnitName ? Math.max(1, input.purchaseUnitFactor ?? 1) : 1;
  const suggestedQuantity = required > 0 ? Math.ceil(Math.max(required, input.reorderQuantity) / factor) * factor : 0;
  const critical = input.quantity <= 0 || (firstStockoutDay !== null && firstStockoutDay <= Math.max(7, input.leadTimeDays));
  const status: PlanningStatus = critical ? "critical"
    : reorderInDays !== null && reorderInDays <= 0 ? "order"
    : reorderInDays !== null && reorderInDays <= 7 ? "soon"
    : confidence === "none" || !leadTimeKnown || overdueQuantity > 0 || undatedQuantity > 0 || confidence === "low" ? "review"
    : "healthy";
  return {
    ...input, observedDays, averageDailyUsage, recentDailyUsage, dailyUsage, confidence,
    leadTimeKnown, overdueQuantity, undatedQuantity, safetyStock, status,
    stockoutDay, stockoutAt: dateAt(stockoutDay), reorderInDays, reorderAt: dateAt(reorderInDays),
    suggestedQuantity, suggestedPurchaseQuantity: suggestedQuantity / factor,
    onOrder: input.receipts.reduce((sum, receipt) => sum + receipt.quantity, 0),
    nextExpectedAt: events.length ? dateAt(events[0].day) : null,
    timeline: [
      ...Array.from({ length: 27 }, (_, index) => {
        const day = Math.min(index * 7, PLANNING_HORIZON_DAYS);
        return { day, quantity: balanceAt(day) };
      }),
      ...events.filter((event) => event.day <= PLANNING_HORIZON_DAYS).flatMap((event) => [
        { day: event.day, quantity: balanceAt(event.day) - event.quantity },
        { day: event.day, quantity: balanceAt(event.day) },
      ]),
    ].sort((a, b) => a.day - b.day || a.quantity - b.quantity),
  };
}

export type StockPlan = ReturnType<typeof planStock>;
export const PLANNING_STATUS_PRIORITY: Record<PlanningStatus, number> = { critical: 0, order: 1, soon: 2, review: 3, healthy: 4 };
