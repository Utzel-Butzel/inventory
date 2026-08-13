import "server-only";

import { getRequestIdentity } from "@/lib/api-auth";
import { notificationRecipient } from "@/lib/notifications";

export const notificationNoStoreHeaders = {
  "Cache-Control": "private, no-store",
};

export async function requireNotificationRecipient(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return {
      identity: null,
      recipient: null,
      response: Response.json(
        { error: "Unauthorized" },
        { status: 401, headers: notificationNoStoreHeaders },
      ),
    } as const;
  }
  if (identity.kind !== "session") {
    return {
      identity: null,
      recipient: null,
      response: Response.json(
        { error: "Notifications require an authenticated browser session." },
        { status: 403, headers: notificationNoStoreHeaders },
      ),
    } as const;
  }
  const email = identity.subject.includes("@")
    ? identity.subject
    : null;
  return {
    identity,
    response: null,
    recipient: {
      organizationId: identity.organizationId,
      key: notificationRecipient(identity.subject, email),
      email,
      name: identity.name,
      locale:
        request.headers.get("x-inventory-ui-language") === "de" ? "de" : "en",
    },
  } as const;
}
