import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUsdzFileSignature,
  isInlinePublicMediaType,
  isResourceMediaMimeType,
  resourceMediaKind,
  storageProviderSupportsMediaType,
  USDZ_MEDIA_TYPE,
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

test("USDZ package validation requires a local ZIP header", () => {
  assert.equal(hasUsdzFileSignature(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(hasUsdzFileSignature(Uint8Array.from([0x50, 0x4b, 0x05, 0x06])), false);
  assert.equal(hasUsdzFileSignature(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d])), false);
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
