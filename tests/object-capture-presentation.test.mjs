import assert from "node:assert/strict";
import test from "node:test";

import {
  getObjectCapturePresentation,
  getObjectCaptureUploadState,
} from "../lib/object-capture-presentation.ts";

test("recognizes a model plus source photo as an Object Capture bundle", () => {
  assert.equal(
    getObjectCaptureUploadState([
      { name: "scan.usdz", type: "model/vnd.usdz+zip" },
      { name: "article.jpg", type: "image/jpeg" },
    ]),
    "bundle",
  );
  assert.equal(
    getObjectCaptureUploadState([
      { name: "scan.usdz", type: "" },
      { name: "capture-notes.pdf", type: "application/pdf" },
    ]),
    "model-only",
  );
  assert.equal(
    getObjectCaptureUploadState([
      { name: "article.jpg", type: "image/jpeg" },
    ]),
    "none",
  );
});

test("features the first model without repeating the article image in the gallery", () => {
  const cover = {
    id: "cover",
    kind: "image",
    mimeType: "image/png",
    name: "article.png",
  };
  const model = {
    id: "model",
    kind: "model",
    mimeType: "model/vnd.usdz+zip",
    name: "object.usdz",
  };
  const document = {
    id: "document",
    kind: "document",
    mimeType: "application/pdf",
    name: "manual.pdf",
  };

  assert.deepEqual(
    getObjectCapturePresentation([cover, model, document], cover.id),
    { model, gallery: [document] },
  );
});
