import { z } from "zod";

import {
  hashIdempotentPayload,
  idempotencyResponseHeaders,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { getPublicActionFlow } from "@/lib/public-action-flows";
import { publicShareClientAddress, isSameOriginRequest } from "@/lib/public-share-session";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  publicActionFlowExecuteSchema,
  stockScanExecuteSchema,
} from "@/lib/scan-workflow-contract";
import {
  executeStockScan,
  resolveStockScan,
  scanWorkflowHttpError,
} from "@/lib/scan-workflows";

type Context = { params: Promise<{ triggerId: string }> };

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

export async function POST(request: Request, context: Context) {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: "Cross-origin action requests are not allowed." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  const { triggerId } = await context.params;
  if (!z.string().uuid().safeParse(triggerId).success) {
    return Response.json(
      { error: "This public action URL is not available." },
      { status: 404, headers: noStoreHeaders },
    );
  }
  const rateLimit = checkRateLimit(
    `public-action:${triggerId}:${publicShareClientAddress(request)}`,
    { limit: 30, windowMs: 15 * 60_000 },
  );
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many public action requests. Try again later." },
      {
        status: 429,
        headers: {
          ...noStoreHeaders,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      },
    );
  }
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) {
    return Response.json(
      { error: "Idempotency-Key must be a UUID." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  if (!idempotency.key) {
    return Response.json(
      { error: "Idempotency-Key header is required and must be a UUID." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Expected a JSON request body." },
      { status: 400, headers: noStoreHeaders },
    );
  }
  const parsed = publicActionFlowExecuteSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid public action request.", details: parsed.error.flatten() },
      { status: 422, headers: noStoreHeaders },
    );
  }
  const action = await getPublicActionFlow(triggerId);
  if (!action) {
    return Response.json(
      { error: "This public action URL is not available." },
      { status: 404, headers: noStoreHeaders },
    );
  }
  const code = action.workflow.publicTriggerCode ?? parsed.data.code;
  if (!code) {
    return Response.json(
      { error: "A code or identifier is required." },
      { status: 422, headers: noStoreHeaders },
    );
  }

  try {
    const resolution = await resolveStockScan(
      action.workflow.organizationId,
      action.workflow.id,
      code,
      null,
      parsed.data.selectedResourceIds,
    );
    const execution = stockScanExecuteSchema.parse({
      workflowId: action.workflow.id,
      revision: resolution.workflow.revision,
      code,
      codeType: null,
      expectedResourceUpdatedAt: resolution.expectedResourceUpdatedAt,
      expectedUnitId: resolution.expectedUnitId,
      expectedUnitUpdatedAt: resolution.expectedUnitUpdatedAt,
      selectedResourceIds: resolution.selectedResourceIds,
      expectedTargets: resolution.expectedTargets,
      inputs: parsed.data.inputs,
    });
    const actor = `public-action:${action.workflow.id}`;
    const result = await executeStockScan(
      action.workflow.organizationId,
      execution,
      actor,
      {
        key: idempotency.key,
        requestHash: hashIdempotentPayload({
          actor,
          triggerId,
          code,
          inputs: parsed.data.inputs,
          selectedResourceIds: resolution.selectedResourceIds,
        }),
        publicTriggerId: triggerId,
      },
    );
    return Response.json(result.response, {
      status: result.replayed ? 200 : 201,
      headers: {
        ...noStoreHeaders,
        ...idempotencyResponseHeaders(idempotency.key, result.replayed),
      },
    });
  } catch (error) {
    const failure = scanWorkflowHttpError(
      error,
      "Unable to execute this public action.",
    );
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status, headers: noStoreHeaders },
    );
  }
}
