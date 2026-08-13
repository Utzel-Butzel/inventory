import { requireNotificationRecipient, notificationNoStoreHeaders } from "@/lib/notification-api";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST(request: Request) {
  const authorization = await requireNotificationRecipient(request);
  if (authorization.response) return authorization.response;
  const updated = await markAllNotificationsRead(authorization.recipient);
  return Response.json({ updated }, { headers: notificationNoStoreHeaders });
}
