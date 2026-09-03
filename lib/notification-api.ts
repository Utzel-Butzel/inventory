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
  if (!identity.userId) {
    return {
      identity: null,
      recipient: null,
      response: Response.json(
        { error: "Notifications require a signed-in user." },
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

export async function requireWritableNotificationRecipient(request: Request) {
  const authorization = await requireNotificationRecipient(request);
  if (authorization.response) return authorization;
  if (authorization.identity.organization.isReadOnly) {
    return {
      identity: null,
      recipient: null,
      response: Response.json(
        { error: "This organization is read-only." },
        { status: 403, headers: notificationNoStoreHeaders },
      ),
    } as const;
  }
  return authorization;
}
