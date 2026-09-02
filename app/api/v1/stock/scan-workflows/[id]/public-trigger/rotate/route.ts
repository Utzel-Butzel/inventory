import { z } from "zod";

import { requirePermission } from "@/lib/api-auth";
import {
  rotateScanWorkflowPublicTrigger,
  scanWorkflowHttpError,
} from "@/lib/scan-workflows";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

const requestSchema = z.object({ revision: z.number().int().min(1) }).strict();

export async function POST(request: Request, context: Context) {
  const authorization = await requirePermission(request, "workflows.manage");
  if (authorization.response) return authorization.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid workflow id." }, { status: 422 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "A positive workflow revision is required." },
      { status: 422 },
    );
  }
  try {
    const workflow = await rotateScanWorkflowPublicTrigger(
      authorization.identity.organizationId,
      id,
      parsed.data.revision,
      authorization.identity.subject,
    );
    return Response.json({ workflow });
  } catch (error) {
    const failure = scanWorkflowHttpError(
      error,
      "Unable to rotate the public action URL.",
    );
    return Response.json(
      { error: failure.message, ...(failure.details ? { details: failure.details } : {}) },
      { status: failure.status },
    );
  }
}
