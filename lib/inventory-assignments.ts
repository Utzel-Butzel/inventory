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
  or,
  sql,
} from "drizzle-orm";

import {
  internalRequestLines,
  internalRequests,
  inventoryAssignments,
  organizationMemberships,
  organizations,
  resourceLendingSettings,
  resourceVariants,
  resources,
  stockMovementRequests,
  stockMovements,
  stockLocationBalances,
  stockSettings,
  stockUnits,
  users,
  type AssignmentKind,
  type AssignmentStatus,
  type InventoryAssignmentRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { isLoanOverdue, loanWindowDurationDays } from "@/lib/lending-contract";
import { lendingSettingsDto } from "@/lib/resource-lending";
import { enqueueStockMovementWebhookEvents } from "@/lib/webhooks";
import {
  allocatedVariantQuantity,
  assertVariantAllocationFits,
} from "@/lib/variant-stock-invariant";

const MAX_STOCK_QUANTITY = 2_000_000_000;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type AssignmentRecipient =
  | { type: "user"; userId: string }
  | { type: "resource"; resourceId: string }
  | { type: "label"; label: string };

export type CreateInventoryAssignmentInput = {
  kind: AssignmentKind;
  quantity: number;
  stockUnitId?: string | null;
  recipient: AssignmentRecipient;
  startsAt?: Date;
  dueAt?: Date | null;
  note?: string;
};

export type CompleteInventoryAssignmentInput = {
  status: Exclude<AssignmentStatus, "active">;
  completedAt?: Date;
  note?: string;
};

export type ActivateInventoryReservationInput = {
  stockUnitId?: string | null;
  checkedOutAt?: Date;
  note?: string;
};

export type AssignmentIdempotency = {
  key: string;
  requestHash: string;
};

export class InventoryAssignmentError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "InventoryAssignmentError";
  }
}

export function inventoryAssignmentHttpError(error: unknown, fallback: string) {
  if (error instanceof InventoryAssignmentError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("inventory_assignments_active_stock_unit_unique")) {
    return {
      status: 409 as const,
      message: "This serialized unit already has an active assignment or reservation.",
    };
  }
  if (message.includes("inventory_assignments_exactly_one_assignee")) {
    return {
      status: 422 as const,
      message: "Choose exactly one assignment recipient.",
    };
  }
  return { status: 500 as const, message: fallback };
}

type RecipientLabels = {
  users?: Map<string, { name: string; email: string }>;
  resources?: Map<string, string>;
};

const assignmentDto = (
  row: InventoryAssignmentRecord,
  labels: RecipientLabels = {},
  unit?: { code: string; status: string } | null,
) => {
  const assignee = row.assigneeUserId
    ? {
        type: "user" as const,
        id: row.assigneeUserId,
        label: labels.users?.get(row.assigneeUserId)?.name ?? "User",
        detail: labels.users?.get(row.assigneeUserId)?.email ?? null,
      }
    : row.assigneeResourceId
      ? {
          type: "resource" as const,
          id: row.assigneeResourceId,
          label: labels.resources?.get(row.assigneeResourceId) ?? "Inventory item",
          detail: null,
        }
      : {
          type: "label" as const,
          id: null,
          label: row.assigneeLabel,
          detail: null,
        };

  return {
    id: row.id,
    resourceId: row.resourceId,
    stockUnitId: row.stockUnitId,
    kind: row.kind,
    status: row.status,
    stockApplied: row.stockApplied,
    overdue: isLoanOverdue(row),
    quantity: row.quantity,
    assignee,
    stockUnit: row.stockUnitId
      ? {
          id: row.stockUnitId,
          code: unit?.code ?? "Serialized unit",
          status: unit?.status ?? null,
        }
      : null,
    startsAt: row.startsAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    note: row.note,
    createdBy: row.createdBy,
    completedBy: row.completedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

const movementDto = (row: typeof stockMovements.$inferSelect) => ({
  ...row,
  occurredAt: row.occurredAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

type StoredMutationResponse = {
  assignment: ReturnType<typeof assignmentDto>;
  resource: { id: string; name: string; quantity: number };
  movement: ReturnType<typeof movementDto>;
};

const storedResponse = (response: StoredMutationResponse) =>
  JSON.parse(JSON.stringify(response)) as Record<string, unknown>;

const replayResponse = (value: Record<string, unknown>) =>
  value as unknown as StoredMutationResponse;

const validateReplay = (
  existing: {
    resourceId: string;
    actor: string;
    requestHash: string;
    response: Record<string, unknown>;
  },
  expected: { resourceId?: string; actor: string; requestHash: string },
) => {
  if (
    (expected.resourceId !== undefined &&
      existing.resourceId !== expected.resourceId) ||
    existing.actor !== expected.actor ||
    existing.requestHash !== expected.requestHash
  ) {
    throw new InventoryAssignmentError(
      "That Idempotency-Key was already used for another resource, actor, or payload.",
      409,
    );
  }
  return { response: replayResponse(existing.response), replayed: true } as const;
};

export async function listInventoryAssignments(
  organizationId: string,
  resourceId: string,
) {
  return db.transaction(async (transaction) => {
  const [resource] = await transaction
    .select({ id: resources.id, name: resources.name, quantity: resources.quantity })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (!resource) return null;

  const [
    assignmentRows,
    settingsRows,
    lendingRows,
    availableUnitRows,
    activeQuantityRows,
    reservedQuantityRows,
    recipientUserRows,
  ] = await Promise.all([
      transaction
        .select()
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.resourceId, resourceId),
          ),
        )
        .orderBy(
          asc(inventoryAssignments.status),
          desc(inventoryAssignments.startsAt),
        )
        .limit(200),
      transaction
        .select({ trackingMode: stockSettings.trackingMode })
        .from(stockSettings)
        .where(
          and(
            eq(stockSettings.organizationId, organizationId),
            eq(stockSettings.resourceId, resourceId),
          ),
        )
        .limit(1),
      transaction
        .select()
        .from(resourceLendingSettings)
        .where(
          and(
            eq(resourceLendingSettings.organizationId, organizationId),
            eq(resourceLendingSettings.resourceId, resourceId),
          ),
        )
        .limit(1),
      transaction
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
            eq(stockUnits.resourceId, resourceId),
            eq(stockUnits.status, "available"),
          ),
        )
        .orderBy(asc(stockUnits.code))
        .limit(500),
      transaction
        .select({
          value: sql<number>`coalesce(sum(${inventoryAssignments.quantity}), 0)::int`,
        })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.resourceId, resourceId),
            eq(inventoryAssignments.status, "active"),
            eq(inventoryAssignments.stockApplied, true),
          ),
        ),
      transaction
        .select({
          value: sql<number>`coalesce(sum(${inventoryAssignments.quantity}), 0)::int`,
        })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.resourceId, resourceId),
            eq(inventoryAssignments.kind, "reservation"),
            eq(inventoryAssignments.status, "active"),
          ),
        ),
      transaction
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .innerJoin(
          organizationMemberships,
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, users.id),
            eq(organizationMemberships.isActive, true),
          ),
        )
        .where(eq(users.isActive, true))
        .orderBy(asc(users.name), asc(users.email))
        .limit(500),
    ]);

  const userIds = Array.from(
    new Set(
      assignmentRows
        .map((row) => row.assigneeUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const assigneeResourceIds = Array.from(
    new Set(
      assignmentRows
        .map((row) => row.assigneeResourceId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const assignedUnitIds = Array.from(
    new Set(
      assignmentRows
        .map((row) => row.stockUnitId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [userRows, assigneeResourceRows, assignedUnitRows] = await Promise.all([
    userIds.length
      ? transaction
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    assigneeResourceIds.length
      ? transaction
          .select({ id: resources.id, name: resources.name })
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              inArray(resources.id, assigneeResourceIds),
            ),
          )
      : Promise.resolve([]),
    assignedUnitIds.length
      ? transaction
          .select({ id: stockUnits.id, code: stockUnits.code, status: stockUnits.status })
          .from(stockUnits)
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              inArray(stockUnits.id, assignedUnitIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const userLabels = new Map(
    userRows.map((row) => [row.id, { name: row.name, email: row.email }]),
  );
  const resourceLabels = new Map(
    assigneeResourceRows.map((row) => [row.id, row.name]),
  );
  const units = new Map(
    assignedUnitRows.map((row) => [
      row.id,
      { code: row.code, status: row.status },
    ]),
  );
  const activeQuantity = Number(activeQuantityRows[0]?.value ?? 0);
  const reservedQuantity = Number(reservedQuantityRows[0]?.value ?? 0);

  return {
    resource,
    trackingMode: settingsRows[0]?.trackingMode ?? "bulk",
    lending: lendingSettingsDto(lendingRows[0]),
    availability: {
      availableQuantity: resource.quantity,
      activeQuantity,
      reservedQuantity,
    },
    recipients: { users: recipientUserRows },
    availableUnits: availableUnitRows,
    assignments: assignmentRows.map((row) =>
      assignmentDto(
        row,
        { users: userLabels, resources: resourceLabels },
        row.stockUnitId ? units.get(row.stockUnitId) : null,
      ),
    ),
  };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

async function resolveRecipient(
  transaction: Transaction,
  organizationId: string,
  resourceId: string,
  recipient: AssignmentRecipient,
) {
  if (recipient.type === "label") {
    const label = recipient.label.trim();
    if (!label) {
      throw new InventoryAssignmentError("Enter an assignment recipient.", 422);
    }
    if (label.length > 240) {
      throw new InventoryAssignmentError(
        "The assignment recipient may contain at most 240 characters.",
        422,
      );
    }
    return {
      values: { assigneeLabel: label },
      label,
    };
  }
  if (recipient.type === "user") {
    const [user] = await transaction
      .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive })
      .from(users)
      .innerJoin(
        organizationMemberships,
        and(
          eq(organizationMemberships.userId, users.id),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.isActive, true),
        ),
      )
      .where(eq(users.id, recipient.userId))
      .limit(1);
    if (!user || !user.isActive) {
      throw new InventoryAssignmentError("The selected user is not active.", 422);
    }
    return {
      values: { assigneeUserId: user.id },
      label: user.name || user.email,
    };
  }

  if (recipient.resourceId === resourceId) {
    throw new InventoryAssignmentError(
      "An inventory item cannot be assigned to itself.",
      422,
    );
  }
  const [assigneeResource] = await transaction
    .select({ id: resources.id, name: resources.name })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, recipient.resourceId),
      ),
    )
    .limit(1);
  if (!assigneeResource) {
    throw new InventoryAssignmentError("The selected recipient item does not exist.", 422);
  }
  return {
    values: { assigneeResourceId: assigneeResource.id },
    label: assigneeResource.name,
  };
}

function assertLoanPolicy(
  kind: AssignmentKind,
  startsAt: Date,
  dueAt: Date | null | undefined,
  lending: ReturnType<typeof lendingSettingsDto>,
) {
  if (kind === "assignment") return;
  if (!lending.enabled) {
    throw new InventoryAssignmentError(
      "This inventory item is not enabled for loans or reservations.",
      422,
    );
  }
  if (!dueAt) {
    throw new InventoryAssignmentError(
      "Loans and reservations require a return date.",
      422,
    );
  }
  if (dueAt <= startsAt) {
    throw new InventoryAssignmentError(
      "The return date must be after the assignment start.",
      422,
    );
  }
  if (loanWindowDurationDays(startsAt, dueAt) > lending.maxDurationDays) {
    throw new InventoryAssignmentError(
      `This item may be borrowed for at most ${lending.maxDurationDays} days.`,
      422,
    );
  }
  if (kind === "reservation" && startsAt <= new Date()) {
    throw new InventoryAssignmentError(
      "A reservation must start in the future. Create a loan for an immediate checkout.",
      422,
    );
  }
}

async function assertReservationAvailability(
  transaction: Transaction,
  organizationId: string,
  resource: { id: string; name: string; quantity: number },
  quantity: number,
  startsAt: Date,
  dueAt: Date,
) {
  const [appliedRows, overlappingRows, approvedRows, variantRows] =
    await Promise.all([
      transaction
        .select({
          value: sql<number>`coalesce(sum(${inventoryAssignments.quantity}), 0)::int`,
        })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.resourceId, resource.id),
            eq(inventoryAssignments.status, "active"),
            eq(inventoryAssignments.stockApplied, true),
          ),
        ),
      transaction
        .select({
          value: sql<number>`coalesce(sum(${inventoryAssignments.quantity}), 0)::int`,
        })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.resourceId, resource.id),
            eq(inventoryAssignments.status, "active"),
            lt(inventoryAssignments.startsAt, dueAt),
            or(
              isNull(inventoryAssignments.dueAt),
              gt(inventoryAssignments.dueAt, startsAt),
            ),
          ),
        ),
      transaction
        .select({
          value: sql<number>`coalesce(sum(${internalRequestLines.quantity}), 0)::int`,
        })
        .from(internalRequestLines)
        .innerJoin(
          internalRequests,
          and(
            eq(internalRequests.organizationId, organizationId),
            eq(internalRequests.id, internalRequestLines.requestId),
          ),
        )
        .where(
          and(
            eq(internalRequestLines.organizationId, organizationId),
            eq(internalRequestLines.resourceId, resource.id),
            eq(internalRequests.status, "approved"),
            lt(internalRequests.startsAt, dueAt),
            gt(internalRequests.dueAt, startsAt),
          ),
        ),
      transaction
        .select({
          value: sql<number>`coalesce(sum(${resourceVariants.quantity}), 0)::int`,
        })
        .from(resourceVariants)
        .where(
          and(
            eq(resourceVariants.organizationId, organizationId),
            eq(resourceVariants.resourceId, resource.id),
          ),
        ),
    ]);

  const capacity =
    resource.quantity +
    Number(appliedRows[0]?.value ?? 0) -
    Number(variantRows[0]?.value ?? 0);
  const allocated =
    Number(overlappingRows[0]?.value ?? 0) +
    Number(approvedRows[0]?.value ?? 0);
  const available = Math.max(0, capacity - allocated);
  if (quantity > available) {
    throw new InventoryAssignmentError(
      `${resource.name} has only ${available} available for the selected period.`,
      409,
    );
  }
}

export async function createInventoryAssignment(
  organizationId: string,
  resourceId: string,
  input: CreateInventoryAssignmentInput,
  actor: string,
  idempotency: AssignmentIdempotency,
) {
  const replayExpected = {
    resourceId,
    actor,
    requestHash: idempotency.requestHash,
  };

  try {
    return await db.transaction(async (transaction) => {
      const [earlyReplay] = await transaction
        .select()
        .from(stockMovementRequests)
        .where(
          and(
            eq(stockMovementRequests.organizationId, organizationId),
            eq(stockMovementRequests.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (earlyReplay) return validateReplay(earlyReplay, replayExpected);

      const [resource] = await transaction
        .select({
          id: resources.id,
          name: resources.name,
          quantity: resources.quantity,
          allowNegativeStock: organizations.allowNegativeStock,
        })
        .from(resources)
        .innerJoin(
          organizations,
          eq(organizations.id, resources.organizationId),
        )
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, resourceId),
          ),
        )
        .limit(1)
        .for("update");
      if (!resource) throw new InventoryAssignmentError("Not found", 404);

      const [lockedReplay] = await transaction
        .select()
        .from(stockMovementRequests)
        .where(
          and(
            eq(stockMovementRequests.organizationId, organizationId),
            eq(stockMovementRequests.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (lockedReplay) return validateReplay(lockedReplay, replayExpected);

      if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
        throw new InventoryAssignmentError(
          "Assignment quantity must be a positive whole number.",
          422,
        );
      }
      const startsAt = input.startsAt ?? new Date();
      if (Number.isNaN(startsAt.getTime())) {
        throw new InventoryAssignmentError("Invalid assignment start date.", 422);
      }
      if (input.dueAt && Number.isNaN(input.dueAt.getTime())) {
        throw new InventoryAssignmentError("Invalid assignment due date.", 422);
      }
      if (input.dueAt && input.dueAt <= startsAt) {
        throw new InventoryAssignmentError(
          "The due date must be after the assignment start.",
          422,
        );
      }

      const [[settings], [lendingRow]] = await Promise.all([
        transaction
          .select({ trackingMode: stockSettings.trackingMode })
          .from(stockSettings)
          .where(
            and(
              eq(stockSettings.organizationId, organizationId),
              eq(stockSettings.resourceId, resourceId),
            ),
          )
          .limit(1),
        transaction
          .select()
          .from(resourceLendingSettings)
          .where(
            and(
              eq(resourceLendingSettings.organizationId, organizationId),
              eq(resourceLendingSettings.resourceId, resourceId),
            ),
          )
          .limit(1),
      ]);
      const trackingMode = settings?.trackingMode ?? "bulk";
      const lending = lendingSettingsDto(lendingRow);
      assertLoanPolicy(input.kind, startsAt, input.dueAt, lending);
      if (input.kind === "reservation") {
        await assertReservationAvailability(
          transaction,
          organizationId,
          resource,
          input.quantity,
          startsAt,
          input.dueAt!,
        );
      }
      const recipient = await resolveRecipient(
        transaction,
        organizationId,
        resourceId,
        input.recipient,
      );
      const [{ allocated }] = await transaction
        .select({
          allocated: sql<number>`coalesce(sum(${inventoryAssignments.quantity}), 0)::int`,
        })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.resourceId, resourceId),
            eq(inventoryAssignments.status, "active"),
            eq(inventoryAssignments.stockApplied, true),
            isNull(inventoryAssignments.stockUnitId),
          ),
        );
      const activeBulkQuantity = Number(allocated ?? 0);

      let unit: typeof stockUnits.$inferSelect | null = null;
      if (trackingMode === "serialized") {
        if (input.quantity !== 1) {
          throw new InventoryAssignmentError(
            "A serialized assignment must contain exactly one unit.",
            422,
          );
        }
        if (input.kind === "reservation" && input.stockUnitId) {
          throw new InventoryAssignmentError(
            "Choose the serialized unit when the reservation is checked out.",
            422,
          );
        }
        if (input.kind !== "reservation") {
          if (!input.stockUnitId) {
            throw new InventoryAssignmentError(
              "Choose an available serialized unit.",
              422,
            );
          }
          [unit] = await transaction
            .select()
            .from(stockUnits)
            .where(
              and(
                eq(stockUnits.organizationId, organizationId),
                eq(stockUnits.id, input.stockUnitId),
                eq(stockUnits.resourceId, resourceId),
              ),
            )
            .limit(1)
            .for("update");
          if (!unit) throw new InventoryAssignmentError("Unit not found", 404);
          if (unit.status !== "available") {
            throw new InventoryAssignmentError(
              `Unit ${unit.code} is currently ${unit.status} and cannot be allocated.`,
              409,
            );
          }
          const [activeUnitAssignment] = await transaction
            .select({ id: inventoryAssignments.id })
            .from(inventoryAssignments)
            .where(
              and(
                eq(inventoryAssignments.organizationId, organizationId),
                eq(inventoryAssignments.stockUnitId, unit.id),
                eq(inventoryAssignments.status, "active"),
              ),
            )
            .limit(1);
          if (activeUnitAssignment) {
            throw new InventoryAssignmentError(
              "This serialized unit already has an active assignment.",
              409,
            );
          }
        }
      } else if (input.stockUnitId) {
        throw new InventoryAssignmentError(
          "Bulk inventory cannot be allocated by serialized unit id.",
          422,
        );
      }

      if (
        input.kind !== "reservation" &&
        (!resource.allowNegativeStock || trackingMode === "serialized") &&
        input.quantity > resource.quantity
      ) {
        throw new InventoryAssignmentError(
          `Only ${resource.quantity} units are available; ${activeBulkQuantity} bulk units are already allocated.`,
          409,
        );
      }
      if (
        input.kind !== "reservation" &&
        trackingMode === "bulk" &&
        !resource.allowNegativeStock
      ) {
        const [{ located }] = await transaction
          .select({
            located: sql<number>`coalesce(sum(${stockLocationBalances.quantity}), 0)::int`,
          })
          .from(stockLocationBalances)
          .where(
            and(
              eq(stockLocationBalances.organizationId, organizationId),
              eq(stockLocationBalances.resourceId, resourceId),
            ),
          );
        const unassignedQuantity = resource.quantity - Number(located ?? 0);
        if (input.quantity > unassignedQuantity) {
          throw new InventoryAssignmentError(
            `Only ${Math.max(0, unassignedQuantity)} unassigned units are available. Move stock to “Not assigned” before allocating it, so location balances stay accurate.`,
            409,
          );
        }
      }

      const now = new Date();
      const [assignment] = await transaction
        .insert(inventoryAssignments)
        .values({
          organizationId,
          resourceId,
          stockUnitId: unit?.id ?? null,
          kind: input.kind,
          status: "active",
          stockApplied: input.kind !== "reservation",
          quantity: input.quantity,
          ...recipient.values,
          startsAt,
          dueAt: input.dueAt ?? null,
          note: input.note ?? "",
          createdBy: actor,
          updatedAt: now,
        })
        .returning();

      const balanceAfter =
        input.kind === "reservation"
          ? resource.quantity
          : resource.quantity - input.quantity;
      if (balanceAfter < -MAX_STOCK_QUANTITY) {
        throw new InventoryAssignmentError(
          `This assignment exceeds the minimum supported stock of -${MAX_STOCK_QUANTITY}.`,
          409,
        );
      }
      if (input.kind !== "reservation" && !resource.allowNegativeStock) {
        const variantAllocation = await allocatedVariantQuantity(
          transaction,
          resourceId,
        );
        assertVariantAllocationFits(
          balanceAfter,
          variantAllocation,
          (message) => new InventoryAssignmentError(message, 409),
        );
      }
      if (input.kind !== "reservation") {
        await transaction
          .update(resources)
          .set({ quantity: balanceAfter, updatedAt: now })
          .where(
            and(
              eq(resources.organizationId, organizationId),
              eq(resources.id, resourceId),
            ),
          );
      }
      const unitStatus = "in-use";
      if (unit) {
        await transaction
          .update(stockUnits)
          .set({ status: unitStatus, lastMovedAt: now, updatedAt: now })
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              eq(stockUnits.id, unit.id),
            ),
          );
      }
      const [movement] = await transaction
        .insert(stockMovements)
        .values({
          organizationId,
          resourceId,
          unitId: unit?.id ?? null,
          delta: input.kind === "reservation" ? 0 : -input.quantity,
          quantity: input.quantity,
          balanceAfter,
          type: `assignment-${input.kind}`,
          reason: `${input.kind === "reservation" ? "Reserved" : "Allocated"} for ${recipient.label}`.slice(0, 240),
          note: input.note
            ? `Assignment ${assignment.id}: ${input.note}`
            : `Assignment ${assignment.id}`,
          location: unit?.location ?? null,
          fromLocationResourceId: unit?.locationResourceId ?? null,
          occurredAt: now,
          createdBy: actor,
        })
        .returning();
      await enqueueStockMovementWebhookEvents(transaction, [movement]);
      const response: StoredMutationResponse = {
        assignment: assignmentDto(
          assignment,
          input.recipient.type === "user"
            ? {
                users: new Map([
                  [
                    input.recipient.userId,
                    { name: recipient.label, email: "" },
                  ],
                ]),
              }
            : input.recipient.type === "resource"
              ? {
                  resources: new Map([
                    [input.recipient.resourceId, recipient.label],
                  ]),
                }
              : {},
          unit ? { code: unit.code, status: unitStatus } : null,
        ),
        resource: { ...resource, quantity: balanceAfter },
        movement: movementDto(movement),
      };
      await transaction.insert(stockMovementRequests).values({
        organizationId,
        idempotencyKey: idempotency.key,
        resourceId,
        actor,
        requestHash: idempotency.requestHash,
        response: storedResponse(response),
      });
      return { response, replayed: false } as const;
    });
  } catch (error) {
    const [winner] = await db
      .select()
      .from(stockMovementRequests)
      .where(
        and(
          eq(stockMovementRequests.organizationId, organizationId),
          eq(stockMovementRequests.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (winner) return validateReplay(winner, replayExpected);
    throw error;
  }
}

export async function listLoanAssignments(
  organizationId: string,
  limit = 500,
) {
  const rows = await db
    .select({
      assignment: inventoryAssignments,
      resource: {
        id: resources.id,
        name: resources.name,
        sku: resources.sku,
        status: resources.status,
      },
      trackingMode: stockSettings.trackingMode,
      unit: {
        code: stockUnits.code,
        status: stockUnits.status,
      },
    })
    .from(inventoryAssignments)
    .innerJoin(
      resources,
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, inventoryAssignments.resourceId),
      ),
    )
    .leftJoin(
      stockSettings,
      and(
        eq(stockSettings.organizationId, organizationId),
        eq(stockSettings.resourceId, inventoryAssignments.resourceId),
      ),
    )
    .leftJoin(
      stockUnits,
      and(
        eq(stockUnits.organizationId, organizationId),
        eq(stockUnits.id, inventoryAssignments.stockUnitId),
      ),
    )
    .where(
      and(
        eq(inventoryAssignments.organizationId, organizationId),
        inArray(inventoryAssignments.kind, ["checkout", "reservation"]),
      ),
    )
    .orderBy(
      asc(inventoryAssignments.status),
      asc(inventoryAssignments.dueAt),
      desc(inventoryAssignments.startsAt),
    )
    .limit(Math.min(500, Math.max(1, limit)));

  const userIds = Array.from(
    new Set(
      rows
        .map((row) => row.assignment.assigneeUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const assigneeResourceIds = Array.from(
    new Set(
      rows
        .map((row) => row.assignment.assigneeResourceId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [userRows, assigneeResourceRows] = await Promise.all([
    userIds.length
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
    assigneeResourceIds.length
      ? db
          .select({ id: resources.id, name: resources.name })
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              inArray(resources.id, assigneeResourceIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const userLabels = new Map(
    userRows.map((row) => [row.id, { name: row.name, email: row.email }]),
  );
  const resourceLabels = new Map(
    assigneeResourceRows.map((row) => [row.id, row.name]),
  );

  return {
    assignments: rows.map((row) => ({
      ...assignmentDto(
        row.assignment,
        { users: userLabels, resources: resourceLabels },
        row.assignment.stockUnitId && row.unit?.code && row.unit.status
          ? { code: row.unit.code, status: row.unit.status }
          : null,
      ),
      resource: row.resource,
      trackingMode: row.trackingMode ?? "bulk",
    })),
  };
}

export async function activateInventoryReservation(
  organizationId: string,
  assignmentId: string,
  input: ActivateInventoryReservationInput,
  actor: string,
  idempotency: AssignmentIdempotency,
) {
  const replayExpected = { actor, requestHash: idempotency.requestHash };

  try {
    return await db.transaction(async (transaction) => {
      const [earlyReplay] = await transaction
        .select()
        .from(stockMovementRequests)
        .where(
          and(
            eq(stockMovementRequests.organizationId, organizationId),
            eq(stockMovementRequests.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (earlyReplay) return validateReplay(earlyReplay, replayExpected);

      const [snapshot] = await transaction
        .select({ resourceId: inventoryAssignments.resourceId })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.id, assignmentId),
          ),
        )
        .limit(1);
      if (!snapshot) {
        throw new InventoryAssignmentError("Reservation not found", 404);
      }

      const [resource] = await transaction
        .select({
          id: resources.id,
          name: resources.name,
          quantity: resources.quantity,
          allowNegativeStock: organizations.allowNegativeStock,
        })
        .from(resources)
        .innerJoin(organizations, eq(organizations.id, resources.organizationId))
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, snapshot.resourceId),
          ),
        )
        .limit(1)
        .for("update");
      if (!resource) {
        throw new InventoryAssignmentError("Inventory item not found", 404);
      }

      const [assignment] = await transaction
        .select()
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.id, assignmentId),
          ),
        )
        .limit(1)
        .for("update");
      if (!assignment) {
        throw new InventoryAssignmentError("Reservation not found", 404);
      }
      if (assignment.kind !== "reservation" || assignment.status !== "active") {
        throw new InventoryAssignmentError(
          "Only an active reservation can be checked out.",
          409,
        );
      }

      const checkedOutAt = input.checkedOutAt ?? new Date();
      if (Number.isNaN(checkedOutAt.getTime())) {
        throw new InventoryAssignmentError("Invalid checkout date.", 422);
      }
      if (assignment.dueAt && assignment.dueAt <= checkedOutAt) {
        throw new InventoryAssignmentError(
          "This reservation has already passed its return date.",
          409,
        );
      }

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
      const trackingMode = settings?.trackingMode ?? "bulk";
      let unit: typeof stockUnits.$inferSelect | null = null;
      const selectedUnitId = input.stockUnitId ?? assignment.stockUnitId;
      if (trackingMode === "serialized") {
        if (assignment.quantity !== 1 || !selectedUnitId) {
          throw new InventoryAssignmentError(
            "Choose an available serialized unit for checkout.",
            422,
          );
        }
        [unit] = await transaction
          .select()
          .from(stockUnits)
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              eq(stockUnits.resourceId, resource.id),
              eq(stockUnits.id, selectedUnitId),
            ),
          )
          .limit(1)
          .for("update");
        if (!unit) throw new InventoryAssignmentError("Unit not found", 404);
        const expectedStatus = assignment.stockApplied ? "reserved" : "available";
        if (
          unit.status !== expectedStatus &&
          !(assignment.stockApplied && unit.status === "in-use")
        ) {
          throw new InventoryAssignmentError(
            `Unit ${unit.code} is currently ${unit.status} and cannot be checked out.`,
            409,
          );
        }
        const [conflict] = await transaction
          .select({ id: inventoryAssignments.id })
          .from(inventoryAssignments)
          .where(
            and(
              eq(inventoryAssignments.organizationId, organizationId),
              eq(inventoryAssignments.stockUnitId, unit.id),
              eq(inventoryAssignments.status, "active"),
              sql`${inventoryAssignments.id} <> ${assignment.id}`,
            ),
          )
          .limit(1);
        if (conflict) {
          throw new InventoryAssignmentError(
            "This serialized unit already has an active assignment.",
            409,
          );
        }
      } else if (selectedUnitId) {
        throw new InventoryAssignmentError(
          "Bulk inventory cannot be checked out by serialized unit id.",
          422,
        );
      }

      if (
        !assignment.stockApplied &&
        (!resource.allowNegativeStock || trackingMode === "serialized") &&
        assignment.quantity > resource.quantity
      ) {
        throw new InventoryAssignmentError(
          `Only ${resource.quantity} units are currently available.`,
          409,
        );
      }
      if (
        !assignment.stockApplied &&
        trackingMode === "bulk" &&
        !resource.allowNegativeStock
      ) {
        const [{ located }] = await transaction
          .select({
            located: sql<number>`coalesce(sum(${stockLocationBalances.quantity}), 0)::int`,
          })
          .from(stockLocationBalances)
          .where(
            and(
              eq(stockLocationBalances.organizationId, organizationId),
              eq(stockLocationBalances.resourceId, resource.id),
            ),
          );
        const unassigned = resource.quantity - Number(located ?? 0);
        if (assignment.quantity > unassigned) {
          throw new InventoryAssignmentError(
            `Only ${Math.max(0, unassigned)} unassigned units are available. Move stock to “Not assigned” before checkout.`,
            409,
          );
        }
      }

      const balanceAfter = assignment.stockApplied
        ? resource.quantity
        : resource.quantity - assignment.quantity;
      if (!resource.allowNegativeStock && !assignment.stockApplied) {
        const variantAllocation = await allocatedVariantQuantity(
          transaction,
          resource.id,
        );
        assertVariantAllocationFits(
          balanceAfter,
          variantAllocation,
          (message) => new InventoryAssignmentError(message, 409),
        );
      }

      const now = new Date();
      const [savedAssignment] = await transaction
        .update(inventoryAssignments)
        .set({
          kind: "checkout",
          stockUnitId: unit?.id ?? null,
          stockApplied: true,
          startsAt: checkedOutAt,
          note: input.note ?? assignment.note,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.id, assignment.id),
          ),
        )
        .returning();
      if (!assignment.stockApplied) {
        await transaction
          .update(resources)
          .set({ quantity: balanceAfter, updatedAt: now })
          .where(
            and(
              eq(resources.organizationId, organizationId),
              eq(resources.id, resource.id),
            ),
          );
      }
      if (unit) {
        await transaction
          .update(stockUnits)
          .set({ status: "in-use", lastMovedAt: checkedOutAt, updatedAt: now })
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              eq(stockUnits.id, unit.id),
            ),
          );
      }

      const [movement] = await transaction
        .insert(stockMovements)
        .values({
          organizationId,
          resourceId: resource.id,
          unitId: unit?.id ?? null,
          delta: assignment.stockApplied ? 0 : -assignment.quantity,
          quantity: assignment.quantity,
          balanceAfter,
          type: "reservation-checkout",
          reason: "Reservation checked out",
          note: input.note
            ? `Assignment ${assignment.id}: ${input.note}`
            : `Assignment ${assignment.id}`,
          location: unit?.location ?? null,
          fromLocationResourceId: unit?.locationResourceId ?? null,
          occurredAt: checkedOutAt,
          createdBy: actor,
        })
        .returning();
      await enqueueStockMovementWebhookEvents(transaction, [movement]);
      const response: StoredMutationResponse = {
        assignment: assignmentDto(
          savedAssignment,
          {},
          unit ? { code: unit.code, status: "in-use" } : null,
        ),
        resource: { ...resource, quantity: balanceAfter },
        movement: movementDto(movement),
      };
      await transaction.insert(stockMovementRequests).values({
        organizationId,
        idempotencyKey: idempotency.key,
        resourceId: resource.id,
        actor,
        requestHash: idempotency.requestHash,
        response: storedResponse(response),
      });
      return { response, replayed: false } as const;
    });
  } catch (error) {
    const [winner] = await db
      .select()
      .from(stockMovementRequests)
      .where(
        and(
          eq(stockMovementRequests.organizationId, organizationId),
          eq(stockMovementRequests.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (winner) return validateReplay(winner, replayExpected);
    throw error;
  }
}

export async function completeInventoryAssignment(
  organizationId: string,
  assignmentId: string,
  input: CompleteInventoryAssignmentInput,
  actor: string,
  idempotency: AssignmentIdempotency,
) {
  const replayExpected = {
    actor,
    requestHash: idempotency.requestHash,
  };

  try {
    return await db.transaction(async (transaction) => {
      const [earlyReplay] = await transaction
        .select()
        .from(stockMovementRequests)
        .where(
          and(
            eq(stockMovementRequests.organizationId, organizationId),
            eq(stockMovementRequests.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (earlyReplay) return validateReplay(earlyReplay, replayExpected);

      const [snapshot] = await transaction
        .select({ resourceId: inventoryAssignments.resourceId })
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.id, assignmentId),
          ),
        )
        .limit(1);
      if (!snapshot) throw new InventoryAssignmentError("Assignment not found", 404);

      const [resource] = await transaction
        .select({ id: resources.id, name: resources.name, quantity: resources.quantity })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, snapshot.resourceId),
          ),
        )
        .limit(1)
        .for("update");
      if (!resource) throw new InventoryAssignmentError("Inventory item not found", 404);

      const [lockedReplay] = await transaction
        .select()
        .from(stockMovementRequests)
        .where(
          and(
            eq(stockMovementRequests.organizationId, organizationId),
            eq(stockMovementRequests.idempotencyKey, idempotency.key),
          ),
        )
        .limit(1);
      if (lockedReplay) {
        return validateReplay(lockedReplay, {
          ...replayExpected,
          resourceId: resource.id,
        });
      }

      const [assignment] = await transaction
        .select()
        .from(inventoryAssignments)
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.id, assignmentId),
          ),
        )
        .limit(1)
        .for("update");
      if (!assignment) throw new InventoryAssignmentError("Assignment not found", 404);
      if (assignment.resourceId !== resource.id) {
        throw new InventoryAssignmentError("Assignment resource changed unexpectedly.", 409);
      }
      if (assignment.status !== "active") {
        throw new InventoryAssignmentError(
          `This assignment is already ${assignment.status}.`,
          409,
        );
      }
      if (assignment.kind === "reservation" && input.status === "returned") {
        throw new InventoryAssignmentError(
          "A reservation must be checked out before it can be returned.",
          409,
        );
      }

      let unit: typeof stockUnits.$inferSelect | null = null;
      if (assignment.stockUnitId) {
        [unit] = await transaction
          .select()
          .from(stockUnits)
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              eq(stockUnits.id, assignment.stockUnitId),
              eq(stockUnits.resourceId, resource.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!unit) throw new InventoryAssignmentError("Assigned unit not found", 404);
      }

      const completedAt = input.completedAt ?? new Date();
      if (
        Number.isNaN(completedAt.getTime()) ||
        (input.status === "returned" && completedAt < assignment.startsAt)
      ) {
        throw new InventoryAssignmentError(
          "The completion date cannot be before the assignment start.",
          422,
        );
      }
      const quantityRestored = assignment.stockApplied
        ? unit?.status === "available"
          ? 0
          : assignment.quantity
        : 0;
      const balanceAfter = resource.quantity + quantityRestored;
      if (balanceAfter > MAX_STOCK_QUANTITY) {
        throw new InventoryAssignmentError(
          `Completing this assignment would exceed the maximum supported stock of ${MAX_STOCK_QUANTITY}.`,
          409,
        );
      }
      const now = new Date();
      const [savedAssignment] = await transaction
        .update(inventoryAssignments)
        .set({
          status: input.status,
          completedAt,
          completedBy: actor,
          note: input.note ?? assignment.note,
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryAssignments.organizationId, organizationId),
            eq(inventoryAssignments.id, assignment.id),
          ),
        )
        .returning();
      if (unit && assignment.stockApplied) {
        await transaction
          .update(stockUnits)
          .set({ status: "available", lastMovedAt: completedAt, updatedAt: now })
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              eq(stockUnits.id, unit.id),
            ),
          );
      }
      await transaction
        .update(resources)
        .set({ quantity: balanceAfter, updatedAt: now })
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, resource.id),
          ),
        );
      const [movement] = await transaction
        .insert(stockMovements)
        .values({
          organizationId,
          resourceId: resource.id,
          unitId: unit?.id ?? null,
          delta: quantityRestored,
          quantity: assignment.quantity,
          balanceAfter,
          type:
            input.status === "returned"
              ? "assignment-return"
              : "assignment-cancel",
          reason:
            input.status === "returned"
              ? "Assignment returned"
              : "Assignment cancelled",
          note: input.note
            ? `Assignment ${assignment.id}: ${input.note}`
            : `Assignment ${assignment.id}`,
          location: unit?.location ?? null,
          toLocationResourceId: unit?.locationResourceId ?? null,
          occurredAt: completedAt,
          createdBy: actor,
        })
        .returning();
      await enqueueStockMovementWebhookEvents(transaction, [movement]);
      const response: StoredMutationResponse = {
        assignment: assignmentDto(
          savedAssignment,
          {},
          unit ? { code: unit.code, status: "available" } : null,
        ),
        resource: { ...resource, quantity: balanceAfter },
        movement: movementDto(movement),
      };
      await transaction.insert(stockMovementRequests).values({
        organizationId,
        idempotencyKey: idempotency.key,
        resourceId: resource.id,
        actor,
        requestHash: idempotency.requestHash,
        response: storedResponse(response),
      });
      return { response, replayed: false } as const;
    });
  } catch (error) {
    const [winner] = await db
      .select()
      .from(stockMovementRequests)
      .where(
        and(
          eq(stockMovementRequests.organizationId, organizationId),
          eq(stockMovementRequests.idempotencyKey, idempotency.key),
        ),
      )
      .limit(1);
    if (winner) return validateReplay(winner, replayExpected);
    throw error;
  }
}
