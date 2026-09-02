import assert from "node:assert/strict";
import test from "node:test";

import {
  documentAreaRatio,
  normalizedCornerMovement,
  orderDocumentCorners,
  scannerFilename,
} from "../lib/document-scanner.ts";

test("orders detected document corners clockwise from the top left", () => {
  assert.deepEqual(
    orderDocumentCorners([
      { x: 940, y: 720 },
      { x: 80, y: 90 },
      { x: 60, y: 700 },
      { x: 920, y: 70 },
    ]),
    [
      { x: 80, y: 90 },
      { x: 920, y: 70 },
      { x: 940, y: 720 },
      { x: 60, y: 700 },
    ],
  );
});

test("measures document coverage and normalized camera movement", () => {
  const first = [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 700 },
    { x: 100, y: 700 },
  ];
  const second = first.map(({ x, y }) => ({ x: x + 10, y: y + 8 }));
  assert.equal(documentAreaRatio(first, 1_000, 800), 0.6);
  assert.ok(normalizedCornerMovement(first, second, 1_000, 800) < 0.02);
});

test("creates portable capture filenames for every generated media type", () => {
  const date = new Date("2026-09-02T08:30:10.120Z");
  assert.equal(
    scannerFilename("photo", "image/jpeg", date),
    "inventory-photo-2026-09-02T08-30-10-120Z.jpg",
  );
  assert.equal(
    scannerFilename("video", "video/webm", date),
    "inventory-video-2026-09-02T08-30-10-120Z.webm",
  );
  assert.equal(
    scannerFilename("document", "application/pdf", date),
    "inventory-document-2026-09-02T08-30-10-120Z.pdf",
  );
});
