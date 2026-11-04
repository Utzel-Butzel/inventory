import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const neutralText = new Set([
  "GET", "PATCH", "DELETE", "/api/v1/resources/", "/stock", "/share/", "X-Organization-ID:",
  "mm", "mm ·", "m", "X", "Z", "3D", "· JSON", "English", "Deutsch",
  "A4 · 3 × 8 · 63.5 × 33.9 mm", "Letter · 3 × 10 · 66.675 × 25.4 mm",
  "Brother PT-P710BT", "Brother PT-P710BT · USB / QZ Tray",
]);

async function sources() {
  const files = [];
  for (const directory of ["app/", "components/"]) {
    const base = new URL(directory, root);
    for (const file of await readdir(base, { recursive: true })) {
      if (!file.endsWith(".tsx")) continue;
      const text = await readFile(new URL(file, base), "utf8");
      files.push(ts.createSourceFile(directory + file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
    }
  }
  return files;
}

test("visible JSX copy and accessibility labels come from translations", async () => {
  const failures = [];
  for (const source of await sources()) {
    function visit(node) {
      let text;
      if (ts.isJsxText(node)) text = node.text.trim();
      if (ts.isJsxAttribute(node) && ["aria-label", "title", "alt", "label", "description"].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
        text = node.initializer.text;
      }
      if (text && /[A-Za-zÄÖÜäöüß]/.test(text) && !neutralText.has(text)) {
        failures.push(`${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(failures, [], "Untranslated interface text (technical names belong in the explicit allowlist)");
});

test("literal translation keys resolve to catalog entries", async () => {
  const catalogs = {};
  const base = new URL("app/i18n/locales/en/", root);
  for (const file of await readdir(base)) catalogs[file.replace(/\.json$/, "")] = JSON.parse(await readFile(new URL(file, base), "utf8"));
  const contains = (catalog, key) => [key, `${key}_one`, `${key}_other`].some((candidate) => candidate.split(".").reduce((value, segment) => value?.[segment], catalog) !== undefined);
  const failures = [];
  for (const source of await sources()) {
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(t|t[A-Z]\w*)$/.test(node.expression.text) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const value = node.arguments[0].text;
        const [namespace, key] = value.includes(":") ? value.split(":") : [null, value];
        const exists = namespace ? contains(catalogs[namespace], key) : Object.values(catalogs).some((catalog) => contains(catalog, key));
        if (!exists) failures.push(`${source.fileName}: ${value}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(failures, [], "Unknown translation keys");
});
