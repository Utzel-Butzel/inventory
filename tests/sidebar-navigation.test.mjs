import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the primary sidebar groups operational pages and keeps locations top-level", async () => {
  const shell = await source("components/app-shell.tsx");

  assert.match(
    shell,
    /navigation\.overview[\s\S]*navigation\.inventory[\s\S]*navigation\.stock[\s\S]*navigation\.operations[\s\S]*navigation\.locations/,
  );
  assert.match(
    shell,
    /navigation\.operations[\s\S]*\/operations\/purchases[\s\S]*\/operations\/sales[\s\S]*\/operations\/loans[\s\S]*\/requests[\s\S]*\/requests\/calendar[\s\S]*\/contacts/,
  );
  assert.match(
    shell,
    /activeHrefs: \["\/operations", "\/requests", "\/contacts"\]/,
  );
  assert.match(shell, /SIDEBAR_EXPANDED_STORAGE_KEY/);
  assert.match(shell, /aria-expanded=\{expanded\}/);
  assert.match(shell, /href="\/settings"/);
});

test("order tabs use canonical URLs and legacy entry points redirect", async () => {
  const [manager, legacyLoans, legacyOrders] = await Promise.all([
    source("components/orders-manager.tsx"),
    source("app/(dashboard)/loans/page.tsx"),
    source("app/(dashboard)/stock/orders/page.tsx"),
  ]);

  assert.match(manager, /href: "\/operations\/purchases"/);
  assert.match(manager, /href: "\/operations\/sales"/);
  assert.match(manager, /href: "\/operations\/loans"/);
  assert.doesNotMatch(manager, /setType/);
  assert.match(legacyLoans, /permanentRedirect/);
  assert.match(legacyLoans, /\/operations\/loans/);
  assert.match(legacyOrders, /permanentRedirect/);
  assert.match(legacyOrders, /\/operations\/purchases/);
});

test("settings switch to their secondary sidebar only on wide screens", async () => {
  const [navigation, layout] = await Promise.all([
    source("components/settings-navigation.tsx"),
    source("components/settings-section-layout.tsx"),
  ]);

  assert.match(navigation, /hidden border-r border-border bg-surface xl:block/);
  assert.match(navigation, /border-b border-border bg-surface px-4 py-3 xl:hidden/);
  assert.match(layout, /xl:grid xl:grid-cols-\[248px_minmax\(0,1fr\)\]/);
});
