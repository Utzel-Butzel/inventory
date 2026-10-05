import { z } from "zod";

export const MAX_TAG_FILTER_CONDITIONS = 10;
export const MAX_TAG_FILTER_TAGS = 80;

const inventoryTagConditionSchema = z.object({
  operator: z.enum(["is", "isNot", "hasNot"]),
  tags: z.array(z.string().min(1).max(60)).max(MAX_TAG_FILTER_TAGS),
}).strict();

export type InventoryTagCondition = z.infer<typeof inventoryTagConditionSchema>;
export const inventoryTagFilterSchema = z.union([
  inventoryTagConditionSchema,
  z.object({
    conditions: z.array(inventoryTagConditionSchema).min(1).max(MAX_TAG_FILTER_CONDITIONS),
  }).strict().refine((filter) => filter.conditions.reduce((total, condition) => total + condition.tags.length, 0) <= MAX_TAG_FILTER_TAGS),
]);
export type InventoryTagFilter = z.infer<typeof inventoryTagFilterSchema>;

export function inventoryTagConditions(filter: InventoryTagFilter): InventoryTagCondition[] {
  return "conditions" in filter ? filter.conditions : [filter];
}

/** Keep existing saved single-tag views readable, including a literal "all" tag. */
export function readInventoryTagFilter(value: string): InventoryTagFilter {
  if (value.startsWith("=")) return { operator: "is", tags: [value.slice(1)] };
  try {
    const result = inventoryTagFilterSchema.safeParse(JSON.parse(value));
    if (result.success) return result.data;
  } catch { /* An unset or legacy sentinel means no filter. */ }
  return { operator: "is", tags: [] };
}

export function writeInventoryTagFilter(filter: InventoryTagFilter): string {
  const conditions = inventoryTagConditions(filter).map((condition) => ({ ...condition, tags: [...new Set(condition.tags)] }));
  if (!conditions.length || (conditions.length === 1 && conditions[0].operator === "is" && !conditions[0].tags.length)) return "all";
  return JSON.stringify("conditions" in filter ? { conditions } : conditions[0]);
}

export function isInventoryTagFilterActive(filter: InventoryTagFilter): boolean {
  return inventoryTagConditions(filter).some((condition) => condition.operator === "hasNot" || condition.tags.length > 0);
}
