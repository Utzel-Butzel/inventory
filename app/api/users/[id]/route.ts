import { hash } from "bcryptjs";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  accessRoles,
  apiTokens,
  inventoryAccessRules,
  users,
} from "@/db/schema";
import { requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
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

export async function PATCH(request: Request, context: Context) {
  const authorization = await requireSessionPermission(request, "users.manage");
  if (authorization.response) return authorization.response;

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
      const loadRoleGrant = async (roleKey: string) => {
        const [[definition], rules] = await Promise.all([
          transaction
            .select({ permissions: accessRoles.permissions })
            .from(accessRoles)
            .where(eq(accessRoles.key, roleKey))
            .limit(1),
          transaction
            .select({ permissions: inventoryAccessRules.permissions })
            .from(inventoryAccessRules)
            .where(
              and(
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
        .select()
        .from(users)
        .where(eq(users.id, id.data))
        .limit(1)
        .for("update");
      if (!existing) throw new UserUpdateError("User not found.", 404);

      const existingRoleGrant = await loadRoleGrant(existing.role);
      if (
        !existingRoleGrant ||
        (existing.role !== authorization.identity.role &&
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

      const nextRole = parsed.data.role ?? existing.role;
      const nextActive = parsed.data.isActive ?? existing.isActive;
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
      const changesOwnAccess =
        authorization.identity.userId === existing.id &&
        (!nextActive ||
          !nextRoleGrant.has("users.manage"));
      if (changesOwnAccess) {
        throw new UserUpdateError(
          "You cannot disable your own account or remove your own user-management permission.",
          409,
        );
      }

      const removesActiveAdmin =
        existing.isActive &&
        existing.role === "admin" &&
        (!nextActive || nextRole !== "admin");
      if (removesActiveAdmin) {
        await transaction.execute(
          sql`select "id" from "users" where "role" = 'admin' and "is_active" = true for update`,
        );
        const [{ value }] = await transaction
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
        if (value <= 1) {
          throw new UserUpdateError(
            "At least one active administrator must remain.",
            409,
          );
        }
      }

      const invalidatesSessions = Boolean(
        nextPasswordHash ||
          parsed.data.role !== undefined ||
          parsed.data.isActive !== undefined,
      );
      const [updated] = await transaction
        .update(users)
        .set({
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
          ...(parsed.data.isActive !== undefined
            ? { isActive: parsed.data.isActive }
            : {}),
          ...(nextPasswordHash
            ? { passwordHash: nextPasswordHash, passwordUpdatedAt: new Date() }
            : {}),
          ...(invalidatesSessions
            ? { sessionVersion: sql`${users.sessionVersion} + 1` }
            : {}),
          updatedBy: authorization.identity.subject,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning(publicUser);

      if (!updated) throw new UserUpdateError("User not found.", 404);
      if (invalidatesSessions) {
        await transaction
          .update(apiTokens)
          .set({ revokedAt: new Date() })
          .where(eq(apiTokens.userId, existing.id));
      }
      return updated;
    });

    return Response.json({ user: saved });
  } catch (error) {
    if (error instanceof UserUpdateError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
