import assert from "node:assert/strict";
import test from "node:test";

import {
  mediaImageSupportsVariants,
  mediaImageVariantUrl,
  normalizeMediaImageVariantWidth,
  parseMediaImageVariant,
} from "../lib/media-image.ts";

test("image variants accept only bounded cache-friendly widths", () => {
  assert.equal(normalizeMediaImageVariantWidth("96"), 96);
  assert.equal(normalizeMediaImageVariantWidth(640), 640);
  assert.equal(normalizeMediaImageVariantWidth("641"), null);
  assert.equal(normalizeMediaImageVariantWidth("0"), null);
  assert.equal(normalizeMediaImageVariantWidth("not-a-number"), null);
});

test("authenticated media uses the permission-checked thumbnail route", () => {
  const media = {
    id: "d3e00000-0000-4000-8000-000000000a01",
    url: "/api/files/demo/cover.webp",
  };
  assert.equal(mediaImageSupportsVariants(media), true);
  assert.equal(
    mediaImageVariantUrl(media, 384, "cover"),
    "/api/v1/media/d3e00000-0000-4000-8000-000000000a01/thumbnail/cover/384",
  );
});

test("public share variants retain their share-scoped authorization URL", () => {
  const media = {
    id: "d3e00000-0000-4000-8000-000000000a01",
    url: "/api/public/shares/share-1/media/media-1?download=false",
  };
  assert.equal(
    mediaImageVariantUrl(media, 640, "contain", "public"),
    "/api/public/shares/share-1/media/media-1?download=false&w=640&fit=contain",
  );
  assert.deepEqual(
    parseMediaImageVariant(new URLSearchParams("w=640&fit=contain")),
    { width: 640, fit: "contain" },
  );
  assert.equal(
    parseMediaImageVariant(new URLSearchParams("w=641&fit=contain")),
    null,
  );
});

test("unidentified remote images fall back to their source URL", () => {
  const media = { url: "https://images.example.test/cover.webp" };
  assert.equal(mediaImageSupportsVariants(media), false);
  assert.equal(
    mediaImageVariantUrl(media, 384, "cover"),
    "https://images.example.test/cover.webp",
  );
});
