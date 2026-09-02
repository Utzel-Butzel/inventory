import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { randomUUID } from "node:crypto";

import {
  assemblyBuildComponents,
  assemblyBuilds,
  inventoryAssignments,
  inventoryTypeDefinitions,
  media,
  organizations,
  purchaseOrderLines,
  purchaseOrders,
  resourceRelations,
  resources,
  stockMovementRequests,
  stockMovements,
  stockCostAllocations,
  stockCostLayers,
  stockLocationBalances,
  stockSettings,
  stockUnits,
  type StockMovementRecord,
  type StockSettingsRecord,
  type StockTrackingMode,
  type StockUnitRecord,
  type StockUnitStatus,
} from "@/db/schema";
import { db } from "@/lib/db";
import { enqueueStockMovementWebhookEvents } from "@/lib/webhooks";
import {
  CustomFieldError,
  validateCustomFieldValues,
} from "@/lib/custom-fields";
import type { CustomFieldValues } from "@/lib/custom-field-contract";
import {
  allocatedVariantQuantity,
  assertVariantAllocationFits,
} from "@/lib/variant-stock-invariant";
import { violatesNegativeStockPolicy } from "@/lib/negative-stock-policy";
import {
  addInboundStockCost,
  consumeStockCost,
  splitCents,
} from "@/lib/stock-costing";
import { MAX_STOCK_QUANTITY } from "@/lib/stock-quantity-units";

const FORECAST_WINDOW_DAYS = 30;
const MAX_SERIALIZATION_UNITS = 5_000;

export type StockConfig = {
  trackingMode: StockTrackingMode;
  minimumStock: number;
  reorderQuantity: number;
  leadTimeDays: number;
  unitName: string;
  purchaseUnitName: string | null;
  purchaseUnitFactor: number | null;
};

export type StockForecast = {
  averageDailyUsage: number;
  daysUntilStockout: number | null;
  predictedStockoutAt: string | null;
  isBelowMinimum: boolean;
  suggestedReorderQuantity: number;
};

export type StockMovementInput = {
  delta: number;
  quantity?: number;
  type: string;
  reason?: string | null;
  note?: string;
  location?: string | null;
  fromLocationResourceId?: string | null;
  toLocationResourceId?: string | null;
  occurredAt?: Date;
  totalPriceCents?: number | null;
  priceCurrency?: string | null;
};

export type StockMovementUpdateInput = Omit<
  StockMovementInput,
  "fromLocationResourceId" | "toLocationResourceId"
>;

export type StockUnitCreateInput = {
  count?: number;
  code?: string;
  codes?: string[];
  location?: string | null;
  locationResourceId?: string | null;
  metadata?: Record<string, unknown>;
  customFields?: CustomFieldValues;
  acquiredAt?: Date;
  totalPriceCents?: number | null;
  priceCurrency?: string | null;
};

export type StockUnitPatchInput = {
  status?: StockUnitStatus;
  location?: string | null;
  locationResourceId?: string | null;
  metadata?: Record<string, unknown>;
  customFields?: CustomFieldValues;
  occurredAt?: Date;
  reason?: string | null;
  note?: string;
  totalPriceCents?: number | null;
  priceCurrency?: string | null;
};

export class StockOperationError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "StockOperationError";
  }
}

export function stockHttpError(error: unknown, fallback: string) {
  if (error instanceof CustomFieldError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof StockOperationError) {
    return { status: error.status, message: error.message };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("stock_units_resource_code_unique")) {
    return {
      status: 409 as const,
      message: "A serialized unit with that code already exists for this item.",
    };
  }
  return { status: 500 as const, message: fallback };
}

const defaultConfig: StockConfig = {
  trackingMode: "bulk",
  minimumStock: 0,
  reorderQuantity: 0,
  leadTimeDays: 0,
  unitName: "unit",
  purchaseUnitName: null,
  purchaseUnitFactor: null,
};

const configDto = (row?: StockSettingsRecord | null): StockConfig =>
  row
    ? {
        trackingMode: row.trackingMode,
        minimumStock: row.minimumStock,
        reorderQuantity: row.reorderQuantity,
        leadTimeDays: row.leadTimeDays,
        unitName: row.unitName,
        purchaseUnitName: row.purchaseUnitName,
        purchaseUnitFactor: row.purchaseUnitFactor,
      }
    : { ...defaultConfig };

const movementDto = (row: StockMovementRecord) => ({
  id: row.id,
  resourceId: row.resourceId,
  delta: row.delta,
  quantity: row.quantity,
  totalPriceCents: row.totalPriceCents,
  priceCurrency: row.priceCurrency,
  costCents: row.costCents,
  costCurrency: row.costCurrency,
  costEstimated: row.costEstimated,
  balanceAfter: row.balanceAfter,
  fromLocationBalanceAfter: row.fromLocationBalanceAfter,
  toLocationBalanceAfter: row.toLocationBalanceAfter,
  type: row.type,
  reason: row.reason,
  note: row.note,
  location: row.location,
  fromLocationResourceId: row.fromLocationResourceId,
  toLocationResourceId: row.toLocationResourceId,
  occurredAt: row.occurredAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
  ...(row.variantId
    ? {
        variantId: row.variantId,
        variantDelta: row.variantDelta,
        variantBalanceAfter: row.variantBalanceAfter,
      }
    : {}),
  ...(row.unitId ? { unitId: row.unitId } : {}),
  ...(row.assemblyBuildId ? { assemblyBuildId: row.assemblyBuildId } : {}),
  ...(row.purchaseReceiptId ? { purchaseReceiptId: row.purchaseReceiptId } : {}),
});

const unitDto = (row: StockUnitRecord) => ({
  id: row.id,
  resourceId: row.resourceId,
  code: row.code,
  status: row.status,
  location: row.location,
  locationResourceId: row.locationResourceId,
  metadata: row.metadata,
  customFields: row.customFields,
  acquisitionCostCents: row.acquisitionCostCents,
  costCurrency: row.costCurrency,
  acquiredAt: row.acquiredAt.toISOString(),
  lastMovedAt: row.lastMovedAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const timestampDto = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

async function changeLocationBalance(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  resourceId: string,
  locationResourceId: string,
  delta: number,
  allowNegativeStock: boolean,
) {
  const [current] = await transaction
    .select()
    .from(stockLocationBalances)
    .where(
      and(
        eq(stockLocationBalances.organizationId, organizationId),
        eq(stockLocationBalances.resourceId, resourceId),
        eq(stockLocationBalances.locationResourceId, locationResourceId),
      ),
    )
    .limit(1)
    .for("update");
  const quantity = (current?.quantity ?? 0) + delta;
  if (
    violatesNegativeStockPolicy({
      allowNegativeStock,
      quantityBefore: current?.quantity ?? 0,
      quantityAfter: quantity,
    })
  ) {
    throw new StockOperationError(
      `This location only contains ${current?.quantity ?? 0}; the requested booking would make it negative.`,
      409,
    );
  }
  if (Math.abs(quantity) > MAX_STOCK_QUANTITY) {
    throw new StockOperationError(
      `This booking exceeds the supported stock range of -${MAX_STOCK_QUANTITY} to ${MAX_STOCK_QUANTITY}.`,
      409,
    );
  }
  const now = new Date();
  if (current) {
    await transaction
      .update(stockLocationBalances)
      .set({ quantity, updatedAt: now })
      .where(
        and(
          eq(stockLocationBalances.organizationId, organizationId),
          eq(stockLocationBalances.id, current.id),
        ),
      );
  } else if (quantity !== 0) {
    await transaction.insert(stockLocationBalances).values({
      organizationId,
      resourceId,
      locationResourceId,
      quantity,
      updatedAt: now,
    });
  }
  return quantity;
}

async function assertStockLocationResources(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  resourceId: string,
  locationResourceIds: Array<string | null | undefined>,
) {
  const requestedLocationIds = Array.from(
    new Set(
      locationResourceIds.filter((value): value is string => Boolean(value)),
    ),
  );
  if (requestedLocationIds.includes(resourceId)) {
    throw new StockOperationError(
      "An inventory item cannot be its own stock location.",
      422,
    );
  }
  if (!requestedLocationIds.length) return;
  const validLocations = await transaction
    .select({ id: resources.id })
    .from(resources)
    .innerJoin(
      inventoryTypeDefinitions,
      and(
        eq(resources.type, inventoryTypeDefinitions.key),
        eq(resources.organizationId, inventoryTypeDefinitions.organizationId),
      ),
    )
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(inventoryTypeDefinitions.organizationId, organizationId),
        inArray(resources.id, requestedLocationIds),
        ne(resources.status, "archived"),
        eq(inventoryTypeDefinitions.canContain, true),
        isNull(inventoryTypeDefinitions.archivedAt),
      ),
    );
  if (validLocations.length !== requestedLocationIds.length) {
    throw new StockOperationError(
      "Choose active inventory items configured to contain stock.",
      422,
    );
  }
}

const calculateForecast = (
  quantity: number,
  config: StockConfig,
  usageDuringWindow: number,
  onOrder = 0,
  now = new Date(),
): StockForecast => {
  const averageDailyUsage = usageDuringWindow / FORECAST_WINDOW_DAYS;
  const daysUntilStockout =
    averageDailyUsage > 0 ? Math.max(0, quantity / averageDailyUsage) : null;
  const predictedTimestamp =
    daysUntilStockout === null
      ? null
      : now.getTime() + daysUntilStockout * 24 * 60 * 60 * 1_000;
  const predictedStockoutAt =
    predictedTimestamp !== null &&
    Number.isFinite(predictedTimestamp) &&
    Math.abs(predictedTimestamp) <= 8_640_000_000_000_000
      ? new Date(predictedTimestamp).toISOString()
      : null;
  const isBelowMinimum =
    config.minimumStock > 0 && quantity <= config.minimumStock;
  const leadTimeDemand = Math.ceil(
    averageDailyUsage * Math.max(0, config.leadTimeDays),
  );
  const reorderPoint = config.minimumStock + leadTimeDemand;
  const shouldReorder =
    isBelowMinimum ||
    (averageDailyUsage > 0 && quantity <= reorderPoint) ||
    (quantity === 0 && config.reorderQuantity > 0);
  const suggestedBeforeIncoming = shouldReorder
    ? Math.max(config.reorderQuantity, Math.max(0, reorderPoint - quantity))
    : 0;
  const suggestedReorderQuantity = Math.max(
    0,
    suggestedBeforeIncoming - Math.max(0, onOrder),
  );

  return {
    averageDailyUsage: Number(averageDailyUsage.toFixed(4)),
    daysUntilStockout:
      daysUntilStockout === null
        ? null
        : Number(daysUntilStockout.toFixed(2)),
    predictedStockoutAt,
    isBelowMinimum,
    suggestedReorderQuantity,
  };
};

const usageSince = (now: Date) =>
  new Date(now.getTime() - FORECAST_WINDOW_DAYS * 24 * 60 * 60 * 1_000);

export async function getStockDetail(
  organizationId: string,
  resourceId: string,
) {
  return db.transaction(async (transaction) => {
  const now = new Date();
  const since = usageSince(now);
  const [resource] = await transaction
    .select({
      id: resources.id,
      name: resources.name,
      quantity: resources.quantity,
      valueCents: resources.valueCents,
      currency: resources.currency,
      type: resources.type,
      categories: resources.categories,
    })
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
    settingsRows,
    movementRows,
    unitRows,
    usageRows,
    incomingRows,
    installationRows,
  ] = await Promise.all([
    transaction
      .select()
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
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, resourceId),
        ),
      )
      .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.createdAt))
      .limit(100),
    transaction
      .select()
      .from(stockUnits)
      .where(
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.resourceId, resourceId),
        ),
      )
      .orderBy(asc(stockUnits.code)),
    transaction
      .select({
        consumed: sql<number>`coalesce(sum(case when ${stockMovements.delta} < 0 then -${stockMovements.delta} else 0 end), 0)::float8`,
      })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, resourceId),
          gte(stockMovements.occurredAt, since),
          lte(stockMovements.occurredAt, now),
        ),
      ),
    transaction
      .select({
        lineId: purchaseOrderLines.id,
        orderId: purchaseOrders.id,
        reference: purchaseOrders.reference,
        supplier: purchaseOrders.supplier,
        orderedQuantity: purchaseOrderLines.orderedQuantity,
        receivedQuantity: purchaseOrderLines.receivedQuantity,
        expectedAt: sql<Date | null>`coalesce(${purchaseOrderLines.expectedAt}, ${purchaseOrders.expectedAt})`,
      })
      .from(purchaseOrderLines)
      .innerJoin(
        purchaseOrders,
        and(
          eq(purchaseOrders.organizationId, organizationId),
          eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId),
        ),
      )
      .where(
        and(
          eq(purchaseOrderLines.organizationId, organizationId),
          eq(purchaseOrderLines.resourceId, resourceId),
          inArray(purchaseOrders.status, ["ordered", "partially-received"]),
          sql`${purchaseOrderLines.receivedQuantity} < ${purchaseOrderLines.orderedQuantity}`,
        ),
      )
      .orderBy(asc(sql`coalesce(${purchaseOrderLines.expectedAt}, ${purchaseOrders.expectedAt})`)),
    transaction
      .select({
        componentUnitId: assemblyBuildComponents.componentUnitId,
        outputUnitId: assemblyBuildComponents.outputUnitId,
        buildId: assemblyBuilds.id,
        assemblyResourceId: assemblyBuilds.assemblyResourceId,
        occurredAt: assemblyBuilds.occurredAt,
      })
      .from(assemblyBuildComponents)
      .innerJoin(
        assemblyBuilds,
        and(
          eq(assemblyBuilds.organizationId, organizationId),
          eq(assemblyBuilds.id, assemblyBuildComponents.buildId),
        ),
      )
      .where(
        and(
          eq(assemblyBuildComponents.organizationId, organizationId),
          eq(assemblyBuildComponents.componentResourceId, resourceId),
        ),
      ),
  ]);

  const config = configDto(settingsRows[0]);
  const openLines = incomingRows.map((line) => ({
    ...line,
    openQuantity: Math.max(0, line.orderedQuantity - line.receivedQuantity),
    expectedAt: timestampDto(line.expectedAt),
  }));
  const onOrder = openLines.reduce((total, line) => total + line.openQuantity, 0);
  const assemblyResourceIds = Array.from(
    new Set(installationRows.map((row) => row.assemblyResourceId)),
  );
  const outputUnitIds = Array.from(
    new Set(
      installationRows
        .map((row) => row.outputUnitId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const [assemblyResourceRows, outputUnitRows] = await Promise.all([
    assemblyResourceIds.length
      ? transaction
          .select({ id: resources.id, name: resources.name })
          .from(resources)
          .where(
            and(
              eq(resources.organizationId, organizationId),
              inArray(resources.id, assemblyResourceIds),
            ),
          )
      : Promise.resolve([]),
    outputUnitIds.length
      ? transaction
          .select({ id: stockUnits.id, code: stockUnits.code })
          .from(stockUnits)
          .where(
            and(
              eq(stockUnits.organizationId, organizationId),
              inArray(stockUnits.id, outputUnitIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const assemblyNames = new Map(
    assemblyResourceRows.map((row) => [row.id, row.name]),
  );
  const outputCodes = new Map(outputUnitRows.map((row) => [row.id, row.code]));
  const installations = new Map(
    installationRows
      .filter((row): row is typeof row & { componentUnitId: string } =>
        Boolean(row.componentUnitId),
      )
      .map((row) => [
        row.componentUnitId,
        {
          buildId: row.buildId,
          assemblyResourceId: row.assemblyResourceId,
          assemblyName: assemblyNames.get(row.assemblyResourceId) ?? "Assembly",
          outputUnitId: row.outputUnitId,
          outputUnitCode: row.outputUnitId
            ? outputCodes.get(row.outputUnitId) ?? null
            : null,
          installedAt: row.occurredAt.toISOString(),
        },
      ]),
  );
  return {
    resource,
    config,
    forecast: calculateForecast(
      resource.quantity,
      config,
      Number(usageRows[0]?.consumed ?? 0),
      onOrder,
      now,
    ),
    procurement: {
      onOrder,
      projectedQuantity: resource.quantity + onOrder,
      nextExpectedAt: openLines.find((line) => line.expectedAt)?.expectedAt ?? null,
      openLines,
    },
    movements: movementRows.map(movementDto),
    units: unitRows.map((unit) => ({
      ...unitDto(unit),
      ...(installations.has(unit.id)
        ? { installation: installations.get(unit.id) }
        : {}),
    })),
  };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getStockOverview(organizationId: string) {
  return db.transaction(async (transaction) => {
  const now = new Date();
  const since = usageSince(now);
  const rows = await transaction
    .select({
      resourceId: resources.id,
      name: resources.name,
      sku: resources.sku,
      type: resources.type,
      quantity: resources.quantity,
      trackingMode: stockSettings.trackingMode,
      minimumStock: stockSettings.minimumStock,
      reorderQuantity: stockSettings.reorderQuantity,
      leadTimeDays: stockSettings.leadTimeDays,
      unitName: stockSettings.unitName,
      purchaseUnitName: stockSettings.purchaseUnitName,
      purchaseUnitFactor: stockSettings.purchaseUnitFactor,
    })
    .from(stockSettings)
    .innerJoin(resources, eq(resources.id, stockSettings.resourceId))
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(stockSettings.organizationId, organizationId),
      ),
    )
    .orderBy(asc(resources.name));

  const ids = rows.map((row) => row.resourceId);
  const [usageRows, incomingRows, coverRows, variantMembershipRows] = ids.length
    ? await Promise.all([
        transaction
        .select({
          resourceId: stockMovements.resourceId,
          consumed: sql<number>`coalesce(sum(case when ${stockMovements.delta} < 0 then -${stockMovements.delta} else 0 end), 0)::float8`,
        })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.organizationId, organizationId),
            inArray(stockMovements.resourceId, ids),
            gte(stockMovements.occurredAt, since),
            lte(stockMovements.occurredAt, now),
          ),
        )
        .groupBy(stockMovements.resourceId),
        transaction
          .select({
            resourceId: purchaseOrderLines.resourceId,
            onOrder: sql<string>`coalesce(sum((${purchaseOrderLines.orderedQuantity} - ${purchaseOrderLines.receivedQuantity})::bigint), 0)`,
            nextExpectedAt: sql<Date | null>`min(coalesce(${purchaseOrderLines.expectedAt}, ${purchaseOrders.expectedAt}))`,
          })
          .from(purchaseOrderLines)
          .innerJoin(
            purchaseOrders,
            eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId),
          )
          .where(
            and(
              eq(purchaseOrderLines.organizationId, organizationId),
              eq(purchaseOrders.organizationId, organizationId),
              inArray(purchaseOrderLines.resourceId, ids),
              inArray(purchaseOrders.status, ["ordered", "partially-received"]),
              sql`${purchaseOrderLines.receivedQuantity} < ${purchaseOrderLines.orderedQuantity}`,
            ),
          )
          .groupBy(purchaseOrderLines.resourceId),
        transaction
          .select({
            id: media.id,
            resourceId: media.resourceId,
            url: media.url,
            altText: media.altText,
            width: media.width,
            height: media.height,
          })
          .from(media)
          .where(
            and(
              eq(media.organizationId, organizationId),
              inArray(media.resourceId, ids),
              eq(media.kind, "image"),
            ),
          )
          .orderBy(
            asc(media.resourceId),
            asc(media.position),
            asc(media.createdAt),
          ),
        transaction
          .select({
            variantResourceId: resourceRelations.sourceResourceId,
            primaryResourceId: resourceRelations.targetResourceId,
          })
          .from(resourceRelations)
          .where(
            and(
              eq(resourceRelations.organizationId, organizationId),
              eq(resourceRelations.relationTypeKey, "variant_of"),
              inArray(resourceRelations.sourceResourceId, ids),
              inArray(resourceRelations.targetResourceId, ids),
            ),
          ),
      ])
    : [[], [], [], []];
  const usageByResource = new Map(
    usageRows.map((row) => [row.resourceId, Number(row.consumed ?? 0)]),
  );
  const incomingByResource = new Map(
    incomingRows.map((row) => [
      row.resourceId,
      {
        onOrder: Number(row.onOrder ?? 0),
        nextExpectedAt: timestampDto(row.nextExpectedAt),
      },
    ]),
  );
  const coverByResource = new Map<
    string,
    {
      id: string;
      url: string;
      altText: string;
      width: number | null;
      height: number | null;
    }
  >();
  const primaryByVariantId = new Map(
    variantMembershipRows.map((membership) => [
      membership.variantResourceId,
      membership.primaryResourceId,
    ]),
  );
  for (const cover of coverRows) {
    if (!coverByResource.has(cover.resourceId)) {
      coverByResource.set(cover.resourceId, {
        id: cover.id,
        url: cover.url,
        altText: cover.altText,
        width: cover.width,
        height: cover.height,
      });
    }
  }

  const items = rows.map((row) => {
    const config: StockConfig = {
      trackingMode: row.trackingMode,
      minimumStock: row.minimumStock,
      reorderQuantity: row.reorderQuantity,
      leadTimeDays: row.leadTimeDays,
      unitName: row.unitName,
      purchaseUnitName: row.purchaseUnitName,
      purchaseUnitFactor: row.purchaseUnitFactor,
    };
    const incoming = incomingByResource.get(row.resourceId) ?? {
      onOrder: 0,
      nextExpectedAt: null,
    };
    const forecast = calculateForecast(
      row.quantity,
      config,
      usageByResource.get(row.resourceId) ?? 0,
      incoming.onOrder,
      now,
    );
    return {
      resourceId: row.resourceId,
      variantOfResourceId: primaryByVariantId.get(row.resourceId) ?? null,
      name: row.name,
      sku: row.sku,
      type: row.type,
      cover: coverByResource.get(row.resourceId) ?? null,
      quantity: row.quantity,
      onOrder: incoming.onOrder,
      projectedQuantity: row.quantity + incoming.onOrder,
      nextExpectedAt: incoming.nextExpectedAt,
      minimumStock: row.minimumStock,
      trackingMode: row.trackingMode,
      averageDailyUsage: forecast.averageDailyUsage,
      daysUntilStockout: forecast.daysUntilStockout,
      predictedStockoutAt: forecast.predictedStockoutAt,
      reorderSuggested: forecast.suggestedReorderQuantity > 0,
      unitName: row.unitName,
      purchaseUnitName: row.purchaseUnitName,
      purchaseUnitFactor: row.purchaseUnitFactor,
    };
  });

  return {
    summary: {
      trackedItems: items.length,
      totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
      totalOnOrder: items.reduce((total, item) => total + item.onOrder, 0),
      incomingItems: items.filter((item) => item.onOrder > 0).length,
      lowStockItems: items.filter(
        (item) =>
          item.quantity > 0 &&
          item.minimumStock > 0 &&
          item.quantity <= item.minimumStock,
      ).length,
      outOfStockItems: items.filter((item) => item.quantity <= 0).length,
      predictedStockouts: items.filter(
        (item) => item.quantity > 0 && item.predictedStockoutAt !== null,
      ).length,
      reorderItems: items.filter((item) => item.reorderSuggested).length,
    },
    items,
  };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function listStockMovements(
  organizationId: string,
  resourceId: string,
  options: { limit?: number; before?: Date } = {},
) {
  const [resource] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (!resource) return null;

  const conditions = [
    eq(stockMovements.organizationId, organizationId),
    eq(stockMovements.resourceId, resourceId),
  ];
  if (options.before) conditions.push(lt(stockMovements.occurredAt, options.before));
  const rows = await db
    .select()
    .from(stockMovements)
    .where(and(...conditions))
    .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.createdAt))
    .limit(Math.min(200, Math.max(1, options.limit ?? 100)));
  return rows.map(movementDto);
}

const editableMovementTypes = new Set([
  "receipt",
  "issue",
  "adjustment",
  "return",
  "waste",
]);

function assertManualMovementEditable(movement: StockMovementRecord) {
  if (
    !editableMovementTypes.has(movement.type) ||
    movement.variantId ||
    movement.unitId ||
    movement.assemblyBuildId ||
    movement.purchaseReceiptId ||
    movement.fromLocationResourceId ||
    movement.toLocationResourceId
  ) {
    throw new StockOperationError(
      "This system-linked stock movement cannot be edited or deleted here.",
      409,
    );
  }
}

type StockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function undoStockMovementCost(
  transaction: StockTransaction,
  movement: StockMovementRecord,
) {
  if (movement.delta > 0) {
    const layers = await transaction
      .select()
      .from(stockCostLayers)
      .where(
        and(
          eq(stockCostLayers.organizationId, movement.organizationId),
          eq(stockCostLayers.sourceMovementId, movement.id),
        ),
      )
      .for("update");
    if (!layers.length) {
      return false;
    }
    if (
      layers.some(
        (layer) =>
          layer.remainingQuantity !== layer.initialQuantity ||
          layer.remainingCostCents !== layer.initialCostCents,
      )
    ) {
      throw new StockOperationError(
        "This inbound movement has already supplied later stock consumption and can no longer be changed or deleted.",
        409,
      );
    }
    await transaction
      .delete(stockCostLayers)
      .where(
        and(
          eq(stockCostLayers.organizationId, movement.organizationId),
          eq(stockCostLayers.sourceMovementId, movement.id),
        ),
      );
    return true;
  }
  if (movement.delta >= 0) return false;

  const allocations = await transaction
    .select()
    .from(stockCostAllocations)
    .where(
      and(
        eq(stockCostAllocations.organizationId, movement.organizationId),
        eq(stockCostAllocations.movementId, movement.id),
      ),
    );
  if (!allocations.length) return false;
  for (const allocation of allocations) {
    const [layer] = await transaction
      .select()
      .from(stockCostLayers)
      .where(
        and(
          eq(stockCostLayers.organizationId, movement.organizationId),
          eq(stockCostLayers.id, allocation.layerId),
        ),
      )
      .limit(1)
      .for("update");
    if (!layer) {
      throw new StockOperationError(
        "The inventory valuation for this movement is incomplete.",
        409,
      );
    }
    const remainingQuantity = layer.remainingQuantity + allocation.quantity;
    const remainingCostCents =
      layer.initialCostCents === null
        ? null
        : (layer.remainingCostCents ?? 0) + (allocation.costCents ?? 0);
    if (
      remainingQuantity > layer.initialQuantity ||
      (remainingCostCents !== null &&
        layer.initialCostCents !== null &&
        remainingCostCents > layer.initialCostCents)
    ) {
      throw new StockOperationError(
        "The inventory valuation for this movement cannot be restored safely.",
        409,
      );
    }
    await transaction
      .update(stockCostLayers)
      .set({ remainingQuantity, remainingCostCents })
      .where(eq(stockCostLayers.id, layer.id));
  }
  await transaction
    .delete(stockCostAllocations)
    .where(
      and(
        eq(stockCostAllocations.organizationId, movement.organizationId),
        eq(stockCostAllocations.movementId, movement.id),
      ),
    );
  return true;
}

async function applyStockMovementCost(
  transaction: StockTransaction,
  movement: StockMovementRecord,
  resource: {
    quantityBefore: number;
    valueCents: number | null;
    currency: string;
  },
) {
  if (movement.delta > 0) {
    await addInboundStockCost(transaction, {
      organizationId: movement.organizationId,
      resourceId: movement.resourceId,
      movementId: movement.id,
      quantity: movement.quantity,
      totalPriceCents: movement.totalPriceCents,
      fallbackUnitCostCents: resource.valueCents,
      currency: resource.currency,
      occurredAt: movement.occurredAt,
    });
  } else if (movement.delta < 0) {
    await consumeStockCost(transaction, {
      organizationId: movement.organizationId,
      resourceId: movement.resourceId,
      movementId: movement.id,
      quantity: movement.quantity,
      quantityBefore: resource.quantityBefore,
      fallbackUnitCostCents: resource.valueCents,
      currency: resource.currency,
      occurredAt: movement.occurredAt,
    });
  }
}

async function validateCorrectedStockQuantity(
  transaction: StockTransaction,
  input: {
    resourceId: string;
    allowNegativeStock: boolean;
    quantityBefore: number;
    quantityAfter: number;
  },
) {
  if (
    violatesNegativeStockPolicy({
      allowNegativeStock: input.allowNegativeStock,
      quantityBefore: input.quantityBefore,
      quantityAfter: input.quantityAfter,
    })
  ) {
    throw new StockOperationError(
      `This correction would make stock negative. Current stock is ${input.quantityBefore}.`,
      409,
    );
  }
  if (Math.abs(input.quantityAfter) > MAX_STOCK_QUANTITY) {
    throw new StockOperationError(
      `This correction exceeds the supported stock range of -${MAX_STOCK_QUANTITY} to ${MAX_STOCK_QUANTITY}.`,
      409,
    );
  }
  if (!input.allowNegativeStock && input.quantityAfter >= 0) {
    const variantAllocation = await allocatedVariantQuantity(
      transaction,
      input.resourceId,
    );
    assertVariantAllocationFits(
      input.quantityAfter,
      variantAllocation,
      (message) => new StockOperationError(message, 409),
    );
  }
}

export async function updateStockMovement(
  organizationId: string,
  resourceId: string,
  movementId: string,
  input: StockMovementUpdateInput,
) {
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({
        id: resources.id,
        quantity: resources.quantity,
        valueCents: resources.valueCents,
        currency: resources.currency,
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
    if (!resource) throw new StockOperationError("Not found", 404);

    const [movement] = await transaction
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, resourceId),
          eq(stockMovements.id, movementId),
        ),
      )
      .limit(1)
      .for("update");
    if (!movement) throw new StockOperationError("Movement not found", 404);
    assertManualMovementEditable(movement);

    const [settings] = await transaction
      .select({ trackingMode: stockSettings.trackingMode })
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resourceId),
        ),
      )
      .limit(1);
    if ((settings?.trackingMode ?? "bulk") !== "bulk") {
      throw new StockOperationError(
        "Manual movement corrections are only available for bulk stock.",
        409,
      );
    }

    const quantity = input.quantity ?? Math.abs(input.delta);
    if (quantity !== Math.abs(input.delta)) {
      throw new StockOperationError(
        "Movement quantity must match the absolute stock change.",
        422,
      );
    }
    if (input.type === "transfer") {
      throw new StockOperationError(
        "Location transfers cannot be changed from the movement history.",
        409,
      );
    }
    const totalPriceCents = input.totalPriceCents ?? null;
    const priceCurrency = input.priceCurrency?.toUpperCase() ?? null;
    if (
      totalPriceCents !== null &&
      priceCurrency !== resource.currency
    ) {
      throw new StockOperationError(
        `Movement prices for this item must use ${resource.currency}.`,
        422,
      );
    }
    if (input.delta > 0 && totalPriceCents !== null && totalPriceCents < 0) {
      throw new StockOperationError(
        "Inbound stock prices cannot be negative.",
        422,
      );
    }

    const deltaDifference = input.delta - movement.delta;
    const quantityAfter = resource.quantity + deltaDifference;
    await validateCorrectedStockQuantity(transaction, {
      resourceId,
      allowNegativeStock: resource.allowNegativeStock,
      quantityBefore: resource.quantity,
      quantityAfter,
    });

    const occurredAt = input.occurredAt ?? movement.occurredAt;
    const costChanged =
      input.delta !== movement.delta ||
      totalPriceCents !== movement.totalPriceCents ||
      occurredAt.getTime() !== movement.occurredAt.getTime();
    const costWasTracked = costChanged
      ? await undoStockMovementCost(transaction, movement)
      : false;

    const now = new Date();
    if (deltaDifference !== 0) {
      await transaction
        .update(resources)
        .set({ quantity: quantityAfter, updatedAt: now })
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, resourceId),
          ),
        );
      await transaction
        .update(stockMovements)
        .set({
          balanceAfter: sql`${stockMovements.balanceAfter} + ${deltaDifference}`,
        })
        .where(
          and(
            eq(stockMovements.organizationId, organizationId),
            eq(stockMovements.resourceId, resourceId),
            gt(stockMovements.createdAt, movement.createdAt),
          ),
        );
    }

    const [updated] = await transaction
      .update(stockMovements)
      .set({
        delta: input.delta,
        quantity,
        totalPriceCents,
        priceCurrency: totalPriceCents === null ? null : resource.currency,
        costCents: costChanged ? null : movement.costCents,
        costCurrency: costChanged ? null : movement.costCurrency,
        costEstimated: costChanged ? false : movement.costEstimated,
        balanceAfter: movement.balanceAfter + deltaDifference,
        type: input.type,
        reason: input.reason ?? null,
        note: input.note ?? "",
        location: input.location ?? null,
        occurredAt,
      })
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, resourceId),
          eq(stockMovements.id, movementId),
        ),
      )
      .returning();
    if (!updated) throw new StockOperationError("Movement not found", 404);
    if (costChanged && (costWasTracked || movement.delta === 0)) {
      await applyStockMovementCost(transaction, updated, {
        quantityBefore: resource.quantity - movement.delta,
        valueCents: resource.valueCents,
        currency: resource.currency,
      });
    }
    const [costed] = await transaction
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, movementId))
      .limit(1);
    return {
      resource: { id: resource.id, quantity: quantityAfter },
      movement: movementDto(costed ?? updated),
    };
  });
}

export async function deleteStockMovement(
  organizationId: string,
  resourceId: string,
  movementId: string,
) {
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({
        id: resources.id,
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
    if (!resource) throw new StockOperationError("Not found", 404);

    const [movement] = await transaction
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, resourceId),
          eq(stockMovements.id, movementId),
        ),
      )
      .limit(1)
      .for("update");
    if (!movement) throw new StockOperationError("Movement not found", 404);
    assertManualMovementEditable(movement);

    const [settings] = await transaction
      .select({ trackingMode: stockSettings.trackingMode })
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resourceId),
        ),
      )
      .limit(1);
    if ((settings?.trackingMode ?? "bulk") !== "bulk") {
      throw new StockOperationError(
        "Manual movement corrections are only available for bulk stock.",
        409,
      );
    }

    const quantityAfter = resource.quantity - movement.delta;
    await validateCorrectedStockQuantity(transaction, {
      resourceId,
      allowNegativeStock: resource.allowNegativeStock,
      quantityBefore: resource.quantity,
      quantityAfter,
    });
    await undoStockMovementCost(transaction, movement);

    const now = new Date();
    await transaction
      .update(resources)
      .set({ quantity: quantityAfter, updatedAt: now })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resourceId),
        ),
      );
    await transaction
      .update(stockMovements)
      .set({
        balanceAfter: sql`${stockMovements.balanceAfter} - ${movement.delta}`,
      })
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, resourceId),
          gt(stockMovements.createdAt, movement.createdAt),
        ),
      );
    await transaction
      .delete(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, organizationId),
          eq(stockMovements.resourceId, resourceId),
          eq(stockMovements.id, movementId),
        ),
      );
    return { resource: { id: resource.id, quantity: quantityAfter } };
  });
}

export async function listStockUnits(
  organizationId: string,
  resourceId: string,
) {
  const [resource] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, resourceId),
      ),
    )
    .limit(1);
  if (!resource) return null;

  const rows = await db
    .select()
    .from(stockUnits)
    .where(
      and(
        eq(stockUnits.organizationId, organizationId),
        eq(stockUnits.resourceId, resourceId),
      ),
    )
    .orderBy(asc(stockUnits.code));
  return rows.map(unitDto);
}

export async function updateStockConfig(
  organizationId: string,
  resourceId: string,
  patch: Partial<StockConfig>,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({
        id: resources.id,
        quantity: resources.quantity,
        location: resources.location,
      })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!resource) throw new StockOperationError("Not found", 404);

    const [settings] = await transaction
      .select()
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resourceId),
        ),
      )
      .limit(1);
    const current = configDto(settings);
    const next: StockConfig = {
      ...current,
      ...patch,
      purchaseUnitName:
        patch.purchaseUnitName === undefined
          ? current.purchaseUnitName
          : patch.purchaseUnitName?.trim() || null,
    };
    if (
      (next.purchaseUnitName === null) !==
      (next.purchaseUnitFactor === null)
    ) {
      throw new StockOperationError(
        "Purchase unit name and conversion factor must be configured together.",
        422,
      );
    }
    let unitsCreated = 0;

      if (current.trackingMode !== next.trackingMode) {
      const [{ value: existingUnits }] = await transaction
        .select({ value: sql<number>`count(*)::int` })
        .from(stockUnits)
        .where(
          and(
            eq(stockUnits.organizationId, organizationId),
            eq(stockUnits.resourceId, resourceId),
          ),
        );

      if (next.trackingMode === "bulk" && Number(existingUnits ?? 0) > 0) {
        throw new StockOperationError(
          "Serialized tracking cannot be changed to bulk while identified units exist.",
          409,
        );
      }

      if (next.trackingMode === "serialized") {
        if (resource.quantity < 0) {
          throw new StockOperationError(
            "Bring stock back to zero or above before enabling serialized tracking.",
            409,
          );
        }
        const variantAllocation = await allocatedVariantQuantity(
          transaction,
          resourceId,
        );
        if (variantAllocation > 0) {
          throw new StockOperationError(
            "Move all variant stock to zero before enabling serialized tracking.",
            409,
          );
        }
        if (Number(existingUnits ?? 0) > 0) {
          throw new StockOperationError(
            "This item already has serialized units and cannot be converted again.",
            409,
          );
        }
        const [activeAssignment] = await transaction
          .select({ id: inventoryAssignments.id })
          .from(inventoryAssignments)
          .where(
            and(
              eq(inventoryAssignments.organizationId, organizationId),
              eq(inventoryAssignments.resourceId, resourceId),
              eq(inventoryAssignments.status, "active"),
            ),
          )
          .limit(1);
        if (activeAssignment) {
          throw new StockOperationError(
            "Return or cancel active assignments and reservations before converting this item to serialized tracking.",
            409,
          );
        }
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
        if (Number(located ?? 0) > 0) {
          throw new StockOperationError(
            "Move all bulk stock to “Unassigned” before converting it to serialized tracking. You can then place each identified unit at its inventory location.",
            409,
          );
        }
        if (resource.quantity > MAX_SERIALIZATION_UNITS) {
          throw new StockOperationError(
            `Converting this item would create ${resource.quantity} units. Reduce bulk stock to ${MAX_SERIALIZATION_UNITS} or fewer first.`,
            409,
          );
        }

        const occurredAt = new Date();
        const width = Math.max(4, String(resource.quantity).length);
        const prefix = `STK-${resource.id.slice(0, 8).toUpperCase()}`;
        if (resource.quantity > 0) {
          const createdUnits = await transaction
            .insert(stockUnits)
            .values(
              Array.from({ length: resource.quantity }, (_, index) => ({
                organizationId,
                resourceId,
                code: `${prefix}-${String(index + 1).padStart(width, "0")}`,
                status: "available" as const,
                location: resource.location,
                metadata: {},
                acquiredAt: occurredAt,
                lastMovedAt: occurredAt,
              })),
            )
            .returning();
          unitsCreated = createdUnits.length;
          const openingMovements = await transaction
            .insert(stockMovements)
            .values(
              createdUnits.map((unit) => ({
                organizationId,
                resourceId,
                unitId: unit.id,
                delta: 0,
                quantity: 1,
                balanceAfter: resource.quantity,
                type: "serialization-opening",
                reason: "Bulk stock converted to an identified unit",
                note: "",
                location: unit.location,
                occurredAt,
                createdBy: actor,
              })),
            )
            .returning();
          await enqueueStockMovementWebhookEvents(transaction, openingMovements);
        }
      }
    }

    const now = new Date();
    const [saved] = await transaction
      .insert(stockSettings)
      .values({ organizationId, resourceId, ...next, updatedAt: now })
      .onConflictDoUpdate({
        target: stockSettings.resourceId,
        set: { organizationId, ...next, updatedAt: now },
      })
      .returning();
    return { config: configDto(saved), unitsCreated };
  });
}

export async function bookStockMovement(
  organizationId: string,
  resourceId: string,
  input: StockMovementInput,
  actor: string,
  idempotency?: {
    key: string;
    requestHash: string;
    expectedResourceUpdatedAt?: string;
  },
) {
  const validateReplay = (existing: {
    resourceId: string;
    actor: string;
    requestHash: string;
    response: Record<string, unknown>;
  }) => {
    if (
      existing.resourceId !== resourceId ||
      existing.actor !== actor ||
      existing.requestHash !== idempotency?.requestHash
    ) {
      throw new StockOperationError(
        "That Idempotency-Key was already used for another resource, actor, or payload.",
        409,
      );
    }
    return { response: existing.response, replayed: true } as const;
  };

  try {
    return await db.transaction(async (transaction) => {
      if (idempotency) {
        const [existing] = await transaction
          .select()
          .from(stockMovementRequests)
          .where(
            and(
              eq(stockMovementRequests.organizationId, organizationId),
              eq(stockMovementRequests.idempotencyKey, idempotency.key),
            ),
          )
          .limit(1);
        if (existing) return validateReplay(existing);
      }

      const [resource] = await transaction
        .select({
          id: resources.id,
          name: resources.name,
          quantity: resources.quantity,
          allowNegativeStock: organizations.allowNegativeStock,
          valueCents: resources.valueCents,
          currency: resources.currency,
          createdAt: resources.createdAt,
          updatedAt: resources.updatedAt,
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
      if (!resource) throw new StockOperationError("Not found", 404);
      if (
        idempotency?.expectedResourceUpdatedAt &&
        resource.updatedAt.toISOString() !== idempotency.expectedResourceUpdatedAt
      ) {
        throw new StockOperationError(
          "The stock changed after the action was reviewed. Scan the code again.",
          409,
        );
      }

      if (
        input.totalPriceCents !== null &&
        input.totalPriceCents !== undefined &&
        input.priceCurrency?.toUpperCase() !== resource.currency
      ) {
        throw new StockOperationError(
          `Movement prices for this item must use ${resource.currency}.`,
          422,
        );
      }
      if (
        input.delta > 0 &&
        input.totalPriceCents !== null &&
        input.totalPriceCents !== undefined &&
        input.totalPriceCents < 0
      ) {
        throw new StockOperationError(
          "Inbound stock prices cannot be negative.",
          422,
        );
      }

      // A same-resource concurrent request may have waited for the row lock.
      // Recheck after acquiring it before changing quantity or appending a ledger row.
      if (idempotency) {
        const [existing] = await transaction
          .select()
          .from(stockMovementRequests)
          .where(
            and(
              eq(stockMovementRequests.organizationId, organizationId),
              eq(stockMovementRequests.idempotencyKey, idempotency.key),
            ),
          )
          .limit(1);
        if (existing) return validateReplay(existing);
      }

      const [settings] = await transaction
        .select()
        .from(stockSettings)
        .where(
          and(
            eq(stockSettings.organizationId, organizationId),
            eq(stockSettings.resourceId, resourceId),
          ),
        )
        .limit(1);
      const config = configDto(settings);
      if (config.trackingMode === "serialized" && input.delta !== 0) {
        throw new StockOperationError(
          "Direct quantity bookings are not allowed in serialized mode. Create a unit or change an existing unit status instead.",
          409,
        );
      }

      const movementQuantity = input.quantity ?? Math.abs(input.delta);
      if (!Number.isInteger(movementQuantity) || movementQuantity < 0) {
        throw new StockOperationError("Movement quantity must be a non-negative whole number.", 422);
      }
      const isTransfer =
        input.type === "transfer" &&
        (input.delta === 0 ||
          Boolean(input.fromLocationResourceId) ||
          Boolean(input.toLocationResourceId));
      if (config.trackingMode === "serialized" && isTransfer) {
        throw new StockOperationError(
          "Move serialized stock by updating the location of each identified unit.",
          409,
        );
      }
      if (isTransfer) {
        if (input.delta !== 0 || movementQuantity <= 0) {
          throw new StockOperationError(
            "A location transfer requires delta 0 and a positive quantity.",
            422,
          );
        }
        if (
          !input.fromLocationResourceId &&
          !input.toLocationResourceId
        ) {
          throw new StockOperationError(
            "Choose a source or destination for the location transfer.",
            422,
          );
        }
        if (
          input.fromLocationResourceId &&
          input.fromLocationResourceId === input.toLocationResourceId
        ) {
          throw new StockOperationError(
            "Source and destination must be different locations.",
            422,
          );
        }
      } else if (movementQuantity !== Math.abs(input.delta)) {
        throw new StockOperationError(
          "Movement quantity must match the absolute stock change.",
          422,
        );
      }
      if (!isTransfer) {
        if (input.delta > 0 && input.fromLocationResourceId) {
          throw new StockOperationError(
            "Positive stock changes may only specify a destination location.",
            422,
          );
        }
        if (input.delta < 0 && input.toLocationResourceId) {
          throw new StockOperationError(
            "Negative stock changes may only specify a source location.",
            422,
          );
        }
        if (
          input.delta === 0 &&
          (input.fromLocationResourceId || input.toLocationResourceId)
        ) {
          throw new StockOperationError(
            "Use a transfer to move stock between locations.",
            422,
          );
        }
      }

      await assertStockLocationResources(transaction, organizationId, resourceId, [
        input.fromLocationResourceId,
        input.toLocationResourceId,
      ]);

      const balanceAfter = resource.quantity + input.delta;
      if (
        violatesNegativeStockPolicy({
          allowNegativeStock: resource.allowNegativeStock,
          quantityBefore: resource.quantity,
          quantityAfter: balanceAfter,
        })
      ) {
        throw new StockOperationError(
          `This booking would make stock negative. Current stock is ${resource.quantity}.`,
          409,
        );
      }
      if (Math.abs(balanceAfter) > MAX_STOCK_QUANTITY) {
        throw new StockOperationError(
          `This booking exceeds the supported stock range of -${MAX_STOCK_QUANTITY} to ${MAX_STOCK_QUANTITY}.`,
          409,
        );
      }
      if (!resource.allowNegativeStock && balanceAfter >= 0) {
        const variantAllocation = await allocatedVariantQuantity(
          transaction,
          resourceId,
        );
        assertVariantAllocationFits(
          balanceAfter,
          variantAllocation,
          (message) => new StockOperationError(message, 409),
        );
      }

      if (!settings) {
        await transaction
          .insert(stockSettings)
          .values({ organizationId, resourceId })
          .onConflictDoNothing();
      }
      const now = new Date();

      let fromLocationBalanceAfter: number | null = null;
      let toLocationBalanceAfter: number | null = null;
      if (
        !input.fromLocationResourceId &&
        (isTransfer || input.delta < 0)
      ) {
        const [{ assigned }] = await transaction
          .select({
            assigned: sql<number>`coalesce(sum(${stockLocationBalances.quantity}), 0)::int`,
          })
          .from(stockLocationBalances)
          .where(
            and(
              eq(stockLocationBalances.organizationId, organizationId),
              eq(stockLocationBalances.resourceId, resourceId),
            ),
          );
        const unassigned = resource.quantity - Number(assigned ?? 0);
        const removedFromUnassigned = isTransfer
          ? movementQuantity
          : Math.abs(input.delta);
        if (
          !resource.allowNegativeStock &&
          unassigned < removedFromUnassigned
        ) {
          throw new StockOperationError(
            `Only ${unassigned} unassigned units are available for this booking.`,
            409,
          );
        }
      }
      if (input.fromLocationResourceId) {
        fromLocationBalanceAfter = await changeLocationBalance(
          transaction,
          organizationId,
          resourceId,
          input.fromLocationResourceId,
          isTransfer ? -movementQuantity : Math.min(0, input.delta),
          resource.allowNegativeStock,
        );
      }
      if (input.toLocationResourceId) {
        toLocationBalanceAfter = await changeLocationBalance(
          transaction,
          organizationId,
          resourceId,
          input.toLocationResourceId,
          isTransfer ? movementQuantity : Math.max(0, input.delta),
          resource.allowNegativeStock,
        );
      }
      await transaction
        .update(resources)
        .set({ quantity: balanceAfter, updatedAt: now })
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, resourceId),
          ),
        );
      const [movement] = await transaction
        .insert(stockMovements)
        .values({
          organizationId,
          resourceId,
          delta: input.delta,
          quantity: movementQuantity,
          totalPriceCents: input.totalPriceCents ?? null,
          priceCurrency:
            input.totalPriceCents === null || input.totalPriceCents === undefined
              ? null
              : resource.currency,
          balanceAfter,
          fromLocationBalanceAfter,
          toLocationBalanceAfter,
          type: input.type,
          reason: input.reason ?? null,
          note: input.note ?? "",
          location: input.location ?? null,
          fromLocationResourceId: input.fromLocationResourceId ?? null,
          toLocationResourceId: input.toLocationResourceId ?? null,
          occurredAt: input.occurredAt ?? now,
          createdBy: actor,
        })
        .returning();
      if (input.delta > 0) {
        await addInboundStockCost(transaction, {
          organizationId,
          resourceId,
          movementId: movement.id,
          quantity: movementQuantity,
          totalPriceCents: input.totalPriceCents,
          fallbackUnitCostCents: resource.valueCents,
          currency: resource.currency,
          occurredAt: movement.occurredAt,
        });
      } else if (input.delta < 0) {
        await consumeStockCost(transaction, {
          organizationId,
          resourceId,
          movementId: movement.id,
          quantity: movementQuantity,
          quantityBefore: resource.quantity,
          fallbackUnitCostCents: resource.valueCents,
          currency: resource.currency,
          occurredAt: movement.occurredAt,
        });
      }
      const [costedMovement] = await transaction
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.id, movement.id))
        .limit(1);
      const movementPayload = movementDto(costedMovement ?? movement);
      await enqueueStockMovementWebhookEvents(transaction, [movement]);
      const response = {
        resource: { ...resource, quantity: balanceAfter },
        movement: movementPayload,
      };
      if (idempotency) {
        await transaction.insert(stockMovementRequests).values({
          organizationId,
          idempotencyKey: idempotency.key,
          resourceId,
          actor,
          requestHash: idempotency.requestHash,
          response: JSON.parse(JSON.stringify(response)) as Record<string, unknown>,
        });
      }
      return { response, replayed: false } as const;
    });
  } catch (error) {
    // Requests for different resources do not share a row lock. If they race on
    // one global key, the losing transaction (including its ledger row and
    // quantity update) rolls back on the unique constraint, then replays here.
    if (idempotency) {
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
      if (winner) return validateReplay(winner);
    }
    throw error;
  }
}

const resolveUnitCodes = (
  resourceId: string,
  input: StockUnitCreateInput,
) => {
  if (input.codes?.length) return input.codes;
  if (input.code) return [input.code];
  return Array.from({ length: input.count ?? 1 }, () =>
    `STK-${resourceId.slice(0, 8).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
  );
};

export async function createStockUnits(
  organizationId: string,
  resourceId: string,
  input: StockUnitCreateInput,
  actor: string,
) {
  try {
    return await db.transaction(async (transaction) => {
      const [resource] = await transaction
        .select({
          id: resources.id,
          name: resources.name,
          quantity: resources.quantity,
          type: resources.type,
          categories: resources.categories,
          valueCents: resources.valueCents,
          currency: resources.currency,
        })
        .from(resources)
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, resourceId),
          ),
        )
        .limit(1)
        .for("update");
      if (!resource) throw new StockOperationError("Not found", 404);

      const [settings] = await transaction
        .select()
        .from(stockSettings)
        .where(
          and(
            eq(stockSettings.organizationId, organizationId),
            eq(stockSettings.resourceId, resourceId),
          ),
        )
        .limit(1);
      if (configDto(settings).trackingMode !== "serialized") {
        throw new StockOperationError(
          "Configure this item for serialized tracking before creating identified units.",
          409,
        );
      }

      const codes = resolveUnitCodes(resourceId, input);
      if (!codes.length || codes.length > 100) {
        throw new StockOperationError("Create between 1 and 100 units at a time.", 422);
      }
      if (new Set(codes).size !== codes.length) {
        throw new StockOperationError("Unit codes must be unique within the request.", 422);
      }

      const customFields = await validateCustomFieldValues({
        organizationId,
        entityType: "stock_unit",
        target: { type: resource.type, categories: resource.categories },
        values: input.customFields ?? {},
        enforceRequired: input.customFields !== undefined,
        executor: transaction,
      });
      await assertStockLocationResources(
        transaction,
        organizationId,
        resourceId,
        [input.locationResourceId],
      );

      const occurredAt = input.acquiredAt ?? new Date();
      if (
        input.totalPriceCents !== null &&
        input.totalPriceCents !== undefined &&
        input.priceCurrency?.toUpperCase() !== resource.currency
      ) {
        throw new StockOperationError(
          `Unit prices for this item must use ${resource.currency}.`,
          422,
        );
      }
      const unitCosts = splitCents(input.totalPriceCents ?? null, codes.length);
      const createdUnits = await transaction
        .insert(stockUnits)
        .values(
          codes.map((code, index) => ({
            organizationId,
            resourceId,
            code,
            status: "available" as const,
            location: input.location ?? null,
            locationResourceId: input.locationResourceId ?? null,
            metadata: input.metadata ?? {},
            customFields,
            acquisitionCostCents:
              unitCosts[index] ?? resource.valueCents ?? null,
            costCurrency:
              unitCosts[index] !== null || resource.valueCents !== null
                ? resource.currency
                : null,
            acquiredAt: occurredAt,
            lastMovedAt: occurredAt,
          })),
        )
        .returning();
      const balanceAfter = resource.quantity + createdUnits.length;
      if (balanceAfter > MAX_STOCK_QUANTITY) {
        throw new StockOperationError(
          `Creating these units exceeds the maximum supported stock of ${MAX_STOCK_QUANTITY}.`,
          409,
        );
      }
      const now = new Date();
      await transaction
        .update(resources)
        .set({ quantity: balanceAfter, updatedAt: now })
        .where(
          and(
            eq(resources.organizationId, organizationId),
            eq(resources.id, resourceId),
          ),
        );
      const createdMovements = await transaction
        .insert(stockMovements)
        .values(
          createdUnits.map((unit, index) => ({
            organizationId,
            resourceId,
            unitId: unit.id,
            delta: 1,
            quantity: 1,
            totalPriceCents: unitCosts[index],
            priceCurrency: unitCosts[index] === null ? null : resource.currency,
            balanceAfter: resource.quantity + index + 1,
            type: "unit-created",
            reason: "Serialized unit created",
            note: "",
            location: unit.location,
            toLocationResourceId: unit.locationResourceId,
            occurredAt,
            createdBy: actor,
          })),
        )
        .returning();
      for (const [index, movement] of createdMovements.entries()) {
        await addInboundStockCost(transaction, {
          organizationId,
          resourceId,
          movementId: movement.id,
          unitId: movement.unitId,
          quantity: 1,
          totalPriceCents: unitCosts[index],
          fallbackUnitCostCents: resource.valueCents,
          currency: resource.currency,
          occurredAt,
        });
      }
      const costedMovements = await transaction
        .select()
        .from(stockMovements)
        .where(inArray(stockMovements.id, createdMovements.map((row) => row.id)));
      const costedMovementById = new Map(costedMovements.map((row) => [row.id, row]));
      await enqueueStockMovementWebhookEvents(transaction, createdMovements);
      return {
        resource: { ...resource, quantity: balanceAfter },
        units: createdUnits.map(unitDto),
        movements: createdMovements.map((movement) =>
          movementDto(costedMovementById.get(movement.id) ?? movement),
        ),
      };
    });
  } catch (error) {
    if (
      error instanceof StockOperationError ||
      (error instanceof Error &&
        error.message.includes("stock_units_resource_code_unique"))
    ) {
      if (error instanceof StockOperationError) throw error;
      throw new StockOperationError(
        "A serialized unit with that code already exists for this item.",
        409,
      );
    }
    throw error;
  }
}

export async function updateStockUnit(
  organizationId: string,
  resourceId: string,
  unitId: string,
  input: StockUnitPatchInput,
  actor: string,
) {
  return db.transaction(async (transaction) => {
    const [resource] = await transaction
      .select({
        id: resources.id,
        name: resources.name,
        quantity: resources.quantity,
        type: resources.type,
        categories: resources.categories,
        valueCents: resources.valueCents,
        currency: resources.currency,
      })
      .from(resources)
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!resource) throw new StockOperationError("Not found", 404);

    const [settings] = await transaction
      .select()
      .from(stockSettings)
      .where(
        and(
          eq(stockSettings.organizationId, organizationId),
          eq(stockSettings.resourceId, resourceId),
        ),
      )
      .limit(1);
    if (configDto(settings).trackingMode !== "serialized") {
      throw new StockOperationError(
        "Identified units can only be updated while serialized tracking is active.",
        409,
      );
    }

    const [unit] = await transaction
      .select()
      .from(stockUnits)
      .where(
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.id, unitId),
          eq(stockUnits.resourceId, resourceId),
        ),
      )
      .limit(1)
      .for("update");
    if (!unit) throw new StockOperationError("Unit not found", 404);

    const customFields =
      input.customFields === undefined
        ? unit.customFields
        : await validateCustomFieldValues({
            organizationId,
            entityType: "stock_unit",
            target: { type: resource.type, categories: resource.categories },
            values: input.customFields,
            currentValues: unit.customFields,
            executor: transaction,
          });
    const nextLocationResourceId =
      input.locationResourceId === undefined
        ? unit.locationResourceId
        : input.locationResourceId;
    await assertStockLocationResources(
      transaction,
      organizationId,
      resourceId,
      [nextLocationResourceId],
    );

    if (input.status !== undefined && input.status !== unit.status) {
      const [activeAssignment] = await transaction
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
      if (activeAssignment) {
        throw new StockOperationError(
          "This unit has an active assignment or reservation. Return or cancel it from the item details instead.",
          409,
        );
      }
      const [installation] = await transaction
        .select({ id: assemblyBuildComponents.id })
        .from(assemblyBuildComponents)
        .where(
          and(
            eq(assemblyBuildComponents.organizationId, organizationId),
            eq(assemblyBuildComponents.componentUnitId, unit.id),
          ),
        )
        .limit(1);
      if (installation) {
        throw new StockOperationError(
          "This unit is installed in an assembly. Its status cannot be changed directly; use a future disassembly or correction workflow so the build history remains intact.",
          409,
        );
      }
    }

    const nextStatus = input.status ?? unit.status;
    const wasAvailable = unit.status === "available";
    const isAvailable = nextStatus === "available";
    const delta = wasAvailable === isAvailable ? 0 : isAvailable ? 1 : -1;
    if (
      input.totalPriceCents !== null &&
      input.totalPriceCents !== undefined &&
      input.priceCurrency?.toUpperCase() !== resource.currency
    ) {
      throw new StockOperationError(
        `The transaction price must use ${resource.currency}.`,
        422,
      );
    }
    if (delta > 0 && input.totalPriceCents != null && input.totalPriceCents < 0) {
      throw new StockOperationError(
        "Inbound stock prices cannot be negative.",
        422,
      );
    }
    if (delta === 0 && input.totalPriceCents != null) {
      throw new StockOperationError(
        "A transaction price can only be recorded when the unit enters or leaves available stock.",
        422,
      );
    }
    const balanceAfter = resource.quantity + delta;
    if (balanceAfter < 0) {
      throw new StockOperationError(
        "This unit change would make available stock negative.",
        409,
      );
    }
    if (balanceAfter > MAX_STOCK_QUANTITY) {
      throw new StockOperationError(
        `This unit change exceeds the maximum supported stock of ${MAX_STOCK_QUANTITY}.`,
        409,
      );
    }

    const occurredAt = input.occurredAt ?? new Date();
    const now = new Date();
    const nextLocation =
      input.location === undefined ? unit.location : input.location;
    const [savedUnit] = await transaction
      .update(stockUnits)
      .set({
        status: nextStatus,
        location: nextLocation,
        locationResourceId: nextLocationResourceId,
        metadata: input.metadata ?? unit.metadata,
        customFields,
        acquisitionCostCents:
          delta > 0 && input.totalPriceCents != null
            ? input.totalPriceCents
            : unit.acquisitionCostCents,
        costCurrency:
          delta > 0 && input.totalPriceCents != null
            ? resource.currency
            : unit.costCurrency,
        lastMovedAt: occurredAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(stockUnits.organizationId, organizationId),
          eq(stockUnits.id, unit.id),
        ),
      )
      .returning();
    await transaction
      .update(resources)
      .set({ quantity: balanceAfter, updatedAt: now })
      .where(
        and(
          eq(resources.organizationId, organizationId),
          eq(resources.id, resourceId),
        ),
      );
    const statusChanged = unit.status !== nextStatus;
    const structuredLocationChanged =
      unit.locationResourceId !== nextLocationResourceId;
    const [movement] = await transaction
      .insert(stockMovements)
      .values({
        organizationId,
        resourceId,
        unitId: unit.id,
        delta,
        quantity: Math.max(Math.abs(delta), structuredLocationChanged ? 1 : 0),
        totalPriceCents: input.totalPriceCents ?? null,
        priceCurrency:
          input.totalPriceCents === null || input.totalPriceCents === undefined
            ? null
            : resource.currency,
        balanceAfter,
        type: statusChanged ? "unit-status" : "unit-update",
        reason:
          input.reason ??
          (statusChanged
            ? `Unit status changed from ${unit.status} to ${nextStatus}`
            : "Unit details updated"),
        note: input.note ?? "",
        location: nextLocation,
        fromLocationResourceId:
          structuredLocationChanged ? unit.locationResourceId : null,
        toLocationResourceId:
          structuredLocationChanged ? nextLocationResourceId : null,
        occurredAt,
        createdBy: actor,
      })
      .returning();
    if (delta > 0) {
      await addInboundStockCost(transaction, {
        organizationId,
        resourceId,
        movementId: movement.id,
        unitId: unit.id,
        quantity: 1,
        totalPriceCents: input.totalPriceCents,
        fallbackUnitCostCents:
          input.totalPriceCents ?? unit.acquisitionCostCents ?? resource.valueCents,
        currency: resource.currency,
        occurredAt,
      });
    } else if (delta < 0) {
      await consumeStockCost(transaction, {
        organizationId,
        resourceId,
        movementId: movement.id,
        unitId: unit.id,
        quantity: 1,
        quantityBefore: resource.quantity,
        fallbackUnitCostCents:
          unit.acquisitionCostCents ?? resource.valueCents,
        currency: resource.currency,
        occurredAt,
      });
    }
    const [costedMovement] = await transaction
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, movement.id))
      .limit(1);
    await enqueueStockMovementWebhookEvents(transaction, [costedMovement ?? movement]);
    return {
      resource: { ...resource, quantity: balanceAfter },
      unit: unitDto(savedUnit),
      movement: movementDto(costedMovement ?? movement),
    };
  });
}
