import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { aiUsageEvents, organizations } from "@/db/schema";
import { aiBillableActions } from "@/lib/ai-billing";
import { utcMonthRange } from "@/lib/ai-usage";
import { requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };
const budgetSchema = z
  .object({
    monthlyBudgetUsd: z.number().min(0).max(1_000_000).nullable(),
  })
  .strict();

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;
  const { start, end } = utcMonthRange();

  const [organizationRows, summaryRows, actionRows, recent] = await Promise.all([
    db
      .select({ budgetMicros: organizations.aiMonthlyBudgetMicros })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1),
    db
      .select({
        costMicros: sql<string>`coalesce(sum(${aiUsageEvents.costMicros}), 0)::text`,
        actionCount: sql<number>`count(*)::int`,
        runningCount: sql<number>`count(*) filter (where ${aiUsageEvents.status} = 'running')::int`,
        failedCount: sql<number>`count(*) filter (where ${aiUsageEvents.status} = 'failed')::int`,
      })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.organizationId, organizationId),
          gte(aiUsageEvents.createdAt, start),
          lt(aiUsageEvents.createdAt, end),
        ),
      ),
    db
      .select({
        action: aiUsageEvents.action,
        costMicros: sql<string>`sum(${aiUsageEvents.costMicros})::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.organizationId, organizationId),
          gte(aiUsageEvents.createdAt, start),
          lt(aiUsageEvents.createdAt, end),
        ),
      )
      .groupBy(aiUsageEvents.action),
    db
      .select({
        id: aiUsageEvents.id,
        action: aiUsageEvents.action,
        provider: aiUsageEvents.provider,
        model: aiUsageEvents.model,
        status: aiUsageEvents.status,
        costMicros: aiUsageEvents.costMicros,
        costEstimated: aiUsageEvents.costEstimated,
        actor: aiUsageEvents.actor,
        actorName: aiUsageEvents.actorName,
        resourceId: aiUsageEvents.resourceId,
        createdAt: aiUsageEvents.createdAt,
        completedAt: aiUsageEvents.completedAt,
      })
      .from(aiUsageEvents)
      .where(eq(aiUsageEvents.organizationId, organizationId))
      .orderBy(desc(aiUsageEvents.createdAt))
      .limit(25),
  ]);

  const budgetMicros = organizationRows[0]?.budgetMicros ?? null;
  const costMicros = Number(summaryRows[0]?.costMicros ?? 0);
  const byAction = new Map(
    actionRows.map((row) => [
      row.action,
      { action: row.action, costMicros: Number(row.costMicros), count: row.count },
    ]),
  );

  return Response.json(
    {
      currency: "USD",
      estimated: true,
      period: { start: start.toISOString(), end: end.toISOString() },
      budgetMicros,
      remainingMicros:
        budgetMicros === null ? null : Math.max(0, budgetMicros - costMicros),
      summary: {
        costMicros,
        actionCount: summaryRows[0]?.actionCount ?? 0,
        runningCount: summaryRows[0]?.runningCount ?? 0,
        failedCount: summaryRows[0]?.failedCount ?? 0,
      },
      byAction: aiBillableActions.map(
        (action) => byAction.get(action) ?? { action, costMicros: 0, count: 0 },
      ),
      recent,
    },
    { headers: noStoreHeaders },
  );
}

export async function PATCH(request: Request) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected JSON." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const parsed = budgetSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid AI budget.", details: parsed.error.flatten() },
      { status: 422, headers: noStoreHeaders },
    );
  }
  const budgetMicros =
    parsed.data.monthlyBudgetUsd === null
      ? null
      : Math.round(parsed.data.monthlyBudgetUsd * 1_000_000);
  const [organization] = await db
    .update(organizations)
    .set({ aiMonthlyBudgetMicros: budgetMicros, updatedAt: new Date() })
    .where(eq(organizations.id, authorization.identity.organizationId))
    .returning({ budgetMicros: organizations.aiMonthlyBudgetMicros });
  if (!organization) {
    return Response.json(
      { error: "Organization not found." },
      { status: 404, headers: noStoreHeaders },
    );
  }
  return Response.json(
    { budgetMicros: organization.budgetMicros },
    { headers: noStoreHeaders },
  );
}
