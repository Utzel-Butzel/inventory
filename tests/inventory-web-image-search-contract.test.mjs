import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import { inventoryWebImageSearchResultSchema } from "../lib/inventory-web-image-search-contract.ts";

const format = zodTextFormat(
  inventoryWebImageSearchResultSchema,
  "inventory_web_image_search",
);
const candidate = {
  imageUrl: "https://example.org/image.svg",
  sourcePageUrl: "https://example.org/source",
  title: "Product image",
  altText: "Product",
  attribution: "Manufacturer",
  license: "CC BY 4.0",
  confidence: 0.9,
};

test("image search emits API-compatible URL strings without uri format", () => {
  const schema = format.schema.properties.candidate.anyOf[0];
  for (const field of ["imageUrl", "sourcePageUrl"]) {
    assert.equal(schema.properties[field].type, "string");
    assert.equal(schema.properties[field].format, undefined);
    assert.equal(schema.properties[field].maxLength, 4096);
    assert.ok(schema.required.includes(field));
  }
  assert.equal(format.strict, true);
});

test("SDK parser accepts valid image candidates and no-match results", () => {
  assert.deepEqual(format.$parseRaw(JSON.stringify({ candidate })), { candidate });
  assert.deepEqual(format.$parseRaw('{"candidate":null}'), { candidate: null });
});

test("SDK parser still rejects invalid, missing and oversized URLs", () => {
  for (const field of ["imageUrl", "sourcePageUrl"]) {
    for (const value of ["not a URL", "/relative/image.svg", "", undefined, `https://example.org/${"x".repeat(4096)}`]) {
      assert.throws(() => format.$parseRaw(JSON.stringify({
        candidate: { ...candidate, [field]: value },
      })));
    }
  }
});

test("license filtering is opt-out and no-match errors reflect the selected mode", async () => {
  const { webImageLicenseInstructions, InventoryWebImageNotFoundError } = await import("../lib/inventory-web-image-search-contract.ts");
  assert.match(webImageLicenseInstructions(), /Exclude images whose reuse rights/);
  assert.equal(webImageLicenseInstructions(false), webImageLicenseInstructions());
  assert.match(webImageLicenseInstructions(true), /Do not filter images by license/);
  assert.match(webImageLicenseInstructions(true), /never invent permission/);
  assert.equal(new InventoryWebImageNotFoundError().code, "AI_REUSABLE_IMAGE_NOT_FOUND");
  assert.equal(new InventoryWebImageNotFoundError(true).code, "AI_IMAGE_NOT_FOUND");
});
