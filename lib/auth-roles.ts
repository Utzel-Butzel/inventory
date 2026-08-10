import type { UserRole } from "@/db/schema";

export type ApiScope = "read" | "write" | "ai";

export const roleScopes: Record<UserRole, ApiScope[]> = {
  admin: ["read", "write", "ai"],
  editor: ["read", "write", "ai"],
  viewer: ["read"],
};

export function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "editor" || value === "viewer";
}

export function normalizeUserRole(
  value: unknown,
  fallback: UserRole = "viewer",
): UserRole {
  if (isUserRole(value)) return value;
  if (Array.isArray(value)) {
    if (value.includes("admin")) return "admin";
    if (value.includes("editor")) return "editor";
    if (value.includes("viewer")) return "viewer";
  }
  return fallback;
}
