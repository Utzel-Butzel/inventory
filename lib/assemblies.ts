import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  assemblyBuildComponents,
  assemblyBuilds,
  bomLines,
  resources,
  stockLocationBalances,
  stockMovements,
  stockSettings,
  stockUnits,
  type AssemblyBuildComponentRecord,
  type AssemblyBuildRecord,
  type ResourceRecord,
  type StockMovementRecord,
  type StockTrackingMode,
  type StockUnitRecord,
} from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueStockMovementWebhookEvents } from "@/lib/webhooks";
import { BOM_WRITE_LOCK_ID } from "@/lib/inventory-locks";
import {
  allocatedVariantQuantity,
  assertVariantAllocationFits,
} from "@/lib/variant-stock-invariant";

const MAX_STOCK_QUANTITY = 2_000_000_000;

export type BomComponentInput = {
  resourceId: string;
  quantityPerAssembly: number;
  position?: number;
  note?: string;
};

export type AssemblyBuildInput = {
  quantity: number;
  occurredAt?: Date;
  location?: string | null;
  note?: string;
  componentUnitIds?: Record<string, string[]>;
  outputUnitCodes?: string[];
};

type IdempotencyInput = { key: string; requestHash: string };

export class AssemblyOperationError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "AssemblyOperationError";
  }
}

export function assemblyHttpError(error: unknown, fallback: string) {
  if (error instanceof AssemblyOperationError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("stock_units_resource_code_unique")) {
    return {
      status: 409 as const,
      message: "One of the output or component unit codes already exists.",
    };
  }
  if (message.includes("assembly_builds_idempotency_key_unique")) {
    return {
      status: 409 as const,
      message: "That Idempotency-Key was already used for another assembly build.",
    };
  }
  return { status: 500 as const, message: fallback };
}

const jsonRecord = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const trackingMode = (value: StockTrackingMode | null): StockTrackingMode =>
  value ?? "bulk";

const unitDto = (row: StockUnitRecord) => ({
  id: row.id,
  resourceId: row.resourceId,
  code: row.code,
  status: row.status,
  location: row.location,
  metadata: row.metadata,
  customFields: row.customFields,
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

export async function getBom(resourceId: string) {
  const [resource] = await db
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
      trackingMode: stockSettings.trackingMode,
    })
    .from(resources)
    .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
    .where(eq(resources.id, resourceId))
    .limit(1);
  if (!resource) return null;

  const rows = await db
    .select({
      id: bomLines.id,
      resourceId: resources.id,
      name: resources.name,
      sku: resources.sku,
      quantityPerAssembly: bomLines.quantityPerAssembly,
      position: bomLines.position,
      note: bomLines.note,
      availableQuantity: resources.quantity,
      trackingMode: stockSettings.trackingMode,
    })
    .from(bomLines)
    .innerJoin(resources, eq(resources.id, bomLines.componentResourceId))
    .leftJoin(stockSettings, eq(stockSettings.resourceId, resources.id))
    .where(eq(bomLines.assemblyResourceId, resourceId))
    .orderBy(asc(bomLines.position), asc(resources.name), asc(bomLines.id));

  const componentIds = rows.map((row) => row.resourceId);
  const availableUnitRows = componentIds.length
    ? await db
        .select()
        .from(stockUnits)
        .where(
          and(
            inArray(stockUnits.resourceId, componentIds),
            eq(stockUnits.status, "available"),
          ),
        )
        .orderBy(asc(stockUnits.resourceId), asc(stockUnits.code))
    : [];
  const unitsByResource = new Map<string, typeof availableUnitRows>();
  for (const unit of availableUnitRows) {
    const list = unitsByResource.get(unit.resourceId) ?? [];
    list.push(unit);
    unitsByResource.set(unit.resourceId, list);
  }

  const components = rows.map((row) => ({
    ...row,
    trackingMode: trackingMode(row.trackingMode),
    availableUnits: (unitsByResource.get(row.resourceId) ?? []).map((unit) => ({
      id: unit.id,
      code: unit.code,
      location: unit.location,
    })),
  }));
  const buildableQuantity = components.length
    ? Math.min(
        ...components.map((component) =>
          Math.floor(component.availableQuantity / component.quantityPerAssembly),
        ),
      )
    : 0;

  return {
    resource: {
      ...resource,
      trackingMode: trackingMode(resource.trackingMode),
    },
    components,
    buildableQuantity,
  };
}

const graphContainsPath = (
  adjacency: Map<string, string[]>,
  start: string,
  target: string,
) => {
  const pending = [start];
  const seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
};

export async function replaceBom(
  assemblyResourceId: string,
  components: BomComponentInput[],
) {
  await db.transaction(async (transaction) => {
    // Two concurrent replacements can otherwise each introduce one half of a
    // cycle. The transaction-scoped advisory lock serializes graph mutations.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(${BOM_WRITE_LOCK_ID})`,
    );

    const ids = Array.from(
      new Set([assemblyResourceId, ...components.map((item) => item.resourceId)]),
    ).sort();
    const lockedResources = await transaction
      .select({ id: resources.id })
      .from(resources)
      .where(inArray(resources.id, ids))
      .orderBy(asc(resources.id))
      .for("update");
    if (!lockedResources.some((item) => item.id === assemblyResourceId)) {
      throw new AssemblyOperationError("Not found", 404);
    }
    if (lockedResources.length !== ids.length) {
      throw new AssemblyOperationError(
        "One or more selected components no longer exist.",
        422,
      );
    }
    if (components.some((item) => item.resourceId === assemblyResourceId)) {
      throw new AssemblyOperationError(
        "An assembly cannot contain itself as a component.",
        422,
      );
    }
    if (new Set(components.map((item) => item.resourceId)).size !== components.length) {
      throw new AssemblyOperationError(
        "Each component may appear only once in a bill of materials.",
        422,
      );
    }

    const existingEdges = await transaction
      .select({
        parent: bomLines.assemblyResourceId,
        child: bomLines.componentResourceId,
      })
      .from(bomLines);
    const adjacency = new Map<string, string[]>();
    for (const edge of existingEdges) {
      if (edge.parent === assemblyResourceId) continue;
      const children = adjacency.get(edge.parent) ?? [];
      children.push(edge.child);
      adjacency.set(edge.parent, children);
    }
    adjacency.set(
      assemblyResourceId,
      components.map((item) => item.resourceId),
    );
    for (const component of components) {
      if (graphContainsPath(adjacency, component.resourceId, assemblyResourceId)) {
        throw new AssemblyOperationError(
          "This bill of materials would create a circular assembly dependency.",
          409,
        );
      }
    }

    await transaction
      .delete(bomLines)
      .where(eq(bomLines.assemblyResourceId, assemblyResourceId));
    if (components.length) {
      const now = new Date();
      await transaction.insert(bomLines).values(
        components.map((component, index) => ({
          assemblyResourceId,
          componentResourceId: component.resourceId,
          quantityPerAssembly: component.quantityPerAssembly,
          position: component.position ?? index,
          note: component.note ?? "",
          updatedAt: now,
        })),
      );
    }
  });

  const result = await getBom(assemblyResourceId);
  if (!result) throw new AssemblyOperationError("Not found", 404);
  return result;
}

type BuildComponentDto = {
  resourceId: string | null;
  name: string;
  sku: string | null;
  quantityPerAssembly: number;
  quantityConsumed: number;
  componentUnits: Array<{
    id: string;
    code: string;
    location: string | null;
    status: string;
    outputUnitId: string | null;
  }>;
  stockMovementIds: string[];
  outputUnitIds: string[];
};

function buildComponentsDto(
  rows: AssemblyBuildComponentRecord[],
  unitsById: Map<string, StockUnitRecord>,
) {
  const grouped = new Map<string, BuildComponentDto>();
  for (const row of rows) {
    const key = row.componentResourceId ?? `${row.componentName}:${row.componentSku ?? ""}`;
    const current = grouped.get(key) ?? {
      resourceId: row.componentResourceId,
      name: row.componentName,
      sku: row.componentSku,
      quantityPerAssembly: row.quantityPerAssembly,
      quantityConsumed: 0,
      componentUnits: [],
      stockMovementIds: [],
      outputUnitIds: [],
    };
    current.quantityConsumed += row.quantityConsumed;
    if (row.stockMovementId && !current.stockMovementIds.includes(row.stockMovementId)) {
      current.stockMovementIds.push(row.stockMovementId);
    }
    if (row.outputUnitId && !current.outputUnitIds.includes(row.outputUnitId)) {
      current.outputUnitIds.push(row.outputUnitId);
    }
    if (row.componentUnitId) {
      const unit = unitsById.get(row.componentUnitId);
      if (unit) {
        current.componentUnits.push({
          id: unit.id,
          code: unit.code,
          location: unit.location,
          status: unit.status,
          outputUnitId: row.outputUnitId,
        });
      }
    }
    grouped.set(key, current);
  }
  return Array.from(grouped.values());
}

const buildDto = (
  build: AssemblyBuildRecord,
  componentRows: AssemblyBuildComponentRecord[],
  unitsById: Map<string, StockUnitRecord>,
) => {
  const outputIds = Array.from(
    new Set(
      componentRows
        .map((component) => component.outputUnitId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  return {
    id: build.id,
    assemblyResourceId: build.assemblyResourceId,
    quantity: build.quantity,
    occurredAt: build.occurredAt.toISOString(),
    location: build.location,
    note: build.note,
    createdBy: build.createdBy,
    createdAt: build.createdAt.toISOString(),
    components: buildComponentsDto(componentRows, unitsById),
    outputUnits: outputIds
      .map((id) => unitsById.get(id))
      .filter((unit): unit is StockUnitRecord => Boolean(unit))
      .map(unitDto),
  };
};

export async function listAssemblyBuilds(
  assemblyResourceId: string,
  options: { limit?: number } = {},
) {
  const [resource] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.id, assemblyResourceId))
    .limit(1);
  if (!resource) return null;

  const builds = await db
    .select()
    .from(assemblyBuilds)
    .where(eq(assemblyBuilds.assemblyResourceId, assemblyResourceId))
    .orderBy(desc(assemblyBuilds.occurredAt), desc(assemblyBuilds.createdAt))
    .limit(Math.min(100, Math.max(1, options.limit ?? 50)));
  if (!builds.length) return { builds: [] };

  const buildIds = builds.map((build) => build.id);
  const componentRows = await db
    .select()
    .from(assemblyBuildComponents)
    .where(inArray(assemblyBuildComponents.buildId, buildIds))
    .orderBy(asc(assemblyBuildComponents.createdAt), asc(assemblyBuildComponents.id));
  const unitIds = Array.from(
    new Set(
      componentRows
        .flatMap((component) => [component.componentUnitId, component.outputUnitId])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const unitRows = unitIds.length
    ? await db.select().from(stockUnits).where(inArray(stockUnits.id, unitIds))
    : [];
  const unitsById = new Map(unitRows.map((unit) => [unit.id, unit]));
  const componentsByBuild = new Map<string, AssemblyBuildComponentRecord[]>();
  for (const component of componentRows) {
    const list = componentsByBuild.get(component.buildId) ?? [];
    list.push(component);
    componentsByBuild.set(component.buildId, list);
  }
  return {
    builds: builds.map((build) =>
      buildDto(build, componentsByBuild.get(build.id) ?? [], unitsById),
    ),
  };
}

const bomSignature = (
  rows: Array<{
    componentResourceId: string;
    quantityPerAssembly: number;
    position: number;
  }>,
) =>
  JSON.stringify(
    rows
      .map((row) => ({
        resourceId: row.componentResourceId,
        quantity: row.quantityPerAssembly,
        position: row.position,
      }))
      .sort((left, right) => left.resourceId.localeCompare(right.resourceId)),
  );

export async function buildAssembly(
  assemblyResourceId: string,
  input: AssemblyBuildInput,
  actor: string,
  idempotency: IdempotencyInput,
  authorize: (resource: ResourceRecord) => boolean | Promise<boolean>,
) {
  let lockedResourcesAuthorized = false;

  const validateReplay = (existing: AssemblyBuildRecord) => {
    if (
      existing.assemblyResourceId !== assemblyResourceId ||
      existing.createdBy !== actor ||
      existing.requestHash !== idempotency.requestHash
    ) {
      throw new AssemblyOperationError(
        "That Idempotency-Key was already used for another resource, actor, or payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  };

  try {
    return await db.transaction(async (transaction) => {
      const initialBom = await transaction
        .select({
          componentResourceId: bomLines.componentResourceId,
          quantityPerAssembly: bomLines.quantityPerAssembly,
          position: bomLines.position,
        })
        .from(bomLines)
        .where(eq(bomLines.assemblyResourceId, assemblyResourceId));

      const resourceIds = Array.from(
        new Set([
          assemblyResourceId,
          ...initialBom.map((line) => line.componentResourceId),
        ]),
      ).sort();
      const lockedResources = await transaction
        .select()
        .from(resources)
        .where(inArray(resources.id, resourceIds))
        .orderBy(asc(resources.id))
        .for("update");
      if (!lockedResources.some((resource) => resource.id === assemblyResourceId)) {
        throw new AssemblyOperationError("Not found", 404);
      }
      if (lockedResources.length !== resourceIds.length) {
        throw new AssemblyOperationError(
          "The assembly or one of its components no longer exists.",
          409,
        );
      }
      for (const resource of lockedResources) {
        if (!(await authorize(resource))) {
          throw new AssemblyOperationError(
            "You do not have permission to manage stock for every item in this assembly.",
            403,
          );
        }
      }
      lockedResourcesAuthorized = true;

      const [replayAfterLock] = await transaction
        .select()
        .from(assemblyBuilds)
        .where(eq(assemblyBuilds.idempotencyKey, idempotency.key))
        .limit(1);
      if (replayAfterLock) return validateReplay(replayAfterLock);

      if (!initialBom.length) {
        throw new AssemblyOperationError(
          "Define at least one component before building this assembly.",
          409,
        );
      }

      const currentBom = await transaction
        .select({
          id: bomLines.id,
          componentResourceId: bomLines.componentResourceId,
          quantityPerAssembly: bomLines.quantityPerAssembly,
          position: bomLines.position,
          note: bomLines.note,
          name: resources.name,
          sku: resources.sku,
        })
        .from(bomLines)
        .innerJoin(resources, eq(resources.id, bomLines.componentResourceId))
        .where(eq(bomLines.assemblyResourceId, assemblyResourceId))
        .orderBy(asc(bomLines.position), asc(bomLines.id));
      if (bomSignature(initialBom) !== bomSignature(currentBom)) {
        throw new AssemblyOperationError(
          "The bill of materials changed while this build was starting. Review and retry it.",
          409,
        );
      }

      const settingsRows = await transaction
        .select({
          resourceId: stockSettings.resourceId,
          trackingMode: stockSettings.trackingMode,
        })
        .from(stockSettings)
        .where(inArray(stockSettings.resourceId, resourceIds));
      const modeByResource = new Map(
        settingsRows.map((row) => [row.resourceId, row.trackingMode]),
      );
      const locatedRows = await transaction
        .select({
          resourceId: stockLocationBalances.resourceId,
          quantity: sql<number>`coalesce(sum(${stockLocationBalances.quantity}), 0)::int`,
        })
        .from(stockLocationBalances)
        .where(inArray(stockLocationBalances.resourceId, resourceIds))
        .groupBy(stockLocationBalances.resourceId);
      const locatedByResource = new Map(
        locatedRows.map((row) => [row.resourceId, Number(row.quantity)]),
      );
      const resourceById = new Map(lockedResources.map((row) => [row.id, row]));
      const assembly = resourceById.get(assemblyResourceId);
      if (!assembly) throw new AssemblyOperationError("Not found", 404);
      const assemblyMode = modeByResource.get(assemblyResourceId) ?? "bulk";
      if (assembly.quantity + input.quantity > MAX_STOCK_QUANTITY) {
        throw new AssemblyOperationError(
          `This build would exceed the maximum supported stock of ${MAX_STOCK_QUANTITY}.`,
          409,
        );
      }
      if (assemblyMode === "bulk" && input.outputUnitCodes?.length) {
        throw new AssemblyOperationError(
          "Output unit codes can only be supplied for serialized assemblies.",
          422,
        );
      }

      const bomComponentIds = new Set(
        currentBom.map((line) => line.componentResourceId),
      );
      for (const componentId of Object.keys(input.componentUnitIds ?? {})) {
        if (!bomComponentIds.has(componentId)) {
          throw new AssemblyOperationError(
            "componentUnitIds contains an item that is not in this bill of materials.",
            422,
          );
        }
        if ((modeByResource.get(componentId) ?? "bulk") !== "serialized") {
          throw new AssemblyOperationError(
            "Concrete component units may only be selected for serialized components.",
            422,
          );
        }
      }

      for (const line of currentBom) {
        const required = line.quantityPerAssembly * input.quantity;
        if (!Number.isSafeInteger(required) || required > MAX_STOCK_QUANTITY) {
          throw new AssemblyOperationError(
            `The required quantity for ${line.name} exceeds the supported range.`,
            422,
          );
        }
        const component = resourceById.get(line.componentResourceId);
        if (!component || component.quantity < required) {
          throw new AssemblyOperationError(
            `${line.name} needs ${required}, but only ${component?.quantity ?? 0} are available.`,
            409,
          );
        }
        if ((modeByResource.get(line.componentResourceId) ?? "bulk") === "bulk") {
          const unassigned =
            component.quantity -
            (locatedByResource.get(line.componentResourceId) ?? 0);
          if (unassigned < required) {
            throw new AssemblyOperationError(
              `${line.name} needs ${required} unassigned units, but only ${Math.max(0, unassigned)} are available. Move the required stock to “Unassigned” before building so location balances stay accurate.`,
              409,
            );
          }
        }
        const selectedIds = input.componentUnitIds?.[line.componentResourceId];
        if (selectedIds && selectedIds.length !== required) {
          throw new AssemblyOperationError(
            `${line.name} requires exactly ${required} selected serialized units.`,
            422,
          );
        }
      }

      const occurredAt = input.occurredAt ?? new Date();
      const now = new Date();
      const [build] = await transaction
        .insert(assemblyBuilds)
        .values({
          assemblyResourceId,
          quantity: input.quantity,
          occurredAt,
          location: input.location ?? assembly.location,
          note: input.note ?? "",
          idempotencyKey: idempotency.key,
          requestHash: idempotency.requestHash,
          response: {},
          createdBy: actor,
        })
        .returning();

      let outputUnits: StockUnitRecord[] = [];
      if (assemblyMode === "serialized") {
        const outputCodes =
          input.outputUnitCodes ??
          Array.from({ length: input.quantity }, () =>
            `ASM-${assemblyResourceId.slice(0, 8).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          );
        if (
          outputCodes.length !== input.quantity ||
          new Set(outputCodes).size !== outputCodes.length
        ) {
          throw new AssemblyOperationError(
            "Provide one unique output unit code for every built unit.",
            422,
          );
        }
        outputUnits = await transaction
          .insert(stockUnits)
          .values(
            outputCodes.map((code) => ({
              resourceId: assemblyResourceId,
              code,
              status: "available" as const,
              location: input.location ?? assembly.location,
              metadata: { assemblyBuildId: build.id },
              acquiredAt: occurredAt,
              lastMovedAt: occurredAt,
            })),
          )
          .returning();
      }

      const allMovements: StockMovementRecord[] = [];
      const allocationValues: Array<typeof assemblyBuildComponents.$inferInsert> = [];
      const componentBalances: Array<{
        resourceId: string;
        name: string;
        quantity: number;
      }> = [];

      for (const line of currentBom) {
        const component = resourceById.get(line.componentResourceId);
        if (!component) {
          throw new AssemblyOperationError("A component no longer exists.", 409);
        }
        const required = line.quantityPerAssembly * input.quantity;
        const balanceAfter = component.quantity - required;
        const mode = modeByResource.get(line.componentResourceId) ?? "bulk";
        const variantAllocation = await allocatedVariantQuantity(
          transaction,
          line.componentResourceId,
        );
        assertVariantAllocationFits(
          balanceAfter,
          variantAllocation,
          (message) => new AssemblyOperationError(message, 409),
        );

        if (mode === "serialized") {
          const requestedIds = input.componentUnitIds?.[line.componentResourceId];
          let selectedUnits: StockUnitRecord[];
          if (requestedIds) {
            const lockedUnits = await transaction
              .select()
              .from(stockUnits)
              .where(
                and(
                  eq(stockUnits.resourceId, line.componentResourceId),
                  inArray(stockUnits.id, requestedIds),
                ),
              )
              .orderBy(asc(stockUnits.id))
              .for("update");
            const byId = new Map(lockedUnits.map((unit) => [unit.id, unit]));
            selectedUnits = requestedIds
              .map((id) => byId.get(id))
              .filter((unit): unit is StockUnitRecord => Boolean(unit));
            if (
              selectedUnits.length !== required ||
              selectedUnits.some((unit) => unit.status !== "available")
            ) {
              throw new AssemblyOperationError(
                `One or more selected ${line.name} units are missing or unavailable.`,
                409,
              );
            }
          } else {
            selectedUnits = await transaction
              .select()
              .from(stockUnits)
              .where(
                and(
                  eq(stockUnits.resourceId, line.componentResourceId),
                  eq(stockUnits.status, "available"),
                ),
              )
              .orderBy(asc(stockUnits.code), asc(stockUnits.id))
              .limit(required)
              .for("update");
            if (selectedUnits.length !== required) {
              throw new AssemblyOperationError(
                `${line.name} needs ${required} available serialized units, but only ${selectedUnits.length} could be allocated.`,
                409,
              );
            }
          }

          await transaction
            .update(stockUnits)
            .set({ status: "in-use", lastMovedAt: occurredAt, updatedAt: now })
            .where(inArray(stockUnits.id, selectedUnits.map((unit) => unit.id)));
          await transaction
            .update(resources)
            .set({ quantity: balanceAfter, updatedAt: now })
            .where(eq(resources.id, line.componentResourceId));
          const movements = await transaction
            .insert(stockMovements)
            .values(
              selectedUnits.map((unit, index) => ({
                resourceId: line.componentResourceId,
                unitId: unit.id,
                assemblyBuildId: build.id,
                delta: -1,
                quantity: 1,
                balanceAfter: component.quantity - index - 1,
                type: "assembly-consumption",
                reason: `Installed in ${assembly.name}`,
                note: input.note ?? "",
                location: unit.location ?? input.location ?? assembly.location,
                fromLocationResourceId: unit.locationResourceId,
                occurredAt,
                createdBy: actor,
              })),
            )
            .returning();
          allMovements.push(...movements);
          const movementByUnit = new Map(
            movements.map((movement) => [movement.unitId, movement]),
          );
          selectedUnits.forEach((unit, index) => {
            allocationValues.push({
              buildId: build.id,
              componentResourceId: line.componentResourceId,
              componentName: line.name,
              componentSku: line.sku,
              quantityPerAssembly: line.quantityPerAssembly,
              quantityConsumed: 1,
              componentUnitId: unit.id,
              outputUnitId:
                outputUnits[Math.floor(index / line.quantityPerAssembly)]?.id ?? null,
              stockMovementId: movementByUnit.get(unit.id)?.id ?? null,
            });
          });
        } else {
          await transaction
            .update(resources)
            .set({ quantity: balanceAfter, updatedAt: now })
            .where(eq(resources.id, line.componentResourceId));
          const [movement] = await transaction
            .insert(stockMovements)
            .values({
              resourceId: line.componentResourceId,
              assemblyBuildId: build.id,
              delta: -required,
              quantity: required,
              balanceAfter,
              type: "assembly-consumption",
              reason: `Used to build ${input.quantity} × ${assembly.name}`,
              note: input.note ?? "",
              location: input.location ?? assembly.location,
              occurredAt,
              createdBy: actor,
            })
            .returning();
          allMovements.push(movement);
          if (outputUnits.length) {
            outputUnits.forEach((unit) => {
              allocationValues.push({
                buildId: build.id,
                componentResourceId: line.componentResourceId,
                componentName: line.name,
                componentSku: line.sku,
                quantityPerAssembly: line.quantityPerAssembly,
                quantityConsumed: line.quantityPerAssembly,
                outputUnitId: unit.id,
                stockMovementId: movement.id,
              });
            });
          } else {
            allocationValues.push({
              buildId: build.id,
              componentResourceId: line.componentResourceId,
              componentName: line.name,
              componentSku: line.sku,
              quantityPerAssembly: line.quantityPerAssembly,
              quantityConsumed: required,
              stockMovementId: movement.id,
            });
          }
        }
        componentBalances.push({
          resourceId: line.componentResourceId,
          name: line.name,
          quantity: balanceAfter,
        });
      }

      const assemblyBalanceAfter = assembly.quantity + input.quantity;
      await transaction
        .update(resources)
        .set({ quantity: assemblyBalanceAfter, updatedAt: now })
        .where(eq(resources.id, assemblyResourceId));
      if (outputUnits.length) {
        const movements = await transaction
          .insert(stockMovements)
          .values(
            outputUnits.map((unit, index) => ({
              resourceId: assemblyResourceId,
              unitId: unit.id,
              assemblyBuildId: build.id,
              delta: 1,
              quantity: 1,
              balanceAfter: assembly.quantity + index + 1,
              type: "assembly-output",
              reason: "Assembly completed",
              note: input.note ?? "",
              location: input.location ?? assembly.location,
              occurredAt,
              createdBy: actor,
            })),
          )
          .returning();
        allMovements.push(...movements);
      } else {
        const [movement] = await transaction
          .insert(stockMovements)
          .values({
            resourceId: assemblyResourceId,
            assemblyBuildId: build.id,
            delta: input.quantity,
            quantity: input.quantity,
            balanceAfter: assemblyBalanceAfter,
            type: "assembly-output",
            reason: "Assembly completed",
            note: input.note ?? "",
            location: input.location ?? assembly.location,
            occurredAt,
            createdBy: actor,
          })
          .returning();
        allMovements.push(movement);
      }

      const savedAllocations = allocationValues.length
        ? await transaction
            .insert(assemblyBuildComponents)
            .values(allocationValues)
            .returning()
        : [];
      await enqueueStockMovementWebhookEvents(transaction, allMovements);
      const unitsById = new Map<string, StockUnitRecord>();
      for (const unit of outputUnits) unitsById.set(unit.id, unit);
      const componentUnitIds = savedAllocations
        .map((row) => row.componentUnitId)
        .filter((id): id is string => Boolean(id));
      if (componentUnitIds.length) {
        const installedRows = await transaction
          .select()
          .from(stockUnits)
          .where(inArray(stockUnits.id, componentUnitIds));
        for (const unit of installedRows) unitsById.set(unit.id, unit);
      }
      const response = {
        build: buildDto(build, savedAllocations, unitsById),
        resource: {
          id: assembly.id,
          name: assembly.name,
          quantity: assemblyBalanceAfter,
          trackingMode: assemblyMode,
        },
        outputUnits: outputUnits.map(unitDto),
        componentBalances,
        movements: allMovements.map(movementDto),
      };
      const storedResponse = jsonRecord(response);
      await transaction
        .update(assemblyBuilds)
        .set({ response: storedResponse })
        .where(eq(assemblyBuilds.id, build.id));
      return { response: storedResponse, replayed: false } as const;
    });
  } catch (error) {
    if (lockedResourcesAuthorized) {
      const [winner] = await db
        .select()
        .from(assemblyBuilds)
        .where(eq(assemblyBuilds.idempotencyKey, idempotency.key))
        .limit(1);
      if (winner) return validateReplay(winner);
    }
    throw error;
  }
}
