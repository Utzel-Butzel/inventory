import assert from "node:assert/strict";
import { mock, test, beforeEach } from "node:test";

const identity = { organizationId: "tenant-a", subject: "user-a", userId: "user-a" };
const input = { itemId: "f6387215-fcbf-41de-9a5f-5b132d56d496", itemHint: "printed brackets", language: "en", containerDimensions: null, partDimensions: null };
const answer = { method: "bulk_visual", isExact: false, accuracyValidated: false, model: "test-model", estimate: { count: 400, lowerBound: 280, upperBound: 550 }, visibility: "partial_layers", explanation: "Stacked parts.", assumptions: ["Similar parts."], warnings: [], captureAdvice: [] };
let state;
beforeEach(() => {
  state = { calls: 0, decodes: 0, usage: [], operations: new Map(), denied: false, itemDenied: false, limited: false, fail: false, budget: false };
  process.env.OPENAI_API_KEY = "test-only-key";
});

class BudgetError extends Error {}
mock.module("../lib/api-auth.ts", { namedExports: {
  requirePermission: async () => state.denied ? { response: Response.json({}, { status: 403 }) } : { identity },
  requireResourcePermission: async () => state.itemDenied ? { response: Response.json({}, { status: 404 }) } : { identity },
  hashRequestIdentity: () => "actor-a",
} });
mock.module("../lib/ai.ts", { namedExports: { prepareInventoryCountImage: async () => { state.decodes++; return { dataUrl: "data:image/jpeg;base64,ZmFrZQ==" }; } } });
mock.module("../lib/ai-prompt-store.ts", { namedExports: { getAiPromptSettings: async () => ({ inventorySettings: { analysisModel: "test-model" } }) } });
mock.module("../lib/storage.ts", { namedExports: { maxUploadBytes: () => 32 * 1024 * 1024 } });
mock.module("../lib/ai-rate-limit.ts", { namedExports: {
  consumePaidAiRateLimit: async () => ({ allowed: !state.limited, disabled: false }), paidAiRateLimitHeaders: () => ({ "Retry-After": "60" }),
} });
mock.module("../lib/ai-idempotency.ts", { namedExports: {
  claimAiOperation: async (options) => {
    const existing = state.operations.get(options.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== options.requestHash) return { kind: "conflict" };
      return existing.response ? { kind: "replay", operation: existing } : { kind: "processing", operation: existing };
    }
    state.operations.set(options.idempotencyKey, { ...options });
    return { kind: "claimed", operationId: options.idempotencyKey };
  },
  finishAiOperation: async ({ operationId, body, status }) => Object.assign(state.operations.get(operationId), { response: body, responseStatus: status }),
  releaseAiOperation: async (_tenant, id) => { state.operations.delete(id); },
} });
mock.module("../lib/ai-usage.ts", { namedExports: {
  AiMonthlyBudgetExceededError: BudgetError,
  aiBudgetErrorBody: () => ({ error: "budget exceeded" }),
  trackAiUsage: async (options) => { if (state.budget) throw new BudgetError(); state.usage.push(options.estimate); return options.run(); },
} });
mock.module("../lib/inventory-bulk-count-ai.ts", { namedExports: {
  estimateBulkInventoryItems: async () => { state.calls++; if (state.fail) throw new Error("Provider failed"); return answer; },
} });

const { POST } = await import("../app/api/v1/ai/count/bulk/route.ts");
const key = "4896b0f0-507c-4c3d-ac2e-4e4aecc89f9f";
function request({ payload = input, count = 3, idempotencyKey = key, duplicate = false } = {}) {
  const body = new FormData(); body.append("input", JSON.stringify(payload));
  for (let i = 0; i < count; i++) body.append("images", new Blob([`fake-${duplicate ? 0 : i}`], { type: "image/jpeg" }), `view-${i}.jpg`);
  return new Request("http://localhost/api/v1/ai/count/bulk", { method: "POST", headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}, body });
}

test("analyzes multiple views once and replays retries without a second paid call", async () => {
  const first = await POST(request());
  assert.equal(first.status, 200); assert.deepEqual(await first.json(), answer);
  const retry = await POST(request());
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), answer);
  assert.equal(state.calls, 1); assert.equal(state.decodes, 3);
  assert.equal(state.usage[0].action, "photo_count"); assert.equal(state.usage[0].provider, "openai");
  assert.equal(first.headers.get("cache-control"), "no-store");
});

test("denies unauthorized and cross-tenant item requests before decoding or spending", async () => {
  state.denied = true; assert.equal((await POST(request())).status, 403);
  state.denied = false; state.itemDenied = true; assert.equal((await POST(request())).status, 404);
  assert.equal(state.calls, 0); assert.equal(state.decodes, 0);
});

test("requires idempotency and rejects missing/excessive photos", async () => {
  assert.equal((await POST(request({ idempotencyKey: null }))).status, 400);
  assert.equal((await POST(request({ count: 0 }))).status, 422);
  assert.equal((await POST(request({ count: 2 }))).status, 422);
  assert.equal((await POST(request({ count: 6 }))).status, 422);
  assert.equal(state.calls, 0);
});

test("duplicate files are rejected before decoding or paid analysis", async () => {
  const response = await POST(request({ duplicate: true }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "duplicatePhotos");
  assert.equal(state.calls, 0); assert.equal(state.decodes, 0);
});

test("same key with changed inputs cannot trigger another estimate", async () => {
  await POST(request());
  assert.equal((await POST(request({ payload: { ...input, itemHint: "different parts" } }))).status, 409);
  assert.equal(state.calls, 1);
});

test("rate and budget preflights release claims and never invoke the provider", async () => {
  state.limited = true; assert.equal((await POST(request())).status, 429);
  assert.equal(state.operations.size, 0); assert.equal(state.calls, 0);
  state.limited = false; state.budget = true; assert.equal((await POST(request())).status, 402);
  assert.equal(state.operations.size, 0); assert.equal(state.calls, 0);
  state.budget = false; assert.equal((await POST(request())).status, 200);
});

test("provider failure is terminal and replayed without hidden paid retries", async () => {
  state.fail = true;
  assert.equal((await POST(request())).status, 502);
  const response = await POST(request());
  assert.equal(response.status, 502); assert.equal((await response.json()).terminal, true);
  assert.equal(state.calls, 1);
});
