import { and, desc, eq, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { apiTokens } from "@/db/schema";
import { hashApiToken, requireSessionPermission } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { tokenInputSchema } from "@/lib/validators";
import { permissionsForScopes } from "@/lib/access-control-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireSessionPermission(request, "tokens.manage");
  if (authorization.response) return authorization.response;
  const tokens = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.organizationId, authorization.identity.organizationId),
        isNull(apiTokens.userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .orderBy(desc(apiTokens.createdAt));
  return Response.json({ tokens });
}

export async function POST(request: Request) {
  const authorization = await requireSessionPermission(request, "tokens.manage");
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = tokenInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid token settings.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const delegatedPermissions = permissionsForScopes(parsed.data.scopes);
  if (
    !authorization.identity.permissions.includes("tokens.delegate") &&
    delegatedPermissions.some(
      (permission) => !authorization.identity.permissions.includes(permission),
    )
  ) {
    return Response.json(
      { error: "You cannot create a token with access your role does not have." },
      { status: 403 },
    );
  }
  const plainToken = `inv_${randomBytes(32).toString("base64url")}`;
  const prefix = `${plainToken.slice(0, 12)}…${plainToken.slice(-4)}`;
  const [token] = await db
    .insert(apiTokens)
    .values({
      name: parsed.data.name,
      prefix,
      tokenHash: hashApiToken(plainToken),
      scopes: parsed.data.scopes,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      createdBy: authorization.identity.subject,
      organizationId: authorization.identity.organizationId,
    })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
    });
  return Response.json({ token, secret: plainToken }, { status: 201 });
}
