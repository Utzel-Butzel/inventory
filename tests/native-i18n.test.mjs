import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("localization/native.json", root), "utf8"));

test("native language resources are complete and generated from the shared catalog", () => {
  for (const [key, entry] of Object.entries(catalog)) {
    assert.match(key, /^[a-z][a-z0-9_]+$/);
    assert.deepEqual(Object.keys(entry).sort(), ["de", "en"]);
    for (const language of ["en", "de"]) assert.ok(entry[language].trim(), `${language}:${key}`);
    const tokens = (value) => [...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(tokens(entry.en), tokens(entry.de), `${key}: placeholders differ`);
  }
  execFileSync(process.execPath, [new URL("scripts/sync-native-locales.mjs", root).pathname, "--check"]);
});

test("every native translation reference exists in both languages", async () => {
  for (const [directory, extension] of [
    ["ios/Inventory/Inventory/", ".swift"],
    ["android/app/src/main/java/", ".kt"],
  ]) {
    const base = new URL(directory, root);
    for (const file of await readdir(base, { recursive: true })) {
      if (!file.endsWith(extension)) continue;
      const source = await readFile(new URL(file, base), "utf8");
      const references = source.matchAll(/L10n\.text\("([^"]+)"|R\.string\.(\w+)/g);
      for (const match of references) {
        const key = match[1] ?? match[2];
        assert.ok(catalog[key], `${file}: unknown translation ${key}`);
      }
      const neutral = new Set(["OK", "SKU", "GPS", "Inventory", "Android", "English", "Deutsch", "Apple Object Capture"]);
      const labels = source.matchAll(/(?:Text|Button|Label|Section|TextField|Heading|TextInput|LinkRow|Notice|Empty|Confirm|FormDialog|Choice|navigationTitle|accessibilityLabel)\("((?:\\.|[^"\\])*)"/g);
      for (const match of labels) {
        const value = match[1];
        if (value.includes("\\(") || value.includes("$") || !/[A-Za-zÄÖÜäöüß]/.test(value)) continue;
        assert.ok(neutral.has(value), `${file}: untranslated native interface text: ${value}`);
      }
    }
  }
});

test("native system permission dialogs and app language declarations cover DE and EN", async () => {
  const [fallback, english] = await Promise.all([
    readFile(new URL("android/app/src/main/res/values/strings.xml", root), "utf8"),
    readFile(new URL("android/app/src/main/res/values-en/strings.xml", root), "utf8"),
  ]);
  assert.equal(fallback, english, "Android default resources must always be English");
  for (const language of ["en", "de"]) {
    const strings = await readFile(new URL(`ios/Inventory/Inventory/${language}.lproj/InfoPlist.strings`, root), "utf8");
    for (const key of ["NSCameraUsageDescription", "NSLocationWhenInUseUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription"]) {
      assert.ok(strings.includes(`"${key}" = "`), `${language}: ${key}`);
    }
  }
  const locales = await readFile(new URL("android/app/src/main/res/xml/locales_config.xml", root), "utf8");
  assert.match(locales, /android:name="en"/);
  assert.match(locales, /android:name="de"/);
  const project = await readFile(new URL("ios/Inventory/Inventory.xcodeproj/project.pbxproj", root), "utf8");
  assert.match(project, /developmentRegion = en;/);
});
