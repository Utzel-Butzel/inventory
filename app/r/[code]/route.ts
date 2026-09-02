import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { resourceIdFromShortCode } from "@/lib/resource-short-link";

type Context = { params: Promise<{ code: string }> };

export async function GET(_request: Request, context: Context) {
  const { code } = await context.params;
  const resourceId = resourceIdFromShortCode(code);
  if (!resourceId) {
    return Response.json(
      { error: "Invalid inventory link." },
      {
        status: 404,
        headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
      },
    );
  }

  const identity = await getSessionIdentity();
  const destination = identity
    ? organizationPath(identity.organization.slug, `/inventory/${resourceId}`)
    : `/inventory/${resourceId}`;
  const redirectLocation = identity
    ? destination
    : `/login?callbackUrl=${encodeURIComponent(destination)}`;
  return new Response(null, {
    status: 307,
    headers: {
      Location: redirectLocation,
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}
