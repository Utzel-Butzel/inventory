import { desc, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { apiTokens } from "@/db/schema";
import { hashApiToken, requireAdminSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { tokenInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requireAdminSession(request);
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
    .where(isNull(apiTokens.revokedAt))
    .orderBy(desc(apiTokens.createdAt));
  return Response.json({ tokens });
}

export async function POST(request: Request) {
  const authorization = await requireAdminSession(request);
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
