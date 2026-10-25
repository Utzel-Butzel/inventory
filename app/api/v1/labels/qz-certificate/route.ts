import { readFile } from "node:fs/promises";
import { requireSessionPermission } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "labels.read");
  if (authorization.response) return authorization.response;
  if (!process.env.QZ_CERTIFICATE_PATH || !process.env.QZ_PRIVATE_KEY_PATH) {
    return new Response("QZ signing is not configured.", { status: 503 });
  }
  try {
    return new Response(await readFile(process.env.QZ_CERTIFICATE_PATH, "utf8"), {
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Unable to read QZ certificate.", { status: 500 });
  }
}
