import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLabelTextContent, formatLabelText, labelPlaceholderValues,
  labelUsesPlaceholder, normalizeLabelText, replaceLabelText, resolveLabelText,
} from "../lib/label-rich-text.ts";
import { labelElementsSchema, labelSetupCreateSchema, labelSetupPatchSchema, labelTextContentSchema } from "../lib/label-setup-contract.ts";
import { applyLabelTextOverride } from "../lib/label-target.ts";

const resource = { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", name: "Drill", subtitle: "18 V", sku: "SKU-42", barcode: "1234", location: "Workshop", quantity: 4, type: "tool", cover: null };
const values = labelPlaceholderValues(resource, "https://inventory.example");
const box = { x: 5, y: 5, width: 50, height: 40, visible: true };
const field = { type: "text", id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", ...box, content: [{ text: "[Title]", weight: 700 }, { text: "\nLocation: [Location]", weight: 300 }] };

test("resolves mixed text, all supported placeholders, repeated tokens and line breaks", () => {
  assert.deepEqual(resolveLabelText([
    { text: "[Title]", weight: 700 },
    { text: "\n[Subtitle] · [SKU] · [Barcode]", weight: 400 },
    { text: "\n[Location] · [Quantity] · [Type] · [Identifier] · [ID] · [URL] · [title]", weight: 300, italic: true },
  ], values), [
    { text: "Drill", weight: 700 },
    { text: "\n18 V · SKU-42 · 1234", weight: 400 },
    { text: `\nWorkshop · 4 · tool · SKU-42 · ${resource.id} · ${values.URL} · Drill`, weight: 300, italic: true },
  ]);
});

test("formatting a part of a placeholder keeps it resolvable and uses its opening style", () => {
  assert.deepEqual(resolveLabelText([{ text: "[Ti", weight: 700 }, { text: "tle]", italic: true }, { text: " label" }], values), [{ text: "Drill", weight: 700 }, { text: " label" }]);
});

test("resource contents are literal, unknown placeholders are retained and expansion is not recursive", () => {
  const name = "<img src=x onerror=alert(1)> [SKU]";
  assert.deepEqual(resolveLabelText([{ text: "[Title] [Unknown]" }], { ...values, Title: name }), [{ text: `${name} [Unknown]` }]);
});

test("missing optional values resolve to empty strings and device fields use the device", () => {
  const missing = labelPlaceholderValues({ ...resource, sku: null, barcode: null, subtitle: undefined, location: null }, "https://inventory.example");
  assert.equal(missing.Identifier, resource.id);
  assert.equal(missing.Subtitle + missing.SKU + missing.Barcode + missing.Location, "");
  const device = labelPlaceholderValues({ ...resource, stockUnit: { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", code: "SERIAL-7", location: "Desk" } }, "https://inventory.example");
  assert.equal(device.Identifier, "SERIAL-7");
  assert.equal(device.Location, "Desk");
  assert.equal(device.Quantity, "1");
  assert.match(device.URL, /\?unit=/);
  const print = labelPlaceholderValues(applyLabelTextOverride(resource, { name: "Printed title", subtitle: "" }), "https://inventory.example");
  assert.equal(print.Title, "Printed title");
  assert.equal(print.Subtitle, "");
  assert.equal(resource.name, "Drill");
});

test("formatting splits only the selected text and can remove bold, italic and underline", () => {
  const source = [{ text: "ABCD", weight: 700, italic: true, underline: true }];
  assert.deepEqual(formatLabelText(source, 1, 3, { weight: 300, italic: false, underline: false }), [
    { text: "A", weight: 700, italic: true, underline: true },
    { text: "BC", weight: 300 },
    { text: "D", weight: 700, italic: true, underline: true },
  ]);
  assert.deepEqual(source, [{ text: "ABCD", weight: 700, italic: true, underline: true }]);
});

test("replacing selections spanning styles preserves surrounding text and supports empty fields", () => {
  const source = [{ text: "abc", weight: 700 }, { text: "def", weight: 300 }];
  assert.deepEqual(replaceLabelText(source, 2, 4, "[Title]\n", { weight: 400 }), [
    { text: "ab", weight: 700 }, { text: "[Title]\n", weight: 400 }, { text: "ef", weight: 300 },
  ]);
  assert.deepEqual(replaceLabelText(source, 0, 6, ""), []);
  assert.deepEqual(replaceLabelText([], 0, 0, "New\n\nline"), [{ text: "New\n\nline" }]);
});

test("normalization preserves intentional blank lines, merges styles and does not mutate input", () => {
  const source = [{ text: "one\r\n", weight: 400 }, { text: "\ntwo", weight: 400 }, { text: "" }];
  assert.deepEqual(normalizeLabelText(source), [{ text: "one\n\ntwo", weight: 400 }]);
  assert.equal(source[0].text, "one\r\n");
});

test("multiple text fields and customized built-ins survive create, update and JSON round trips", () => {
  const elements = [field, { ...field, id: "3f2504e0-4f89-41d3-9a0c-0305e82c3304", content: [] }, { type: "name", ...box, content: [{ text: "Custom [Title]" }], verticalAlign: "bottom" }];
  const created = labelSetupCreateSchema.parse({ name: "Rich label", widthMm: 62, heightMm: 35, elements });
  assert.deepEqual(created.elements, elements);
  assert.deepEqual(labelSetupPatchSchema.parse(JSON.parse(JSON.stringify({ revision: 1, elements }))).elements, elements);
  assert.equal(labelElementsSchema.safeParse([field, field]).success, false);
  assert.equal(labelElementsSchema.safeParse([{ ...field, id: undefined }]).success, false);
  assert.equal(labelElementsSchema.safeParse([{ type: "name", ...box }, { type: "name", ...box }]).success, false);
});

test("content validation rejects unsupported styles, HTML properties and excessive content", () => {
  for (const content of [[{ text: "x", weight: 950 }], [{ text: "x", html: "<script>" }], [{ text: "x".repeat(8001) }], [{ text: "x".repeat(5000) }, { text: "x".repeat(5000) }], Array.from({ length: 501 }, () => ({ text: "x" }))]) {
    assert.equal(labelTextContentSchema.safeParse(content).success, false);
  }
  assert.equal(labelTextContentSchema.safeParse([{ text: "x".repeat(8000) }]).success, true);
  assert.equal(labelElementsSchema.safeParse([{ type: "qr", ...box, content: [] }]).success, false);
});

test("legacy text stays optional and subtitle visibility accounts for rich templates", () => {
  const legacy = { type: "subtitle", ...box };
  assert.deepEqual(labelElementsSchema.parse([legacy]), [legacy]);
  assert.deepEqual(defaultLabelTextContent(legacy), [{ text: "[Subtitle]" }]);
  assert.equal(labelUsesPlaceholder([legacy], "Subtitle"), true);
  assert.equal(labelUsesPlaceholder([{ ...legacy, content: [{ text: "Other" }] }], "Subtitle"), false);
  assert.equal(labelUsesPlaceholder([{ ...field, content: [{ text: "[Sub" }, { text: "title]" }] }], "Subtitle"), true);
  assert.equal(labelUsesPlaceholder([{ ...field, visible: false, content: [{ text: "[Subtitle]" }] }], "Subtitle"), false);
});
