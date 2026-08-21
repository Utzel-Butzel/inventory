import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { resourceComments, type ResourceCommentRecord } from "@/db/schema";
import { db } from "@/lib/db";

export class ResourceCommentPermissionError extends Error {
  constructor() {
    super("You do not have permission to change this comment.");
    this.name = "ResourceCommentPermissionError";
  }
}

export async function listResourceComments(
  organizationId: string,
  resourceId: string,
) {
  return db
    .select()
    .from(resourceComments)
    .where(
      and(
        eq(resourceComments.organizationId, organizationId),
        eq(resourceComments.resourceId, resourceId),
      ),
    )
    .orderBy(asc(resourceComments.createdAt), asc(resourceComments.id));
}

export async function createResourceComment(options: {
  organizationId: string;
  resourceId: string;
  body: string;
  authorName: string;
  authorIdentityHash: string;
  actor: string;
}) {
  const [comment] = await db
    .insert(resourceComments)
    .values({
      organizationId: options.organizationId,
      resourceId: options.resourceId,
      body: options.body,
      authorName: options.authorName,
      authorIdentityHash: options.authorIdentityHash,
      createdBy: options.actor,
      updatedBy: options.actor,
    })
    .returning();
  return comment!;
}

const getResourceComment = async (
  organizationId: string,
  resourceId: string,
  commentId: string,
) => {
  const [comment] = await db
    .select()
    .from(resourceComments)
    .where(
      and(
        eq(resourceComments.organizationId, organizationId),
        eq(resourceComments.resourceId, resourceId),
        eq(resourceComments.id, commentId),
      ),
    )
    .limit(1);
  return comment ?? null;
};

const assertCanChangeComment = (
  comment: ResourceCommentRecord,
  identityHash: string,
  canModerate: boolean,
) => {
  if (comment.authorIdentityHash !== identityHash && !canModerate) {
    throw new ResourceCommentPermissionError();
  }
};

export async function updateResourceComment(options: {
  organizationId: string;
  resourceId: string;
  commentId: string;
  body: string;
  identityHash: string;
  canModerate: boolean;
  actor: string;
}) {
  const current = await getResourceComment(
    options.organizationId,
    options.resourceId,
    options.commentId,
  );
  if (!current) return null;
  assertCanChangeComment(current, options.identityHash, options.canModerate);

  const [comment] = await db
    .update(resourceComments)
    .set({
      body: options.body,
      updatedBy: options.actor,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(resourceComments.organizationId, options.organizationId),
        eq(resourceComments.resourceId, options.resourceId),
        eq(resourceComments.id, options.commentId),
      ),
    )
    .returning();
  return comment ?? null;
}

export async function deleteResourceComment(options: {
  organizationId: string;
  resourceId: string;
  commentId: string;
  identityHash: string;
  canModerate: boolean;
}) {
  const current = await getResourceComment(
    options.organizationId,
    options.resourceId,
    options.commentId,
  );
  if (!current) return false;
  assertCanChangeComment(current, options.identityHash, options.canModerate);

  const deleted = await db
    .delete(resourceComments)
    .where(
      and(
        eq(resourceComments.organizationId, options.organizationId),
        eq(resourceComments.resourceId, options.resourceId),
        eq(resourceComments.id, options.commentId),
      ),
    )
    .returning({ id: resourceComments.id });
  return deleted.length > 0;
}
