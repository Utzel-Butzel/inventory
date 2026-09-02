import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseResourceCode } from "../lib/resource-code.ts";
import {
  resourceIdFromShortCode,
  resourceShortCode,
  resourceShortPath,
  resourceShortUrl,
} from "../lib/resource-short-link.ts";

const resourceId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

test("round-trips resource UUIDs through a compact URL-safe code", () => {
  const code = resourceShortCode(resourceId);
  assert.equal(code, "PyUE4E-JQdOaDAMF6CwzAQ");
  assert.equal(code.length, 22);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.equal(resourceIdFromShortCode(code), resourceId);
  assert.equal(resourceShortPath(resourceId), `/r/${code}`);
  assert.equal(
    resourceShortUrl("https://inventory.example/", resourceId),
    `https://inventory.example/r/${code}`,
  );
});

test("normalizes uppercase UUIDs without treating raw short codes as resource ids", () => {
  const code = resourceShortCode(resourceId.toUpperCase());
  assert.equal(resourceIdFromShortCode(code), resourceId);
  assert.deepEqual(parseResourceCode(code), { code, resourceId: null });
  assert.equal(
    parseResourceCode(`https://inventory.example/scan?id=${code}`).resourceId,
    null,
  );
});

test("rejects malformed, non-canonical, and unsupported compact ids", () => {
  assert.equal(resourceIdFromShortCode("not-a-code"), null);
  assert.equal(resourceIdFromShortCode("______________________"), null);
  assert.equal(resourceIdFromShortCode(`${resourceShortCode(resourceId).slice(0, -1)}B`), null);
  assert.throws(
    () => resourceShortCode("3f2504e0-4f89-71d3-9a0c-0305e82c3301"),
    /valid resource UUID/,
  );
});

test("recognizes compact links in scanner input", () => {
  const code = resourceShortCode(resourceId);
  assert.equal(
    parseResourceCode(`https://inventory.example/r/${code}`).resourceId,
    resourceId,
  );
});

test("keeps short-link redirects on the current public origin", async () => {
  const route = await readFile(
    new URL("../app/r/[code]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /Location: redirectLocation/);
  assert.doesNotMatch(route, /request\.url/);
});
