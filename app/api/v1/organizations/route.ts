import { cookies } from "next/headers";

import { getRequestIdentity } from "@/lib/api-auth";
import {
  createOrganization,
  ORGANIZATION_COOKIE,
  type OrganizationMembershipSummary,
} from "@/lib/organizations";
import { organizationCreateInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function activeMembership(
  organization: Awaited<ReturnType<typeof createOrganization>>,
): OrganizationMembershipSummary {
  return {
    ...organization,
    role: "admin",
    roleName: "Admin",
  };
}

async function selectSessionOrganization(organizationId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }
  const canManageActive = identity.permissions.includes("users.manage");
  return Response.json(
    {
      organizations: identity.organizations.map((organization) => ({
        ...organization,
        canManage:
          organization.id === identity.organizationId && canManageActive,
      })),
      activeOrganizationId: identity.organizationId,
    },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
    );
  }
  if (identity.kind !== "session" || !identity.userId) {
    return Response.json(
      { error: "Creating an organization requires a browser session." },
      { status: 403, headers: noStoreHeaders },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected JSON." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const parsed = organizationCreateInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid organization.", details: parsed.error.flatten() },
      { status: 422, headers: noStoreHeaders },
    );
  }

  const created = await createOrganization({
    name: parsed.data.name,
    userId: identity.userId,
    actor: identity.subject,
  });
  const organization = activeMembership(created);
  await selectSessionOrganization(organization.id);
  return Response.json(
    { organization },
    { status: 201, headers: noStoreHeaders },
  );
}
