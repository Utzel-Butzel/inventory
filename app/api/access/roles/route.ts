import { asc } from "drizzle-orm";

import { accessRoles, inventoryAccessRules } from "@/db/schema";
import { permissionGroups, resourceRulePermissions } from "@/lib/access-control-contract";
import { listAccessRolesWithCounts } from "@/lib/access-control";
import { requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { accessRoleInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;

  const [roles, rules] = await Promise.all([
    listAccessRolesWithCounts(),
    db
      .select()
      .from(inventoryAccessRules)
      .orderBy(asc(inventoryAccessRules.priority), asc(inventoryAccessRules.name)),
  ]);
  return Response.json({
    roles,
    rules,
    permissionGroups,
    resourceRulePermissions,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = accessRoleInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid role.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (
    parsed.data.permissions.some(
      (permission) => !authorization.identity.permissions.includes(permission),
    )
  ) {
    return Response.json(
      { error: "You cannot grant permissions that your own role does not have." },
      { status: 403 },
    );
  }
  const [role] = await db
    .insert(accessRoles)
    .values({
      ...parsed.data,
      createdBy: authorization.identity.subject,
      updatedBy: authorization.identity.subject,
    })
    .onConflictDoNothing({ target: accessRoles.key })
    .returning();
  if (!role) {
    return Response.json({ error: "A role with this key already exists." }, { status: 409 });
  }
  return Response.json({ role: { ...role, memberCount: 0 } }, { status: 201 });
}
