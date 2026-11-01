import assert from "node:assert/strict";
import test from "node:test";
import { nativeAppLink } from "../lib/native-app-link.ts";

const origin = "https://inventory.peoplelesspaper.de";
const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const unit = "4f2504e0-4f89-41d3-9a0c-0305e82c3302";
const targetOf = (url) => new URL(nativeAppLink(url)).searchParams.get("url");

test("native links preserve the self-hosted server, organization and selected unit", () => {
  const target = `${origin}/warehouse/inventory/${id}/stock?unit=${unit}`;
  assert.equal(targetOf(target), target);
  const short = `${origin}/r/PyUE4E-JQdOaDAMF6CwzAQ?unit=TyUE4E-JQdOaDAMF6CwzAg`;
  assert.equal(targetOf(short), short);
  assert.equal(targetOf(`http://localhost:3000/inventory/${id}`), `http://localhost:3000/inventory/${id}`);
});

test("login fallback opens the inventory target without forwarding unrelated parameters", () => {
  assert.equal(targetOf(`${origin}/login?callbackUrl=${encodeURIComponent(`/inventory/${id}/stock?unit=${unit}&token=secret`)}`), `${origin}/inventory/${id}/stock?unit=${unit}`);
  assert.equal(targetOf(`${origin}/inventory/${id}?token=secret#fragment`), `${origin}/inventory/${id}`);
});

test("malformed labels, unrelated routes and external callbacks cannot become app links", () => {
  for (const url of [
    `${origin}/settings`, `${origin}/inventory/new`, `${origin}/r/bad`,
    `${origin}/r/PyUE4E-JQdOaDAMF6CwzAR`, `${origin}/inventory/${id}?unit=bad`,
    `${origin}/inventory/${id}?unit=${unit}&unit=${unit}`,
    `${origin}/login?callbackUrl=${encodeURIComponent(`https://evil.example/inventory/${id}`)}`,
    `${origin}/login?callbackUrl=${encodeURIComponent(`/\\evil.example/inventory/${id}`)}`,
    `${origin}/login?callbackUrl=${encodeURIComponent(`//evil.example/inventory/${id}`)}`,
    `https://user:secret@inventory.peoplelesspaper.de/inventory/${id}`,
    "javascript:alert(1)", "not a URL",
  ]) assert.equal(nativeAppLink(url), null, url);
});
