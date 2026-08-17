import "server-only";

import { lookup } from "node:dns/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  or,
  sql,
} from "drizzle-orm";

import {
  organizations,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
  type WebhookDeliveryRecord,
  type WebhookEndpointRecord,
  type StockMovementRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { organizationAllowsWorkerSideEffects } from "@/lib/organization-read-only";
import { decryptSecret, encryptSecret } from "@/lib/secret-encryption";
import {
  isPrivateWebhookAddress,
  isWebhookRetryableStatus,
  redactWebhookTarget,
  signWebhookPayload,
  validateWebhookTargetUrl,
  webhookRetryDelayMs,
  type WebhookEndpointCreate,
  type WebhookEndpointPatch,
  type WebhookEventEnvelope,
  type WebhookEventType,
} from "@/lib/webhook-contract";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Transaction;

const ENCRYPTION_VARIABLE = "WEBHOOK_ENCRYPTION_KEY";
const RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
const webhookRuntimeGlobal = globalThis as typeof globalThis & {
  inventoryWebhookLastRetentionCleanupAt?: number;
};

export class WebhookConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookConfigurationError";
  }
}

function allowPrivateNetworks() {
  return process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS?.trim().toLowerCase() === "true";
}

function endpointDto(endpoint: WebhookEndpointRecord) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    target: endpoint.redactedUrl,
    eventTypes: endpoint.eventTypes,
    enabled: endpoint.enabled,
    failureCount: endpoint.failureCount,
    lastSuccessAt: endpoint.lastSuccessAt,
    lastFailureAt: endpoint.lastFailureAt,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}

function deliveryDto(
  delivery: WebhookDeliveryRecord,
  event?: { id: string; type: WebhookEventType; occurredAt: Date },
) {
  return {
    id: delivery.id,
    status: delivery.status,
    attempts: delivery.attempts,
    nextAttemptAt: delivery.nextAttemptAt,
    httpStatus: delivery.httpStatus,
    error: delivery.error,
    deliveredAt: delivery.deliveredAt,
    createdAt: delivery.createdAt,
    ...(event ? { event } : {}),
  };
}

function assertEncryptionConfigured() {
  try {
    encryptSecret("configuration-check", ENCRYPTION_VARIABLE);
  } catch {
    throw new WebhookConfigurationError(
      "Webhook encryption is not configured correctly. Set WEBHOOK_ENCRYPTION_KEY to 32 random bytes encoded as base64url or 64 hexadecimal characters.",
    );
  }
}

function normalizedTarget(url: string) {
  return validateWebhookTargetUrl(url, {
    allowPrivateNetworks: allowPrivateNetworks(),
  });
}

export async function listWebhookEndpoints(organizationId: string) {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        isNull(webhookEndpoints.revokedAt),
      ),
    )
    .orderBy(asc(webhookEndpoints.name), asc(webhookEndpoints.createdAt));
  return rows.map(endpointDto);
}

export async function getWebhookEndpoint(organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.id, id),
        isNull(webhookEndpoints.revokedAt),
      ),
    )
    .limit(1);
  return row ? endpointDto(row) : null;
}

export async function createWebhookEndpoint(
  organizationId: string,
  input: WebhookEndpointCreate,
  actor: string,
) {
  assertEncryptionConfigured();
  const url = normalizedTarget(input.url);
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const [created] = await db
    .insert(webhookEndpoints)
    .values({
      organizationId,
      name: input.name,
      encryptedUrl: encryptSecret(url, ENCRYPTION_VARIABLE),
      redactedUrl: redactWebhookTarget(url),
      encryptedSecret: encryptSecret(secret, ENCRYPTION_VARIABLE),
      eventTypes: input.eventTypes,
      enabled: input.enabled,
      createdBy: actor,
      updatedBy: actor,
    })
    .returning();
  return { webhook: endpointDto(created), secret };
}

export async function updateWebhookEndpoint(
  organizationId: string,
  id: string,
  patch: WebhookEndpointPatch,
  actor: string,
) {
  if (patch.url) assertEncryptionConfigured();
  const url = patch.url ? normalizedTarget(patch.url) : null;
  return db.transaction(async (transaction) => {
    const now = new Date();
    const [updated] = await transaction
      .update(webhookEndpoints)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.eventTypes !== undefined ? { eventTypes: patch.eventTypes } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(url
          ? {
              encryptedUrl: encryptSecret(url, ENCRYPTION_VARIABLE),
              redactedUrl: redactWebhookTarget(url),
            }
          : {}),
        updatedBy: actor,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookEndpoints.organizationId, organizationId),
          eq(webhookEndpoints.id, id),
          isNull(webhookEndpoints.revokedAt),
        ),
      )
      .returning();
    if (!updated) return null;
    if (patch.enabled === false) {
      await transaction
        .update(webhookDeliveries)
        .set({
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          error: "Webhook endpoint was disabled.",
          updatedAt: now,
        })
        .where(
          and(
            eq(webhookDeliveries.webhookId, id),
            eq(webhookDeliveries.organizationId, organizationId),
            inArray(webhookDeliveries.status, ["pending", "processing"]),
          ),
        );
    }
    return endpointDto(updated);
  });
}

export async function revokeWebhookEndpoint(
  organizationId: string,
  id: string,
  actor: string,
) {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const [revoked] = await transaction
      .update(webhookEndpoints)
      .set({
        enabled: false,
        revokedAt: now,
        updatedAt: now,
        updatedBy: actor,
      })
      .where(
        and(
          eq(webhookEndpoints.organizationId, organizationId),
          eq(webhookEndpoints.id, id),
          isNull(webhookEndpoints.revokedAt),
        ),
      )
      .returning({ id: webhookEndpoints.id });
    if (!revoked) return false;
    await transaction
      .update(webhookDeliveries)
      .set({
        status: "failed",
        leaseToken: null,
        leaseExpiresAt: null,
        error: "Webhook endpoint was revoked.",
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.webhookId, id),
          eq(webhookDeliveries.organizationId, organizationId),
          inArray(webhookDeliveries.status, ["pending", "processing"]),
        ),
      );
    return true;
  });
}

export async function rotateWebhookSecret(
  organizationId: string,
  id: string,
  actor: string,
) {
  assertEncryptionConfigured();
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const [updated] = await db
    .update(webhookEndpoints)
    .set({
      encryptedSecret: encryptSecret(secret, ENCRYPTION_VARIABLE),
      updatedAt: new Date(),
      updatedBy: actor,
    })
    .where(
      and(
        eq(webhookEndpoints.organizationId, organizationId),
        eq(webhookEndpoints.id, id),
        isNull(webhookEndpoints.revokedAt),
      ),
    )
    .returning({ id: webhookEndpoints.id });
  return updated ? secret : null;
}

type WebhookEventInput = {
  organizationId: string;
  type: WebhookEventType;
  aggregateType?: string;
  aggregateId?: string;
  actor?: string | null;
  data: Record<string, unknown>;
  occurredAt?: Date;
};

async function insertInChunks<T>(
  values: T[],
  insert: (chunk: T[]) => Promise<unknown>,
) {
  for (let index = 0; index < values.length; index += 500) {
    await insert(values.slice(index, index + 500));
  }
}

export async function enqueueWebhookEvents(
  executor: Executor,
  inputs: WebhookEventInput[],
) {
  if (!inputs.length) return [];
  const organizationIds = [...new Set(inputs.map((input) => input.organizationId))];
  const endpoints = await executor
    .select({
      organizationId: webhookEndpoints.organizationId,
      id: webhookEndpoints.id,
      eventTypes: webhookEndpoints.eventTypes,
      encryptedSecret: webhookEndpoints.encryptedSecret,
    })
    .from(webhookEndpoints)
    .where(
      and(
        inArray(webhookEndpoints.organizationId, organizationIds),
        eq(webhookEndpoints.enabled, true),
        isNull(webhookEndpoints.revokedAt),
      ),
    );
  if (!endpoints.length) return [];
  const subscribedInputs = inputs.filter((input) =>
    endpoints.some((endpoint) =>
      endpoint.organizationId === input.organizationId &&
      (endpoint.eventTypes as readonly string[]).includes(input.type),
    ),
  );
  if (!subscribedInputs.length) return [];
  const prepared = subscribedInputs.map((input) => {
    const occurredAt = input.occurredAt ?? new Date();
    const envelope: WebhookEventEnvelope = {
      id: randomUUID(),
      type: input.type,
      apiVersion: "1",
      occurredAt: occurredAt.toISOString(),
      actor: input.actor ?? null,
      data: input.data,
    };
    return {
      envelope,
      occurredAt,
      event: {
        organizationId: input.organizationId,
        id: envelope.id,
        type: envelope.type,
        apiVersion: envelope.apiVersion,
        aggregateType: input.aggregateType ?? null,
        aggregateId: input.aggregateId ?? null,
        actor: envelope.actor,
        payload: input.data,
        body: JSON.stringify(envelope),
        occurredAt,
      },
    };
  });
  await insertInChunks(prepared.map(({ event }) => event), (chunk) =>
    executor.insert(webhookEvents).values(chunk),
  );
  const deliveries = prepared.flatMap(({ envelope, event }) =>
    endpoints
      .filter((endpoint) =>
        endpoint.organizationId === event.organizationId &&
        (endpoint.eventTypes as readonly string[]).includes(envelope.type),
      )
      .map((endpoint) => ({
        organizationId: endpoint.organizationId,
        webhookId: endpoint.id,
        eventId: envelope.id,
        encryptedSecret: endpoint.encryptedSecret,
        nextAttemptAt: new Date(),
      })),
  );
  await insertInChunks(deliveries, (chunk) =>
    executor.insert(webhookDeliveries).values(chunk),
  );
  return prepared.map(({ envelope }) => envelope);
}

export async function enqueueWebhookEvent(
  executor: Executor,
  input: WebhookEventInput,
) {
  const [envelope] = await enqueueWebhookEvents(executor, [input]);
  return envelope ?? null;
}

export async function enqueueStockMovementWebhookEvents(
  executor: Executor,
  movements: StockMovementRecord[],
) {
  return enqueueWebhookEvents(
    executor,
    movements.map((movement) => ({
      organizationId: movement.organizationId,
      type: "inventory.stock.movement.created" as const,
      aggregateType: "resource",
      aggregateId: movement.resourceId,
      actor: movement.createdBy,
      occurredAt: movement.occurredAt,
      data: { movement },
    })),
  );
}

export async function enqueueWebhookTest(
  organizationId: string,
  id: string,
  actor: string,
) {
  assertEncryptionConfigured();
  return db.transaction(async (transaction) => {
    const [endpoint] = await transaction
      .select({
        organizationId: webhookEndpoints.organizationId,
        id: webhookEndpoints.id,
        encryptedSecret: webhookEndpoints.encryptedSecret,
      })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, organizationId),
          eq(webhookEndpoints.id, id),
          isNull(webhookEndpoints.revokedAt),
        ),
      )
      .limit(1);
    if (!endpoint) return null;
    const occurredAt = new Date();
    const envelope: WebhookEventEnvelope = {
      id: randomUUID(),
      type: "inventory.webhook.test",
      apiVersion: "1",
      occurredAt: occurredAt.toISOString(),
      actor,
      data: { test: true, message: "Inventory webhook test" },
    };
    await transaction.insert(webhookEvents).values({
      organizationId,
      id: envelope.id,
      type: envelope.type,
      apiVersion: "1",
      aggregateType: "webhook_test",
      aggregateId: id,
      actor,
      payload: envelope.data,
      body: JSON.stringify(envelope),
      occurredAt,
    });
    const [delivery] = await transaction
      .insert(webhookDeliveries)
      .values({
        organizationId,
        webhookId: id,
        eventId: envelope.id,
        encryptedSecret: endpoint.encryptedSecret,
        nextAttemptAt: occurredAt,
      })
      .returning({ id: webhookDeliveries.id });
    return { eventId: envelope.id, deliveryId: delivery.id };
  });
}

export async function listWebhookDeliveries(
  organizationId: string,
  id: string,
  limit = 50,
) {
  const endpoint = await getWebhookEndpoint(organizationId, id);
  if (!endpoint) return null;
  const rows = await db
    .select({
      delivery: webhookDeliveries,
      event: {
        id: webhookEvents.id,
        type: webhookEvents.type,
        occurredAt: webhookEvents.occurredAt,
      },
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEvents,
      and(
        eq(webhookDeliveries.eventId, webhookEvents.id),
        eq(webhookDeliveries.organizationId, webhookEvents.organizationId),
      ),
    )
    .where(
      and(
        eq(webhookDeliveries.organizationId, organizationId),
        eq(webhookDeliveries.webhookId, id),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(Math.min(100, Math.max(1, limit)));
  return rows.map(({ delivery, event }) => deliveryDto(delivery, event));
}

export async function retryWebhookDelivery(
  organizationId: string,
  webhookId: string,
  deliveryId: string,
) {
  return db.transaction(async (transaction) => {
    const [endpoint] = await transaction
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, webhookId),
          eq(webhookEndpoints.organizationId, organizationId),
          eq(webhookEndpoints.enabled, true),
          isNull(webhookEndpoints.revokedAt),
        ),
      )
      .limit(1);
    if (!endpoint) return null;
    const now = new Date();
    const [delivery] = await transaction
      .update(webhookDeliveries)
      .set({
        status: "pending",
        nextAttemptAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.organizationId, organizationId),
          eq(webhookDeliveries.webhookId, webhookId),
          eq(webhookDeliveries.status, "failed"),
        ),
      )
      .returning();
    return delivery ? deliveryDto(delivery) : null;
  });
}

function deliveryTimeoutMs() {
  const value = Number(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? "10000");
  return Number.isSafeInteger(value) ? Math.min(60_000, Math.max(1_000, value)) : 10_000;
}

function maximumAttempts() {
  const value = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? "8");
  return Number.isSafeInteger(value) ? Math.min(20, Math.max(1, value)) : 8;
}

function retentionDays() {
  const value = Number(process.env.WEBHOOK_RETENTION_DAYS ?? "30");
  return Number.isSafeInteger(value) ? Math.min(365, Math.max(1, value)) : 30;
}

function leaseDurationMs() {
  return Math.max(30_000, deliveryTimeoutMs() + 10_000);
}

function workerConcurrency() {
  const value = Number(process.env.WEBHOOK_WORKER_CONCURRENCY ?? "4");
  return Number.isSafeInteger(value) ? Math.min(20, Math.max(1, value)) : 4;
}

function safeDeliveryError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted-url]")
    .slice(0, 2_000);
}

async function resolveWebhookTarget(url: string, signal?: AbortSignal) {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const lookupPromise = lookup(hostname, { all: true, verbatim: true });
  const addresses = signal
    ? await Promise.race([
        lookupPromise,
        new Promise<never>((_, reject) => {
          const abort = () => reject(signal.reason ?? new Error("Webhook DNS lookup timed out."));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }),
      ])
    : await lookupPromise;
  if (!addresses.length) throw new Error("Webhook target could not be resolved.");
  if (
    !allowPrivateNetworks() &&
    addresses.some(({ address }) => isPrivateWebhookAddress(address))
  ) {
    throw new Error("Webhook target resolves to a private network.");
  }
  return addresses;
}

async function sendWebhookRequest(options: {
  url: string;
  headers: Record<string, string>;
  body: string;
  addresses: Awaited<ReturnType<typeof resolveWebhookTarget>>;
  signal: AbortSignal;
}) {
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    const family = lookupOptions.family;
    const candidates =
      family === 4 || family === 6
        ? options.addresses.filter((address) => address.family === family)
        : options.addresses;
    if (!candidates.length) {
      const error = new Error("Webhook target has no address in the requested family.") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, []);
      return;
    }
    if (lookupOptions.all) {
      callback(null, candidates);
      return;
    }
    const [candidate] = candidates;
    callback(null, candidate!.address, candidate!.family);
  };

  return new Promise<number>((resolve, reject) => {
    const request = httpsRequest(
      options.url,
      {
        method: "POST",
        headers: options.headers,
        lookup: pinnedLookup,
        signal: options.signal,
      },
      (response) => {
        response.resume();
        const status = response.statusCode;
        if (!status) {
          reject(new Error("Webhook target returned no HTTP status."));
          return;
        }
        resolve(status);
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

type ClaimedDelivery = WebhookDeliveryRecord & {
  endpoint: WebhookEndpointRecord;
  event: typeof webhookEvents.$inferSelect;
};

type WebhookOrganizationIdColumn =
  | typeof webhookDeliveries.organizationId
  | typeof webhookEndpoints.organizationId
  | typeof webhookEvents.organizationId;

const writableWebhookOrganizationCondition = (
  organizationId: WebhookOrganizationIdColumn,
) => sql`exists (
  select 1 from ${organizations}
  where ${organizations.id} = ${organizationId}
    and ${organizations.isReadOnly} = false
)`;

async function webhookOrganizationAllowsWork(organizationId: string) {
  const [organization] = await db
    .select({ isReadOnly: organizations.isReadOnly })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return organizationAllowsWorkerSideEffects(organization?.isReadOnly);
}

async function lockWritableWebhookOrganization(
  transaction: Transaction,
  organizationId: string,
) {
  const [organization] = await transaction
    .select({ isReadOnly: organizations.isReadOnly })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
    .for("share");
  return organizationAllowsWorkerSideEffects(organization?.isReadOnly);
}

async function claimWebhookDelivery(): Promise<ClaimedDelivery | null> {
  return db.transaction(async (transaction) => {
    const now = new Date();
    await transaction
      .update(webhookDeliveries)
      .set({
        status: "failed",
        leaseToken: null,
        leaseExpiresAt: null,
        error: "Webhook delivery lease expired at the attempt limit.",
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.status, "processing"),
          isNotNull(webhookDeliveries.leaseExpiresAt),
          lte(webhookDeliveries.leaseExpiresAt, now),
          gte(webhookDeliveries.attempts, maximumAttempts()),
          writableWebhookOrganizationCondition(
            webhookDeliveries.organizationId,
          ),
        ),
      );
    const [candidate] = await transaction
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          writableWebhookOrganizationCondition(
            webhookDeliveries.organizationId,
          ),
          or(
            and(
              eq(webhookDeliveries.status, "pending"),
              lte(webhookDeliveries.nextAttemptAt, now),
            ),
            and(
              eq(webhookDeliveries.status, "processing"),
              isNotNull(webhookDeliveries.leaseExpiresAt),
              lte(webhookDeliveries.leaseExpiresAt, now),
              sql`${webhookDeliveries.attempts} < ${maximumAttempts()}`,
            ),
          ),
        ),
      )
      .orderBy(asc(webhookDeliveries.nextAttemptAt), asc(webhookDeliveries.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const leaseToken = randomUUID();
    const [claimed] = await transaction
      .update(webhookDeliveries)
      .set({
        status: "processing",
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs()),
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.organizationId, candidate.organizationId),
          eq(webhookDeliveries.id, candidate.id),
          writableWebhookOrganizationCondition(
            webhookDeliveries.organizationId,
          ),
        ),
      )
      .returning();
    if (!claimed) return null;
    const [joined] = await transaction
      .select({ endpoint: webhookEndpoints, event: webhookEvents })
      .from(webhookEndpoints)
      .innerJoin(
        webhookEvents,
        and(
          eq(webhookEvents.organizationId, claimed.organizationId),
          eq(webhookEvents.id, claimed.eventId),
        ),
      )
      .where(
        and(
          eq(webhookEndpoints.organizationId, claimed.organizationId),
          eq(webhookEndpoints.id, claimed.webhookId),
        ),
      )
      .limit(1);
    if (!joined) return null;
    return { ...claimed, ...joined };
  });
}

async function markDeliverySuccess(delivery: ClaimedDelivery, status: number) {
  const now = new Date();
  await db.transaction(async (transaction) => {
    if (
      !(await lockWritableWebhookOrganization(
        transaction,
        delivery.organizationId,
      ))
    ) {
      return;
    }
    const [updated] = await transaction
      .update(webhookDeliveries)
      .set({
        status: "succeeded",
        httpStatus: status,
        deliveredAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.organizationId, delivery.organizationId),
          eq(webhookDeliveries.id, delivery.id),
          eq(webhookDeliveries.leaseToken, delivery.leaseToken!),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    if (updated) {
      await transaction
        .update(webhookEndpoints)
        .set({ failureCount: 0, lastSuccessAt: now, updatedAt: now })
        .where(
          and(
            eq(webhookEndpoints.organizationId, delivery.organizationId),
            eq(webhookEndpoints.id, delivery.webhookId),
          ),
        );
    }
  });
}

async function markDeliveryFailure(
  delivery: ClaimedDelivery,
  error: unknown,
  options: { status?: number; retryable?: boolean } = {},
) {
  const now = new Date();
  const retryable = options.retryable ?? true;
  const terminal = !retryable || delivery.attempts >= maximumAttempts();
  await db.transaction(async (transaction) => {
    if (
      !(await lockWritableWebhookOrganization(
        transaction,
        delivery.organizationId,
      ))
    ) {
      return;
    }
    const [updated] = await transaction
      .update(webhookDeliveries)
      .set({
        status: terminal ? "failed" : "pending",
        nextAttemptAt: new Date(now.getTime() + webhookRetryDelayMs(delivery.attempts)),
        leaseToken: null,
        leaseExpiresAt: null,
        httpStatus: options.status ?? null,
        error: safeDeliveryError(error),
        updatedAt: now,
      })
      .where(
        and(
          eq(webhookDeliveries.organizationId, delivery.organizationId),
          eq(webhookDeliveries.id, delivery.id),
          eq(webhookDeliveries.leaseToken, delivery.leaseToken!),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    if (updated) {
      await transaction
        .update(webhookEndpoints)
        .set({
          failureCount: sql`${webhookEndpoints.failureCount} + 1`,
          lastFailureAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(webhookEndpoints.organizationId, delivery.organizationId),
            eq(webhookEndpoints.id, delivery.webhookId),
          ),
        );
    }
  });
}

async function deliverWebhook(delivery: ClaimedDelivery) {
  if (!(await webhookOrganizationAllowsWork(delivery.organizationId))) {
    return "read-only";
  }
  if (
    delivery.endpoint.revokedAt ||
    (!delivery.endpoint.enabled && delivery.event.type !== "inventory.webhook.test")
  ) {
    await markDeliveryFailure(delivery, "Webhook endpoint is disabled.", {
      retryable: false,
    });
    return "failed";
  }
  try {
    const url = decryptSecret(delivery.endpoint.encryptedUrl, ENCRYPTION_VARIABLE);
    validateWebhookTargetUrl(url, { allowPrivateNetworks: allowPrivateNetworks() });
    const signal = AbortSignal.timeout(deliveryTimeoutMs());
    const addresses = await resolveWebhookTarget(url, signal);
    const secret = decryptSecret(delivery.encryptedSecret, ENCRYPTION_VARIABLE);
    const timestamp = Math.floor(Date.now() / 1_000);
    if (!(await webhookOrganizationAllowsWork(delivery.organizationId))) {
      return "read-only";
    }
    const status = await sendWebhookRequest({
      url,
      addresses,
      signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Open-Inventory-Webhooks/1.0",
        "X-Inventory-Event-Id": delivery.event.id,
        "X-Inventory-Event-Type": delivery.event.type,
        "X-Inventory-Delivery-Id": delivery.id,
        "X-Inventory-Timestamp": String(timestamp),
        "X-Inventory-Signature": signWebhookPayload(
          delivery.event.body,
          secret,
          timestamp,
        ),
      },
      body: delivery.event.body,
    });
    if (status >= 200 && status < 300) {
      await markDeliverySuccess(delivery, status);
      return "succeeded";
    }
    if (status < 100 || status > 599) {
      await markDeliveryFailure(
        delivery,
        `Webhook target returned invalid HTTP status ${status}.`,
        { retryable: false },
      );
      return "failed";
    }
    await markDeliveryFailure(
      delivery,
      `Webhook target returned HTTP ${status}.`,
      { status, retryable: isWebhookRetryableStatus(status) },
    );
    return "failed";
  } catch (error) {
    await markDeliveryFailure(delivery, error);
    return "failed";
  }
}

export async function drainWebhookDeliveries(limit = 1) {
  const results: string[] = [];
  const boundedLimit = Math.min(100, Math.max(1, limit));
  while (results.length < boundedLimit) {
    const batchSize = Math.min(
      workerConcurrency(),
      boundedLimit - results.length,
    );
    const claimed = (
      await Promise.all(
        Array.from({ length: batchSize }, () => claimWebhookDelivery()),
      )
    ).filter((delivery): delivery is ClaimedDelivery => delivery !== null);
    if (!claimed.length) break;
    results.push(...(await Promise.all(claimed.map(deliverWebhook))));
    if (claimed.length < batchSize) break;
  }
  const cleanupStartedAt = Date.now();
  if (
    cleanupStartedAt -
      (webhookRuntimeGlobal.inventoryWebhookLastRetentionCleanupAt ?? 0) >=
    RETENTION_CLEANUP_INTERVAL_MS
  ) {
    webhookRuntimeGlobal.inventoryWebhookLastRetentionCleanupAt = cleanupStartedAt;
    const retentionCutoff = new Date(
      cleanupStartedAt - retentionDays() * 24 * 60 * 60 * 1_000,
    );
    await db.delete(webhookEvents).where(
      and(
        lt(webhookEvents.createdAt, retentionCutoff),
        writableWebhookOrganizationCondition(webhookEvents.organizationId),
        sql`not exists (
          select 1 from ${webhookDeliveries}
          where ${webhookDeliveries.eventId} = ${webhookEvents.id}
            and ${webhookDeliveries.organizationId} = ${webhookEvents.organizationId}
            and ${webhookDeliveries.status} in ('pending', 'processing')
        )`,
      ),
    );
    await db.delete(webhookEndpoints).where(
      and(
        isNotNull(webhookEndpoints.revokedAt),
        lt(webhookEndpoints.revokedAt, retentionCutoff),
        writableWebhookOrganizationCondition(webhookEndpoints.organizationId),
        sql`not exists (
          select 1 from ${webhookDeliveries}
          where ${webhookDeliveries.webhookId} = ${webhookEndpoints.id}
            and ${webhookDeliveries.organizationId} = ${webhookEndpoints.organizationId}
        )`,
      ),
    );
  }
  return { processed: results.length, results };
}
