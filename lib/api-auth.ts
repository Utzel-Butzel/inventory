import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { createHash } from "node:crypto";

import { auth, demoAccessEnabled } from "@/auth";
import { apiTokens, users, type ResourceRecord, type UserRole } from "@/db/schema";
import type { ApiScope } from "@/lib/auth-roles";
import {
  conditionalScopesForRole,
  getEffectiveRole,
  getResourceRecord,
  listRulesForRole,
  permissionsForStandaloneTokenScopes,
  roleScopesForPermissions,
  ruleGrantsResourcePermission,
} from "@/lib/access-control";
import {
  isResourceRulePermission,
  permissionScope,
  type AppPermission,
} from "@/lib/access-control-contract";
import { db } from "@/lib/db";
import {
  DEFAULT_INVENTORY_PAGE_SIZE,
  normalizeInventoryPageSize,
  type InventoryPageSize,
} from "@/lib/inventory-pagination";
import {
  isPinnedReadOnlyDemoMembershipSet,
  organizationAllowsPermission,
  PUBLIC_DEMO_ORGANIZATION_ID,
  PUBLIC_DEMO_USER_ID,
  restrictOrganizationPermissions,
  restrictOrganizationScopes,
} from "@/lib/organization-read-only";
import {
  getOrganization,
  listOrganizationsForUser,
  ORGANIZATION_COOKIE,
  ORGANIZATION_HEADER,
  ORGANIZATION_ROUTE_HEADER,
  organizationSummary,
  selectOrganization,
  type OrganizationMembershipSummary,
  type OrganizationSummary,
} from "@/lib/organizations";

export type { ApiScope } from "@/lib/auth-roles";

export type IdentityOrganization = OrganizationSummary & {
  role: UserRole | null;
  roleName: string | null;
};

export type RequestIdentity = {
  kind: "session" | "token";
  subject: string;
  name: string;
  scopes: ApiScope[];
  role: UserRole | null;
  roleName: string | null;
  permissions: AppPermission[];
  organizationId: string;
  organization: IdentityOrganization;
  organizations: IdentityOrganization[];
  inventoryPageSize: InventoryPageSize;
  developerMode: boolean;
  userId?: string;
  tokenId?: string;
};

export const hashApiToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const hashRequestIdentity = (identity: RequestIdentity) => {
  const principal = identity.userId
    ? "user:" + identity.userId
    : identity.tokenId
      ? "token:" + identity.tokenId
      : "subject:" + identity.subject;
  return createHash("sha256")
    .update(identity.organizationId + ":" + principal)
    .digest("hex");
};

const transportScopes = (scopes: readonly string[]) =>
  scopes.filter((scope): scope is ApiScope =>
    ["read", "write", "ai"].includes(scope),
  );

const identityOrganization = (
  membership: OrganizationMembershipSummary,
): IdentityOrganization => ({ ...membership });

async function identityForUser(options: {
  kind: "session" | "token";
  user: typeof users.$inferSelect;
  requestedOrganizationId?: string | null;
  fallbackOrganizationId?: string | null;
  allowOrganizationSlug?: boolean;
  allowRequestedFallback?: boolean;
  tokenScopes?: ApiScope[];
  tokenId?: string;
  demoOrganizationId?: string;
  demoOrganizationSlug?: string;
}) {
  const memberships = await listOrganizationsForUser(options.user.id);
  // Demo sessions are revalidated against tenant state on every request. A
  // stale JWT cannot escape its single, read-only viewer membership.
  const demoOrganizationSlug = options.demoOrganizationSlug
    ?.trim()
    .toLowerCase();
  let selected: OrganizationMembershipSummary | null | undefined;
  if (demoOrganizationSlug) {
    if (
      !options.demoOrganizationId ||
      !isPinnedReadOnlyDemoMembershipSet(
        memberships,
        demoOrganizationSlug,
        options.demoOrganizationId,
      )
    ) {
      return null;
    }
    selected = memberships[0];
    if (!selected) return null;
    const requested = options.requestedOrganizationId?.trim();
    if (
      requested &&
      requested !== selected.id &&
      requested.toLowerCase() !== selected.slug
    ) {
      return null;
    }
  } else {
    selected = selectOrganization(
      memberships,
      options.requestedOrganizationId,
      options.fallbackOrganizationId,
      options.allowOrganizationSlug,
    );
    if (!selected && options.allowRequestedFallback) {
      selected = selectOrganization(
        memberships,
        null,
        options.fallbackOrganizationId,
        options.allowOrganizationSlug,
      );
    }
  }
  if (!selected) return null;

  const effectiveRole = await getEffectiveRole(selected.role, selected.id);
  if (!effectiveRole) return null;
  if (
    demoOrganizationSlug &&
    (effectiveRole.key !== "viewer" || effectiveRole.isSystem !== true)
  ) {
    return null;
  }
  const conditionalScopes = selected.isReadOnly
    ? []
    : await conditionalScopesForRole(selected.role, selected.id);
  const roleScopes = Array.from(
    new Set([
      ...roleScopesForPermissions(effectiveRole.permissions),
      ...conditionalScopes,
    ]),
  );
  const unrestrictedScopes = options.tokenScopes
    ? roleScopes.filter((scope) => options.tokenScopes?.includes(scope))
    : roleScopes;
  const unrestrictedPermissions = options.tokenScopes
    ? effectiveRole.permissions.filter((permission) =>
        options.tokenScopes?.includes(permissionScope(permission)),
      )
    : effectiveRole.permissions;
  const scopes = restrictOrganizationScopes(
    unrestrictedScopes,
    selected.isReadOnly,
  );
  const permissions = restrictOrganizationPermissions(
    unrestrictedPermissions,
    selected.isReadOnly,
  );
  const organization = identityOrganization(selected);

  return {
    kind: options.kind,
    subject: options.user.email,
    name: options.user.name,
    scopes,
    role: selected.role,
    roleName: effectiveRole.name,
    permissions,
    organizationId: selected.id,
    organization,
    organizations: memberships.map(identityOrganization),
    inventoryPageSize: normalizeInventoryPageSize(options.user.inventoryPageSize),
    developerMode: options.user.developerMode,
    userId: options.user.id,
    ...(options.tokenId ? { tokenId: options.tokenId } : {}),
  } satisfies RequestIdentity;
}

export async function getRequestIdentity(
  request: Request,
): Promise<RequestIdentity | null> {
  const requestedOrganizationId = request.headers
    .get(ORGANIZATION_HEADER)
    ?.trim();
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

    const tokenScopes = transportScopes(token.scopes);
    if (linkedUser) {
      const identity = await identityForUser({
        kind: "token",
        user: linkedUser,
        requestedOrganizationId,
        fallbackOrganizationId: token.organizationId,
        tokenScopes,
        tokenId: token.id,
      });
      // Token usage metadata must not make a read-only tenant writable by
      // accident, even when an old credential still exists.
      if (identity && !identity.organization.isReadOnly) {
        await db
          .update(apiTokens)
          .set({ lastUsedAt: now })
          .where(eq(apiTokens.id, token.id));
      }
      return identity;
    }

    // Standalone credentials are permanently pinned to their issuing
    // organization; a header can repeat that id, never override it.
    if (
      requestedOrganizationId &&
      requestedOrganizationId !== token.organizationId
    ) {
      return null;
    }
    const organizationRecord = await getOrganization(token.organizationId);
    if (!organizationRecord) return null;
    const organization: IdentityOrganization = {
      ...organizationSummary(organizationRecord),
      role: null,
      roleName: null,
    };
    const scopes = restrictOrganizationScopes(
      tokenScopes,
      organization.isReadOnly,
    );
    const identity = {
      kind: "token",
      subject: "token:" + token.id,
      name: token.name,
      scopes,
      role: null,
      roleName: null,
      permissions: restrictOrganizationPermissions(
        permissionsForStandaloneTokenScopes(scopes),
        organization.isReadOnly,
      ),
      organizationId: organization.id,
      organization,
      organizations: [organization],
      inventoryPageSize: DEFAULT_INVENTORY_PAGE_SIZE,
      developerMode: false,
      tokenId: token.id,
    } satisfies RequestIdentity;
    if (!organization.isReadOnly) {
      await db
        .update(apiTokens)
        .set({ lastUsedAt: now })
        .where(eq(apiTokens.id, token.id));
    }
    return identity;
  }

  return getSessionIdentity(requestedOrganizationId);
}

export async function getSessionIdentity(
  requestedOrganizationId?: string | null,
): Promise<RequestIdentity | null> {
  const session = await auth();
  if (!session?.user) return null;
  const isDemoSession = session.user.authProvider === "demo";
  if (isDemoSession && !demoAccessEnabled) return null;

  let selectedOrganizationId = requestedOrganizationId?.trim();
  let allowOrganizationSlug = false;
  let selectedFromCookie = false;
  if (!selectedOrganizationId) {
    selectedOrganizationId = (await headers())
      .get(ORGANIZATION_ROUTE_HEADER)
      ?.trim();
    allowOrganizationSlug = Boolean(selectedOrganizationId);
  }
  if (!selectedOrganizationId) {
    const cookieStore = await cookies();
    selectedOrganizationId = cookieStore.get(ORGANIZATION_COOKIE)?.value.trim();
    selectedFromCookie = Boolean(selectedOrganizationId);
    allowOrganizationSlug = selectedFromCookie;
  }

  let user: typeof users.$inferSelect | undefined;
  const sessionUserId = session.user.id?.trim();
  const databaseUserId =
    (session.user.authProvider === "local" || isDemoSession) &&
    sessionUserId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionUserId,
    )
      ? sessionUserId
      : null;
  if (isDemoSession && databaseUserId !== PUBLIC_DEMO_USER_ID) return null;
  if (databaseUserId) {
    [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, databaseUserId))
      .limit(1);
  }

  // External identities are accepted only when Auth0 verified the email and
  // an administrator already provisioned that email into an organization.
  // This keeps the identity provider from becoming an implicit tenant invite.
  const mayLinkByEmail =
    session.user.authProvider === "local" || session.user.auth0EmailVerified;
  if (
    !user &&
    !isDemoSession &&
    mayLinkByEmail &&
    session.user.email
  ) {
    [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, session.user.email.trim().toLowerCase()))
      .limit(1);
  }

  if (user) {
    if (!user.isActive) return null;
    if (
      (session.user.authProvider === "local" || isDemoSession) &&
      user.sessionVersion !== session.user.sessionVersion
    ) {
      return null;
    }
    return identityForUser({
      kind: "session",
      user,
      requestedOrganizationId: selectedOrganizationId,
      allowRequestedFallback: selectedFromCookie,
      allowOrganizationSlug,
      ...(isDemoSession
        ? {
            demoOrganizationId: PUBLIC_DEMO_ORGANIZATION_ID,
            demoOrganizationSlug:
              process.env.DEMO_ORGANIZATION_SLUG?.trim() || "demo",
          }
        : {}),
    });
  }

  return null;
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
        { error: "This token is missing the " + scope + " scope." },
        { status: 403 },
      ),
    } as const;
  }
  return { identity, response: null } as const;
}

export async function requireSessionRole(request: Request, roles: UserRole[]) {
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
  const authorization = await requireIdentity(
    request,
    permissionScope(permission),
  );
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
  permission: AppPermission,
  resource: ResourceRecord,
) {
  if (resource.organizationId !== identity.organizationId) return false;
  // This check deliberately precedes direct and conditional grants.
  if (
    !organizationAllowsPermission(
      identity.organization.isReadOnly,
      permission,
    )
  ) {
    return false;
  }
  if (identity.permissions.includes(permission)) return true;
  if (!identity.role || !isResourceRulePermission(permission)) return false;
  const rules = await listRulesForRole(
    identity.role,
    identity.organizationId,
  );
  return ruleGrantsResourcePermission({
    roleKey: identity.role,
    permission,
    resource,
    rules,
  });
}

export async function requireResourcePermission(
  request: Request,
  permission: AppPermission,
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
        { error: "This token is missing the " + requiredScope + " scope." },
        { status: 403 },
      ),
    } as const;
  }
  const resource =
    typeof resourceOrId === "string"
      ? await getResourceRecord(resourceOrId, identity.organizationId)
      : resourceOrId.organizationId === identity.organizationId
        ? resourceOrId
        : null;
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
