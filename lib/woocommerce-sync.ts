import "server-only";

import { randomBytes } from "node:crypto";

import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
  contactResources,
  contacts,
  orderLines,
  orders,
  organizations,
  resources,
  resourceVariants,
  stockMovements,
  wooCommerceConnections,
  wooCommerceCustomerLinks,
  wooCommerceOrderLineSyncs,
  wooCommerceOrderSyncs,
  wooCommerceWebhookDeliveries,
  type WooCommerceConnectionRecord,
  type WooCommerceOrderLineSyncRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { hashIdempotentPayload } from "@/lib/idempotency";
import { organizationAllowsWorkerSideEffects } from "@/lib/organization-read-only";
import { bookResourceVariantMovement } from "@/lib/resource-variants";
import { decryptSecret, encryptSecret } from "@/lib/secret-encryption";
import { bookStockMovement } from "@/lib/stock";
import { validateWebhookTargetUrl } from "@/lib/webhook-contract";
import {
  computeWooCommerceLineTargets,
  parseWooCommerceMoneyToCents,
  verifyWooCommerceWebhookSignature,
  wooCommerceCustomerIdentity,
  wooCommerceManualSyncSchema,
  wooCommerceMovementIdempotencyKey,
  wooCommerceOrderSchema,
  wooCommercePayloadHash,
  wooCommerceProjectedSalesStatus,
  wooCommerceRecentImportWindow,
  wooCommerceRefundSchema,
  type WooCommerceLineTarget,
  type WooCommerceOrder,
  type WooCommerceRefund,
} from "@/lib/woocommerce-sync-contract";
import {
  decryptWooCommerceCredentials,
  getWooCommerceConnection,
  requestWooCommerceApi,
  WooCommerceConfigurationError,
  WooCommerceConnectionError,
  type WooCommerceCredentialMaterial,
} from "@/lib/woocommerce";

const ENCRYPTION_VARIABLE = "INTEGRATION_ENCRYPTION_KEY";
const MANUAL_RETRY_LIMIT = 20;
const RECENT_IMPORT_PAGE_SIZE = 100;
const RECENT_IMPORT_MAX_PAGES = 50;
const WEBHOOK_TOPICS = ["order.created", "order.updated"] as const;

type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class WooCommerceSyncError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 404 | 409 | 410 | 413 | 422 | 503 = 409,
  ) {
    super(message);
    this.name = "WooCommerceSyncError";
  }
}

function allowPrivateNetworks() {
  return (
    process.env.INTEGRATION_ALLOW_PRIVATE_NETWORKS?.trim().toLowerCase() ===
    "true"
  );
}

function webhookDeliveryUrl(connectionId: string) {
  const configured = process.env.AUTH_URL?.trim();
  if (!configured) {
    throw new WooCommerceConfigurationError(
      "AUTH_URL must be configured with the public HTTPS Inventory URL before WooCommerce stock sync can be enabled.",
    );
  }
  let base: URL;
  try {
    base = new URL(
      validateWebhookTargetUrl(configured, {
        allowPrivateNetworks: allowPrivateNetworks(),
      }),
    );
  } catch {
    throw new WooCommerceConfigurationError(
      "AUTH_URL must be a public HTTPS URL before WooCommerce stock sync can be enabled.",
    );
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/api/v1/integrations/woocommerce/webhook/${connectionId}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function remoteWebhookId(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "id" in payload &&
    Number.isSafeInteger(Number(payload.id)) &&
    Number(payload.id) > 0
  ) {
    return Number(payload.id);
  }
  throw new WooCommerceConnectionError(
    "WooCommerce did not return a valid webhook identifier.",
  );
}

async function createRemoteWebhook(
  credentials: WooCommerceCredentialMaterial,
  connectionId: string,
  topic: WebhookTopic,
  secret: string,
) {
  const response = await requestWooCommerceApi<unknown>({
    credentials,
    path: "webhooks",
    method: "POST",
    body: {
      name: `Inventory stock sync (${topic})`,
      status: "active",
      topic,
      delivery_url: webhookDeliveryUrl(connectionId),
      secret,
    },
  });
  return remoteWebhookId(response.payload);
}

async function deleteRemoteWebhook(
  credentials: WooCommerceCredentialMaterial,
  webhookId: number,
) {
  await requestWooCommerceApi<unknown>({
    credentials,
    path: `webhooks/${webhookId}`,
    method: "DELETE",
    query: { force: true },
  });
}

async function connectionByOrganization(organizationId: string) {
  const [connection] = await db
    .select()
    .from(wooCommerceConnections)
    .where(eq(wooCommerceConnections.organizationId, organizationId))
    .limit(1);
  return connection ?? null;
}

export async function enableWooCommerceStockSync(
  organizationId: string,
  actor: string,
) {
  await db.transaction(async (transaction) => {
    const [connection] = await transaction
      .select({
        connection: wooCommerceConnections,
        organizationReadOnly: organizations.isReadOnly,
      })
      .from(wooCommerceConnections)
      .innerJoin(
        organizations,
        eq(organizations.id, wooCommerceConnections.organizationId),
      )
      .where(eq(wooCommerceConnections.organizationId, organizationId))
      .limit(1)
      .for("update");
    if (!connection) {
      throw new WooCommerceSyncError(
        "No WooCommerce connection is configured.",
        404,
      );
    }
    if (
      !organizationAllowsWorkerSideEffects(connection.organizationReadOnly)
    ) {
      throw new WooCommerceSyncError(
        "WooCommerce stock sync is disabled for read-only organizations.",
        409,
      );
    }
    if (connection.connection.syncEnabled) {
      return;
    }

    const credentials = decryptWooCommerceCredentials(connection.connection);
    const secret = `wcsync_${randomBytes(32).toString("base64url")}`;
    const createdIds: number[] = [];
    try {
      for (const topic of WEBHOOK_TOPICS) {
        createdIds.push(
          await createRemoteWebhook(
            credentials,
            connection.connection.id,
            topic,
            secret,
          ),
        );
      }
      const [updated] = await transaction
        .update(wooCommerceConnections)
        .set({
          syncEnabled: true,
          encryptedWebhookSecret: encryptSecret(
            secret,
            ENCRYPTION_VARIABLE,
          ),
          orderCreatedWebhookId: createdIds[0]!,
          orderUpdatedWebhookId: createdIds[1]!,
          lastSyncError: null,
          updatedBy: actor,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(wooCommerceConnections.organizationId, organizationId),
            eq(wooCommerceConnections.id, connection.connection.id),
          ),
        )
        .returning({ id: wooCommerceConnections.id });
      if (!updated) {
        throw new WooCommerceSyncError(
          "The WooCommerce connection changed while stock sync was enabled.",
          409,
        );
      }
    } catch (error) {
      await Promise.allSettled(
        createdIds.map((id) => deleteRemoteWebhook(credentials, id)),
      );
      throw error;
    }
  });
  return getWooCommerceConnection(organizationId);
}

export async function disableWooCommerceStockSync(
  organizationId: string,
  actor: string,
) {
  const connection = await connectionByOrganization(organizationId);
  if (!connection) return null;
  if (connection.syncEnabled) {
    try {
      const credentials = decryptWooCommerceCredentials(connection);
      await Promise.allSettled(
        [
          connection.orderCreatedWebhookId,
          connection.orderUpdatedWebhookId,
        ]
          .filter((id): id is number => id !== null)
          .map((id) => deleteRemoteWebhook(credentials, id)),
      );
    } catch {
      // Local revocation remains authoritative. Any stale remote hook receives 410.
    }
  }
  await db
    .update(wooCommerceConnections)
    .set({
      syncEnabled: false,
      encryptedWebhookSecret: null,
      orderCreatedWebhookId: null,
      orderUpdatedWebhookId: null,
      updatedBy: actor,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(wooCommerceConnections.organizationId, organizationId),
        eq(wooCommerceConnections.id, connection.id),
      ),
    );
  return getWooCommerceConnection(organizationId);
}

export async function setWooCommerceStockSyncEnabled(
  organizationId: string,
  enabled: boolean,
  actor: string,
) {
  return enabled
    ? enableWooCommerceStockSync(organizationId, actor)
    : disableWooCommerceStockSync(organizationId, actor);
}

async function fetchOrderBundle(
  connection: WooCommerceConnectionRecord,
  orderId: number,
) {
  const credentials = decryptWooCommerceCredentials(connection);
  const [orderResponse, refundResponse] = await Promise.all([
    requestWooCommerceApi<unknown>({
      credentials,
      path: `orders/${orderId}`,
    }),
    requestWooCommerceApi<unknown>({
      credentials,
      path: `orders/${orderId}/refunds`,
      query: { per_page: 100 },
    }),
  ]);
  const order = wooCommerceOrderSchema.safeParse(orderResponse.payload);
  const firstRefundPage = z.array(wooCommerceRefundSchema).safeParse(
    refundResponse.payload,
  );
  if (!order.success || !firstRefundPage.success) {
    throw new WooCommerceConnectionError(
      "WooCommerce returned an invalid order or refund response.",
    );
  }
  const totalPagesHeader = refundResponse.headers["x-wp-totalpages"];
  const totalPages = Number(
    Array.isArray(totalPagesHeader) ? totalPagesHeader[0] : totalPagesHeader,
  );
  if (Number.isSafeInteger(totalPages) && totalPages > 10) {
    throw new WooCommerceConnectionError(
      "This order has more refund pages than Inventory can reconcile safely.",
    );
  }
  const remainingPages =
    Number.isSafeInteger(totalPages) && totalPages > 1
      ? await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            requestWooCommerceApi<unknown>({
              credentials,
              path: `orders/${orderId}/refunds`,
              query: { per_page: 100, page: index + 2 },
            }),
          ),
        )
      : [];
  const refunds = [...firstRefundPage.data];
  for (const page of remainingPages) {
    const parsed = z.array(wooCommerceRefundSchema).safeParse(page.payload);
    if (!parsed.success) {
      throw new WooCommerceConnectionError(
        "WooCommerce returned an invalid refund response.",
      );
    }
    refunds.push(...parsed.data);
  }
  return { order: order.data, refunds };
}

const wooCommerceOrderIdSchema = z
  .object({ id: z.number().int().positive() })
  .passthrough();

function numericHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const header = headers[name];
  const value = Number(Array.isArray(header) ? header[0] : header);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function fetchRecentWooCommerceOrderIds(
  connection: WooCommerceConnectionRecord,
) {
  const credentials = decryptWooCommerceCredentials(connection);
  const window = wooCommerceRecentImportWindow();
  const orderIds: number[] = [];
  let page = 1;
  let totalPages: number | null = null;

  do {
    const response = await requestWooCommerceApi<unknown>({
      credentials,
      path: "orders",
      query: {
        after: window.after,
        before: window.before,
        dates_are_gmt: true,
        order: "asc",
        orderby: "date",
        per_page: RECENT_IMPORT_PAGE_SIZE,
        page,
        _fields: "id",
      },
    });
    const parsed = z.array(wooCommerceOrderIdSchema).safeParse(response.payload);
    if (!parsed.success) {
      throw new WooCommerceConnectionError(
        "WooCommerce returned an invalid recent-orders response.",
      );
    }
    totalPages ??= numericHeader(response.headers, "x-wp-totalpages");
    if (totalPages !== null && totalPages > RECENT_IMPORT_MAX_PAGES) {
      throw new WooCommerceSyncError(
        "The seven-day import contains more orders than Inventory can process safely in one run.",
        409,
      );
    }
    orderIds.push(...parsed.data.map((order) => order.id));

    if (totalPages !== null) {
      page += 1;
    } else if (parsed.data.length === RECENT_IMPORT_PAGE_SIZE) {
      page += 1;
      if (page > RECENT_IMPORT_MAX_PAGES) {
        throw new WooCommerceSyncError(
          "The seven-day import contains more orders than Inventory can process safely in one run.",
          409,
        );
      }
    } else {
      break;
    }
  } while (totalPages === null || page <= totalPages);

  return {
    orderIds: [...new Set(orderIds)],
    ...window,
  };
}

async function resolveSku(
  transaction: Transaction,
  organizationId: string,
  sku: string,
) {
  if (!sku) {
    return { mapping: null, error: "The WooCommerce order line has no SKU." };
  }
  if (sku.length > 80) {
    return {
      mapping: null,
      error: `SKU ${sku.slice(0, 40)}… is longer than Inventory supports.`,
    };
  }
  const itemRows = await transaction
    .select({ resourceId: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.sku, sku),
      ),
    )
    .limit(2);
  const variantRows = await transaction
    .select({
      resourceId: resourceVariants.resourceId,
      variantId: resourceVariants.id,
    })
    .from(resourceVariants)
    .where(
      and(
        eq(resourceVariants.organizationId, organizationId),
        eq(resourceVariants.sku, sku),
      ),
    )
    .limit(2);
  if (itemRows.length + variantRows.length !== 1) {
    return {
      mapping: null,
      error:
        itemRows.length + variantRows.length === 0
          ? `No Inventory item or variant uses SKU ${sku}.`
          : `SKU ${sku} is ambiguous in Inventory.`,
    };
  }
  if (variantRows[0]) {
    return { mapping: variantRows[0], error: null };
  }
  return {
    mapping: { resourceId: itemRows[0]!.resourceId, variantId: null },
    error: null,
  };
}

const limited = (value: string | null | undefined, maximum: number) => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maximum) : null;
};

function wooCommerceContactSnapshot(order: WooCommerceOrder) {
  const billing = order.billing;
  const identity = wooCommerceCustomerIdentity(order);
  const personalName = [billing?.first_name, billing?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const company = limited(billing?.company, 240);
  const name = limited(
    personalName ||
      company ||
      identity.email ||
      `WooCommerce customer ${identity.customerId ?? `order ${order.number}`}`,
    240,
  )!;
  const country = billing?.country.trim().toUpperCase() ?? "";
  return {
    identity,
    name,
    company,
    email: identity.email,
    phone: limited(billing?.phone, 80),
    addressLine1: limited(billing?.address_1, 240),
    addressLine2: limited(billing?.address_2, 240),
    postalCode: limited(billing?.postcode, 32),
    city: limited(billing?.city, 120),
    state: limited(billing?.state, 120),
    countryCode: /^[A-Z]{2}$/.test(country) ? country : null,
  };
}

async function upsertWooCommerceContact(
  transaction: Transaction,
  options: {
    organizationId: string;
    connectionId: string;
    order: WooCommerceOrder;
    actor: string;
  },
) {
  const snapshot = wooCommerceContactSnapshot(options.order);
  const lockKey = [
    "woocommerce-customer",
    options.organizationId,
    options.connectionId,
    snapshot.identity.key,
  ].join(":");
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );

  const [link] = await transaction
    .select({ contactId: wooCommerceCustomerLinks.contactId })
    .from(wooCommerceCustomerLinks)
    .where(
      and(
        eq(wooCommerceCustomerLinks.organizationId, options.organizationId),
        eq(wooCommerceCustomerLinks.connectionId, options.connectionId),
        eq(wooCommerceCustomerLinks.customerKey, snapshot.identity.key),
      ),
    )
    .limit(1);

  let contact = link
    ? (
        await transaction
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.organizationId, options.organizationId),
              eq(contacts.id, link.contactId),
            ),
          )
          .limit(1)
      )[0]
    : null;

  if (!contact && snapshot.email) {
    const candidates = await transaction
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.organizationId, options.organizationId),
          isNull(contacts.archivedAt),
          sql`lower(btrim(${contacts.email})) = ${snapshot.email}`,
        ),
      )
      .limit(2);
    if (candidates.length === 1) contact = candidates[0]!;
  }

  const now = new Date();
  if (contact) {
    const [updated] = await transaction
      .update(contacts)
      .set({
        name: snapshot.name,
        company: snapshot.company ?? contact.company,
        roles: Array.from(new Set([...contact.roles, "customer" as const])),
        email: snapshot.email ?? contact.email,
        phone: snapshot.phone ?? contact.phone,
        addressLine1: snapshot.addressLine1 ?? contact.addressLine1,
        addressLine2: snapshot.addressLine2 ?? contact.addressLine2,
        postalCode: snapshot.postalCode ?? contact.postalCode,
        city: snapshot.city ?? contact.city,
        state: snapshot.state ?? contact.state,
        countryCode: snapshot.countryCode ?? contact.countryCode,
        tags: Array.from(new Set([...contact.tags, "woocommerce"])),
        updatedBy: options.actor,
        updatedAt: now,
      })
      .where(
        and(
          eq(contacts.organizationId, options.organizationId),
          eq(contacts.id, contact.id),
        ),
      )
      .returning();
    contact = updated ?? contact;
  } else {
    const [created] = await transaction
      .insert(contacts)
      .values({
        organizationId: options.organizationId,
        name: snapshot.name,
        company: snapshot.company,
        roles: ["customer"],
        email: snapshot.email,
        phone: snapshot.phone,
        addressLine1: snapshot.addressLine1,
        addressLine2: snapshot.addressLine2,
        postalCode: snapshot.postalCode,
        city: snapshot.city,
        state: snapshot.state,
        countryCode: snapshot.countryCode,
        tags: ["woocommerce"],
        createdBy: options.actor,
        updatedBy: options.actor,
      })
      .returning();
    if (!created) {
      throw new WooCommerceSyncError(
        "The WooCommerce customer could not be created.",
        409,
      );
    }
    contact = created;
  }

  await transaction
    .insert(wooCommerceCustomerLinks)
    .values({
      organizationId: options.organizationId,
      connectionId: options.connectionId,
      customerKey: snapshot.identity.key,
      customerId: snapshot.identity.customerId,
      email: snapshot.identity.email,
      contactId: contact.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        wooCommerceCustomerLinks.organizationId,
        wooCommerceCustomerLinks.connectionId,
        wooCommerceCustomerLinks.customerKey,
      ],
      set: {
        customerId: snapshot.identity.customerId,
        email: snapshot.identity.email,
        contactId: contact.id,
        updatedAt: now,
      },
    });
  return contact;
}

function wooCommerceOrderNote(order: WooCommerceOrder) {
  return [
    `WooCommerce order ID: ${order.id}`,
    order.payment_method_title || order.payment_method
      ? `Payment: ${order.payment_method_title || order.payment_method}`
      : null,
    order.customer_note ? `Customer note:\n${order.customer_note}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
}

function wooCommerceOrderDate(order: WooCommerceOrder) {
  const value = order.date_created_gmt?.trim();
  if (!value) return null;
  const parsed = new Date(`${value.replace(/Z$/, "")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function wooCommerceLinePrice(
  order: WooCommerceOrder,
  lineItemId: number,
  quantity: number,
) {
  const source = order.line_items.find((line) => line.id === lineItemId);
  if (!source || quantity <= 0) return null;
  const total = parseWooCommerceMoneyToCents(source.total);
  if (total !== null) return Math.round(total / quantity);
  return parseWooCommerceMoneyToCents(source.price);
}

async function projectWooCommerceSalesOrder(options: {
  organizationId: string;
  connectionId: string;
  order: WooCommerceOrder;
}) {
  return db.transaction(async (transaction) => {
    const [syncOrder] = await transaction
      .select()
      .from(wooCommerceOrderSyncs)
      .where(
        and(
          eq(wooCommerceOrderSyncs.organizationId, options.organizationId),
          eq(wooCommerceOrderSyncs.connectionId, options.connectionId),
          eq(wooCommerceOrderSyncs.orderId, options.order.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!syncOrder) {
      throw new WooCommerceSyncError(
        "The WooCommerce order has no synchronization state.",
        409,
      );
    }

    const actor = `woocommerce:${options.connectionId}`;
    const contact = await upsertWooCommerceContact(transaction, {
      organizationId: options.organizationId,
      connectionId: options.connectionId,
      order: options.order,
      actor,
    });
    const orderedAt = wooCommerceOrderDate(options.order);
    const orderValues = {
      contactId: contact.id,
      contactName: contact.company ?? contact.name,
      reference: `WooCommerce #${options.order.number}`.slice(0, 160),
      ...(orderedAt ? { orderedAt } : {}),
      note: wooCommerceOrderNote(options.order),
      updatedAt: new Date(),
    };

    let localOrder = syncOrder.localOrderId
      ? (
          await transaction
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.organizationId, options.organizationId),
                eq(orders.id, syncOrder.localOrderId),
              ),
            )
            .limit(1)
        )[0]
      : null;
    if (localOrder && localOrder.type !== "sale") {
      throw new WooCommerceSyncError(
        "The linked Inventory order is not a sales order.",
        409,
      );
    }
    if (localOrder) {
      const [updated] = await transaction
        .update(orders)
        .set(orderValues)
        .where(
          and(
            eq(orders.organizationId, options.organizationId),
            eq(orders.id, localOrder.id),
          ),
        )
        .returning();
      localOrder = updated ?? localOrder;
    } else {
      const [created] = await transaction
        .insert(orders)
        .values({
          organizationId: options.organizationId,
          type: "sale",
          status: "confirmed",
          orderedAt: orderedAt ?? new Date(),
          ...orderValues,
          createdBy: actor,
        })
        .returning();
      if (!created) {
        throw new WooCommerceSyncError(
          "The Inventory sales order could not be created.",
          409,
        );
      }
      localOrder = created;
    }

    const syncLines = await transaction
      .select()
      .from(wooCommerceOrderLineSyncs)
      .where(
        and(
          eq(
            wooCommerceOrderLineSyncs.organizationId,
            options.organizationId,
          ),
          eq(wooCommerceOrderLineSyncs.connectionId, options.connectionId),
          eq(wooCommerceOrderLineSyncs.orderId, options.order.id),
        ),
      );
    const sourceLines = new Map(
      options.order.line_items.map((line) => [line.id, line]),
    );

    for (const syncLine of syncLines) {
      if (!syncLine.resourceId) continue;
      let localLine = syncLine.localOrderLineId
        ? (
            await transaction
              .select()
              .from(orderLines)
              .where(
                and(
                  eq(orderLines.organizationId, options.organizationId),
                  eq(orderLines.id, syncLine.localOrderLineId),
                  eq(orderLines.orderId, localOrder.id),
                ),
              )
              .limit(1)
          )[0]
        : null;
      const sourceLine = sourceLines.get(syncLine.lineItemId);
      const currentFulfilled = localLine?.fulfilledQuantity ?? 0;
      const currentReturned = localLine?.returnedQuantity ?? 0;
      const currentNet = currentFulfilled - currentReturned;
      const appliedDelta = syncLine.appliedQuantity - currentNet;
      const fulfilledQuantity =
        currentFulfilled + Math.max(0, appliedDelta);
      const returnedQuantity = currentReturned + Math.max(0, -appliedDelta);
      const orderedQuantity = Math.max(
        1,
        syncLine.orderedQuantity,
        fulfilledQuantity,
      );
      const unitPriceCents = wooCommerceLinePrice(
        options.order,
        syncLine.lineItemId,
        Math.max(1, syncLine.orderedQuantity),
      );
      const currency = /^[A-Z]{3}$/.test(options.order.currency ?? "")
        ? options.order.currency!
        : "EUR";
      const note = [
        `WooCommerce line ID: ${syncLine.lineItemId}`,
        sourceLine?.name ? `Product: ${sourceLine.name}` : null,
        `SKU: ${syncLine.sku || "(missing)"}`,
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 20_000);
      const lineValues = {
        resourceId: syncLine.resourceId,
        variantId: syncLine.variantId,
        orderedQuantity,
        fulfilledQuantity,
        returnedQuantity,
        unitPriceCents,
        priceCurrency: unitPriceCents === null ? null : currency,
        note,
        updatedAt: new Date(),
      };

      if (localLine) {
        const [updated] = await transaction
          .update(orderLines)
          .set(lineValues)
          .where(
            and(
              eq(orderLines.organizationId, options.organizationId),
              eq(orderLines.id, localLine.id),
            ),
          )
          .returning();
        localLine = updated ?? localLine;
      } else {
        const [created] = await transaction
          .insert(orderLines)
          .values({
            organizationId: options.organizationId,
            orderId: localOrder.id,
            ...lineValues,
          })
          .returning();
        if (!created) {
          throw new WooCommerceSyncError(
            "An Inventory sales-order line could not be created.",
            409,
          );
        }
        localLine = created;
      }

      await transaction
        .update(wooCommerceOrderLineSyncs)
        .set({ localOrderLineId: localLine.id, updatedAt: new Date() })
        .where(
          and(
            eq(
              wooCommerceOrderLineSyncs.organizationId,
              options.organizationId,
            ),
            eq(wooCommerceOrderLineSyncs.connectionId, options.connectionId),
            eq(wooCommerceOrderLineSyncs.orderId, options.order.id),
            eq(wooCommerceOrderLineSyncs.lineItemId, syncLine.lineItemId),
          ),
        );
      await transaction
        .insert(contactResources)
        .values({
          organizationId: options.organizationId,
          contactId: contact.id,
          resourceId: syncLine.resourceId,
          createdBy: actor,
        })
        .onConflictDoNothing();
      if (syncLine.lastMovementId) {
        await transaction
          .update(stockMovements)
          .set({ contactId: contact.id, orderLineId: localLine.id })
          .where(
            and(
              eq(stockMovements.organizationId, options.organizationId),
              eq(stockMovements.id, syncLine.lastMovementId),
            ),
          );
      }
    }

    const projectedLines = await transaction
      .select({
        orderedQuantity: orderLines.orderedQuantity,
        fulfilledQuantity: orderLines.fulfilledQuantity,
        returnedQuantity: orderLines.returnedQuantity,
      })
      .from(orderLines)
      .where(
        and(
          eq(orderLines.organizationId, options.organizationId),
          eq(orderLines.orderId, localOrder.id),
        ),
      );
    const status = wooCommerceProjectedSalesStatus({
      wooStatus: options.order.status,
      unresolved: syncLines.some((line) => line.status !== "synced"),
      lines: projectedLines,
    });
    await transaction
      .update(orders)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(orders.organizationId, options.organizationId),
          eq(orders.id, localOrder.id),
        ),
      );
    await transaction
      .update(wooCommerceOrderSyncs)
      .set({
        contactId: contact.id,
        localOrderId: localOrder.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wooCommerceOrderSyncs.organizationId, options.organizationId),
          eq(wooCommerceOrderSyncs.connectionId, options.connectionId),
          eq(wooCommerceOrderSyncs.orderId, options.order.id),
        ),
      );
    return { contactId: contact.id, localOrderId: localOrder.id };
  });
}

function movementNote(order: WooCommerceOrder, line: WooCommerceLineTarget) {
  return `WooCommerce order ${order.number}; order ID ${order.id}; line ${line.lineItemId}; SKU ${line.sku || "(missing)"}.`;
}

async function applyLineTarget(options: {
  organizationId: string;
  connectionId: string;
  order: WooCommerceOrder;
  line: WooCommerceLineTarget;
  existing: WooCommerceOrderLineSyncRecord | null;
  mapping: { resourceId: string; variantId: string | null };
  transactionEffect: (
    transaction: Transaction,
    movementId: string,
  ) => Promise<void>;
}) {
  const appliedQuantity = options.existing?.appliedQuantity ?? 0;
  const delta = appliedQuantity - options.line.targetQuantity;
  if (delta === 0) return { movementId: options.existing?.lastMovementId ?? null };
  const revision = (options.existing?.revision ?? 0) + 1;
  const idempotencyKey = wooCommerceMovementIdempotencyKey({
    connectionId: options.connectionId,
    orderId: options.order.id,
    lineItemId: options.line.lineItemId,
    resourceId: options.mapping.resourceId,
    variantId: options.mapping.variantId,
    revision,
    targetQuantity: options.line.targetQuantity,
  });
  const input = {
    delta,
    type: delta < 0 ? ("issue" as const) : ("return" as const),
    reason: `WooCommerce order #${options.order.number}`.slice(0, 240),
    note: movementNote(options.order, options.line),
    occurredAt: options.order.date_modified_gmt
      ? `${options.order.date_modified_gmt.replace(/Z$/, "")}Z`
      : new Date().toISOString(),
  };
  const requestHash = hashIdempotentPayload({
    source: "woocommerce",
    ...input,
    connectionId: options.connectionId,
    orderId: options.order.id,
    lineItemId: options.line.lineItemId,
    resourceId: options.mapping.resourceId,
    variantId: options.mapping.variantId,
    revision,
    targetQuantity: options.line.targetQuantity,
  });
  const actor = `woocommerce:${options.connectionId}`;
  if (options.mapping.variantId) {
    const result = await bookResourceVariantMovement(
      options.organizationId,
      options.mapping.resourceId,
      options.mapping.variantId,
      input,
      actor,
      { key: idempotencyKey, requestHash },
      (transaction, movement) =>
        options.transactionEffect(transaction, movement.id),
    );
    return { movementId: result.movement.id, moved: true };
  }
  const result = await bookStockMovement(
    options.organizationId,
    options.mapping.resourceId,
    {
      ...input,
      occurredAt: new Date(input.occurredAt),
    },
    actor,
    { key: idempotencyKey, requestHash },
    (transaction, movement) =>
      options.transactionEffect(transaction, movement.id),
  );
  const response = result.response as {
    movement?: { id?: unknown };
  };
  return {
    movementId:
      typeof response.movement?.id === "string"
        ? response.movement.id
        : options.existing?.lastMovementId ?? null,
    moved: true,
  };
}

async function saveLineState(
  transaction: Transaction,
  options: {
    organizationId: string;
    connectionId: string;
    orderId: number;
    line: WooCommerceLineTarget;
    existing: WooCommerceOrderLineSyncRecord | null;
    mapping: { resourceId: string; variantId: string | null } | null;
    status: "synced" | "unmapped" | "error";
    error: string | null;
    movementId?: string | null;
    appliedQuantity?: number;
    moved: boolean;
  },
) {
  const now = new Date();
  await transaction
    .insert(wooCommerceOrderLineSyncs)
    .values({
      organizationId: options.organizationId,
      connectionId: options.connectionId,
      orderId: options.orderId,
      lineItemId: options.line.lineItemId,
      resourceId: options.mapping?.resourceId ?? null,
      variantId: options.mapping?.variantId ?? null,
      sku: options.line.sku.slice(0, 80),
      orderedQuantity: options.line.orderedQuantity,
      refundedQuantity: options.line.refundedQuantity,
      appliedQuantity:
        options.appliedQuantity ?? options.existing?.appliedQuantity ?? 0,
      revision:
        (options.existing?.revision ?? 0) + (options.moved ? 1 : 0),
      status: options.status,
      lastMovementId:
        options.movementId ?? options.existing?.lastMovementId ?? null,
      lastError: options.error,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        wooCommerceOrderLineSyncs.organizationId,
        wooCommerceOrderLineSyncs.connectionId,
        wooCommerceOrderLineSyncs.orderId,
        wooCommerceOrderLineSyncs.lineItemId,
      ],
      set: {
        resourceId: options.mapping?.resourceId ?? null,
        variantId: options.mapping?.variantId ?? null,
        sku: options.line.sku.slice(0, 80),
        orderedQuantity: options.line.orderedQuantity,
        refundedQuantity: options.line.refundedQuantity,
        appliedQuantity:
          options.appliedQuantity ?? options.existing?.appliedQuantity ?? 0,
        revision:
          (options.existing?.revision ?? 0) + (options.moved ? 1 : 0),
        status: options.status,
        lastMovementId:
          options.movementId ?? options.existing?.lastMovementId ?? null,
        lastError: options.error,
        updatedAt: now,
      },
    });
}

export async function reconcileWooCommerceOrder(options: {
  organizationId: string;
  connectionId: string;
  order: WooCommerceOrder;
  refunds: WooCommerceRefund[];
  deliveryId?: string | null;
}) {
  const targets = computeWooCommerceLineTargets(options.order, options.refunds);
  await db.transaction(async (transaction) => {
    const now = new Date();
    await transaction
      .insert(wooCommerceOrderSyncs)
      .values({
        organizationId: options.organizationId,
        connectionId: options.connectionId,
        orderId: options.order.id,
        orderNumber: options.order.number.slice(0, 80),
        orderStatus: options.order.status,
        totalLines: targets.length,
        syncedLines: 0,
        status: "failed",
        lastDeliveryId: options.deliveryId ?? null,
        lastError: "Order reconciliation was interrupted.",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          wooCommerceOrderSyncs.organizationId,
          wooCommerceOrderSyncs.connectionId,
          wooCommerceOrderSyncs.orderId,
        ],
        set: {
          orderNumber: options.order.number.slice(0, 80),
          orderStatus: options.order.status,
          lastDeliveryId: options.deliveryId ?? null,
          updatedAt: now,
        },
      });
    if (targets.length) {
      await transaction
        .insert(wooCommerceOrderLineSyncs)
        .values(
          targets.map((line) => ({
            organizationId: options.organizationId,
            connectionId: options.connectionId,
            orderId: options.order.id,
            lineItemId: line.lineItemId,
            sku: line.sku.slice(0, 80),
            orderedQuantity: line.orderedQuantity,
            refundedQuantity: line.refundedQuantity,
            appliedQuantity: 0,
            revision: 0,
            status: "error" as const,
            lastError: "Order reconciliation was interrupted.",
          })),
        )
        .onConflictDoNothing();
    }
  });
  const reconciliation = await db.transaction(async (transaction) => {
    const now = new Date();
    await transaction
      .insert(wooCommerceOrderSyncs)
      .values({
        organizationId: options.organizationId,
        connectionId: options.connectionId,
        orderId: options.order.id,
        orderNumber: options.order.number.slice(0, 80),
        orderStatus: options.order.status,
        totalLines: targets.length,
        syncedLines: 0,
        status: "failed",
        lastDeliveryId: options.deliveryId ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          wooCommerceOrderSyncs.organizationId,
          wooCommerceOrderSyncs.connectionId,
          wooCommerceOrderSyncs.orderId,
        ],
        set: {
          orderNumber: options.order.number.slice(0, 80),
          orderStatus: options.order.status,
          totalLines: targets.length,
          lastDeliveryId: options.deliveryId ?? null,
          updatedAt: now,
        },
      });
    const [lockedOrder] = await transaction
      .select({ id: wooCommerceOrderSyncs.id })
      .from(wooCommerceOrderSyncs)
      .where(
        and(
          eq(wooCommerceOrderSyncs.organizationId, options.organizationId),
          eq(wooCommerceOrderSyncs.connectionId, options.connectionId),
          eq(wooCommerceOrderSyncs.orderId, options.order.id),
        ),
      )
      .limit(1)
      .for("update");
    if (!lockedOrder) {
      throw new WooCommerceSyncError(
        "The WooCommerce order sync state could not be locked.",
        409,
      );
    }
    const existingLines = await transaction
      .select()
      .from(wooCommerceOrderLineSyncs)
      .where(
        and(
          eq(
            wooCommerceOrderLineSyncs.organizationId,
            options.organizationId,
          ),
          eq(wooCommerceOrderLineSyncs.connectionId, options.connectionId),
          eq(wooCommerceOrderLineSyncs.orderId, options.order.id),
        ),
      );
    const existingById = new Map(
      existingLines.map((line) => [line.lineItemId, line]),
    );
    const currentIds = new Set(targets.map((target) => target.lineItemId));
    const removedTargets: WooCommerceLineTarget[] = existingLines
      .filter((line) => !currentIds.has(line.lineItemId))
      .map((line) => ({
        lineItemId: line.lineItemId,
        productId: 0,
        variationId: 0,
        sku: line.sku,
        orderedQuantity: line.orderedQuantity,
        refundedQuantity: line.orderedQuantity,
        targetQuantity: 0,
      }));

    let syncedLines = 0;
    const errors: string[] = [];
    for (const line of [...targets, ...removedTargets]) {
      const existing = existingById.get(line.lineItemId) ?? null;
      const resolved = existing?.resourceId
        ? {
            mapping: {
              resourceId: existing.resourceId,
              variantId: existing.variantId,
            },
            error: null,
          }
        : await resolveSku(transaction, options.organizationId, line.sku);
      if (!resolved.mapping) {
        if (line.targetQuantity === 0) {
          await saveLineState(transaction, {
            organizationId: options.organizationId,
            connectionId: options.connectionId,
            orderId: options.order.id,
            line,
            existing,
            mapping: null,
            status: "synced",
            error: null,
            appliedQuantity: 0,
            moved: false,
          });
          syncedLines += 1;
          continue;
        }
        const error = resolved.error ?? "The SKU could not be mapped.";
        await saveLineState(transaction, {
          organizationId: options.organizationId,
          connectionId: options.connectionId,
          orderId: options.order.id,
          line,
          existing,
          mapping: null,
          status: "unmapped",
          error,
          moved: false,
        });
        errors.push(`Line ${line.lineItemId}: ${error}`);
        continue;
      }
      try {
        const moved =
          (existing?.appliedQuantity ?? 0) !== line.targetQuantity;
        const movement = await applyLineTarget({
          organizationId: options.organizationId,
          connectionId: options.connectionId,
          order: options.order,
          line,
          existing,
          mapping: resolved.mapping,
          transactionEffect: async (bookingTransaction, movementId) => {
            await saveLineState(bookingTransaction, {
              organizationId: options.organizationId,
              connectionId: options.connectionId,
              orderId: options.order.id,
              line,
              existing,
              mapping: resolved.mapping,
              status: "synced",
              error: null,
              movementId,
              appliedQuantity: line.targetQuantity,
              moved: true,
            });
          },
        });
        if (!moved) {
          await saveLineState(transaction, {
            organizationId: options.organizationId,
            connectionId: options.connectionId,
            orderId: options.order.id,
            line,
            existing,
            mapping: resolved.mapping,
            status: "synced",
            error: null,
            movementId: movement.movementId,
            appliedQuantity: line.targetQuantity,
            moved: false,
          });
        }
        syncedLines += 1;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : "The stock movement failed.";
        await saveLineState(transaction, {
          organizationId: options.organizationId,
          connectionId: options.connectionId,
          orderId: options.order.id,
          line,
          existing,
          mapping: resolved.mapping,
          status: "error",
          error: message,
          moved: false,
        });
        errors.push(`Line ${line.lineItemId}: ${message}`);
      }
    }

    const totalLines = targets.length + removedTargets.length;
    const status =
      errors.length === 0
        ? ("succeeded" as const)
        : syncedLines > 0
          ? ("partial" as const)
          : ("failed" as const);
    const lastError = errors.length ? errors.join("\n").slice(0, 8_000) : null;
    await transaction
      .update(wooCommerceOrderSyncs)
      .set({
        orderNumber: options.order.number.slice(0, 80),
        orderStatus: options.order.status,
        status,
        totalLines,
        syncedLines,
        lastDeliveryId: options.deliveryId ?? null,
        lastError,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wooCommerceOrderSyncs.organizationId, options.organizationId),
          eq(wooCommerceOrderSyncs.connectionId, options.connectionId),
          eq(wooCommerceOrderSyncs.orderId, options.order.id),
        ),
      );
    return {
      orderId: options.order.id,
      orderNumber: options.order.number,
      orderStatus: options.order.status,
      status,
      totalLines,
      syncedLines,
      errors,
    };
  });
  try {
    const projection = await projectWooCommerceSalesOrder({
      organizationId: options.organizationId,
      connectionId: options.connectionId,
      order: options.order,
    });
    return { ...reconciliation, ...projection };
  } catch (error) {
    const message =
      error instanceof Error
        ? `Sales-order projection failed: ${error.message}`.slice(0, 8_000)
        : "Sales-order projection failed.";
    await db
      .update(wooCommerceOrderSyncs)
      .set({ status: "failed", lastError: message, updatedAt: new Date() })
      .where(
        and(
          eq(wooCommerceOrderSyncs.organizationId, options.organizationId),
          eq(wooCommerceOrderSyncs.connectionId, options.connectionId),
          eq(wooCommerceOrderSyncs.orderId, options.order.id),
        ),
      );
    throw error;
  }
}

async function syncOrderById(
  connection: WooCommerceConnectionRecord,
  orderId: number,
  deliveryId?: string | null,
) {
  const bundle = await fetchOrderBundle(connection, orderId);
  const result = await reconcileWooCommerceOrder({
    organizationId: connection.organizationId,
    connectionId: connection.id,
    ...bundle,
    deliveryId,
  });
  const now = new Date();
  await db
    .update(wooCommerceConnections)
    .set({
      lastSyncAt: now,
      lastSyncError: result.errors.length
        ? result.errors.join("\n").slice(0, 8_000)
        : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(wooCommerceConnections.organizationId, connection.organizationId),
        eq(wooCommerceConnections.id, connection.id),
      ),
    );
  return result;
}

export async function runManualWooCommerceSync(
  organizationId: string,
  input: z.infer<typeof wooCommerceManualSyncSchema>,
) {
  const connection = await connectionByOrganization(organizationId);
  if (!connection) {
    throw new WooCommerceSyncError(
      "No WooCommerce connection is configured.",
      404,
    );
  }
  const recentImport =
    "window" in input && input.window === "last-7-days"
      ? await fetchRecentWooCommerceOrderIds(connection)
      : null;
  const orderIds =
    "orderId" in input
      ? [input.orderId]
      : recentImport
        ? recentImport.orderIds
        : (
            await db
              .select({ orderId: wooCommerceOrderSyncs.orderId })
              .from(wooCommerceOrderSyncs)
              .where(
                and(
                  eq(wooCommerceOrderSyncs.organizationId, organizationId),
                  eq(wooCommerceOrderSyncs.connectionId, connection.id),
                  ne(wooCommerceOrderSyncs.status, "succeeded"),
                ),
              )
              .orderBy(desc(wooCommerceOrderSyncs.updatedAt))
              .limit(MANUAL_RETRY_LIMIT)
          ).map((row) => row.orderId);
  const results = [];
  for (const orderId of orderIds) {
    try {
      results.push(await syncOrderById(connection, orderId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Order sync failed.";
      const failedAt = new Date();
      await db
        .update(wooCommerceConnections)
        .set({
          lastSyncAt: failedAt,
          lastSyncError: message.slice(0, 8_000),
          updatedAt: failedAt,
        })
        .where(
          and(
            eq(wooCommerceConnections.organizationId, organizationId),
            eq(wooCommerceConnections.id, connection.id),
          ),
        );
      results.push({
        orderId,
        status: "failed" as const,
        errors: [message],
      });
    }
  }
  return {
    mode: "orderId" in input
      ? ("single-order" as const)
      : recentImport
        ? ("last-7-days" as const)
        : ("retry-issues" as const),
    after: recentImport?.after ?? null,
    before: recentImport?.before ?? null,
    attempted: orderIds.length,
    succeeded: results.filter((result) => result.status === "succeeded")
      .length,
    results,
  };
}

export async function getWooCommerceSyncOverview(
  organizationId: string,
  connectionId: string,
) {
  const [counts] = await db
    .select({
      totalOrders: sql<number>`count(*)::int`,
      issueOrders: sql<number>`count(*) filter (where ${wooCommerceOrderSyncs.status} <> 'succeeded')::int`,
    })
    .from(wooCommerceOrderSyncs)
    .where(
      and(
        eq(wooCommerceOrderSyncs.organizationId, organizationId),
        eq(wooCommerceOrderSyncs.connectionId, connectionId),
      ),
    );
  const recent = await db
    .select()
    .from(wooCommerceOrderSyncs)
    .where(
      and(
        eq(wooCommerceOrderSyncs.organizationId, organizationId),
        eq(wooCommerceOrderSyncs.connectionId, connectionId),
      ),
    )
    .orderBy(desc(wooCommerceOrderSyncs.updatedAt))
    .limit(10);
  const orderIds = recent.map((order) => order.orderId);
  const issueLines = orderIds.length
    ? await db
        .select({
          orderId: wooCommerceOrderLineSyncs.orderId,
          lineItemId: wooCommerceOrderLineSyncs.lineItemId,
          sku: wooCommerceOrderLineSyncs.sku,
          status: wooCommerceOrderLineSyncs.status,
          error: wooCommerceOrderLineSyncs.lastError,
        })
        .from(wooCommerceOrderLineSyncs)
        .where(
          and(
            eq(
              wooCommerceOrderLineSyncs.organizationId,
              organizationId,
            ),
            eq(wooCommerceOrderLineSyncs.connectionId, connectionId),
            inArray(wooCommerceOrderLineSyncs.orderId, orderIds),
            ne(wooCommerceOrderLineSyncs.status, "synced"),
          ),
        )
    : [];
  return {
    totalOrders: Number(counts?.totalOrders ?? 0),
    issueOrders: Number(counts?.issueOrders ?? 0),
    recentOrders: recent.map((order) => ({
      orderId: order.orderId,
      localOrderId: order.localOrderId,
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      status: order.status,
      totalLines: order.totalLines,
      syncedLines: order.syncedLines,
      lastError: order.lastError,
      updatedAt: order.updatedAt.toISOString(),
      issues: issueLines.filter((line) => line.orderId === order.orderId),
    })),
  };
}

export async function handleWooCommerceWebhook(options: {
  connectionId: string;
  rawBody: string;
  signature: string | null;
  topic: string | null;
  deliveryId: string | null;
  webhookId: string | null;
}) {
  const [row] = await db
    .select({
      connection: wooCommerceConnections,
      organizationReadOnly: organizations.isReadOnly,
    })
    .from(wooCommerceConnections)
    .innerJoin(
      organizations,
      eq(organizations.id, wooCommerceConnections.organizationId),
    )
    .where(eq(wooCommerceConnections.id, options.connectionId))
    .limit(1);
  if (!row) throw new WooCommerceSyncError("Connection not found.", 404);
  if (!row.connection.syncEnabled || !row.connection.encryptedWebhookSecret) {
    throw new WooCommerceSyncError("WooCommerce stock sync is disabled.", 410);
  }
  if (!organizationAllowsWorkerSideEffects(row.organizationReadOnly)) {
    throw new WooCommerceSyncError(
      "WooCommerce stock sync is disabled for this organization.",
      410,
    );
  }
  const topic = WEBHOOK_TOPICS.find((value) => value === options.topic);
  if (!topic) {
    throw new WooCommerceSyncError("Unsupported WooCommerce webhook topic.", 400);
  }
  const expectedWebhookId =
    topic === "order.created"
      ? row.connection.orderCreatedWebhookId
      : row.connection.orderUpdatedWebhookId;
  const webhookId = Number(options.webhookId);
  if (
    !Number.isSafeInteger(webhookId) ||
    webhookId <= 0 ||
    webhookId !== expectedWebhookId
  ) {
    throw new WooCommerceSyncError("Unknown WooCommerce webhook.", 401);
  }
  const secret = decryptSecret(
    row.connection.encryptedWebhookSecret,
    ENCRYPTION_VARIABLE,
  );
  if (
    !verifyWooCommerceWebhookSignature(
      options.rawBody,
      secret,
      options.signature,
    )
  ) {
    throw new WooCommerceSyncError(
      "Invalid WooCommerce webhook signature.",
      401,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(options.rawBody);
  } catch {
    throw new WooCommerceSyncError("Expected a JSON webhook body.", 400);
  }
  const orderId = Number(
    payload && typeof payload === "object" && "id" in payload
      ? payload.id
      : NaN,
  );
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new WooCommerceSyncError(
      "WooCommerce webhook has no valid order ID.",
      422,
    );
  }
  const payloadHash = wooCommercePayloadHash(options.rawBody);
  const deliveryId = (
    options.deliveryId?.trim() || `payload:${payloadHash}`
  ).slice(0, 160);
  const [existing] = await db
    .select()
    .from(wooCommerceWebhookDeliveries)
    .where(
      and(
        eq(
          wooCommerceWebhookDeliveries.organizationId,
          row.connection.organizationId,
        ),
        eq(wooCommerceWebhookDeliveries.connectionId, row.connection.id),
        eq(wooCommerceWebhookDeliveries.deliveryId, deliveryId),
      ),
    )
    .limit(1);
  if (existing && existing.payloadSha256 !== payloadHash) {
    throw new WooCommerceSyncError(
      "WooCommerce delivery ID was reused with another payload.",
      409,
    );
  }
  if (existing?.status === "succeeded") {
    return { duplicate: true, orderId };
  }
  await db
    .insert(wooCommerceWebhookDeliveries)
    .values({
      organizationId: row.connection.organizationId,
      connectionId: row.connection.id,
      deliveryId,
      webhookId,
      topic,
      payloadSha256: payloadHash,
      orderId,
      status: "processing",
      error: null,
    })
    .onConflictDoUpdate({
      target: [
        wooCommerceWebhookDeliveries.organizationId,
        wooCommerceWebhookDeliveries.connectionId,
        wooCommerceWebhookDeliveries.deliveryId,
      ],
      set: {
        status: "processing",
        error: null,
        orderId,
      },
    });
  const receivedAt = new Date();
  await db
    .update(wooCommerceConnections)
    .set({ lastWebhookAt: receivedAt, updatedAt: receivedAt })
    .where(eq(wooCommerceConnections.id, row.connection.id));
  try {
    const result = await syncOrderById(row.connection, orderId, deliveryId);
    await db
      .update(wooCommerceWebhookDeliveries)
      .set({ status: "succeeded", error: null, processedAt: new Date() })
      .where(
        and(
          eq(
            wooCommerceWebhookDeliveries.organizationId,
            row.connection.organizationId,
          ),
          eq(wooCommerceWebhookDeliveries.connectionId, row.connection.id),
          eq(wooCommerceWebhookDeliveries.deliveryId, deliveryId),
        ),
      );
    return { duplicate: false, ...result };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 8_000)
        : "WooCommerce order sync failed.";
    await db
      .update(wooCommerceWebhookDeliveries)
      .set({ status: "failed", error: message, processedAt: new Date() })
      .where(
        and(
          eq(
            wooCommerceWebhookDeliveries.organizationId,
            row.connection.organizationId,
          ),
          eq(wooCommerceWebhookDeliveries.connectionId, row.connection.id),
          eq(wooCommerceWebhookDeliveries.deliveryId, deliveryId),
        ),
      );
    await db
      .update(wooCommerceConnections)
      .set({ lastSyncError: message, updatedAt: new Date() })
      .where(eq(wooCommerceConnections.id, row.connection.id));
    throw error;
  }
}
