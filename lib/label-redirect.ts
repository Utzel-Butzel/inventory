import "server-only";

import { and, eq } from "drizzle-orm";
import { organizations, resources, stockUnits } from "@/db/schema";
import { db } from "@/lib/db";
import { labelExternalDestination } from "@/lib/label-redirect-contract";

/** Resolve the owner from the label, never from the scanning user's active organization. */
export async function getLabelExternalDestination(resourceId: string, stockUnitId: string | null, requestUrl: string) {
  const [owner] = await db.select({ organizationId: organizations.id, url: organizations.labelQrRedirectUrl })
    .from(resources).innerJoin(organizations, eq(organizations.id, resources.organizationId))
    .where(eq(resources.id, resourceId)).limit(1);
  if (!owner?.url) return null;
  if (stockUnitId) {
    const [unit] = await db.select({ id: stockUnits.id }).from(stockUnits).where(and(
      eq(stockUnits.id, stockUnitId), eq(stockUnits.resourceId, resourceId), eq(stockUnits.organizationId, owner.organizationId),
    )).limit(1);
    if (!unit) return null;
  }
  return labelExternalDestination(owner.url, requestUrl);
}
