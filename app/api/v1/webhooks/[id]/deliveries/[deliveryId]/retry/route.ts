import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import { retryWebhookDelivery } from "@/lib/webhooks";

type Context = { params: Promise<{ id: string; deliveryId: string }> };

export async function POST(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  const { id, deliveryId } = await context.params;
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(deliveryId).success
  ) {
    return Response.json({ error: "Invalid webhook or delivery id." }, { status: 422 });
  }
  const delivery = await retryWebhookDelivery(
    authorization.identity.organizationId,
    id,
    deliveryId,
  );
  if (!delivery) {
    return Response.json(
      { error: "Failed delivery not found." },
      { status: 404 },
    );
  }
  return Response.json({ delivery }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
