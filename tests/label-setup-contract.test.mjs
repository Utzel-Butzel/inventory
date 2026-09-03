import assert from "node:assert/strict";
import test from "node:test";

import {
  hasVisibleQrImageOverlap,
  labelElementsSchema,
  labelSetupCreateSchema,
  labelSetupDeleteSchema,
  labelSetupPatchSchema,
} from "../lib/label-setup-contract.ts";

const elements = [
  {
    type: "background",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    source:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    fit: "cover",
    opacity: 0.5,
  },
  {
    type: "qr",
    x: 0,
    y: 0,
    width: 25,
    height: 50,
    visible: true,
    foregroundColor: "#102030",
    backgroundColor: "#fefefe",
    quietZoneModules: 2,
  },
  {
    type: "image",
    x: 25,
    y: 0,
    width: 25,
    height: 50,
    visible: true,
    fit: "contain",
  },
  {
    type: "name",
    x: 50,
    y: 0,
    width: 50,
    height: 10,
    visible: true,
    fontSizeMm: 3.5,
    minFontSizeMm: 1,
    fontFamily: "serif",
    align: "center",
    textOverflow: "shrink",
  },
  {
    type: "identifier",
    x: 50,
    y: 10,
    width: 50,
    height: 10,
    visible: true,
  },
  {
    type: "barcode",
    x: 50,
    y: 20,
    width: 50,
    height: 20,
    visible: true,
  },
  {
    type: "url",
    x: 50,
    y: 40,
    width: 50,
    height: 10,
    visible: false,
    align: "right",
  },
  {
    type: "location",
    x: 0,
    y: 50,
    width: 100,
    height: 50,
    visible: true,
    fontSizeMm: 2,
  },
];

test("accepts a setup with each supported element type exactly once", () => {
  const parsed = labelSetupCreateSchema.parse({
    name: "  Workshop label  ",
    widthMm: 62,
    heightMm: 35,
    elements,
  });
  assert.equal(parsed.name, "Workshop label");
  assert.deepEqual(parsed.elements, elements);
});

test("accepts an embedded SVG label background", () => {
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "background",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        visible: true,
        source:
          "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      },
    ]).success,
    true,
  );
});

test("rejects boxes that extend beyond the normalized label", () => {
  assert.equal(
    labelElementsSchema.safeParse([
      { type: "qr", x: 80, y: 0, width: 21, height: 20, visible: true },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      { type: "qr", x: 0, y: 90, width: 20, height: 11, visible: true },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "background",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        visible: true,
        source: "https://example.com/background.svg",
      },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "qr",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        visible: true,
        quietZoneModules: 5,
      },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "name",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        visible: true,
        fontFamily: "comic-sans",
      },
    ]).success,
    false,
  );
});

test("rejects zero-sized boxes and duplicate element types", () => {
  assert.equal(
    labelElementsSchema.safeParse([
      { type: "qr", x: 0, y: 0, width: 0, height: 20, visible: true },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      { type: "qr", x: 0, y: 0, width: 20, height: 20, visible: true },
      { type: "qr", x: 20, y: 0, width: 20, height: 20, visible: false },
    ]).success,
    false,
  );
});

test("allows only type-specific element options", () => {
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "image",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        visible: true,
        align: "center",
      },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "barcode",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        visible: true,
        fit: "cover",
      },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "qr",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        visible: true,
        textOverflow: "ellipsis",
      },
    ]).success,
    false,
  );
  assert.equal(
    labelElementsSchema.safeParse([
      {
        type: "name",
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        visible: true,
        textOverflow: "clip",
      },
    ]).success,
    false,
  );
});

test("requires a positive revision and at least one PATCH change", () => {
  assert.equal(labelSetupPatchSchema.safeParse({ revision: 1 }).success, false);
  assert.equal(
    labelSetupPatchSchema.safeParse({ revision: 0, name: "Updated" }).success,
    false,
  );
  assert.deepEqual(labelSetupPatchSchema.parse({ revision: 2, widthMm: 102 }), {
    revision: 2,
    widthMm: 102,
  });
});

test("requires a positive revision for deletion", () => {
  assert.equal(labelSetupDeleteSchema.safeParse({ revision: null }).success, false);
  assert.equal(labelSetupDeleteSchema.safeParse({ revision: "0" }).success, false);
  assert.deepEqual(labelSetupDeleteSchema.parse({ revision: "3" }), {
    revision: 3,
  });
});

test("detects only visible QR and image overlap", () => {
  const qr = { type: "qr", x: 0, y: 0, width: 25, height: 25, visible: true };
  const image = {
    type: "image",
    x: 20,
    y: 0,
    width: 25,
    height: 25,
    visible: true,
    fit: "cover",
  };
  assert.equal(hasVisibleQrImageOverlap([qr, image]), true);
  assert.equal(labelElementsSchema.safeParse([qr, image]).success, false);
  assert.equal(
    hasVisibleQrImageOverlap([qr, { ...image, x: 25 }]),
    false,
  );
  assert.equal(
    hasVisibleQrImageOverlap([qr, { ...image, visible: false }]),
    false,
  );
});
