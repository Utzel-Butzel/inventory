import "server-only";

import {
  and,
  count,
  desc,
  eq,
  gt,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import webpush, { type PushSubscription } from "web-push";

import {
  inventoryAssignments,
  notificationDispatches,
  notificationInbox,
  notificationPreferences,
  notificationPushSubscriptions,
  organizations,
  resources,
  stockSettings,
} from "@/db/schema";
import type {
  NotificationChannel,
  NotificationEventType,
  NotificationLocale,
  NotificationMetadata,
  NotificationPreferencePatch,
} from "@/lib/notification-contract";
import { db } from "@/lib/db";
import { organizationPath } from "@/lib/organization-path";
import { getOrganization } from "@/lib/organizations";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  boundedDigest,
  channelPreview,
  cooldownBucket,
  digestIsDue,
  fallsWithinWindow,
  notificationCopy,
  parseNotificationDate,
  redactTarget,
} from "@/lib/notification-policy";

type Recipient = {
  organizationId: string;
  key: string;
  email?: string | null;
  name?: string | null;
  locale?: NotificationLocale;
};

type InboxRecord = typeof notificationInbox.$inferSelect;
type PreferenceRecord = typeof notificationPreferences.$inferSelect;

type NotificationCandidate = {
  eventType: NotificationEventType;
  sourceKey: string;
  resourceId?: string;
  assignmentId?: string;
  href?: string;
  metadata: NotificationMetadata;
};

const safeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted-url]")
    .slice(0, 2_000);

export function notificationRecipient(subject: string, email?: string | null) {
  return (email?.trim().toLocaleLowerCase("en-US") || subject.trim()).slice(0, 320);
}

export async function ensureNotificationPreferences(recipient: Recipient) {
  const now = new Date();
  const email = recipient.email?.trim().toLocaleLowerCase("en-US") || null;
  const name = recipient.name?.trim() || null;
  let [preference] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, recipient.organizationId),
        eq(notificationPreferences.recipientKey, recipient.key),
      ),
    )
    .limit(1);
  if (!preference) {
    [preference] = await db
      .insert(notificationPreferences)
      .values({
        organizationId: recipient.organizationId,
        recipientKey: recipient.key,
        recipientEmail: email,
        recipientName: name,
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        locale: recipient.locale ?? DEFAULT_NOTIFICATION_PREFERENCES.locale,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!preference) {
      [preference] = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.organizationId, recipient.organizationId),
            eq(notificationPreferences.recipientKey, recipient.key),
          ),
        )
        .limit(1);
    }
  } else if (
    preference.recipientEmail !== email ||
    preference.recipientName !== name
  ) {
    [preference] = await db
      .update(notificationPreferences)
      .set({ recipientEmail: email, recipientName: name, updatedAt: now })
      .where(
        and(
          eq(notificationPreferences.organizationId, recipient.organizationId),
          eq(notificationPreferences.recipientKey, recipient.key),
        ),
      )
      .returning();
  }
  if (!preference) throw new Error("Unable to initialize notification preferences.");
  return preference;
}

async function readNotificationPreferences(recipient: Recipient) {
  const [preference] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, recipient.organizationId),
        eq(notificationPreferences.recipientKey, recipient.key),
      ),
    )
    .limit(1);
  return preference ?? null;
}

function defaultNotificationPreference(recipient: Recipient): PreferenceRecord {
  const timestamp = new Date(0);
  return {
    organizationId: recipient.organizationId,
    recipientKey: recipient.key,
    recipientEmail:
      recipient.email?.trim().toLocaleLowerCase("en-US") || null,
    recipientName: recipient.name?.trim() || null,
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    locale: recipient.locale ?? DEFAULT_NOTIFICATION_PREFERENCES.locale,
    lastDigestAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function notificationPreferenceForRead(recipient: Recipient) {
  return (
    (await readNotificationPreferences(recipient)) ??
    defaultNotificationPreference(recipient)
  );
}

// Background notification jobs must not mutate read-only organizations.
async function writableNotificationPreferences(organizationId?: string) {
  const joinCondition = and(
    eq(organizations.id, notificationPreferences.organizationId),
    eq(organizations.isReadOnly, false),
  );
  const rows = organizationId
    ? await db
        .select({ preference: notificationPreferences })
        .from(notificationPreferences)
        .innerJoin(organizations, joinCondition)
        .where(eq(notificationPreferences.organizationId, organizationId))
    : await db
        .select({ preference: notificationPreferences })
        .from(notificationPreferences)
        .innerJoin(organizations, joinCondition);
  return rows.map((row) => row.preference);
}

export function notificationRuntimeConfiguration() {
  const emailTarget = process.env.NOTIFICATION_EMAIL_FROM?.trim() || null;
  const pushSubject = process.env.WEB_PUSH_SUBJECT?.trim() || null;
  const slackTarget = process.env.NOTIFICATION_SLACK_WEBHOOK_URL?.trim() || null;
  const teamsTarget = process.env.NOTIFICATION_TEAMS_WEBHOOK_URL?.trim() || null;
  const webhookTarget = process.env.NOTIFICATION_WEBHOOK_URL?.trim() || null;
  return {
    email: {
      configured: Boolean(process.env.SMTP_HOST?.trim() && emailTarget),
      target: redactTarget(emailTarget),
    },
    push: {
      configured: Boolean(
        process.env.WEB_PUSH_PUBLIC_KEY?.trim() &&
          process.env.WEB_PUSH_PRIVATE_KEY?.trim() &&
          pushSubject &&
          process.env.NOTIFICATION_ENCRYPTION_KEY?.trim(),
      ),
      target: pushSubject ? "browser subscription" : null,
      publicKey: process.env.WEB_PUSH_PUBLIC_KEY?.trim() || null,
    },
    slack: {
      configured: Boolean(slackTarget),
      target: redactTarget(slackTarget),
    },
    teams: {
      configured: Boolean(teamsTarget),
      target: redactTarget(teamsTarget),
    },
    webhook: {
      configured: Boolean(webhookTarget),
      target: redactTarget(webhookTarget),
    },
  };
}

export async function getNotificationSettings(
  recipient: Recipient,
  options: { initializePreference?: boolean } = {},
) {
  const preference =
    options.initializePreference === false
      ? await notificationPreferenceForRead(recipient)
      : await ensureNotificationPreferences(recipient);
  const [{ value: subscriptionCount }] = await db
    .select({ value: count() })
    .from(notificationPushSubscriptions)
    .where(
      and(
        eq(notificationPushSubscriptions.recipientKey, recipient.key),
        eq(
          notificationPushSubscriptions.organizationId,
          recipient.organizationId,
        ),
        isNull(notificationPushSubscriptions.revokedAt),
      ),
    );
  return {
    preference,
    runtime: notificationRuntimeConfiguration(),
    pushSubscriptionCount: Number(subscriptionCount ?? 0),
  };
}

export async function updateNotificationPreferences(
  recipient: Recipient,
  patch: NotificationPreferencePatch,
) {
  const current = await ensureNotificationPreferences(recipient);
  const externalChanged = ([
    "emailEnabled",
    "pushEnabled",
    "slackEnabled",
    "teamsEnabled",
    "webhookEnabled",
  ] as const).some(
    (key) => patch[key] !== undefined && patch[key] !== current[key],
  );
  const [updated] = await db
    .update(notificationPreferences)
    .set({
      ...patch,
      ...(externalChanged ? { lastDigestAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationPreferences.organizationId, recipient.organizationId),
        eq(notificationPreferences.recipientKey, current.recipientKey),
      ),
    )
    .returning();
  return updated ?? current;
}

export async function listInbox(
  recipient: Recipient,
  options: {
    limit?: number;
    unreadOnly?: boolean;
    initializePreference?: boolean;
  } = {},
) {
  if (options.initializePreference !== false) {
    await ensureNotificationPreferences(recipient);
  }
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const where = options.unreadOnly
    ? and(
        eq(notificationInbox.recipientKey, recipient.key),
        eq(notificationInbox.organizationId, recipient.organizationId),
        isNull(notificationInbox.readAt),
      )
    : and(
        eq(notificationInbox.organizationId, recipient.organizationId),
        eq(notificationInbox.recipientKey, recipient.key),
      );
  const [notifications, [{ value: unread }]] = await Promise.all([
    db
      .select()
      .from(notificationInbox)
      .where(where)
      .orderBy(desc(notificationInbox.createdAt))
      .limit(limit),
    db
      .select({ value: count() })
      .from(notificationInbox)
      .where(
        and(
          eq(notificationInbox.recipientKey, recipient.key),
          eq(notificationInbox.organizationId, recipient.organizationId),
          isNull(notificationInbox.readAt),
        ),
      ),
  ]);
  return { notifications, unread: Number(unread ?? 0) };
}

export async function markNotificationRead(recipient: Recipient, id: string) {
  const [notification] = await db
    .update(notificationInbox)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationInbox.id, id),
        eq(notificationInbox.organizationId, recipient.organizationId),
        eq(notificationInbox.recipientKey, recipient.key),
      ),
    )
    .returning();
  return notification ?? null;
}

export async function markAllNotificationsRead(recipient: Recipient) {
  const result = await db
    .update(notificationInbox)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationInbox.organizationId, recipient.organizationId),
        eq(notificationInbox.recipientKey, recipient.key),
        isNull(notificationInbox.readAt),
      ),
    )
    .returning({ id: notificationInbox.id });
  return result.length;
}

function encryptionKey() {
  const configured = process.env.NOTIFICATION_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("Push subscription encryption is not configured.");
  if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  try {
    const decoded = Buffer.from(configured, "base64url");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to a stable SHA-256 key for passphrase-style configuration.
  }
  return createHash("sha256").update(configured).digest();
}

function encryptSubscription(subscription: PushSubscription) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(subscription), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptSubscription(value: string): PushSubscription {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted push subscription.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plain) as PushSubscription;
}

const endpointHash = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");

export async function savePushSubscription(
  recipient: Recipient,
  subscription: PushSubscription,
) {
  await ensureNotificationPreferences(recipient);
  const hash = endpointHash(subscription.endpoint);
  const [saved] = await db
    .insert(notificationPushSubscriptions)
    .values({
      organizationId: recipient.organizationId,
      recipientKey: recipient.key,
      endpointHash: hash,
      encryptedSubscription: encryptSubscription(subscription),
    })
    .onConflictDoUpdate({
      target: [
        notificationPushSubscriptions.organizationId,
        notificationPushSubscriptions.endpointHash,
      ],
      set: {
        recipientKey: recipient.key,
        encryptedSubscription: encryptSubscription(subscription),
        revokedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: notificationPushSubscriptions.id });
  return saved;
}

export async function revokePushSubscription(
  recipient: Recipient,
  endpoint: string,
) {
  const [revoked] = await db
    .update(notificationPushSubscriptions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(
          notificationPushSubscriptions.organizationId,
          recipient.organizationId,
        ),
        eq(notificationPushSubscriptions.recipientKey, recipient.key),
        eq(notificationPushSubscriptions.endpointHash, endpointHash(endpoint)),
      ),
    )
    .returning({ id: notificationPushSubscriptions.id });
  return Boolean(revoked);
}

function dateMetadata(value: unknown) {
  const parsed = parseNotificationDate(value);
  return parsed?.toISOString() ?? undefined;
}

async function loadCandidates(preference: PreferenceRecord, now: Date) {
  const candidates: NotificationCandidate[] = [];
  const enabled = new Set(preference.enabledEventTypes);
  const [stockRows, resourceRows, assignmentRows] = await Promise.all([
    enabled.has("low_stock")
      ? db
          .select({
            id: resources.id,
            name: resources.name,
            quantity: resources.quantity,
            minimumStock: stockSettings.minimumStock,
          })
          .from(stockSettings)
          .innerJoin(resources, eq(resources.id, stockSettings.resourceId))
          .where(
            and(
              gt(stockSettings.minimumStock, 0),
              eq(stockSettings.organizationId, preference.organizationId),
              eq(resources.organizationId, preference.organizationId),
              ne(resources.status, "archived"),
            ),
          )
      : Promise.resolve([]),
    enabled.has("expiry") || enabled.has("maintenance")
      ? db
          .select({
            id: resources.id,
            name: resources.name,
            status: resources.status,
            customFields: resources.customFields,
          })
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, preference.organizationId),
              ne(resources.status, "archived"),
            ),
          )
      : Promise.resolve([]),
    enabled.has("return_due")
      ? db
          .select({
            id: inventoryAssignments.id,
            resourceId: inventoryAssignments.resourceId,
            name: resources.name,
            dueAt: inventoryAssignments.dueAt,
            assignee: inventoryAssignments.assigneeLabel,
          })
          .from(inventoryAssignments)
          .innerJoin(resources, eq(resources.id, inventoryAssignments.resourceId))
          .where(
            and(
              eq(inventoryAssignments.status, "active"),
              eq(
                inventoryAssignments.organizationId,
                preference.organizationId,
              ),
              eq(resources.organizationId, preference.organizationId),
              sql`${inventoryAssignments.dueAt} is not null`,
            ),
          )
      : Promise.resolve([]),
  ]);

  for (const row of stockRows) {
    const threshold = Math.ceil(
      (row.minimumStock * preference.lowStockThresholdPercent) / 100,
    );
    if (row.quantity > threshold) continue;
    candidates.push({
      eventType: "low_stock",
      sourceKey: `resource:${row.id}`,
      resourceId: row.id,
      href: `/inventory/${row.id}/stock`,
      metadata: {
        name: row.name,
        quantity: row.quantity,
        minimumStock: row.minimumStock,
      },
    });
  }

  for (const row of resourceRows) {
    if (enabled.has("expiry")) {
      const value = row.customFields[preference.expiryFieldKey];
      if (fallsWithinWindow(value, now, preference.expiryWindowDays)) {
        candidates.push({
          eventType: "expiry",
          sourceKey: `resource:${row.id}:${preference.expiryFieldKey}`,
          resourceId: row.id,
          href: `/inventory/${row.id}`,
          metadata: {
            name: row.name,
            dueAt: dateMetadata(value),
            fieldKey: preference.expiryFieldKey,
          },
        });
      }
    }
    if (enabled.has("maintenance")) {
      const value = row.customFields[preference.maintenanceFieldKey];
      if (
        row.status === "maintenance" ||
        fallsWithinWindow(value, now, preference.maintenanceWindowDays)
      ) {
        candidates.push({
          eventType: "maintenance",
          sourceKey: `resource:${row.id}:${preference.maintenanceFieldKey}`,
          resourceId: row.id,
          href: `/inventory/${row.id}`,
          metadata: {
            name: row.name,
            dueAt: dateMetadata(value),
            fieldKey: preference.maintenanceFieldKey,
            status: row.status,
          },
        });
      }
    }
  }

  for (const row of assignmentRows) {
    if (!fallsWithinWindow(row.dueAt, now, preference.returnDueWindowDays)) continue;
    candidates.push({
      eventType: "return_due",
      sourceKey: `assignment:${row.id}`,
      resourceId: row.resourceId,
      assignmentId: row.id,
      href: `/inventory/${row.resourceId}`,
      metadata: {
        name: row.name,
        dueAt: row.dueAt?.toISOString(),
        assignee: row.assignee || undefined,
      },
    });
  }
  return candidates;
}

export async function detectNotifications(
  now = new Date(),
  organizationId?: string,
) {
  const preferences = await writableNotificationPreferences(organizationId);
  let created = 0;
  for (const preference of preferences) {
    const candidates = await loadCandidates(preference, now);
    if (!candidates.length) continue;
    const recentSince = new Date(
      now.getTime() - preference.cooldownHours * 60 * 60 * 1_000,
    );
    const recent = await db
      .select({
        eventType: notificationInbox.eventType,
        sourceKey: notificationInbox.sourceKey,
      })
      .from(notificationInbox)
      .where(
        and(
          eq(notificationInbox.recipientKey, preference.recipientKey),
          eq(notificationInbox.organizationId, preference.organizationId),
          gt(notificationInbox.createdAt, recentSince),
        ),
      );
    const recentKeys = new Set(
      recent.map((item) => `${item.eventType}:${item.sourceKey}`),
    );
    const values = candidates
      .filter(
        (candidate) =>
          !recentKeys.has(`${candidate.eventType}:${candidate.sourceKey}`),
      )
      .map((candidate) => {
        const message = notificationCopy(
          candidate.eventType,
          candidate.metadata,
          preference.locale,
        );
        return {
          organizationId: preference.organizationId,
          recipientKey: preference.recipientKey,
          eventType: candidate.eventType,
          resourceId: candidate.resourceId ?? null,
          assignmentId: candidate.assignmentId ?? null,
          sourceKey: candidate.sourceKey,
          dedupeBucket: cooldownBucket(now, preference.cooldownHours),
          title: message.title,
          body: message.body,
          href: candidate.href ?? null,
          metadata: candidate.metadata,
          createdAt: now,
        };
      });
    if (!values.length) continue;
    const inserted = await db
      .insert(notificationInbox)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: notificationInbox.id });
    created += inserted.length;
  }
  return { recipients: preferences.length, created };
}

function externalChannels(preference: PreferenceRecord) {
  return [
    ["email", preference.emailEnabled],
    ["push", preference.pushEnabled],
    ["slack", preference.slackEnabled],
    ["teams", preference.teamsEnabled],
    ["webhook", preference.webhookEnabled],
  ].flatMap(([channel, enabled]) =>
    enabled ? [channel as NotificationChannel] : [],
  );
}

function digestText(
  notifications: InboxRecord[],
  locale: NotificationLocale,
) {
  const heading =
    locale === "de"
      ? `${notifications.length} Inventar-Hinweise`
      : `${notifications.length} inventory notification${notifications.length === 1 ? "" : "s"}`;
  const bounded = boundedDigest(notifications);
  const visible = bounded.items;
  const remaining = bounded.remainingCount;
  return [
    heading,
    "",
    ...visible.map((item) => `• ${item.title}: ${item.body}`),
    ...(remaining > 0
      ? [
          locale === "de"
            ? `… und ${remaining} weitere im In-App-Postfach.`
            : `… and ${remaining} more in the in-app inbox.`,
        ]
      : []),
  ].join("\n");
}

function digestPayload(
  preference: PreferenceRecord,
  notifications: InboxRecord[],
  organizationReference: string,
) {
  const subject =
    preference.locale === "de"
      ? `Inventar-Tagesübersicht (${notifications.length})`
      : `Inventory daily digest (${notifications.length})`;
  const bounded = boundedDigest(notifications);
  const inboxPath = organizationPath(
    organizationReference,
    "/notifications",
  );
  return {
    subject,
    text: digestText(notifications, preference.locale),
    url: `${process.env.AUTH_URL?.replace(/\/$/, "") || ""}${inboxPath}`,
    events: bounded.items.map((item) => ({
      id: item.id,
      eventType: item.eventType,
      title: item.title,
      body: item.body,
      href: item.href
        ? organizationPath(organizationReference, item.href)
        : null,
      createdAt: item.createdAt.toISOString(),
    })),
    remainingCount: bounded.remainingCount,
  };
}

async function sendEmail(preference: PreferenceRecord, payload: ReturnType<typeof digestPayload>) {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.NOTIFICATION_EMAIL_FROM?.trim();
  if (!host || !from || !preference.recipientEmail) return { status: "skipped" as const };
  const port = Number(process.env.SMTP_PORT ?? "587");
  const transport = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: process.env.SMTP_SECURE?.trim().toLowerCase() === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  await transport.sendMail({
    from,
    to: preference.recipientEmail,
    subject: payload.subject,
    text: `${payload.text}\n\n${payload.url}`,
  });
  return { status: "sent" as const };
}

async function postJson(url: string | undefined, body: unknown, headers?: Record<string, string>) {
  if (!url?.trim()) return { status: "skipped" as const };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Notification endpoint returned HTTP ${response.status}.`);
  return { status: "sent" as const };
}

async function sendPush(preference: PreferenceRecord, payload: ReturnType<typeof digestPayload>) {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !process.env.NOTIFICATION_ENCRYPTION_KEY) {
    return { status: "skipped" as const };
  }
  const subscriptions = await db
    .select()
    .from(notificationPushSubscriptions)
    .where(
      and(
        eq(notificationPushSubscriptions.recipientKey, preference.recipientKey),
        eq(
          notificationPushSubscriptions.organizationId,
          preference.organizationId,
        ),
        isNull(notificationPushSubscriptions.revokedAt),
      ),
    );
  if (!subscriptions.length) return { status: "skipped" as const };
  webpush.setVapidDetails(subject, publicKey, privateKey);
  let delivered = 0;
  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        decryptSubscription(row.encryptedSubscription),
        JSON.stringify({
          title: payload.subject,
          body: payload.text.slice(0, 240),
          url: payload.url,
        }),
        { TTL: 3_600, urgency: "normal" },
      );
      delivered += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db
          .update(notificationPushSubscriptions)
          .set({ revokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(
                notificationPushSubscriptions.organizationId,
                preference.organizationId,
              ),
              eq(notificationPushSubscriptions.id, row.id),
            ),
          );
        continue;
      }
      throw error;
    }
  }
  return { status: delivered ? ("sent" as const) : ("skipped" as const) };
}

async function deliverChannel(
  channel: NotificationChannel,
  preference: PreferenceRecord,
  notifications: InboxRecord[],
  organizationReference: string,
) {
  const payload = digestPayload(
    preference,
    notifications,
    organizationReference,
  );
  if (channel === "email") return sendEmail(preference, payload);
  if (channel === "push") return sendPush(preference, payload);
  if (channel === "slack") {
    return postJson(process.env.NOTIFICATION_SLACK_WEBHOOK_URL, {
      text: `${payload.subject}\n${payload.text}\n${payload.url}`,
    });
  }
  if (channel === "teams") {
    return postJson(process.env.NOTIFICATION_TEAMS_WEBHOOK_URL, {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", weight: "Bolder", text: payload.subject },
              { type: "TextBlock", wrap: true, text: payload.text },
            ],
            actions: payload.url
              ? [{ type: "Action.OpenUrl", title: "Open inventory", url: payload.url }]
              : [],
          },
        },
      ],
    });
  }
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  const body = JSON.stringify({
    type: "inventory.notification.digest",
    recipient: preference.recipientKey,
    ...payload,
  });
  const secret = process.env.NOTIFICATION_WEBHOOK_SIGNING_SECRET?.trim();
  return postJson(
    webhookUrl,
    JSON.parse(body),
    secret
      ? { "X-Inventory-Signature": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }
      : undefined,
  );
}

function channelTarget(channel: NotificationChannel, preference: PreferenceRecord) {
  if (channel === "email") return redactTarget(preference.recipientEmail);
  if (channel === "push") return "encrypted browser subscriptions";
  if (channel === "slack") return redactTarget(process.env.NOTIFICATION_SLACK_WEBHOOK_URL);
  if (channel === "teams") return redactTarget(process.env.NOTIFICATION_TEAMS_WEBHOOK_URL);
  return redactTarget(process.env.NOTIFICATION_WEBHOOK_URL);
}

export async function dispatchDueDigests(
  now = new Date(),
  organizationId?: string,
) {
  const preferences = await writableNotificationPreferences(organizationId);
  let sent = 0;
  let failed = 0;
  for (const preference of preferences) {
    if (!digestIsDue(preference, now)) continue;
    const organization = await getOrganization(preference.organizationId);
    const organizationReference =
      organization?.slug ?? preference.organizationId;
    const since = preference.lastDigestAt ?? preference.createdAt;
    const notifications = await db
      .select()
      .from(notificationInbox)
      .where(
        and(
          eq(notificationInbox.recipientKey, preference.recipientKey),
          eq(notificationInbox.organizationId, preference.organizationId),
          gt(notificationInbox.createdAt, since),
        ),
      )
      .orderBy(notificationInbox.createdAt);
    const channels = externalChannels(preference);
    if (notifications.length) {
      for (const channel of channels) {
        const globalChannel = ["slack", "teams", "webhook"].includes(channel);
        const eventFingerprint = notifications
          .map((item) => `${item.eventType}:${item.sourceKey}`)
          .sort()
          .join("|");
        const dispatchWindow =
          preference.frequency === "daily"
            ? now.toISOString().slice(0, 10)
            : String(Math.floor(now.getTime() / 3_600_000));
        const dedupeKey = createHash("sha256")
          .update(
            globalChannel
              ? `${channel}:${preference.organizationId}:${dispatchWindow}`
              : `${channel}:${preference.organizationId}:${preference.recipientKey}:${dispatchWindow}:${eventFingerprint}`,
          )
          .digest("hex");
        const [reserved] = await db
          .insert(notificationDispatches)
          .values({
            organizationId: preference.organizationId,
            recipientKey: preference.recipientKey,
            channel,
            dedupeKey,
            status: "sending",
            eventCount: notifications.length,
            targetRedacted: channelTarget(channel, preference),
          })
          .onConflictDoNothing()
          .returning({ id: notificationDispatches.id });
        if (!reserved) continue;
        let status: "sent" | "skipped" | "failed" = "failed";
        let error: string | null = null;
        try {
          const result = await deliverChannel(
            channel,
            preference,
            notifications,
            organizationReference,
          );
          status = result.status;
          if (status === "sent") sent += 1;
        } catch (deliveryError) {
          error = safeError(deliveryError);
          failed += 1;
        }
        await db
          .update(notificationDispatches)
          .set({ status, error, completedAt: new Date() })
          .where(eq(notificationDispatches.id, reserved.id));
      }
    }
    if (preference.frequency === "daily" || notifications.length) {
      await db
        .update(notificationPreferences)
        .set({ lastDigestAt: now, updatedAt: now })
        .where(
          and(
            eq(
              notificationPreferences.organizationId,
              preference.organizationId,
            ),
            eq(notificationPreferences.recipientKey, preference.recipientKey),
          ),
        );
    }
  }
  return { recipients: preferences.length, sent, failed };
}

export async function runNotificationCycle(
  now = new Date(),
  organizationId?: string,
) {
  const detection = await detectNotifications(now, organizationId);
  const dispatch = await dispatchDueDigests(now, organizationId);
  return { detection, dispatch };
}

export function previewNotificationChannel(
  channel: NotificationChannel,
  locale: NotificationLocale,
  recipientEmail?: string | null,
) {
  const runtime = notificationRuntimeConfiguration();
  const target =
    channel === "email"
      ? recipientEmail ?? null
      : runtime[channel].target;
  return {
    configured: runtime[channel].configured,
    preview: channelPreview(channel, target, locale),
  };
}
