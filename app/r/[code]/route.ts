import { getSessionIdentity } from "@/lib/api-auth";
import { resourceIdFromShortCode } from "@/lib/resource-short-link";

type Context = { params: Promise<{ code: string }> };

export async function GET(request: Request, context: Context) {
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

  const destination = `/inventory/${resourceId}`;
  const identity = await getSessionIdentity();
  const redirectUrl = identity
    ? new URL(destination, request.url)
    : new URL(`/login?callbackUrl=${encodeURIComponent(destination)}`, request.url);
  return new Response(null, {
    status: 307,
    headers: {
      Location: redirectUrl.toString(),
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}
