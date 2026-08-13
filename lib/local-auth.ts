import "server-only";

import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";

import { users, type UserRecord } from "@/db/schema";
import { db } from "@/lib/db";
import { ensureDefaultOrganizationMembership } from "@/lib/organizations";

const invalidPasswordHash =
  "$2b$12$b72wh6gSHWSo86C55dE9ru8PkOxR5dELMTwsOEQ8XApwiuWCejrna";

const constantTimeEquals = (left: string, right: string) => {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
};

function bootstrapSettings() {
  return {
    email: (
      process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() ||
      process.env.SIMPLE_AUTH_EMAIL?.trim() ||
      "admin@inventory.local"
    ).toLowerCase(),
    name:
      process.env.BOOTSTRAP_ADMIN_NAME?.trim() ||
      process.env.SIMPLE_AUTH_NAME?.trim() ||
      "Inventory admin",
    passwordHash:
      process.env.BOOTSTRAP_ADMIN_PASSWORD_HASH?.trim() ||
      process.env.SIMPLE_AUTH_PASSWORD_HASH?.trim() ||
      "",
    password:
      process.env.BOOTSTRAP_ADMIN_PASSWORD ||
      process.env.SIMPLE_AUTH_PASSWORD ||
      "",
  };
}

async function passwordMatches(password: string, passwordHash: string) {
  try {
    return await compare(password, passwordHash || invalidPasswordHash);
  } catch {
    await compare(password, invalidPasswordHash);
    return false;
  }
}

async function bootstrapFirstAdmin(email: string, password: string) {
  const [existingUser] = await db.select().from(users).limit(1);
  if (existingUser) {
    await passwordMatches(password, invalidPasswordHash);
    return null;
  }

  const settings = bootstrapSettings();
  if (!settings.passwordHash && !settings.password) {
    await passwordMatches(password, invalidPasswordHash);
    return null;
  }
  if (!constantTimeEquals(email, settings.email)) {
    await passwordMatches(password, invalidPasswordHash);
    return null;
  }

  const valid = settings.passwordHash
    ? await passwordMatches(password, settings.passwordHash)
    : constantTimeEquals(password, settings.password);
  if (!valid) return null;

  const passwordHash = settings.passwordHash || (await hash(password, 12));
  const [created] = await db
    .insert(users)
    .values({
      email: settings.email,
      name: settings.name,
      passwordHash,
      role: "admin",
      createdBy: "bootstrap",
      updatedBy: "bootstrap",
      lastLoginAt: new Date(),
    })
    .onConflictDoNothing({ target: users.email })
    .returning();

  if (created) {
    await ensureDefaultOrganizationMembership({
      userId: created.id,
      role: created.role,
      actor: "bootstrap",
    });
    return created;
  }
  const [concurrentUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, settings.email))
    .limit(1);
  if (concurrentUser) {
    await ensureDefaultOrganizationMembership({
      userId: concurrentUser.id,
      role: concurrentUser.role,
      actor: "bootstrap",
    });
  }
  return concurrentUser ?? null;
}

/** Authenticate a database-backed account for browser and native clients. */
export async function authenticateLocalUser(
  emailInput: string,
  password: string,
): Promise<UserRecord | null> {
  const email = emailInput.trim().toLowerCase();
  if (!email || !password) {
    await passwordMatches(password, invalidPasswordHash);
    return null;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user) {
    const valid = await passwordMatches(
      password,
      user.isActive ? user.passwordHash : invalidPasswordHash,
    );
    if (!valid || !user.isActive) return null;

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    return user;
  }

  return bootstrapFirstAdmin(email, password);
}
