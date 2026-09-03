import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  assemblyBuildComponents,
  contacts,
  inventoryAssignments,
  orderLineUnits,
  orderLines,
  orders,
  resources,
  stockMovements,
  stockSettings,
  stockUnits,
  type OrderRecord,
  type OrderLineUnitStatus,
  type OrderStatus,
  type OrderType,
  type StockTrackingMode,
  type StockUnitStatus,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  defaultOrderStatus,
  deriveOrderStatus,
  isOrderStatusForType,
  requiredContactRole,
  type OrderCreateRequest,
  type OrderLineMovementRequest,
  type OrderLineUnitActionRequest,
  type OrderPatchRequest,
} from "@/lib/order-contract";
import {
  addInboundStockCost,
  consumeStockCost,
} from "@/lib/stock-costing";
import {
  bookStockMovement,
  StockOperationError,
} from "@/lib/stock";
import { enqueueStockMovementWebhookEvents } from "@/lib/webhooks";

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
    const returnStatuses =
      order.type === "sale"
        ? ["partially-fulfilled", "fulfilled", "partially-returned", "returned"]
        : [
            "partially-issued",
            "issued",
            "partially-returned",
            "overdue",
            "returned",
          ];
    if (!returnStatuses.includes(order.status)) {
      throw new OrderOperationError(
        "This order is not currently awaiting a return.",
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
  units: OrderLineUnitDtoInput[];
};

type OrderLineUnitDtoInput = {
  id: string;
  orderLineId: string;
  stockUnitId: string;
  code: string;
  status: OrderLineUnitStatus;
  stockStatus: StockUnitStatus;
  reservedAt: Date;
  fulfilledAt: Date | null;
  returnedAt: Date | null;
};

const orderLineUnitDto = (unit: OrderLineUnitDtoInput) => ({
  id: unit.id,
  stockUnitId: unit.stockUnitId,
  code: unit.code,
  status: unit.status,
  stockStatus: unit.stockStatus,
  reservedAt: unit.reservedAt.toISOString(),
  fulfilledAt: unit.fulfilledAt?.toISOString() ?? null,
  returnedAt: unit.returnedAt?.toISOString() ?? null,
});

const lineDto = (line: OrderLineDtoInput) => {
  const units = line.units.map(orderLineUnitDto);
  const reservedQuantity = units.filter(
    (unit) => unit.status === "reserved",
  ).length;
  return {
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
    reservedQuantity,
    openReservationQuantity: Math.max(
      0,
      line.orderedQuantity - line.fulfilledQuantity - reservedQuantity,
    ),
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
    units,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
};

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
    totalReserved: lines.reduce(
      (total, line) => total + line.reservedQuantity,
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
  const rows = await database
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
  if (!rows.length) return [];
  const unitRows = await database
    .select({
      id: orderLineUnits.id,
      orderLineId: orderLineUnits.orderLineId,
      stockUnitId: orderLineUnits.stockUnitId,
      code: stockUnits.code,
      status: orderLineUnits.status,
      stockStatus: stockUnits.status,
      reservedAt: orderLineUnits.reservedAt,
      fulfilledAt: orderLineUnits.fulfilledAt,
      returnedAt: orderLineUnits.returnedAt,
    })
    .from(orderLineUnits)
    .innerJoin(
      stockUnits,
      and(
        eq(stockUnits.organizationId, organizationId),
        eq(stockUnits.id, orderLineUnits.stockUnitId),
      ),
    )
    .where(
      and(
        eq(orderLineUnits.organizationId, organizationId),
        inArray(
          orderLineUnits.orderLineId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(asc(orderLineUnits.reservedAt), asc(stockUnits.code));
  const unitsByLine = new Map<string, OrderLineUnitDtoInput[]>();
  for (const unit of unitRows) {
    const current = unitsByLine.get(unit.orderLineId) ?? [];
    current.push(unit);
    unitsByLine.set(unit.orderLineId, current);
  }
  return rows.map((row) => ({
    ...row,
    units: unitsByLine.get(row.id) ?? [],
  }));
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
    if (patch.status === "cancelled") {
      const [reservedUnit] = await transaction
        .select({ id: orderLineUnits.id })
        .from(orderLineUnits)
        .innerJoin(
          orderLines,
          and(
            eq(orderLines.organizationId, organizationId),
            eq(orderLines.id, orderLineUnits.orderLineId),
          ),
        )
        .where(
          and(
            eq(orderLineUnits.organizationId, organizationId),
            eq(orderLines.orderId, orderId),
            eq(orderLineUnits.status, "reserved"),
          ),
        )
        .limit(1);
      if (reservedUnit) {
        throw new OrderOperationError(
          "Release reserved serialized units before cancelling this order.",
          409,
        );
      }
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

async function loadSerializedLineContext(
  organizationId: string,
  orderId: string,
  lineId: string,
) {
  const [context] = await db
    .select({
      order: orders,
      line: orderLines,
      resourceName: resources.name,
      trackingMode: stockSettings.trackingMode,
    })
    .from(orderLines)
    .innerJoin(
      orders,
      and(
        eq(orders.organizationId, organizationId),
        eq(orders.id, orderLines.orderId),
      ),
    )
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
        eq(stockSettings.resourceId, orderLines.resourceId),
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
  if (!context) throw new OrderOperationError("Order line not found.", 404);
  if (context.order.type === "purchase") {
    throw new OrderOperationError(
      "Serialized fulfillment is available for sales and loans.",
      422,
    );
  }
  if ((context.trackingMode ?? "bulk") !== "serialized") {
    throw new OrderOperationError(
      "This order line does not use serialized stock tracking.",
      422,
    );
  }
  return context;
}

export async function listOrderLineUnits(
  organizationId: string,
  orderId: string,
  lineId: string,
) {
  const context = await loadSerializedLineContext(
    organizationId,
    orderId,
    lineId,
  );
  return db.transaction(async (transaction) => {
    const assignments = await transaction
      .select({
        id: orderLineUnits.id,
        orderLineId: orderLineUnits.orderLineId,
        stockUnitId: orderLineUnits.stockUnitId,
        code: stockUnits.code,
        status: orderLineUnits.status,
        stockStatus: stockUnits.status,
        reservedAt: orderLineUnits.reservedAt,
        fulfilledAt: orderLineUnits.fulfilledAt,
        returnedAt: orderLineUnits.returnedAt,
      })
      .from(orderLineUnits)
      .innerJoin(
        stockUnits,
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.id, orderLineUnits.stockUnitId),
        ),
      )
      .where(
        and(
          eq(orderLineUnits.organizationId, organizationId),
          eq(orderLineUnits.orderLineId, lineId),
        ),
      )
      .orderBy(asc(orderLineUnits.reservedAt), asc(stockUnits.code));
    const activeLinks = await transaction
      .select({ stockUnitId: orderLineUnits.stockUnitId })
      .from(orderLineUnits)
      .innerJoin(
        stockUnits,
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.id, orderLineUnits.stockUnitId),
          eq(stockUnits.resourceId, context.line.resourceId),
        ),
      )
      .where(
        and(
          eq(orderLineUnits.organizationId, organizationId),
          inArray(orderLineUnits.status, ["reserved", "fulfilled"]),
        ),
      );
    const unavailableIds = new Set(activeLinks.map((row) => row.stockUnitId));
    const currentLineIds = new Set(assignments.map((row) => row.stockUnitId));
    const availableRows = await transaction
      .select({
        id: stockUnits.id,
        code: stockUnits.code,
        status: stockUnits.status,
        location: stockUnits.location,
      })
      .from(stockUnits)
      .where(
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.resourceId, context.line.resourceId),
          eq(stockUnits.status, "available"),
        ),
      )
      .orderBy(asc(stockUnits.code));
    return {
      line: {
        id: context.line.id,
        resourceId: context.line.resourceId,
        resourceName: context.resourceName,
        quantity: context.line.orderedQuantity,
        fulfilledQuantity: context.line.fulfilledQuantity,
        returnedQuantity: context.line.returnedQuantity,
      },
      availableUnits: availableRows.filter(
        (unit) =>
          !unavailableIds.has(unit.id) && !currentLineIds.has(unit.id),
      ),
      assignments: assignments.map(orderLineUnitDto),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

function assertSerializedActionAllowed(
  order: Pick<OrderRecord, "type" | "status">,
  action: OrderLineUnitActionRequest["action"],
) {
  if (action === "issue" || action === "return") {
    assertOrderMovementAllowed(order, action);
    return;
  }
  if (order.status === "cancelled" || order.status === "draft") {
    throw new OrderOperationError(
      "Confirm or reserve this order before assigning serialized units.",
      409,
    );
  }
  const reservable =
    order.type === "sale"
      ? ["confirmed", "partially-fulfilled"]
      : ["reserved", "partially-issued"];
  if (!reservable.includes(order.status)) {
    throw new OrderOperationError(
      "This order is not currently available for unit reservations.",
      409,
    );
  }
}

export async function executeOrderLineUnitAction(
  organizationId: string,
  orderId: string,
  lineId: string,
  input: OrderLineUnitActionRequest,
  actor: string,
) {
  const initial = await loadSerializedLineContext(
    organizationId,
    orderId,
    lineId,
  );
  assertSerializedActionAllowed(initial.order, input.action);
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const unitIds = [...input.unitIds].sort();

  const outcome = await db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({
        id: resources.id,
        name: resources.name,
        quantity: resources.quantity,
        valueCents: resources.valueCents,
        currency: resources.currency,
      })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, initial.line.resourceId),
        ),
      )
      .limit(1)
      .for("update");
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
    if (!resource || !order || !line) {
      throw new OrderOperationError("Order line not found.", 404);
    }
    if (order.type === "purchase") {
      throw new OrderOperationError(
        "Serialized fulfillment is available for sales and loans.",
        422,
      );
    }
    assertSerializedActionAllowed(order, input.action);
    const [settings] = await transaction
      .select({ trackingMode: stockSettings.trackingMode })
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resource.id),
        ),
      )
      .limit(1);
    if ((settings?.trackingMode ?? "bulk") !== "serialized") {
      throw new OrderOperationError(
        "This order line no longer uses serialized stock tracking.",
        409,
      );
    }
    const units = await transaction
      .select()
      .from(stockUnits)
      .where(
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.resourceId, line.resourceId),
          inArray(stockUnits.id, unitIds),
        ),
      )
      .orderBy(asc(stockUnits.id))
      .for("update");
    if (units.length !== unitIds.length) {
      throw new OrderOperationError(
        "One or more serialized units do not belong to this order line.",
        422,
      );
    }
    const links = await transaction
      .select()
      .from(orderLineUnits)
      .where(
        and(
          eq(orderLineUnits.organizationId, organizationId),
          eq(orderLineUnits.orderLineId, lineId),
          inArray(orderLineUnits.stockUnitId, unitIds),
        ),
      )
      .orderBy(asc(orderLineUnits.stockUnitId))
      .for("update");
    const activeLinks = await transaction
      .select()
      .from(orderLineUnits)
      .where(
        and(
          eq(orderLineUnits.organizationId, organizationId),
          inArray(orderLineUnits.stockUnitId, unitIds),
          inArray(orderLineUnits.status, ["reserved", "fulfilled"]),
        ),
      )
      .orderBy(asc(orderLineUnits.stockUnitId))
      .for("update");
    const linksByUnit = new Map(links.map((link) => [link.stockUnitId, link]));
    const conflict = activeLinks.find((link) => link.orderLineId !== lineId);
    if (conflict) {
      throw new OrderOperationError(
        "One of these serialized units is already assigned to another order.",
        409,
      );
    }

    const changes: Array<{
      unit: (typeof units)[number];
      link: (typeof links)[number] | null;
      nextStockStatus: StockUnitStatus;
      delta: -1 | 0 | 1;
    }> = [];
    for (const unit of units) {
      const link = linksByUnit.get(unit.id);
      if (input.action === "reserve") {
        if (link?.status === "reserved") continue;
        if (link) {
          throw new OrderOperationError(
            `Unit ${unit.code} already has a completed lifecycle on this line.`,
            409,
          );
        }
        if (unit.status !== "available") {
          throw new OrderOperationError(
            `Unit ${unit.code} is ${unit.status} and cannot be reserved.`,
            409,
          );
        }
        changes.push({
          unit,
          link: null,
          nextStockStatus: "reserved",
          delta: -1,
        });
        continue;
      }
      if (input.action === "release") {
        if (!link && unit.status === "available") continue;
        if (!link || link.status !== "reserved") {
          throw new OrderOperationError(
            `Unit ${unit.code} is not reserved on this order line.`,
            409,
          );
        }
        if (unit.status !== "reserved") {
          throw new OrderOperationError(
            `Unit ${unit.code} is ${unit.status}; resolve its stock state before releasing it.`,
            409,
          );
        }
        changes.push({
          unit,
          link,
          nextStockStatus: "available",
          delta: 1,
        });
        continue;
      }
      if (input.action === "issue") {
        if (link?.status === "fulfilled") continue;
        if (link?.status === "returned") {
          throw new OrderOperationError(
            `Unit ${unit.code} was already returned on this order line.`,
            409,
          );
        }
        const expectedStatus = link?.status === "reserved" ? "reserved" : "available";
        if (unit.status !== expectedStatus) {
          throw new OrderOperationError(
            `Unit ${unit.code} is ${unit.status} and cannot be issued.`,
            409,
          );
        }
        changes.push({
          unit,
          link: link ?? null,
          nextStockStatus: order.type === "sale" ? "consumed" : "in-use",
          delta: unit.status === "available" ? -1 : 0,
        });
        continue;
      }
      if (link?.status === "returned") continue;
      if (!link || link.status !== "fulfilled") {
        throw new OrderOperationError(
          `Unit ${unit.code} was not fulfilled on this order line.`,
          409,
        );
      }
      const expectedStatus = order.type === "sale" ? "consumed" : "in-use";
      if (unit.status !== expectedStatus) {
        throw new OrderOperationError(
          `Unit ${unit.code} is ${unit.status}; resolve its stock state before returning it.`,
          409,
        );
      }
      changes.push({
        unit,
        link,
        nextStockStatus: "available",
        delta: 1,
      });
    }

    const reservedRows = await transaction
      .select({ id: orderLineUnits.id })
      .from(orderLineUnits)
      .where(
        and(
          eq(orderLineUnits.organizationId, organizationId),
          eq(orderLineUnits.orderLineId, lineId),
          eq(orderLineUnits.status, "reserved"),
        ),
      );
    const reservedCount = reservedRows.length;
    if (
      input.action === "reserve" &&
      changes.length >
        line.orderedQuantity - line.fulfilledQuantity - reservedCount
    ) {
      throw new OrderOperationError(
        "These reservations would exceed the open quantity on this line.",
        409,
      );
    }
    if (input.action === "issue") {
      const reservationsBeingIssued = changes.filter(
        (change) => change.link?.status === "reserved",
      ).length;
      const reservationsRemaining = reservedCount - reservationsBeingIssued;
      if (
        changes.length >
        line.orderedQuantity - line.fulfilledQuantity - reservationsRemaining
      ) {
        throw new OrderOperationError(
          "These units would exceed the unreserved quantity on this line.",
          409,
        );
      }
    }
    if (
      input.action === "return" &&
      changes.length > line.fulfilledQuantity - line.returnedQuantity
    ) {
      throw new OrderOperationError(
        "These units exceed the returnable quantity on this line.",
        409,
      );
    }
    if (!changes.length) return { changed: 0, movementIds: [] as string[] };

    const changingUnitIds = changes.map((change) => change.unit.id);
    const [activeAssignment, installation] = await Promise.all([
      transaction
        .select({ id: inventoryAssignments.id })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            inArray(inventoryAssignments.stockUnitId, changingUnitIds),
            eq(inventoryAssignments.status, "active"),
          ),
        )
        .limit(1),
      transaction
        .select({ id: assemblyBuildComponents.id })
        .from(assemblyBuildComponents)
        .where(
          and(
            eq(assemblyBuildComponents.organizationId, organizationId),
            inArray(assemblyBuildComponents.componentUnitId, changingUnitIds),
          ),
        )
        .limit(1),
    ]);
    if (activeAssignment.length) {
      throw new OrderOperationError(
        "One of these units has an active inventory assignment.",
        409,
      );
    }
    if (installation.length) {
      throw new OrderOperationError(
        "One of these units is installed in an assembly.",
        409,
      );
    }

    const totalDelta = changes.reduce((sum, change) => sum + change.delta, 0);
    const finalBalance = resource.quantity + totalDelta;
    if (finalBalance < 0) {
      throw new OrderOperationError(
        "This serialized action would make available stock negative.",
        409,
      );
    }
    let runningBalance = resource.quantity;
    const movementIds: string[] = [];
    for (const change of changes) {
      const quantityBefore = runningBalance;
      runningBalance += change.delta;
      await transaction
        .update(stockUnits)
        .set({
          status: change.nextStockStatus,
          lastMovedAt: occurredAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.id, change.unit.id),
          ),
        );
      if (input.action === "reserve") {
        await transaction.insert(orderLineUnits).values({
          organizationId,
          orderLineId: lineId,
          stockUnitId: change.unit.id,
          status: "reserved",
          reservedAt: occurredAt,
          createdBy: actor,
          updatedBy: actor,
        });
      } else if (input.action === "release") {
        await transaction
          .delete(orderLineUnits)
          .where(
            and(
              eq(orderLineUnits.organizationId, organizationId),
              eq(orderLineUnits.id, change.link!.id),
            ),
          );
      } else if (input.action === "issue") {
        if (change.link) {
          await transaction
            .update(orderLineUnits)
            .set({
              status: "fulfilled",
              fulfilledAt: occurredAt,
              updatedBy: actor,
              updatedAt: new Date(),
            })
            .where(eq(orderLineUnits.id, change.link.id));
        } else {
          await transaction.insert(orderLineUnits).values({
            organizationId,
            orderLineId: lineId,
            stockUnitId: change.unit.id,
            status: "fulfilled",
            reservedAt: occurredAt,
            fulfilledAt: occurredAt,
            createdBy: actor,
            updatedBy: actor,
          });
        }
      } else {
        await transaction
          .update(orderLineUnits)
          .set({
            status: "returned",
            returnedAt: occurredAt,
            updatedBy: actor,
            updatedAt: new Date(),
          })
          .where(eq(orderLineUnits.id, change.link!.id));
      }
      const movementType =
        input.action === "reserve"
          ? "order-unit-reservation"
          : input.action === "release"
            ? "order-unit-release"
            : input.action;
      const [movement] = await transaction
        .insert(stockMovements)
        .values({
          organizationId,
          resourceId: resource.id,
          unitId: change.unit.id,
          orderLineId: line.id,
          contactId: order.contactId,
          delta: change.delta,
          quantity: 1,
          totalPriceCents:
            input.action === "issue" && order.type === "sale" && line.unitPriceCents !== null
              ? -line.unitPriceCents
              : null,
          priceCurrency:
            input.action === "issue" && order.type === "sale" && line.unitPriceCents !== null
              ? line.priceCurrency
              : null,
          balanceAfter: runningBalance,
          type: movementType,
          reason: `${input.action} ${change.unit.code} for ${order.reference ?? order.contactName}`.slice(0, 240),
          note: input.note ?? "",
          location: change.unit.location,
          fromLocationResourceId: change.delta < 0 ? change.unit.locationResourceId : null,
          toLocationResourceId: change.delta > 0 ? change.unit.locationResourceId : null,
          occurredAt,
          createdBy: actor,
        })
        .returning();
      movementIds.push(movement.id);
      if (change.delta < 0) {
        await consumeStockCost(transaction, {
          organizationId,
          resourceId: resource.id,
          movementId: movement.id,
          unitId: change.unit.id,
          quantity: 1,
          quantityBefore,
          fallbackUnitCostCents:
            change.unit.acquisitionCostCents ?? resource.valueCents,
          currency: resource.currency,
          occurredAt,
        });
      } else if (change.delta > 0) {
        await addInboundStockCost(transaction, {
          organizationId,
          resourceId: resource.id,
          movementId: movement.id,
          unitId: change.unit.id,
          quantity: 1,
          fallbackUnitCostCents:
            change.unit.acquisitionCostCents ?? resource.valueCents,
          currency: resource.currency,
          occurredAt,
          estimated: true,
        });
      }
    }
    await transaction
      .update(resources)
      .set({ quantity: finalBalance, updatedAt: new Date() })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resource.id),
        ),
      );
    if (input.action === "issue" || input.action === "return") {
      await transaction
        .update(orderLines)
        .set({
          ...(input.action === "issue"
            ? { fulfilledQuantity: line.fulfilledQuantity + changes.length }
            : { returnedQuantity: line.returnedQuantity + changes.length }),
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
    }
    const movementRows = await transaction
      .select()
      .from(stockMovements)
      .where(inArray(stockMovements.id, movementIds));
    await enqueueStockMovementWebhookEvents(transaction, movementRows);
    return { changed: changes.length, movementIds };
  });

  return {
    ...outcome,
    order: await getOrder(organizationId, orderId),
    units: await listOrderLineUnits(organizationId, orderId, lineId),
  };
}
