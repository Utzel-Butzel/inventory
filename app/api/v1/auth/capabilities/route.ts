import { getRequestIdentity, hashRequestIdentity } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    name: identity.name,
    principal: hashRequestIdentity(identity),
    scopes: identity.scopes,
    role: identity.role,
    roleName: identity.roleName,
    permissions: identity.permissions,
    organization: identity.organization,
    organizations: identity.organizations,
  });
}
