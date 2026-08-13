import { and, count, eq } from "drizzle-orm";

import {
  accessRoles,
  inventoryAccessRules,
  organizationMemberships,
} from "@/db/schema";
import { appPermissions } from "@/lib/access-control-contract";
import { revokeApiTokensForRoles } from "@/lib/access-control";
import { requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { accessRolePatchSchema } from "@/lib/validators";

type Context = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;
  const { key } = await context.params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = accessRolePatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid role.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const [[currentRole], currentRules] = await Promise.all([
    db
      .select()
      .from(accessRoles)
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, key),
        ),
      )
      .limit(1),
    db
      .select({ permissions: inventoryAccessRules.permissions })
      .from(inventoryAccessRules)
      .where(
        and(
          eq(inventoryAccessRules.organizationId, organizationId),
          eq(inventoryAccessRules.roleKey, key),
          eq(inventoryAccessRules.enabled, true),
        ),
      ),
  ]);
  if (!currentRole) {
    return Response.json({ error: "Role not found." }, { status: 404 });
  }
  const currentGrants = new Set([
    ...currentRole.permissions,
    ...currentRules.flatMap((rule) => rule.permissions),
  ]);
  if (
    (key !== authorization.identity.role &&
      Array.from(currentGrants).some(
        (permission) => !authorization.identity.permissions.includes(permission),
      )) ||
    parsed.data.permissions?.some(
      (permission) => !authorization.identity.permissions.includes(permission),
    )
  ) {
    return Response.json(
      { error: "You cannot manage a role with permissions beyond your own." },
      { status: 403 },
    );
  }
  if (
    key === authorization.identity.role &&
    parsed.data.permissions !== undefined &&
    !parsed.data.permissions.includes("roles.manage")
  ) {
    return Response.json(
      { error: "You cannot remove your own access-management permission." },
      { status: 409 },
    );
  }
  if (
    key === "admin" &&
    parsed.data.permissions !== undefined &&
    (parsed.data.permissions.length !== appPermissions.length ||
      appPermissions.some(
        (permission) => !parsed.data.permissions!.includes(permission),
      ))
  ) {
    return Response.json(
      { error: "The built-in Admin role must retain every permission." },
      { status: 409 },
    );
  }

  const role = await db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(accessRoles)
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, key),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) return null;
    const [saved] = await transaction
      .update(accessRoles)
      .set({
        ...parsed.data,
        updatedBy: authorization.identity.subject,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, key),
        ),
      )
      .returning();

    return saved ?? null;
  });
  if (!role) return Response.json({ error: "Role not found." }, { status: 404 });
  if (parsed.data.permissions !== undefined) {
    await revokeApiTokensForRoles([key], organizationId);
  }
  return Response.json({ role });
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;
  const { key } = await context.params;

  const [[role], roleRules] = await Promise.all([
    db
      .select()
      .from(accessRoles)
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, key),
        ),
      )
      .limit(1),
    db
      .select({ permissions: inventoryAccessRules.permissions })
      .from(inventoryAccessRules)
      .where(
        and(
          eq(inventoryAccessRules.organizationId, organizationId),
          eq(inventoryAccessRules.roleKey, key),
          eq(inventoryAccessRules.enabled, true),
        ),
      ),
  ]);
  if (!role) return Response.json({ error: "Role not found." }, { status: 404 });
  if (key === authorization.identity.role) {
    return Response.json({ error: "You cannot delete your own role." }, { status: 409 });
  }
  const roleGrants = new Set([
    ...role.permissions,
    ...roleRules.flatMap((rule) => rule.permissions),
  ]);
  if (
    Array.from(roleGrants).some(
      (permission) => !authorization.identity.permissions.includes(permission),
    )
  ) {
    return Response.json(
      { error: "You cannot delete a role with permissions beyond your own." },
      { status: 403 },
    );
  }
  if (role.isSystem) {
    return Response.json({ error: "Built-in roles cannot be deleted." }, { status: 409 });
  }
  const [{ value }] = await db
    .select({ value: count() })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.roleKey, key),
      ),
    );
  if (value > 0) {
    return Response.json(
      { error: "Move all users to another role before deleting this role." },
      { status: 409 },
    );
  }
  await db
    .delete(accessRoles)
    .where(
      and(
        eq(accessRoles.organizationId, organizationId),
        eq(accessRoles.key, key),
      ),
    );
  return new Response(null, { status: 204 });
}
