import { and, sql, type SQLWrapper } from "drizzle-orm";
import type { InventoryTagCondition, InventoryTagFilter } from "./inventory-tag-filter";

export function inventoryTagFilterCondition(column: SQLWrapper, filter: InventoryTagFilter) {
  const conditions = ("conditions" in filter ? filter.conditions : [filter])
    .map((condition) => tagCondition(column, condition))
    .filter((condition) => condition !== undefined);
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

function tagCondition(column: SQLWrapper, filter: InventoryTagCondition) {
  if (filter.operator === "hasNot") return sql`cardinality(${column}) = 0`;
  if (!filter.tags.length) return undefined;
  const tags = sql`ARRAY[${sql.join(filter.tags.map((tag) => sql`${tag}`), sql`, `)}]::text[]`;
  const matches = sql`${column} && ${tags}`;
  return filter.operator === "isNot" ? sql`NOT (${matches})` : matches;
}
