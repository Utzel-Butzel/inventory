import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { resources } from "@/db/schema";
import { db } from "@/lib/db";

type ResourceIdentifiers = {
  sku?: string | null;
  barcode?: string | null;
};

export class ResourceIdentifierConflictError extends Error {
  constructor(readonly field: "sku" | "barcode") {
    super(
      field === "sku"
        ? "That SKU is already used by an item or variant."
        : "That barcode is already used by an item or variant.",
    );
    this.name = "ResourceIdentifierConflictError";
  }
}

export async function assertResourceIdentifiersAvailable(
  organizationId: string,
  identifiers: ResourceIdentifiers,
  excludingResourceId?: string,
) {
  const checks: Promise<unknown>[] = [];
  if (identifiers.sku) {
    checks.push(
      db
        .select({ id: resources.id })
        .from(resources)
        .where(
          excludingResourceId
            ? and(
                eq(resources.organizationId, organizationId),
                eq(resources.sku, identifiers.sku),
                ne(resources.id, excludingResourceId),
              )
            : and(
                eq(resources.organizationId, organizationId),
                eq(resources.sku, identifiers.sku),
              ),
        )
        .limit(1)
        .then((rows) => {
          if (rows[0]) throw new ResourceIdentifierConflictError("sku");
        }),
    );
  }
  if (identifiers.barcode) {
    checks.push(
      db
        .select({ id: resources.id })
        .from(resources)
        .where(
          excludingResourceId
            ? and(
                eq(resources.organizationId, organizationId),
                eq(resources.barcode, identifiers.barcode),
                ne(resources.id, excludingResourceId),
              )
            : and(
                eq(resources.organizationId, organizationId),
                eq(resources.barcode, identifiers.barcode),
              ),
        )
        .limit(1)
        .then((rows) => {
          if (rows[0]) throw new ResourceIdentifierConflictError("barcode");
        }),
    );
  }
  await Promise.all(checks);
}
