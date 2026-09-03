import { z } from "zod";

import {
  loanOrderStatuses,
  orderTypes,
  purchaseOrderStatuses,
  salesOrderStatuses,
  type OrderStatus,
  type OrderType,
} from "@/db/schema";

export const orderTypeSchema = z.enum(orderTypes);

export const orderLineInputSchema = z
  .object({
    resourceId: z.string().uuid(),
    quantity: z.number().int().min(1).max(2_000_000_000),
    expectedAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
    unitPriceCents: z
      .number()
      .int()
      .min(0)
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
  .refine(
    (value) => (value.unitPriceCents == null) === (value.priceCurrency == null),
    { message: "unitPriceCents and priceCurrency must be supplied together." },
  );

export const orderCreateSchema = z
  .object({
    type: orderTypeSchema,
    contactId: z.string().uuid(),
    reference: z.string().trim().max(160).nullable().optional(),
    status: z.string().trim().max(32).optional(),
    orderedAt: z.string().datetime().optional(),
    expectedAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
    lines: z.array(orderLineInputSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status && !isOrderStatusForType(value.type, value.status)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: `Status ${value.status} is not valid for a ${value.type} order.`,
      });
    }
    if (value.type === "loan" && !value.expectedAt) {
      context.addIssue({
        code: "custom",
        path: ["expectedAt"],
        message: "A loan order requires a return due date.",
      });
    }
    if (value.expectedAt && value.orderedAt) {
      const start = new Date(value.orderedAt);
      const due = new Date(value.expectedAt);
      if (due <= start) {
        context.addIssue({
          code: "custom",
          path: ["expectedAt"],
          message: "The due date must be after the order date.",
        });
      }
    }
  });

export const orderPatchSchema = z
  .object({
    contactId: z.string().uuid().optional(),
    reference: z.string().trim().max(160).nullable().optional(),
    status: z.string().trim().max(32).optional(),
    orderedAt: z.string().datetime().optional(),
    expectedAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one order change.",
  });

export const orderLineMovementSchema = z
  .object({
    action: z.enum(["issue", "return"]),
    quantity: z.number().int().min(1).max(2_000_000_000),
    occurredAt: z.string().datetime().optional(),
    location: z.string().trim().max(240).nullable().optional(),
    note: z.string().trim().max(20_000).optional(),
  })
  .strict();

export type OrderCreateRequest = z.infer<typeof orderCreateSchema>;
export type OrderPatchRequest = z.infer<typeof orderPatchSchema>;
export type OrderLineMovementRequest = z.infer<typeof orderLineMovementSchema>;

export function statusesForOrderType(type: OrderType): readonly string[] {
  if (type === "purchase") return purchaseOrderStatuses;
  if (type === "sale") return salesOrderStatuses;
  return loanOrderStatuses;
}

export function isOrderStatusForType(
  type: OrderType,
  status: string,
): status is OrderStatus {
  return statusesForOrderType(type).includes(status);
}

export function defaultOrderStatus(type: OrderType): OrderStatus {
  if (type === "purchase") return "ordered";
  if (type === "sale") return "confirmed";
  return "reserved";
}

export function requiredContactRole(type: OrderType) {
  return type === "purchase" ? "supplier" : "customer";
}

export function deriveOrderStatus(
  type: Exclude<OrderType, "purchase">,
  current: OrderStatus,
  lines: Array<{
    orderedQuantity: number;
    fulfilledQuantity: number;
    returnedQuantity: number;
  }>,
  expectedAt?: Date | null,
  now = new Date(),
): OrderStatus {
  if (current === "cancelled" || current === "draft") return current;
  if (type === "sale") {
    if (lines.every((line) => line.fulfilledQuantity >= line.orderedQuantity)) {
      return "fulfilled";
    }
    return lines.some((line) => line.fulfilledQuantity > 0)
      ? "partially-fulfilled"
      : "confirmed";
  }

  const totalIssued = lines.reduce(
    (total, line) => total + line.fulfilledQuantity,
    0,
  );
  const totalReturned = lines.reduce(
    (total, line) => total + line.returnedQuantity,
    0,
  );
  if (totalIssued > 0 && totalReturned >= totalIssued) return "returned";
  if (totalReturned > 0) return "partially-returned";
  if (expectedAt && expectedAt < now && totalIssued > 0) return "overdue";
  if (lines.every((line) => line.fulfilledQuantity >= line.orderedQuantity)) {
    return "issued";
  }
  return totalIssued > 0 ? "partially-issued" : "reserved";
}
