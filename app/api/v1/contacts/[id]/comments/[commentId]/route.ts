import { z } from "zod";

import { hashRequestIdentity, requirePermission } from "@/lib/api-auth";
import {
  contactCommentUpdateSchema,
  type ContactCommentDto,
} from "@/lib/contact-comment-contract";
import {
  ContactCommentPermissionError,
  deleteContactComment,
  updateContactComment,
} from "@/lib/contact-comments";

type Context = { params: Promise<{ id: string; commentId: string }> };

const paramsSchema = z.object({
  id: z.string().uuid(),
  commentId: z.string().uuid(),
});

async function authorize(request: Request, context: Context) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return {
      response: Response.json(
        { error: "Invalid comment request." },
        { status: 422 },
      ),
    } as const;
  }
  const authorization = await requirePermission(request, "contacts.manage");
  if (authorization.response) return authorization;
  return { ...authorization, params: parsedParams.data } as const;
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await authorize(request, context);
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = contactCommentUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid comment.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const comment = await updateContactComment({
      organizationId: authorization.identity.organizationId,
      contactId: authorization.params.id,
      commentId: authorization.params.commentId,
      body: parsed.data.body,
      identityHash: hashRequestIdentity(authorization.identity),
      canModerate: authorization.identity.permissions.includes("users.manage"),
      actor: authorization.identity.subject,
    });
    if (!comment) {
      return Response.json({ error: "Comment not found." }, { status: 404 });
    }
    const dto: ContactCommentDto = {
      id: comment.id,
      contactId: comment.contactId,
      body: comment.body,
      authorName: comment.authorName,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      canEdit: true,
    };
    return Response.json({ comment: dto });
  } catch (error) {
    if (error instanceof ContactCommentPermissionError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await authorize(request, context);
  if (authorization.response) return authorization.response;

  try {
    const deleted = await deleteContactComment({
      organizationId: authorization.identity.organizationId,
      contactId: authorization.params.id,
      commentId: authorization.params.commentId,
      identityHash: hashRequestIdentity(authorization.identity),
      canModerate: authorization.identity.permissions.includes("users.manage"),
    });
    if (!deleted) {
      return Response.json({ error: "Comment not found." }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ContactCommentPermissionError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
