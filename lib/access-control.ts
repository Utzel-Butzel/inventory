import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  accessRoles,
  inventoryAccessRules,
  organizationMemberships,
  resources,
  type AccessRoleRecord,
  type InventoryAccessRuleRecord,
  type ResourceRecord,
} from "@/db/schema";
import {
  builtinRolePermissions,
  isAppPermission,
  isResourceRulePermission,
  permissionsForScopes,
  rulesGrantPermission,
  scopesForPermissions,
  type AppPermission,
  type ResourceRulePermission,
} from "@/lib/access-control-contract";
import { db } from "@/lib/db";
import {
  listResourceSlugRows,
  resolveResourceId,
} from "@/lib/resource-slugs";

export type EffectiveRole = Pick<
  AccessRoleRecord,
  "key" | "name" | "description" | "isSystem"
> & {
  permissions: AppPermission[];
};

const builtinRole = (key: string): EffectiveRole | null => {
  if (key !== "admin" && key !== "editor" && key !== "viewer") return null;
  return {
    key,
    name: key[0]?.toUpperCase() + key.slice(1),
    description: "",
    isSystem: true,
    permissions: [...builtinRolePermissions[key]],
  };
};

function normalizedRole(role: AccessRoleRecord): EffectiveRole {
  return {
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.filter(isAppPermission),
  };
}

export async function getEffectiveRole(
  roleKey: string,
  organizationId: string,
) {
  const [role] = await db
    .select()
    .from(accessRoles)
    .where(
      and(
        eq(accessRoles.organizationId, organizationId),
        eq(accessRoles.key, roleKey),
      ),
    )
    .limit(1);
  return role ? normalizedRole(role) : builtinRole(roleKey);
}

export async function listAccessRolesWithCounts(
  organizationId: string,
) {
  const roles = await db
    .select()
    .from(accessRoles)
    .where(eq(accessRoles.organizationId, organizationId))
    .orderBy(asc(accessRoles.name));
  const members = await db
    .select({ role: organizationMemberships.roleKey, id: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.isActive, true),
      ),
    );
  const counts = new Map<string, number>();
  for (const member of members) {
    counts.set(member.role, (counts.get(member.role) ?? 0) + 1);
  }
  return roles.map((role) => ({
    ...normalizedRole(role),
    memberCount: counts.get(role.key) ?? 0,
  }));
}

export function roleScopesForPermissions(permissions: readonly AppPermission[]) {
  return scopesForPermissions(permissions);
}

export function permissionsForStandaloneTokenScopes(scopes: readonly ("read" | "write" | "ai")[]) {
  return permissionsForScopes(scopes);
}

export async function getResourceRecord(
  id: string,
  organizationId: string,
) {
  const [resource] = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        eq(resources.id, id),
      ),
    )
    .limit(1);
  return resource ?? null;
}

export async function getResourceRecordByReference(
  reference: string,
  organizationId: string,
) {
  const resourceId = await resolveResourceId(organizationId, reference);
  if (!resourceId) return null;
  const [resource, slugRows] = await Promise.all([
    getResourceRecord(resourceId, organizationId),
    listResourceSlugRows(organizationId, [resourceId]),
  ]);
  return resource
    ? { ...resource, slugs: slugRows.map((row) => row.slug) }
    : null;
}

export async function getResourceRecords(
  ids: readonly string[],
  organizationId: string,
) {
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) return [];
  return db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.organizationId, organizationId),
        inArray(resources.id, uniqueIds),
      ),
    );
}

export async function listRulesForRole(
  roleKey: string,
  organizationId: string,
) {
  return db
    .select()
    .from(inventoryAccessRules)
    .where(
      and(
        eq(inventoryAccessRules.organizationId, organizationId),
        eq(inventoryAccessRules.roleKey, roleKey),
        eq(inventoryAccessRules.enabled, true),
      ),
    )
    .orderBy(asc(inventoryAccessRules.priority), asc(inventoryAccessRules.name));
}

export async function conditionalScopesForRole(
  roleKey: string,
  organizationId: string,
) {
  const rules = await listRulesForRole(roleKey, organizationId);
  const permissions = rules.flatMap((rule) =>
    rule.permissions.filter(isResourceRulePermission),
  );
  return scopesForPermissions(permissions);
}

export async function revokeApiTokensForRoles(
  roleKeys: readonly string[],
  organizationId: string,
) {
  // User-bound tokens are account-owned and can select any live membership.
  // Authorization is recomputed from the current organization role/rules on
  // every request, so tenant policy changes do not require token revocation.
  // Standalone tokens have no role membership and are unaffected here.
  void roleKeys;
  void organizationId;
}

export function ruleGrantsResourcePermission(options: {
  roleKey: string;
  permission: ResourceRulePermission;
  resource: ResourceRecord;
  rules: readonly InventoryAccessRuleRecord[];
}) {
  return rulesGrantPermission({
    roleKey: options.roleKey,
    permission: options.permission,
    resource: options.resource,
    rules: options.rules.map((rule) => ({
      roleKey: rule.roleKey,
      permissions: rule.permissions.filter(isResourceRulePermission),
      conditions: rule.conditions,
      enabled: rule.enabled,
    })),
  });
}
