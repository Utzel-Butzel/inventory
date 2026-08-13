import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  labelSetupDeleteSchema,
  labelSetupPatchSchema,
} from "@/lib/label-setup-contract";
import {
  deleteLabelSetup,
  getLabelSetup,
  labelSetupHttpError,
  updateLabelSetup,
} from "@/lib/label-setups";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const readId = async (context: Context) => {
  const parsed = z.string().uuid().safeParse((await context.params).id);
  return parsed.success ? parsed.data : null;
};

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "labels.read");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) {
    return Response.json({ error: "Invalid label setup id." }, { status: 422 });
  }

  const labelSetup = await getLabelSetup(id);
  if (!labelSetup) {
    return Response.json({ error: "Label setup not found." }, { status: 404 });
  }
  return Response.json({ labelSetup });
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requirePermission(request, "labels.manage");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) {
    return Response.json({ error: "Invalid label setup id." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = labelSetupPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid label setup update.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const labelSetup = await updateLabelSetup(
      id,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ labelSetup });
  } catch (error) {
    const failure = labelSetupHttpError(
      error,
      "Unable to update the label setup.",
    );
    return Response.json(
      {
        error: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      },
      { status: failure.status },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requirePermission(request, "labels.manage");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) {
    return Response.json({ error: "Invalid label setup id." }, { status: 422 });
  }
  const parsed = labelSetupDeleteSchema.safeParse({
    revision: new URL(request.url).searchParams.get("revision"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: "A positive label setup revision is required." },
      { status: 422 },
    );
  }

  try {
    await deleteLabelSetup(id, parsed.data.revision);
    return new Response(null, { status: 204 });
  } catch (error) {
    const failure = labelSetupHttpError(
      error,
      "Unable to delete the label setup.",
    );
    return Response.json(
      {
        error: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      },
      { status: failure.status },
    );
  }
}
