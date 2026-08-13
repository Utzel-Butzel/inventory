import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";

import { auth } from "@/auth";
import { apiTokens, users, type ResourceRecord, type UserRole } from "@/db/schema";
import {
  normalizeUserRole,
  type ApiScope,
} from "@/lib/auth-roles";
import {
  getEffectiveRole,
  getResourceRecord,
  conditionalScopesForRole,
  listRulesForRole,
  permissionsForStandaloneTokenScopes,
  roleScopesForPermissions,
  ruleGrantsResourcePermission,
} from "@/lib/access-control";
import {
  isResourceRulePermission,
  permissionScope,
  type AppPermission,
  type ResourceRulePermission,
} from "@/lib/access-control-contract";
import { db } from "@/lib/db";

export type { ApiScope } from "@/lib/auth-roles";

export type RequestIdentity = {
  kind: "session" | "token";
  subject: string;
  name: string;
  scopes: ApiScope[];
  role: UserRole | null;
  roleName: string | null;
  permissions: AppPermission[];
  userId?: string;
  tokenId?: string;
};

export const hashApiToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const hashRequestIdentity = (identity: RequestIdentity) =>
  createHash("sha256")
    .update(
      identity.userId
        ? `user:${identity.userId}`
        : identity.tokenId
          ? `token:${identity.tokenId}`
          : `subject:${identity.subject}`,
    )
    .digest("hex");

export async function getRequestIdentity(
  request: Request,
): Promise<RequestIdentity | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const rawToken = authorization.slice(7).trim();
    if (!rawToken.startsWith("inv_") || rawToken.length < 24) return null;

    const now = new Date();
    const [token] = await db
      .select()
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.tokenHash, hashApiToken(rawToken)),
          isNull(apiTokens.revokedAt),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
        ),
      )
      .limit(1);

    if (!token) return null;

    let linkedUser: typeof users.$inferSelect | null = null;
    if (token.userId) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, token.userId))
        .limit(1);
      if (
        !user ||
        !user.isActive ||
        token.userSessionVersion !== user.sessionVersion
      ) {
        return null;
      }
      linkedUser = user;
    }

    await db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.id, token.id));

    const effectiveRole = linkedUser
      ? await getEffectiveRole(linkedUser.role)
      : null;
    const permissions = effectiveRole
      ? effectiveRole.permissions
      : permissionsForStandaloneTokenScopes(
          token.scopes.filter((scope): scope is ApiScope =>
            ["read", "write", "ai"].includes(scope),
          ),
        );
    const tokenScopes = token.scopes.filter((scope): scope is ApiScope =>
      ["read", "write", "ai"].includes(scope),
    );

    const roleScopes = effectiveRole
      ? roleScopesForPermissions(effectiveRole.permissions)
      : tokenScopes;
    const conditionalScopes = linkedUser
      ? await conditionalScopesForRole(linkedUser.role)
      : [];
    const effectiveScopes = effectiveRole
      ? Array.from(new Set([...roleScopes, ...conditionalScopes]))
      : tokenScopes;
    return {
      kind: "token",
      subject: linkedUser?.email ?? `token:${token.id}`,
      name: linkedUser?.name ?? token.name,
      scopes: linkedUser
        ? effectiveScopes.filter((scope) => tokenScopes.includes(scope))
        : tokenScopes,
      role: linkedUser?.role ?? null,
      roleName: effectiveRole?.name ?? null,
      permissions: permissions.filter((permission) =>
        tokenScopes.includes(permissionScope(permission)),
      ),
      userId: linkedUser?.id,
      tokenId: token.id,
    };
  }

  return getSessionIdentity();
}

export async function getSessionIdentity(): Promise<RequestIdentity | null> {
  const session = await auth();
  if (!session?.user) return null;

  if (session.user.authProvider === "local") {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (
      !user ||
      !user.isActive ||
      user.sessionVersion !== session.user.sessionVersion
    ) {
      return null;
    }

    const effectiveRole = await getEffectiveRole(user.role);
    if (!effectiveRole) return null;
    const conditionalScopes = await conditionalScopesForRole(user.role);
    return {
      kind: "session",
      subject: user.email,
      name: user.name,
      scopes: Array.from(
        new Set([
          ...roleScopesForPermissions(effectiveRole.permissions),
          ...conditionalScopes,
        ]),
      ),
      role: user.role,
      roleName: effectiveRole.name,
      permissions: effectiveRole.permissions,
      userId: user.id,
    };
  }

  const role = normalizeUserRole(session.user.role, "viewer");
  const effectiveRole = await getEffectiveRole(role);
  if (!effectiveRole) return null;
  const conditionalScopes = await conditionalScopesForRole(role);
  return {
    kind: "session",
    subject: session.user.email ?? session.user.id,
    name: session.user.name ?? session.user.email ?? "User",
    scopes: Array.from(
      new Set([
        ...roleScopesForPermissions(effectiveRole.permissions),
        ...conditionalScopes,
      ]),
    ),
    role,
    roleName: effectiveRole.name,
    permissions: effectiveRole.permissions,
    userId: session.user.id,
  };
}

export async function requireIdentity(
  request: Request,
  scope: ApiScope = "read",
) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return {
      identity: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }
  if (!identity.scopes.includes(scope)) {
    return {
      identity: null,
      response: Response.json(
        { error: `This token is missing the ${scope} scope.` },
        { status: 403 },
      ),
    } as const;
  }
  return { identity, response: null } as const;
}

export async function requireSessionRole(
  request: Request,
  roles: UserRole[],
) {
  const authorization = await requireIdentity(request, "read");
  if (authorization.response) return authorization;
  if (
    authorization.identity.kind !== "session" ||
    !authorization.identity.role ||
    !roles.includes(authorization.identity.role)
  ) {
    return {
      identity: null,
      response: Response.json(
        { error: "You do not have permission to perform this action." },
        { status: 403 },
      ),
    } as const;
  }
  return authorization;
}

export const requireAdminSession = (request: Request) =>
  requireSessionPermission(request, "users.manage");

export async function requirePermission(
  request: Request,
  permission: AppPermission,
) {
  const authorization = await requireIdentity(request, permissionScope(permission));
  if (authorization.response) return authorization;
  if (!authorization.identity.permissions.includes(permission)) {
    return {
      identity: null,
      response: Response.json(
        { error: "You do not have permission to perform this action." },
        { status: 403 },
      ),
    } as const;
  }
  return authorization;
}

export async function requireSessionPermission(
  request: Request,
  permission: AppPermission,
) {
  const authorization = await requirePermission(request, permission);
  if (authorization.response) return authorization;
  if (authorization.identity.kind !== "session") {
    return {
      identity: null,
      response: Response.json(
        { error: "This action requires an authenticated browser session." },
        { status: 403 },
      ),
    } as const;
  }
  return authorization;
}

export async function canAccessResource(
  identity: RequestIdentity,
  permission: ResourceRulePermission,
  resource: ResourceRecord,
) {
  if (identity.permissions.includes(permission)) return true;
  if (!identity.role || !isResourceRulePermission(permission)) return false;
  const rules = await listRulesForRole(identity.role);
  return ruleGrantsResourcePermission({
    roleKey: identity.role,
    permission,
    resource,
    rules,
  });
}

export async function requireResourcePermission(
  request: Request,
  permission: ResourceRulePermission,
  resourceOrId: ResourceRecord | string,
) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return {
      identity: null,
      resource: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }
  const requiredScope = permissionScope(permission);
  if (!identity.scopes.includes(requiredScope)) {
    return {
      identity: null,
      resource: null,
      response: Response.json(
        { error: `This token is missing the ${requiredScope} scope.` },
        { status: 403 },
      ),
    } as const;
  }
  const resource =
    typeof resourceOrId === "string"
      ? await getResourceRecord(resourceOrId)
      : resourceOrId;
  if (!resource) {
    return {
      identity: null,
      resource: null,
      response: Response.json({ error: "Not found" }, { status: 404 }),
    } as const;
  }
  if (!(await canAccessResource(identity, permission, resource))) {
    return {
      identity: null,
      resource: null,
      response: Response.json(
        { error: "You do not have permission to perform this action." },
        { status: 403 },
      ),
    } as const;
  }
  return { identity, resource, response: null } as const;
}
