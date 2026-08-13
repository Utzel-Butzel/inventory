import assert from "node:assert/strict";
import test from "node:test";

import {
  isInlinePublicMediaType,
  isResourceMediaMimeType,
  resourceMediaKind,
  storageProviderSupportsMediaType,
  USDZ_MEDIA_TYPE,
  validateObjectScanImage,
  validateResourceMediaUpload,
} from "../lib/resource-media-contract.ts";

test("recognizes canonical USDZ media and classifies it as a model", () => {
  assert.equal(isResourceMediaMimeType(USDZ_MEDIA_TYPE), true);
  assert.equal(isResourceMediaMimeType("application/octet-stream"), false);
  assert.equal(resourceMediaKind(USDZ_MEDIA_TYPE), "model");
  assert.equal(resourceMediaKind("image/jpeg"), "image");
  assert.equal(resourceMediaKind("application/pdf"), "document");
});

test("USDZ uploads require a matching canonical MIME type and extension", () => {
  assert.deepEqual(
    validateResourceMediaUpload(
      { name: "captured-object.USDZ", type: USDZ_MEDIA_TYPE, size: 10 },
      100,
    ),
    { valid: true },
  );

  const wrongExtension = validateResourceMediaUpload(
    { name: "captured-object.zip", type: USDZ_MEDIA_TYPE, size: 10 },
    100,
  );
  assert.equal(wrongExtension.valid, false);
  assert.equal(wrongExtension.status, 415);

  const disguisedImage = validateResourceMediaUpload(
    { name: "captured-object.usdz", type: "image/jpeg", size: 10 },
    100,
  );
  assert.equal(disguisedImage.valid, false);
  assert.equal(disguisedImage.status, 415);
});

test("media upload validation distinguishes size and type failures", () => {
  const tooLarge = validateResourceMediaUpload(
    { name: "large.usdz", type: USDZ_MEDIA_TYPE, size: 101 },
    100,
  );
  assert.equal(tooLarge.valid, false);
  assert.equal(tooLarge.status, 413);

  const unsupported = validateResourceMediaUpload(
    { name: "object.glb", type: "model/gltf-binary", size: 10 },
    100,
  );
  assert.equal(unsupported.valid, false);
  assert.equal(unsupported.status, 415);
});

test("public delivery permits inline USDZ while rejecting executable image MIME", () => {
  assert.equal(isInlinePublicMediaType(USDZ_MEDIA_TYPE), true);
  assert.equal(isInlinePublicMediaType("image/jpeg"), true);
  assert.equal(isInlinePublicMediaType("image/svg+xml"), false);
  assert.equal(isInlinePublicMediaType("application/pdf"), false);
});

test("local storage supports USDZ and Openinary rejects it deterministically", () => {
  assert.equal(storageProviderSupportsMediaType("local", USDZ_MEDIA_TYPE), true);
  assert.equal(storageProviderSupportsMediaType("openinary", USDZ_MEDIA_TYPE), false);
  assert.equal(storageProviderSupportsMediaType("openinary", "image/jpeg"), true);
});

test("Object Capture model uploads require an item image", () => {
  const model = { name: "captured-object.usdz", type: USDZ_MEDIA_TYPE, size: 10 };

  const missing = validateObjectScanImage([], [model]);
  assert.equal(missing.valid, false);
  assert.equal(missing.status, 422);
  assert.match(missing.error, /require an item image/i);

  assert.deepEqual(
    validateObjectScanImage([{ kind: "image", mimeType: "image/jpeg" }], [model]),
    { valid: true },
  );
});

test("Object Capture accepts an image and USDZ in either batch order", () => {
  const model = { type: USDZ_MEDIA_TYPE };
  const image = { type: "image/jpeg" };

  assert.deepEqual(validateObjectScanImage([], [image, model]), { valid: true });
  assert.deepEqual(validateObjectScanImage([], [model, image]), { valid: true });
});

test("ordinary media uploads and legacy model-only reads are unaffected", () => {
  assert.deepEqual(validateObjectScanImage([], [{ type: "application/pdf" }]), {
    valid: true,
  });
  assert.deepEqual(validateObjectScanImage([{ kind: "model" }], []), {
    valid: true,
  });
});
