import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { getActivePublicShare } from "@/lib/public-shares";
import {
  createPublicShareSessionToken,
  isSameOriginRequest,
  publicShareClientAddress,
  publicShareNoStoreHeaders,
  publicShareSessionCookieName,
  publicShareSessionMaxAge,
  verifyPublicSharePassword,
} from "@/lib/public-share-session";

type Context = { params: Promise<{ shareId: string }> };

export const dynamic = "force-dynamic";

const loginSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: "Cross-origin login requests are not allowed." },
      { status: 403, headers: publicShareNoStoreHeaders() },
    );
  }
  const { shareId } = await context.params;
  const share = await getActivePublicShare(shareId);
  if (
    !share ||
    share.accessMode !== "stock" ||
    share.scope !== "inventory" ||
    !share.passwordHash
  ) {
    return Response.json(
      { error: "This stock tool is not available." },
      { status: 404, headers: publicShareNoStoreHeaders() },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Enter the stock-tool password." },
      { status: 400, headers: publicShareNoStoreHeaders() },
    );
  }
  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Enter the stock-tool password." },
      { status: 400, headers: publicShareNoStoreHeaders() },
    );
  }

  const clientKey = `public-share-login:${digest(
    `${shareId}:${publicShareClientAddress(request)}`,
  )}`;
  const limit = checkRateLimit(clientKey, { limit: 12, windowMs: 15 * 60_000 });
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many password attempts. Try again later." },
      {
        status: 429,
        headers: {
          ...publicShareNoStoreHeaders(),
          "Retry-After": String(limit.retryAfterSeconds ?? 1),
        },
      },
    );
  }

  if (!(await verifyPublicSharePassword(share, parsed.data.password))) {
    return Response.json(
      { error: "The password is not correct." },
      { status: 401, headers: publicShareNoStoreHeaders() },
    );
  }

  resetRateLimit(clientKey);
  const response = NextResponse.json(
    { authenticated: true },
    { headers: publicShareNoStoreHeaders() },
  );
  response.cookies.set(
    publicShareSessionCookieName(share.id),
    createPublicShareSessionToken(share.id),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: publicShareSessionMaxAge(),
      path: "/",
    },
  );
  return response;
}

export async function DELETE(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) {
    return new Response(null, {
      status: 403,
      headers: publicShareNoStoreHeaders(),
    });
  }
  const { shareId } = await context.params;
  const response = new NextResponse(null, {
    status: 204,
    headers: publicShareNoStoreHeaders(),
  });
  response.cookies.set(publicShareSessionCookieName(shareId), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
