import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  internalRequestEvents,
  internalRequestLines,
  internalRequests,
  inventoryAssignments,
  resourceLendingSettings,
  resources,
  resourceVariants,
  stockLocationBalances,
  stockMovements,
  stockSettings,
  stockUnits,
  type InternalRequestEventType,
  type InternalRequestStatus,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  canTransitionInternalRequest,
  internalRequestStatusAfter,
  type InternalRequestAction,
} from "@/lib/internal-request-contract";
import { enqueueStockMovementWebhookEvents } from "@/lib/webhooks";

const MAX_STOCK_QUANTITY = 2_000_000_000;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseReader = Pick<typeof db, "select">;

export type InternalRequestViewer = {
  subject: string;
  userId?: string;
  canManage: boolean;
};

export type InternalRequestActor = InternalRequestViewer & {
  name: string;
};

export type InternalRequestCreateInput = {
  deliveryResourceId?: string | null;
  startsAt: Date;
  dueAt: Date;
  note?: string;
  lines: Array<{ resourceId: string; quantity: number; note?: string }>;
};

export type InternalRequestIdempotency = {
  key: string;
  requestHash: string;
};

export class InternalRequestError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "InternalRequestError";
  }
}

export function internalRequestHttpError(error: unknown, fallback: string) {
  if (error instanceof InternalRequestError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("internal_request_lines_request_resource_unique")) {
    return {
      status: 409 as const,
      message: "Each inventory item may appear only once in a request.",
    };
  }
  if (message.includes("internal_requests_idempotency_key_unique")) {
    return {
      status: 409 as const,
      message: "That Idempotency-Key was already used for another request.",
    };
  }
  return { status: 500 as const, message: fallback };
}

function viewerCondition(viewer: InternalRequestViewer) {
  if (viewer.canManage) return undefined;
  return viewer.userId
    ? or(
        eq(internalRequests.requesterUserId, viewer.userId),
        eq(internalRequests.createdBy, viewer.subject),
      )
    : eq(internalRequests.createdBy, viewer.subject);
}

type RequestListOptions = {
  status?: InternalRequestStatus;
  limit?: number;
  requestId?: string;
  mine?: boolean;
};

async function loadRequestDtos(
  organizationId: string,
  viewer: InternalRequestViewer,
  options: RequestListOptions = {},
  database: DatabaseReader = db,
) {
  const conditions = [eq(internalRequests.organizationId, organizationId)];
  const visibility =
    options.mine && viewer.userId
      ? eq(internalRequests.requesterUserId, viewer.userId)
      : viewerCondition(viewer);
  if (visibility) conditions.push(visibility);
  if (options.status) conditions.push(eq(internalRequests.status, options.status));
  if (options.requestId) conditions.push(eq(internalRequests.id, options.requestId));

  const requestRows = await database
    .select()
    .from(internalRequests)
    .where(and(...conditions))
    .orderBy(desc(internalRequests.createdAt))
    .limit(Math.min(200, Math.max(1, options.limit ?? 100)));
  if (!requestRows.length) return [];

  const requestIds = requestRows.map((request) => request.id);
  const lineRows = await database
    .select({
      id: internalRequestLines.id,
      requestId: internalRequestLines.requestId,
      resourceId: internalRequestLines.resourceId,
      resourceName: resources.name,
      resourceSku: resources.sku,
      resourceStatus: resources.status,
      currentQuantity: resources.quantity,
      trackingMode: stockSettings.trackingMode,
      quantity: internalRequestLines.quantity,
      note: internalRequestLines.note,
      createdAt: internalRequestLines.createdAt,
      updatedAt: internalRequestLines.updatedAt,
    })
    .from(internalRequestLines)
    .innerJoin(
      resources,
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, internalRequestLines.resourceId),
      ),
    )
    .leftJoin(
      stockSettings,
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, internalRequestLines.resourceId),
      ),
    )
    .where(
      and(
        eq(internalRequestLines.organizationId, organizationId),
        inArray(internalRequestLines.requestId, requestIds),
      ),
    )
    .orderBy(asc(resources.name));
  const eventRows = await database
    .select()
    .from(internalRequestEvents)
    .where(
      and(
        eq(internalRequestEvents.organizationId, organizationId),
        inArray(internalRequestEvents.requestId, requestIds),
      ),
    )
    .orderBy(asc(internalRequestEvents.occurredAt));
  const deliveryIds = requestRows
    .map((request) => request.deliveryResourceId)
    .filter((id): id is string => Boolean(id));
  const deliveryRows = deliveryIds.length
    ? await database
        .select({ id: resources.id, name: resources.name })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, deliveryIds),
          ),
        )
    : [];
  const deliveryNames = new Map(deliveryRows.map((row) => [row.id, row.name]));

  return requestRows.map((request) => ({
    id: request.id,
    reference: request.reference,
    status: request.status,
    requester: {
      userId: request.requesterUserId,
      name: request.requesterName,
      email: request.requesterEmail,
    },
    delivery: request.deliveryResourceId
      ? {
          resourceId: request.deliveryResourceId,
          name: deliveryNames.get(request.deliveryResourceId) ?? "Delivery location",
        }
      : null,
    startsAt: request.startsAt.toISOString(),
    dueAt: request.dueAt.toISOString(),
    note: request.note,
    decisionNote: request.decisionNote,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    fulfilledBy: request.fulfilledBy,
    fulfilledAt: request.fulfilledAt?.toISOString() ?? null,
    createdBy: request.createdBy,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    canCancel:
      ["submitted", "approved"].includes(request.status) &&
      (viewer.canManage ||
        request.requesterUserId === viewer.userId ||
        request.createdBy === viewer.subject),
    lines: lineRows
      .filter((line) => line.requestId === request.id)
      .map((line) => ({
        id: line.id,
        resource: {
          id: line.resourceId,
          name: line.resourceName,
          sku: line.resourceSku,
          status: line.resourceStatus,
          currentQuantity: line.currentQuantity,
          trackingMode: line.trackingMode ?? "bulk",
        },
        quantity: line.quantity,
        note: line.note,
        createdAt: line.createdAt.toISOString(),
        updatedAt: line.updatedAt.toISOString(),
      })),
    events: eventRows
      .filter((event) => event.requestId === request.id)
      .map((event) => ({
        id: event.id,
        type: event.type,
        actor: event.actor,
        note: event.note,
        occurredAt: event.occurredAt.toISOString(),
      })),
  }));
}

export async function listInternalRequests(
  organizationId: string,
  viewer: InternalRequestViewer,
  options: RequestListOptions = {},
) {
  return {
    requests: await loadRequestDtos(organizationId, viewer, options),
    capabilities: {
      canManage: viewer.canManage,
    },
  };
}

export async function getInternalRequest(
  organizationId: string,
  requestId: string,
  viewer: InternalRequestViewer,
) {
  const [request] = await loadRequestDtos(organizationId, viewer, {
    requestId,
    limit: 1,
  });
  return request ?? null;
}

export async function createInternalRequest(
  organizationId: string,
  input: InternalRequestCreateInput,
  actor: InternalRequestActor,
  idempotency: InternalRequestIdempotency,
) {
  const getReplay = async () => {
    const [existing] = await db
      .select()
      .from(internalRequests)
      .where(
        and(
          eq(internalRequests.organizationId, organizationId),
          eq(internalRequests.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (!existing) return null;
    if (
      existing.createdBy !== actor.subject ||
      existing.requestHash !== idempotency.requestHash
    ) {
      throw new InternalRequestError(
        "That Idempotency-Key was already used by another actor or payload.",
        409,
      );
    }
    return existing;
  };

  const earlyReplay = await getReplay();
  if (earlyReplay) {
    return {
      request: await getInternalRequest(organizationId, earlyReplay.id, {
        ...actor,
        canManage: true,
      }),
      replayed: true,
    };
  }
  if (input.startsAt <= new Date()) {
    throw new InternalRequestError(
      "The requested period must start in the future.",
      422,
    );
  }

  const id = randomUUID();
  const reference = `REQ-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  try {
    await db.transaction(async (transaction) => {
      const resourceIds = input.lines.map((line) => line.resourceId);
      const resourceRows = await transaction
        .select({
          id: resources.id,
          name: resources.name,
          status: resources.status,
          lendingEnabled: resourceLendingSettings.enabled,
          approvalRequired: resourceLendingSettings.approvalRequired,
          maxDurationDays: resourceLendingSettings.maxDurationDays,
        })
        .from(resources)
        .leftJoin(
          resourceLendingSettings,
          and(
            eq(resourceLendingSettings.organizationId, organizationId),
            eq(resourceLendingSettings.resourceId, resources.id),
          ),
        )
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, resourceIds),
          ),
        )
        .orderBy(asc(resources.id))
        .for("update", { of: resources });
      if (resourceRows.length !== resourceIds.length) {
        throw new InternalRequestError(
          "One or more requested inventory items do not exist.",
          422,
        );
      }
      if (resourceRows.some((resource) => resource.status === "archived")) {
        throw new InternalRequestError(
          "Archived inventory cannot be requested.",
          422,
        );
      }
      const unavailableForLending = resourceRows.filter(
        (resource) => resource.lendingEnabled !== true,
      );
      if (unavailableForLending.length) {
        throw new InternalRequestError(
          `${unavailableForLending.map((resource) => resource.name).join(", ")} cannot be requested because lending is not enabled.`,
          422,
        );
      }
      const durationDays =
        (input.dueAt.getTime() - input.startsAt.getTime()) / 86_400_000;
      const durationConflict = resourceRows.find(
        (resource) =>
          resource.maxDurationDays !== null &&
          durationDays > resource.maxDurationDays,
      );
      if (durationConflict) {
        throw new InternalRequestError(
          `${durationConflict.name} may be borrowed for at most ${durationConflict.maxDurationDays} days.`,
          422,
        );
      }
      if (input.deliveryResourceId) {
        const [delivery] = await transaction
          .select({ id: resources.id, status: resources.status })
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              eq(resources.id, input.deliveryResourceId),
            ),
          )
          .limit(1);
        if (!delivery || delivery.status === "archived") {
          throw new InternalRequestError(
            "Choose an active delivery location or project.",
            422,
          );
        }
      }

      const autoApprove = resourceRows.every(
        (resource) => resource.approvalRequired === false,
      );
      if (autoApprove) {
        const availability = await availabilityForWindow(
          transaction,
          organizationId,
          resourceIds,
          input.startsAt,
          input.dueAt,
        );
        const conflicts = input.lines.flatMap((line) => {
          const item = availability.get(line.resourceId);
          return !item || item.available < line.quantity
            ? [
                `${item?.resourceName ?? "An item"}: requested ${line.quantity}, available ${item?.available ?? 0}`,
              ]
            : [];
        });
        if (conflicts.length) {
          throw new InternalRequestError(
            `The requested period is not available. ${conflicts.join("; ")}.`,
            409,
          );
        }
      }

      const now = new Date();
      await transaction.insert(internalRequests).values({
        organizationId,
        id,
        reference,
        status: autoApprove ? "approved" : "submitted",
        requesterUserId: actor.userId ?? null,
        requesterName: actor.name.trim() || actor.subject,
        requesterEmail: actor.subject.includes("@") ? actor.subject : null,
        deliveryResourceId: input.deliveryResourceId ?? null,
        startsAt: input.startsAt,
        dueAt: input.dueAt,
        note: input.note ?? "",
        decisionNote: autoApprove ? "Automatically approved by lending policy." : "",
        decidedBy: autoApprove ? actor.subject : null,
        decidedAt: autoApprove ? now : null,
        idempotencyKey: idempotency.key,
        requestHash: idempotency.requestHash,
        createdBy: actor.subject,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(internalRequestLines).values(
        input.lines.map((line) => ({
          organizationId,
          requestId: id,
          resourceId: line.resourceId,
          quantity: line.quantity,
          note: line.note ?? "",
          createdAt: now,
          updatedAt: now,
        })),
      );
      await transaction.insert(internalRequestEvents).values({
        organizationId,
        requestId: id,
        type: "submitted",
        actor: actor.subject,
        note: input.note ?? "",
        occurredAt: now,
      });
      if (autoApprove) {
        await transaction.insert(internalRequestEvents).values({
          organizationId,
          requestId: id,
          type: "approved",
          actor: actor.subject,
          note: "Automatically approved by lending policy.",
          occurredAt: now,
        });
      }
    });
  } catch (error) {
    const replay = await getReplay();
    if (!replay) throw error;
    return {
      request: await getInternalRequest(organizationId, replay.id, {
        ...actor,
        canManage: true,
      }),
      replayed: true,
    };
  }

  return {
    request: await getInternalRequest(organizationId, id, {
      ...actor,
      canManage: true,
    }),
    replayed: false,
  };
}

type Availability = {
  resourceId: string;
  resourceName: string;
  capacity: number;
  allocated: number;
  available: number;
};

async function availabilityForWindow(
  transaction: Transaction,
  organizationId: string,
  resourceIds: string[],
  startsAt: Date,
  dueAt: Date,
  excludeRequestId?: string,
): Promise<Map<string, Availability>> {
  const uniqueIds = Array.from(new Set(resourceIds));
  const resourceRows = await transaction
    .select({ id: resources.id, name: resources.name, quantity: resources.quantity })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        inArray(resources.id, uniqueIds),
      ),
    );
  const [activeTotals, overlappingAssignments, variantTotals] =
    await Promise.all([
      transaction
        .select({
          resourceId: inventoryAssignments.resourceId,
          quantity: sql<number>`coalesce(sum(${inventoryAssignments.quantity}), 0)::int`,
        })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            inArray(inventoryAssignments.resourceId, uniqueIds),
            eq(inventoryAssignments.status, "active"),
            eq(inventoryAssignments.stockApplied, true),
          ),
        )
        .groupBy(inventoryAssignments.resourceId),
      transaction
        .select({
          resourceId: inventoryAssignments.resourceId,
          quantity: sql<number>`coalesce(sum(${inventoryAssignments.quantity}), 0)::int`,
        })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            inArray(inventoryAssignments.resourceId, uniqueIds),
            eq(inventoryAssignments.status, "active"),
            lt(inventoryAssignments.startsAt, dueAt),
            or(isNull(inventoryAssignments.dueAt), gt(inventoryAssignments.dueAt, startsAt)),
          ),
        )
        .groupBy(inventoryAssignments.resourceId),
      transaction
        .select({
          resourceId: resourceVariants.resourceId,
          quantity: sql<number>`coalesce(sum(${resourceVariants.quantity}), 0)::int`,
        })
        .from(resourceVariants)
        .where(
          and(
            eq(resourceVariants.organizationId, organizationId),
            inArray(resourceVariants.resourceId, uniqueIds),
          ),
        )
        .groupBy(resourceVariants.resourceId),
    ]);

  const approvedConditions = [
    eq(internalRequestLines.organizationId, organizationId),
    inArray(internalRequestLines.resourceId, uniqueIds),
    eq(internalRequests.organizationId, organizationId),
    eq(internalRequests.status, "approved"),
    lt(internalRequests.startsAt, dueAt),
    gt(internalRequests.dueAt, startsAt),
  ];
  if (excludeRequestId) {
    approvedConditions.push(ne(internalRequests.id, excludeRequestId));
  }
  const approvedTotals = await transaction
    .select({
      resourceId: internalRequestLines.resourceId,
      quantity: sql<number>`coalesce(sum(${internalRequestLines.quantity}), 0)::int`,
    })
    .from(internalRequestLines)
    .innerJoin(
      internalRequests,
      eq(internalRequests.id, internalRequestLines.requestId),
    )
    .where(and(...approvedConditions))
    .groupBy(internalRequestLines.resourceId);

  const totals = (rows: Array<{ resourceId: string; quantity: number }>) =>
    new Map(rows.map((row) => [row.resourceId, Number(row.quantity ?? 0)]));
  const activeByResource = totals(activeTotals);
  const assignmentsByResource = totals(overlappingAssignments);
  const approvedByResource = totals(approvedTotals);
  const variantsByResource = totals(variantTotals);
  return new Map(
    resourceRows.map((resource) => {
      const capacity =
        resource.quantity +
        (activeByResource.get(resource.id) ?? 0) -
        (variantsByResource.get(resource.id) ?? 0);
      const allocated =
        (assignmentsByResource.get(resource.id) ?? 0) +
        (approvedByResource.get(resource.id) ?? 0);
      return [
        resource.id,
        {
          resourceId: resource.id,
          resourceName: resource.name,
          capacity,
          allocated,
          available: Math.max(0, capacity - allocated),
        },
      ];
    }),
  );
}

async function assertRequestAvailability(
  transaction: Transaction,
  organizationId: string,
  request: typeof internalRequests.$inferSelect,
  lines: Array<typeof internalRequestLines.$inferSelect>,
) {
  const resourceIds = lines.map((line) => line.resourceId).sort();
  const lockedResources = await transaction
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        inArray(resources.id, resourceIds),
      ),
    )
    .orderBy(asc(resources.id))
    .for("update");
  if (lockedResources.length !== resourceIds.length) {
    throw new InternalRequestError(
      "One or more requested inventory items no longer exist.",
      409,
    );
  }
  const availability = await availabilityForWindow(
    transaction,
    organizationId,
    resourceIds,
    request.startsAt,
    request.dueAt,
    request.id,
  );
  const conflicts = lines.flatMap((line) => {
    const item = availability.get(line.resourceId);
    return !item || item.available < line.quantity
      ? [
          `${item?.resourceName ?? "An item"}: requested ${line.quantity}, available ${item?.available ?? 0}`,
        ]
      : [];
  });
  if (conflicts.length) {
    throw new InternalRequestError(
      `The requested period is no longer available. ${conflicts.join("; ")}.`,
      409,
    );
  }
}

function assignmentRecipient(
  request: typeof internalRequests.$inferSelect,
) {
  if (request.deliveryResourceId) {
    return { assigneeResourceId: request.deliveryResourceId };
  }
  if (request.requesterUserId) {
    return { assigneeUserId: request.requesterUserId };
  }
  return { assigneeLabel: request.requesterName };
}

async function fulfillApprovedRequest(
  transaction: Transaction,
  organizationId: string,
  request: typeof internalRequests.$inferSelect,
  lines: Array<typeof internalRequestLines.$inferSelect>,
  actor: string,
) {
  const resourceIds = lines.map((line) => line.resourceId).sort();
  const resourceRows = await transaction
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
      trackingMode: stockSettings.trackingMode,
    })
    .from(resources)
    .leftJoin(
      stockSettings,
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, resources.id),
      ),
    )
    .where(
      and(
        eq(resources.organizationId, organizationId),
        inArray(resources.id, resourceIds),
      ),
    )
    .orderBy(asc(resources.id))
    .for("update");
  if (resourceRows.length !== resourceIds.length) {
    throw new InternalRequestError(
      "One or more requested inventory items no longer exist.",
      409,
    );
  }
  const resourceById = new Map(resourceRows.map((resource) => [resource.id, resource]));
  const variantRows = await transaction
    .select({
      resourceId: resourceVariants.resourceId,
      quantity: sql<number>`coalesce(sum(${resourceVariants.quantity}), 0)::int`,
    })
    .from(resourceVariants)
    .where(
      and(
        eq(resourceVariants.organizationId, organizationId),
        inArray(resourceVariants.resourceId, resourceIds),
      ),
    )
    .groupBy(resourceVariants.resourceId);
  const variants = new Map(
    variantRows.map((row) => [row.resourceId, Number(row.quantity ?? 0)]),
  );
  const recipient = assignmentRecipient(request);
  const now = new Date();
  const allMovements: Array<typeof stockMovements.$inferSelect> = [];

  for (const line of lines) {
    const resource = resourceById.get(line.resourceId);
    if (!resource) throw new InternalRequestError("Inventory item not found.", 409);
    const allocatable = resource.quantity - (variants.get(resource.id) ?? 0);
    if (line.quantity > allocatable) {
      throw new InternalRequestError(
        `${resource.name} has only ${Math.max(0, allocatable)} available now; ${line.quantity} were requested.`,
        409,
      );
    }
    if (resource.quantity - line.quantity < -MAX_STOCK_QUANTITY) {
      throw new InternalRequestError("The fulfillment exceeds the supported stock range.", 409);
    }

    let runningBalance = resource.quantity;
    if ((resource.trackingMode ?? "bulk") === "serialized") {
      const units = await transaction
        .select()
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.resourceId, resource.id),
            eq(stockUnits.status, "available"),
          ),
        )
        .orderBy(asc(stockUnits.code))
        .limit(line.quantity)
        .for("update");
      if (units.length !== line.quantity) {
        throw new InternalRequestError(
          `${resource.name} has only ${units.length} identified units available now.`,
          409,
        );
      }
      for (const unit of units) {
        runningBalance -= 1;
        const [assignment] = await transaction
          .insert(inventoryAssignments)
          .values({
            organizationId,
            resourceId: resource.id,
            stockUnitId: unit.id,
            internalRequestLineId: line.id,
            kind: "checkout",
            status: "active",
            quantity: 1,
            ...recipient,
            startsAt: now,
            dueAt: request.dueAt,
            note: `Fulfilled from ${request.reference}${line.note ? `: ${line.note}` : ""}`,
            createdBy: actor,
            updatedAt: now,
          })
          .returning();
        await transaction
          .update(stockUnits)
          .set({ status: "in-use", lastMovedAt: now, updatedAt: now })
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              eq(stockUnits.id, unit.id),
            ),
          );
        const [movement] = await transaction
          .insert(stockMovements)
          .values({
            organizationId,
            resourceId: resource.id,
            unitId: unit.id,
            delta: -1,
            quantity: 1,
            balanceAfter: runningBalance,
            type: "internal-request",
            reason: `Fulfilled ${request.reference}`,
            note: `Assignment ${assignment.id}`,
            location: unit.location,
            fromLocationResourceId: unit.locationResourceId,
            occurredAt: now,
            createdBy: actor,
          })
          .returning();
        allMovements.push(movement);
      }
    } else {
      const locationRows = await transaction
        .select()
        .from(stockLocationBalances)
        .where(
          and(
            eq(stockLocationBalances.organizationId, organizationId),
            eq(stockLocationBalances.resourceId, resource.id),
            gt(stockLocationBalances.quantity, 0),
          ),
        )
        .orderBy(desc(stockLocationBalances.quantity))
        .for("update");
      const located = locationRows.reduce(
        (total, location) => total + location.quantity,
        0,
      );
      let remaining = line.quantity;
      const allocations: Array<{
        quantity: number;
        locationId: string | null;
        locationBalanceAfter: number | null;
      }> = [];
      const unassigned = Math.max(0, resource.quantity - located);
      if (unassigned > 0) {
        const quantity = Math.min(unassigned, remaining);
        if (quantity > 0) allocations.push({ quantity, locationId: null, locationBalanceAfter: null });
        remaining -= quantity;
      }
      for (const location of locationRows) {
        if (remaining <= 0) break;
        const quantity = Math.min(location.quantity, remaining);
        if (quantity <= 0) continue;
        const locationBalanceAfter = location.quantity - quantity;
        allocations.push({
          quantity,
          locationId: location.locationResourceId,
          locationBalanceAfter,
        });
        await transaction
          .update(stockLocationBalances)
          .set({ quantity: locationBalanceAfter, updatedAt: now })
          .where(
            and(
              eq(stockLocationBalances.organizationId, organizationId),
              eq(stockLocationBalances.id, location.id),
            ),
          );
        remaining -= quantity;
      }
      if (remaining > 0) {
        throw new InternalRequestError(
          `${resource.name} does not have enough allocatable stock at its locations.`,
          409,
        );
      }
      for (const allocation of allocations) {
        runningBalance -= allocation.quantity;
        const [assignment] = await transaction
          .insert(inventoryAssignments)
          .values({
            organizationId,
            resourceId: resource.id,
            internalRequestLineId: line.id,
            kind: "checkout",
            status: "active",
            quantity: allocation.quantity,
            ...recipient,
            startsAt: now,
            dueAt: request.dueAt,
            note: `Fulfilled from ${request.reference}${line.note ? `: ${line.note}` : ""}`,
            createdBy: actor,
            updatedAt: now,
          })
          .returning();
        const [movement] = await transaction
          .insert(stockMovements)
          .values({
            organizationId,
            resourceId: resource.id,
            delta: -allocation.quantity,
            quantity: allocation.quantity,
            balanceAfter: runningBalance,
            fromLocationBalanceAfter: allocation.locationBalanceAfter,
            type: "internal-request",
            reason: `Fulfilled ${request.reference}`,
            note: `Assignment ${assignment.id}`,
            fromLocationResourceId: allocation.locationId,
            occurredAt: now,
            createdBy: actor,
          })
          .returning();
        allMovements.push(movement);
      }
    }
    await transaction
      .update(resources)
      .set({ quantity: runningBalance, updatedAt: now })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resource.id),
        ),
      );
  }
  await enqueueStockMovementWebhookEvents(transaction, allMovements);
}

export async function transitionInternalRequest(
  organizationId: string,
  requestId: string,
  action: InternalRequestAction,
  note: string,
  actor: InternalRequestActor,
) {
  await db.transaction(async (transaction) => {
    const [request] = await transaction
      .select()
      .from(internalRequests)
      .where(
        and(
          eq(internalRequests.organizationId, organizationId),
          eq(internalRequests.id, requestId),
        ),
      )
      .limit(1)
      .for("update");
    if (!request) throw new InternalRequestError("Request not found.", 404);
    if (
      (action === "approve" || action === "fulfill") &&
      request.dueAt <= new Date()
    ) {
      throw new InternalRequestError(
        `${request.reference} has already passed its return date.`,
        409,
      );
    }
    const ownsRequest =
      request.requesterUserId === actor.userId || request.createdBy === actor.subject;
    if (action === "cancel" ? !actor.canManage && !ownsRequest : !actor.canManage) {
      throw new InternalRequestError("You cannot perform that request action.", 403);
    }
    if (!canTransitionInternalRequest(request.status, action)) {
      throw new InternalRequestError(
        `${request.reference} cannot be ${action}ed while it is ${request.status}.`,
        409,
      );
    }
    const lines = await transaction
      .select()
      .from(internalRequestLines)
      .where(
        and(
          eq(internalRequestLines.organizationId, organizationId),
          eq(internalRequestLines.requestId, request.id),
        ),
      )
      .orderBy(asc(internalRequestLines.id));
    if (!lines.length) {
      throw new InternalRequestError("This request has no lines.", 409);
    }
    if (action === "approve") {
      await assertRequestAvailability(transaction, organizationId, request, lines);
    }
    if (action === "fulfill") {
      await fulfillApprovedRequest(
        transaction,
        organizationId,
        request,
        lines,
        actor.subject,
      );
    }
    const nextStatus = internalRequestStatusAfter(request.status, action);
    if (!nextStatus) {
      throw new InternalRequestError("Invalid request lifecycle transition.", 409);
    }
    const now = new Date();
    await transaction
      .update(internalRequests)
      .set({
        status: nextStatus,
        decisionNote:
          action === "approve" || action === "reject"
            ? note
            : request.decisionNote,
        decidedBy:
          action === "approve" || action === "reject"
            ? actor.subject
            : request.decidedBy,
        decidedAt:
          action === "approve" || action === "reject"
            ? now
            : request.decidedAt,
        fulfilledBy: action === "fulfill" ? actor.subject : request.fulfilledBy,
        fulfilledAt: action === "fulfill" ? now : request.fulfilledAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(internalRequests.organizationId, organizationId),
          eq(internalRequests.id, request.id),
        ),
      );
    await transaction.insert(internalRequestEvents).values({
      organizationId,
      requestId: request.id,
      type: nextStatus as InternalRequestEventType,
      actor: actor.subject,
      note,
      occurredAt: now,
    });
  });

  return getInternalRequest(organizationId, requestId, {
    ...actor,
    canManage: true,
  });
}

export async function listReservationCalendar(
  organizationId: string,
  viewer: InternalRequestViewer,
  range: { from: Date; to: Date; includeAssignments: boolean },
) {
  const requestConditions = [
    eq(internalRequests.organizationId, organizationId),
    inArray(internalRequests.status, ["submitted", "approved", "fulfilled"]),
    lt(internalRequests.startsAt, range.to),
    gt(internalRequests.dueAt, range.from),
  ];
  const visibility = viewerCondition(viewer);
  if (visibility) requestConditions.push(visibility);
  const requestedRows = await db
    .select({
      requestId: internalRequests.id,
      reference: internalRequests.reference,
      status: internalRequests.status,
      requesterName: internalRequests.requesterName,
      deliveryResourceId: internalRequests.deliveryResourceId,
      startsAt: internalRequests.startsAt,
      dueAt: internalRequests.dueAt,
      lineId: internalRequestLines.id,
      resourceId: resources.id,
      resourceName: resources.name,
      quantity: internalRequestLines.quantity,
    })
    .from(internalRequests)
    .innerJoin(
      internalRequestLines,
      and(
        eq(internalRequestLines.organizationId, organizationId),
        eq(internalRequestLines.requestId, internalRequests.id),
      ),
    )
    .innerJoin(
      resources,
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, internalRequestLines.resourceId),
      ),
    )
    .where(and(...requestConditions))
    .orderBy(asc(internalRequests.startsAt), asc(resources.name));
  const deliveryIds = requestedRows
    .map((row) => row.deliveryResourceId)
    .filter((id): id is string => Boolean(id));
  const deliveryRows = deliveryIds.length
    ? await db
        .select({ id: resources.id, name: resources.name })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            inArray(resources.id, Array.from(new Set(deliveryIds))),
          ),
        )
    : [];
  const deliveryNames = new Map(deliveryRows.map((row) => [row.id, row.name]));

  const assignmentRows = range.includeAssignments
    ? await db
        .select({
          id: inventoryAssignments.id,
          resourceId: resources.id,
          resourceName: resources.name,
          quantity: inventoryAssignments.quantity,
          startsAt: inventoryAssignments.startsAt,
          dueAt: inventoryAssignments.dueAt,
          assigneeLabel: inventoryAssignments.assigneeLabel,
          note: inventoryAssignments.note,
        })
        .from(inventoryAssignments)
        .innerJoin(
          resources,
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, inventoryAssignments.resourceId),
          ),
        )
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.kind, "reservation"),
            eq(inventoryAssignments.status, "active"),
            lt(inventoryAssignments.startsAt, range.to),
            or(isNull(inventoryAssignments.dueAt), gt(inventoryAssignments.dueAt, range.from)),
          ),
        )
        .orderBy(asc(inventoryAssignments.startsAt), asc(resources.name))
    : [];

  return {
    entries: [
      ...requestedRows.map((row) => ({
        id: `request:${row.lineId}`,
        source: "internal-request" as const,
        sourceId: row.requestId,
        reference: row.reference,
        status: row.status,
        title: row.resourceName,
        subtitle:
          (row.deliveryResourceId
            ? deliveryNames.get(row.deliveryResourceId)
            : null) ?? row.requesterName,
        resourceId: row.resourceId,
        quantity: row.quantity,
        startsAt: row.startsAt.toISOString(),
        dueAt: row.dueAt.toISOString(),
      })),
      ...assignmentRows.map((row) => ({
        id: `assignment:${row.id}`,
        source: "reservation" as const,
        sourceId: row.id,
        reference: null,
        status: "reserved" as const,
        title: row.resourceName,
        subtitle: row.assigneeLabel || row.note || "Reservation",
        resourceId: row.resourceId,
        quantity: row.quantity,
        startsAt: row.startsAt.toISOString(),
        dueAt: row.dueAt?.toISOString() ?? null,
      })),
    ],
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}
