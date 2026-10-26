import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  hasVisibleQrImageOverlap,
  labelElementKey,
  labelElementTypes,
  labelElementsSchema,
  labelElementsOverlap,
  MAX_LABEL_ELEMENTS,
  labelSetupCreateSchema,
  labelSetupDeleteSchema,
  labelSetupPatchSchema,
} from "../lib/label-setup-contract.ts";
import { placeNewLabelElement } from "../lib/label-element-layout.ts";
import { DrizzleQueryError } from "drizzle-orm";
import { availableLabelSetupName, isLabelSetupNameConflict } from "../lib/label-setup-name.ts";

test("label copies receive unused names within the API length limit", () => {
  assert.equal(availableLabelSetupName("Kopie von P-touch", []), "Kopie von P-touch");
  assert.equal(availableLabelSetupName("Kopie von P-touch", ["KOPIE VON P-TOUCH", "Kopie von P-touch (2)"]), "Kopie von P-touch (3)");
  const longName = "x".repeat(160);
  const copy = availableLabelSetupName(longName, [longName]);
  assert.equal(copy.length, 160);
  assert.equal(copy, "x".repeat(156) + " (2)");
});

test("duplicate label names are recognized through Drizzle's error cause", () => {
  const cause = Object.assign(new Error("duplicate key"), {
    code: "23505", constraint_name: "label_setups_name_unique",
  });
  assert.equal(isLabelSetupNameConflict(cause), true);
  assert.equal(isLabelSetupNameConflict(new DrizzleQueryError("insert into label_setups", [], cause)), true);
  assert.equal(isLabelSetupNameConflict({code: "23505", constraint_name: "another_index"}), false);
  assert.equal(isLabelSetupNameConflict(new Error("query with label_setups_name_unique in user input")), false);
  const cyclic = {}; cyclic.cause = cyclic;
  assert.equal(isLabelSetupNameConflict(cyclic), false);
});

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

test("rejects zero-sized boxes and ambiguous legacy instances without IDs", () => {
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

test("subtitle is an independently configurable text element alongside the title", () => {
  const subtitle = { type: "subtitle", x: 30, y: 65, width: 50, height: 25, visible: true, fontFamily: "sans", fontSizeMm: 2.3, minFontSizeMm: 1.5, textOverflow: "shrink" };
  assert.equal(labelElementsSchema.safeParse([...elements, subtitle]).success, true);
  assert.equal(labelElementsSchema.safeParse([subtitle, subtitle]).success, false);
});

test("multiple instances of every element type retain their identities through create and patch", () => {
  const instances = labelElementTypes.flatMap(type => [0, 1].map(index => ({
    type, id: randomUUID(), x: type === "image" ? 50 : 0, y: index * 30,
    width: 20, height: 20, visible: true,
    ...(type === "text" ? { content: [{ text: `Copy ${index}: [Title]` }] } : {}),
  })));
  const saved = labelSetupCreateSchema.parse({ name: "Multiple instances", widthMm: 80, heightMm: 18, elements: instances });
  assert.deepEqual(saved.elements, instances);
  assert.deepEqual(labelSetupPatchSchema.parse(JSON.parse(JSON.stringify({ revision: 1, elements: saved.elements }))).elements, instances);
  assert.equal(new Set(instances.map(labelElementKey)).size, instances.length);
});

test("new instances coexist with untouched legacy elements, but IDs must be unique across types", () => {
  const old = elements.find(element => element.type === "qr");
  const additional = { ...old, id: randomUUID(), x: 50 };
  assert.deepEqual(labelElementsSchema.parse([old, additional]), [old, additional]);
  assert.equal(labelElementKey(old), "qr");
  assert.equal(labelElementKey(additional), additional.id);
  assert.equal(labelElementsSchema.safeParse([additional, additional]).success, false);
  const conflictingName = { type: "name", id: additional.id, x: 0, y: 0, width: 20, height: 20, visible: false };
  assert.equal(labelElementsSchema.safeParse([additional, conflictingName]).success, false);
  assert.equal(labelElementsSchema.safeParse([{ ...additional, id: "name" }]).success, false);
});

test("the element limit counts instances, including hidden ones", () => {
  const instances = Array.from({ length: MAX_LABEL_ELEMENTS }, () => ({
    type: "name", id: randomUUID(), x: 0, y: 0, width: 20, height: 20, visible: false,
  }));
  assert.equal(labelElementsSchema.safeParse(instances).success, true);
  assert.equal(labelElementsSchema.safeParse([...instances, { ...instances[0], id: randomUUID() }]).success, false);
});

test("overlap checks consider every visible QR and image instance and identify the offending image", () => {
  const box = { y: 0, width: 20, height: 20, visible: true };
  const instances = [
    { type: "qr", id: randomUUID(), ...box, x: 0 },
    { type: "qr", id: randomUUID(), ...box, x: 75 },
    { type: "image", id: randomUUID(), ...box, x: 25 },
    { type: "image", id: randomUUID(), ...box, x: 75 },
  ];
  assert.equal(hasVisibleQrImageOverlap(instances), true);
  const rejected = labelElementsSchema.safeParse(instances);
  assert.equal(rejected.success, false);
  assert.deepEqual(rejected.error.issues[0].path, [3]);
  assert.equal(labelElementsSchema.safeParse(instances.map((item, i) => i === 3 ? { ...item, visible: false } : item)).success, true);
  assert.equal(labelElementsSchema.safeParse(instances.map((item, i) => i === 1 ? { ...item, visible: false } : item)).success, true);
  assert.equal(labelElementsSchema.safeParse(instances.map((item, i) => i === 3 ? { ...item, x: 50 } : item)).success, true);
});

test("adding repeated elements finds available space without moving or resizing existing instances", () => {
  const existing = [
    { type: "qr", x: 5, y: 5, width: 30, height: 25, visible: true },
    { type: "qr", id: randomUUID(), x: 40, y: 5, width: 30, height: 25, visible: true },
    { type: "name", x: 0, y: 50, width: 100, height: 25, visible: true },
  ];
  const before = structuredClone(existing);
  for (const type of ["qr", "image", "name", "barcode"]) {
    const newElement = { type, id: randomUUID(), x: 5, y: 5, width: 20, height: 20, visible: true };
    const placed = placeNewLabelElement(newElement, existing);
    assert.equal(placed.id, newElement.id);
    assert.equal(placed.width, newElement.width);
    assert.equal(placed.height, newElement.height);
    assert.ok(existing.every(item => !labelElementsOverlap(placed, item)));
    assert.equal(labelElementsSchema.safeParse([...existing, placed]).success, true);
  }
  assert.deepEqual(existing, before);
});

test("placement ignores backgrounds and hidden instances, and preserves QR readability on crowded labels", () => {
  const box = { x: 5, y: 5, width: 30, height: 25, visible: true };
  const newImage = { type: "image", id: randomUUID(), ...box };
  const background = { type: "background", x: 0, y: 0, width: 100, height: 100, visible: true };
  assert.deepEqual(placeNewLabelElement(newImage, [background, { type: "qr", ...box, visible: false }]), newImage);
  assert.deepEqual(placeNewLabelElement(background, [newImage]), background);
  const crowded = [{ ...background, type: "name" }, { type: "qr", ...box }];
  const placed = placeNewLabelElement(newImage, crowded);
  assert.equal(hasVisibleQrImageOverlap([...crowded, placed]), false);
  assert.equal(labelElementsSchema.safeParse([...crowded, placed]).success, true);
  const fullQr = { ...background, type: "qr" };
  const needsPlacement = placeNewLabelElement(newImage, [fullQr]);
  assert.equal(hasVisibleQrImageOverlap([fullQr, needsPlacement]), true);
  assert.deepEqual(fullQr, { ...background, type: "qr" });
});

test("custom images persist their source and retain crop/print options", async () => {
  const { labelImageSource, labelNeedsProductImage } = await import('../lib/label-image-source.ts');
  const source = 'data:image/png;base64,aGVsbG8=';
  const image = { type: 'image', id: randomUUID(), x: 40, y: 0, width: 30, height: 60, visible: true, source, altText: 'Logo', fit: 'contain', cropWhiteMargins: true, photoOptimization: 'auto' };
  const parsed = labelElementsSchema.parse([image]);
  assert.equal(parsed[0].source, source);
  assert.equal(labelImageSource(parsed[0], { cover: null }), source);
  assert.equal(labelNeedsProductImage(parsed), false);
  assert.equal(labelNeedsProductImage([{...image,source:undefined}]), true);
  assert.equal(labelNeedsProductImage([{...image,source:undefined,visible:false}]), false);
  assert.equal(labelElementsSchema.safeParse([{...image,source:'https://tracking.example/image'}]).success, false);
});

test("duplicating and layering preserve original image content and identities", async () => {
  const { duplicateLabelElement, moveLabelElement } = await import('../lib/label-element-layout.ts');
  const original = { type: 'image', id: randomUUID(), x: 0, y: 0, width: 20, height: 20, visible: true, source: 'data:image/png;base64,aGVsbG8=' };
  const duplicate = duplicateLabelElement(original, [original], randomUUID());
  assert.notEqual(duplicate.id, original.id);
  assert.equal(duplicate.source, original.source);
  assert.deepEqual([original.x,original.y],[0,0]);
  assert.equal(labelElementsSchema.safeParse([original,duplicate]).success,true);
  const front = moveLabelElement([original,duplicate],original.id,'front');
  assert.deepEqual(front.map(x=>x.id),[duplicate.id,original.id]);
  const back = moveLabelElement(front,original.id,'back');
  assert.deepEqual(back.map(x=>x.id),[original.id,duplicate.id]);
});
