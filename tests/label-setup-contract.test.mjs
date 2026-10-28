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
import { automaticLabelText, resolveLabelLayout, labelQrColors } from "../lib/label-dynamic-layout.ts";
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

test("extended typography survives saving and keeps old template defaults", async () => {
  const { defaultLabelFontWeight, defaultLabelFontSize, pointsToMm, mmToPoints } = await import('../lib/label-typography.ts');
  const base = { type: 'name', x: 0, y: 0, width: 50, height: 50, visible: true };
  for (const fontFamily of ['inter', 'roboto', 'roboto-condensed', 'nunito-sans', 'barlow-semi-condensed']) {
    for (const fontWeight of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      const element = { ...base, fontFamily, fontWeight, letterSpacingEm: -0.05, lineHeight: 2.5, fontSizeMm: pointsToMm(12), content: [{ text: '[Title]', weight: fontWeight }] };
      assert.deepEqual(labelElementsSchema.parse([element])[0], element);
    }
  }
  for (const patch of [{ fontWeight: 650 }, { fontWeight: 1000 }, { letterSpacingEm: -1 }, { letterSpacingEm: 2 }, { lineHeight: 3.1 }]) {
    assert.equal(labelElementsSchema.safeParse([{ ...base, ...patch }]).success, false);
  }
  assert.equal(defaultLabelFontWeight(base), 800);
  assert.equal(defaultLabelFontWeight({ ...base, fontFamily: 'barlow-semi-condensed' }), 700);
  assert.equal(defaultLabelFontWeight({ ...base, content: [{ text: '[Title]' }] }), 400);
  assert.equal(defaultLabelFontWeight({ ...base, fontWeight: 600 }), 600);
  assert.equal(defaultLabelFontSize(base), 3.8);
  assert.ok(Math.abs(mmToPoints(pointsToMm(12)) - 12) < 1e-10);
});

test("keyboard nudging uses physical dimensions and respects every label edge", async () => {
  const { labelNudge } = await import('../lib/label-editor-keyboard.ts');
  const element = { type: 'image', x: 20, y: 30, width: 20, height: 40, visible: true };
  assert.deepEqual(labelNudge(element, 'ArrowRight', false, 80, 20), { x: 20.125, y: 30 });
  assert.deepEqual(labelNudge(element, 'ArrowUp', true, 80, 20), { x: 20, y: 25 });
  assert.deepEqual(labelNudge({ ...element, x: 80, y: 60 }, 'ArrowRight', true, 80, 20), { x: 80, y: 60 });
  assert.deepEqual(labelNudge({ ...element, x: 0, y: 0 }, 'ArrowLeft', true, 80, 20), { x: 0, y: 0 });
  assert.equal(labelNudge(element, 'Delete', false, 80, 20), null);
  assert.equal(labelNudge({ ...element, type: 'background' }, 'ArrowRight', false, 80, 20), null);
});

test("every hosted font face has its matching preview CSS, binary and license", async () => {
  const { LABEL_FONT_FACES } = await import('../lib/label-font-faces.ts');
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../components/label-printer.module.css', import.meta.url), 'utf8');
  for (const face of LABEL_FONT_FACES) {
    assert.ok(css.includes(`/fonts/label-print/${face.file}`));
    assert.ok((await fs.stat(new URL(`../public/fonts/label-print/${face.file}`, import.meta.url))).size > 1000);
    const family = face.file.split('-')[0];
    assert.match(await fs.readFile(new URL(`../public/fonts/label-print/${family}-OFL.txt`, import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE/);
  }
});

test("raster font embedding distinguishes related family names and uses real weights and italics", async () => {
  const { selectLabelFontFace } = await import('../lib/label-fonts.ts');
  assert.equal(selectLabelFontFace('"Inventory Roboto Condensed", sans-serif', 600, 'normal').file, 'RobotoCondensed-Variable.ttf');
  assert.equal(selectLabelFontFace('"Inventory Roboto", sans-serif', 600, 'italic').file, 'Roboto-Italic-Variable.ttf');
  assert.equal(selectLabelFontFace('"Inventory Barlow Semi Condensed", sans-serif', 900, 'normal').file, 'BarlowSemiCondensed-Black.ttf');
  assert.equal(selectLabelFontFace('"Inventory Barlow Semi Condensed", sans-serif', 500, 'italic').file, 'BarlowSemiCondensed-MediumItalic.ttf');
  assert.equal(selectLabelFontFace('system-ui, sans-serif', 700, 'normal'), undefined);
});

test("inversion is optional for old templates and can be saved, copied and disabled", () => {
  const setup = { name: 'Negative label', widthMm: 80, heightMm: 18, elements: [] };
  assert.equal(labelSetupCreateSchema.parse(setup).inverted, undefined);
  assert.equal(labelSetupCreateSchema.parse({ ...setup, inverted: true }).inverted, true);
  assert.deepEqual(labelSetupPatchSchema.parse({ revision: 1, inverted: false }), { revision: 1, inverted: false });
  assert.equal(labelSetupCreateSchema.safeParse({ ...setup, inverted: 'true' }).success, false);
});

const dynamicSetup = {
  id: "dynamic", name: "QR / text / image", widthMm: 80, heightMm: 18,
  revision: 1, createdAt: "", updatedAt: "",
  elements: [
    { type: "background", x: 0, y: 0, width: 100, height: 100, visible: true },
    { type: "qr", x: 2.5, y: 0, width: 20, height: 100, visible: true },
    { type: "name", x: 25, y: 0, width: 50, height: 100, visible: true, autoWidth: true },
    { type: "image", x: 77.5, y: 0, width: 20, height: 100, visible: true },
  ],
};
const physicalBox = (setup, type) => {
  const element = setup.elements.find(element => element.type === type);
  return { x: element.x * setup.widthMm / 100, width: element.width * setup.widthMm / 100 };
};

test("dynamic length grows and shrinks while QR and image sizes and gaps stay fixed", () => {
  const original = structuredClone(dynamicSetup);
  for (const textWidth of [0, 10, 40, 120]) {
    const result = resolveLabelLayout(dynamicSetup, textWidth);
    const expectedWidth = Math.max(0.1, textWidth);
    assert.ok(Math.abs(result.widthMm - (40 + expectedWidth)) < 1e-9);
    assert.ok(Math.abs(physicalBox(result, "qr").x - 2) < 1e-9);
    assert.ok(Math.abs(physicalBox(result, "qr").width - 16) < 1e-9);
    const text = physicalBox(result, "name");
    const image = physicalBox(result, "image");
    assert.ok(Math.abs(text.x - 20) < 1e-9);
    assert.ok(Math.abs(text.width - expectedWidth) < 1e-9);
    assert.ok(Math.abs(image.x - (22 + expectedWidth)) < 1e-9);
    assert.ok(Math.abs(image.width - 16) < 1e-9);
    assert.ok(Math.abs(result.widthMm - image.x - image.width - 2) < 1e-9);
    assert.equal(result.heightMm, 18);
    assert.equal(result.elements[0].width, 100);
    assert.equal(hasVisibleQrImageOverlap(result.elements), false);
  }
  assert.deepEqual(dynamicSetup, original);
});

test("fixed and hidden automatic text retain the template dimensions", () => {
  for (const patch of [{ autoWidth: false }, { visible: false }]) {
    const setup = { ...dynamicSetup, elements: dynamicSetup.elements.map(element => element.type === "name" ? { ...element, ...patch } : element) };
    assert.equal(automaticLabelText(setup.elements), undefined);
    assert.equal(resolveLabelLayout(setup, 120), setup);
  }
  assert.equal(resolveLabelLayout(dynamicSetup, NaN), dynamicSetup);
});

test("shortening does not cut off another row or shift an image over fixed content", () => {
  const setup = { ...dynamicSetup, elements: [...dynamicSetup.elements,
    { type: "subtitle", x: 25, y: 0, width: 50, height: 25, visible: true },
  ] };
  const result = resolveLabelLayout(setup, 1);
  assert.ok(physicalBox(result, "image").x >= 60);
  assert.equal(hasVisibleQrImageOverlap(result.elements), false);
  const secondRow = { ...dynamicSetup, elements: [...dynamicSetup.elements,
    { type: "subtitle", x: 0, y: 0, width: 100, height: 10, visible: true },
  ] };
  assert.ok(resolveLabelLayout(secondRow, 1).widthMm >= 80);
});

test("automatic text and explicit layers survive persistence, and competing automatic fields are rejected", async () => {
  const { moveLabelElement, duplicateLabelElement } = await import("../lib/label-element-layout.ts");
  const elements = moveLabelElement(dynamicSetup.elements, "background", "front");
  const payload = { name: dynamicSetup.name, widthMm: 80, heightMm: 18, elements };
  assert.deepEqual(labelSetupCreateSchema.parse(JSON.parse(JSON.stringify(payload))), payload);
  assert.deepEqual(labelSetupPatchSchema.parse({ revision: 1, elements }).elements, elements);
  const duplicate = duplicateLabelElement(elements.find(element => element.type === "name"), elements, randomUUID());
  assert.equal(duplicate.autoWidth, false);
  assert.equal(duplicate.layer, undefined);
  assert.equal(labelElementsSchema.safeParse([...elements, duplicate]).success, true);
  assert.equal(labelElementsSchema.safeParse([...elements, { ...duplicate, autoWidth: true }]).success, false);
  assert.equal(labelElementsSchema.safeParse([{ ...elements[0], layer: -1 }]).success, false);
  assert.equal(labelElementsSchema.safeParse([{ ...dynamicSetup.elements[1], autoWidth: true }]).success, false);
});

test("layers move one step or to either end, including legacy backgrounds", async () => {
  const { moveLabelElement, orderedLabelElements } = await import("../lib/label-element-layout.ts");
  const legacy = [dynamicSetup.elements[1], dynamicSetup.elements[2], dynamicSetup.elements[0]];
  assert.deepEqual(orderedLabelElements(legacy).map(e => e.type), ["background", "qr", "name"]);
  const forward = moveLabelElement(legacy, "background", "forward");
  assert.deepEqual(orderedLabelElements(forward).map(e => e.type), ["qr", "background", "name"]);
  const front = moveLabelElement(forward, "background", "front");
  assert.deepEqual(orderedLabelElements(front).map(e => e.type), ["qr", "name", "background"]);
  assert.equal(moveLabelElement(front, "background", "forward"), front);
  assert.deepEqual(orderedLabelElements(moveLabelElement(front, "background", "backward")).map(e => e.type), ["qr", "background", "name"]);
  assert.deepEqual(orderedLabelElements(moveLabelElement(front, "background", "back")).map(e => e.type), ["background", "qr", "name"]);
  assert.equal(moveLabelElement(legacy, "missing", "back"), legacy);
});

test("inverted QR codes have white modules and a black background; normal colors are preserved", () => {
  const qr = { ...dynamicSetup.elements[1], foregroundColor: "#112233", backgroundColor: "#ddeeff" };
  assert.deepEqual(labelQrColors(true, qr), { foregroundColor: "#ffffff", backgroundColor: "#000000" });
  assert.deepEqual(labelQrColors(false, qr), { foregroundColor: "#112233", backgroundColor: "#ddeeff" });
  assert.deepEqual(labelQrColors(undefined, dynamicSetup.elements[1]), { foregroundColor: "#000000", backgroundColor: "#ffffff" });
});

test("print dimensions use the final measured label after fonts settle, with legacy fallback and size limits", async () => {
  const { readyLabelDimensions } = await import("../lib/label-print-dimensions.ts");
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  const node = { dataset: {} };
  globalThis.document = { fonts: { ready: Promise.resolve().then(() => {
    node.dataset.labelWidthMm = "124.75";
    node.dataset.labelHeightMm = "18";
  }) } };
  globalThis.requestAnimationFrame = callback => { queueMicrotask(callback); return 1; };
  try {
    assert.deepEqual(await readyLabelDimensions(node, 80, 18), { widthMm: 124.75, heightMm: 18 });
    assert.deepEqual(await readyLabelDimensions({ dataset: {} }, 62, 35), { widthMm: 62, heightMm: 35 });
    for (const width of ["1001", "NaN", "0", "-10"]) {
      await assert.rejects(readyLabelDimensions({ dataset: { labelWidthMm: width } }, 80, 18), /dimensions exceed/);
    }
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});
