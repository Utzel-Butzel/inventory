import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";
import { encode, getToken } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import {
  DEFAULT_SESSION_MAX_AGE,
  REMEMBERED_SESSION_MAX_AGE,
  LOGIN_PREFERENCE_COOKIE,
  withSessionLifetime,
} from "../lib/auth-session.ts";

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { NextRequest } = await import("next/server.js");
const require = createRequire(import.meta.url);
const { Auth } = await import(require.resolve("@auth/core", {
  paths: [require.resolve("next-auth")],
}));
const secret = "test-only-secret-for-inventory-session-lifetime";
const origin = "https://inventory.example";
const cookieName = "__Secure-authjs.session-token";
const base = {
  secret,
  trustHost: true,
  basePath: "/api/auth",
  providers: [Credentials({
    authorize: async (credentials) => credentials.password === "correct"
      ? { id: "test-user", name: "Test User" }
      : null,
  })],
  session: { strategy: "jwt", maxAge: DEFAULT_SESSION_MAX_AGE },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.authProvider = "local";
      return token;
    },
  },
  logger: { error() {}, warn() {}, debug() {} },
};

function request(action, cookie = "", body) {
  return new NextRequest(`${origin}/api/auth/${action}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(body ? { body: new URLSearchParams(body) } : {}),
  });
}

async function handle(req) {
  return Auth(req, await withSessionLifetime(base, req));
}

function responseCookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function signIn(rememberMe, password = "correct", existing = "") {
  const csrf = await handle(request("csrf"));
  const { csrfToken } = await csrf.json();
  const cookie = [existing, responseCookies(csrf)].filter(Boolean).join("; ");
  const response = await handle(request("callback/credentials", cookie, {
    csrfToken, password, ...(rememberMe === undefined ? {} : { rememberMe }),
  }));
  return { response, cookie: `${cookie}; ${responseCookies(response)}`, csrfToken };
}

async function readToken(cookie) {
  return getToken({ req: { headers: new Headers({ cookie }) }, secret, secureCookie: true });
}

function assertExpiry(response, maxAge) {
  const sessionCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${cookieName}=`));
  assert.ok(sessionCookie);
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /SameSite=Lax/i);
  const expires = new Date(sessionCookie.match(/Expires=([^;]+)/i)[1]).getTime();
  assert.ok(Math.abs(expires - Date.now() - maxAge * 1000) < 2000);
}

for (const [choice, age] of [
  ["true", REMEMBERED_SESSION_MAX_AGE],
  ["false", DEFAULT_SESSION_MAX_AGE],
  [undefined, DEFAULT_SESSION_MAX_AGE],
  ["on", DEFAULT_SESSION_MAX_AGE],
]) {
  test(`credentials choice ${choice}: matching JWT and cookie expiry on login and renewal`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T12:00:00Z") });
    const login = await signIn(choice);
    assert.equal(login.response.status, 302);
    const token = await readToken(responseCookies(login.response));
    assert.equal(token.rememberMe, choice === "true");
    assert.equal(token.exp - token.iat, age);
    assertExpiry(login.response, age);

    // A reopened browser sends only its persistent cookies. No preference cookie is needed.
    t.mock.timers.tick(60 * 60 * 1000);
    const renewed = await handle(request("session", responseCookies(login.response)));
    const session = await renewed.json();
    assert.equal(session.user.name, "Test User");
    assertExpiry(renewed, age);
    const renewedToken = await readToken(responseCookies(renewed));
    assert.equal(renewedToken.exp - renewedToken.iat, age);
    assert.ok(renewedToken.exp > token.exp);
  });
}

test("remembered sessions survive the former twelve-hour limit", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T12:00:00Z") });
  const login = await signIn("true");
  t.mock.timers.tick(30 * 24 * 60 * 60 * 1000);
  const response = await handle(request("session", responseCookies(login.response)));
  assert.equal((await response.json()).user.name, "Test User");
  assertExpiry(response, REMEMBERED_SESSION_MAX_AGE);
});

test("expired sessions cannot be revived by a preference cookie", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-31T12:00:00Z") });
  const login = await signIn("false");
  t.mock.timers.tick((DEFAULT_SESSION_MAX_AGE + 60) * 1000);
  const response = await handle(request("session", `${responseCookies(login.response)}; ${LOGIN_PREFERENCE_COOKIE}=true`));
  assert.equal(await response.json(), null);
  assert.match(response.headers.getSetCookie().join(";"), /Max-Age=0/i);
});

test("legacy sessions stay short, and a plain preference cannot extend them", async () => {
  const token = await encode({ secret, salt: cookieName, token: { name: "Legacy" }, maxAge: DEFAULT_SESSION_MAX_AGE });
  const response = await handle(request("session", `${cookieName}=${token}; ${LOGIN_PREFERENCE_COOKIE}=true`));
  assert.equal((await response.json()).user.name, "Legacy");
  assertExpiry(response, DEFAULT_SESSION_MAX_AGE);
});

test("unchecked sign-in replaces an existing remembered session with a short one", async () => {
  const remembered = await signIn("true");
  const short = await signIn("false", "correct", responseCookies(remembered.response));
  assert.equal((await readToken(responseCookies(short.response))).rememberMe, false);
  assertExpiry(short.response, DEFAULT_SESSION_MAX_AGE);
});

test("failed authentication never issues a remembered session", async () => {
  const login = await signIn("true", "incorrect");
  assert.equal(await readToken(responseCookies(login.response)), null);
});

test("signing out deletes a remembered session cookie", async () => {
  const login = await signIn("true");
  const response = await handle(request("signout", login.cookie, { csrfToken: login.csrfToken }));
  assert.match(response.headers.getSetCookie().join(";"), /__Secure-authjs.session-token=;.*Max-Age=0/i);
});

test("external sign-in records the pending choice; demo sign-in stays short", async () => {
  for (const provider of ["auth0", "oidc", "demo"]) {
    const config = await withSessionLifetime(base, request(`callback/${provider}`, `${LOGIN_PREFERENCE_COOKIE}=true`));
    const token = await config.callbacks.jwt({ token: {}, user: { id: "external" }, account: { provider } });
    assert.equal(token.rememberMe, provider !== "demo");
    assert.equal(config.session.maxAge, provider === "demo" ? DEFAULT_SESSION_MAX_AGE : REMEMBERED_SESSION_MAX_AGE);
  }
});

test("session updates cannot escalate the encrypted remember-me claim", async () => {
  const login = await signIn("false");
  const config = await withSessionLifetime(base, request("session", responseCookies(login.response)));
  const token = await config.callbacks.jwt({
    token: await readToken(responseCookies(login.response)),
    trigger: "update", session: { rememberMe: true },
  });
  assert.equal(token.rememberMe, false);
  assert.equal(config.session.maxAge, DEFAULT_SESSION_MAX_AGE);
});
