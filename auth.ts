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

function configuredAuth0Role(profile: Record<string, unknown> | undefined) {
  const fallback = normalizeUserRole(process.env.AUTH0_DEFAULT_ROLE, "editor");
  const claim = process.env.AUTH0_ROLE_CLAIM?.trim();
  return claim ? normalizeUserRole(profile?.[claim], fallback) : fallback;
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
      if (user?.id) token.userId = user.id;
      if (account?.provider === "credentials" && user) {
        token.authProvider = "local";
        token.role = normalizeUserRole(user.role, "viewer");
        token.sessionVersion = user.sessionVersion ?? 1;
      } else if (account?.provider === "auth0") {
        token.authProvider = "auth0";
        token.role = configuredAuth0Role(
          profile as Record<string, unknown> | undefined,
        );
        token.sessionVersion = 1;
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
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
