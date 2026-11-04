import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.ts";
import { nativeSecret, nativeChallenge, nativeHash, nativeBrowserCookie } from "../lib/native-auth-contract.ts";

// A disposable database only; never read application credentials or .env files.
const databaseURL = process.env.NATIVE_AUTH_TEST_DATABASE_URL;
test("browser SSO handoff uses real atomic PostgreSQL grants", { skip: !databaseURL }, async (t) => {
  const namespace = `native_auth_${randomUUID().replaceAll("-", "")}`;
  const sql = postgres(databaseURL, { max: 8, connection: { search_path: namespace } });
  const db = drizzle(sql, { schema });
  const userId = randomUUID(), orgId = randomUUID();
  const originalAuthURL = process.env.AUTH_URL;
  process.env.AUTH_URL = "https://inventory.test";
  await sql.unsafe(`CREATE SCHEMA ${namespace}`);
  t.after(async () => {
    await sql.unsafe(`DROP SCHEMA ${namespace} CASCADE`);
    await sql.end();
    if (originalAuthURL === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = originalAuthURL;
  });
  await sql.unsafe(`
    CREATE TABLE users (
      id uuid PRIMARY KEY, email text NOT NULL, name text NOT NULL, password_hash text NOT NULL,
      role text DEFAULT 'viewer', is_active boolean DEFAULT true, session_version integer DEFAULT 1,
      inventory_page_size integer DEFAULT 50, developer_mode boolean DEFAULT false,
      last_login_at timestamptz, password_updated_at timestamptz DEFAULT now(),
      created_by text, updated_by text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE api_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
      name text, prefix text, token_hash text UNIQUE, scopes text[], created_by text,
      user_id uuid REFERENCES users(id), user_session_version integer, expires_at timestamptz,
      last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz DEFAULT now()
    );
  `);
  await sql.unsafe(await readFile(new URL("../db/migrations/0080_native_browser_auth.sql", import.meta.url), "utf8"));
  await sql`INSERT INTO users (id,email,name,password_hash) VALUES (${userId},'member@example.test','Member','unused')`;
  await sql`INSERT INTO organizations (id) VALUES (${orgId})`;

  let identity, session, memberships, hasRole, passwordEnabled, browserSignIn, index = 0;
  const jar = new Map();
  const organization = { id: orgId, name: "Konglomerat", slug: "konglomerat", role: "viewer", isReadOnly: false };
  const member = () => ({ kind: "session", userId, subject: "member@example.test", organizationId: orgId, organization });
  mock.module("../lib/db.ts", { namedExports: { db } });
  mock.module("../auth.ts", { namedExports: { auth: async () => session } });
  mock.module("../lib/api-auth.ts", { namedExports: { getSessionIdentity: async (org) => !org || org === orgId ? identity : null, hashApiToken: nativeHash } });
  mock.module("next/headers", { namedExports: { cookies: async () => ({
    get: (name) => jar.has(name) ? { value: jar.get(name) } : undefined,
    set: (name, value, options) => { assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.sameSite, "lax"); jar.set(name, value); },
    delete: (name) => jar.delete(name),
  }) } });
  mock.module("../lib/access-control.ts", { namedExports: { getEffectiveRole: async () => hasRole ? { key: "viewer" } : null } });
  mock.module("../lib/organizations.ts", { namedExports: {
    listOrganizationsForUser: async () => memberships,
    selectOrganization: (list, id) => id ? list.find((org) => org.id === id) : list[0],
  } });
  mock.module("../lib/auth-provider-config.ts", { namedExports: { getAuthProviderConfiguration: () => ({ passwordEnabled }), getPublicAuthOptions: () => ({ passwordEnabled, browserSignIn, providers: browserSignIn ? [{ id: "supabase", name: "Konglomerat" }] : [] }) } });
  mock.module("../lib/local-auth.ts", { namedExports: { authenticateLocalUser: async (email, password) => {
    if (email !== "member@example.test" || password !== "correct") return null;
    return (await db.select().from(schema.users))[0];
  } } });
  mock.module("../lib/ui-i18n/server.ts", { namedExports: { getT: async () => ({ t: (key) => key, lng: "en" }) } });
  const optionsRoute = await import("../app/api/v1/auth/options/route.ts");
  const passwordRoute = await import("../app/api/v1/auth/login/route.ts");
  const routes = {};
  for (const name of ["start", "authorize", "complete", "exchange"]) {
    routes[name] = await import(`../app/api/v1/auth/browser/${name}/route.ts`);
  }
  t.beforeEach(async () => {
    identity = member(); session = { user: { email: identity.subject } };
    memberships = [{ ...organization }]; hasRole = true; passwordEnabled = true; browserSignIn = true; jar.clear(); index++;
    await sql`DELETE FROM native_auth_requests`;
    await sql`DELETE FROM api_tokens`;
    await sql`UPDATE users SET is_active=true, session_version=1 WHERE id=${userId}`;
  });
  function request(path, payload, { method = "POST", form = false, origin = "https://inventory.test" } = {}) {
    return new Request(`https://inventory.test/api/v1/auth/browser/${path}`, {
      method,
      headers: { "x-real-ip": `192.0.2.${index}`, ...(method === "POST" ? {
        "content-type": form ? "application/x-www-form-urlencoded" : "application/json", origin,
      } : {}) },
      ...(payload ? { body: form ? new URLSearchParams(payload).toString() : JSON.stringify(payload) } : {}),
    });
  }
  async function start() {
    const verifier = nativeSecret(), state = nativeSecret();
    const response = await routes.start.POST(request("start", { codeChallenge: nativeChallenge(verifier), codeChallengeMethod: "S256", state, deviceName: "Test iPhone" }));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { ...(await response.json()), verifier, state };
  }
  const authorize = (flow) => routes.authorize.GET(request(`authorize?request=${flow.requestId}`, undefined, { method: "GET" }));
  const form = (flow) => ({ requestId: flow.requestId, csrf: jar.get(nativeBrowserCookie(flow.requestId, true)), organizationId: orgId, userId, decision: "allow" });
  const complete = (flow, overrides = {}, options = {}) => routes.complete.POST(request("complete", { ...form(flow), ...overrides }, { form: true, ...options }));
  async function grant() {
    const flow = await start();
    assert.equal((await authorize(flow)).status, 200);
    const response = await complete(flow);
    assert.equal(response.status, 303);
    const callback = new URL(response.headers.get("location"));
    assert.equal(callback.searchParams.get("state"), flow.state);
    assert.equal(callback.protocol, "de.polyxo.openinventory:");
    return { ...flow, code: callback.searchParams.get("code") };
  }
  const exchange = (flow, overrides = {}) => routes.exchange.POST(request("exchange", {
    requestId: flow.requestId, code: flow.code, codeVerifier: flow.verifier, ...overrides,
  }));
  const tokens = () => sql`SELECT * FROM api_tokens`;

  await t.test("provider discovery reflects this deployment and disables unconfigured handoffs", async () => {
    const options = await optionsRoute.GET();
    assert.equal(options.headers.get("cache-control"), "no-store");
    assert.deepEqual(await options.json(), { passwordEnabled: true, browserSignIn: true, providers: [{ id: "supabase", name: "Konglomerat" }] });
    browserSignIn = false;
    assert.deepEqual(await (await optionsRoute.GET()).json(), { passwordEnabled: true, browserSignIn: false, providers: [] });
    const response = await routes.start.POST(request("start", { codeChallenge: nativeChallenge(nativeSecret()), codeChallengeMethod: "S256", state: nativeSecret(), deviceName: "Android" }));
    assert.equal(response.status, 403);
    assert.equal((await sql`SELECT * FROM native_auth_requests`).length, 0);
  });
  await t.test("existing web login and explicit consent issue a user-bound native credential", async () => {
    const flow = await grant();
    const [row] = await sql`SELECT * FROM native_auth_requests`;
    assert.equal(row.code_hash, nativeHash(flow.code));
    assert.equal(row.code_challenge, nativeChallenge(flow.verifier));
    assert.ok(!JSON.stringify(row).includes(flow.code));
    assert.equal((await tokens()).length, 0);
    const response = await exchange(flow);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.user.email, "member@example.test");
    assert.equal(result.organization.id, orgId);
    const [token] = await tokens();
    assert.equal(token.token_hash, nativeHash(result.token));
    assert.equal(token.user_id, userId);
    assert.equal(token.user_session_version, 1);
    assert.ok(new Date(token.expires_at) > new Date());
    assert.equal((await sql`SELECT * FROM native_auth_requests`).length, 0);
  });
  await t.test("signed-out browser returns through existing PWA login", async () => {
    identity = null; session = null;
    const flow = await start();
    const response = await authorize(flow);
    assert.equal(response.status, 303);
    const url = new URL(response.headers.get("location"), "https://inventory.test");
    assert.equal(url.pathname, "/login");
    assert.equal(url.searchParams.get("callbackUrl"), `/api/v1/auth/browser/authorize?request=${flow.requestId}`);
    identity = member(); session = { user: {} };
    assert.equal((await authorize(flow)).status, 200);
  });
  await t.test("a second browser cannot reuse an already bound request", async () => {
    const flow = await start(); await authorize(flow); jar.clear();
    assert.equal((await authorize(flow)).status, 403);
  });
  await t.test("CSRF, cross-origin confirmation and swapped identity cannot approve", async () => {
    const flow = await start(); await authorize(flow);
    assert.equal((await complete(flow, { csrf: nativeSecret() })).status, 403);
    assert.equal((await complete(flow, {}, { origin: "https://evil.test" })).status, 403);
    assert.equal((await complete(flow, { userId: randomUUID() })).status, 403);
    assert.equal((await complete(flow, { organizationId: randomUUID() })).status, 403);
    assert.equal((await tokens()).length, 0);
  });
  await t.test("unprovisioned external sessions cannot gain access", async () => {
    identity = null; session = { user: { email: "unknown@example.test" } };
    assert.equal((await authorize(await start())).status, 403);
    assert.equal((await tokens()).length, 0);
  });
  await t.test("cancellation produces no native credential", async () => {
    const flow = await start(); await authorize(flow);
    const response = await complete(flow, { decision: "deny" });
    assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "access_denied");
    assert.equal((await tokens()).length, 0);
    assert.equal((await sql`SELECT * FROM native_auth_requests`).length, 0);
  });
  await t.test("wrong verifier, code and request id cannot consume a grant", async () => {
    const flow = await grant();
    for (const overrides of [{ codeVerifier: nativeSecret() }, { code: nativeSecret() }, { requestId: nativeSecret() }]) {
      assert.equal((await exchange(flow, overrides)).status, 401);
    }
    assert.equal((await exchange(flow)).status, 201);
    assert.equal((await exchange(flow)).status, 401);
  });
  await t.test("parallel exchanges mint exactly one token", async () => {
    const flow = await grant();
    const results = await Promise.all(Array.from({ length: 8 }, () => exchange(flow)));
    assert.equal(results.filter((result) => result.status === 201).length, 1);
    assert.equal(results.filter((result) => result.status === 401).length, 7);
    assert.equal((await tokens()).length, 1);
  });
  await t.test("expiry and server binding are enforced", async () => {
    const flow = await grant();
    await sql`UPDATE native_auth_requests SET origin='https://other.test'`;
    assert.equal((await exchange(flow)).status, 401);
    await sql`UPDATE native_auth_requests SET origin='https://inventory.test', expires_at=now()-interval '1 minute'`;
    assert.equal((await exchange(flow)).status, 401);
  });
  await t.test("disabled users and invalidated sessions cannot exchange", async () => {
    const flow = await grant();
    await sql`UPDATE users SET is_active=false`;
    assert.equal((await exchange(flow)).status, 401);
    await sql`UPDATE users SET is_active=true,session_version=2`;
    assert.equal((await exchange(flow)).status, 401);
    assert.equal((await tokens()).length, 0);
  });
  await t.test("membership and live role changes are checked again at exchange", async () => {
    const flow = await grant(); memberships = [];
    assert.equal((await exchange(flow)).status, 404);
    memberships = [{ ...organization }]; hasRole = false;
    assert.equal((await exchange(flow)).status, 403);
    assert.equal((await tokens()).length, 0);
  });
  await t.test("read-only organizations cannot issue native device tokens", async () => {
    const flow = await grant(); memberships = [{ ...organization, isReadOnly: true }];
    assert.equal((await exchange(flow)).status, 403);
  });
  await t.test("repeated consent cannot mint another grant", async () => {
    const flow = await start(); await authorize(flow);
    const payload = form(flow);
    const first = await complete(flow);
    assert.equal(first.status, 303);
    const second = await routes.complete.POST(request("complete", payload, { form: true }));
    assert.equal(second.status, 410);
  });
  await t.test("oversized and invalid input is rejected before persistence", async () => {
    const response = await routes.start.POST(request("start", { text: "a".repeat(5000) }));
    assert.equal(response.status, 413);
    assert.equal((await routes.start.POST(request("start", { codeChallengeMethod: "plain" }))).status, 400);
    assert.equal((await sql`SELECT * FROM native_auth_requests`).length, 0);
  });
  await t.test("confirmation escapes provider-controlled display names", async () => {
    identity = { ...member(), subject: '<img src=x onerror="alert(1)">' };
    const response = await authorize(await start());
    const html = await response.text();
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img"));
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.ok(response.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
  });
  await t.test("password login shares the same user-bound token policy", async () => {
    const login = (password) => passwordRoute.POST(request("../login", { email: "member@example.test", password, deviceName: "Password iPhone" }));
    assert.equal((await login("wrong")).status, 401);
    passwordEnabled = false;
    assert.equal((await login("correct")).status, 403);
    passwordEnabled = true;
    assert.equal((await tokens()).length, 0);
    const response = await login("correct");
    assert.equal(response.status, 201);
    const result = await response.json();
    const [token] = await tokens();
    assert.equal(token.user_id, userId);
    assert.equal(token.user_session_version, 1);
    assert.equal(token.token_hash, nativeHash(result.token));
    memberships = [{ ...organization, isReadOnly: true }];
    assert.equal((await login("correct")).status, 403);
    assert.equal((await tokens()).length, 1);
  });

});
