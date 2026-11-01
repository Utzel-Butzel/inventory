import { requirePermission, requireResourcePermission } from "@/lib/api-auth";
import { labelShortcodeRequestSchema } from "@/lib/label-shortcode-contract";
import { ensureLabelShortcode } from "@/lib/label-shortcodes";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.AUTH_URL || request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const authorization = await requirePermission(request, "labels.read");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return Response.json({ error: "Expected a JSON request body." }, { status: 400 }); }
  const parsed = labelShortcodeRequestSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "Invalid label target." }, { status: 422 });
  const access = await requireResourcePermission(request, "inventory.read", parsed.data.resourceId);
  if (access.response) return access.response;
  if (parsed.data.stockUnitId) {
    const stockAccess = await requireResourcePermission(request, "stock.read", access.resource);
    if (stockAccess.response) return stockAccess.response;
  }
  try {
    const code = await ensureLabelShortcode(authorization.identity.organizationId, parsed.data.resourceId, parsed.data.stockUnitId ?? null);
    if (!code) return Response.json({ error: "Label target not found." }, { status: 404 });
    return Response.json({ code }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Unable to prepare the label shortcode." }, { status: 500 });
  }
}
