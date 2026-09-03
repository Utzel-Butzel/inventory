import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const WOO_COMMERCE_STOCK_ACTIVE_ORDER_STATUSES = [
  "on-hold",
  "processing",
  "completed",
] as const;

const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

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
  })
  .passthrough();

export const wooCommerceOrderSchema = z
  .object({
    id: positiveInteger,
    number: z.union([z.string(), z.number()]).transform(String),
    status: z.string().trim().min(1).max(80),
    date_modified_gmt: z.string().nullable().optional(),
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

export const wooCommerceManualSyncSchema = z
  .object({
    orderId: positiveInteger.optional(),
  })
  .strict();

export type WooCommerceOrder = z.infer<typeof wooCommerceOrderSchema>;
export type WooCommerceRefund = z.infer<typeof wooCommerceRefundSchema>;

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
