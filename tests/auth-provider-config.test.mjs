import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getAuthProviderConfiguration,
  validateAuthProviderEnvironment,
} from "../lib/auth-provider-config.ts";

test("password login remains the backward-compatible default", () => {
  assert.deepEqual(getAuthProviderConfiguration({}), {
    passwordEnabled: true,
    auth0: null,
    oidc: null,
    externalProviders: [],
  });
});

test("Auth0 and a generic OIDC provider can be enabled together", () => {
  const configuration = getAuthProviderConfiguration({
    AUTH0_CLIENT_ID: "auth0-client",
    AUTH0_CLIENT_SECRET: "auth0-secret",
    AUTH0_DOMAIN: "tenant.eu.auth0.com",
    AUTH_OIDC_PROVIDER_ID: "supabase",
    AUTH_OIDC_PROVIDER_NAME: "Supabase",
    AUTH_OIDC_ISSUER: "https://project.supabase.co/auth/v1/",
    AUTH_OIDC_CLIENT_ID: "supabase-client",
    AUTH_OIDC_CLIENT_SECRET: "supabase-secret",
  });

  assert.equal(configuration.passwordEnabled, true);
  assert.equal(configuration.auth0?.issuer, "https://tenant.eu.auth0.com");
  assert.equal(
    configuration.oidc?.issuer,
    "https://project.supabase.co/auth/v1",
  );
  assert.equal(configuration.oidc?.scopes, "openid email profile");
  assert.deepEqual(configuration.externalProviders, [
    { id: "auth0", name: "Auth0" },
    { id: "supabase", name: "Supabase" },
  ]);
});

test("incomplete or unsafe OIDC configuration fails validation", () => {
  const incomplete = validateAuthProviderEnvironment({
    AUTH_OIDC_ISSUER: "https://identity.example.com",
  });
  assert.match(incomplete.errors.join(" "), /OIDC configuration is incomplete/);

  const unsafe = validateAuthProviderEnvironment({
    AUTH_OIDC_PROVIDER_ID: "Auth Provider",
    AUTH_OIDC_ISSUER: "http://identity.example.com",
    AUTH_OIDC_CLIENT_ID: "client",
    AUTH_OIDC_CLIENT_SECRET: "secret",
    AUTH_OIDC_SCOPES: "openid profile",
  });
  assert.match(unsafe.errors.join(" "), /AUTH_OIDC_PROVIDER_ID/);
  assert.match(unsafe.errors.join(" "), /must use HTTPS/);
  assert.match(unsafe.errors.join(" "), /must include both openid and email/);
  assert.equal(unsafe.configuration.oidc, null);
});

test("a deployment cannot disable every login method", () => {
  const disabled = validateAuthProviderEnvironment({
    AUTH_PASSWORD_ENABLED: "false",
  });
  assert.match(
    disabled.errors.join(" "),
    /At least one authentication provider must be enabled/,
  );

  const externalOnly = validateAuthProviderEnvironment({
    AUTH_PASSWORD_ENABLED: "false",
    AUTH_OIDC_PROVIDER_ID: "supabase",
    AUTH_OIDC_PROVIDER_NAME: "Supabase",
    AUTH_OIDC_ISSUER: "https://project.supabase.co/auth/v1",
    AUTH_OIDC_CLIENT_ID: "client",
    AUTH_OIDC_CLIENT_SECRET: "secret",
  });
  assert.deepEqual(externalOnly.errors, []);
  assert.equal(externalOnly.configuration.passwordEnabled, false);
  assert.deepEqual(externalOnly.configuration.externalProviders, [
    { id: "supabase", name: "Supabase" },
  ]);
});

test("the login page delegates configured providers to Auth.js", async () => {
  const [auth, loginForm, sessionTypes] = await Promise.all([
    readFile(new URL("../auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/login-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../types/next-auth.d.ts", import.meta.url), "utf8"),
  ]);

  assert.match(auth, /type: "oidc"/);
  assert.match(auth, /checks: \["pkce", "state", "nonce"\]/);
  assert.match(auth, /externalProviderIds\.has\(account\.provider\)/);
  assert.match(loginForm, /externalProviders\.map/);
  assert.match(loginForm, /signIn\(providerId/);
  assert.match(sessionTypes, /externalEmailVerified/);
});
