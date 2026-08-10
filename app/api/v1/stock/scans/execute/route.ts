import { requireIdentity } from "@/lib/api-auth";
import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { stockScanExecuteSchema } from "@/lib/scan-workflow-contract";
import {
  executeStockScan,
  scanWorkflowHttpError,
} from "@/lib/scan-workflows";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "write");
  if (authorization.response) return authorization.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key header is required and must be a UUID." },
      { status: 400 },
    );
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
  const parsed = stockScanExecuteSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid scan execution request.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  try {
    const result = await executeStockScan(
      parsed.data,
      authorization.identity.subject,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor: authorization.identity.subject,
          scan: parsed.data,
        }),
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: idempotencyResponseHeaders(
        idempotency.key,
        result.replayed,
      ),
    });
  } catch (error) {
    const failure = scanWorkflowHttpError(error, "Unable to execute this scan.");
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status },
    );
  }
}
