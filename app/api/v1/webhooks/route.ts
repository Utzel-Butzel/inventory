import {
  webhookEndpointCreateSchema,
} from "@/lib/webhook-contract";
import { requireSessionPermission } from "@/lib/api-auth";
import {
  createWebhookEndpoint,
  listWebhookEndpoints,
  WebhookConfigurationError,
} from "@/lib/webhooks";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  return Response.json(
    { webhooks: await listWebhookEndpoints() },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = webhookEndpointCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid webhook settings.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    return Response.json(
      await createWebhookEndpoint(parsed.data, authorization.identity.subject),
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof WebhookConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Unable to create webhook.";
    if (message.startsWith("Webhook target")) {
      return Response.json({ error: message }, { status: 422 });
    }
    throw error;
  }
}
