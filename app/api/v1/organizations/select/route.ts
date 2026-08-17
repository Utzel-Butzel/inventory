import { cookies } from "next/headers";

import { getRequestIdentity } from "@/lib/api-auth";
import { ORGANIZATION_COOKIE } from "@/lib/organizations";
import { organizationSelectInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const identity = await getRequestIdentity(request);
  if (!identity) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: noStoreHeaders },
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
  const parsed = organizationSelectInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid organization selection." },
      { status: 422, headers: noStoreHeaders },
    );
  }

  const organization = identity.organizations.find(
    (candidate) => candidate.id === parsed.data.organizationId,
  );
  if (!organization) {
    return Response.json(
      { error: "Organization not found." },
      { status: 404, headers: noStoreHeaders },
    );
  }

  if (identity.kind === "session") {
    const cookieStore = await cookies();
    cookieStore.set(ORGANIZATION_COOKIE, organization.slug, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  return Response.json({ organization }, { headers: noStoreHeaders });
}
