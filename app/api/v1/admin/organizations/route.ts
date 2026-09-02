import { requireSuperAdminSession } from "@/lib/api-auth";
import {
  createOrganization,
  listOrganizations,
  OrganizationSlugUnavailableError,
} from "@/lib/organizations";
import { organizationCreateInputSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const authorization = await requireSuperAdminSession(request);
  if (authorization.response) return authorization.response;

  return Response.json(
    { organizations: await listOrganizations() },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  const authorization = await requireSuperAdminSession(request);
  if (authorization.response) return authorization.response;
  if (!authorization.identity.userId) {
    return Response.json(
      { error: "Creating an organization requires a database-backed account." },
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

  try {
    const organization = await createOrganization({
      name: parsed.data.name,
      slug: parsed.data.slug,
      userId: authorization.identity.userId,
      actor: authorization.identity.subject,
    });
    return Response.json(
      { organization },
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof OrganizationSlugUnavailableError) {
      return Response.json(
        { error: "This organization slug is already in use." },
        { status: 409, headers: noStoreHeaders },
      );
    }
    throw error;
  }
}
