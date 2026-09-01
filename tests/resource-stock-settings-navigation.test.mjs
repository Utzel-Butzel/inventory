import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("stock settings live on the regular inventory edit page", async () => {
  const [editPage, editor, stockManager, legacySettingsPage] =
    await Promise.all([
      source("app/(dashboard)/inventory/[id]/edit/page.tsx"),
      source("components/resource-editor.tsx"),
      source("components/resource-stock-manager.tsx"),
      source("app/(dashboard)/inventory/[id]/stock/settings/page.tsx"),
    ]);

  assert.match(editPage, /canAccessResource\(identity, "stock\.manage", resource\)/);
  assert.match(editPage, /canManageStock=\{canManageStock\}/);
  assert.match(editor, /<ResourceStockSettings resourceId=\{resourceId\} \/>/);
  assert.match(
    stockManager,
    /href=\{`\/inventory\/\$\{resourceId\}\/edit#stock-settings`\}/,
  );
  assert.doesNotMatch(stockManager, /\/stock\/settings/);
  assert.match(
    legacySettingsPage,
    /`\/inventory\/\$\{primaryReference\}\/edit#stock-settings`/,
  );
  assert.doesNotMatch(legacySettingsPage, /<ResourceStockSettings/);
});
