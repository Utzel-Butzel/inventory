import { z } from "zod";

export const notificationEventTypes = [
  "low_stock",
  "expiry",
  "maintenance",
  "return_due",
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];

export const notificationChannels = [
  "email",
  "push",
  "slack",
  "teams",
  "webhook",
] as const;

export type NotificationChannel = (typeof notificationChannels)[number];

export const notificationFrequencies = ["daily", "immediate"] as const;
export type NotificationFrequency = (typeof notificationFrequencies)[number];

export const notificationLocales = ["en", "de"] as const;
export type NotificationLocale = (typeof notificationLocales)[number];

export type NotificationMetadata = {
  name?: string;
  quantity?: number;
  minimumStock?: number;
  dueAt?: string;
  assignee?: string;
  fieldKey?: string;
  status?: string;
};

export const notificationPreferencePatchSchema = z
  .object({
    enabledEventTypes: z.array(z.enum(notificationEventTypes)).max(4).optional(),
    frequency: z.enum(notificationFrequencies).optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Expected an IANA timezone.")
      .optional(),
    locale: z.enum(notificationLocales).optional(),
    cooldownHours: z.number().int().min(1).max(720).optional(),
    lowStockThresholdPercent: z.number().int().min(1).max(500).optional(),
    expiryWindowDays: z.number().int().min(0).max(3650).optional(),
    expiryFieldKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
    maintenanceWindowDays: z.number().int().min(0).max(3650).optional(),
    maintenanceFieldKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .optional(),
    returnDueWindowDays: z.number().int().min(0).max(365).optional(),
    emailEnabled: z.boolean().optional(),
    pushEnabled: z.boolean().optional(),
    slackEnabled: z.boolean().optional(),
    teamsEnabled: z.boolean().optional(),
    webhookEnabled: z.boolean().optional(),
  })
  .strict();

export const notificationTestSchema = z
  .object({ channel: z.enum(notificationChannels) })
  .strict();

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().max(4_096),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1).max(1_024),
      auth: z.string().min(1).max(1_024),
    }),
  })
  .strict();

export const pushSubscriptionDeleteSchema = z
  .object({ endpoint: z.string().url().max(4_096) })
  .strict();

export type NotificationPreferencePatch = z.infer<
  typeof notificationPreferencePatchSchema
>;

export const notificationPreferencePatchKeys = [
  "enabledEventTypes",
  "frequency",
  "digestHour",
  "timezone",
  "locale",
  "cooldownHours",
  "lowStockThresholdPercent",
  "expiryWindowDays",
  "expiryFieldKey",
  "maintenanceWindowDays",
  "maintenanceFieldKey",
  "returnDueWindowDays",
  "emailEnabled",
  "pushEnabled",
  "slackEnabled",
  "teamsEnabled",
  "webhookEnabled",
] as const satisfies readonly (keyof NotificationPreferencePatch)[];

/** Keep strict API payloads free of read-only database fields. */
export function pickNotificationPreferencePatch(
  input: Record<string, unknown>,
): NotificationPreferencePatch {
  const patch: Record<string, unknown> = {};
  for (const key of notificationPreferencePatchKeys) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  return patch as NotificationPreferencePatch;
}
