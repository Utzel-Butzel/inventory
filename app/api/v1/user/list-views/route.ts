import { and, eq } from "drizzle-orm";

import { organizationListViews, userListViews } from "@/db/schema";
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
  const [[saved], [shared]] = await Promise.all([db.select().from(userListViews).where(and(
    eq(userListViews.organizationId, identity.organizationId),
    eq(userListViews.userId, identity.userId),
    eq(userListViews.scope, scope.data),
  )), db.select().from(organizationListViews).where(and(
    eq(organizationListViews.organizationId, identity.organizationId),
    eq(organizationListViews.scope, scope.data),
  ))]);
  return Response.json({
    collection: saved?.collection ?? { views: [], defaultId: null }, revision: saved?.revision ?? 0,
    organizationCollection: shared?.collection ?? { views: [], defaultId: null }, organizationRevision: shared?.revision ?? 0,
    canSave: !identity.organization.isReadOnly,
    canManageOrganizationViews: !identity.organization.isReadOnly && identity.scopes.includes("write"),
  }, { headers });
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
  const { scope, revision, collection, organizationCollection, organizationRevision } = parsed.data;
  if (organizationCollection && !identity.scopes.includes("write")) {
    return Response.json({ error: "Write access is required to manage organization views." }, { status: 403, headers });
  }
  const owner = { organizationId: identity.organizationId, userId: identity.userId, scope };
  const conflict = new Error("List views changed");
  try {
    // Visibility changes must move a view atomically. Both collections use
    // compare-and-swap so another member's edits cannot be silently overwritten.
    const result = await db.transaction(async (tx) => {
      const [personal] = revision === 0
        ? await tx.insert(userListViews).values({ ...owner, collection }).onConflictDoNothing().returning()
        : await tx.update(userListViews).set({ collection, revision: revision + 1, updatedAt: new Date() }).where(and(
          eq(userListViews.organizationId, owner.organizationId),
          eq(userListViews.userId, owner.userId),
          eq(userListViews.scope, scope),
          eq(userListViews.revision, revision),
        )).returning();
      if (!personal) throw conflict;
      if (!organizationCollection || organizationRevision === undefined) return { collection: personal.collection, revision: personal.revision };
      const [shared] = organizationRevision === 0
        ? await tx.insert(organizationListViews).values({ organizationId: owner.organizationId, scope, collection: organizationCollection }).onConflictDoNothing().returning()
        : await tx.update(organizationListViews).set({ collection: organizationCollection, revision: organizationRevision + 1, updatedAt: new Date() }).where(and(
          eq(organizationListViews.organizationId, owner.organizationId),
          eq(organizationListViews.scope, scope),
          eq(organizationListViews.revision, organizationRevision),
        )).returning();
      if (!shared) throw conflict;
      return { collection: personal.collection, revision: personal.revision, organizationCollection: shared.collection, organizationRevision: shared.revision };
    });
    return Response.json(result, { headers });
  } catch (error) {
    if (error !== conflict) throw error;
    return Response.json({ error: "Views changed on another device. Reload before saving." }, { status: 409, headers });
  }
}
