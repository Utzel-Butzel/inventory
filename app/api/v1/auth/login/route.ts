import { randomBytes } from "node:crypto";

import { apiTokens } from "@/db/schema";
import { hashApiToken } from "@/lib/api-auth";
import { roleScopes } from "@/lib/auth-roles";
import { db } from "@/lib/db";
import { authenticateLocalUser } from "@/lib/local-auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { nativeLoginInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

function nativeTokenLifetimeDays() {
  const configured = Number(process.env.NATIVE_TOKEN_TTL_DAYS ?? "30");
  return Number.isInteger(configured) && configured >= 1 && configured <= 365
    ? configured
    : 30;
}

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    forwarded ||
    "unknown"
  )
    .trim()
    .toLowerCase()
    .slice(0, 128);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid login request." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const parsed = nativeLoginInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid login request." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const addressHash = hashApiToken(clientAddress(request));
  const emailHash = hashApiToken(parsed.data.email);
  const clientLimitKey = `native-login-ip:${addressHash}`;
  const accountLimitKey = `native-login-account:${emailHash}`;
  const pairLimitKey = `native-login-pair:${addressHash}:${emailHash}`;
  const clientLimit = checkRateLimit(clientLimitKey, {
    limit: 40,
    windowMs: 15 * 60_000,
  });
  if (!clientLimit.allowed) {
    return Response.json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: {
          ...noStoreHeaders,
          "Retry-After": String(clientLimit.retryAfterSeconds ?? 1),
        },
      },
    );
  }

  const accountLimit = checkRateLimit(accountLimitKey, {
    limit: 20,
    windowMs: 15 * 60_000,
  });
  if (!accountLimit.allowed) {
    return Response.json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: {
          ...noStoreHeaders,
          "Retry-After": String(accountLimit.retryAfterSeconds ?? 1),
        },
      },
    );
  }

  const pairLimit = checkRateLimit(
    pairLimitKey,
    { limit: 10, windowMs: 15 * 60_000 },
  );
  if (!pairLimit.allowed) {
    return Response.json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: {
          ...noStoreHeaders,
          "Retry-After": String(pairLimit.retryAfterSeconds ?? 1),
        },
      },
    );
  }

  const user = await authenticateLocalUser(
    parsed.data.email,
    parsed.data.password,
  );
  if (!user) {
    return Response.json(
      { error: "Email or password is incorrect." },
      { status: 401, headers: noStoreHeaders },
    );
  }

  resetRateLimit(accountLimitKey);
  resetRateLimit(pairLimitKey);

  const plainToken = `inv_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(
    Date.now() + nativeTokenLifetimeDays() * 24 * 60 * 60_000,
  );
  const scopes = [...roleScopes[user.role]];
  const tokenName = `Inventory · ${parsed.data.deviceName}`;

  await db.insert(apiTokens).values({
    name: tokenName,
    prefix: `${plainToken.slice(0, 12)}…${plainToken.slice(-4)}`,
    tokenHash: hashApiToken(plainToken),
    scopes,
    createdBy: user.email,
    userId: user.id,
    userSessionVersion: user.sessionVersion,
    expiresAt,
  });

  return Response.json(
    {
      token: plainToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      scopes,
      expiresAt: expiresAt.toISOString(),
    },
    { status: 201, headers: noStoreHeaders },
  );
}
