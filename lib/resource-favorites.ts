import "server-only";

import { and, eq } from "drizzle-orm";

import { resourceFavorites } from "@/db/schema";
import { db } from "@/lib/db";

type ResourceFavoriteKey = {
  organizationId: string;
  userId: string;
  resourceId: string;
};

export async function isResourceFavorite(key: ResourceFavoriteKey) {
  const [favorite] = await db
    .select({ resourceId: resourceFavorites.resourceId })
    .from(resourceFavorites)
    .where(
      and(
        eq(resourceFavorites.organizationId, key.organizationId),
        eq(resourceFavorites.userId, key.userId),
        eq(resourceFavorites.resourceId, key.resourceId),
      ),
    )
    .limit(1);
  return Boolean(favorite);
}

export async function setResourceFavorite(
  key: ResourceFavoriteKey,
  favorite: boolean,
) {
  if (favorite) {
    await db
      .insert(resourceFavorites)
      .values(key)
      .onConflictDoNothing();
  } else {
    await db
      .delete(resourceFavorites)
      .where(
        and(
          eq(resourceFavorites.organizationId, key.organizationId),
          eq(resourceFavorites.userId, key.userId),
          eq(resourceFavorites.resourceId, key.resourceId),
        ),
      );
  }

  return { favorite };
}
