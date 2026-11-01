import { getSessionIdentity } from "@/lib/api-auth";
import { labelQrDestination } from "@/lib/label-shortcode-contract";
import { resolveLabelShortcode } from "@/lib/label-shortcodes";
import { organizationPath } from "@/lib/organization-path";
import { getLabelExternalDestination } from "@/lib/label-redirect";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const target = await resolveLabelShortcode(code);
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  if (!target) return Response.json({ error: "Inventory link not found." }, { status: 404, headers });
  const external = await getLabelExternalDestination(target.resourceId, target.stockUnitId, request.url);
  if (external) return new Response(null, { status: 307, headers: { ...headers, Location: external } });
  const destination = organizationPath(target.organizationSlug, labelQrDestination(target.resourceId, target.stockUnitId));
  const identity = await getSessionIdentity();
  // Destination pages enforce membership and resource permissions in the target organization.
  return new Response(null, { status: 307, headers: { ...headers,
    Location: identity ? destination : `/login?callbackUrl=${encodeURIComponent(destination)}`,
  } });
}
