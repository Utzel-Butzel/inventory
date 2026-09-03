import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("inventory resource pages use one shell breadcrumb with linked ancestors", async () => {
  const [
    shell,
    breadcrumbContext,
    resourceDetails,
    resourceEditor,
    resourceStock,
    editPage,
    stockPage,
  ] = await Promise.all([
    source("components/app-shell.tsx"),
    source("components/inventory-breadcrumb-context.tsx"),
    source("components/resource-details.tsx"),
    source("components/resource-editor.tsx"),
    source("components/resource-stock-manager.tsx"),
    source("app/(dashboard)/inventory/[id]/edit/page.tsx"),
    source("app/(dashboard)/inventory/[id]/stock/page.tsx"),
  ]);

  assert.match(shell, /aria-label=\{t\("breadcrumb\.label"\)\}/);
  assert.match(shell, /href="\/"/);
  assert.match(shell, /href=\{sectionHref\}/);
  assert.match(shell, /navigationSection === "operations"/);
  assert.match(shell, /navigationSection === "locations"/);
  assert.match(shell, /aria-current="page"/);
  assert.match(shell, /t\("breadcrumb\.details"\)/);
  assert.match(shell, /t\("breadcrumb\.edit"\)/);
  assert.match(shell, /t\("navigation\.stock"\)/);
  assert.match(shell, /href=\{resourceItemBreadcrumb\.href\}/);
  assert.match(shell, /title=\{resourceItemBreadcrumb\.name\}/);
  assert.match(shell, /max-w-28 truncate/);
  assert.match(breadcrumbContext, /setItem\(\{ href, name \}\)/);
  assert.match(editPage, /<InventoryBreadcrumb/);
  assert.match(editPage, /name=\{resource\.name\}/);
  assert.match(stockPage, /<InventoryBreadcrumb/);
  assert.match(stockPage, /href=\{`\/inventory\/\$\{resourceReference\}`\}/);
  assert.match(stockPage, /name=\{resource\.name\}/);
  assert.doesNotMatch(resourceDetails, /details\.breadcrumb/);
  assert.doesNotMatch(resourceEditor, /t\("header\.edit"\)/);
  assert.doesNotMatch(resourceStock, /href="\/inventory"/);
  assert.doesNotMatch(resourceStock, /<ArrowLeft/);
});
