import { z } from "zod";

import { requireWritableNotificationRecipient, notificationNoStoreHeaders } from "@/lib/notification-api";
import { markNotificationRead } from "@/lib/notifications";

const idSchema = z.uuid();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await requireWritableNotificationRecipient(request);
  if (authorization.response) return authorization.response;
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid notification ID." },
      { status: 422, headers: notificationNoStoreHeaders },
    );
  }
  const notification = await markNotificationRead(
    authorization.recipient,
    parsed.data,
  );
  if (!notification) {
    return Response.json(
      { error: "Notification not found." },
      { status: 404, headers: notificationNoStoreHeaders },
    );
  }
  return Response.json({ notification }, { headers: notificationNoStoreHeaders });
}
