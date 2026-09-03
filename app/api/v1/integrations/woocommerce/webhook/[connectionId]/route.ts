import { z } from "zod";

import {
  handleWooCommerceWebhook,
  WooCommerceSyncError,
} from "@/lib/woocommerce-sync";
import {
  WooCommerceConfigurationError,
  WooCommerceConnectionError,
} from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 1_000_000;
type Context = { params: Promise<{ connectionId: string }> };

async function readLimitedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new WooCommerceSyncError("Webhook body is too large.", 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: Request, context: Context) {
  const { connectionId } = await context.params;
  if (!z.string().uuid().safeParse(connectionId).success) {
    return Response.json({ error: "Invalid connection ID." }, { status: 404 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Webhook body is too large." }, { status: 413 });
  }
  try {
    const rawBody = await readLimitedBody(request);
    const result = await handleWooCommerceWebhook({
      connectionId,
      rawBody,
      signature: request.headers.get("x-wc-webhook-signature"),
      topic: request.headers.get("x-wc-webhook-topic"),
      deliveryId:
        request.headers.get("x-wc-webhook-delivery-id") ??
        request.headers.get("x-wc-delivery-id"),
      webhookId: request.headers.get("x-wc-webhook-id"),
    });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof WooCommerceSyncError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof WooCommerceConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof WooCommerceConnectionError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    return Response.json(
      { error: "WooCommerce webhook processing failed." },
      { status: 500 },
    );
  }
}
