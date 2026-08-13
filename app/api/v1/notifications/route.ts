import { requireNotificationRecipient, notificationNoStoreHeaders } from "@/lib/notification-api";
import { listInbox } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireNotificationRecipient(request);
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const parsedLimit = Number(url.searchParams.get("limit") ?? "30");
  const result = await listInbox(authorization.recipient, {
    limit: Number.isSafeInteger(parsedLimit) ? parsedLimit : 30,
    unreadOnly: url.searchParams.get("unreadOnly") === "true",
  });
  return Response.json(result, { headers: notificationNoStoreHeaders });
}
