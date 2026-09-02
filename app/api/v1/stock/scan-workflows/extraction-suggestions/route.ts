import { aiUsageEstimate } from "@/lib/ai-billing";
import {
  consumePaidAiRateLimit,
  paidAiRateLimitHeaders,
} from "@/lib/ai-rate-limit";
import {
  AiMonthlyBudgetExceededError,
  aiBudgetErrorBody,
  trackAiUsage,
} from "@/lib/ai-usage";
import { requirePermission } from "@/lib/api-auth";
import { suggestScanExtractionRegex } from "@/lib/scan-extraction-ai";
import { scanExtractionSuggestionRequestSchema } from "@/lib/scan-workflow-contract";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const authorization = await requirePermission(request, "workflows.manage");
  if (authorization.response) return authorization.response;
  if (!authorization.identity.permissions.includes("ai.analyze")) {
    return Response.json(
      { error: "You do not have permission to generate extraction rules with AI." },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const parsed = scanExtractionSuggestionRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid extraction suggestion request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  let limit;
  try {
    limit = await consumePaidAiRateLimit({
      organizationId: authorization.identity.organizationId,
      operation: "analyze",
      identity: authorization.identity,
    });
  } catch (error) {
    console.error("Unable to check the extraction AI rate limit.", error);
    return Response.json(
      { error: "AI rate limiting is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!limit.allowed) {
    return Response.json(
      {
        error: limit.disabled
          ? "AI extraction suggestions are disabled by the administrator."
          : "AI request limit reached. Try again shortly.",
      },
      { status: 429, headers: paidAiRateLimitHeaders(limit) },
    );
  }

  try {
    const result = await trackAiUsage({
      organizationId: authorization.identity.organizationId,
      estimate: aiUsageEstimate({ action: "workflow_extraction" }),
      actor: authorization.identity,
      metadata: { codeType: parsed.data.codeType },
      run: () => suggestScanExtractionRegex(parsed.data),
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof AiMonthlyBudgetExceededError) {
      return Response.json(aiBudgetErrorBody(error), { status: 402 });
    }
    console.error("Unable to generate a scan extraction rule.", error);
    return Response.json(
      { error: "No valid extraction rule could be generated for this sample." },
      { status: 502 },
    );
  }
}
