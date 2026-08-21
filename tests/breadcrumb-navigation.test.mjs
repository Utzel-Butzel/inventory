import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("inventory details use one shell breadcrumb with linked ancestors", async () => {
  const [shell, resourceDetails] = await Promise.all([
    source("components/app-shell.tsx"),
    source("components/resource-details.tsx"),
  ]);

  assert.match(shell, /aria-label=\{t\("breadcrumb\.label"\)\}/);
  assert.match(shell, /href="\/"/);
  assert.match(shell, /href=\{`\/\$\{section\}`\}/);
  assert.match(shell, /aria-current="page"/);
  assert.match(shell, /t\("breadcrumb\.details"\)/);
  assert.doesNotMatch(resourceDetails, /details\.breadcrumb/);
});
