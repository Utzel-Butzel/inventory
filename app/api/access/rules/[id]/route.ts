import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { accessRoles, inventoryAccessRules } from "@/db/schema";
import { revokeApiTokensForRoles } from "@/lib/access-control";
import { requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { inventoryAccessRulePatchSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid rule ID." }, { status: 400 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = inventoryAccessRulePatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory access rule.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const [existing] = await db
    .select()
    .from(inventoryAccessRules)
    .where(
      and(
        eq(inventoryAccessRules.organizationId, organizationId),
        eq(inventoryAccessRules.id, id.data),
      ),
    )
    .limit(1);
  if (!existing) return Response.json({ error: "Rule not found." }, { status: 404 });
  const nextRoleKey = parsed.data.roleKey ?? existing.roleKey;
  const [[targetRole], targetRules] = await Promise.all([
    db
      .select({ permissions: accessRoles.permissions })
      .from(accessRoles)
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, nextRoleKey),
        ),
      )
      .limit(1),
    db
      .select({ permissions: inventoryAccessRules.permissions })
      .from(inventoryAccessRules)
      .where(
        and(
          eq(inventoryAccessRules.organizationId, organizationId),
          eq(inventoryAccessRules.roleKey, nextRoleKey),
          eq(inventoryAccessRules.enabled, true),
        ),
      ),
  ]);
  if (!targetRole) {
    return Response.json({ error: "The selected role does not exist." }, { status: 422 });
  }
  const nextPermissions = parsed.data.permissions ?? existing.permissions;
  const targetGrants = new Set([
    ...targetRole.permissions,
    ...targetRules.flatMap((rule) => rule.permissions),
  ]);
  if (
    existing.permissions.some(
      (permission) => !authorization.identity.permissions.includes(permission),
    ) ||
    (nextRoleKey !== authorization.identity.role &&
      Array.from(targetGrants).some(
        (permission) => !authorization.identity.permissions.includes(permission),
      )) ||
    nextPermissions.some(
      (permission) => !authorization.identity.permissions.includes(permission),
    )
  ) {
    return Response.json(
      { error: "You cannot grant or manage permissions beyond your own role." },
      { status: 403 },
    );
  }
  const [rule] = await db
    .update(inventoryAccessRules)
    .set({ ...parsed.data, updatedBy: authorization.identity.subject, updatedAt: new Date() })
    .where(
      and(
        eq(inventoryAccessRules.organizationId, organizationId),
        eq(inventoryAccessRules.id, id.data),
      ),
    )
    .returning();
  if (!rule) return Response.json({ error: "Rule not found." }, { status: 404 });
  await revokeApiTokensForRoles([existing.roleKey, rule.roleKey], organizationId);
  return Response.json({ rule });
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return Response.json({ error: "Invalid rule ID." }, { status: 400 });
  const [existing] = await db
    .select()
    .from(inventoryAccessRules)
    .where(
      and(
        eq(inventoryAccessRules.organizationId, organizationId),
        eq(inventoryAccessRules.id, id.data),
      ),
    )
    .limit(1);
  if (!existing) return Response.json({ error: "Rule not found." }, { status: 404 });
  const [[targetRole], targetRules] = await Promise.all([
    db
      .select({ permissions: accessRoles.permissions })
      .from(accessRoles)
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, existing.roleKey),
        ),
      )
      .limit(1),
    db
      .select({ permissions: inventoryAccessRules.permissions })
      .from(inventoryAccessRules)
      .where(
        and(
          eq(inventoryAccessRules.organizationId, organizationId),
          eq(inventoryAccessRules.roleKey, existing.roleKey),
          eq(inventoryAccessRules.enabled, true),
        ),
      ),
  ]);
  const targetGrants = new Set([
    ...(targetRole?.permissions ?? []),
    ...targetRules.flatMap((rule) => rule.permissions),
  ]);
  if (
    !targetRole ||
    existing.permissions.some(
      (permission) => !authorization.identity.permissions.includes(permission),
    ) ||
    (existing.roleKey !== authorization.identity.role &&
      Array.from(targetGrants).some(
        (permission) => !authorization.identity.permissions.includes(permission),
      ))
  ) {
    return Response.json(
      { error: "You cannot delete a rule with permissions beyond your own role." },
      { status: 403 },
    );
  }
  const [rule] = await db
    .delete(inventoryAccessRules)
    .where(
      and(
        eq(inventoryAccessRules.organizationId, organizationId),
        eq(inventoryAccessRules.id, id.data),
      ),
    )
    .returning({ id: inventoryAccessRules.id, roleKey: inventoryAccessRules.roleKey });
  if (!rule) return Response.json({ error: "Rule not found." }, { status: 404 });
  await revokeApiTokensForRoles([rule.roleKey], organizationId);
  return new Response(null, { status: 204 });
}
