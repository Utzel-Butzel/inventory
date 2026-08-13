import assert from "node:assert/strict";
import test from "node:test";

import { printableLabelBarcode } from "../lib/label-barcode.ts";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("label barcode prefers a printable parent barcode over SKU and id", () => {
  assert.equal(
    printableLabelBarcode({ id, barcode: "4006381333931", sku: "SKU-42" }),
    "4006381333931",
  );
  assert.equal(printableLabelBarcode({ id, barcode: null, sku: "SKU-42" }), "SKU-42");
});

test("label barcode falls back to the resource id for unsupported characters", () => {
  assert.equal(printableLabelBarcode({ id, barcode: "emoji-🧰", sku: "SKU-42" }), id);
});
