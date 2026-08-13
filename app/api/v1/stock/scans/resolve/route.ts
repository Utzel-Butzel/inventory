import { requirePermission } from "@/lib/api-auth";
import { stockScanResolveSchema } from "@/lib/scan-workflow-contract";
import {
  resolveStockScan,
  scanWorkflowHttpError,
} from "@/lib/scan-workflows";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "workflows.read");
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
  const parsed = stockScanResolveSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid scan resolution request.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  try {
    return Response.json(
      await resolveStockScan(parsed.data.workflowId, parsed.data.code),
    );
  } catch (error) {
    const failure = scanWorkflowHttpError(error, "Unable to resolve this scan.");
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status },
    );
  }
}
