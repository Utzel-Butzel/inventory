import NextAuth, { type NextAuthConfig } from "next-auth";
import Auth0 from "next-auth/providers/auth0";
import Credentials from "next-auth/providers/credentials";

import type { UserRecord } from "@/db/schema";
import { normalizeUserRole } from "@/lib/auth-roles";
import { authenticateLocalUser } from "@/lib/local-auth";

const auth0Issuer =
  process.env.AUTH0_ISSUER_BASE_URL?.trim() ||
  (process.env.AUTH0_DOMAIN?.trim()
    ? `https://${process.env.AUTH0_DOMAIN.trim().replace(/^https?:\/\//, "")}`
    : "");

export const auth0Enabled = Boolean(
  process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET &&
    auth0Issuer,
);

function localAuthUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider: "local" as const,
    sessionVersion: user.sessionVersion,
  };
}

const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    authorize: async (credentials) => {
      const email = String(credentials?.email ?? "").trim().toLowerCase();
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      const user = await authenticateLocalUser(email, password);
      return user ? localAuthUser(user) : null;
    },
  }),
];

if (auth0Enabled) {
  providers.push(
    Auth0({
      clientId: process.env.AUTH0_CLIENT_ID!,
      clientSecret: process.env.AUTH0_CLIENT_SECRET!,
      issuer: auth0Issuer,
    }),
  );
}

export const authConfig = {
  providers,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  trustHost: true,
  callbacks: {
    jwt({ token, user, account, profile }) {
      if (account?.provider === "credentials" && user) {
        token.userId = user.id;
        token.authProvider = "local";
        token.role = normalizeUserRole(user.role, "viewer");
        token.sessionVersion = user.sessionVersion ?? 1;
        token.auth0EmailVerified = true;
      } else if (account?.provider === "auth0") {
        // Auth0 subject identifiers are not local user UUIDs. The API links a
        // verified Auth0 email to an explicitly provisioned local membership.
        delete token.userId;
        token.authProvider = "auth0";
        token.role = "viewer";
        token.sessionVersion = 1;
        token.auth0EmailVerified =
          (profile as Record<string, unknown> | undefined)?.email_verified ===
          true;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.userId ?? token.sub ?? "");
        session.user.role = normalizeUserRole(token.role, "viewer");
        session.user.authProvider =
          token.authProvider === "local" ? "local" : "auth0";
        session.user.sessionVersion = Number(token.sessionVersion ?? 1);
        session.user.auth0EmailVerified = token.auth0EmailVerified === true;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
