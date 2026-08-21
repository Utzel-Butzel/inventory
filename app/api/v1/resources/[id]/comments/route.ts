import { z } from "zod";

import {
  canAccessResource,
  hashRequestIdentity,
  requireResourcePermission,
} from "@/lib/api-auth";
import {
  resourceCommentCreateSchema,
  type ResourceCommentDto,
} from "@/lib/resource-comment-contract";
import {
  createResourceComment,
  listResourceComments,
} from "@/lib/resource-comments";

type Context = { params: Promise<{ id: string }> };

const resourceIdSchema = z.string().uuid();

const toDto = (
  comment: Awaited<ReturnType<typeof listResourceComments>>[number],
  canEdit: boolean,
): ResourceCommentDto => ({
  id: comment.id,
  resourceId: comment.resourceId,
  body: comment.body,
  authorName: comment.authorName,
  createdAt: comment.createdAt.toISOString(),
  updatedAt: comment.updatedAt.toISOString(),
  canEdit,
});

export async function GET(request: Request, context: Context) {
  const id = resourceIdSchema.safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.read",
    id.data,
  );
  if (authorization.response) return authorization.response;

  const [comments, hasUpdateAccess] = await Promise.all([
    listResourceComments(authorization.identity.organizationId, id.data),
    canAccessResource(
      authorization.identity,
      "inventory.update",
      authorization.resource,
    ),
  ]);
  const canChangeComments =
    authorization.identity.scopes.includes("write") && hasUpdateAccess;
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
  const id = resourceIdSchema.safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid resource id." }, { status: 422 });
  }
  const authorization = await requireResourcePermission(
    request,
    "inventory.update",
    id.data,
  );
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
  const parsed = resourceCommentCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid comment.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const comment = await createResourceComment({
    organizationId: authorization.identity.organizationId,
    resourceId: id.data,
    body: parsed.data.body,
    authorName:
      authorization.identity.name.trim().slice(0, 160) ||
      authorization.identity.subject.trim().slice(0, 160),
    authorIdentityHash: hashRequestIdentity(authorization.identity),
    actor: authorization.identity.subject,
  });
  return Response.json({ comment: toDto(comment, true) }, { status: 201 });
}
