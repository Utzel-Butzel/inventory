import NextAuth, { type NextAuthConfig } from "next-auth";
import Auth0 from "next-auth/providers/auth0";
import Credentials from "next-auth/providers/credentials";
import { and, eq } from "drizzle-orm";

import {
  accessRoles,
  organizationMemberships,
  organizations,
  users,
  type UserRecord,
} from "@/db/schema";
import { getAuthProviderConfiguration } from "@/lib/auth-provider-config";
import { normalizeUserRole } from "@/lib/auth-roles";
import { db } from "@/lib/db";
import { authenticateLocalUser } from "@/lib/local-auth";
import {
  PUBLIC_DEMO_ORGANIZATION_ID,
  PUBLIC_DEMO_USER_ID,
} from "@/lib/organization-read-only";

const providerConfiguration = getAuthProviderConfiguration();

export const passwordAuthEnabled = providerConfiguration.passwordEnabled;
export const auth0Enabled = Boolean(providerConfiguration.auth0);
export const externalAuthProviders = providerConfiguration.externalProviders;

const externalProviderIds = new Set(
  externalAuthProviders.map((provider) => provider.id),
);

export const demoAccessEnabled =
  process.env.DEMO_ACCESS_ENABLED?.trim().toLowerCase() === "true";

const demoUserEmail = () =>
  (process.env.DEMO_USER_EMAIL?.trim() || "demo@inventory.invalid").toLowerCase();

const demoOrganizationSlug = () =>
  (process.env.DEMO_ORGANIZATION_SLUG?.trim() || "demo").toLowerCase();

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

async function authorizeDemoUser() {
  if (!demoAccessEnabled) return null;

  try {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, PUBLIC_DEMO_USER_ID),
          eq(users.email, demoUserEmail()),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    if (!user) return null;

    // The public login is intentionally coupled to one dedicated principal.
    // Any second active membership or role change disables it immediately.
    const memberships = await db
      .select({
        roleKey: organizationMemberships.roleKey,
        organizationId: organizations.id,
        organizationSlug: organizations.slug,
        organizationIsReadOnly: organizations.isReadOnly,
        roleIsSystem: accessRoles.isSystem,
      })
      .from(organizationMemberships)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMemberships.organizationId),
      )
      .innerJoin(
        accessRoles,
        and(
          eq(accessRoles.organizationId, organizationMemberships.organizationId),
          eq(accessRoles.key, organizationMemberships.roleKey),
        ),
      )
      .where(
        and(
          eq(organizationMemberships.userId, user.id),
          eq(organizationMemberships.isActive, true),
        ),
      )
      .limit(2);

    const [membership] = memberships;
    if (
      memberships.length !== 1 ||
      !membership ||
      membership.organizationId !== PUBLIC_DEMO_ORGANIZATION_ID ||
      membership.organizationSlug !== demoOrganizationSlug() ||
      membership.organizationIsReadOnly !== true ||
      membership.roleKey !== "viewer" ||
      membership.roleIsSystem !== true
    ) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: "viewer",
      authProvider: "demo" as const,
      sessionVersion: user.sessionVersion,
    };
  } catch {
    // A missing migration or unavailable database must never broaden access.
    return null;
  }
}

const providers: NextAuthConfig["providers"] = [];

if (passwordAuthEnabled) {
  providers.push(
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
  );
}

if (demoAccessEnabled) {
  providers.push(
    Credentials({
      id: "demo",
      name: "Live demo",
      credentials: {},
      authorize: authorizeDemoUser,
    }),
  );
}

if (providerConfiguration.auth0) {
  providers.push(
    Auth0({
      clientId: providerConfiguration.auth0.clientId,
      clientSecret: providerConfiguration.auth0.clientSecret,
      issuer: providerConfiguration.auth0.issuer,
    }),
  );
}

if (providerConfiguration.oidc) {
  providers.push({
    id: providerConfiguration.oidc.id,
    name: providerConfiguration.oidc.name,
    type: "oidc",
    issuer: providerConfiguration.oidc.issuer,
    clientId: providerConfiguration.oidc.clientId,
    clientSecret: providerConfiguration.oidc.clientSecret,
    authorization: {
      params: { scope: providerConfiguration.oidc.scopes },
    },
    checks: ["pkce", "state", "nonce"],
  });
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
      if (account?.provider === "demo" && user) {
        token.userId = user.id;
        token.authProvider = "demo";
        token.role = "viewer";
        token.sessionVersion = user.sessionVersion ?? 1;
        token.externalEmailVerified = true;
      } else if (account?.provider === "credentials" && user) {
        token.userId = user.id;
        token.authProvider = "local";
        token.role = normalizeUserRole(user.role, "viewer");
        token.sessionVersion = user.sessionVersion ?? 1;
        token.externalEmailVerified = true;
      } else if (
        account?.provider &&
        externalProviderIds.has(account.provider)
      ) {
        // External subject identifiers are not local user UUIDs. The API links
        // a verified provider email to an explicitly provisioned local user.
        delete token.userId;
        token.authProvider = account.provider;
        token.role = "viewer";
        token.sessionVersion = 1;
        token.externalEmailVerified =
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
          typeof token.authProvider === "string"
            ? token.authProvider
            : "local";
        session.user.sessionVersion = Number(token.sessionVersion ?? 1);
        session.user.externalEmailVerified =
          token.externalEmailVerified === true ||
          // Preserve existing Auth0 sessions across this field rename.
          token.auth0EmailVerified === true;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
