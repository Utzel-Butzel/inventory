import { z } from "zod";

import { requireSessionPermission } from "@/lib/api-auth";
import { webhookEndpointPatchSchema } from "@/lib/webhook-contract";
import {
  getWebhookEndpoint,
  revokeWebhookEndpoint,
  updateWebhookEndpoint,
  WebhookConfigurationError,
} from "@/lib/webhooks";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
const noStoreHeaders = { "Cache-Control": "no-store" };

async function validId(context: Context) {
  const { id } = await context.params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

export async function GET(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  const id = await validId(context);
  if (!id) return Response.json({ error: "Invalid webhook id." }, { status: 422 });
  const webhook = await getWebhookEndpoint(id);
  if (!webhook) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ webhook }, { headers: noStoreHeaders });
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  const id = await validId(context);
  if (!id) return Response.json({ error: "Invalid webhook id." }, { status: 422 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = webhookEndpointPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid webhook settings.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  try {
    const webhook = await updateWebhookEndpoint(
      id,
      parsed.data,
      authorization.identity.subject,
    );
    if (!webhook) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ webhook }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof WebhookConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Unable to update webhook.";
    if (message.startsWith("Webhook target")) {
      return Response.json({ error: message }, { status: 422 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "webhooks.manage");
  if (authorization.response) return authorization.response;
  const id = await validId(context);
  if (!id) return Response.json({ error: "Invalid webhook id." }, { status: 422 });
  if (!(await revokeWebhookEndpoint(id, authorization.identity.subject))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
