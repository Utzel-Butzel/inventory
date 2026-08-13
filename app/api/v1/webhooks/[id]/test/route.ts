import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import {
  enqueueWebhookTest,
  WebhookConfigurationError,
} from "@/lib/webhooks";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid webhook id." }, { status: 422 });
  }
  try {
    const result = await enqueueWebhookTest(id, authorization.identity.subject);
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(result, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof WebhookConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
