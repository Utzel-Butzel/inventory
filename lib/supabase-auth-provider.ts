import { customFetch } from "next-auth";
import type { OAuthConfig } from "next-auth/providers";
import type { SupabaseAuthConfiguration } from "./auth-provider-config";

/** Explicit OAuth endpoints also work with self-hosted Supabase behind Kong.
 * Identity comes from the authenticated UserInfo response, never decoded JWTs.
 * Auth.js owns the authorization-code exchange, state and S256 PKCE checks.
 */
export function createSupabaseAuthProvider(
  configuration: SupabaseAuthConfiguration,
): OAuthConfig<Record<string, unknown>> {
  const base = `${configuration.origin}/auth/v1/oauth`;
  const endpoints = new Set([`${base}/token`, `${base}/userinfo`]);
  return {
    id: configuration.id,
    name: configuration.name,
    type: "oauth",
    issuer: `${configuration.origin}/auth/v1`,
    clientId: configuration.clientId,
    clientSecret: configuration.clientSecret,
    client: { token_endpoint_auth_method: "client_secret_basic" },
    authorization: {
      url: `${base}/authorize`,
      params: { scope: "email profile", apikey: configuration.apiKey },
    },
    token: `${base}/token`,
    userinfo: `${base}/userinfo`,
    checks: ["pkce", "state"],
    [customFetch]: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      // Do not forward provider credentials to discovery URLs or redirects.
      if (!endpoints.has(url)) throw new Error("Unexpected Supabase OAuth endpoint");
      const headers = new Headers(init?.headers);
      headers.set("apikey", configuration.apiKey);
      const response = await fetch(input, {
        ...init,
        headers,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(10_000),
        ]),
      });
      if (!response.ok) throw new Error("Supabase OAuth request failed");
      if (url === `${base}/userinfo`) verifiedSupabaseProfile(await response.clone().json());
      return response;
    },
    profile(profile) {
      return verifiedSupabaseProfile(profile);
    },
  };
}

function verifiedSupabaseProfile(profile: Record<string, unknown>) {
  if (
    typeof profile.sub !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.sub) ||
    typeof profile.email !== "string" ||
    !profile.email.trim() ||
    profile.email_verified !== true
  ) {
    throw new Error("Supabase must return a verified email and user ID");
  }
  return {
    id: profile.sub,
    email: profile.email.trim().toLowerCase(),
    name: typeof profile.name === "string" ? profile.name : null,
  };
}
