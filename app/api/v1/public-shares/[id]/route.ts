import { requireSessionPermission } from "@/lib/api-auth";
import { revokePublicShare } from "@/lib/public-shares";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "sharing.manage");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!(await revokePublicShare(id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
