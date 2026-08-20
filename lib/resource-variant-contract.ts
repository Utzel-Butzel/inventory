import { z } from "zod";

export const MAX_VARIANT_STOCK_QUANTITY = 2_000_000_000;

const nullableIdentifier = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .transform((value) => value || null);

const optionalNullableIdentifier = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));

const currencySchema = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z]{3}$/.test(value), "Use a three-letter currency code.");

export const resourceVariantCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    sku: nullableIdentifier(80).default(null),
    barcode: nullableIdentifier(180).default(null),
    priceCents: z.number().int().min(0).max(MAX_VARIANT_STOCK_QUANTITY).nullable().default(null),
    currency: currencySchema.optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    initialAllocation: z
      .number()
      .int()
      .min(0)
      .max(MAX_VARIANT_STOCK_QUANTITY)
      .default(0),
  })
  .strict();

export const resourceVariantPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(240).optional(),
    sku: optionalNullableIdentifier(80),
    barcode: optionalNullableIdentifier(180),
    priceCents: z
      .number()
      .int()
      .min(0)
      .max(MAX_VARIANT_STOCK_QUANTITY)
      .nullable()
      .optional(),
    currency: currencySchema.optional(),
    position: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();

export const resourceVariantMovementSchema = z
  .object({
    delta: z
      .number()
      .int()
      .min(-MAX_VARIANT_STOCK_QUANTITY)
      .max(MAX_VARIANT_STOCK_QUANTITY),
    type: z
      .enum(["receipt", "issue", "adjustment", "return", "waste"])
      .default("adjustment"),
    reason: z.string().trim().max(240).nullable().optional(),
    note: z.string().trim().max(20_000).default(""),
    occurredAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.delta === 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: "A variant stock movement must change the quantity.",
      });
    }
    if (["receipt", "return"].includes(value.type) && value.delta <= 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: `${value.type} requires a positive quantity.`,
      });
    }
    if (["issue", "waste"].includes(value.type) && value.delta >= 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: `${value.type} requires a negative quantity.`,
      });
    }
  });

export type ResourceVariantCreateInput = z.infer<
  typeof resourceVariantCreateSchema
>;
export type ResourceVariantPatchInput = z.infer<
  typeof resourceVariantPatchSchema
>;
export type ResourceVariantMovementInput = z.infer<
  typeof resourceVariantMovementSchema
>;

export type ResourceVariantDto = {
  id: string;
  resourceId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceCents: number | null;
  currency: string;
  quantity: number;
  position: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResourceVariantStockSummary = {
  totalQuantity: number;
  allocatedQuantity: number;
  unallocatedQuantity: number;
  variantCount: number;
};

export function computeVariantStockSummary(
  totalQuantity: number,
  variantQuantities: readonly number[],
): ResourceVariantStockSummary {
  const allocatedQuantity = variantQuantities.reduce(
    (total, quantity) => total + quantity,
    0,
  );
  return {
    totalQuantity,
    allocatedQuantity,
    unallocatedQuantity: totalQuantity - allocatedQuantity,
    variantCount: variantQuantities.length,
  };
}

export function nextVariantStockQuantities(
  parentQuantity: number,
  variantQuantity: number,
  delta: number,
  allowNegativeStock = false,
) {
  if (![parentQuantity, variantQuantity, delta].every(Number.isInteger)) {
    throw new RangeError("Stock quantities must be whole numbers.");
  }
  const nextParentQuantity = parentQuantity + delta;
  const nextVariantQuantity = variantQuantity + delta;
  if (
    !allowNegativeStock &&
    ((nextParentQuantity < 0 && nextParentQuantity < parentQuantity) ||
      (nextVariantQuantity < 0 && nextVariantQuantity < variantQuantity))
  ) {
    throw new RangeError("This booking would make stock negative.");
  }
  if (
    Math.abs(nextParentQuantity) > MAX_VARIANT_STOCK_QUANTITY ||
    Math.abs(nextVariantQuantity) > MAX_VARIANT_STOCK_QUANTITY
  ) {
    throw new RangeError("This booking exceeds the maximum supported stock.");
  }
  return { nextParentQuantity, nextVariantQuantity };
}
