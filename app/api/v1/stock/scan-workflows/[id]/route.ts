import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import { scanWorkflowPatchSchema } from "@/lib/scan-workflow-contract";
import {
  deleteScanWorkflow,
  getScanWorkflow,
  scanWorkflowHttpError,
  updateScanWorkflow,
} from "@/lib/scan-workflows";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const readId = async (context: Context) => {
  const { id } = await context.params;
  return z.string().uuid().safeParse(id).success ? id : null;
};

export async function GET(request: Request, context: Context) {
  const authorization = await requirePermission(request, "workflows.read");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) {
    return Response.json({ error: "Invalid workflow id." }, { status: 422 });
  }

  try {
    const workflow = await getScanWorkflow(
      authorization.identity.organizationId,
      id,
    );
    if (!workflow) {
      return Response.json({ error: "Workflow not found." }, { status: 404 });
    }
    return Response.json({ workflow });
  } catch {
    return Response.json(
      { error: "Unable to load the scan workflow." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: Context) {
  const authorization = await requirePermission(request, "workflows.manage");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) {
    return Response.json({ error: "Invalid workflow id." }, { status: 422 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400 },
    );
  }
  const parsed = scanWorkflowPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid scan workflow update.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  try {
    const workflow = await updateScanWorkflow(
      authorization.identity.organizationId,
      id,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ workflow });
  } catch (error) {
    const failure = scanWorkflowHttpError(
      error,
      "Unable to update the scan workflow.",
    );
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const authorization = await requirePermission(request, "workflows.manage");
  if (authorization.response) return authorization.response;
  const id = await readId(context);
  if (!id) {
    return Response.json({ error: "Invalid workflow id." }, { status: 422 });
  }
  const revisionValues = new URL(request.url).searchParams.getAll("revision");
  const revision = z.coerce
    .number()
    .int()
    .min(1)
    .safeParse(revisionValues.length === 1 ? revisionValues[0] : undefined);
  if (!revision.success) {
    return Response.json(
      { error: "A single positive workflow revision is required." },
      { status: 422 },
    );
  }

  try {
    const deleted = await deleteScanWorkflow(
      authorization.identity.organizationId,
      id,
      revision.data,
    );
    if (!deleted) {
      return Response.json({ error: "Workflow not found." }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    const failure = scanWorkflowHttpError(
      error,
      "Unable to delete the scan workflow.",
    );
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status },
    );
  }
}
