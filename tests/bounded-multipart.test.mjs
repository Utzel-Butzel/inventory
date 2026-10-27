import assert from "node:assert/strict";
import test from "node:test";
import { MultipartBodyTooLargeError, readBoundedMultipart } from "../lib/bounded-multipart.ts";

test("reads image data and structured fields without trusting Content-Length", async () => {
  const body = new FormData();
  body.append("input", JSON.stringify({ test: true }));
  body.append("images", new Blob(["image bytes"], { type: "image/jpeg" }), "test.jpg");
  const parsed = await readBoundedMultipart(new Request("http://localhost", { method: "POST", body }), 4096);
  assert.equal(parsed.get("input"), '{"test":true}');
  assert.equal(await parsed.get("images").text(), "image bytes");
});

test("rejects oversized declared lengths before consuming a body", async () => {
  const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test", "Content-Length": "200" }, body: "small" });
  await assert.rejects(readBoundedMultipart(request, 100), MultipartBodyTooLargeError);
  assert.equal(request.bodyUsed, false);
});

test("cancels a chunked stream that crosses the limit", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(64)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("http://localhost", { method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=test" }, body, duplex: "half" });
  await assert.rejects(readBoundedMultipart(request, 100), MultipartBodyTooLargeError);
  assert.equal(cancelled, true);
});
