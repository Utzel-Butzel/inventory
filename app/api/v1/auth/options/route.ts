import { getPublicAuthOptions } from "@/lib/auth-provider-config";

export const dynamic = "force-dynamic";

/** Public display metadata only, evaluated on the deployment being contacted. */
export async function GET() {
  return Response.json(getPublicAuthOptions(), {
    headers: { "Cache-Control": "no-store" },
  });
}
