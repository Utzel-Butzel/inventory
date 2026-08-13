import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SUPPORTED_BARCODE_FORMATS } from "../lib/barcode-scanner.ts";

test("scanner enables common one- and two-dimensional code families", () => {
  const formats = new Set(SUPPORTED_BARCODE_FORMATS);

  assert.equal(formats.size, SUPPORTED_BARCODE_FORMATS.length);
  for (const format of [
    "qr_code",
    "data_matrix",
    "aztec",
    "pdf417",
    "code_128",
    "ean_13",
    "upc_a",
    "itf",
  ]) {
    assert.equal(formats.has(format), true, `${format} should be scannable`);
  }
});

test("the self-hosted decoder binary matches the installed ZXing reader", async () => {
  const [publicWasm, installedWasm] = await Promise.all([
    readFile(new URL("../public/barcodes/zxing_reader.wasm", import.meta.url)),
    readFile(
      new URL(
        "../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
        import.meta.url,
      ),
    ),
  ]);
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");

  assert.equal(publicWasm.byteLength > 500_000, true);
  assert.equal(sha256(publicWasm), sha256(installedWasm));
});
