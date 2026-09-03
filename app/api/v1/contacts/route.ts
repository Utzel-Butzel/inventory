import { contactInputSchema, contactRoleFilterSchema } from "@/lib/contact-contract";
import {
  contactHttpError,
  createContact,
  listContacts,
} from "@/lib/contacts";
import { requirePermission } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "contacts.read");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim();
  const rawRole = url.searchParams.get("role");
  const parsedRole = rawRole
    ? contactRoleFilterSchema.safeParse(rawRole)
    : null;
  if ((query?.length ?? 0) > 240 || (parsedRole && !parsedRole.success)) {
    return Response.json({ error: "Invalid contact query." }, { status: 422 });
  }

  try {
    const contacts = await listContacts({
      organizationId: authorization.identity.organizationId,
      query: query || undefined,
      role: parsedRole?.success ? parsedRole.data : undefined,
      includeArchived: url.searchParams.get("includeArchived") === "true",
    });
    return Response.json({ contacts });
  } catch {
    return Response.json(
      { error: "Unable to load contacts." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "contacts.manage");
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = contactInputSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid contact.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const contact = await createContact(
      authorization.identity.organizationId,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ contact }, { status: 201 });
  } catch (error) {
    const failure = contactHttpError(error, "Unable to create contact.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
