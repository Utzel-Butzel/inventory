import { and, eq } from "drizzle-orm";

import { userListViews } from "@/db/schema";
import { requireIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { listViewScopeSchema, listViewWriteSchema } from "@/lib/list-view-contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const identity = authorization.identity;
  if (identity.kind !== "session" || !identity.userId) {
    return Response.json({ error: "A browser session is required." }, { status: 403, headers });
  }
  const scope = listViewScopeSchema.safeParse(new URL(request.url).searchParams.get("scope"));
  if (!scope.success) return Response.json({ error: "Invalid list scope." }, { status: 422, headers });
  const [saved] = await db.select().from(userListViews).where(and(
    eq(userListViews.organizationId, identity.organizationId),
    eq(userListViews.userId, identity.userId),
    eq(userListViews.scope, scope.data),
  ));
  return Response.json({ collection: saved?.collection ?? { views: [], defaultId: null }, revision: saved?.revision ?? 0, canSave: !identity.organization.isReadOnly }, { headers });
}

export async function PUT(request: Request) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization.response;
  const identity = authorization.identity;
  if (identity.kind !== "session" || !identity.userId || identity.organization.isReadOnly) {
    return Response.json({ error: "A writable browser session is required." }, { status: 403, headers });
  }
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return Response.json({ error: "Expected a JSON request body." }, { status: 400, headers }); }
  const parsed = listViewWriteSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "Invalid list views." }, { status: 422, headers });
  const { scope, revision, collection } = parsed.data;
  const owner = { organizationId: identity.organizationId, userId: identity.userId, scope };
  // Compare-and-swap prevents another tab or device from silently losing views.
  const rows = revision === 0
    ? await db.insert(userListViews).values({ ...owner, collection }).onConflictDoNothing().returning()
    : await db.update(userListViews).set({ collection, revision: revision + 1, updatedAt: new Date() }).where(and(
      eq(userListViews.organizationId, owner.organizationId),
      eq(userListViews.userId, owner.userId),
      eq(userListViews.scope, scope),
      eq(userListViews.revision, revision),
    )).returning();
  if (!rows.length) return Response.json({ error: "Views changed on another device. Reload before saving." }, { status: 409, headers });
  return Response.json({ collection: rows[0].collection, revision: rows[0].revision }, { headers });
}
