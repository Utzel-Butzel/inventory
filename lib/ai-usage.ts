import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";

import { aiUsageEvents, organizations } from "@/db/schema";
import type { AiUsageEstimate } from "@/lib/ai-billing";
import type { RequestIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";

export type AiUsageActor = Pick<
  RequestIdentity,
  "subject" | "name" | "userId" | "tokenId"
>;

export class AiMonthlyBudgetExceededError extends Error {
  readonly code = "AI_MONTHLY_BUDGET_EXCEEDED";

  constructor(
    public readonly budgetMicros: number,
    public readonly spentMicros: number,
    public readonly requestedMicros: number,
  ) {
    super("The organization's monthly AI budget has been reached.");
    this.name = "AiMonthlyBudgetExceededError";
  }
}

export const aiBudgetErrorBody = (error: AiMonthlyBudgetExceededError) => ({
  error: error.message,
  code: error.code,
  budgetMicros: error.budgetMicros,
  spentMicros: error.spentMicros,
  requestedMicros: error.requestedMicros,
});

export const utcMonthRange = (now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
};

async function reserveAiUsage(options: {
  organizationId: string;
  estimate: AiUsageEstimate;
  actor: AiUsageActor;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { start, end } = utcMonthRange();
  return db.transaction(async (transaction) => {
    // One tenant-scoped transaction lock makes the sum-and-reserve operation
    // atomic without blocking unrelated organizations.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${options.organizationId}))`,
    );
    const [organization] = await transaction
      .select({ budgetMicros: organizations.aiMonthlyBudgetMicros })
      .from(organizations)
      .where(eq(organizations.id, options.organizationId))
      .limit(1);
    if (!organization) throw new Error("Organization not found.");

    const [usage] = await transaction
      .select({
        total: sql<string>`coalesce(sum(${aiUsageEvents.costMicros}), 0)::text`,
      })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.organizationId, options.organizationId),
          gte(aiUsageEvents.createdAt, start),
          lt(aiUsageEvents.createdAt, end),
        ),
      );
    const spentMicros = Number(usage?.total ?? 0);
    const budgetMicros = organization.budgetMicros;
    if (
      budgetMicros !== null &&
      spentMicros + options.estimate.costMicros > budgetMicros
    ) {
      throw new AiMonthlyBudgetExceededError(
        budgetMicros,
        spentMicros,
        options.estimate.costMicros,
      );
    }

    const [event] = await transaction
      .insert(aiUsageEvents)
      .values({
        organizationId: options.organizationId,
        action: options.estimate.action,
        provider: options.estimate.provider,
        model: options.estimate.model,
        costMicros: options.estimate.costMicros,
        costEstimated: options.estimate.estimated,
        actor: options.actor.subject,
        actorName: options.actor.name || null,
        userId: options.actor.userId ?? null,
        tokenId: options.actor.tokenId ?? null,
        resourceId: options.resourceId ?? null,
        metadata: options.metadata ?? {},
      })
      .returning({ id: aiUsageEvents.id });
    if (!event) throw new Error("Unable to reserve AI usage.");
    return event.id;
  });
}

async function finishAiUsage(
  organizationId: string,
  id: string,
  status: "succeeded" | "failed",
) {
  await db
    .update(aiUsageEvents)
    .set({ status, completedAt: new Date() })
    .where(
      and(
        eq(aiUsageEvents.organizationId, organizationId),
        eq(aiUsageEvents.id, id),
      ),
    );
}

/**
 * Reserve estimated spend before contacting a paid provider and retain the
 * estimate even when the provider attempt fails, since failed attempts may be
 * billable. Completion writes are best effort so an accepted provider result
 * is not discarded merely because its status remains "running" in the ledger.
 */
export async function trackAiUsage<T>(options: {
  organizationId: string;
  estimate: AiUsageEstimate;
  actor: AiUsageActor;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T> {
  const eventId = await reserveAiUsage(options);
  try {
    const result = await options.run();
    await finishAiUsage(options.organizationId, eventId, "succeeded").catch(
      (error) => console.error("Unable to finalize AI usage tracking.", error),
    );
    return result;
  } catch (error) {
    await finishAiUsage(options.organizationId, eventId, "failed").catch(
      (trackingError) =>
        console.error("Unable to mark failed AI usage tracking.", trackingError),
    );
    throw error;
  }
}
