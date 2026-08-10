import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceipts,
  resources,
  stockMovements,
  stockSettings,
  stockUnits,
  type PurchaseOrderRecord,
  type PurchaseOrderStatus,
  type PurchaseReceiptRecord,
  type StockMovementRecord,
  type StockTrackingMode,
  type StockUnitRecord,
} from "@/db/schema";
import { db } from "@/lib/db";

const MAX_STOCK_QUANTITY = 2_000_000_000;

export type PurchaseOrderLineInput = {
  resourceId: string;
  orderedQuantity: number;
  expectedAt?: Date | null;
  note?: string;
};

export type PurchaseOrderCreateInput = {
  reference?: string | null;
  supplier?: string;
  status?: "draft" | "ordered";
  orderedAt?: Date;
  expectedAt?: Date | null;
  note?: string;
  lines: PurchaseOrderLineInput[];
};

export type PurchaseOrderPatchInput = {
  reference?: string | null;
  supplier?: string;
  status?: "draft" | "ordered" | "cancelled";
  orderedAt?: Date;
  expectedAt?: Date | null;
  note?: string;
};

export type PurchaseReceiptInput = {
  quantity: number;
  occurredAt?: Date;
  location?: string | null;
  note?: string;
  unitCodes?: string[];
};

type IdempotencyInput = { key: string; requestHash: string };

export class PurchaseOrderOperationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "PurchaseOrderOperationError";
  }
}

export function purchaseOrderHttpError(error: unknown, fallback: string) {
  if (error instanceof PurchaseOrderOperationError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("stock_units_resource_code_unique")) {
    return {
      status: 409 as const,
      message: "A serialized unit with one of those codes already exists.",
    };
  }
  if (message.includes("purchase_order_lines_order_resource_unique")) {
    return {
      status: 409 as const,
      message: "Each inventory item may appear only once in a purchase order.",
    };
  }
  if (message.includes("purchase_receipts_idempotency_key_unique")) {
    return {
      status: 409 as const,
      message: "That Idempotency-Key was already used for another purchase receipt.",
    };
  }
  return { status: 500 as const, message: fallback };
}

const jsonRecord = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const unitDto = (row: StockUnitRecord) => ({
  id: row.id,
  resourceId: row.resourceId,
  code: row.code,
  status: row.status,
  location: row.location,
  metadata: row.metadata,
  acquiredAt: row.acquiredAt.toISOString(),
  lastMovedAt: row.lastMovedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const movementDto = (row: StockMovementRecord) => ({
  id: row.id,
  resourceId: row.resourceId,
  unitId: row.unitId,
  assemblyBuildId: row.assemblyBuildId,
  purchaseReceiptId: row.purchaseReceiptId,
  delta: row.delta,
  balanceAfter: row.balanceAfter,
  type: row.type,
  reason: row.reason,
  note: row.note,
  location: row.location,
  occurredAt: row.occurredAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
});

const receiptDto = (row: PurchaseReceiptRecord) => ({
  id: row.id,
  purchaseOrderLineId: row.purchaseOrderLineId,
  quantity: row.quantity,
  occurredAt: row.occurredAt.toISOString(),
  location: row.location,
  note: row.note,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

type OrderLineDtoInput = {
  id: string;
  purchaseOrderId: string;
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  expectedAt: Date | null;
  note: string;
  trackingMode: StockTrackingMode | null;
  createdAt: Date;
  updatedAt: Date;
};

const lineDto = (line: OrderLineDtoInput) => ({
  id: line.id,
  purchaseOrderId: line.purchaseOrderId,
  resourceId: line.resourceId,
  resourceName: line.resourceName,
  resourceSku: line.resourceSku,
  orderedQuantity: line.orderedQuantity,
  receivedQuantity: line.receivedQuantity,
  openQuantity: Math.max(0, line.orderedQuantity - line.receivedQuantity),
  expectedAt: line.expectedAt?.toISOString() ?? null,
  note: line.note,
  trackingMode: line.trackingMode ?? "bulk",
  createdAt: line.createdAt.toISOString(),
  updatedAt: line.updatedAt.toISOString(),
});

const orderDto = (order: PurchaseOrderRecord, rows: OrderLineDtoInput[]) => {
  const lines = rows.map(lineDto);
  return {
    id: order.id,
    reference: order.reference,
    supplier: order.supplier,
    status: order.status,
    orderedAt: order.orderedAt.toISOString(),
    expectedAt: order.expectedAt?.toISOString() ?? null,
    note: order.note,
    createdBy: order.createdBy,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    lines,
    totalOrdered: lines.reduce((total, line) => total + line.orderedQuantity, 0),
    totalReceived: lines.reduce((total, line) => total + line.receivedQuantity, 0),
    totalOpen: lines.reduce((total, line) => total + line.openQuantity, 0),
  };
};

const deriveStatus = (
  current: PurchaseOrderStatus,
  lines: Array<{ orderedQuantity: number; receivedQuantity: number }>,
): PurchaseOrderStatus => {
  if (current === "cancelled") return "cancelled";
  if (
    lines.length > 0 &&
    lines.every((line) => line.receivedQuantity >= line.orderedQuantity)
  ) {
    return "received";
  }
  if (lines.some((line) => line.receivedQuantity > 0)) {
    return "partially-received";
  }
  return current === "draft" ? "draft" : "ordered";
};

async function loadOrderLines(orderIds: string[]) {
  if (!orderIds.length) return [];
  return db
    .select({
      id: purchaseOrderLines.id,
      purchaseOrderId: purchaseOrderLines.purchaseOrderId,
      resourceId: purchaseOrderLines.resourceId,
      resourceName: resources.name,
      resourceSku: resources.sku,
      orderedQuantity: purchaseOrderLines.orderedQuantity,
      receivedQuantity: purchaseOrderLines.receivedQuantity,
      expectedAt: purchaseOrderLines.expectedAt,
      note: purchaseOrderLines.note,
      trackingMode: stockSettings.trackingMode,
      createdAt: purchaseOrderLines.createdAt,
      updatedAt: purchaseOrderLines.updatedAt,
    })
    .from(purchaseOrderLines)
    .innerJoin(resources, eq(resources.id, purchaseOrderLines.resourceId))
    .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
    .where(inArray(purchaseOrderLines.purchaseOrderId, orderIds))
    .orderBy(asc(purchaseOrderLines.createdAt), asc(purchaseOrderLines.id));
}

export async function listPurchaseOrders(
  options: { status?: PurchaseOrderStatus; limit?: number } = {},
) {
  const limit = Math.min(100, Math.max(1, options.limit ?? 100));
  const orders = options.status
    ? await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.status, options.status))
        .orderBy(desc(purchaseOrders.orderedAt), desc(purchaseOrders.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(purchaseOrders)
        .orderBy(desc(purchaseOrders.orderedAt), desc(purchaseOrders.createdAt))
        .limit(limit);
  const lineRows = await loadOrderLines(orders.map((order) => order.id));
  const linesByOrder = new Map<string, OrderLineDtoInput[]>();
  for (const line of lineRows) {
    const rows = linesByOrder.get(line.purchaseOrderId) ?? [];
    rows.push(line);
    linesByOrder.set(line.purchaseOrderId, rows);
  }
  return {
    orders: orders.map((order) =>
      orderDto(order, linesByOrder.get(order.id) ?? []),
    ),
  };
}

export async function getPurchaseOrder(id: string) {
  const [order] = await db
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .limit(1);
  if (!order) return null;
  const lineRows = await loadOrderLines([id]);
  return orderDto(order, lineRows);
}

export async function createPurchaseOrder(
  input: PurchaseOrderCreateInput,
  actor: string,
) {
  if (!input.lines.length) {
    throw new PurchaseOrderOperationError(
      "Add at least one line to the purchase order.",
      422,
    );
  }
  const resourceIds = input.lines.map((line) => line.resourceId);
  if (new Set(resourceIds).size !== resourceIds.length) {
    throw new PurchaseOrderOperationError(
      "Each inventory item may appear only once in a purchase order.",
      422,
    );
  }

  const orderId = await db.transaction(async (transaction) => {
    const existingResources = await transaction
      .select({ id: resources.id })
      .from(resources)
      .where(inArray(resources.id, [...resourceIds].sort()))
      .orderBy(asc(resources.id));
    if (existingResources.length !== resourceIds.length) {
      throw new PurchaseOrderOperationError(
        "One or more purchase order items no longer exist.",
        422,
      );
    }

    const [order] = await transaction
      .insert(purchaseOrders)
      .values({
        reference: input.reference || null,
        supplier: input.supplier ?? "",
        status: input.status ?? "ordered",
        orderedAt: input.orderedAt ?? new Date(),
        expectedAt: input.expectedAt ?? null,
        note: input.note ?? "",
        createdBy: actor,
      })
      .returning({ id: purchaseOrders.id });
    await transaction.insert(purchaseOrderLines).values(
      input.lines.map((line) => ({
        purchaseOrderId: order.id,
        resourceId: line.resourceId,
        orderedQuantity: line.orderedQuantity,
        expectedAt:
          line.expectedAt === undefined
            ? input.expectedAt ?? null
            : line.expectedAt,
        note: line.note ?? "",
      })),
    );
    return order.id;
  });

  const order = await getPurchaseOrder(orderId);
  if (!order) {
    throw new PurchaseOrderOperationError(
      "The purchase order could not be loaded after creation.",
      409,
    );
  }
  return order;
}

export async function updatePurchaseOrder(
  id: string,
  patch: PurchaseOrderPatchInput,
) {
  const found = await db.transaction(async (transaction) => {
    const [order] = await transaction
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .limit(1)
      .for("update");
    if (!order) return false;

    const lines = await transaction
      .select({
        orderedQuantity: purchaseOrderLines.orderedQuantity,
        receivedQuantity: purchaseOrderLines.receivedQuantity,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, id));
    if (order.status === "received" && patch.status !== undefined) {
      throw new PurchaseOrderOperationError(
        "A fully received purchase order cannot be reopened or cancelled without reversing its receipts.",
        409,
      );
    }
    const requestedStatus = patch.status ?? order.status;
    const nextStatus =
      requestedStatus === "cancelled"
        ? "cancelled"
        : deriveStatus(requestedStatus, lines);
    await transaction
      .update(purchaseOrders)
      .set({
        ...(patch.reference !== undefined ? { reference: patch.reference || null } : {}),
        ...(patch.supplier !== undefined ? { supplier: patch.supplier } : {}),
        ...(patch.orderedAt !== undefined ? { orderedAt: patch.orderedAt } : {}),
        ...(patch.expectedAt !== undefined ? { expectedAt: patch.expectedAt } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, id));
    return true;
  });
  return found ? getPurchaseOrder(id) : null;
}

export async function receivePurchaseOrderLine(
  purchaseOrderId: string,
  lineId: string,
  input: PurchaseReceiptInput,
  actor: string,
  idempotency: IdempotencyInput,
) {
  const validateReplay = (existing: PurchaseReceiptRecord) => {
    const storedOrder = existing.response.order;
    const storedOrderId =
      storedOrder && typeof storedOrder === "object" && "id" in storedOrder
        ? (storedOrder as { id?: unknown }).id
        : null;
    if (
      existing.purchaseOrderLineId !== lineId ||
      existing.createdBy !== actor ||
      existing.requestHash !== idempotency.requestHash ||
      storedOrderId !== purchaseOrderId
    ) {
      throw new PurchaseOrderOperationError(
        "That Idempotency-Key was already used for another order line, actor, or payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  };

  const [existing] = await db
    .select()
    .from(purchaseReceipts)
    .where(eq(purchaseReceipts.idempotencyKey, idempotency.key))
    .limit(1);
  if (existing) return validateReplay(existing);

  try {
    return await db.transaction(async (transaction) => {
      const [initialLine] = await transaction
        .select({
          id: purchaseOrderLines.id,
          purchaseOrderId: purchaseOrderLines.purchaseOrderId,
          resourceId: purchaseOrderLines.resourceId,
        })
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.id, lineId),
            eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
          ),
        )
        .limit(1);
      if (!initialLine) {
        throw new PurchaseOrderOperationError("Purchase order line not found.", 404);
      }

      const [order] = await transaction
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, purchaseOrderId))
        .limit(1)
        .for("update");
      if (!order) throw new PurchaseOrderOperationError("Not found", 404);
      const [resource] = await transaction
        .select()
        .from(resources)
        .where(eq(resources.id, initialLine.resourceId))
        .limit(1)
        .for("update");
      if (!resource) {
        throw new PurchaseOrderOperationError(
          "The inventory item for this order line no longer exists.",
          409,
        );
      }
      const [line] = await transaction
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.id, lineId),
            eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
          ),
        )
        .limit(1)
        .for("update");
      if (!line) {
        throw new PurchaseOrderOperationError("Purchase order line not found.", 404);
      }

      const [replayAfterLock] = await transaction
        .select()
        .from(purchaseReceipts)
        .where(eq(purchaseReceipts.idempotencyKey, idempotency.key))
        .limit(1);
      if (replayAfterLock) return validateReplay(replayAfterLock);

      if (order.status === "draft") {
        throw new PurchaseOrderOperationError(
          "Mark this draft purchase order as ordered before receiving it.",
          409,
        );
      }
      if (order.status === "cancelled") {
        throw new PurchaseOrderOperationError(
          "A cancelled purchase order cannot receive stock.",
          409,
        );
      }
      if (line.receivedQuantity + input.quantity > line.orderedQuantity) {
        throw new PurchaseOrderOperationError(
          `This receipt exceeds the ${line.orderedQuantity - line.receivedQuantity} units still open on the line.`,
          409,
        );
      }
      if (resource.quantity + input.quantity > MAX_STOCK_QUANTITY) {
        throw new PurchaseOrderOperationError(
          `This receipt would exceed the maximum supported stock of ${MAX_STOCK_QUANTITY}.`,
          409,
        );
      }

      const [settings] = await transaction
        .select({ trackingMode: stockSettings.trackingMode })
        .from(stockSettings)
        .where(eq(stockSettings.resourceId, resource.id))
        .limit(1);
      const mode = settings?.trackingMode ?? "bulk";
      if (mode === "bulk" && input.unitCodes?.length) {
        throw new PurchaseOrderOperationError(
          "Unit codes can only be supplied for serialized inventory items.",
          422,
        );
      }
      if (
        mode === "serialized" &&
        input.unitCodes &&
        (input.unitCodes.length !== input.quantity ||
          new Set(input.unitCodes).size !== input.unitCodes.length)
      ) {
        throw new PurchaseOrderOperationError(
          "Provide one unique unit code for every received serialized unit.",
          422,
        );
      }

      const occurredAt = input.occurredAt ?? new Date();
      const now = new Date();
      const location = input.location ?? resource.location;
      const [receipt] = await transaction
        .insert(purchaseReceipts)
        .values({
          purchaseOrderLineId: line.id,
          quantity: input.quantity,
          occurredAt,
          location,
          note: input.note ?? "",
          idempotencyKey: idempotency.key,
          requestHash: idempotency.requestHash,
          response: {},
          createdBy: actor,
        })
        .returning();

      let units: StockUnitRecord[] = [];
      if (mode === "serialized") {
        const codes =
          input.unitCodes ??
          Array.from({ length: input.quantity }, () =>
            `PO-${purchaseOrderId.slice(0, 8).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          );
        units = await transaction
          .insert(stockUnits)
          .values(
            codes.map((code) => ({
              resourceId: resource.id,
              code,
              status: "available" as const,
              location,
              metadata: { purchaseReceiptId: receipt.id },
              acquiredAt: occurredAt,
              lastMovedAt: occurredAt,
            })),
          )
          .returning();
      }

      const balanceAfter = resource.quantity + input.quantity;
      await transaction
        .update(resources)
        .set({ quantity: balanceAfter, updatedAt: now })
        .where(eq(resources.id, resource.id));
      let movements: StockMovementRecord[];
      if (units.length) {
        movements = await transaction
          .insert(stockMovements)
          .values(
            units.map((unit, index) => ({
              resourceId: resource.id,
              unitId: unit.id,
              purchaseReceiptId: receipt.id,
              delta: 1,
              balanceAfter: resource.quantity + index + 1,
              type: "purchase-receipt",
              reason: order.reference
                ? `Received purchase order ${order.reference}`
                : "Received purchase order",
              note: input.note ?? "",
              location,
              occurredAt,
              createdBy: actor,
            })),
          )
          .returning();
      } else {
        const [movement] = await transaction
          .insert(stockMovements)
          .values({
            resourceId: resource.id,
            purchaseReceiptId: receipt.id,
            delta: input.quantity,
            balanceAfter,
            type: "purchase-receipt",
            reason: order.reference
              ? `Received purchase order ${order.reference}`
              : "Received purchase order",
            note: input.note ?? "",
            location,
            occurredAt,
            createdBy: actor,
          })
          .returning();
        movements = [movement];
      }

      const receivedQuantity = line.receivedQuantity + input.quantity;
      await transaction
        .update(purchaseOrderLines)
        .set({ receivedQuantity, updatedAt: now })
        .where(eq(purchaseOrderLines.id, line.id));

      const rawLines = await transaction
        .select({
          id: purchaseOrderLines.id,
          purchaseOrderId: purchaseOrderLines.purchaseOrderId,
          resourceId: purchaseOrderLines.resourceId,
          resourceName: resources.name,
          resourceSku: resources.sku,
          orderedQuantity: purchaseOrderLines.orderedQuantity,
          receivedQuantity: purchaseOrderLines.receivedQuantity,
          expectedAt: purchaseOrderLines.expectedAt,
          note: purchaseOrderLines.note,
          trackingMode: stockSettings.trackingMode,
          createdAt: purchaseOrderLines.createdAt,
          updatedAt: purchaseOrderLines.updatedAt,
        })
        .from(purchaseOrderLines)
        .innerJoin(resources, eq(resources.id, purchaseOrderLines.resourceId))
        .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
        .where(eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId))
        .orderBy(asc(purchaseOrderLines.createdAt), asc(purchaseOrderLines.id));
      const nextStatus = deriveStatus(order.status, rawLines);
      const [savedOrder] = await transaction
        .update(purchaseOrders)
        .set({ status: nextStatus, updatedAt: now })
        .where(eq(purchaseOrders.id, order.id))
        .returning();
      const savedOrderDto = orderDto(savedOrder, rawLines);
      const savedLineDto = savedOrderDto.lines.find(
        (candidate) => candidate.id === line.id,
      );
      if (!savedLineDto) {
        throw new PurchaseOrderOperationError(
          "The received line could not be reloaded.",
          409,
        );
      }
      const response = {
        receipt: receiptDto(receipt),
        order: savedOrderDto,
        line: savedLineDto,
        resource: {
          id: resource.id,
          name: resource.name,
          quantity: balanceAfter,
          trackingMode: mode,
        },
        units: units.map(unitDto),
        movements: movements.map(movementDto),
      };
      const storedResponse = jsonRecord(response);
      await transaction
        .update(purchaseReceipts)
        .set({ response: storedResponse })
        .where(eq(purchaseReceipts.id, receipt.id));
      return { response: storedResponse, replayed: false } as const;
    });
  } catch (error) {
    const [winner] = await db
      .select()
      .from(purchaseReceipts)
      .where(eq(purchaseReceipts.idempotencyKey, idempotency.key))
      .limit(1);
    if (winner) return validateReplay(winner);
    throw error;
  }
}
