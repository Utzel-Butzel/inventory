import "server-only";

import { and, asc, eq, gt } from "drizzle-orm";

import {
  stockCostAllocations,
  stockCostLayers,
  stockMovements,
} from "@/db/schema";
import { db } from "@/lib/db";

type StockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StockCostResult = {
  costCents: number | null;
  currency: string;
  estimated: boolean;
  unpricedQuantity: number;
};

const normalizeCurrency = (currency: string) => currency.trim().toUpperCase();

export function splitCents(totalCents: number | null, parts: number) {
  if (totalCents === null) return Array.from({ length: parts }, () => null);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, index) =>
    base + (index < remainder ? 1 : 0),
  );
}

export async function addInboundStockCost(
  transaction: StockTransaction,
  input: {
    organizationId: string;
    resourceId: string;
    movementId: string;
    unitId?: string | null;
    quantity: number;
    totalPriceCents?: number | null;
    fallbackUnitCostCents?: number | null;
    currency: string;
    occurredAt: Date;
    estimated?: boolean;
  },
): Promise<StockCostResult> {
  const currency = normalizeCurrency(input.currency);
  const explicit = input.totalPriceCents ?? null;
  const estimated =
    input.estimated ?? (explicit === null && input.fallbackUnitCostCents != null);
  const costCents =
    explicit ??
    (input.fallbackUnitCostCents === null || input.fallbackUnitCostCents === undefined
      ? null
      : input.fallbackUnitCostCents * input.quantity);

  await transaction.insert(stockCostLayers).values({
    organizationId: input.organizationId,
    resourceId: input.resourceId,
    sourceMovementId: input.movementId,
    unitId: input.unitId ?? null,
    initialQuantity: input.quantity,
    remainingQuantity: input.quantity,
    initialCostCents: costCents,
    remainingCostCents: costCents,
    currency,
    estimated,
    occurredAt: input.occurredAt,
  });
  await transaction
    .update(stockMovements)
    .set({
      costCents,
      costCurrency: costCents === null ? null : currency,
      costEstimated: estimated,
    })
    .where(
      and(
        eq(stockMovements.organizationId, input.organizationId),
        eq(stockMovements.id, input.movementId),
      ),
    );

  return {
    costCents,
    currency,
    estimated,
    unpricedQuantity: costCents === null ? input.quantity : 0,
  };
}

async function insertLegacyLayer(
  transaction: StockTransaction,
  input: {
    organizationId: string;
    resourceId: string;
    unitId?: string | null;
    quantity: number;
    fallbackUnitCostCents?: number | null;
    currency: string;
    occurredAt: Date;
  },
) {
  if (input.quantity <= 0) return;
  const totalCostCents =
    input.fallbackUnitCostCents === null || input.fallbackUnitCostCents === undefined
      ? null
      : input.fallbackUnitCostCents * input.quantity;
  await transaction.insert(stockCostLayers).values({
    organizationId: input.organizationId,
    resourceId: input.resourceId,
    unitId: input.unitId ?? null,
    initialQuantity: input.quantity,
    remainingQuantity: input.quantity,
    initialCostCents: totalCostCents,
    remainingCostCents: totalCostCents,
    currency: normalizeCurrency(input.currency),
    estimated: true,
    occurredAt: input.occurredAt,
  });
}

export async function consumeStockCost(
  transaction: StockTransaction,
  input: {
    organizationId: string;
    resourceId: string;
    movementId: string;
    unitId?: string | null;
    quantity: number;
    quantityBefore: number;
    fallbackUnitCostCents?: number | null;
    currency: string;
    occurredAt: Date;
  },
): Promise<StockCostResult> {
  const currency = normalizeCurrency(input.currency);
  const unitFilter = input.unitId
    ? eq(stockCostLayers.unitId, input.unitId)
    : undefined;
  let layers = await transaction
    .select()
    .from(stockCostLayers)
    .where(
      and(
        eq(stockCostLayers.organizationId, input.organizationId),
        eq(stockCostLayers.resourceId, input.resourceId),
        gt(stockCostLayers.remainingQuantity, 0),
        unitFilter,
      ),
    )
    .orderBy(
      asc(stockCostLayers.occurredAt),
      asc(stockCostLayers.createdAt),
      asc(stockCostLayers.id),
    )
    .for("update");

  let layeredQuantity = layers.reduce(
    (total, layer) => total + layer.remainingQuantity,
    0,
  );
  const expectedLayeredQuantity = input.unitId
    ? 1
    : Math.max(0, input.quantityBefore);
  let excessQuantity = Math.max(0, layeredQuantity - expectedLayeredQuantity);
  if (excessQuantity > 0) {
    for (const layer of layers) {
      if (excessQuantity <= 0) break;
      const quantity = Math.min(excessQuantity, layer.remainingQuantity);
      const costCents =
        layer.remainingCostCents === null
          ? null
          : quantity === layer.remainingQuantity
            ? layer.remainingCostCents
            : Math.round(
                (layer.remainingCostCents * quantity) / layer.remainingQuantity,
              );
      await transaction
        .update(stockCostLayers)
        .set({
          remainingQuantity: layer.remainingQuantity - quantity,
          remainingCostCents:
            layer.remainingCostCents === null
              ? null
              : layer.remainingCostCents - (costCents ?? 0),
        })
        .where(eq(stockCostLayers.id, layer.id));
      excessQuantity -= quantity;
    }
    layers = await transaction
      .select()
      .from(stockCostLayers)
      .where(
        and(
          eq(stockCostLayers.organizationId, input.organizationId),
          eq(stockCostLayers.resourceId, input.resourceId),
          gt(stockCostLayers.remainingQuantity, 0),
          unitFilter,
        ),
      )
      .orderBy(
        asc(stockCostLayers.occurredAt),
        asc(stockCostLayers.createdAt),
        asc(stockCostLayers.id),
      )
      .for("update");
    layeredQuantity = layers.reduce(
      (total, layer) => total + layer.remainingQuantity,
      0,
    );
  }
  const legacyQuantity = input.unitId
    ? layers.length
      ? 0
      : 1
    : Math.max(0, input.quantityBefore - layeredQuantity);
  if (legacyQuantity > 0) {
    await insertLegacyLayer(transaction, {
      organizationId: input.organizationId,
      resourceId: input.resourceId,
      unitId: input.unitId,
      quantity: legacyQuantity,
      fallbackUnitCostCents: input.fallbackUnitCostCents,
      currency,
      occurredAt: new Date(0),
    });
    layers = await transaction
      .select()
      .from(stockCostLayers)
      .where(
        and(
          eq(stockCostLayers.organizationId, input.organizationId),
          eq(stockCostLayers.resourceId, input.resourceId),
          gt(stockCostLayers.remainingQuantity, 0),
          unitFilter,
        ),
      )
      .orderBy(
        asc(stockCostLayers.occurredAt),
        asc(stockCostLayers.createdAt),
        asc(stockCostLayers.id),
      )
      .for("update");
  }

  let remaining = input.quantity;
  let totalCostCents = 0;
  let unpricedQuantity = 0;
  let estimated = false;
  for (const layer of layers) {
    if (remaining <= 0) break;
    const quantity = Math.min(remaining, layer.remainingQuantity);
    const costCents =
      layer.remainingCostCents === null
        ? null
        : quantity === layer.remainingQuantity
          ? layer.remainingCostCents
          : Math.round(
              (layer.remainingCostCents * quantity) / layer.remainingQuantity,
            );
    const remainingQuantity = layer.remainingQuantity - quantity;
    const remainingCostCents =
      layer.remainingCostCents === null
        ? null
        : layer.remainingCostCents - (costCents ?? 0);
    await transaction
      .update(stockCostLayers)
      .set({ remainingQuantity, remainingCostCents })
      .where(eq(stockCostLayers.id, layer.id));
    await transaction.insert(stockCostAllocations).values({
      organizationId: input.organizationId,
      movementId: input.movementId,
      layerId: layer.id,
      quantity,
      costCents,
      currency: layer.currency,
      estimated: layer.estimated,
    });
    if (costCents === null) unpricedQuantity += quantity;
    else totalCostCents += costCents;
    estimated ||= layer.estimated;
    remaining -= quantity;
  }

  if (remaining > 0) {
    const [unknownLayer] = await transaction
      .insert(stockCostLayers)
      .values({
        organizationId: input.organizationId,
        resourceId: input.resourceId,
        unitId: input.unitId ?? null,
        initialQuantity: remaining,
        remainingQuantity: 0,
        initialCostCents: null,
        remainingCostCents: null,
        currency,
        estimated: true,
        occurredAt: input.occurredAt,
      })
      .returning();
    await transaction.insert(stockCostAllocations).values({
      organizationId: input.organizationId,
      movementId: input.movementId,
      layerId: unknownLayer.id,
      quantity: remaining,
      costCents: null,
      currency,
      estimated: true,
    });
    unpricedQuantity += remaining;
    estimated = true;
  }

  const costCents = unpricedQuantity > 0 ? null : totalCostCents;
  await transaction
    .update(stockMovements)
    .set({
      costCents,
      costCurrency: costCents === null ? null : currency,
      costEstimated: estimated,
    })
    .where(
      and(
        eq(stockMovements.organizationId, input.organizationId),
        eq(stockMovements.id, input.movementId),
      ),
    );

  return { costCents, currency, estimated, unpricedQuantity };
}
