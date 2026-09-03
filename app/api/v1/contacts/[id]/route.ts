import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { contactPatchSchema } from "@/lib/contact-contract";
import {
  archiveContact,
  contactHttpError,
  getContact,
  updateContact,
} from "@/lib/contacts";

type Context = { params: Promise<{ id: string }> };

async function contactId(context: Context) {
  const { id } = await context.params;
  return z.string().uuid().safeParse(id);
}

export async function GET(request: Request, context: Context) {
  const parsedId = await contactId(context);
  if (!parsedId.success) {
    return Response.json({ error: "Invalid contact id." }, { status: 422 });
  }
  const authorization = await requirePermission(request, "contacts.read");
  if (authorization.response) return authorization.response;

  const contact = await getContact(
    authorization.identity.organizationId,
    parsedId.data,
  );
  if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ contact });
}

export async function PATCH(request: Request, context: Context) {
  const parsedId = await contactId(context);
  if (!parsedId.success) {
    return Response.json({ error: "Invalid contact id." }, { status: 422 });
  }
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
  const parsed = contactPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid contact.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const contact = await updateContact(
      authorization.identity.organizationId,
      parsedId.data,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ contact });
  } catch (error) {
    const failure = contactHttpError(error, "Unable to update contact.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}

export async function DELETE(request: Request, context: Context) {
  const parsedId = await contactId(context);
  if (!parsedId.success) {
    return Response.json({ error: "Invalid contact id." }, { status: 422 });
  }
  const authorization = await requirePermission(request, "contacts.manage");
  if (authorization.response) return authorization.response;

  try {
    await archiveContact(
      authorization.identity.organizationId,
      parsedId.data,
      authorization.identity.subject,
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    const failure = contactHttpError(error, "Unable to archive contact.");
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
