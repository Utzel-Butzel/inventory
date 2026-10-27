import { z } from "zod";

export const MAX_STOCK_UNIT_CODE_LENGTH = 180;
export const STOCK_UNIT_CODE_CONFLICT = "A serialized unit with that code already exists for this item.";

export const stockUnitCodeSchema = z.string().trim().min(1).max(MAX_STOCK_UNIT_CODE_LENGTH);

export function isStockUnitCodeConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (typeof error === "object" && error !== null && !seen.has(error)) {
    seen.add(error);
    const failure = error as { code?: unknown; constraint_name?: unknown; message?: unknown; cause?: unknown };
    if (
      (failure.code === "23505" && failure.constraint_name === "stock_units_resource_code_unique") ||
      (typeof failure.message === "string" && failure.message.includes("stock_units_resource_code_unique"))
    ) return true;
    // Drizzle wraps the database error in `cause`.
    error = failure.cause;
  }
  return false;
}
