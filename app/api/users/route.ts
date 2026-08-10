import { hash } from "bcryptjs";
import { asc, desc } from "drizzle-orm";

import { users } from "@/db/schema";
import { requireAdminSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { userCreateInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const publicUser = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
  passwordUpdatedAt: users.passwordUpdatedAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export async function GET(request: Request) {
  const authorization = await requireAdminSession(request);
  if (authorization.response) return authorization.response;

  const rows = await db
    .select(publicUser)
    .from(users)
    .orderBy(desc(users.isActive), asc(users.name), asc(users.email));

  return Response.json({
    users: rows,
    currentUserId: authorization.identity.userId ?? null,
  });
}

export async function POST(request: Request) {
  const authorization = await requireAdminSession(request);
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const parsed = userCreateInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid user settings.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const passwordHash = await hash(parsed.data.password, 12);
  const [created] = await db
    .insert(users)
    .values({
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      role: parsed.data.role,
      createdBy: authorization.identity.subject,
      updatedBy: authorization.identity.subject,
    })
    .onConflictDoNothing({ target: users.email })
    .returning(publicUser);

  if (!created) {
    return Response.json(
      { error: "A user with this email address already exists." },
      { status: 409 },
    );
  }

  return Response.json({ user: created }, { status: 201 });
}
