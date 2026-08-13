import { z } from "zod";

import { requirePermission, requireSessionPermission } from "@/lib/api-auth";
import {
  archiveCustomFieldDefinition,
  customFieldHttpError,
  getCustomFieldDefinition,
  updateCustomFieldDefinition,
} from "@/lib/custom-fields";
import { customFieldDefinitionPatchSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const readId = async (context: Context) => {
  const parsed = z.string().uuid().safeParse((await context.params).id);
  return parsed.success ? parsed.data : null;
};

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "inventory.read");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) return Response.json({ error: "Invalid definition id." }, { status: 422 });

  const definition = await getCustomFieldDefinition(
    authorization.identity.organizationId,
    id,
  );
  if (!definition) {
    return Response.json({ error: "Custom field definition not found." }, { status: 404 });
  }
  return Response.json({ definition });
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "settings.custom-fields.manage");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) return Response.json({ error: "Invalid definition id." }, { status: 422 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = customFieldDefinitionPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid custom field update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const definition = await updateCustomFieldDefinition(
      authorization.identity.organizationId,
      id,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ definition });
  } catch (error) {
    const failure = customFieldHttpError(
      error,
      "Unable to update the custom field definition.",
    );
    return Response.json(
      {
        error: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      },
      { status: failure.status },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "settings.custom-fields.manage");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) return Response.json({ error: "Invalid definition id." }, { status: 422 });

  try {
    await archiveCustomFieldDefinition(
      authorization.identity.organizationId,
      id,
      authorization.identity.subject,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    const failure = customFieldHttpError(
      error,
      "Unable to archive the custom field definition.",
    );
    return Response.json(
      {
        error: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      },
      { status: failure.status },
    );
  }
}
