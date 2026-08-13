import { requirePermission } from "@/lib/api-auth";
import { scanWorkflowCreateSchema } from "@/lib/scan-workflow-contract";
import {
  createScanWorkflow,
  listScanWorkflows,
  scanWorkflowHttpError,
} from "@/lib/scan-workflows";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await requirePermission(request, "workflows.read");
  if (authorization.response) return authorization.response;

  try {
    return Response.json({
      workflows: await listScanWorkflows(
        authorization.identity.organizationId,
      ),
    });
  } catch {
    return Response.json(
      { error: "Unable to load scan workflows." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "workflows.manage");
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
  const parsed = scanWorkflowCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid scan workflow.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  try {
    const workflow = await createScanWorkflow(
      authorization.identity.organizationId,
      parsed.data,
      authorization.identity.subject,
    );
    return Response.json({ workflow }, { status: 201 });
  } catch (error) {
    const failure = scanWorkflowHttpError(
      error,
      "Unable to create the scan workflow.",
    );
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status },
    );
  }
}
