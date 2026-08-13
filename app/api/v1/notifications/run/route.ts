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
  if (!cronAuthorized(request)) {
    const authorization = await requireSessionPermission(request, "tokens.manage");
    if (authorization.response) return authorization.response;
  }
  const result = await runNotificationCycle();
  return Response.json(result, { headers: notificationNoStoreHeaders });
}
