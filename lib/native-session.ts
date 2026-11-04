import "server-only";

import { apiTokens, type UserRecord } from "@/db/schema";
import { getEffectiveRole } from "@/lib/access-control";
import { db, type DatabaseExecutor } from "@/lib/db";
import { nativeHash, nativeSecret } from "@/lib/native-auth-contract";
import { PUBLIC_DEMO_USER_ID } from "@/lib/organization-read-only";
import { listOrganizationsForUser, selectOrganization } from "@/lib/organizations";

export class NativeAuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Both password and browser logins issue the same live, user-bound credential. */
export async function issueNativeSession(
  user: UserRecord,
  deviceName: string,
  organizationId?: string,
  executor: DatabaseExecutor = db,
) {
  if (!user.isActive || user.id === PUBLIC_DEMO_USER_ID) {
    throw new NativeAuthError("This account cannot connect a native app.", 403);
  }
  const organizations = await listOrganizationsForUser(user.id);
  const organization = selectOrganization(organizations, organizationId);
  if (!organization) {
    throw new NativeAuthError(
      organizationId ? "Organization not found." : "This account does not belong to an organization.",
      organizationId ? 404 : 403,
    );
  }
  if (organization.isReadOnly) {
    throw new NativeAuthError("Native API access is disabled for read-only organizations.", 403);
  }
  if (!await getEffectiveRole(organization.role, organization.id)) {
    throw new NativeAuthError("This account is assigned to a role that no longer exists.", 403);
  }
  const configured = Number(process.env.NATIVE_TOKEN_TTL_DAYS ?? "30");
  const days = Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30;
  const token = `inv_${nativeSecret()}`;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000);
  const scopes: Array<"read" | "write" | "ai"> = ["read", "write", "ai"];
  // These are transport scopes; every API call revalidates live user permissions.
  await executor.insert(apiTokens).values({
    name: `Inventory · ${deviceName}`,
    prefix: `${token.slice(0, 12)}…${token.slice(-4)}`,
    tokenHash: nativeHash(token), scopes,
    createdBy: user.email, userId: user.id, userSessionVersion: user.sessionVersion,
    organizationId: organization.id, expiresAt,
  });
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: organization.role },
    scopes, expiresAt: expiresAt.toISOString(), organization, organizations,
  };
}
