import "server-only";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  orderLines,
  orderLineUnits,
  orders,
  orderShipmentEvents,
  orderShipmentLines,
  orderShipments,
  orderShipmentUnits,
  resources,
  stockSettings,
  stockUnits,
  type ShipmentStatus,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  canTransitionShipment,
  defaultTrackingUrl,
  type ShipmentCreateRequest,
  type ShipmentPatchRequest,
} from "@/lib/shipment-contract";

type IdempotencyInput = { key: string; requestHash: string };

export class ShipmentOperationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "ShipmentOperationError";
  }
}

export function shipmentHttpError(error: unknown, fallback: string) {
  if (error instanceof ShipmentOperationError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("order_shipments_idempotency_key_unique") ||
    message.includes("order_shipments_tracking_unique")
  ) {
    return {
      status: 409 as const,
      message: message.includes("tracking")
        ? "This carrier and tracking number are already assigned to a shipment."
        : "That Idempotency-Key was already used for another shipment.",
    };
  }
  return { status: 500 as const, message: fallback };
}

export type ShipmentUnitDto = {
  orderLineUnitId: string;
  stockUnitId: string;
  code: string;
};

export type ShipmentLineDto = {
  id: string;
  orderLineId: string;
  resourceId: string;
  resourceName: string;
  quantity: number;
  units: ShipmentUnitDto[];
};

export type ShipmentEventDto = {
  id: string;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  note: string;
  actor: string | null;
  occurredAt: string;
};

export type ShipmentDto = {
  id: string;
  orderId: string;
  carrierCode: string;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  shippedAt: string | null;
  deliveredAt: string | null;
  note: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  lines: ShipmentLineDto[];
  events: ShipmentEventDto[];
  totalQuantity: number;
};

type ShipmentReader = Pick<typeof db, "select">;

export async function loadShipmentsForOrders(
  organizationId: string,
  orderIds: string[],
  database: ShipmentReader = db,
) {
  const result = new Map<string, ShipmentDto[]>();
  if (!orderIds.length) return result;

  const shipmentRows = await database
    .select()
    .from(orderShipments)
    .where(
      and(
        eq(orderShipments.organizationId, organizationId),
        inArray(orderShipments.orderId, orderIds),
      ),
    )
    .orderBy(desc(orderShipments.createdAt), desc(orderShipments.id));
  if (!shipmentRows.length) return result;

  const shipmentIds = shipmentRows.map((shipment) => shipment.id);
  const lineRows = await database
    .select({
      id: orderShipmentLines.id,
      shipmentId: orderShipmentLines.shipmentId,
      orderLineId: orderShipmentLines.orderLineId,
      resourceId: orderLines.resourceId,
      resourceName: resources.name,
      quantity: orderShipmentLines.quantity,
    })
    .from(orderShipmentLines)
    .innerJoin(
      orderLines,
      and(
        eq(orderLines.organizationId, organizationId),
        eq(orderLines.id, orderShipmentLines.orderLineId),
      ),
    )
    .innerJoin(
      resources,
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, orderLines.resourceId),
      ),
    )
    .where(
      and(
        eq(orderShipmentLines.organizationId, organizationId),
        inArray(orderShipmentLines.shipmentId, shipmentIds),
      ),
    )
    .orderBy(asc(orderShipmentLines.createdAt), asc(orderShipmentLines.id));
  const shipmentLineIds = lineRows.map((line) => line.id);
  const unitRows = shipmentLineIds.length
    ? await database
        .select({
          shipmentLineId: orderShipmentUnits.shipmentLineId,
          orderLineUnitId: orderShipmentUnits.orderLineUnitId,
          stockUnitId: orderLineUnits.stockUnitId,
          code: stockUnits.code,
        })
        .from(orderShipmentUnits)
        .innerJoin(
          orderLineUnits,
          and(
            eq(orderLineUnits.organizationId, organizationId),
            eq(orderLineUnits.id, orderShipmentUnits.orderLineUnitId),
          ),
        )
        .innerJoin(
          stockUnits,
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.id, orderLineUnits.stockUnitId),
          ),
        )
        .where(
          and(
            eq(orderShipmentUnits.organizationId, organizationId),
            inArray(orderShipmentUnits.shipmentLineId, shipmentLineIds),
          ),
        )
        .orderBy(asc(stockUnits.code))
    : [];
  const eventRows = await database
    .select()
    .from(orderShipmentEvents)
    .where(
      and(
        eq(orderShipmentEvents.organizationId, organizationId),
        inArray(orderShipmentEvents.shipmentId, shipmentIds),
      ),
    )
    .orderBy(asc(orderShipmentEvents.occurredAt), asc(orderShipmentEvents.id));

  const unitsByLine = new Map<string, ShipmentUnitDto[]>();
  for (const unit of unitRows) {
    const current = unitsByLine.get(unit.shipmentLineId) ?? [];
    current.push({
      orderLineUnitId: unit.orderLineUnitId,
      stockUnitId: unit.stockUnitId,
      code: unit.code,
    });
    unitsByLine.set(unit.shipmentLineId, current);
  }
  const linesByShipment = new Map<string, ShipmentLineDto[]>();
  for (const line of lineRows) {
    const current = linesByShipment.get(line.shipmentId) ?? [];
    current.push({
      id: line.id,
      orderLineId: line.orderLineId,
      resourceId: line.resourceId,
      resourceName: line.resourceName,
      quantity: line.quantity,
      units: unitsByLine.get(line.id) ?? [],
    });
    linesByShipment.set(line.shipmentId, current);
  }
  const eventsByShipment = new Map<string, ShipmentEventDto[]>();
  for (const event of eventRows) {
    const current = eventsByShipment.get(event.shipmentId) ?? [];
    current.push({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      actor: event.actor,
      occurredAt: event.occurredAt.toISOString(),
    });
    eventsByShipment.set(event.shipmentId, current);
  }

  for (const shipment of shipmentRows) {
    const lines = linesByShipment.get(shipment.id) ?? [];
    const dto: ShipmentDto = {
      id: shipment.id,
      orderId: shipment.orderId,
      carrierCode: shipment.carrierCode,
      service: shipment.service,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      status: shipment.status,
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      note: shipment.note,
      createdBy: shipment.createdBy,
      updatedBy: shipment.updatedBy,
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
      lines,
      events: eventsByShipment.get(shipment.id) ?? [],
      totalQuantity: lines.reduce((total, line) => total + line.quantity, 0),
    };
    const current = result.get(shipment.orderId) ?? [];
    current.push(dto);
    result.set(shipment.orderId, current);
  }
  return result;
}

export async function listOrderShipments(
  organizationId: string,
  orderId: string,
) {
  const shipments = await loadShipmentsForOrders(organizationId, [orderId]);
  return shipments.get(orderId) ?? [];
}

async function getShipment(
  organizationId: string,
  orderId: string,
  shipmentId: string,
) {
  const shipments = await listOrderShipments(organizationId, orderId);
  return shipments.find((shipment) => shipment.id === shipmentId) ?? null;
}

export async function createOrderShipment(
  organizationId: string,
  orderId: string,
  input: ShipmentCreateRequest,
  actor: string,
  idempotency: IdempotencyInput,
) {
  const validateReplay = (existing: typeof orderShipments.$inferSelect) => {
    if (
      existing.createdBy !== actor ||
      existing.requestHash !== idempotency.requestHash ||
      existing.orderId !== orderId
    ) {
      throw new ShipmentOperationError(
        "That Idempotency-Key was already used by another actor or payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  };
  const [existing] = await db
    .select()
    .from(orderShipments)
    .where(
      and(
        eq(orderShipments.organizationId, organizationId),
        eq(orderShipments.idempotencyKey, idempotency.key),
      ),
    )
    .limit(1);
  if (existing) return validateReplay(existing);

  try {
    return await db.transaction(async (transaction) => {
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
      if (!order) {
        throw new ShipmentOperationError("Sales order not found.", 404);
      }
      if (order.type !== "sale") {
        throw new ShipmentOperationError(
          "Shipments are only available for sales orders.",
          422,
        );
      }
      if (["draft", "cancelled", "returned"].includes(order.status)) {
        throw new ShipmentOperationError(
          "This sales order is not available for shipping.",
          409,
        );
      }

      const requestedLineIds = input.lines.map((line) => line.orderLineId);
      const lineRows = await transaction
        .select()
        .from(orderLines)
        .where(
          and(
            eq(orderLines.organizationId, organizationId),
            eq(orderLines.orderId, orderId),
            inArray(orderLines.id, [...requestedLineIds].sort()),
          ),
        )
        .orderBy(asc(orderLines.id))
        .for("update");
      if (lineRows.length !== input.lines.length) {
        throw new ShipmentOperationError(
          "One or more shipment lines do not belong to this sales order.",
          422,
        );
      }
      const linesById = new Map(lineRows.map((line) => [line.id, line]));
      const trackingRows = await transaction
        .select({
          resourceId: stockSettings.resourceId,
          trackingMode: stockSettings.trackingMode,
        })
        .from(stockSettings)
        .where(
          and(
            eq(stockSettings.organizationId, organizationId),
            inArray(
              stockSettings.resourceId,
              lineRows.map((line) => line.resourceId),
            ),
          ),
        );
      const trackingByResource = new Map(
        trackingRows.map((row) => [row.resourceId, row.trackingMode]),
      );
      const alreadyPacked = await transaction
        .select({
          orderLineId: orderShipmentLines.orderLineId,
          quantity: sql<number>`coalesce(sum(${orderShipmentLines.quantity}), 0)::int`,
        })
        .from(orderShipmentLines)
        .innerJoin(
          orderShipments,
          and(
            eq(orderShipments.organizationId, organizationId),
            eq(orderShipments.id, orderShipmentLines.shipmentId),
            ne(orderShipments.status, "cancelled"),
          ),
        )
        .where(
          and(
            eq(orderShipmentLines.organizationId, organizationId),
            inArray(orderShipmentLines.orderLineId, requestedLineIds),
          ),
        )
        .groupBy(orderShipmentLines.orderLineId);
      const packedByLine = new Map(
        alreadyPacked.map((row) => [row.orderLineId, Number(row.quantity)]),
      );

      const requestedUnitIds = input.lines.flatMap((line) => line.unitIds ?? []);
      const unitLinks = requestedUnitIds.length
        ? await transaction
            .select()
            .from(orderLineUnits)
            .where(
              and(
                eq(orderLineUnits.organizationId, organizationId),
                inArray(orderLineUnits.orderLineId, requestedLineIds),
                inArray(orderLineUnits.stockUnitId, [...requestedUnitIds].sort()),
                eq(orderLineUnits.status, "fulfilled"),
              ),
            )
            .orderBy(asc(orderLineUnits.stockUnitId))
            .for("update")
        : [];
      const unitLinkByStockUnit = new Map(
        unitLinks.map((link) => [link.stockUnitId, link]),
      );
      if (unitLinks.length !== requestedUnitIds.length) {
        throw new ShipmentOperationError(
          "Every serialized shipment unit must be fulfilled on the matching order line.",
          409,
        );
      }
      if (requestedUnitIds.length) {
        const existingPackedUnits = await transaction
          .select({ id: orderShipmentUnits.id })
          .from(orderShipmentUnits)
          .innerJoin(
            orderShipmentLines,
            and(
              eq(orderShipmentLines.organizationId, organizationId),
              eq(orderShipmentLines.id, orderShipmentUnits.shipmentLineId),
            ),
          )
          .innerJoin(
            orderShipments,
            and(
              eq(orderShipments.organizationId, organizationId),
              eq(orderShipments.id, orderShipmentLines.shipmentId),
              ne(orderShipments.status, "cancelled"),
            ),
          )
          .where(
            and(
              eq(orderShipmentUnits.organizationId, organizationId),
              inArray(
                orderShipmentUnits.orderLineUnitId,
                unitLinks.map((link) => link.id),
              ),
            ),
          )
          .limit(1);
        if (existingPackedUnits.length) {
          throw new ShipmentOperationError(
            "One of these serialized units is already assigned to another shipment.",
            409,
          );
        }
      }

      for (const inputLine of input.lines) {
        const line = linesById.get(inputLine.orderLineId)!;
        const availableToPack =
          line.fulfilledQuantity -
          line.returnedQuantity -
          (packedByLine.get(line.id) ?? 0);
        if (inputLine.quantity > availableToPack) {
          throw new ShipmentOperationError(
            `Only ${Math.max(0, availableToPack)} fulfilled units remain available to ship on this line.`,
            409,
          );
        }
        const trackingMode = trackingByResource.get(line.resourceId) ?? "bulk";
        const lineUnitIds = inputLine.unitIds ?? [];
        if (trackingMode === "serialized") {
          if (lineUnitIds.length !== inputLine.quantity) {
            throw new ShipmentOperationError(
              "Serialized shipment quantities require exactly one concrete unit per item.",
              422,
            );
          }
          if (
            lineUnitIds.some(
              (unitId) =>
                unitLinkByStockUnit.get(unitId)?.orderLineId !== inputLine.orderLineId,
            )
          ) {
            throw new ShipmentOperationError(
              "A serialized unit does not belong to its shipment line.",
              422,
            );
          }
        } else if (lineUnitIds.length) {
          throw new ShipmentOperationError(
            "Bulk-tracked shipment lines cannot contain serialized units.",
            422,
          );
        }
      }

      const carrierCode = input.carrierCode.toLowerCase();
      const trackingNumber = input.trackingNumber?.trim() || null;
      const trackingUrl =
        input.trackingUrl?.trim() ||
        defaultTrackingUrl(carrierCode, trackingNumber);
      const [shipment] = await transaction
        .insert(orderShipments)
        .values({
          organizationId,
          orderId,
          carrierCode,
          service: input.service?.trim() || null,
          trackingNumber,
          trackingUrl,
          status: input.status,
          note: input.note ?? "",
          idempotencyKey: idempotency.key,
          requestHash: idempotency.requestHash,
          response: {},
          createdBy: actor,
          updatedBy: actor,
        })
        .returning();
      const createdLines = await transaction
        .insert(orderShipmentLines)
        .values(
          input.lines.map((line) => ({
            organizationId,
            shipmentId: shipment.id,
            orderLineId: line.orderLineId,
            quantity: line.quantity,
          })),
        )
        .returning();
      const createdLineByOrderLine = new Map(
        createdLines.map((line) => [line.orderLineId, line]),
      );
      const shipmentUnitRows = input.lines.flatMap((line) =>
        (line.unitIds ?? []).map((unitId) => ({
          organizationId,
          shipmentLineId: createdLineByOrderLine.get(line.orderLineId)!.id,
          orderLineUnitId: unitLinkByStockUnit.get(unitId)!.id,
        })),
      );
      if (shipmentUnitRows.length) {
        await transaction.insert(orderShipmentUnits).values(shipmentUnitRows);
      }
      await transaction.insert(orderShipmentEvents).values({
        organizationId,
        shipmentId: shipment.id,
        fromStatus: null,
        toStatus: input.status,
        note: input.note ?? "",
        actor,
      });
      const byOrder = await loadShipmentsForOrders(
        organizationId,
        [orderId],
        transaction,
      );
      const saved = byOrder
        .get(orderId)
        ?.find((candidate) => candidate.id === shipment.id);
      if (!saved) {
        throw new ShipmentOperationError("Unable to load the created shipment.");
      }
      const response = JSON.parse(
        JSON.stringify({ shipment: saved }),
      ) as Record<string, unknown>;
      await transaction
        .update(orderShipments)
        .set({ response })
        .where(eq(orderShipments.id, shipment.id));
      return { response, replayed: false } as const;
    });
  } catch (error) {
    const [winner] = await db
      .select()
      .from(orderShipments)
      .where(
        and(
          eq(orderShipments.organizationId, organizationId),
          eq(orderShipments.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (winner) return validateReplay(winner);
    throw error;
  }
}

export async function updateOrderShipment(
  organizationId: string,
  orderId: string,
  shipmentId: string,
  patch: ShipmentPatchRequest,
  actor: string,
) {
  const changed = await db.transaction(async (transaction) => {
    const [shipment] = await transaction
      .select({ shipment: orderShipments, orderType: orders.type })
      .from(orderShipments)
      .innerJoin(
        orders,
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.id, orderShipments.orderId),
        ),
      )
      .where(
        and(
          eq(orderShipments.organizationId, organizationId),
          eq(orderShipments.id, shipmentId),
          eq(orderShipments.orderId, orderId),
        ),
      )
      .limit(1)
      .for("update");
    if (!shipment) return false;
    if (shipment.orderType !== "sale") {
      throw new ShipmentOperationError(
        "Shipments are only available for sales orders.",
        422,
      );
    }

    const current = shipment.shipment;
    const nextStatus = patch.status ?? current.status;
    if (!canTransitionShipment(current.status, nextStatus)) {
      throw new ShipmentOperationError(
        `A shipment cannot move from ${current.status} to ${nextStatus}.`,
        409,
      );
    }
    const carrierCode = (patch.carrierCode ?? current.carrierCode).toLowerCase();
    const trackingNumber =
      patch.trackingNumber === undefined
        ? current.trackingNumber
        : patch.trackingNumber?.trim() || null;
    const trackingUrl =
      patch.trackingUrl === undefined
        ? patch.carrierCode !== undefined || patch.trackingNumber !== undefined
          ? defaultTrackingUrl(carrierCode, trackingNumber)
          : current.trackingUrl
        : patch.trackingUrl?.trim() || null;
    if (
      ["ready", "shipped", "in_transit", "delivered", "exception", "returned"].includes(
        nextStatus,
      ) &&
      !trackingNumber
    ) {
      throw new ShipmentOperationError(
        "A ready or dispatched shipment requires a tracking number.",
        422,
      );
    }
    const occurredAt = patch.occurredAt ? new Date(patch.occurredAt) : new Date();
    const shippedAt =
      nextStatus === "shipped" && current.status !== "shipped"
        ? current.shippedAt ?? occurredAt
        : current.shippedAt;
    const deliveredAt =
      nextStatus === "delivered" && current.status !== "delivered"
        ? current.deliveredAt ?? occurredAt
        : current.deliveredAt;
    if (deliveredAt && shippedAt && deliveredAt < shippedAt) {
      throw new ShipmentOperationError(
        "The delivery time cannot be before the shipment time.",
        422,
      );
    }
    await transaction
      .update(orderShipments)
      .set({
        carrierCode,
        service:
          patch.service === undefined
            ? current.service
            : patch.service?.trim() || null,
        trackingNumber,
        trackingUrl,
        status: nextStatus,
        shippedAt,
        deliveredAt,
        note: patch.note === undefined ? current.note : patch.note,
        updatedBy: actor,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orderShipments.organizationId, organizationId),
          eq(orderShipments.id, shipmentId),
        ),
      );
    await transaction.insert(orderShipmentEvents).values({
      organizationId,
      shipmentId,
      fromStatus: current.status,
      toStatus: nextStatus,
      note: patch.eventNote ?? "",
      actor,
      occurredAt,
    });
    return true;
  });
  return changed ? getShipment(organizationId, orderId, shipmentId) : null;
}
