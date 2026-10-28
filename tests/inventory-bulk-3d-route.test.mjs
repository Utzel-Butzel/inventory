import assert from "node:assert/strict";
import { mock, test, beforeEach } from "node:test";

const identity = { organizationId: "tenant-a", subject: "user-a", userId: "user-a" };
const input = { itemId: "f6387215-fcbf-41de-9a5f-5b132d56d496", language: "en", marks: { pile: [[.2,.2],[.8,.2],[.8,.8],[.2,.8]], table: [[.1,.1],[.9,.1],[.1,.9]], edges: [[[.3,.3],[.4,.3]],[[.4,.4],[.5,.4]],[[.5,.5],[.6,.5]]] }, assumptions: { shape: "cuboid", widthRatio: .8, heightRatio: .8, packing: .6, floorOffset: .6 } };
const key = "4896b0f0-507c-4c3d-ac2e-4e4aecc89f9f";
let state;
beforeEach(() => { state = { denied: false, itemDenied: false, configured: true, limited: false, spawnFailure: false, persistenceFailure: false, operations: new Map(), starts: 0, decodes: 0, assetReads: 0, owner: { organizationId: "tenant-a", actorHash: "actor-a", resourceId: input.itemId, createdAt: Date.now(), expiresAt: Date.now()+100000 }, jobState: { status: "queued" } }; });
mock.module("../lib/api-auth.ts", { namedExports: {
  requirePermission: async () => state.denied ? { response: Response.json({}, { status: 403 }) } : { identity },
  requireResourcePermission: async () => state.itemDenied ? { response: Response.json({}, { status: 404 }) } : { identity },
  hashRequestIdentity: () => "actor-a",
} });
mock.module("../lib/ai.ts", { namedExports: { prepareInventoryCountImage: async () => { state.decodes++; return { dataUrl: "data:image/jpeg;base64,YWJj" }; } } });
mock.module("../lib/storage.ts", { namedExports: { maxUploadBytes: () => 32*1024*1024 } });
mock.module("../lib/ai-rate-limit.ts", { namedExports: { consumePaidAiRateLimit: async () => ({ allowed: !state.limited, disabled: false }), paidAiRateLimitHeaders: () => ({ "Retry-After": "60" }) } });
mock.module("../lib/ai-idempotency.ts", { namedExports: {
  claimAiOperation: async (options) => {
    const old = state.operations.get(options.idempotencyKey);
    if (old) return old.requestHash !== options.requestHash ? { kind: "conflict" } : old.response ? { kind: "replay", operation: old } : { kind: "processing", operation: old };
    state.operations.set(options.idempotencyKey, options); return { kind: "claimed", operationId: options.idempotencyKey };
  },
  releaseAiOperation: async (_org, id) => { state.operations.delete(id); },
  finishAiOperation: async ({ operationId, body, status }) => { if (state.persistenceFailure) throw new Error("database"); Object.assign(state.operations.get(operationId), { response: body, responseStatus: status }); },
} });
mock.module("../lib/inventory-bulk-3d-jobs.ts", { namedExports: {
  bulk3dAvailable: async () => state.configured,
  startBulk3dJob: async (id) => { state.starts++; if (state.spawnFailure) throw new Error("worker"); return { jobId: id, expiresAt: new Date(state.owner.expiresAt).toISOString() }; },
  readBulk3dJob: async () => state.owner,
  readBulk3dState: async () => state.jobState,
  readBulk3dModel: async () => { state.assetReads++; return Buffer.from("glTFtest"); },
} });
const { POST, GET: availability } = await import("../app/api/v1/ai/count/3d/route.ts");
const { GET: poll } = await import("../app/api/v1/ai/count/3d/[jobId]/route.ts");
function request({ count=3, payload=input, idempotencyKey=key, duplicate=false }={}) {
  const form = new FormData(); form.append("input", JSON.stringify(payload));
  for (let i=0;i<count;i++) form.append("images", new Blob([`fake-${duplicate ? 0 : i}`], { type: "image/jpeg" }), `image-${i}.jpg`);
  return new Request("http://localhost/api/v1/ai/count/3d", { method: "POST", body: form, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {} });
}
const get = (asset=false) => poll(new Request(`http://localhost/api/v1/ai/count/3d/${key}${asset ? '?asset=model' : ''}`), { params: Promise.resolve({ jobId: key }) });

test("submits asynchronous work once and replays the same job", async () => {
  const first = await POST(request()); assert.equal(first.status,202);
  const again = await POST(request()); assert.deepEqual(await again.json(), await first.json());
  assert.equal(state.starts,1); assert.equal(state.decodes,3); assert.equal(again.headers.get("cache-control"),"no-store");
  assert.equal((await POST(request({ payload: { ...input, assumptions: { ...input.assumptions, packing: .7 } } }))).status,409);
});
test("blocks permission failures, invalid image counts, duplicates and unconfigured workers before GPU use", async () => {
  state.denied=true; assert.equal((await POST(request())).status,403); state.denied=false;
  state.itemDenied=true; assert.equal((await POST(request())).status,404); state.itemDenied=false;
  assert.equal((await POST(request({ idempotencyKey:null }))).status,400);
  assert.equal((await POST(request({ count:2 }))).status,422); assert.equal((await POST(request({ count:5 }))).status,422);
  assert.equal((await POST(request({ duplicate:true }))).status,422);
  state.configured=false; assert.equal((await POST(request())).status,503);
  assert.equal(state.starts,0); assert.equal(state.decodes,0);
});
test("rate limit and failed spawn release preflight claims; ambiguous persisted results retain the claim", async () => {
  state.limited=true; assert.equal((await POST(request())).status,429); assert.equal(state.operations.size,0);
  state.limited=false; state.spawnFailure=true; assert.equal((await POST(request())).status,503); assert.equal(state.operations.size,0);
  state.spawnFailure=false; state.persistenceFailure=true; assert.equal((await POST(request())).status,202);
  const starts=state.starts; assert.equal((await POST(request())).status,409); assert.equal(state.starts,starts);
});
test("polls and models require matching tenant, actor and current resource access", async () => {
  state.owner.organizationId="tenant-b"; assert.equal((await get()).status,404); assert.equal((await get(true)).status,404);
  state.owner.organizationId="tenant-a"; state.owner.actorHash="another-actor"; assert.equal((await get(true)).status,404);
  state.owner.actorHash="actor-a"; state.itemDenied=true; assert.equal((await get(true)).status,404); assert.equal(state.assetReads,0);
});
test("does not serve unfinished or expired models; completed artifacts are private", async () => {
  assert.deepEqual(await (await get()).json(),{ status:"queued" }); assert.equal((await get(true)).status,409);
  state.owner.expiresAt=Date.now()-1; assert.equal((await get(true)).status,410);
  state.owner.expiresAt=Date.now()+100000; state.jobState={ status:"completed", result:{} };
  const model=await get(true); assert.equal(model.status,200); assert.equal(model.headers.get("cache-control"),"private, no-store"); assert.equal(model.headers.get("content-type"),"model/gltf-binary");
});
test("availability does not expose configuration without article access", async () => {
  assert.equal((await availability(new Request(`http://localhost/api/v1/ai/count/3d?itemId=${"-".repeat(36)}`))).status,422);
  state.itemDenied=true; assert.equal((await availability(new Request(`http://localhost/api/v1/ai/count/3d?itemId=${input.itemId}`))).status,404);
});
