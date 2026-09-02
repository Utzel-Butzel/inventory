import "server-only";

import { and, eq } from "drizzle-orm";

import { resourceLendingSettings, resources } from "@/db/schema";
import { db } from "@/lib/db";
import {
  DEFAULT_LOAN_DURATION_DAYS,
  DEFAULT_MAX_LOAN_DURATION_DAYS,
  type LendingSettingsInput,
} from "@/lib/lending-contract";

export const disabledLendingSettings = {
  enabled: false,
  approvalRequired: true,
  defaultDurationDays: DEFAULT_LOAN_DURATION_DAYS,
  maxDurationDays: DEFAULT_MAX_LOAN_DURATION_DAYS,
} as const;

export function lendingSettingsDto(
  row: typeof resourceLendingSettings.$inferSelect | undefined,
) {
  return row
    ? {
        enabled: row.enabled,
        approvalRequired: row.approvalRequired,
        defaultDurationDays: row.defaultDurationDays,
        maxDurationDays: row.maxDurationDays,
      }
    : { ...disabledLendingSettings };
}

export async function getResourceLendingSettings(
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

  const [settings] = await db
    .select()
    .from(resourceLendingSettings)
    .where(
      and(
        eq(resourceLendingSettings.organizationId, organizationId),
        eq(resourceLendingSettings.resourceId, resourceId),
      ),
    )
    .limit(1);
  return lendingSettingsDto(settings);
}

export async function updateResourceLendingSettings(
  organizationId: string,
  resourceId: string,
  input: LendingSettingsInput,
  actor: string,
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

  const now = new Date();
  const [settings] = await db
    .insert(resourceLendingSettings)
    .values({
      organizationId,
      resourceId,
      ...input,
      createdBy: actor,
      updatedBy: actor,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: resourceLendingSettings.resourceId,
      set: {
        ...input,
        updatedBy: actor,
        updatedAt: now,
      },
    })
    .returning();
  return lendingSettingsDto(settings);
}
