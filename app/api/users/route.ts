import { hash } from "bcryptjs";
import { and, asc, desc, eq } from "drizzle-orm";

import { accessRoles, inventoryAccessRules, users } from "@/db/schema";
import { requireSessionPermission } from "@/lib/api-auth";
import { listAccessRolesWithCounts } from "@/lib/access-control";
import { db } from "@/lib/db";
import { userCreateInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const publicUser = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  passwordUpdatedAt: users.passwordUpdatedAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "users.manage");
  if (authorization.response) return authorization.response;

  const [rows, roles] = await Promise.all([
    db
      .select(publicUser)
      .from(users)
      .orderBy(desc(users.isActive), asc(users.name), asc(users.email)),
    listAccessRolesWithCounts(),
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

  const [[selectedRole], selectedRoleRules] = await Promise.all([
    db
      .select({ key: accessRoles.key, permissions: accessRoles.permissions })
      .from(accessRoles)
      .where(eq(accessRoles.key, parsed.data.role))
      .limit(1),
    db
      .select({ permissions: inventoryAccessRules.permissions })
      .from(inventoryAccessRules)
      .where(
        and(
          eq(inventoryAccessRules.roleKey, parsed.data.role),
          eq(inventoryAccessRules.enabled, true),
        ),
      ),
  ]);
  if (!selectedRole) {
    return Response.json({ error: "The selected role does not exist." }, { status: 422 });
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
  const [created] = await db
    .insert(users)
    .values({
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      role: parsed.data.role,
      createdBy: authorization.identity.subject,
      updatedBy: authorization.identity.subject,
    })
    .onConflictDoNothing({ target: users.email })
    .returning(publicUser);

  if (!created) {
    return Response.json(
      { error: "A user with this email address already exists." },
      { status: 409 },
    );
  }

  return Response.json({ user: created }, { status: 201 });
}
