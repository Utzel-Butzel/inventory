import { getSessionIdentity } from "@/lib/api-auth";
import {
  OrganizationSlugUnavailableError,
  updateOrganization,
} from "@/lib/organizations";
import { organizationUpdateInputSchema } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const identity = await getSessionIdentity(id);
  if (!identity) {
    return Response.json(
      { error: "Organization not found." },
      { status: 404, headers: noStoreHeaders },
    );
  }
  if (!identity.permissions.includes("users.manage")) {
    return Response.json(
      { error: "You do not have permission to edit this organization." },
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
  const parsed = organizationUpdateInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid organization.", details: parsed.error.flatten() },
      { status: 422, headers: noStoreHeaders },
    );
  }
  let updated: Awaited<ReturnType<typeof updateOrganization>>;
  try {
    updated = await updateOrganization({
      id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      allowNegativeStock: parsed.data.allowNegativeStock,
      actor: identity.subject,
    });
  } catch (error) {
    if (error instanceof OrganizationSlugUnavailableError) {
      return Response.json(
        { error: "This organization slug is already in use." },
        { status: 409, headers: noStoreHeaders },
      );
    }
    throw error;
  }
  if (!updated) {
    return Response.json(
      { error: "Organization not found." },
      { status: 404, headers: noStoreHeaders },
    );
  }
  return Response.json({
    organization: {
      ...updated,
      role: identity.role,
      roleName: identity.roleName,
    },
  }, { headers: noStoreHeaders });
}
