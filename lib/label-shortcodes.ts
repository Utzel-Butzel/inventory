import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { labelShortcodes, organizations, resources, stockUnits } from "@/db/schema";
import { db } from "@/lib/db";
import { LABEL_SHORTCODE_PATTERN } from "@/lib/label-shortcode-contract";

export async function labelShortcodeTargetExists(organizationId: string, resourceId: string, stockUnitId: string | null) {
  const [resource] = await db.select({ id: resources.id }).from(resources)
    .where(and(eq(resources.organizationId, organizationId), eq(resources.id, resourceId))).limit(1);
  if (!resource) return false;
  if (!stockUnitId) return true;
  const [unit] = await db.select({ id: stockUnits.id }).from(stockUnits).where(and(
    eq(stockUnits.organizationId, organizationId), eq(stockUnits.resourceId, resourceId), eq(stockUnits.id, stockUnitId),
  )).limit(1);
  return Boolean(unit);
}

/** ON CONFLICT handles both concurrent requests for one target and random collisions. */
export async function ensureLabelShortcode(organizationId: string, resourceId: string, stockUnitId: string | null) {
  if (!await labelShortcodeTargetExists(organizationId, resourceId, stockUnitId)) return null;
  const target = and(eq(labelShortcodes.organizationId, organizationId), eq(labelShortcodes.resourceId, resourceId),
    stockUnitId ? eq(labelShortcodes.stockUnitId, stockUnitId) : isNull(labelShortcodes.stockUnitId));
  for (let attempt = 0; attempt < 8; attempt++) {
    const [existing] = await db.select({ code: labelShortcodes.code }).from(labelShortcodes).where(target).limit(1);
    if (existing) return existing.code;
    const code = randomBytes(6).toString("base64url");
    const [created] = await db.insert(labelShortcodes).values({ code, organizationId, resourceId, stockUnitId })
      .onConflictDoNothing().returning({ code: labelShortcodes.code });
    if (created) return created.code;
  }
  throw new Error("Unable to allocate a label shortcode.");
}

export async function resolveLabelShortcode(code: string, organizationId?: string) {
  if (!LABEL_SHORTCODE_PATTERN.test(code)) return null;
  const [target] = await db.select({
    resourceId: labelShortcodes.resourceId, stockUnitId: labelShortcodes.stockUnitId,
    organizationId: labelShortcodes.organizationId, organizationSlug: organizations.slug,
  }).from(labelShortcodes).innerJoin(organizations, eq(organizations.id, labelShortcodes.organizationId))
    .where(and(eq(labelShortcodes.code, code), organizationId ? eq(labelShortcodes.organizationId, organizationId) : undefined)).limit(1);
  if (!target || !await labelShortcodeTargetExists(target.organizationId, target.resourceId, target.stockUnitId)) return null;
  return target;
}
