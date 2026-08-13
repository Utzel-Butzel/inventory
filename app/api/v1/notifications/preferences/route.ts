import { notificationPreferencePatchSchema } from "@/lib/notification-contract";
import { requireNotificationRecipient, notificationNoStoreHeaders } from "@/lib/notification-api";
import { getNotificationSettings, updateNotificationPreferences } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireNotificationRecipient(request);
  if (authorization.response) return authorization.response;
  const settings = await getNotificationSettings(authorization.recipient);
  return Response.json(settings, { headers: notificationNoStoreHeaders });
}

export async function PATCH(request: Request) {
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
  const parsed = notificationPreferencePatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid notification preferences.", details: parsed.error.flatten() },
      { status: 422, headers: notificationNoStoreHeaders },
    );
  }
  const preference = await updateNotificationPreferences(
    authorization.recipient,
    parsed.data,
  );
  return Response.json(
    { preference },
    { headers: notificationNoStoreHeaders },
  );
}
