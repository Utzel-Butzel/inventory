import { readFile } from "node:fs/promises";
import { requireSessionPermission } from "@/lib/api-auth";
import { isAllowedQzRequest, QZ_MAX_REQUEST_BYTES } from "@/lib/qz-signing-policy";
import { signQzRequest } from "@/lib/qz-signature";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "labels.read");
  if (authorization.response) return authorization.response;
  if (!process.env.QZ_CERTIFICATE_PATH || !process.env.QZ_PRIVATE_KEY_PATH) {
    return new Response("QZ signing is not configured.", { status: 503 });
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response("Cross-site signing is not allowed.", { status: 403 });
  }
  if (Number(request.headers.get("content-length")) > QZ_MAX_REQUEST_BYTES + 10_000) {
    return new Response("Request too large.", { status: 413 });
  }
  let payload: { request?: unknown };
  try {
    payload = await request.json();
  } catch {
    return new Response("Invalid request.", { status: 400 });
  }
  if (!payload || typeof payload.request !== "string" || !isAllowedQzRequest(payload.request)) {
    return new Response("Only PT-P710BT label printing is allowed.", { status: 403 });
  }
  try {
    const key = await readFile(process.env.QZ_PRIVATE_KEY_PATH, "utf8");
    return new Response(signQzRequest(payload.request, key), {
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Unable to sign print request.", { status: 500 });
  }
}
