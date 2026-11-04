import { hashApiToken } from "@/lib/api-auth";
import { getAuthProviderConfiguration } from "@/lib/auth-provider-config";
import { authenticateLocalUser } from "@/lib/local-auth";
import { issueNativeSession, NativeAuthError } from "@/lib/native-session";
import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { nativeLoginInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

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
  if (!getAuthProviderConfiguration().passwordEnabled) {
    return Response.json(
      { error: "Password login is disabled for this deployment." },
      { status: 403, headers: noStoreHeaders },
    );
  }

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

  try {
    const session = await issueNativeSession(user, parsed.data.deviceName, parsed.data.organizationId);
    resetRateLimit(accountLimitKey);
    resetRateLimit(pairLimitKey);
    return Response.json(session, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof NativeAuthError) {
      return Response.json({ error: error.message }, { status: error.status, headers: noStoreHeaders });
    }
    throw error;
  }
}
