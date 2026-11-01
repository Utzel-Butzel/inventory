import assert from "node:assert/strict";
import test from "node:test";
import { labelExternalDestination, labelQrRedirectUrlSchema } from "../lib/label-redirect-contract.ts";
import { organizationUpdateInputSchema } from "../lib/validators.ts";

test("organization settings accept a full destination and normalize clearing it", () => {
  assert.equal(organizationUpdateInputSchema.parse({ labelQrRedirectUrl: " https://digital.konglomerat.org/slack " }).labelQrRedirectUrl,
    "https://digital.konglomerat.org/slack");
  for (const value of ["", "   ", null]) assert.equal(organizationUpdateInputSchema.parse({ labelQrRedirectUrl: value }).labelQrRedirectUrl, null);
  assert.equal(organizationUpdateInputSchema.parse({ name: "Workshop" }).labelQrRedirectUrl, undefined);
});

test("redirect settings reject executable, relative, credential-bearing and malformed URLs", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,hello", "ftp://example.org", "//evil.org", "/slack", "digital.konglomerat.org/slack", "https://user:password@example.org", "https://", "https://exam\nple.org", "https://example.org/\\evil", "https://example.org/" + "x".repeat(2048)]) {
    assert.equal(labelQrRedirectUrlSchema.safeParse(value).success, false, value);
    assert.equal(labelExternalDestination(value, "https://inventory.example/q/12345678"), null);
  }
});

test("external destinations preserve configured query and fragment, add only QR source, and prevent local loops", () => {
  const current = "https://inventory.example/q/12345678?unit=private&url=https://evil.invalid";
  assert.equal(labelExternalDestination("https://digital.konglomerat.org/slack", current), "https://digital.konglomerat.org/slack?src=qr");
  assert.equal(labelExternalDestination("https://example.org/slack?keep=1&src=other#join", current), "https://example.org/slack?keep=1&src=qr#join");
  for (const path of ["/q/12345678", "/r/compact", "/q", "/r"]) {
    assert.equal(labelExternalDestination("https://inventory.example" + path, current), null);
  }
  assert.equal(labelExternalDestination(null, current), null);
});
