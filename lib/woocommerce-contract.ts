import { z } from "zod";

import { validateWebhookTargetUrl } from "@/lib/webhook-contract";

export const wooCommerceConnectionInputSchema = z
  .object({
    storeUrl: z.string().trim().min(1).max(2_048),
    consumerKey: z
      .string()
      .trim()
      .min(8)
      .max(200)
      .startsWith("ck_", "The Consumer Key must start with ck_."),
    consumerSecret: z
      .string()
      .trim()
      .min(8)
      .max(200)
      .startsWith("cs_", "The Consumer Secret must start with cs_."),
  })
  .strict();

export type WooCommerceConnectionInput = z.infer<
  typeof wooCommerceConnectionInputSchema
>;

export function normalizeWooCommerceStoreUrl(
  value: string,
  options: { allowPrivateNetworks?: boolean } = {},
) {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim())
    ? value.trim()
    : `https://${value.trim()}`;
  let normalized: URL;
  try {
    normalized = new URL(
      validateWebhookTargetUrl(candidate, {
        allowPrivateNetworks: options.allowPrivateNetworks,
      }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid URL.";
    throw new Error(
      detail.replace(/^Webhook target/i, "WooCommerce store URL"),
    );
  }
  if (normalized.search || normalized.hash) {
    throw new Error(
      "WooCommerce store URL must not contain a query string or fragment.",
    );
  }
  normalized.pathname = normalized.pathname.replace(/\/+$/, "");
  return normalized.toString().replace(/\/$/, "");
}

export function wooCommerceApiUrl(storeUrl: string, path: string) {
  const base = new URL(`${storeUrl.replace(/\/+$/, "")}/`);
  const prefix = base.pathname.replace(/\/+$/, "");
  base.pathname = `${prefix}/wp-json/wc/v3/${path.replace(/^\/+/, "")}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function redactWooCommerceConsumerKey(value: string) {
  const key = value.trim();
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}
