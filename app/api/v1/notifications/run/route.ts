import { timingSafeEqual } from "node:crypto";

import { requireSessionPermission } from "@/lib/api-auth";
import { notificationNoStoreHeaders } from "@/lib/notification-api";
import { runNotificationCycle } from "@/lib/notifications";

function cronAuthorized(request: Request) {
  const configured = process.env.NOTIFICATION_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  let organizationId: string | undefined;
  if (!cronAuthorized(request)) {
    const authorization = await requireSessionPermission(request, "tokens.manage");
    if (authorization.response) return authorization.response;
    organizationId = authorization.identity.organizationId;
  }
  // Deployment cron credentials operate the global worker. A tenant admin can
  // only run and observe their active organization's notification cycle.
  const result = await runNotificationCycle(new Date(), organizationId);
  return Response.json(result, { headers: notificationNoStoreHeaders });
}
