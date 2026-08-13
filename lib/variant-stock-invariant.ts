/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, sql } from "drizzle-orm";

import { resourceVariants } from "@/db/schema";

/**
 * Read the amount of parent stock currently allocated to variants. Callers
 * must lock the parent resource row before invoking this helper; that shared
 * lock order serializes all parent and variant quantity changes.
 */
export async function allocatedVariantQuantity(
  executor: any,
  resourceId: string,
) {
  const [{ allocated }] = await executor
    .select({
      allocated: sql<number>`coalesce(sum(${resourceVariants.quantity}), 0)::int`,
    })
    .from(resourceVariants)
    .where(eq(resourceVariants.resourceId, resourceId));
  return Number(allocated ?? 0);
}

export function assertVariantAllocationFits(
  parentQuantity: number,
  allocatedQuantity: number,
  errorFactory: (message: string) => Error,
) {
  if (parentQuantity < allocatedQuantity) {
    throw errorFactory(
      `This operation would reduce item stock below the ${allocatedQuantity} units allocated to variants. Book the change against a variant first.`,
    );
  }
}
