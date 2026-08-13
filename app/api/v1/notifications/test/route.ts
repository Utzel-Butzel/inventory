import { notificationTestSchema } from "@/lib/notification-contract";
import { requireNotificationRecipient, notificationNoStoreHeaders } from "@/lib/notification-api";
import { getNotificationSettings, previewNotificationChannel } from "@/lib/notifications";

// Deliberately a preview-only endpoint. It never invokes a delivery adapter.
export async function POST(request: Request) {
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
  const parsed = notificationTestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid notification channel." },
      { status: 422, headers: notificationNoStoreHeaders },
    );
  }
  const { preference } = await getNotificationSettings(authorization.recipient);
  const result = previewNotificationChannel(
    parsed.data.channel,
    preference.locale,
    preference.recipientEmail,
  );
  return Response.json(result, { headers: notificationNoStoreHeaders });
}
