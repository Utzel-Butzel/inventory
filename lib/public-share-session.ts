import "server-only";

import { compare } from "bcryptjs";
import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type { PublicShareRecord } from "@/db/schema";
import { getActivePublicShare, publicShareAllowsResource } from "@/lib/public-shares";

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const invalidPasswordHash =
  "$2b$12$b72wh6gSHWSo86C55dE9ru8PkOxR5dELMTwsOEQ8XApwiuWCejrna";

type ShareSessionPayload = {
  version: 1;
  shareId: string;
  expiresAt: number;
};

function sessionSecret() {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET must contain at least 32 characters for public share sessions.",
    );
  }
  return "inventory-development-public-share-session-secret";
}

function signature(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function signaturesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function publicShareSessionCookieName(shareId: string) {
  return `inventory-share-${shareId}`;
}

export function createPublicShareSessionToken(shareId: string) {
  const payload: ShareSessionPayload = {
    version: 1,
    shareId,
    expiresAt: Math.floor(Date.now() / 1_000) + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

function readSessionPayload(token: string | undefined) {
  if (!token) return null;
  const [encoded, receivedSignature, extra] = token.split(".");
  if (!encoded || !receivedSignature || extra) return null;
  if (!signaturesMatch(signature(encoded), receivedSignature)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<ShareSessionPayload>;
    if (
      payload.version !== 1 ||
      typeof payload.shareId !== "string" ||
      typeof payload.expiresAt !== "number" ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      return null;
    }
    return payload as ShareSessionPayload;
  } catch {
    return null;
  }
}

export function publicShareSessionIsValid(
  share: PublicShareRecord,
  token: string | undefined,
) {
  if (
    share.accessMode !== "stock" ||
    share.scope !== "inventory" ||
    !share.passwordHash ||
    share.revokedAt
  ) {
    return false;
  }
  return readSessionPayload(token)?.shareId === share.id;
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(entry.slice(separator + 1).trim());
  }
  return undefined;
}

export function publicShareSessionTokenFromRequest(
  request: Request,
  shareId: string,
) {
  return cookieValue(request, publicShareSessionCookieName(shareId));
}

export async function verifyPublicSharePassword(
  share: PublicShareRecord,
  password: string,
) {
  try {
    return await compare(password, share.passwordHash || invalidPasswordHash);
  } catch {
    await compare(password, invalidPasswordHash);
    return false;
  }
}

export function publicShareSessionMaxAge() {
  return SESSION_TTL_SECONDS;
}

export function publicShareClientAddress(request: Request) {
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

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function requirePublicStockShare(
  request: Request,
  shareId: string,
  resourceId?: string,
) {
  const share = await getActivePublicShare(shareId);
  if (
    !share ||
    !publicShareSessionIsValid(
      share,
      publicShareSessionTokenFromRequest(request, shareId),
    )
  ) {
    return {
      share: null,
      response: Response.json(
        { error: "This stock-tool session is not authorized." },
        { status: 401, headers: noStoreHeaders },
      ),
    } as const;
  }
  if (resourceId && !(await publicShareAllowsResource(share, resourceId))) {
    return {
      share: null,
      response: Response.json(
        { error: "Inventory item not found." },
        { status: 404, headers: noStoreHeaders },
      ),
    } as const;
  }
  return { share, response: null } as const;
}

export function publicShareNoStoreHeaders() {
  return noStoreHeaders;
}
