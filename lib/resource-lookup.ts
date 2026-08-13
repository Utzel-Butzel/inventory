import "server-only";

import { and, eq } from "drizzle-orm";

import { resources, resourceVariants } from "@/db/schema";
import { db } from "@/lib/db";
import { parseResourceCode } from "@/lib/resource-code";
import { getResource } from "@/lib/resources";
import { resourceVariantDto } from "@/lib/resource-variants";

export type ResourceCodeMatch =
  | "id"
  | "sku"
  | "barcode"
  | "serialNumber"
  | "variantSku"
  | "variantBarcode";

export class AmbiguousResourceCodeError extends Error {
  constructor() {
    super("More than one inventory item uses this serial number.");
    this.name = "AmbiguousResourceCodeError";
  }
}

export async function lookupResourceByCode(
  organizationId: string,
  value: string,
) {
  const parsed = parseResourceCode(value);
  if (!parsed.code) return null;

  if (parsed.resourceId) {
    const resource = await getResource(organizationId, parsed.resourceId);
    if (resource) return { resource, matchedBy: "id" as const };
  }

  // Scanner values are identifiers, not search terms: keep them case-sensitive
  // and prefer the globally unique SKU before the legacy serial-number field.
  const [skuRow] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.sku, parsed.code),
      ),
    )
    .limit(1);
  if (skuRow) {
    const resource = await getResource(organizationId, skuRow.id);
    return resource ? { resource, matchedBy: "sku" as const } : null;
  }

  const [barcodeRow] = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.barcode, parsed.code),
      ),
    )
    .limit(1);
  if (barcodeRow) {
    const resource = await getResource(organizationId, barcodeRow.id);
    return resource ? { resource, matchedBy: "barcode" as const } : null;
  }

  const [variantSku] = await db
    .select()
    .from(resourceVariants)
    .where(
      and(
        eq(resourceVariants.organizationId, organizationId),
        eq(resourceVariants.sku, parsed.code),
      ),
    )
    .limit(1);
  if (variantSku) {
    const resource = await getResource(organizationId, variantSku.resourceId);
    return resource
      ? {
          resource,
          variant: resourceVariantDto(variantSku),
          matchedBy: "variantSku" as const,
        }
      : null;
  }

  const [variantBarcode] = await db
    .select()
    .from(resourceVariants)
    .where(
      and(
        eq(resourceVariants.organizationId, organizationId),
        eq(resourceVariants.barcode, parsed.code),
      ),
    )
    .limit(1);
  if (variantBarcode) {
    const resource = await getResource(
      organizationId,
      variantBarcode.resourceId,
    );
    return resource
      ? {
          resource,
          variant: resourceVariantDto(variantBarcode),
          matchedBy: "variantBarcode" as const,
        }
      : null;
  }

  const serialRows = await db
    .select({ id: resources.id })
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.serialNumber, parsed.code),
      ),
    )
    .limit(2);
  if (serialRows.length > 1) throw new AmbiguousResourceCodeError();
  const serialRow = serialRows[0];
  if (!serialRow) return null;
  const resource = await getResource(organizationId, serialRow.id);
  if (!resource) return null;
  return { resource, matchedBy: "serialNumber" as const };
}
