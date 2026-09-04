import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const WOO_COMMERCE_STOCK_ACTIVE_ORDER_STATUSES = [
  "on-hold",
  "processing",
  "completed",
] as const;

export const WOO_COMMERCE_RECENT_IMPORT_DAYS = 7;

const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const wooCommerceDecimalSchema = z
  .union([z.string().trim().min(1).max(80), z.number().finite()])
  .transform(String);

const wooCommerceAddressSchema = z
  .object({
    first_name: z.string().trim().max(2_000).catch(""),
    last_name: z.string().trim().max(2_000).catch(""),
    company: z.string().trim().max(2_000).catch(""),
    address_1: z.string().trim().max(2_000).catch(""),
    address_2: z.string().trim().max(2_000).catch(""),
    city: z.string().trim().max(2_000).catch(""),
    state: z.string().trim().max(2_000).catch(""),
    postcode: z.string().trim().max(2_000).catch(""),
    country: z.string().trim().max(2_000).catch(""),
    email: z.string().trim().max(2_000).catch(""),
    phone: z.string().trim().max(2_000).catch(""),
  })
  .passthrough();

const wooCommerceMetaDataSchema = z
  .object({
    key: z.string(),
    value: z.union([z.string(), z.number()]),
  })
  .passthrough();

export const wooCommerceOrderLineSchema = z
  .object({
    id: positiveInteger,
    product_id: nonNegativeInteger,
    variation_id: nonNegativeInteger,
    quantity: nonNegativeInteger,
    sku: z.string().trim().max(200).catch(""),
    name: z.string().trim().max(2_000).catch(""),
    price: wooCommerceDecimalSchema.optional(),
    subtotal: wooCommerceDecimalSchema.optional(),
    total: wooCommerceDecimalSchema.optional(),
  })
  .passthrough();

export const wooCommerceOrderSchema = z
  .object({
    id: positiveInteger,
    number: z.union([z.string(), z.number()]).transform(String),
    status: z.string().trim().min(1).max(80),
    customer_id: nonNegativeInteger.optional().catch(0),
    currency: z.string().trim().toUpperCase().length(3).optional().catch("EUR"),
    total: wooCommerceDecimalSchema.optional(),
    payment_method: z.string().trim().max(240).optional().catch(""),
    payment_method_title: z.string().trim().max(240).optional().catch(""),
    customer_note: z.string().trim().max(20_000).optional().catch(""),
    date_created_gmt: z.string().trim().max(64).nullable().optional(),
    date_modified_gmt: z.string().nullable().optional(),
    billing: wooCommerceAddressSchema.optional(),
    shipping: wooCommerceAddressSchema.optional(),
    line_items: z.array(wooCommerceOrderLineSchema),
  })
  .passthrough();

export const wooCommerceRefundLineSchema = z
  .object({
    id: positiveInteger,
    product_id: nonNegativeInteger,
    variation_id: nonNegativeInteger,
    quantity: z.number().int(),
    sku: z.string().trim().max(200).catch(""),
    meta_data: z.array(wooCommerceMetaDataSchema).catch([]),
  })
  .passthrough();

export const wooCommerceRefundSchema = z
  .object({
    id: positiveInteger,
    line_items: z.array(wooCommerceRefundLineSchema).catch([]),
  })
  .passthrough();

export const wooCommerceSyncPatchSchema = z
  .object({
    syncEnabled: z.boolean(),
  })
  .strict();

export const wooCommerceManualSyncSchema = z.union([
  z.object({ orderId: positiveInteger }).strict(),
  z.object({ window: z.literal("last-7-days") }).strict(),
  z.object({}).strict(),
]);

export function wooCommerceRecentImportWindow(now = new Date()) {
  const before = new Date(now);
  const after = new Date(
    before.getTime() - WOO_COMMERCE_RECENT_IMPORT_DAYS * 24 * 60 * 60 * 1_000,
  );
  return {
    after: after.toISOString(),
    before: before.toISOString(),
  };
}

export type WooCommerceOrder = z.infer<typeof wooCommerceOrderSchema>;
export type WooCommerceRefund = z.infer<typeof wooCommerceRefundSchema>;

export function wooCommerceCustomerIdentity(order: WooCommerceOrder) {
  const customerId = order.customer_id && order.customer_id > 0
    ? order.customer_id
    : null;
  const emailCandidate = order.billing?.email.trim().toLowerCase() || "";
  const email =
    emailCandidate.length <= 320 &&
    /^[^\s@]+@[^\s@]+$/.test(emailCandidate)
      ? emailCandidate
      : null;
  return {
    customerId,
    email,
    key: customerId
      ? `customer:${customerId}`
      : email
        ? `email:${email}`
        : `order:${order.id}`,
  };
}

export function parseWooCommerceMoneyToCents(
  value: string | number | null | undefined,
) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function wooCommerceProjectedSalesStatus(input: {
  wooStatus: string;
  unresolved: boolean;
  lines: Array<{
    orderedQuantity: number;
    fulfilledQuantity: number;
    returnedQuantity: number;
  }>;
}) {
  const totalFulfilled = input.lines.reduce(
    (total, line) => total + line.fulfilledQuantity,
    0,
  );
  const totalReturned = input.lines.reduce(
    (total, line) => total + line.returnedQuantity,
    0,
  );
  const active = (
    WOO_COMMERCE_STOCK_ACTIVE_ORDER_STATUSES as readonly string[]
  ).includes(input.wooStatus);

  if (totalFulfilled > 0 && totalReturned >= totalFulfilled) return "returned";
  if (totalReturned > 0) return "partially-returned";
  if (!active) {
    return input.wooStatus === "pending" ? "draft" : "cancelled";
  }
  if (input.unresolved) {
    return totalFulfilled > 0 ? "partially-fulfilled" : "confirmed";
  }
  if (
    input.lines.length > 0 &&
    input.lines.every(
      (line) => line.fulfilledQuantity >= line.orderedQuantity,
    )
  ) {
    return "fulfilled";
  }
  return totalFulfilled > 0 ? "partially-fulfilled" : "confirmed";
}

export type WooCommerceLineTarget = {
  lineItemId: number;
  productId: number;
  variationId: number;
  sku: string;
  orderedQuantity: number;
  refundedQuantity: number;
  targetQuantity: number;
};

function refundOriginalLineId(
  line: z.infer<typeof wooCommerceRefundLineSchema>,
) {
  const value = line.meta_data.find(
    (entry) => entry.key === "_refunded_item_id",
  )?.value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function computeWooCommerceLineTargets(
  order: WooCommerceOrder,
  refunds: WooCommerceRefund[],
) {
  const refundedByLine = new Map<number, number>();
  for (const refund of refunds) {
    for (const refundLine of refund.line_items) {
      let lineId = refundOriginalLineId(refundLine);
      if (!lineId) {
        const candidates = order.line_items.filter((line) =>
          refundLine.variation_id > 0
            ? line.variation_id === refundLine.variation_id
            : line.product_id === refundLine.product_id,
        );
        if (candidates.length === 1) lineId = candidates[0]!.id;
      }
      if (!lineId) continue;
      refundedByLine.set(
        lineId,
        (refundedByLine.get(lineId) ?? 0) + Math.abs(refundLine.quantity),
      );
    }
  }

  const active = (
    WOO_COMMERCE_STOCK_ACTIVE_ORDER_STATUSES as readonly string[]
  ).includes(order.status);
  return order.line_items.map<WooCommerceLineTarget>((line) => {
    const refundedQuantity = Math.min(
      line.quantity,
      refundedByLine.get(line.id) ?? 0,
    );
    return {
      lineItemId: line.id,
      productId: line.product_id,
      variationId: line.variation_id,
      sku: line.sku.trim(),
      orderedQuantity: line.quantity,
      refundedQuantity,
      targetQuantity: active
        ? Math.max(0, line.quantity - refundedQuantity)
        : 0,
    };
  });
}

export function verifyWooCommerceWebhookSignature(
  rawBody: string,
  secret: string,
  suppliedSignature: string | null,
) {
  if (!suppliedSignature) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(suppliedSignature.trim());
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export function wooCommercePayloadHash(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function wooCommerceMovementIdempotencyKey(input: {
  connectionId: string;
  orderId: number;
  lineItemId: number;
  resourceId: string;
  variantId: string | null;
  revision: number;
  targetQuantity: number;
}) {
  const hex = createHash("sha256")
    .update(
      [
        "woocommerce-stock-v1",
        input.connectionId,
        input.orderId,
        input.lineItemId,
        input.resourceId,
        input.variantId ?? "resource",
        input.revision,
        input.targetQuantity,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
