import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { orderLoanHandovers, resources, type OrderRecord } from "@/db/schema";
import { db, type DatabaseExecutor, type DatabaseTransaction } from "@/lib/db";
import { HandoverBodyError, validateHandoverTransition, type LoanHandoverInput, type LoanHandoverDocument } from "@/lib/loan-handover-contract";
import { normalizeHandoverPhotos } from "@/lib/loan-handovers";

export async function prepareOrderHandover(type: string, action: string, input?: LoanHandoverInput) {
  if (!input) return undefined;
  if (type !== "loan" || !["issue", "return"].includes(action)) throw new HandoverBodyError("Handover reports require a loan issue or return.", 422);
  try { return await normalizeHandoverPhotos(input); }
  catch { throw new HandoverBodyError("Invalid handover report or photo.", 422); }
}

export async function getOrderLoanHandovers(organizationId: string, lineId: string, unitId?: string | null, executor: DatabaseExecutor = db) {
  const rows = await executor.select({ document: orderLoanHandovers.document }).from(orderLoanHandovers)
    .where(and(eq(orderLoanHandovers.organizationId, organizationId), eq(orderLoanHandovers.orderLineId, lineId),
      unitId === undefined ? undefined : unitId === null ? isNull(orderLoanHandovers.unitId) : eq(orderLoanHandovers.unitId, unitId)))
    .orderBy(orderLoanHandovers.createdAt, orderLoanHandovers.id);
  return rows.map((row) => row.document);
}

export async function recordOrderLoanHandover(transaction: DatabaseTransaction, context: {
  order: OrderRecord; lineId: string; resourceId: string; unitId: string | null; unitCode: string | null;
  quantity: number; movementId: string; occurredAt: Date; actor: string; action: "issue" | "return";
}, handover?: LoanHandoverInput) {
  if (context.order.type !== "loan") return;
  const phase = context.action === "issue" ? "checkout" : "return";
  if (phase === "checkout" && handover?.accessories.length) {
    const originals = (await getOrderLoanHandovers(context.order.organizationId, context.lineId, context.unitId, transaction)).filter((document) => document.phase === "checkout");
    const names = new Set([...originals.flatMap((document) => document.accessories), ...handover.accessories].map((item) => item.name.toLocaleLowerCase("en")));
    if (names.size > 30) throw new HandoverBodyError("A loan position can contain at most 30 distinct accessories across its handovers.", 422);
  }
  if (phase === "return") {
    const originals = (await getOrderLoanHandovers(context.order.organizationId, context.lineId, context.unitId, transaction)).filter((document) => document.phase === "checkout");
    const error = validateHandoverTransition({ phase, kind: "checkout", documentedCheckout: originals.length > 0, handover, originalAccessories: originals.flatMap((document) => document.accessories) });
    if (error) throw new HandoverBodyError(error, 422);
  }
  if (!handover) return;
  const [resource] = await transaction.select({ name: resources.name }).from(resources)
    .where(and(eq(resources.organizationId, context.order.organizationId), eq(resources.id, context.resourceId))).limit(1);
  const recordedAt = new Date();
  const document: LoanHandoverDocument = {
    ...handover, version: 1, phase, assignmentId: null, orderId: context.order.id, orderLineId: context.lineId, movementId: context.movementId,
    resourceId: context.resourceId, resourceName: resource?.name ?? "Inventory item", unitCode: context.unitCode,
    quantity: context.quantity, borrower: context.order.contactName, dueAt: context.order.expectedAt?.toISOString() ?? null,
    occurredAt: context.occurredAt.toISOString(), recordedAt: recordedAt.toISOString(), recordedBy: context.actor,
  };
  await transaction.insert(orderLoanHandovers).values({ organizationId: context.order.organizationId, orderLineId: context.lineId,
    movementId: context.movementId, unitId: context.unitId, phase, document, createdAt: recordedAt });
}
