import { z } from "zod";

import {
  hashRequestIdentity,
  requireResourcePermission,
} from "@/lib/api-auth";
import {
  resourceCommentUpdateSchema,
  type ResourceCommentDto,
} from "@/lib/resource-comment-contract";
import {
  deleteResourceComment,
  ResourceCommentPermissionError,
  updateResourceComment,
} from "@/lib/resource-comments";

type Context = { params: Promise<{ id: string; commentId: string }> };

const paramsSchema = z.object({
  id: z.string().uuid(),
  commentId: z.string().uuid(),
});

const authorize = async (request: Request, context: Context) => {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return {
      response: Response.json(
        { error: "Invalid comment request." },
        { status: 422 },
      ),
    } as const;
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    parsedParams.data.id,
  );
  if (authorization.response) return authorization;
  return { ...authorization, params: parsedParams.data } as const;
};

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
  const parsed = resourceCommentUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid comment.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const comment = await updateResourceComment({
      organizationId: authorization.identity.organizationId,
      resourceId: authorization.params.id,
      commentId: authorization.params.commentId,
      body: parsed.data.body,
      identityHash: hashRequestIdentity(authorization.identity),
      canModerate: authorization.identity.permissions.includes("users.manage"),
      actor: authorization.identity.subject,
    });
    if (!comment) {
      return Response.json({ error: "Comment not found." }, { status: 404 });
    }
    const dto: ResourceCommentDto = {
      id: comment.id,
      resourceId: comment.resourceId,
      body: comment.body,
      authorName: comment.authorName,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      canEdit: true,
    };
    return Response.json({ comment: dto });
  } catch (error) {
    if (error instanceof ResourceCommentPermissionError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await authorize(request, context);
  if (authorization.response) return authorization.response;

  try {
    const deleted = await deleteResourceComment({
      organizationId: authorization.identity.organizationId,
      resourceId: authorization.params.id,
      commentId: authorization.params.commentId,
      identityHash: hashRequestIdentity(authorization.identity),
      canModerate: authorization.identity.permissions.includes("users.manage"),
    });
    if (!deleted) {
      return Response.json({ error: "Comment not found." }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ResourceCommentPermissionError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
