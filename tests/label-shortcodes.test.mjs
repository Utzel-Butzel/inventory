import assert from "node:assert/strict";
import test from "node:test";
import { labelShortcodeFromUrl, labelShortcodeUrl, labelQrDestination } from "../lib/label-shortcode-contract.ts";
import { labelQrUrl, labelTargetUrl } from "../lib/label-target.ts";
import { labelSetupCreateSchema } from "../lib/label-setup-contract.ts";
import { labelSnapshotSchema } from "../lib/label-document.ts";
import { readyLabelQr } from "../lib/label-qr-ready.ts";
import { organizationPath, isOrganizationReference } from "../lib/organization-path.ts";
import { nativeAppLink } from "../lib/native-app-link.ts";

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const unit = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
const origin = "https://inventory.example";

test("QR source is explicit for normal links, including units, without changing text URL fields", () => {
  for (const resource of [{ id }, { id, stockUnit: { id: unit } }]) {
    const qr = new URL(labelQrUrl(origin, resource));
    assert.equal(qr.searchParams.get("src"), "qr");
    assert.equal(new URL(labelTargetUrl(origin, resource)).searchParams.has("src"), false);
    assert.equal(qr.searchParams.size, resource.stockUnit ? 2 : 1);
  }
  assert.equal(labelQrDestination(id, unit), `/inventory/${id}/stock?unit=${unit}&src=qr`);
  assert.equal(labelQrDestination(id, null), `/inventory/${id}?src=qr`);
});

test("shortcode URLs use eight characters, stay global and do not carry tracking overhead", () => {
  const url = labelShortcodeUrl(origin + "/", "K7m4Xp2A");
  assert.equal(url, origin + "/q/K7m4Xp2A");
  assert.equal(labelShortcodeFromUrl(url), "K7m4Xp2A");
  assert.equal(organizationPath("workshop", "/q/K7m4Xp2A"), "/q/K7m4Xp2A");
  assert.equal(isOrganizationReference("q"), false);
  for (const value of ["K7m4Xp2A", origin + "/q/bad", origin + "/q/K7m4Xp2A/extra", "ftp://host/q/K7m4Xp2A", "https://user:pass@host/q/K7m4Xp2A"]) {
    assert.equal(labelShortcodeFromUrl(value), null);
  }
  assert.throws(() => labelShortcodeUrl(origin, "../unsafe"));
});

test("templates persist the optional choice and reject non-booleans", () => {
  const template = { name: "Test", widthMm: 50, heightMm: 30, elements: [
    { type: "qr", x: 0, y: 0, width: 50, height: 100, visible: true, useShortcode: true },
  ] };
  assert.equal(labelSetupCreateSchema.parse(template).elements[0].useShortcode, true);
  delete template.elements[0].useShortcode;
  assert.equal(labelSetupCreateSchema.safeParse(template).success, true);
  template.elements[0].useShortcode = "true";
  assert.equal(labelSetupCreateSchema.safeParse(template).success, false);
});

test("printing waits for a saved code and fails closed on shortcode errors", async () => {
  let pending = true;
  const url = labelShortcodeUrl(origin, "K7m4Xp2A");
  const node = { querySelector: selector => selector.includes('"pending"') ? (pending ? {} : null)
    : selector.includes('"error"') ? null : { dataset: { labelQrValue: url } } };
  setTimeout(() => { pending = false; }, 15);
  assert.equal(await readyLabelQr(node, "wrong-old-url"), url);
  await assert.rejects(readyLabelQr({ querySelector: selector => selector.includes('"error"')
    ? { dataset: { labelQrError: "Shortcode failed" } } : null }), /Shortcode failed/);
  assert.equal(await readyLabelQr({ querySelector: () => null }, "legacy-snapshot"), "legacy-snapshot");
});

test("frozen print snapshots retain each QR payload when a label mixes normal and short URLs", () => {
  const urls = [labelQrUrl(origin, { id }), labelShortcodeUrl(origin, "K7m4Xp2A")];
  const snapshot = labelSnapshotSchema.parse({ png: "data:image/png;base64,YQ==", widthMm: 60, heightMm: 30,
    expectedQr: urls[0], regions: urls.map((expectedQr, i) => ({ type: "qr", x: i * 0.5, y: 0, width: 0.5, height: 1, expectedQr })) });
  assert.deepEqual(snapshot.regions.map(region => region.expectedQr), urls);
});

test("app links preserve QR provenance through the login callback, omitting unrelated parameters", () => {
  const destination = `/workshop/inventory/${id}/stock?unit=${unit}&src=qr`;
  const app = new URL(nativeAppLink(`${origin}/login?callbackUrl=${encodeURIComponent(destination + "&token=secret")}`));
  assert.equal(app.searchParams.get("url"), origin + destination);
});
