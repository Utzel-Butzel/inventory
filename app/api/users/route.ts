import { hash } from "bcryptjs";
import { and, asc, desc, eq } from "drizzle-orm";

import {
  accessRoles,
  inventoryAccessRules,
  organizationMemberships,
  users,
} from "@/db/schema";
import { requireSessionPermission } from "@/lib/api-auth";
import { listAccessRolesWithCounts } from "@/lib/access-control";
import { db } from "@/lib/db";
import { isSuperAdminEmail } from "@/lib/deployment-access";
import { userCreateInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const publicUser = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: organizationMemberships.roleKey,
  isActive: organizationMemberships.isActive,
  lastLoginAt: users.lastLoginAt,
  passwordUpdatedAt: users.passwordUpdatedAt,
  createdAt: organizationMemberships.createdAt,
  updatedAt: organizationMemberships.updatedAt,
};

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "users.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;

  const [rows, roles] = await Promise.all([
    db
      .select(publicUser)
      .from(organizationMemberships)
      .innerJoin(users, eq(organizationMemberships.userId, users.id))
      .where(eq(organizationMemberships.organizationId, organizationId))
      .orderBy(
        desc(organizationMemberships.isActive),
        asc(users.name),
        asc(users.email),
      ),
    listAccessRolesWithCounts(organizationId),
  ]);

  return Response.json({
    users: rows,
    roles,
    currentUserId: authorization.identity.userId ?? null,
  });
}

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "users.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = userCreateInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid user settings.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  if (
    isSuperAdminEmail(parsed.data.email) &&
    !authorization.identity.isSuperAdmin
  ) {
    return Response.json(
      { error: "Only a superadmin can provision another superadmin account." },
      { status: 403 },
    );
  }

  const [[selectedRole], selectedRoleRules] = await Promise.all([
    db
      .select({ key: accessRoles.key, permissions: accessRoles.permissions })
      .from(accessRoles)
      .where(
        and(
          eq(accessRoles.organizationId, organizationId),
          eq(accessRoles.key, parsed.data.role),
        ),
      )
      .limit(1),
    db
      .select({ permissions: inventoryAccessRules.permissions })
      .from(inventoryAccessRules)
      .where(
        and(
          eq(inventoryAccessRules.organizationId, organizationId),
          eq(inventoryAccessRules.roleKey, parsed.data.role),
          eq(inventoryAccessRules.enabled, true),
        ),
      ),
  ]);
  if (!selectedRole) {
    return Response.json(
      { error: "The selected role does not exist." },
      { status: 422 },
    );
  }
  const selectedRoleGrants = new Set([
    ...selectedRole.permissions,
    ...selectedRoleRules.flatMap((rule) => rule.permissions),
  ]);
  if (
    selectedRole.key !== authorization.identity.role &&
    Array.from(selectedRoleGrants).some(
      (permission) => !authorization.identity.permissions.includes(permission),
    )
  ) {
    return Response.json(
      { error: "You cannot assign a role with permissions beyond your own." },
      { status: 403 },
    );
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const result = await db.transaction(async (transaction) => {
    let [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    if (!user) {
      [user] = await transaction
        .insert(users)
        .values({
          email: parsed.data.email,
          name: parsed.data.name,
          passwordHash,
          role: parsed.data.role,
          createdBy: authorization.identity.subject,
          updatedBy: authorization.identity.subject,
        })
        .returning();
    }

    const [membership] = await transaction
      .insert(organizationMemberships)
      .values({
        organizationId,
        userId: user.id,
        roleKey: parsed.data.role,
        createdBy: authorization.identity.subject,
      })
      .onConflictDoNothing({
        target: [
          organizationMemberships.organizationId,
          organizationMemberships.userId,
        ],
      })
      .returning();
    if (membership && !user.isActive) {
      [user] = await transaction
        .update(users)
        .set({
          isActive: true,
          updatedBy: authorization.identity.subject,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();
    }
    return { user, membership };
  });

  if (!result.membership) {
    return Response.json(
      { error: "This user already belongs to the organization." },
      { status: 409 },
    );
  }

  return Response.json(
    {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.membership.roleKey,
        isActive: result.membership.isActive,
        lastLoginAt: result.user.lastLoginAt,
        passwordUpdatedAt: result.user.passwordUpdatedAt,
        createdAt: result.membership.createdAt,
        updatedAt: result.membership.updatedAt,
      },
    },
    { status: 201 },
  );
}
