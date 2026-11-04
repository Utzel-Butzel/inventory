import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeStartSchema, nativeExchangeSchema, nativeChallenge, nativeSecret, nativeHash,
  nativeCallback, nativeBrowserCookie, safeLoginCallback, equalNativeSecret,
} from "../lib/native-auth-contract.ts";

test("PKCE S256 matches RFC 7636 and uses independent high-entropy secrets", () => {
  assert.equal(nativeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const secrets = Array.from({ length: 100 }, nativeSecret);
  assert.equal(new Set(secrets).size, 100);
  assert.ok(secrets.every((secret) => /^[A-Za-z0-9_-]{43}$/.test(secret)));
  assert.ok(equalNativeSecret(secrets[0], secrets[0]));
  assert.ok(!equalNativeSecret(secrets[0], secrets[1]));
  assert.notEqual(nativeHash(secrets[0]), secrets[0]);
});

test("native requests only allow S256 and never accept arbitrary redirect destinations", () => {
  const input = { codeChallenge: nativeSecret(), state: nativeSecret(), codeChallengeMethod: "S256" };
  assert.ok(nativeStartSchema.safeParse(input).success);
  for (const invalid of [{ ...input, codeChallengeMethod: "plain" }, { ...input, state: "short" }, { ...input, redirectUri: "https://evil.example" }]) {
    assert.ok(!nativeStartSchema.safeParse(invalid).success);
  }
  const exchange = { requestId: nativeSecret(), code: nativeSecret(), codeVerifier: nativeSecret() };
  assert.ok(nativeExchangeSchema.safeParse(exchange).success);
  assert.ok(!nativeExchangeSchema.safeParse({ ...exchange, codeVerifier: "weak" }).success);
});

test("callback carries only a one-time code and state on the fixed app scheme", () => {
  const state = nativeSecret(), code = nativeSecret();
  const callback = new URL(nativeCallback(state, { code }));
  assert.equal(callback.origin, "null");
  assert.equal(callback.protocol, "de.polyxo.openinventory:");
  assert.equal(callback.host, "auth");
  assert.equal(callback.pathname, "/callback");
  assert.deepEqual([...callback.searchParams.keys()].sort(), ["code", "state"]);
  assert.equal(callback.searchParams.get("code"), code);
  assert.equal(new URL(nativeCallback(state, { error: "access_denied" })).searchParams.get("error"), "access_denied");
});

test("browser bindings use per-attempt host-only cookies", () => {
  const first = nativeSecret(), second = nativeSecret();
  assert.match(nativeBrowserCookie(first, true), /^__Host-inventory-native-/);
  assert.notEqual(nativeBrowserCookie(first, true), nativeBrowserCookie(second, true));
  assert.ok(!nativeBrowserCookie(first, false).startsWith("__Host-"));
});

test("login retains native handoff paths but cannot become an open redirect", () => {
  const callback = `/api/v1/auth/browser/authorize?request=${nativeSecret()}`;
  assert.equal(safeLoginCallback(callback), callback);
  for (const unsafe of ["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil.test", "javascript:alert(1)"]) {
    assert.equal(safeLoginCallback(unsafe, "/inventory"), "/inventory");
  }
  assert.equal(safeLoginCallback(undefined, "/org/inventory"), "/org/inventory");
});
