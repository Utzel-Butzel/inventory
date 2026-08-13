import { pushSubscriptionDeleteSchema, pushSubscriptionSchema } from "@/lib/notification-contract";
import { requireNotificationRecipient, notificationNoStoreHeaders } from "@/lib/notification-api";
import { notificationRuntimeConfiguration, revokePushSubscription, savePushSubscription } from "@/lib/notifications";

export async function POST(request: Request) {
  const authorization = await requireNotificationRecipient(request);
  if (authorization.response) return authorization.response;
  if (!notificationRuntimeConfiguration().push.configured) {
    return Response.json(
      { error: "Web Push is not configured for this deployment." },
      { status: 503, headers: notificationNoStoreHeaders },
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: notificationNoStoreHeaders },
    );
  }
  const parsed = pushSubscriptionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid Web Push subscription." },
      { status: 422, headers: notificationNoStoreHeaders },
    );
  }
  const subscription = await savePushSubscription(
    authorization.recipient,
    parsed.data,
  );
  return Response.json(
    { subscription },
    { status: 201, headers: notificationNoStoreHeaders },
  );
}

export async function DELETE(request: Request) {
  const authorization = await requireNotificationRecipient(request);
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: notificationNoStoreHeaders },
    );
  }
  const parsed = pushSubscriptionDeleteSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "A valid subscription endpoint is required." },
      { status: 422, headers: notificationNoStoreHeaders },
    );
  }
  const revoked = await revokePushSubscription(
    authorization.recipient.key,
    parsed.data.endpoint,
  );
  return Response.json({ revoked }, { headers: notificationNoStoreHeaders });
}
