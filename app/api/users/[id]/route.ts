import { hash } from "bcryptjs";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  accessRoles,
  apiTokens,
  inventoryAccessRules,
  organizationMemberships,
  users,
} from "@/db/schema";
import { requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { isSuperAdminEmail } from "@/lib/deployment-access";
import { userUpdateInputSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

class UserUpdateError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "users.manage");
  if (authorization.response) return authorization.response;
  const organizationId = authorization.identity.organizationId;

  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) {
    return Response.json({ error: "Invalid user ID." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = userUpdateInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid user settings.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const nextPasswordHash = parsed.data.password
    ? await hash(parsed.data.password, 12)
    : undefined;

  try {
    const saved = await db.transaction(async (transaction) => {
      // Serialize membership administration per organization. Without this,
      // two admins could concurrently demote each other after both observed a
      // count of two, leaving the organization with no active administrator.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`,
      );

      const loadRoleGrant = async (roleKey: string) => {
        const [[definition], rules] = await Promise.all([
          transaction
            .select({ permissions: accessRoles.permissions })
            .from(accessRoles)
            .where(
              and(
                eq(accessRoles.organizationId, organizationId),
                eq(accessRoles.key, roleKey),
              ),
            )
            .limit(1),
          transaction
            .select({ permissions: inventoryAccessRules.permissions })
            .from(inventoryAccessRules)
            .where(
              and(
                eq(inventoryAccessRules.organizationId, organizationId),
                eq(inventoryAccessRules.roleKey, roleKey),
                eq(inventoryAccessRules.enabled, true),
              ),
            ),
        ]);
        return definition
          ? new Set([
              ...definition.permissions,
              ...rules.flatMap((rule) => rule.permissions),
            ])
          : null;
      };

      const [existing] = await transaction
        .select({ user: users, membership: organizationMemberships })
        .from(organizationMemberships)
        .innerJoin(users, eq(organizationMemberships.userId, users.id))
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, id.data),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing) throw new UserUpdateError("User not found.", 404);
      if (
        isSuperAdminEmail(existing.user.email) &&
        !authorization.identity.isSuperAdmin
      ) {
        throw new UserUpdateError(
          "Only a superadmin can manage another superadmin account.",
          403,
        );
      }

      const existingRoleGrant = await loadRoleGrant(existing.membership.roleKey);
      if (
        !existingRoleGrant ||
        (existing.membership.roleKey !== authorization.identity.role &&
          Array.from(existingRoleGrant).some(
            (permission) =>
              !authorization.identity.permissions.includes(permission),
          ))
      ) {
        throw new UserUpdateError(
          "You cannot manage a user whose role has permissions beyond your own.",
          403,
        );
      }

      const nextRole = parsed.data.role ?? existing.membership.roleKey;
      const nextActive =
        parsed.data.isActive ?? existing.membership.isActive;
      const nextRoleGrant = await loadRoleGrant(nextRole);
      if (!nextRoleGrant) {
        throw new UserUpdateError("The selected role does not exist.", 422);
      }
      if (
        nextRole !== authorization.identity.role &&
        Array.from(nextRoleGrant).some(
          (permission) =>
            !authorization.identity.permissions.includes(permission),
        )
      ) {
        throw new UserUpdateError(
          "You cannot assign a role with permissions beyond your own.",
          403,
        );
      }
      if (
        authorization.identity.userId === existing.user.id &&
        (!nextActive || !nextRoleGrant.has("users.manage"))
      ) {
        throw new UserUpdateError(
          "You cannot disable your own membership or remove your own user-management permission.",
          409,
        );
      }

      if (
        authorization.identity.userId !== existing.user.id &&
        (parsed.data.name !== undefined || nextPasswordHash)
      ) {
        throw new UserUpdateError(
          "Only the account owner can change their global profile or password.",
          403,
        );
      }

      const removesActiveAdmin =
        existing.membership.isActive &&
        existing.membership.roleKey === "admin" &&
        (!nextActive || nextRole !== "admin");
      if (removesActiveAdmin) {
        const [{ value }] = await transaction
          .select({ value: count() })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.roleKey, "admin"),
              eq(organizationMemberships.isActive, true),
            ),
          );
        if (value <= 1) {
          throw new UserUpdateError(
            "At least one active administrator must remain.",
            409,
          );
        }
      }

      if (
        parsed.data.role !== undefined ||
        parsed.data.isActive !== undefined
      ) {
        await transaction
          .update(organizationMemberships)
          .set({
            ...(parsed.data.role !== undefined
              ? { roleKey: parsed.data.role }
              : {}),
            ...(parsed.data.isActive !== undefined
              ? { isActive: parsed.data.isActive }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(organizationMemberships.organizationId, organizationId),
              eq(organizationMemberships.userId, existing.user.id),
            ),
          );
      }

      let globallyActive = existing.user.isActive;
      if (parsed.data.isActive !== undefined) {
        const [{ value: activeMemberships }] = await transaction
          .select({ value: count() })
          .from(organizationMemberships)
          .where(
            and(
              eq(organizationMemberships.userId, existing.user.id),
              eq(organizationMemberships.isActive, true),
            ),
          );
        globallyActive = activeMemberships > 0;
      }

      let updatedUser = existing.user;
      if (
        parsed.data.name !== undefined ||
        nextPasswordHash ||
        globallyActive !== existing.user.isActive
      ) {
        [updatedUser] = await transaction
          .update(users)
          .set({
            ...(parsed.data.name !== undefined
              ? { name: parsed.data.name }
              : {}),
            ...(nextPasswordHash
              ? {
                  passwordHash: nextPasswordHash,
                  passwordUpdatedAt: new Date(),
                  sessionVersion: sql.raw('"session_version" + 1'),
                }
              : {}),
            ...(globallyActive !== existing.user.isActive
              ? { isActive: globallyActive }
              : {}),
            updatedBy: authorization.identity.subject,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.user.id))
          .returning();
      }

      if (nextPasswordHash) {
        await transaction
          .update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(eq(apiTokens.userId, existing.user.id));
      }

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: nextRole,
        isActive: nextActive,
        lastLoginAt: updatedUser.lastLoginAt,
        passwordUpdatedAt: updatedUser.passwordUpdatedAt,
        createdAt: existing.membership.createdAt,
        updatedAt: new Date(),
      };
    });

    return Response.json({ user: saved });
  } catch (error) {
    if (error instanceof UserUpdateError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
