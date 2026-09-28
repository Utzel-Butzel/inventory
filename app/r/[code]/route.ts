import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { resourcePathFromShortLink } from "@/lib/resource-short-link";

type Context = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: Context) {
  const { code } = await context.params;
  const unitCode = new URL(request.url).searchParams.get("unit");
  const path = resourcePathFromShortLink(code, unitCode);
  if (!path) {
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
    ? organizationPath(identity.organization.slug, path)
    : path;
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
