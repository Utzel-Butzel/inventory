import "server-only";

import { redirect } from "next/navigation";

import { getSessionIdentity } from "@/lib/api-auth";
import type { AppPermission } from "@/lib/access-control-contract";

export async function requireSettingsPermission(permission: AppPermission) {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!identity.permissions.includes(permission)) redirect("/settings/data");
  return identity;
}

export const requireSettingsAdmin = () =>
  requireSettingsPermission("users.manage");
