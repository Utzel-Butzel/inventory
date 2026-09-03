import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  contacts,
  orderLines,
  orders,
  resources,
  stockMovements,
  stockSettings,
  type OrderRecord,
  type OrderStatus,
  type OrderType,
  type StockTrackingMode,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  defaultOrderStatus,
  deriveOrderStatus,
  isOrderStatusForType,
  requiredContactRole,
  type OrderCreateRequest,
  type OrderLineMovementRequest,
  type OrderPatchRequest,
} from "@/lib/order-contract";
import {
  bookStockMovement,
  StockOperationError,
} from "@/lib/stock";

type IdempotencyInput = { key: string; requestHash: string };

export class OrderOperationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "OrderOperationError";
  }
}

export function orderHttpError(error: unknown, fallback: string) {
  if (error instanceof OrderOperationError || error instanceof StockOperationError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("order_lines_order_resource_unique")) {
    return {
      status: 409 as const,
      message: "Each inventory item may appear only once in an order.",
    };
  }
  if (message.includes("orders_idempotency_key_unique")) {
    return {
      status: 409 as const,
      message: "That Idempotency-Key was already used for another order.",
    };
  }
  return { status: 500 as const, message: fallback };
}

function assertOrderMovementAllowed(
  order: Pick<OrderRecord, "type" | "status">,
  action: OrderLineMovementRequest["action"],
): asserts order is Pick<OrderRecord, "type" | "status"> & {
  type: Exclude<OrderType, "purchase">;
} {
  if (order.type === "purchase") {
    throw new OrderOperationError(
      "Use the purchase receipt action for purchase orders.",
      422,
    );
  }
  if (order.status === "cancelled" || order.status === "draft") {
    throw new OrderOperationError(
      "Confirm or reserve this order before moving stock.",
      409,
    );
  }
  if (action === "return") {
    if (order.type !== "loan") {
      throw new OrderOperationError("Only loan orders can be returned.", 422);
    }
    if (
      ![
        "partially-issued",
        "issued",
        "partially-returned",
        "overdue",
      ].includes(order.status)
    ) {
      throw new OrderOperationError(
        "This loan is not currently awaiting a return.",
        409,
      );
    }
    return;
  }
  const issueStatuses =
    order.type === "sale"
      ? ["confirmed", "partially-fulfilled"]
      : ["reserved", "partially-issued"];
  if (!issueStatuses.includes(order.status)) {
    throw new OrderOperationError(
      "This order is not currently available for issue.",
      409,
    );
  }
}

type OrderLineDtoInput = {
  id: string;
  orderId: string;
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  resourceCurrency: string;
  orderedQuantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  unitPriceCents: number | null;
  priceCurrency: string | null;
  expectedAt: Date | null;
  note: string;
  trackingMode: StockTrackingMode | null;
  unitName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const lineDto = (line: OrderLineDtoInput) => ({
  id: line.id,
  orderId: line.orderId,
  resourceId: line.resourceId,
  resourceName: line.resourceName,
  resourceSku: line.resourceSku,
  resourceCurrency: line.resourceCurrency,
  quantity: line.orderedQuantity,
  fulfilledQuantity: line.fulfilledQuantity,
  returnedQuantity: line.returnedQuantity,
  openQuantity: Math.max(0, line.orderedQuantity - line.fulfilledQuantity),
  openReturnQuantity: Math.max(
    0,
    line.fulfilledQuantity - line.returnedQuantity,
  ),
  unitPriceCents: line.unitPriceCents,
  priceCurrency: line.priceCurrency,
  totalPriceCents:
    line.unitPriceCents === null
      ? null
      : line.unitPriceCents * line.orderedQuantity,
  expectedAt: line.expectedAt?.toISOString() ?? null,
  note: line.note,
  trackingMode: line.trackingMode ?? "bulk",
  unitName: line.unitName ?? "unit",
  createdAt: line.createdAt.toISOString(),
  updatedAt: line.updatedAt.toISOString(),
});

const orderDto = (order: OrderRecord, rows: OrderLineDtoInput[]) => {
  const lines = rows.map(lineDto);
  const status =
    order.type === "loan" && order.status !== "cancelled" && order.status !== "draft"
      ? deriveOrderStatus(
          "loan",
          order.status,
          rows,
          order.expectedAt,
        )
      : order.status;
  return {
    id: order.id,
    type: order.type,
    contactId: order.contactId,
    contactName: order.contactName,
    reference: order.reference,
    status,
    orderedAt: order.orderedAt.toISOString(),
    expectedAt: order.expectedAt?.toISOString() ?? null,
    note: order.note,
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    lines,
    totalQuantity: lines.reduce((total, line) => total + line.quantity, 0),
    totalFulfilled: lines.reduce(
      (total, line) => total + line.fulfilledQuantity,
      0,
    ),
    totalReturned: lines.reduce(
      (total, line) => total + line.returnedQuantity,
      0,
    ),
  };
};

type OrderReader = Pick<typeof db, "select">;

async function loadOrderLines(
  organizationId: string,
  orderIds: string[],
  database: OrderReader = db,
) {
  if (!orderIds.length) return [];
  return database
    .select({
      id: orderLines.id,
      orderId: orderLines.orderId,
      resourceId: orderLines.resourceId,
      resourceName: resources.name,
      resourceSku: resources.sku,
      resourceCurrency: resources.currency,
      orderedQuantity: orderLines.orderedQuantity,
      fulfilledQuantity: orderLines.fulfilledQuantity,
      returnedQuantity: orderLines.returnedQuantity,
      unitPriceCents: orderLines.unitPriceCents,
      priceCurrency: orderLines.priceCurrency,
      expectedAt: orderLines.expectedAt,
      note: orderLines.note,
      trackingMode: stockSettings.trackingMode,
      unitName: stockSettings.unitName,
      createdAt: orderLines.createdAt,
      updatedAt: orderLines.updatedAt,
    })
    .from(orderLines)
    .innerJoin(
      resources,
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, orderLines.resourceId),
      ),
    )
    .leftJoin(
      stockSettings,
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, resources.id),
      ),
    )
    .where(
      and(
        eq(orderLines.organizationId, organizationId),
        inArray(orderLines.orderId, orderIds),
      ),
    )
    .orderBy(asc(orderLines.createdAt), asc(orderLines.id));
}

export async function listOrders(
  organizationId: string,
  options: { type?: OrderType; status?: OrderStatus; limit?: number } = {},
) {
  return db.transaction(async (transaction) => {
    const conditions = [eq(orders.organizationId, organizationId)];
    if (options.type) conditions.push(eq(orders.type, options.type));
    if (options.status) conditions.push(eq(orders.status, options.status));
    const rows = await transaction
      .select()
      .from(orders)
      .where(and(...conditions))
      .orderBy(desc(orders.orderedAt), desc(orders.createdAt))
      .limit(Math.min(100, Math.max(1, options.limit ?? 100)));
    const lineRows = await loadOrderLines(
      organizationId,
      rows.map((row) => row.id),
      transaction,
    );
    const byOrder = new Map<string, OrderLineDtoInput[]>();
    for (const line of lineRows) {
      const current = byOrder.get(line.orderId) ?? [];
      current.push(line);
      byOrder.set(line.orderId, current);
    }
    return { orders: rows.map((row) => orderDto(row, byOrder.get(row.id) ?? [])) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getOrder(organizationId: string, orderId: string) {
  return db.transaction(async (transaction) => {
    const [order] = await transaction
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.id, orderId),
        ),
      )
      .limit(1);
    if (!order) return null;
    const lines = await loadOrderLines(organizationId, [orderId], transaction);
    return orderDto(order, lines);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function loadContactForOrder(
  organizationId: string,
  contactId: string,
  type: OrderType,
  database: Pick<typeof db, "select">,
) {
  const [contact] = await database
    .select({
      id: contacts.id,
      name: contacts.name,
      company: contacts.company,
      roles: contacts.roles,
      archivedAt: contacts.archivedAt,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.organizationId, organizationId),
        eq(contacts.id, contactId),
      ),
    )
    .limit(1);
  const requiredRole = requiredContactRole(type);
  if (!contact || contact.archivedAt || !contact.roles.includes(requiredRole)) {
    throw new OrderOperationError(
      `Choose an active ${requiredRole} contact for this order.`,
      422,
    );
  }
  return contact;
}

export async function createOrder(
  organizationId: string,
  input: OrderCreateRequest,
  actor: string,
  idempotency: IdempotencyInput,
) {
  const resourceIds = input.lines.map((line) => line.resourceId);
  if (new Set(resourceIds).size !== resourceIds.length) {
    throw new OrderOperationError(
      "Each inventory item may appear only once in an order.",
      422,
    );
  }

  const validateReplay = (existing: OrderRecord) => {
    if (
      existing.createdBy !== actor ||
      existing.requestHash !== idempotency.requestHash
    ) {
      throw new OrderOperationError(
        "That Idempotency-Key was already used by another actor or payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  };
  const [existing] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.organizationId, organizationId),
        eq(orders.idempotencyKey, idempotency.key),
      ),
    )
    .limit(1);
  if (existing) return validateReplay(existing);

  try {
    return await db.transaction(async (transaction) => {
      const contact = await loadContactForOrder(
        organizationId,
        input.contactId,
        input.type,
        transaction,
      );
      const resourceRows = await transaction
        .select({
          id: resources.id,
          name: resources.name,
          currency: resources.currency,
        })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, [...resourceIds].sort()),
          ),
        )
        .orderBy(asc(resources.id))
        .for("update");
      if (resourceRows.length !== resourceIds.length) {
        throw new OrderOperationError(
          "One or more order items do not exist in this organization.",
          422,
        );
      }
      const byResource = new Map(resourceRows.map((row) => [row.id, row]));
      for (const line of input.lines) {
        const resource = byResource.get(line.resourceId);
        if (
          line.unitPriceCents != null &&
          line.priceCurrency?.toUpperCase() !== resource?.currency
        ) {
          throw new OrderOperationError(
            `The price for ${resource?.name ?? "this item"} must use ${resource?.currency ?? "its item currency"}.`,
            422,
          );
        }
      }
      const status = input.status ?? defaultOrderStatus(input.type);
      if (!isOrderStatusForType(input.type, status)) {
        throw new OrderOperationError(
          `Status ${status} is not valid for a ${input.type} order.`,
          422,
        );
      }
      const orderedAt = input.orderedAt ? new Date(input.orderedAt) : new Date();
      const expectedAt =
        input.expectedAt === undefined || input.expectedAt === null
          ? null
          : new Date(input.expectedAt);
      if (input.type === "loan" && !expectedAt) {
        throw new OrderOperationError(
          "A loan order requires a return due date.",
          422,
        );
      }
      if (expectedAt && expectedAt <= orderedAt) {
        throw new OrderOperationError(
          "The due date must be after the order date.",
          422,
        );
      }
      const [order] = await transaction
        .insert(orders)
        .values({
          organizationId,
          type: input.type,
          contactId: contact.id,
          contactName: contact.company ?? contact.name,
          reference: input.reference || null,
          status,
          orderedAt,
          expectedAt,
          note: input.note ?? "",
          idempotencyKey: idempotency.key,
          requestHash: idempotency.requestHash,
          response: {},
          createdBy: actor,
        })
        .returning();
      await transaction.insert(orderLines).values(
        input.lines.map((line) => ({
          organizationId,
          orderId: order.id,
          resourceId: line.resourceId,
          orderedQuantity: line.quantity,
          unitPriceCents: line.unitPriceCents ?? null,
          priceCurrency:
            line.unitPriceCents == null
              ? null
              : line.priceCurrency?.toUpperCase(),
          expectedAt:
            line.expectedAt === undefined || line.expectedAt === null
              ? null
              : new Date(line.expectedAt),
          note: line.note ?? "",
        })),
      );
      const lines = await loadOrderLines(organizationId, [order.id], transaction);
      const saved = orderDto(order, lines);
      const response = JSON.parse(JSON.stringify({ order: saved })) as Record<
        string,
        unknown
      >;
      await transaction
        .update(orders)
        .set({ response })
        .where(eq(orders.id, order.id));
      return { response, replayed: false } as const;
    });
  } catch (error) {
    const [winner] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (winner) return validateReplay(winner);
    throw error;
  }
}

export async function updateOrder(
  organizationId: string,
  orderId: string,
  patch: OrderPatchRequest,
) {
  const changed = await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.id, orderId),
        ),
      )
      .limit(1)
      .for("update");
    if (!order) return false;
    if (
      patch.status &&
      !isOrderStatusForType(order.type, patch.status)
    ) {
      throw new OrderOperationError(
        `Status ${patch.status} is not valid for a ${order.type} order.`,
        422,
      );
    }
    if (
      ["received", "fulfilled", "returned", "cancelled"].includes(order.status) &&
      patch.status &&
      patch.status !== order.status
    ) {
      throw new OrderOperationError(
        "A completed or cancelled order cannot be reopened.",
        409,
      );
    }
    const nextOrderedAt =
      patch.orderedAt === undefined
        ? order.orderedAt
        : new Date(patch.orderedAt);
    const nextExpectedAt =
      patch.expectedAt === undefined
        ? order.expectedAt
        : patch.expectedAt === null
          ? null
          : new Date(patch.expectedAt);
    if (order.type === "loan" && !nextExpectedAt) {
      throw new OrderOperationError(
        "A loan order requires a return due date.",
        422,
      );
    }
    if (
      (patch.orderedAt !== undefined || patch.expectedAt !== undefined) &&
      nextExpectedAt &&
      nextExpectedAt <= nextOrderedAt
    ) {
      throw new OrderOperationError(
        "The due date must be after the order date.",
        422,
      );
    }
    const contact = patch.contactId
      ? await loadContactForOrder(
          organizationId,
          patch.contactId,
          order.type,
          transaction,
        )
      : null;
    await transaction
      .update(orders)
      .set({
        ...(patch.contactId
          ? {
              contactId: patch.contactId,
              contactName: contact?.company ?? contact?.name ?? order.contactName,
            }
          : {}),
        ...(patch.reference !== undefined
          ? { reference: patch.reference || null }
          : {}),
        ...(patch.status !== undefined
          ? { status: patch.status as OrderStatus }
          : {}),
        ...(patch.orderedAt !== undefined
          ? { orderedAt: new Date(patch.orderedAt) }
          : {}),
        ...(patch.expectedAt !== undefined
          ? {
              expectedAt:
                patch.expectedAt === null ? null : new Date(patch.expectedAt),
            }
          : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.id, orderId),
        ),
      );
    return true;
  });
  return changed ? getOrder(organizationId, orderId) : null;
}

export async function executeOrderLineMovement(
  organizationId: string,
  orderId: string,
  lineId: string,
  input: OrderLineMovementRequest,
  actor: string,
  idempotency: IdempotencyInput,
) {
  const [initial] = await db
    .select({
      order: orders,
      line: orderLines,
    })
    .from(orderLines)
    .innerJoin(
      orders,
      and(
        eq(orders.organizationId, organizationId),
        eq(orders.id, orderLines.orderId),
      ),
    )
    .where(
      and(
        eq(orderLines.organizationId, organizationId),
        eq(orderLines.id, lineId),
        eq(orderLines.orderId, orderId),
      ),
    )
    .limit(1);
  if (!initial) throw new OrderOperationError("Order line not found.", 404);
  assertOrderMovementAllowed(initial.order, input.action);

  const isReturn = input.action === "return";
  const totalPriceCents =
    !isReturn && initial.order.type === "sale" && initial.line.unitPriceCents !== null
      ? -(initial.line.unitPriceCents * input.quantity)
      : null;
  const movementResult = await bookStockMovement(
    organizationId,
    initial.line.resourceId,
    {
      delta: isReturn ? input.quantity : -input.quantity,
      quantity: input.quantity,
      type: input.action,
      contactId: initial.order.contactId,
      reason: `${isReturn ? "Returned" : "Issued"} for ${initial.order.reference ?? initial.order.contactName}`.slice(
        0,
        240,
      ),
      note: input.note ?? "",
      location: input.location ?? null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
      totalPriceCents,
      priceCurrency:
        totalPriceCents === null ? null : initial.line.priceCurrency,
    },
    actor,
    idempotency,
    async (transaction, movement) => {
      const [order] = await transaction
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, organizationId),
            eq(orders.id, orderId),
          ),
        )
        .limit(1)
        .for("update");
      const [line] = await transaction
        .select()
        .from(orderLines)
        .where(
          and(
            eq(orderLines.organizationId, organizationId),
            eq(orderLines.id, lineId),
            eq(orderLines.orderId, orderId),
          ),
        )
        .limit(1)
        .for("update");
      if (!order || !line) {
        throw new OrderOperationError("Order line not found.", 404);
      }
      assertOrderMovementAllowed(order, input.action);
      if (isReturn) {
        if (order.type !== "loan") {
          throw new OrderOperationError("Only loan orders can be returned.", 422);
        }
        const returnable = line.fulfilledQuantity - line.returnedQuantity;
        if (input.quantity > returnable) {
          throw new OrderOperationError(
            `Only ${returnable} issued units remain returnable on this line.`,
            409,
          );
        }
      } else {
        const open = line.orderedQuantity - line.fulfilledQuantity;
        if (input.quantity > open) {
          throw new OrderOperationError(
            `Only ${open} units remain open on this line.`,
            409,
          );
        }
      }

      await transaction
        .update(stockMovements)
        .set({ orderLineId: line.id })
        .where(eq(stockMovements.id, movement.id));
      await transaction
        .update(orderLines)
        .set({
          ...(isReturn
            ? { returnedQuantity: line.returnedQuantity + input.quantity }
            : { fulfilledQuantity: line.fulfilledQuantity + input.quantity }),
          updatedAt: new Date(),
        })
        .where(eq(orderLines.id, line.id));
      const currentLines = await transaction
        .select({
          orderedQuantity: orderLines.orderedQuantity,
          fulfilledQuantity: orderLines.fulfilledQuantity,
          returnedQuantity: orderLines.returnedQuantity,
        })
        .from(orderLines)
        .where(
          and(
            eq(orderLines.organizationId, organizationId),
            eq(orderLines.orderId, orderId),
          ),
        );
      const status = deriveOrderStatus(
        order.type,
        order.status,
        currentLines,
        order.expectedAt,
      );
      await transaction
        .update(orders)
        .set({ status, updatedAt: new Date() })
        .where(eq(orders.id, order.id));
    },
  );
  return {
    ...movementResult,
    order: await getOrder(organizationId, orderId),
  };
}
