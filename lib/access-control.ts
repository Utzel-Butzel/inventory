import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  accessRoles,
  apiTokens,
  inventoryAccessRules,
  resources,
  users,
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

export async function getEffectiveRole(roleKey: string) {
  const [role] = await db
    .select()
    .from(accessRoles)
    .where(eq(accessRoles.key, roleKey))
    .limit(1);
  return role ? normalizedRole(role) : builtinRole(roleKey);
}

export async function listAccessRolesWithCounts() {
  const roles = await db.select().from(accessRoles).orderBy(asc(accessRoles.name));
  const members = await db
    .select({ role: users.role, id: users.id })
    .from(users)
    .where(eq(users.isActive, true));
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

export async function getResourceRecord(id: string) {
  const [resource] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, id))
    .limit(1);
  return resource ?? null;
}

export async function getResourceRecords(ids: readonly string[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) return [];
  return db.select().from(resources).where(inArray(resources.id, uniqueIds));
}

export async function listRulesForRole(roleKey: string) {
  return db
    .select()
    .from(inventoryAccessRules)
    .where(
      and(
        eq(inventoryAccessRules.roleKey, roleKey),
        eq(inventoryAccessRules.enabled, true),
      ),
    )
    .orderBy(asc(inventoryAccessRules.priority), asc(inventoryAccessRules.name));
}

export async function conditionalScopesForRole(roleKey: string) {
  const rules = await listRulesForRole(roleKey);
  const permissions = rules.flatMap((rule) =>
    rule.permissions.filter(isResourceRulePermission),
  );
  return scopesForPermissions(permissions);
}

export async function revokeApiTokensForRoles(roleKeys: readonly string[]) {
  const uniqueKeys = Array.from(new Set(roleKeys));
  if (!uniqueKeys.length) return;
  const members = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.role, uniqueKeys));
  if (!members.length) return;
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(inArray(apiTokens.userId, members.map((member) => member.id)));
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
