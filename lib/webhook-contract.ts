import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { z } from "zod";

export const WEBHOOK_EVENT_TYPES = [
  "inventory.resource.created",
  "inventory.resource.updated",
  "inventory.resource.deleted",
  "inventory.resource.merged",
  "inventory.stock.movement.created",
] as const;

export type WebhookSubscriptionEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type WebhookEventType =
  | WebhookSubscriptionEventType
  | "inventory.webhook.test";

const webhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);
const webhookUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .url();

export const webhookEndpointCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    url: webhookUrlSchema,
    eventTypes: z
      .array(webhookEventTypeSchema)
      .min(1)
      .max(WEBHOOK_EVENT_TYPES.length)
      .refine((values) => new Set(values).size === values.length, {
        message: "Webhook event subscriptions must be unique.",
      }),
    enabled: z.boolean().optional().default(true),
  })
  .strict()
  .transform((value) => value);

export const webhookEndpointPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    url: webhookUrlSchema.optional(),
    eventTypes: z
      .array(webhookEventTypeSchema)
      .min(1)
      .max(WEBHOOK_EVENT_TYPES.length)
      .refine((values) => new Set(values).size === values.length, {
        message: "Webhook event subscriptions must be unique.",
      })
      .optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one webhook setting is required.",
  })
  .transform((value) => value);

export type WebhookEndpointCreate = z.infer<typeof webhookEndpointCreateSchema>;
export type WebhookEndpointPatch = z.infer<typeof webhookEndpointPatchSchema>;

function parseIpv4(value: string) {
  const parts = value.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isPrivateWebhookAddress(address: string) {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) {
    const parts = parseIpv4(normalized);
    if (!parts) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[cdef]/.test(normalized)) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith("ff")) return true;
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPrivateWebhookAddress(mapped);
    const hexadecimalMapped = normalized.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexadecimalMapped) {
      const high = Number.parseInt(hexadecimalMapped[1]!, 16);
      const low = Number.parseInt(hexadecimalMapped[2]!, 16);
      return isPrivateWebhookAddress(
        `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
      );
    }
    return false;
  }
  return false;
}

export function validateWebhookTargetUrl(
  value: string,
  options: { allowPrivateNetworks?: boolean } = {},
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Webhook target must be a valid absolute URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Webhook target must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Webhook target must not contain credentials.");
  }
  if (url.hash) {
    throw new Error("Webhook target must not contain a fragment.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new Error("Webhook target must include a hostname.");
  if (
    !options.allowPrivateNetworks &&
    (hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      isPrivateWebhookAddress(hostname))
  ) {
    throw new Error("Webhook target must not resolve to a private network.");
  }
  url.hostname = hostname;
  return url.toString();
}

export function redactWebhookTarget(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : "/…"}`;
  } catch {
    return "[redacted-url]";
  }
}

export function signWebhookPayload(body: string, secret: string, timestamp: number) {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];

export function webhookRetryDelayMs(attempt: number) {
  const index = Math.min(
    RETRY_DELAYS_MS.length - 1,
    Math.max(0, Math.trunc(attempt) - 1),
  );
  return RETRY_DELAYS_MS[index]!;
}

export function isWebhookRetryableStatus(status: number) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

export type WebhookEventEnvelope = {
  id: string;
  type: WebhookEventType;
  apiVersion: "1";
  occurredAt: string;
  actor: string | null;
  data: Record<string, unknown>;
};
