import "server-only";

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getPublicAuthOptions } from "@/lib/auth-provider-config";
import { nativeAuthRequests, users } from "@/db/schema";
import { getSessionIdentity } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  equalNativeSecret, nativeBrowserCookie, nativeCallback, nativeChallenge,
  nativeExchangeSchema, nativeHash, nativeSecret, nativeSecretSchema,
  nativeStartSchema, NATIVE_AUTH_TTL_MS, NATIVE_CODE_TTL_MS,
} from "@/lib/native-auth-contract";
import { issueNativeSession, NativeAuthError } from "@/lib/native-session";
import { PUBLIC_DEMO_USER_ID } from "@/lib/organization-read-only";
import { checkRateLimit } from "@/lib/rate-limit";
import { getT } from "@/lib/ui-i18n/server";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' de.polyxo.openinventory:; frame-ancestors 'none'; base-uri 'none'",
};
const basePath = "/api/v1/auth/browser";

function origin(request: Request) {
  const url = new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? request.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new NativeAuthError("Browser sign-in requires HTTPS.", 400);
  }
  return url.origin;
}

function rateLimit(request: Request, operation: string) {
  const address = (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 128);
  const result = checkRateLimit(`native-browser:${operation}:${nativeHash(address)}`, { limit: 40, windowMs: 15 * 60_000 });
  if (!result.allowed) throw new NativeAuthError("Too many sign-in attempts. Try again later.", 429);
}

async function readBoundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new NativeAuthError("Invalid request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new NativeAuthError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJSON(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new NativeAuthError("Expected JSON.");
  }
  const text = await readBoundedBody(request);
  try { return JSON.parse(text) as unknown; }
  catch { throw new NativeAuthError("Invalid request."); }
}

export async function nativeBrowserRoute(handler: () => Promise<Response>) {
  try { return await handler(); }
  catch (error) {
    return Response.json(
      { error: error instanceof NativeAuthError ? error.message : "Browser sign-in is currently unavailable. Please try again later." },
      { status: error instanceof NativeAuthError ? error.status : 503, headers: responseHeaders },
    );
  }
}

export async function startNativeBrowserLogin(request: Request) {
  rateLimit(request, "start");
  if (!getPublicAuthOptions().browserSignIn) {
    throw new NativeAuthError("SSO is not configured on this server.", 403);
  }
  const parsed = nativeStartSchema.safeParse(await readJSON(request));
  if (!parsed.success) throw new NativeAuthError("Invalid sign-in request.");
  const serverOrigin = origin(request);
  const requestId = nativeSecret();
  const expiresAt = new Date(Date.now() + NATIVE_AUTH_TTL_MS);
  await db.delete(nativeAuthRequests).where(lt(nativeAuthRequests.expiresAt, new Date()));
  await db.insert(nativeAuthRequests).values({
    requestHash: nativeHash(requestId), origin: serverOrigin,
    codeChallenge: parsed.data.codeChallenge, state: parsed.data.state,
    deviceName: parsed.data.deviceName, expiresAt,
  });
  return Response.json({ requestId, expiresAt: expiresAt.toISOString() }, { status: 201, headers: responseHeaders });
}

async function pendingRequest(request: Request, id: string) {
  if (!nativeSecretSchema.safeParse(id).success) throw new NativeAuthError("Invalid sign-in request.");
  const [pending] = await db.select().from(nativeAuthRequests).where(and(
    eq(nativeAuthRequests.requestHash, nativeHash(id)),
    eq(nativeAuthRequests.origin, origin(request)),
    gt(nativeAuthRequests.expiresAt, new Date()),
    isNull(nativeAuthRequests.codeHash),
  )).limit(1);
  if (!pending) throw new NativeAuthError("This sign-in request has expired. Start again in the app.", 410);
  return pending;
}

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function authorizeNativeBrowserLogin(request: Request) {
  rateLimit(request, "authorize");
  const id = new URL(request.url).searchParams.get("request") ?? "";
  const pending = await pendingRequest(request, id);
  const secure = origin(request).startsWith("https:");
  const cookieName = nativeBrowserCookie(id, secure);
  const cookieStore = await cookies();
  let binding = cookieStore.get(cookieName)?.value;
  if (!pending.browserBindingHash) {
    binding = nativeSecret();
    const bound = await db.update(nativeAuthRequests).set({ browserBindingHash: nativeHash(binding) })
      .where(and(eq(nativeAuthRequests.requestHash, pending.requestHash), isNull(nativeAuthRequests.browserBindingHash)))
      .returning({ id: nativeAuthRequests.requestHash });
    if (!bound.length) throw new NativeAuthError("Start sign-in again in the app.", 409);
    cookieStore.set(cookieName, binding, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: NATIVE_AUTH_TTL_MS / 1000 });
  } else if (!binding || !equalNativeSecret(nativeHash(binding), pending.browserBindingHash)) {
    throw new NativeAuthError("Start sign-in again in the app.", 403);
  }

  const identity = await getSessionIdentity();
  if (!identity) {
    if ((await auth())?.user) throw new NativeAuthError("Inventory access has not been enabled for this account. Contact your administrator.", 403);
    const callback = `${basePath}/authorize?request=${encodeURIComponent(id)}`;
    return new Response(null, { status: 303, headers: { ...responseHeaders, Location: `/login?callbackUrl=${encodeURIComponent(callback)}` } });
  }
  if (!identity.userId || identity.userId === PUBLIC_DEMO_USER_ID || identity.organization.isReadOnly) {
    throw new NativeAuthError("This account cannot connect a native app.", 403);
  }
  const { t, lng } = await getT("auth");
  const text = (key: string) => escapeHTML(t(`native.${key}`));
  const html = `<!doctype html><html lang="${escapeHTML(lng)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${text("title")}</title>
<style>body{margin:0;background:#f4f6f8;color:#18212b;font:17px system-ui,sans-serif}main{box-sizing:border-box;max-width:440px;margin:12vh auto;padding:28px;background:white;border-radius:20px}h1{font-size:26px}p{line-height:1.5;overflow-wrap:anywhere}small{color:#52606d}button{width:100%;padding:14px;margin-top:12px;border-radius:10px;border:1px solid #ccd3da;font:inherit;background:white}button[value=allow]{background:#176849;color:white;border-color:#176849}</style></head><body><main>
<h1>${text("title")}</h1><p>${text("description")}</p>
<p><strong>${escapeHTML(identity.subject)}</strong><br>${escapeHTML(identity.organization.name)}<br><small>${escapeHTML(origin(request))}</small></p>
<p>${text("device")}: ${escapeHTML(pending.deviceName)}</p>
<form method="post" action="${basePath}/complete"><input type="hidden" name="requestId" value="${escapeHTML(id)}"><input type="hidden" name="csrf" value="${escapeHTML(binding!)}"><input type="hidden" name="organizationId" value="${escapeHTML(identity.organizationId)}"><input type="hidden" name="userId" value="${escapeHTML(identity.userId)}">
<button type="submit" name="decision" value="allow">${text("allow")}</button><button type="submit" name="decision" value="deny">${text("cancel")}</button></form>
<p><small>${text("hint")}</small></p></main></body></html>`;
  return new Response(html, { headers: { ...responseHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

export async function completeNativeBrowserLogin(request: Request) {
  rateLimit(request, "complete");
  if (request.headers.get("origin") !== origin(request)) throw new NativeAuthError("Invalid sign-in origin.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    throw new NativeAuthError("Invalid confirmation format.");
  }
  const form = new URLSearchParams(await readBoundedBody(request));
  const id = String(form.get("requestId") ?? "");
  const pending = await pendingRequest(request, id);
  const cookieStore = await cookies();
  const cookieName = nativeBrowserCookie(id, origin(request).startsWith("https:"));
  const binding = cookieStore.get(cookieName)?.value;
  if (!binding || !pending.browserBindingHash ||
      !equalNativeSecret(String(form.get("csrf") ?? ""), binding) ||
      !equalNativeSecret(nativeHash(binding), pending.browserBindingHash)) {
    throw new NativeAuthError("Invalid sign-in confirmation.", 403);
  }
  if (form.get("decision") === "deny") {
    await db.delete(nativeAuthRequests).where(eq(nativeAuthRequests.requestHash, pending.requestHash));
    cookieStore.delete(cookieName);
    return new Response(null, { status: 303, headers: { ...responseHeaders, Location: nativeCallback(pending.state, { error: "access_denied" }) } });
  }
  if (form.get("decision") !== "allow") throw new NativeAuthError("Invalid sign-in confirmation.");
  const organizationId = String(form.get("organizationId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new NativeAuthError("Invalid organization.");
  const identity = await getSessionIdentity(organizationId);
  if (!identity?.userId || identity.userId !== form.get("userId") || identity.userId === PUBLIC_DEMO_USER_ID ||
      identity.organization.isReadOnly || identity.organizationId !== organizationId) {
    throw new NativeAuthError("This account cannot connect a native app.", 403);
  }
  const [user] = await db.select().from(users).where(and(eq(users.id, identity.userId), eq(users.isActive, true))).limit(1);
  if (!user) throw new NativeAuthError("This account is unavailable.", 403);
  const code = nativeSecret();
  const approved = await db.update(nativeAuthRequests).set({
    codeHash: nativeHash(code), userId: user.id, userSessionVersion: user.sessionVersion,
    organizationId, expiresAt: new Date(Date.now() + NATIVE_CODE_TTL_MS),
  }).where(and(
    eq(nativeAuthRequests.requestHash, pending.requestHash),
    eq(nativeAuthRequests.browserBindingHash, nativeHash(binding)),
    isNull(nativeAuthRequests.codeHash), gt(nativeAuthRequests.expiresAt, new Date()),
  )).returning({ id: nativeAuthRequests.requestHash });
  if (!approved.length) throw new NativeAuthError("This sign-in request has already been used.", 409);
  cookieStore.delete(cookieName);
  return new Response(null, { status: 303, headers: { ...responseHeaders, Location: nativeCallback(pending.state, { code }) } });
}

export async function exchangeNativeBrowserLogin(request: Request) {
  rateLimit(request, "exchange");
  const parsed = nativeExchangeSchema.safeParse(await readJSON(request));
  if (!parsed.success) throw new NativeAuthError("Invalid sign-in code.");
  const input = parsed.data;
  const result = await db.transaction(async (transaction) => {
    // DELETE ... RETURNING consumes the code atomically across server workers.
    // A wrong verifier cannot consume a legitimate caller's grant.
    const [grant] = await transaction.delete(nativeAuthRequests).where(and(
      eq(nativeAuthRequests.requestHash, nativeHash(input.requestId)),
      eq(nativeAuthRequests.codeHash, nativeHash(input.code)),
      eq(nativeAuthRequests.codeChallenge, nativeChallenge(input.codeVerifier)),
      eq(nativeAuthRequests.origin, origin(request)),
      gt(nativeAuthRequests.expiresAt, new Date()),
    )).returning();
    if (!grant?.userId || !grant.organizationId) throw new NativeAuthError("Invalid or expired sign-in code.", 401);
    const [user] = await transaction.select().from(users).where(and(
      eq(users.id, grant.userId), eq(users.isActive, true),
    )).limit(1).for("update");
    if (!user || user.sessionVersion !== grant.userSessionVersion) throw new NativeAuthError("This session is no longer valid.", 401);
    return issueNativeSession(user, grant.deviceName, grant.organizationId, transaction);
  });
  return Response.json(result, { status: 201, headers: responseHeaders });
}
