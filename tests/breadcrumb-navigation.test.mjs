import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("inventory resource pages use one shell breadcrumb with linked ancestors", async () => {
  const [shell, resourceDetails, resourceStock] = await Promise.all([
    source("components/app-shell.tsx"),
    source("components/resource-details.tsx"),
    source("components/resource-stock-manager.tsx"),
  ]);

  assert.match(shell, /aria-label=\{t\("breadcrumb\.label"\)\}/);
  assert.match(shell, /href="\/"/);
  assert.match(shell, /href=\{`\/\$\{section\}`\}/);
  assert.match(shell, /aria-current="page"/);
  assert.match(shell, /t\("breadcrumb\.details"\)/);
  assert.match(shell, /t\("navigation\.stock"\)/);
  assert.doesNotMatch(resourceDetails, /details\.breadcrumb/);
  assert.doesNotMatch(resourceStock, /href="\/inventory"/);
  assert.doesNotMatch(resourceStock, /<ArrowLeft/);
});
