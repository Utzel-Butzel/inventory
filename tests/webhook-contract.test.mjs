import assert from "node:assert/strict";
import test from "node:test";

import {
  WEBHOOK_EVENT_TYPES,
  isWebhookRetryableStatus,
  redactWebhookTarget,
  signWebhookPayload,
  validateWebhookTargetUrl,
  webhookEndpointCreateSchema,
  webhookEndpointPatchSchema,
  webhookRetryDelayMs,
} from "../lib/webhook-contract.ts";

const expectedEventTypes = [
  "inventory.resource.created",
  "inventory.resource.updated",
  "inventory.resource.deleted",
  "inventory.resource.merged",
  "inventory.stock.movement.created",
];

test("the webhook event allowlist is explicit and stable", () => {
  assert.deepEqual([...WEBHOOK_EVENT_TYPES], expectedEventTypes);
  assert.equal(new Set(WEBHOOK_EVENT_TYPES).size, WEBHOOK_EVENT_TYPES.length);
});

test("endpoint create and patch payloads accept supported fields", () => {
  const createResult = webhookEndpointCreateSchema.safeParse({
    name: "ERP inventory mirror",
    url: "https://hooks.example.com/inventory",
    eventTypes: [
      "inventory.resource.created",
      "inventory.stock.movement.created",
    ],
    enabled: true,
  });
  assert.equal(createResult.success, true);

  assert.equal(
    webhookEndpointCreateSchema.safeParse({
      name: "Audit sink",
      url: "https://audit.example.com/webhook",
      eventTypes: ["inventory.resource.deleted"],
    }).success,
    true,
    "enabled is optional when an endpoint is created",
  );

  assert.equal(
    webhookEndpointPatchSchema.safeParse({
      eventTypes: ["inventory.resource.merged"],
      enabled: false,
    }).success,
    true,
  );
});

test("endpoint schemas reject empty or unsupported subscriptions", () => {
  const base = {
    name: "ERP inventory mirror",
    url: "https://hooks.example.com/inventory",
    eventTypes: ["inventory.resource.created"],
  };

  assert.equal(
    webhookEndpointCreateSchema.safeParse({ ...base, name: "   " }).success,
    false,
  );
  assert.equal(
    webhookEndpointCreateSchema.safeParse({ ...base, eventTypes: [] }).success,
    false,
  );
  assert.equal(
    webhookEndpointCreateSchema.safeParse({
      ...base,
      eventTypes: ["inventory.resource.published"],
    }).success,
    false,
  );
  const duplicateResult = webhookEndpointCreateSchema.safeParse({
    ...base,
    eventTypes: [
      "inventory.resource.created",
      "inventory.resource.created",
    ],
  });
  assert.equal(duplicateResult.success, false);
  assert.equal(
    webhookEndpointPatchSchema.safeParse({}).success,
    false,
    "an empty patch cannot change an endpoint",
  );
});

test("target validation accepts and normalizes public HTTPS URLs", () => {
  assert.equal(
    validateWebhookTargetUrl("HTTPS://Hooks.Example.COM:443/events"),
    "https://hooks.example.com/events",
  );
  assert.equal(
    validateWebhookTargetUrl("https://hooks.example.com:8443/events?source=inventory"),
    "https://hooks.example.com:8443/events?source=inventory",
  );
});

test("target validation rejects non-HTTPS URLs and embedded credentials", () => {
  for (const value of [
    "http://hooks.example.com/events",
    "ftp://hooks.example.com/events",
    "not a URL",
    "https://user:password@hooks.example.com/events",
  ]) {
    assert.throws(() => validateWebhookTargetUrl(value), undefined, value);
  }
});

test("target validation blocks local and private literal destinations", () => {
  const unsafeTargets = [
    "https://localhost/webhook",
    "https://api.localhost/webhook",
    "https://0.0.0.0/webhook",
    "https://127.0.0.1/webhook",
    "https://127.1/webhook",
    "https://2130706433/webhook",
    "https://10.0.0.8/webhook",
    "https://172.16.0.8/webhook",
    "https://192.168.0.8/webhook",
    "https://198.18.0.8/webhook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/webhook",
    "https://[fc00::1]/webhook",
    "https://[fe80::1]/webhook",
    "https://[fec0::1]/webhook",
    "https://[::ffff:127.0.0.1]/webhook",
  ];

  for (const value of unsafeTargets) {
    assert.throws(() => validateWebhookTargetUrl(value), undefined, value);
  }
});

test("private targets require an explicit opt-in", () => {
  assert.equal(
    validateWebhookTargetUrl("https://192.168.10.42/webhook", {
      allowPrivateNetworks: true,
    }),
    "https://192.168.10.42/webhook",
  );
  assert.throws(() =>
    validateWebhookTargetUrl("http://192.168.10.42/webhook", {
      allowPrivateNetworks: true,
    }),
  );
});

test("target redaction keeps routing context but removes secrets", () => {
  const redacted = redactWebhookTarget(
    "https://hooks.example.com/services/team-secret/token-secret?api_key=query-secret#fragment-secret",
  );

  assert.match(redacted, /hooks\.example\.com/);
  for (const secret of [
    "team-secret",
    "token-secret",
    "api_key",
    "query-secret",
    "fragment-secret",
  ]) {
    assert.equal(redacted.includes(secret), false);
  }

  const malformed = "not-a-url-with-a-secret";
  assert.equal(redactWebhookTarget(malformed).includes(malformed), false);
});

test("payload signatures are deterministic HMAC-SHA256 headers", () => {
  const payload = '{"id":"evt_123","type":"inventory.resource.updated"}';
  const secret = "whsec_test_secret";
  const timestamp = 1_786_608_000;
  const expected =
    "t=1786608000,v1=0bc4e2ab28f921624984165aff66d6a695ab2804ad35a9e452b3c20f407f381f";

  assert.equal(signWebhookPayload(payload, secret, timestamp), expected);
  assert.equal(signWebhookPayload(payload, secret, timestamp), expected);
  assert.notEqual(
    signWebhookPayload(`${payload}\n`, secret, timestamp),
    expected,
    "the signature covers the exact bytes sent",
  );
  assert.notEqual(signWebhookPayload(payload, secret, timestamp + 1), expected);
});

test("retry status classification separates transient and permanent failures", () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504, 599]) {
    assert.equal(isWebhookRetryableStatus(status), true, String(status));
  }
  for (const status of [200, 201, 204, 301, 400, 401, 403, 404, 409, 422, 600, 700]) {
    assert.equal(isWebhookRetryableStatus(status), false, String(status));
  }
});

test("retry delays follow the delivery schedule and remain capped", () => {
  const expectedDelays = [
    60_000,
    5 * 60_000,
    30 * 60_000,
    2 * 60 * 60_000,
    12 * 60 * 60_000,
    24 * 60 * 60_000,
  ];

  assert.deepEqual(
    expectedDelays.map((_, index) => webhookRetryDelayMs(index + 1)),
    expectedDelays,
  );
  assert.equal(webhookRetryDelayMs(7), 24 * 60 * 60_000);
  assert.equal(webhookRetryDelayMs(100), 24 * 60 * 60_000);
});
