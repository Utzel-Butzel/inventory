import { z } from "zod";

export const stockMovementSchema = z
  .object({
    delta: z.number().int().min(-2_000_000_000).max(2_000_000_000),
    quantity: z.number().int().min(0).max(2_000_000_000).optional(),
    type: z.enum([
      "receipt",
      "issue",
      "adjustment",
      "return",
      "waste",
      "transfer",
    ]),
    reason: z.string().trim().max(240).nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
    location: z.string().trim().max(240).nullable().optional(),
    fromLocationResourceId: z.string().uuid().nullable().optional(),
    toLocationResourceId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    occurredAt: z.string().datetime().optional(),
    totalPriceCents: z
      .number()
      .int()
      .min(-2_000_000_000)
      .max(2_000_000_000)
      .nullable()
      .optional(),
    priceCurrency: z
      .string()
      .trim()
      .length(3)
      .toUpperCase()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.totalPriceCents == null) !== (value.priceCurrency == null)) {
      context.addIssue({
        code: "custom",
        path: [
          value.totalPriceCents == null ? "totalPriceCents" : "priceCurrency",
        ],
        message: "totalPriceCents and priceCurrency must be supplied together.",
      });
    }
    const structuredTransfer =
      value.type === "transfer" &&
      (value.delta === 0 ||
        Boolean(value.fromLocationResourceId) ||
        Boolean(value.toLocationResourceId));
    if (structuredTransfer && value.quantity === undefined) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "A location transfer requires a quantity.",
      });
    }
    if (structuredTransfer && value.delta !== 0) {
      context.addIssue({
        code: "custom",
        path: ["delta"],
        message: "A location transfer must keep the global balance unchanged (delta 0).",
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

export const manualStockMovementSchema = stockMovementSchema.superRefine(
  (value, context) => {
    if (
      value.type === "transfer" ||
      value.fromLocationResourceId ||
      value.toLocationResourceId
    ) {
      context.addIssue({
        code: "custom",
        path: ["type"],
        message: "Only manual bulk movements can be corrected here.",
      });
    }
  },
);

export type StockMovementRequest = z.infer<typeof stockMovementSchema>;
