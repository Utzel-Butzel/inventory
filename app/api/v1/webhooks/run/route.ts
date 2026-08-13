import { timingSafeEqual } from "node:crypto";

import { drainWebhookDeliveries } from "@/lib/webhooks";

function authorized(request: Request) {
  const expected = process.env.WEBHOOK_CRON_SECRET?.trim();
  const header = request.headers.get("authorization");
  const supplied = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const value = Number(new URL(request.url).searchParams.get("limit") ?? "20");
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    return Response.json({ error: "Limit must be between 1 and 100." }, { status: 422 });
  }
  return Response.json(await drainWebhookDeliveries(value), {
    headers: { "Cache-Control": "no-store" },
  });
}
