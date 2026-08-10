import "server-only";

import { eq } from "drizzle-orm";

import { resources } from "@/db/schema";
import { db } from "@/lib/db";
import { parseResourceCode } from "@/lib/resource-code";
import { getResource } from "@/lib/resources";

export type ResourceCodeMatch = "id" | "sku" | "serialNumber";

export class AmbiguousResourceCodeError extends Error {
  constructor() {
    super("More than one inventory item uses this serial number.");
    this.name = "AmbiguousResourceCodeError";
  }
}

export async function lookupResourceByCode(value: string) {
  const parsed = parseResourceCode(value);
  if (!parsed.code) return null;

  if (parsed.resourceId) {
    const resource = await getResource(parsed.resourceId);
    if (resource) return { resource, matchedBy: "id" as const };
  }

  // Scanner values are identifiers, not search terms: keep them case-sensitive
  // and prefer the globally unique SKU before the legacy serial-number field.
  const [skuRow] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.sku, parsed.code))
    .limit(1);
  if (skuRow) {
    const resource = await getResource(skuRow.id);
    return resource ? { resource, matchedBy: "sku" as const } : null;
  }

  const serialRows = await db
    .select({ id: resources.id })
    .from(resources)
    .where(eq(resources.serialNumber, parsed.code))
    .limit(2);
  if (serialRows.length > 1) throw new AmbiguousResourceCodeError();
  const serialRow = serialRows[0];
  if (!serialRow) return null;
  const resource = await getResource(serialRow.id);
  if (!resource) return null;
  return { resource, matchedBy: "serialNumber" as const };
}
