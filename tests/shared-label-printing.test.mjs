import test from "node:test";
import assert from "node:assert/strict";
import { encodePtouchRaster } from "../lib/ptouch-raster.ts";
import {
  validateSharedRasters,
  boundedPrintJson,
  sharedPrintSchema,
} from "../lib/shared-label-print-contract.ts";
const raster = () =>
  encodePtouchRaster(
    { width: 8, height: 1, data: new Uint8ClampedArray(32) },
    24,
  );
test("accepts generated series and rejects command injection in every fixed byte", () => {
  const data = raster();
  assert.ok(validateSharedRasters([data, data], 24).length > data.length);
  for (let i = 0; i < 134; i++) {
    const bad = data.slice();
    bad[i] ^= 128;
    assert.throws(
      () => validateSharedRasters([bad], 24),
      undefined,
      `offset ${i}`,
    );
  }
  for (let i = 134; i < data.length - 1; i += 20)
    for (let k = 0; k < 4; k++) {
      const bad = data.slice();
      bad[i + k] ^= 128;
      assert.throws(() => validateSharedRasters([bad], 24));
    }
  const tail = data.slice();
  tail[tail.length - 1] = 12;
  assert.throws(() => validateSharedRasters([tail], 24));
});
test("rejects wrong media, excessive counts, and arbitrary destinations", () => {
  assert.throws(() => validateSharedRasters([raster()], 18));
  assert.throws(() =>
    validateSharedRasters(Array.from({ length: 101 }, raster), 24),
  );
  assert.equal(
    sharedPrintSchema.safeParse({
      id: crypto.randomUUID(),
      printerId: "smb://host/printer",
      tape: 24,
      labels: ["AAAA"],
    }).success,
    false,
  );
});
test("body limit applies without content length and to misleading headers", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    await assert.rejects(
      () =>
        boundedPrintJson(
          new Request("https://example.test", {
            method: "POST",
            headers,
            body: JSON.stringify("x".repeat(5000)),
          }),
          1024,
        ),
      /too large/,
    );
  }
  assert.deepEqual(
    await boundedPrintJson(
      new Request("https://example.test", { method: "POST", body: '{"a":1}' }),
      1024,
    ),
    { a: 1 },
  );
});
