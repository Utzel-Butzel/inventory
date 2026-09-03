import { z } from "zod";

import {
  hashRequestIdentity,
  requirePermission,
} from "@/lib/api-auth";
import {
  contactCommentCreateSchema,
  type ContactCommentDto,
} from "@/lib/contact-comment-contract";
import {
  createContactComment,
  listContactComments,
} from "@/lib/contact-comments";
import { getContact } from "@/lib/contacts";

type Context = { params: Promise<{ id: string }> };

const contactIdSchema = z.string().uuid();

const toDto = (
  comment: Awaited<ReturnType<typeof listContactComments>>[number],
  canEdit: boolean,
): ContactCommentDto => ({
  id: comment.id,
  contactId: comment.contactId,
  body: comment.body,
  authorName: comment.authorName,
  createdAt: comment.createdAt.toISOString(),
  updatedAt: comment.updatedAt.toISOString(),
  canEdit,
});

export async function GET(request: Request, context: Context) {
  const id = contactIdSchema.safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid contact id." }, { status: 422 });
  }
  const authorization = await requirePermission(request, "contacts.read");
  if (authorization.response) return authorization.response;

  const contact = await getContact(
    authorization.identity.organizationId,
    id.data,
  );
  if (!contact) return Response.json({ error: "Contact not found." }, { status: 404 });

  const comments = await listContactComments(
    authorization.identity.organizationId,
    id.data,
  );
  const canChangeComments =
    authorization.identity.scopes.includes("write") &&
    authorization.identity.permissions.includes("contacts.manage");
  const identityHash = hashRequestIdentity(authorization.identity);
  const canModerate = authorization.identity.permissions.includes("users.manage");

  return Response.json({
    comments: comments.map((comment) =>
      toDto(
        comment,
        canChangeComments &&
          (canModerate || comment.authorIdentityHash === identityHash),
      ),
    ),
  });
}

export async function POST(request: Request, context: Context) {
  const id = contactIdSchema.safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid contact id." }, { status: 422 });
  }
  const authorization = await requirePermission(request, "contacts.manage");
  if (authorization.response) return authorization.response;

  const contact = await getContact(
    authorization.identity.organizationId,
    id.data,
  );
  if (!contact) return Response.json({ error: "Contact not found." }, { status: 404 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = contactCommentCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid comment.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const comment = await createContactComment({
    organizationId: authorization.identity.organizationId,
    contactId: id.data,
    body: parsed.data.body,
    authorName:
      authorization.identity.name.trim().slice(0, 160) ||
      authorization.identity.subject.trim().slice(0, 160),
    authorIdentityHash: hashRequestIdentity(authorization.identity),
    actor: authorization.identity.subject,
  });
  return Response.json({ comment: toDto(comment, true) }, { status: 201 });
}
