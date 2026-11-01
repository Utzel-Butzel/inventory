import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { resourceIdFromShortCode, resourcePathFromShortLink } from "@/lib/resource-short-link";
import { getLabelExternalDestination } from "@/lib/label-redirect";

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

  const external = await getLabelExternalDestination(resourceIdFromShortCode(code)!,
    unitCode === null ? null : resourceIdFromShortCode(unitCode), request.url);
  if (external) return new Response(null, { status: 307, headers: {
    Location: external, "Cache-Control": "private, no-store", Vary: "Cookie",
  } });

  const sourcePath = new URL(request.url).searchParams.get("src") === "qr"
    ? `${path}${path.includes("?") ? "&" : "?"}src=qr` : path;
  const identity = await getSessionIdentity();
  const destination = identity
    ? organizationPath(identity.organization.slug, sourcePath)
    : sourcePath;
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
