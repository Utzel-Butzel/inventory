import "server-only";

import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import { and, eq } from "drizzle-orm";

import {
  wooCommerceConnections,
  wooCommerceOrderSyncs,
  wooCommerceWebhookDeliveries,
  type WooCommerceConnectionRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secret-encryption";
import { isPrivateWebhookAddress } from "@/lib/webhook-contract";
import {
  normalizeWooCommerceStoreUrl,
  redactWooCommerceConsumerKey,
  wooCommerceApiUrl,
  type WooCommerceConnectionInput,
} from "@/lib/woocommerce-contract";

const ENCRYPTION_VARIABLE = "INTEGRATION_ENCRYPTION_KEY";
const CONNECTION_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export class WooCommerceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WooCommerceConfigurationError";
  }
}

export class WooCommerceConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WooCommerceConnectionError";
  }
}

function allowPrivateNetworks() {
  return (
    process.env.INTEGRATION_ALLOW_PRIVATE_NETWORKS?.trim().toLowerCase() ===
    "true"
  );
}

function assertEncryptionConfigured() {
  try {
    encryptSecret("configuration-check", ENCRYPTION_VARIABLE);
  } catch {
    throw new WooCommerceConfigurationError(
      "Integration encryption is not configured correctly. Set INTEGRATION_ENCRYPTION_KEY to 32 random bytes encoded as base64url or 64 hexadecimal characters.",
    );
  }
}

export function isWooCommerceEncryptionConfigured() {
  try {
    assertEncryptionConfigured();
    return true;
  } catch {
    return false;
  }
}

function connectionDto(connection: WooCommerceConnectionRecord) {
  return {
    id: connection.id,
    storeUrl: connection.storeUrl,
    consumerKeyHint: connection.consumerKeyHint,
    status: connection.status,
    syncEnabled: connection.syncEnabled,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null,
    lastSuccessAt: connection.lastSuccessAt?.toISOString() ?? null,
    lastError: connection.lastError,
    lastWebhookAt: connection.lastWebhookAt?.toISOString() ?? null,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
    lastSyncError: connection.lastSyncError,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

async function resolveWooCommerceTarget(url: string, signal: AbortSignal) {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  const lookupPromise = lookup(hostname, { all: true, verbatim: true });
  const addresses = await Promise.race([
    lookupPromise,
    new Promise<never>((_, reject) => {
      const abort = () =>
        reject(
          signal.reason ?? new Error("WooCommerce DNS lookup timed out."),
        );
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }),
  ]);
  if (!addresses.length) {
    throw new WooCommerceConnectionError(
      "The WooCommerce store could not be resolved.",
    );
  }
  if (
    !allowPrivateNetworks() &&
    addresses.some(({ address }) => isPrivateWebhookAddress(address))
  ) {
    throw new WooCommerceConnectionError(
      "The WooCommerce store resolves to a private network.",
    );
  }
  return addresses;
}

type WooCommerceHttpMethod = "GET" | "POST" | "DELETE";

async function wooCommerceRequest(options: {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  method?: WooCommerceHttpMethod;
  body?: string;
}) {
  const signal = AbortSignal.timeout(CONNECTION_TIMEOUT_MS);
  const addresses = await resolveWooCommerceTarget(options.url, signal);
  const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    const family = lookupOptions.family;
    const candidates =
      family === 4 || family === 6
        ? addresses.filter((address) => address.family === family)
        : addresses;
    if (!candidates.length) {
      const error = new Error(
        "WooCommerce has no address in the requested network family.",
      ) as NodeJS.ErrnoException;
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

  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
  }>((resolve, reject) => {
    const request = httpsRequest(
      options.url,
      {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${Buffer.from(
            `${options.consumerKey}:${options.consumerSecret}`,
          ).toString("base64")}`,
          ...(options.body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(options.body),
              }
            : {}),
          "User-Agent": "Open-Inventory-WooCommerce/1.0",
        },
        lookup: pinnedLookup,
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            request.destroy(
              new WooCommerceConnectionError(
                "WooCommerce returned an unexpectedly large response.",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const status = response.statusCode;
          if (!status) {
            reject(
              new WooCommerceConnectionError(
                "WooCommerce returned no HTTP status.",
              ),
            );
            return;
          }
          resolve({
            status,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
          });
        });
      },
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function remoteErrorMessage(status: number, body: string) {
  let remoteMessage = "";
  try {
    const payload = JSON.parse(body) as { message?: unknown };
    if (typeof payload.message === "string") {
      remoteMessage = payload.message.trim().slice(0, 500);
    }
  } catch {
    // HTML proxy and hosting error pages are deliberately not reflected.
  }
  if (status === 401 || status === 403) {
    return "WooCommerce rejected the Consumer Key or Consumer Secret. Check the key, its user, and its permissions.";
  }
  if (status === 404) {
    return "WooCommerce REST API v3 was not found. Check the store URL and WordPress permalink settings.";
  }
  return remoteMessage
    ? `WooCommerce returned HTTP ${status}: ${remoteMessage}`
    : `WooCommerce returned HTTP ${status}.`;
}

export type WooCommerceCredentialMaterial = {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export function decryptWooCommerceCredentials(
  connection: Pick<
    WooCommerceConnectionRecord,
    "storeUrl" | "encryptedConsumerKey" | "encryptedConsumerSecret"
  >,
): WooCommerceCredentialMaterial {
  assertEncryptionConfigured();
  return {
    storeUrl: connection.storeUrl,
    consumerKey: decryptSecret(
      connection.encryptedConsumerKey,
      ENCRYPTION_VARIABLE,
    ),
    consumerSecret: decryptSecret(
      connection.encryptedConsumerSecret,
      ENCRYPTION_VARIABLE,
    ),
  };
}

export async function requestWooCommerceApi<T>(options: {
  credentials: WooCommerceCredentialMaterial;
  path: string;
  method?: WooCommerceHttpMethod;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}) {
  const storeUrl = normalizeWooCommerceStoreUrl(options.credentials.storeUrl, {
    allowPrivateNetworks: allowPrivateNetworks(),
  });
  const endpoint = new URL(wooCommerceApiUrl(storeUrl, options.path));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) endpoint.searchParams.set(key, String(value));
  }
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);

  let response: Awaited<ReturnType<typeof wooCommerceRequest>>;
  try {
    response = await wooCommerceRequest({
      url: endpoint.toString(),
      consumerKey: options.credentials.consumerKey,
      consumerSecret: options.credentials.consumerSecret,
      method: options.method,
      body,
    });
  } catch (error) {
    if (error instanceof WooCommerceConnectionError) throw error;
    throw new WooCommerceConnectionError(
      error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
        ? "The WooCommerce connection timed out."
        : "The WooCommerce store could not be reached over HTTPS.",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new WooCommerceConnectionError(
      remoteErrorMessage(response.status, response.body),
    );
  }
  if (!response.body.trim()) {
    return {
      payload: null as T,
      headers: response.headers,
      status: response.status,
      storeUrl,
    };
  }
  try {
    return {
      payload: JSON.parse(response.body) as T,
      headers: response.headers,
      status: response.status,
      storeUrl,
    };
  } catch {
    throw new WooCommerceConnectionError(
      "WooCommerce did not return a valid JSON response.",
    );
  }
}

export async function testWooCommerceCredentials(
  input: WooCommerceConnectionInput,
) {
  const response = await requestWooCommerceApi<unknown>({
    credentials: input,
    path: "products",
    query: { per_page: 1, _fields: "id" },
  });
  const payload = response.payload;
  if (!Array.isArray(payload)) {
    throw new WooCommerceConnectionError(
      "The endpoint did not return a WooCommerce product response.",
    );
  }
  const countHeader = response.headers["x-wp-total"];
  const productCount = Number(Array.isArray(countHeader) ? countHeader[0] : countHeader);
  return {
    storeUrl: response.storeUrl,
    productCount: Number.isSafeInteger(productCount) && productCount >= 0
      ? productCount
      : null,
    checkedAt: new Date(),
  };
}

export async function getWooCommerceConnection(organizationId: string) {
  const [connection] = await db
    .select()
    .from(wooCommerceConnections)
    .where(eq(wooCommerceConnections.organizationId, organizationId))
    .limit(1);
  return connection ? connectionDto(connection) : null;
}

export async function connectWooCommerce(
  organizationId: string,
  input: WooCommerceConnectionInput,
  actor: string,
) {
  assertEncryptionConfigured();
  const test = await testWooCommerceCredentials(input);
  const [previous] = await db
    .select()
    .from(wooCommerceConnections)
    .where(eq(wooCommerceConnections.organizationId, organizationId))
    .limit(1);
  if (previous?.syncEnabled) {
    try {
      const previousCredentials = decryptWooCommerceCredentials(previous);
      await Promise.allSettled(
        [previous.orderCreatedWebhookId, previous.orderUpdatedWebhookId]
          .filter((id): id is number => id !== null)
          .map((id) =>
            requestWooCommerceApi<unknown>({
              credentials: previousCredentials,
              path: `webhooks/${id}`,
              method: "DELETE",
              query: { force: true },
            }),
          ),
      );
    } catch {
      // Replacing the local secret revokes any stale remote hook immediately.
    }
  }
  const encryptedConsumerKey = encryptSecret(
    input.consumerKey,
    ENCRYPTION_VARIABLE,
  );
  const encryptedConsumerSecret = encryptSecret(
    input.consumerSecret,
    ENCRYPTION_VARIABLE,
  );
  const saved = await db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: wooCommerceConnections.id })
      .from(wooCommerceConnections)
      .where(eq(wooCommerceConnections.organizationId, organizationId))
      .limit(1)
      .for("update");
    if (existing) {
      await transaction
        .delete(wooCommerceWebhookDeliveries)
        .where(
          and(
            eq(wooCommerceWebhookDeliveries.organizationId, organizationId),
            eq(wooCommerceWebhookDeliveries.connectionId, existing.id),
          ),
        );
      await transaction
        .delete(wooCommerceOrderSyncs)
        .where(
          and(
            eq(wooCommerceOrderSyncs.organizationId, organizationId),
            eq(wooCommerceOrderSyncs.connectionId, existing.id),
          ),
        );
    }
    const [connection] = await transaction
      .insert(wooCommerceConnections)
      .values({
        organizationId,
        storeUrl: test.storeUrl,
        consumerKeyHint: redactWooCommerceConsumerKey(input.consumerKey),
        encryptedConsumerKey,
        encryptedConsumerSecret,
        syncEnabled: false,
        encryptedWebhookSecret: null,
        orderCreatedWebhookId: null,
        orderUpdatedWebhookId: null,
        status: "connected",
        lastCheckedAt: test.checkedAt,
        lastSuccessAt: test.checkedAt,
        lastError: null,
        createdBy: actor,
        updatedBy: actor,
      })
      .onConflictDoUpdate({
        target: wooCommerceConnections.organizationId,
        set: {
          storeUrl: test.storeUrl,
          consumerKeyHint: redactWooCommerceConsumerKey(input.consumerKey),
          encryptedConsumerKey,
          encryptedConsumerSecret,
          syncEnabled: false,
          encryptedWebhookSecret: null,
          orderCreatedWebhookId: null,
          orderUpdatedWebhookId: null,
          lastWebhookAt: null,
          lastSyncAt: null,
          lastSyncError: null,
          status: "connected",
          lastCheckedAt: test.checkedAt,
          lastSuccessAt: test.checkedAt,
          lastError: null,
          updatedBy: actor,
          updatedAt: test.checkedAt,
        },
      })
      .returning();
    return connection;
  });
  return {
    connection: connectionDto(saved),
    test: {
      productCount: test.productCount,
      checkedAt: test.checkedAt.toISOString(),
    },
  };
}

export async function testSavedWooCommerceConnection(
  organizationId: string,
  actor: string,
) {
  assertEncryptionConfigured();
  const [connection] = await db
    .select()
    .from(wooCommerceConnections)
    .where(eq(wooCommerceConnections.organizationId, organizationId))
    .limit(1);
  if (!connection) return null;

  try {
    const test = await testWooCommerceCredentials(
      decryptWooCommerceCredentials(connection),
    );
    const [updated] = await db
      .update(wooCommerceConnections)
      .set({
        status: "connected",
        lastCheckedAt: test.checkedAt,
        lastSuccessAt: test.checkedAt,
        lastError: null,
        updatedBy: actor,
        updatedAt: test.checkedAt,
      })
      .where(
        and(
          eq(wooCommerceConnections.organizationId, organizationId),
          eq(wooCommerceConnections.id, connection.id),
        ),
      )
      .returning();
    return {
      connection: connectionDto(updated),
      test: {
        productCount: test.productCount,
        checkedAt: test.checkedAt.toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof WooCommerceConfigurationError) throw error;
    const checkedAt = new Date();
    const message =
      error instanceof Error
        ? error.message.slice(0, 2_000)
        : "WooCommerce connection test failed.";
    await db
      .update(wooCommerceConnections)
      .set({
        status: "error",
        lastCheckedAt: checkedAt,
        lastError: message,
        updatedBy: actor,
        updatedAt: checkedAt,
      })
      .where(
        and(
          eq(wooCommerceConnections.organizationId, organizationId),
          eq(wooCommerceConnections.id, connection.id),
        ),
      );
    throw error;
  }
}

export async function disconnectWooCommerce(organizationId: string) {
  const deleted = await db
    .delete(wooCommerceConnections)
    .where(eq(wooCommerceConnections.organizationId, organizationId))
    .returning({ id: wooCommerceConnections.id });
  return deleted.length > 0;
}
