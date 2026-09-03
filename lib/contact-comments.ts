import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { contactComments, type ContactCommentRecord } from "@/db/schema";
import { db } from "@/lib/db";

export class ContactCommentPermissionError extends Error {
  constructor() {
    super("You do not have permission to change this comment.");
    this.name = "ContactCommentPermissionError";
  }
}

export async function listContactComments(
  organizationId: string,
  contactId: string,
) {
  return db
    .select()
    .from(contactComments)
    .where(
      and(
        eq(contactComments.organizationId, organizationId),
        eq(contactComments.contactId, contactId),
      ),
    )
    .orderBy(asc(contactComments.createdAt), asc(contactComments.id));
}

export async function createContactComment(options: {
  organizationId: string;
  contactId: string;
  body: string;
  authorName: string;
  authorIdentityHash: string;
  actor: string;
}) {
  const [comment] = await db
    .insert(contactComments)
    .values({
      organizationId: options.organizationId,
      contactId: options.contactId,
      body: options.body,
      authorName: options.authorName,
      authorIdentityHash: options.authorIdentityHash,
      createdBy: options.actor,
      updatedBy: options.actor,
    })
    .returning();
  return comment!;
}

async function getContactComment(
  organizationId: string,
  contactId: string,
  commentId: string,
) {
  const [comment] = await db
    .select()
    .from(contactComments)
    .where(
      and(
        eq(contactComments.organizationId, organizationId),
        eq(contactComments.contactId, contactId),
        eq(contactComments.id, commentId),
      ),
    )
    .limit(1);
  return comment ?? null;
}

function assertCanChangeComment(
  comment: ContactCommentRecord,
  identityHash: string,
  canModerate: boolean,
) {
  if (comment.authorIdentityHash !== identityHash && !canModerate) {
    throw new ContactCommentPermissionError();
  }
}

export async function updateContactComment(options: {
  organizationId: string;
  contactId: string;
  commentId: string;
  body: string;
  identityHash: string;
  canModerate: boolean;
  actor: string;
}) {
  const current = await getContactComment(
    options.organizationId,
    options.contactId,
    options.commentId,
  );
  if (!current) return null;
  assertCanChangeComment(current, options.identityHash, options.canModerate);

  const [comment] = await db
    .update(contactComments)
    .set({ body: options.body, updatedBy: options.actor, updatedAt: new Date() })
    .where(
      and(
        eq(contactComments.organizationId, options.organizationId),
        eq(contactComments.contactId, options.contactId),
        eq(contactComments.id, options.commentId),
      ),
    )
    .returning();
  return comment ?? null;
}

export async function deleteContactComment(options: {
  organizationId: string;
  contactId: string;
  commentId: string;
  identityHash: string;
  canModerate: boolean;
}) {
  const current = await getContactComment(
    options.organizationId,
    options.contactId,
    options.commentId,
  );
  if (!current) return false;
  assertCanChangeComment(current, options.identityHash, options.canModerate);

  const deleted = await db
    .delete(contactComments)
    .where(
      and(
        eq(contactComments.organizationId, options.organizationId),
        eq(contactComments.contactId, options.contactId),
        eq(contactComments.id, options.commentId),
      ),
    )
    .returning({ id: contactComments.id });
  return deleted.length > 0;
}
