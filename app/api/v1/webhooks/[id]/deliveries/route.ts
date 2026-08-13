import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import { listWebhookDeliveries } from "@/lib/webhooks";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid webhook id." }, { status: 422 });
  }
  const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    return Response.json({ error: "Invalid delivery limit." }, { status: 422 });
  }
  const deliveries = await listWebhookDeliveries(
    authorization.identity.organizationId,
    id,
    requestedLimit,
  );
  if (!deliveries) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ deliveries }, { headers: { "Cache-Control": "no-store" } });
}
