import test from "node:test";
import assert from "node:assert/strict";
import { mediaByteResponse } from "../lib/media-byte-response.ts";
const bytes = new TextEncoder().encode("0123456789");
test("video delivery supports bounded, open-ended and suffix byte ranges", async () => {
  for (const [range, expected, contentRange] of [["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=8-", "89", "bytes 8-9/10"], ["bytes=-3", "789", "bytes 7-9/10"]]) {
    const response = mediaByteResponse(bytes, range, { "Content-Type": "video/mp4", Vary: "Cookie" });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), contentRange);
    assert.equal(response.headers.get("Vary"), "Cookie");
    assert.equal(await response.text(), expected);
  }
});
test("unsatisfiable ranges never return the full file", () => {
  for (const range of ["bytes=10-", "bytes=6-2", "bytes=-0", "bytes=0-1,4-5", "invalid"]) {
    const response = mediaByteResponse(bytes, range, {});
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */10");
  }
});
test("requests without a range retain complete file delivery", async () => {
  const response = mediaByteResponse(bytes, null, {});
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "0123456789");
});
