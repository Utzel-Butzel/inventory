import { eq } from "drizzle-orm";

import { apiTokens } from "@/db/schema";
import { getRequestIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity || identity.kind !== "token" || !identity.tokenId) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.id, identity.tokenId));

  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
