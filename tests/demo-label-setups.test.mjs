import assert from "node:assert/strict";
import test from "node:test";
import { labelElementsOverlap, labelSetupCreateSchema } from "../lib/label-setup-contract.ts";
import { defaultLabelTextContent, labelPlaceholderValues, resolveLabelText } from "../lib/label-rich-text.ts";
import { labelTargetUrl } from "../lib/label-target.ts";
import { printableLabelBarcode } from "../lib/label-barcode.ts";
import { DEMO_LABEL_SETUPS, DEMO_RESOURCES, DEMO_STOCK_UNITS } from "../scripts/demo-seed-manifest.mjs";

test("all demo label layouts fit their media and keep codes separate from text and photos", () => {
  assert.equal(DEMO_LABEL_SETUPS.length, 6);
  assert.equal(new Set(DEMO_LABEL_SETUPS.map(({ name }) => name)).size, 6);
  for (const { id, ...setup } of DEMO_LABEL_SETUPS) {
    labelSetupCreateSchema.parse(setup);
    const visible = setup.elements.filter(({ visible }) => visible);
    const qr = visible.find(({ type }) => type === "qr");
    assert.ok(qr, id);
    assert.ok(Math.min(qr.width * setup.widthMm, qr.height * setup.heightMm) / 100 >= 18, `${setup.name}: readable QR size`);
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        assert.equal(labelElementsOverlap(visible[i], visible[j]), false, `${setup.name}: ${visible[i].type}/${visible[j].type} overlap`);
      }
    }
  }
});

test("serialized label resolves the unit code in text, barcode and QR destination", () => {
  const setup = DEMO_LABEL_SETUPS.find(({ name }) => name.startsWith("Einzelgerät"));
  const unit = DEMO_STOCK_UNITS[0];
  const resource = { ...DEMO_RESOURCES.find(({ id }) => id === unit.resourceId), cover: null, stockUnit: unit };
  const identifier = setup.elements.find(({ type }) => type === "identifier");
  const values = labelPlaceholderValues(resource, "https://demo.openinventory.polyxo.de");
  assert.equal(resolveLabelText(defaultLabelTextContent(identifier), values).map(({ text }) => text).join(""), unit.code);
  assert.equal(printableLabelBarcode(resource), unit.code);
  assert.ok(new URL(labelTargetUrl("https://demo.openinventory.polyxo.de", resource)).searchParams.has("unit"));
});
