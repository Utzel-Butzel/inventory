import { createHash } from "node:crypto";
import { z } from "zod";
import { prepareInventoryCountImage } from "@/lib/ai";
import { claimAiOperation, finishAiOperation, releaseAiOperation } from "@/lib/ai-idempotency";
import { consumePaidAiRateLimit, paidAiRateLimitHeaders } from "@/lib/ai-rate-limit";
import { hashRequestIdentity, requirePermission, requireResourcePermission } from "@/lib/api-auth";
import { MultipartBodyTooLargeError, readBoundedMultipart } from "@/lib/bounded-multipart";
import { hashIdempotentPayload, readIdempotencyKey } from "@/lib/idempotency";
import { bulk3dInputSchema, bulk3dMaxImageBytes, bulk3dMaxUploadBytes, bulk3dVersion } from "@/lib/inventory-bulk-3d";
import { bulk3dAvailable, startBulk3dJob } from "@/lib/inventory-bulk-3d-jobs";
import { maxUploadBytes } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (body: Record<string, unknown>, status = 200, headers = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function GET(request: Request) {
  const itemId = new URL(request.url).searchParams.get("itemId");
  if (!itemId || !z.string().uuid().safeParse(itemId).success) return json({ code: "invalidRequest" }, 422);
  const auth = await requireResourcePermission(request, "ai.count", itemId);
  if (auth.response) return auth.response;
  return json({ available: await bulk3dAvailable() });
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, "ai.count");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if (idempotency.error) return idempotency.error;
  if (!idempotency.key) return json({ code: "invalidRequest" }, 400);
  let form: FormData;
  try { form = await readBoundedMultipart(request, Math.min(bulk3dMaxUploadBytes, maxUploadBytes())); }
  catch (error) { return json({ code: "upload" }, error instanceof MultipartBodyTooLargeError ? 413 : 400); }
  let raw: unknown;
  try {
    const inputs = form.getAll("input");
    if (inputs.length !== 1 || typeof inputs[0] !== "string") throw new Error("Invalid input");
    raw = JSON.parse(inputs[0]);
  } catch { return json({ code: "invalidRequest" }, 422); }
  const parsed = bulk3dInputSchema.safeParse(raw);
  if (!parsed.success) return json({ code: "invalidRequest" }, 422);
  const itemAuth = await requireResourcePermission(request, "ai.count", parsed.data.itemId);
  if (itemAuth.response) return itemAuth.response;
  const images = form.getAll("images");
  if (images.length < 3 || images.length > 4 || images.some((i) => !(i instanceof File) || i.size === 0 || i.size > bulk3dMaxImageBytes || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(i.type))) {
    return json({ code: "upload" }, 422);
  }
  if (!await bulk3dAvailable()) return json({ code: "notConfigured" }, 503);
  const bytes = await Promise.all((images as File[]).map(async (i) => Buffer.from(await i.arrayBuffer())));
  const hashes = bytes.map((b) => createHash("sha256").update(b).digest("hex"));
  if (new Set(hashes).size !== hashes.length) return json({ code: "duplicatePhotos" }, 422);
  const actorHash = hashRequestIdentity(auth.identity);
  const requestHash = hashIdempotentPayload({ method: bulk3dVersion, actorHash, input: parsed.data, hashes });
  let claim;
  try {
    claim = await claimAiOperation({ organizationId: auth.identity.organizationId, operation: "count", idempotencyKey: idempotency.key, resourceId: parsed.data.itemId, requestHash });
  } catch { return json({ code: "unavailable" }, 503); }
  if (claim.kind === "conflict") return json({ code: "conflict" }, 409);
  if (claim.kind === "processing") return json({ code: "processing" }, 409, { "Retry-After": "3" });
  if (claim.kind === "replay") return json(claim.operation.response ?? {}, claim.operation.responseStatus ?? 500);
  const operationId = claim.operationId;
  const release = () => releaseAiOperation(auth.identity.organizationId, operationId).catch(() => undefined);
  const normalized: Buffer[] = [];
  try {
    for (const b of bytes) {
      const image = await prepareInventoryCountImage(b);
      normalized.push(Buffer.from(image.dataUrl.split(",")[1], "base64"));
    }
  } catch { await release(); return json({ code: "upload" }, 422); }
  let limit;
  try { limit = await consumePaidAiRateLimit({ organizationId: auth.identity.organizationId, identity: auth.identity, operation: "count" }); }
  catch { await release(); return json({ code: "unavailable" }, 503); }
  if (!limit.allowed) { await release(); return json({ code: limit.disabled ? "disabled" : "rateLimit" }, 429, paidAiRateLimitHeaders(limit)); }
  let job;
  try {
    job = await startBulk3dJob(operationId, { organizationId: auth.identity.organizationId, actorHash, resourceId: parsed.data.itemId }, parsed.data, normalized);
  } catch { await release(); return json({ code: "unavailable" }, 503); }
  try {
    await finishAiOperation({ organizationId: auth.identity.organizationId, operationId, body: job, status: 202 });
  } catch {
    // The job already exists under this operation ID. Never release its claim.
    return json(job, 202);
  }
  return json(job, 202);
}
