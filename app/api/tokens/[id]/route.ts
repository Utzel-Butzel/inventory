import { and, eq, isNull } from "drizzle-orm";

import { apiTokens } from "@/db/schema";
import { requireAdminSession } from "@/lib/api-auth";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireAdminSession(request);
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  const [revoked] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!revoked) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
