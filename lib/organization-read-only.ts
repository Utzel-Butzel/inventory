import {
  permissionScope,
  type ApiScope,
  type AppPermission,
} from "@/lib/access-control-contract";

export const PUBLIC_DEMO_ORGANIZATION_ID =
  "d3e00000-0000-4000-8000-000000000001";
export const PUBLIC_DEMO_USER_ID =
  "d3e00000-0000-4000-8000-000000000002";

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

export function organizationAllowsWorkerSideEffects(
  isReadOnly: boolean | null | undefined,
) {
  return isReadOnly === false;
}

export function isPinnedReadOnlyDemoMembershipSet(
  memberships: ReadonlyArray<{
    id: string;
    slug: string;
    isReadOnly: boolean;
    role: string;
  }>,
  expectedSlug: string,
  expectedOrganizationId = PUBLIC_DEMO_ORGANIZATION_ID,
) {
  const [membership] = memberships;
  return (
    memberships.length === 1 &&
    membership?.id === expectedOrganizationId &&
    membership?.slug === expectedSlug.trim().toLowerCase() &&
    membership.isReadOnly === true &&
    membership.role === "viewer"
  );
}
