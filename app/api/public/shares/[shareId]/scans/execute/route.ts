import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { stockScanExecuteSchema } from "@/lib/scan-workflow-contract";
import { listPublicShareWorkflows } from "@/lib/public-shares";
import {
  isSameOriginRequest,
  publicShareNoStoreHeaders,
  requirePublicStockShare,
} from "@/lib/public-share-session";
import {
  executeStockScan,
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
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key header is required." },
      { status: 400, headers: publicShareNoStoreHeaders() },
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
  const parsed = stockScanExecuteSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid action-flow request.", details: parsed.error.flatten() },
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
  const actor = `public-share:${authorization.share.id}`;
  try {
    const result = await executeStockScan(
      authorization.share.organizationId,
      parsed.data,
      actor,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({ actor, scan: parsed.data }),
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: {
        ...publicShareNoStoreHeaders(),
        ...idempotencyResponseHeaders(idempotency.key, result.replayed),
      },
    });
  } catch (error) {
    const failure = scanWorkflowHttpError(error, "Unable to execute this scan.");
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status, headers: publicShareNoStoreHeaders() },
    );
  }
}
