export const INVENTORY_PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;

export type InventoryPageSize =
  (typeof INVENTORY_PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_INVENTORY_PAGE_SIZE: InventoryPageSize = 50;
export const MAX_INVENTORY_PAGE_SIZE = 500;

export function isInventoryPageSize(value: unknown): value is InventoryPageSize {
  return (
    typeof value === "number" &&
    INVENTORY_PAGE_SIZE_OPTIONS.includes(value as InventoryPageSize)
  );
}

export function normalizeInventoryPageSize(value: unknown): InventoryPageSize {
  return isInventoryPageSize(value) ? value : DEFAULT_INVENTORY_PAGE_SIZE;
}
