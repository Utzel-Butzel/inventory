import type { NextAuthConfig } from "next-auth";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

export const DEFAULT_SESSION_MAX_AGE = 12 * 60 * 60;
export const REMEMBERED_SESSION_MAX_AGE = 365 * 24 * 60 * 60;
export const LOGIN_PREFERENCE_COOKIE = "inventory-login-remember";

export async function requestedRememberMe(request: Request) {
  const form = await request.clone().formData();
  return form.get("rememberMe") === "true";
}

/** Keep the JWT and its cookie on the same lifetime, including on renewal. */
export async function withSessionLifetime(
  config: NextAuthConfig,
  request?: NextRequest,
): Promise<NextAuthConfig> {
  if (!request) return config;

  const pathname = request.nextUrl.pathname;
  const isCallback = pathname.includes("/callback/");
  const isCredentials = pathname.endsWith("/callback/credentials");
  const isDemo = pathname.endsWith("/callback/demo");
  let rememberMe = false;

  if (isCredentials && request.method === "POST") {
    rememberMe = await requestedRememberMe(request);
  } else if (isCallback && !isDemo) {
    // Only used at sign-in. Existing sessions always use the encrypted claim.
    rememberMe = request.cookies.get(LOGIN_PREFERENCE_COOKIE)?.value === "true";
  } else if (!isDemo) {
    const secret = config.secret ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (secret) {
      const url = new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? request.url);
      const token = await getToken({
        req: { headers: new Headers({ cookie: request.headers.get("cookie") ?? "" }) },
        secret,
        secureCookie: config.useSecureCookies ?? url.protocol === "https:",
        cookieName: config.cookies?.sessionToken?.name,
        decode: config.jwt?.decode,
      });
      rememberMe = token?.rememberMe === true && token.authProvider !== "demo";
    }
  }

  const maxAge = rememberMe ? REMEMBERED_SESSION_MAX_AGE : DEFAULT_SESSION_MAX_AGE;
  return {
    ...config,
    session: { ...config.session, maxAge },
    jwt: { ...config.jwt, maxAge },
    callbacks: {
      ...config.callbacks,
      async jwt(params) {
        const token = config.callbacks?.jwt
          ? await config.callbacks.jwt(params)
          : params.token;
        if (token && params.user) {
          token.rememberMe = params.account?.provider !== "demo" && rememberMe;
        }
        return token;
      },
    },
  };
}
