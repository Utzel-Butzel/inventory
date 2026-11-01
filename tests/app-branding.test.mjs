import assert from "node:assert/strict";
import test from "node:test";
import { getAppBranding } from "../lib/app-branding.ts";

test("optional branding preserves defaults and trims configured values", () => {
  assert.deepEqual(getAppBranding({}), { name: null, logoUrl: null });
  assert.deepEqual(getAppBranding({ APP_NAME: "  ", APP_LOGO_URL: " " }), { name: null, logoUrl: null });
  assert.deepEqual(getAppBranding({ APP_NAME: " Mein Inventar ", APP_LOGO_URL: " https://example.org/logo.svg " }), {
    name: "Mein Inventar", logoUrl: "https://example.org/logo.svg",
  });
});

test("invalid image URLs fall back without losing the configured name", () => {
  for (const logoUrl of ["not a URL", "javascript:alert(1)", "file:///logo.png", "data:image/svg+xml,<svg/>", "https://user:secret@example.org/logo.png"]) {
    assert.deepEqual(getAppBranding({ APP_NAME: "Werkstatt", APP_LOGO_URL: logoUrl }), { name: "Werkstatt", logoUrl: null });
  }
  assert.equal(getAppBranding({ APP_LOGO_URL: "http://localhost:3000/logo.png" }).logoUrl, "http://localhost:3000/logo.png");
});

test("branding reads the current runtime environment instead of module-load values", () => {
  const previousName = process.env.APP_NAME;
  try {
    process.env.APP_NAME = "First deployment";
    assert.equal(getAppBranding().name, "First deployment");
    process.env.APP_NAME = "Second deployment";
    assert.equal(getAppBranding().name, "Second deployment");
  } finally {
    if (previousName === undefined) delete process.env.APP_NAME;
    else process.env.APP_NAME = previousName;
  }
});
