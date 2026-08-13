import type { UserRole } from "@/db/schema";
import {
  builtinRolePermissions,
  scopesForPermissions,
  type ApiScope,
} from "@/lib/access-control-contract";

export type { ApiScope } from "@/lib/access-control-contract";

export const roleScopes: Record<"admin" | "editor" | "viewer", ApiScope[]> = {
  admin: scopesForPermissions(builtinRolePermissions.admin),
  editor: scopesForPermissions(builtinRolePermissions.editor),
  viewer: scopesForPermissions(builtinRolePermissions.viewer),
};

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/.test(value)
  );
}

export function normalizeUserRole(
  value: unknown,
  fallback: UserRole = "viewer",
): UserRole {
  if (isUserRole(value)) return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (isUserRole(candidate)) return candidate;
    }
  }
  return fallback;
}
