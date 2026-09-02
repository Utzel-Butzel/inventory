import { stockScanResolveSchema } from "@/lib/scan-workflow-contract";
import {
  listPublicShareWorkflows,
} from "@/lib/public-shares";
import {
  isSameOriginRequest,
  publicShareNoStoreHeaders,
  requirePublicStockShare,
} from "@/lib/public-share-session";
import {
  resolveStockScan,
  scanWorkflowHttpError,
} from "@/lib/scan-workflows";

type Context = { params: Promise<{ shareId: string }> };

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: "Cross-origin scan requests are not allowed." },
      { status: 403, headers: publicShareNoStoreHeaders() },
    );
  }
  const { shareId } = await context.params;
  const authorization = await requirePublicStockShare(request, shareId);
  if (authorization.response) return authorization.response;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: publicShareNoStoreHeaders() },
    );
  }
  const parsed = stockScanResolveSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid scan resolution request." },
      { status: 422, headers: publicShareNoStoreHeaders() },
    );
  }
  const allowed = (await listPublicShareWorkflows(authorization.share)).some(
    (workflow) => workflow.id === parsed.data.workflowId,
  );
  if (!allowed) {
    return Response.json(
      { error: "Action flow not found." },
      { status: 404, headers: publicShareNoStoreHeaders() },
    );
  }
  try {
    return Response.json(
      await resolveStockScan(
        authorization.share.organizationId,
        parsed.data.workflowId,
        parsed.data.code,
        parsed.data.codeType,
        parsed.data.selectedResourceIds,
      ),
      { headers: publicShareNoStoreHeaders() },
    );
  } catch (error) {
    const failure = scanWorkflowHttpError(error, "Unable to resolve this scan.");
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status, headers: publicShareNoStoreHeaders() },
    );
  }
}
