import {
  permissionScope,
  type ApiScope,
  type AppPermission,
} from "@/lib/access-control-contract";

export function organizationAllowsPermission(
  isReadOnly: boolean,
  permission: AppPermission,
) {
  return !isReadOnly || permissionScope(permission) === "read";
}

export function restrictOrganizationPermissions(
  permissions: readonly AppPermission[],
  isReadOnly: boolean,
) {
  return isReadOnly
    ? permissions.filter((permission) =>
        organizationAllowsPermission(true, permission),
      )
    : [...permissions];
}

export function restrictOrganizationScopes(
  scopes: readonly ApiScope[],
  isReadOnly: boolean,
): ApiScope[] {
  return isReadOnly ? scopes.filter((scope) => scope === "read") : [...scopes];
}

export function isPinnedReadOnlyDemoMembershipSet(
  memberships: ReadonlyArray<{
    id: string;
    slug: string;
    isReadOnly: boolean;
    role: string;
  }>,
  expectedSlug: string,
) {
  const [membership] = memberships;
  return (
    memberships.length === 1 &&
    membership?.slug === expectedSlug.trim().toLowerCase() &&
    membership.isReadOnly === true &&
    membership.role === "viewer"
  );
}
