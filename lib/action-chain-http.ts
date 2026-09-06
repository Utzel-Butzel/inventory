import "server-only";
import { requirePermission } from "@/lib/api-auth";
import { chainRunInputSchema, runActionChain } from "@/lib/action-chain-engine";
import { readIdempotencyKey, hashIdempotentPayload, idempotencyResponseHeaders } from "@/lib/idempotency";
import { scanWorkflowHttpError, getScanWorkflowTargetGroups, extractScanIdentifier } from "@/lib/scan-workflows";
import { getPublicActionFlow } from "@/lib/public-action-flows";
import { isSameOriginRequest, publicShareClientAddress } from "@/lib/public-share-session";
import { checkRateLimit } from "@/lib/rate-limit";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { stockScanWorkflows } from "@/db/schema";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export async function chainConfiguration(request: Request, workflowId?: string, triggerId?: string) {
  let workflow;
  if (triggerId) workflow = (await getPublicActionFlow(triggerId))?.workflow;
  else {
    const authorization = await requirePermission(request, "workflows.read");
    if (authorization.response) return authorization.response;
    [workflow] = await db.select().from(stockScanWorkflows).where(and(eq(stockScanWorkflows.organizationId, authorization.identity.organizationId), eq(stockScanWorkflows.id, workflowId!)));
  }
  if (!workflow?.enabled || !workflow.actions.length) return Response.json({ error: "Ablauf nicht verfügbar." }, { status: 404, headers });
  let identifier: string | undefined;
  if (request.method === "POST") {
    const parsed = chainRunInputSchema.pick({ code: true, codeType: true }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Ungültiger Scan." }, { status: 422, headers });
    if (parsed.data.codeType && !workflow.codeTypes.includes(parsed.data.codeType)) return Response.json({ error: "Diese Code-Art ist für den Ablauf nicht erlaubt." }, { status: 422, headers });
    try { identifier = extractScanIdentifier(parsed.data.code, workflow.extraction); }
    catch (error) { const failure = scanWorkflowHttpError(error, "Der Code passt nicht zu diesem Ablauf."); return Response.json({ error: failure.message }, { status: failure.status, headers }); }
  }
  return Response.json({ workflow: {
    id: workflow.id, name: workflow.name, description: workflow.description, codeTypes: workflow.codeTypes,
    extraction: workflow.extraction, inputFields: workflow.inputFields, identifier,
    targetSelectionMode: workflow.targetSelectionMode,
    fixedCode: triggerId ? workflow.publicTriggerCode : null,
    actions: workflow.actions.map(({ id, label, type, enabled }) => ({ id, label, type, enabled })),
    targetGroups: await getScanWorkflowTargetGroups(workflow.organizationId, workflow),
  } }, { headers });
}

export async function chainRequest(request: Request, preview: boolean, triggerId?: string) {
  let organizationId: string;
  let actor: string;
  let publicWorkflow;
  if (triggerId) {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin action requests are not allowed." }, { status: 403, headers });
    if (!checkRateLimit(`public-chain:${triggerId}:${publicShareClientAddress(request)}`, { limit: 60, windowMs: 15 * 60_000 }).allowed) return Response.json({ error: "Zu viele Anfragen. Bitte später erneut versuchen." }, { status: 429, headers });
    publicWorkflow = (await getPublicActionFlow(triggerId))?.workflow;
    if (!publicWorkflow) return Response.json({ error: "Ablauf nicht verfügbar." }, { status: 404, headers });
    organizationId = publicWorkflow.organizationId;
    actor = `public-action:${publicWorkflow.id}`;
  } else {
    const authorization = await requirePermission(request, preview ? "workflows.read" : "workflows.manage");
    if (authorization.response) return authorization.response;
    organizationId = authorization.identity.organizationId;
    actor = authorization.identity.subject;
  }
  const raw = await request.json().catch(() => null);
  const parsed = chainRunInputSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Ungültige Angaben für den Ablauf.", details: parsed.error.flatten() }, { status: 422, headers });
  const input = parsed.data;
  if (publicWorkflow) {
    if (input.workflowId !== publicWorkflow.id) return Response.json({ error: "Ablauf nicht verfügbar." }, { status: 404, headers });
    input.code = publicWorkflow.publicTriggerCode ?? input.code;
  }
  const idempotency = preview ? { key: undefined, error: undefined } : readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!preview && !idempotency.key) return Response.json({ error: "Idempotency-Key muss eine UUID sein." }, { status: 400, headers });
  try {
    const report = await runActionChain(input, organizationId, { actor, key: idempotency.key ?? undefined, publicTriggerId: triggerId, requestHash: hashIdempotentPayload({ actor, input }) }, preview);
    return Response.json(report, { status: preview || report.replayed ? 200 : 201, headers: { ...headers, ...(!preview && idempotency.key ? idempotencyResponseHeaders(idempotency.key, report.replayed ?? false) : {}) } });
  } catch (error) {
    const failure = scanWorkflowHttpError(error, "Der Ablauf konnte nicht ausgeführt werden.");
    return Response.json({ error: failure.message, details: failure.details }, { status: failure.status, headers });
  }
}
