import {
  getReplicateCountOutcome,
  InventoryCountLocalizationError,
} from "@/lib/ai";
import { hashRequestIdentity, requireIdentity } from "@/lib/api-auth";
import {
  readReplicateCountJobToken,
  validateReplicateCountJobSigningSecret,
} from "@/lib/replicate-count-job";

const noStoreHeaders = { "Cache-Control": "no-store" };
const maximumJobRequestBytes = 6 * 1_024;

const json = (
  body: Record<string, unknown>,
  options: { status?: number; headers?: Record<string, string> } = {},
) =>
  Response.json(body, {
    status: options.status,
    headers: { ...noStoreHeaders, ...options.headers },
  });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request) {
  const authorization = await requireIdentity(request, "ai");
  if (authorization.response) return authorization.response;

  const contentLengthValue = request.headers.get("content-length");
  if (contentLengthValue !== null) {
    const contentLength = Number(contentLengthValue);
    if (
      !Number.isFinite(contentLength) ||
      contentLength < 0 ||
      contentLength > maximumJobRequestBytes
    ) {
      return json({ error: "Invalid count job request size." }, { status: 413 });
    }
  }

  let payload: unknown;
  try {
    if (!request.body) throw new Error("Missing count job body.");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumJobRequestBytes) {
          await reader.cancel();
          return json(
            { error: "Invalid count job request size." },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    payload = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    return json({ error: "Expected a JSON count job." }, { status: 400 });
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("jobToken" in payload) ||
    typeof payload.jobToken !== "string" ||
    payload.jobToken.length > 4_096
  ) {
    return json({ error: "Invalid count job token." }, { status: 422 });
  }

  let job;
  try {
    validateReplicateCountJobSigningSecret();
    job = readReplicateCountJobToken({
      token: payload.jobToken,
      subjectHash: hashRequestIdentity(authorization.identity),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("must contain at least 32 characters")
    ) {
      console.error("Replicate count job signing is not configured.", error);
      return json(
        { error: "Photo counting has an invalid server configuration." },
        { status: 503 },
      );
    }
    return json({ error: "Invalid or expired count job token." }, { status: 422 });
  }

  try {
    const outcome = await getReplicateCountOutcome(job, {
      signal: request.signal,
    });
    if (outcome.kind === "processing") {
      return json(
        {
          status: "processing",
          jobToken: payload.jobToken,
          expiresAt: outcome.job.expiresAt,
        },
        { status: 202, headers: { "Retry-After": "3" } },
      );
    }
    return json({ ...outcome.result, model: outcome.model });
  } catch (error) {
    if (error instanceof InventoryCountLocalizationError) {
      return json(
        { error: error.message, terminal: error.predictionTerminal },
        {
          status: error.statusCode,
          headers:
            error.retryAfterSeconds === undefined
              ? undefined
              : { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    console.error("Unable to poll a Replicate count prediction.", error);
    return json({ error: "Unable to finish this count." }, { status: 502 });
  }
}
