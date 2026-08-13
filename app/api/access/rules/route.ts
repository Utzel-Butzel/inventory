import { and, eq } from "drizzle-orm";

import { accessRoles, inventoryAccessRules } from "@/db/schema";
import { revokeApiTokensForRoles } from "@/lib/access-control";
import { requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { inventoryAccessRuleInputSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "roles.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = inventoryAccessRuleInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid inventory access rule.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const [[targetRole], targetRules] = await Promise.all([
    db
      .select({ permissions: accessRoles.permissions })
      .from(accessRoles)
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, parsed.data.roleKey),
        ),
      )
      .limit(1),
    db
      .select({ permissions: inventoryAccessRules.permissions })
      .from(inventoryAccessRules)
      .where(
        and(
          eq(inventoryAccessRules.organizationId, organizationId),
          eq(inventoryAccessRules.roleKey, parsed.data.roleKey),
          eq(inventoryAccessRules.enabled, true),
        ),
      ),
  ]);
  if (!targetRole) {
    return Response.json({ error: "The selected role does not exist." }, { status: 422 });
  }
  const targetGrants = new Set([
    ...targetRole.permissions,
    ...targetRules.flatMap((rule) => rule.permissions),
  ]);
  if (
    (parsed.data.roleKey !== authorization.identity.role &&
      Array.from(targetGrants).some(
        (permission) => !authorization.identity.permissions.includes(permission),
      )) ||
    parsed.data.permissions.some(
      (permission) => !authorization.identity.permissions.includes(permission),
    )
  ) {
    return Response.json(
      { error: "You cannot grant or manage permissions beyond your own role." },
      { status: 403 },
    );
  }
  try {
    const [rule] = await db
      .insert(inventoryAccessRules)
      .values({
        ...parsed.data,
        organizationId,
        createdBy: authorization.identity.subject,
        updatedBy: authorization.identity.subject,
      })
      .returning();
    await revokeApiTokensForRoles([rule.roleKey], organizationId);
    return Response.json({ rule }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("foreign key")) {
      return Response.json({ error: "The selected role does not exist." }, { status: 422 });
    }
    throw error;
  }
}
