import { getRequestIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    name: identity.name,
    scopes: identity.scopes,
  });
}
