import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./support/typescript-paths-loader.mjs", import.meta.url));

const {
  createInventoryCountResult,
  createVerifiedInventoryCountResult,
  inventoryCountDetectionSchema,
  markerFromAnchorBox,
  reconcileInventoryCountLocalizationPasses,
  validateAndDedupeInventoryCountDetections,
} = await import("../lib/inventory-count-localization.ts");

const detection = (overrides = {}) => ({
  box: { left: 100, top: 100, right: 300, bottom: 300 },
  anchorBox: { left: 110, top: 180, right: 130, bottom: 200 },
  visibleOpening: false,
  backgroundBox: { left: 320, top: 180, right: 340, bottom: 200 },
  confidence: 0.9,
  occluded: false,
  ...overrides,
});

const localization = (detections) => ({
  confidence: 0.95,
  detectedItem: "plastic frames",
  isExact: true,
  explanation: "Each visible frame was independently verified.",
  warnings: [],
  detections,
});

test("places a marker at the center of the material-bound anchor box", () => {
  assert.deepEqual(
    markerFromAnchorBox({ left: 111, top: 201, right: 132, bottom: 224 }),
    { x: 122, y: 213 },
  );
});

test("places a hollow-frame marker on its strut instead of the empty box center", () => {
  const hollowFrame = detection({
    box: { left: 100, top: 100, right: 300, bottom: 300 },
    // The visible left strut is x=100...130; the geometric object center
    // (200,200) is the empty opening and must never be used as the marker.
    anchorBox: { left: 108, top: 180, right: 126, bottom: 220 },
  });
  const result = createInventoryCountResult(localization([hollowFrame]));

  assert.deepEqual(result.markers, [{ x: 117, y: 200 }]);
  assert.notDeepEqual(result.markers[0], { x: 200, y: 200 });
});

test("rejects an anchor box outside its target box", () => {
  const parsed = inventoryCountDetectionSchema.safeParse(
    detection({
      anchorBox: { left: 90, top: 180, right: 130, bottom: 200 },
    }),
  );
  assert.equal(parsed.success, false);
});

test("deduplicates only near-identical target and anchor localizations", () => {
  const first = detection({ confidence: 0.8 });
  const duplicate = detection({
    box: { left: 101, top: 101, right: 301, bottom: 301 },
    anchorBox: { left: 111, top: 181, right: 131, bottom: 201 },
    confidence: 0.95,
  });
  const result = validateAndDedupeInventoryCountDetections([
    first,
    duplicate,
  ]);

  assert.equal(result.detections.length, 1);
  assert.equal(result.removedDuplicates, 1);
  assert.equal(result.detections[0].confidence, 0.95);
});

test("preserves genuinely distinct objects even when their boxes overlap", () => {
  const result = validateAndDedupeInventoryCountDetections([
    detection(),
    detection({
      box: { left: 120, top: 110, right: 320, bottom: 310 },
      anchorBox: { left: 270, top: 200, right: 290, bottom: 220 },
    }),
  ]);

  assert.equal(result.detections.length, 2);
  assert.equal(result.removedDuplicates, 0);
});

test("does not emit the same displayed marker for two detections", () => {
  const result = validateAndDedupeInventoryCountDetections([
    detection(),
    detection({
      box: { left: 50, top: 50, right: 350, bottom: 350 },
      anchorBox: { left: 111, top: 181, right: 129, bottom: 199 },
      backgroundBox: { left: 360, top: 180, right: 380, bottom: 200 },
    }),
  ]);

  assert.equal(result.detections.length, 1);
  assert.equal(result.removedDuplicates, 1);
});

test("derives count and markers exclusively from accepted detections", () => {
  const accepted = detection({ confidence: 0.83 });
  const tooUncertain = detection({
    box: { left: 500, top: 500, right: 700, bottom: 700 },
    anchorBox: { left: 510, top: 580, right: 530, bottom: 600 },
    confidence: 0.2,
  });
  const result = createInventoryCountResult(
    localization([accepted, tooUncertain]),
  );

  assert.equal(result.count, 1);
  assert.equal(result.markers.length, 1);
  assert.deepEqual(result.markers[0], { x: 120, y: 190 });
  assert.equal(result.isExact, false);
  assert.equal(result.confidence, 0.75);
  assert.equal(result.warnings.length, 1);
});

test("caps aggregate confidence at the least-confident accepted detection", () => {
  const result = createInventoryCountResult(
    localization([
      detection({ confidence: 0.91 }),
      detection({
        box: { left: 500, top: 500, right: 700, bottom: 700 },
        anchorBox: { left: 510, top: 580, right: 530, bottom: 600 },
        confidence: 0.62,
      }),
    ]),
  );

  assert.equal(result.count, 2);
  assert.equal(result.confidence, 0.62);
});

const frameRaster = () => {
  const width = 100;
  const height = 100;
  const channels = 3;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isFrame =
        x >= 10 &&
        x < 90 &&
        y >= 10 &&
        y < 90 &&
        (x < 25 || x >= 75 || y < 25 || y >= 75);
      const color = isFrame ? [18, 20, 22] : [220, 205, 178];
      const offset = (y * width + x) * channels;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
    }
  }
  return { width, height, channels, data };
};

const hollowDetection = (overrides = {}) =>
  detection({
    box: { left: 100, top: 100, right: 900, bottom: 900 },
    anchorBox: { left: 160, top: 450, right: 230, bottom: 550 },
    visibleOpening: true,
    backgroundBox: { left: 400, top: 400, right: 600, bottom: 600 },
    ...overrides,
  });

test("requires independent passes to agree on the same material patch", () => {
  const first = localization([hollowDetection()]);
  const second = localization([
    hollowDetection({
      anchorBox: { left: 770, top: 450, right: 840, bottom: 550 },
    }),
  ]);
  const reconciled = reconcileInventoryCountLocalizationPasses(first, second);

  assert.equal(reconciled.detections.length, 0);
  assert.equal(reconciled.removedUnconfirmed, 2);
});

test("uses real pixels to place a hollow-frame marker on its dark strut", () => {
  const first = localization([hollowDetection()]);
  const second = localization([
    hollowDetection({
      anchorBox: { left: 170, top: 460, right: 240, bottom: 560 },
      backgroundBox: { left: 410, top: 410, right: 610, bottom: 610 },
    }),
  ]);
  const result = createVerifiedInventoryCountResult(
    first,
    second,
    frameRaster(),
  );

  assert.equal(result.count, 1);
  assert.equal(result.markers.length, 1);
  assert.ok(result.markers[0].x >= 170 && result.markers[0].x <= 230);
  assert.ok(result.markers[0].y >= 460 && result.markers[0].y <= 550);
  assert.notDeepEqual(result.markers[0], { x: 500, y: 500 });
});

test("rejects a hollow-frame marker when material and hole boxes are swapped", () => {
  const swapped = hollowDetection({
    anchorBox: { left: 400, top: 400, right: 600, bottom: 600 },
    backgroundBox: { left: 160, top: 450, right: 230, bottom: 550 },
  });
  const result = createVerifiedInventoryCountResult(
    localization([swapped]),
    localization([swapped]),
    frameRaster(),
  );

  assert.equal(result.count, 0);
  assert.equal(result.markers.length, 0);
  assert.equal(result.isExact, false);
  assert.match(result.warnings.join(" "), /image pixels/i);
});

test("cannot bypass pixel verification by claiming a hole is not an opening", () => {
  const falseSolidClaim = hollowDetection({
    anchorBox: { left: 400, top: 400, right: 600, bottom: 600 },
    visibleOpening: false,
    backgroundBox: { left: 10, top: 450, right: 80, bottom: 550 },
  });
  const result = createVerifiedInventoryCountResult(
    localization([falseSolidClaim]),
    localization([falseSolidClaim]),
    frameRaster(),
  );

  assert.equal(result.count, 0);
  assert.equal(result.markers.length, 0);
  assert.equal(result.isExact, false);
});
