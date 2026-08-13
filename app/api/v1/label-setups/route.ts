import { requirePermission } from "@/lib/api-auth";
import { labelSetupCreateSchema } from "@/lib/label-setup-contract";
import {
  createLabelSetup,
  labelSetupHttpError,
  listLabelSetups,
} from "@/lib/label-setups";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "labels.read");
  if (authorization.response) return authorization.response;

  try {
    return Response.json({ labelSetups: await listLabelSetups() });
  } catch {
    return Response.json(
      { error: "Unable to load label setups." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "labels.manage");
  if (authorization.response) return authorization.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = labelSetupCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid label setup.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const labelSetup = await createLabelSetup(
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ labelSetup }, { status: 201 });
  } catch (error) {
    const failure = labelSetupHttpError(
      error,
      "Unable to create the label setup.",
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
