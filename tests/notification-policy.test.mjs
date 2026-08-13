import assert from "node:assert/strict";
import test from "node:test";

import {
  notificationPreferencePatchSchema,
  notificationTestSchema,
  pickNotificationPreferencePatch,
} from "../lib/notification-contract.ts";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  boundedDigest,
  channelPreview,
  cooldownBucket,
  digestIsDue,
  fallsWithinWindow,
  redactTarget,
} from "../lib/notification-policy.ts";

test("defaults keep the inbox useful and all external channels quiet", () => {
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.frequency, "daily");
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.cooldownHours, 24);
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFERENCES.enabledEventTypes, [
    "low_stock",
    "expiry",
    "maintenance",
    "return_due",
  ]);
  for (const key of [
    "emailEnabled",
    "pushEnabled",
    "slackEnabled",
    "teamsEnabled",
    "webhookEnabled",
  ]) {
    assert.equal(DEFAULT_NOTIFICATION_PREFERENCES[key], false);
  }
});

test("daily digests respect local hour and only become due once per local day", () => {
  const before = new Date("2026-08-13T05:59:00.000Z");
  const after = new Date("2026-08-13T06:01:00.000Z");
  const schedule = {
    frequency: "daily",
    digestHour: 8,
    timezone: "Europe/Berlin",
    lastDigestAt: null,
  };
  assert.equal(digestIsDue(schedule, before), false);
  assert.equal(digestIsDue(schedule, after), true);
  assert.equal(
    digestIsDue(
      { ...schedule, lastDigestAt: new Date("2026-08-13T06:00:00.000Z") },
      after,
    ),
    false,
  );
  assert.equal(digestIsDue({ ...schedule, frequency: "immediate" }, before), true);
});

test("cooldown buckets and due windows are deterministic", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");
  assert.equal(cooldownBucket(now, 24), cooldownBucket(new Date("2026-08-13T12:30:00.000Z"), 24));
  assert.equal(fallsWithinWindow("2026-08-16T12:00:00.000Z", now, 3), true);
  assert.equal(fallsWithinWindow("2026-08-16T12:00:01.000Z", now, 3), false);
  assert.equal(fallsWithinWindow("not-a-date", now, 30), false);
});

test("external targets are redacted and preview tests are dry runs", () => {
  assert.equal(redactTarget("owner@example.com"), "o***@example.com");
  const redacted = redactTarget("https://hooks.example.test/services/secret-token-123456");
  assert.equal(redacted.includes("secret-token"), false);
  const preview = channelPreview("slack", "https://hooks.example.test/secret", "en");
  assert.equal(preview.dryRun, true);
  assert.equal(preview.channel, "slack");
  assert.equal(preview.events.length, 1);
});

test("external digests expose at most twenty event details", () => {
  const input = Array.from({ length: 125 }, (_, index) => index);
  const result = boundedDigest(input);
  assert.equal(result.items.length, 20);
  assert.equal(result.remainingCount, 105);
});

test("preference and test payloads reject unknown or unsafe values", () => {
  assert.equal(
    notificationPreferencePatchSchema.safeParse({
      frequency: "daily",
      digestHour: 8,
      cooldownHours: 24,
      emailEnabled: true,
    }).success,
    true,
  );
  assert.equal(
    notificationPreferencePatchSchema.safeParse({ cooldownHours: 0 }).success,
    false,
  );
  assert.equal(
    notificationPreferencePatchSchema.safeParse({ expiryFieldKey: "Expiry Date" }).success,
    false,
  );
  assert.equal(
    notificationPreferencePatchSchema.safeParse({ maintenanceFieldKey: "maintenance_due" }).success,
    true,
  );
  assert.equal(
    notificationPreferencePatchSchema.safeParse({ webhookUrl: "https://secret.example" }).success,
    false,
  );
  assert.equal(notificationTestSchema.safeParse({ channel: "teams" }).success, true);
  assert.equal(
    notificationTestSchema.safeParse({ channel: "teams", send: true }).success,
    false,
  );
});

test("editable preference payloads omit database and identity fields", () => {
  assert.deepEqual(
    pickNotificationPreferencePatch({
      recipientKey: "person@example.test",
      recipientEmail: "person@example.test",
      recipientName: "Person",
      createdAt: "2026-08-13T08:00:00.000Z",
      updatedAt: "2026-08-13T08:00:00.000Z",
      lastDigestAt: null,
      frequency: "daily",
      digestHour: 8,
      emailEnabled: false,
    }),
    { frequency: "daily", digestHour: 8, emailEnabled: false },
  );
});
