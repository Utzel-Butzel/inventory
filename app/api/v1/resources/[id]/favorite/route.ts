import {
  requireResourceReferencePermission,
} from "@/lib/api-auth";
import { setResourceFavorite } from "@/lib/resource-favorites";

type Context = { params: Promise<{ id: string }> };

async function updateFavorite(
  request: Request,
  context: Context,
  favorite: boolean,
) {
  const { id: reference } = await context.params;
  const authorization = await requireResourceReferencePermission(
    request,
    "inventory.read",
    reference,
  );
  if (authorization.response) return authorization.response;
  if (!authorization.identity.userId) {
    return Response.json(
      { error: "Favorites require a signed-in user." },
      { status: 403 },
    );
  }

  const result = await setResourceFavorite(
    {
      organizationId: authorization.identity.organizationId,
      userId: authorization.identity.userId,
      resourceId: authorization.resource.id,
    },
    favorite,
  );
  return Response.json(result);
}

export async function PUT(request: Request, context: Context) {
  return updateFavorite(request, context, true);
}

export async function DELETE(request: Request, context: Context) {
  return updateFavorite(request, context, false);
}
