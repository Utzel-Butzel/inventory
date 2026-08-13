import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createInstance } from "i18next";

import i18nConfig, { UI_NAMESPACES } from "../i18n.config.ts";

const localeRoot = fileURLToPath(
  new URL("../app/i18n/locales/", import.meta.url),
);

async function readNamespace(language, namespace) {
  const contents = await readFile(
    `${localeRoot}/${language}/${namespace}.json`,
    "utf8",
  );
  return JSON.parse(contents);
}

function leafKeys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, entry]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return entry && typeof entry === "object" && !Array.isArray(entry)
      ? leafKeys(entry, path)
      : [path];
  });
}

function interpolationTokens(value) {
  return [...value.matchAll(/{{\s*([^},]+)(?:,[^}]*)?}}/g)]
    .map((match) => match[1].trim())
    .sort();
}

test("English and German UI catalogs have identical, non-empty keys", async () => {
  const [englishFiles, germanFiles] = await Promise.all([
    readdir(`${localeRoot}/en`),
    readdir(`${localeRoot}/de`),
  ]);
  assert.deepEqual(englishFiles.sort(), germanFiles.sort());
  assert.deepEqual(
    englishFiles.map((filename) => filename.replace(/\.json$/, "")).sort(),
    [...UI_NAMESPACES].sort(),
    "configured namespaces and locale files differ",
  );

  for (const filename of englishFiles) {
    const namespace = filename.replace(/\.json$/, "");
    const [english, german] = await Promise.all([
      readNamespace("en", namespace),
      readNamespace("de", namespace),
    ]);
    assert.deepEqual(
      leafKeys(english).sort(),
      leafKeys(german).sort(),
      `${namespace} locale keys differ`,
    );
    for (const [language, catalog] of [
      ["en", english],
      ["de", german],
    ]) {
      for (const key of leafKeys(catalog)) {
        const value = key
          .split(".")
          .reduce((current, segment) => current[segment], catalog);
        assert.equal(typeof value, "string", `${language}:${namespace}:${key}`);
        assert.ok(value.trim(), `${language}:${namespace}:${key} is empty`);
      }
    }
    for (const key of leafKeys(english)) {
      const englishValue = key
        .split(".")
        .reduce((current, segment) => current[segment], english);
      const germanValue = key
        .split(".")
        .reduce((current, segment) => current[segment], german);
      assert.deepEqual(
        interpolationTokens(englishValue),
        interpolationTokens(germanValue),
        `${namespace}:${key} interpolation variables differ`,
      );
    }
  }
});

test("regional and unsupported languages resolve through the configured fallback", async () => {
  const [enCommon, deCommon] = await Promise.all([
    readNamespace("en", "common"),
    readNamespace("de", "common"),
  ]);
  const i18n = createInstance();
  await i18n.init({
    lng: "de-DE",
    fallbackLng: i18nConfig.fallbackLng,
    supportedLngs: i18nConfig.supportedLngs,
    nonExplicitSupportedLngs: i18nConfig.nonExplicitSupportedLngs,
    defaultNS: i18nConfig.defaultNS,
    resources: {
      en: { common: enCommon },
      de: { common: deCommon },
    },
  });
  assert.equal(i18n.resolvedLanguage, "de");
  assert.equal(i18n.t("actions.save"), "Speichern");

  await i18n.changeLanguage("fr-FR");
  assert.equal(i18n.resolvedLanguage, "en");
  assert.equal(i18n.t("actions.save"), "Save");
});

test("UI catalogs use i18next plural rules", async () => {
  const [enBatch, deBatch] = await Promise.all([
    readNamespace("en", "batch"),
    readNamespace("de", "batch"),
  ]);
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: ["en", "de"],
    defaultNS: "batch",
    resources: {
      en: { batch: enBatch },
      de: { batch: deBatch },
    },
  });
  assert.equal(i18n.t("submit.photoCount", { count: 1 }), "1 photo");
  assert.equal(i18n.t("submit.photoCount", { count: 3 }), "3 photos");
  await i18n.changeLanguage("de");
  assert.equal(i18n.t("submit.photoCount", { count: 1 }), "1 Foto");
  assert.equal(i18n.t("submit.photoCount", { count: 3 }), "3 Fotos");
});

test("the locale and organization proxy is scoped to application routes", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../proxy.ts", import.meta.url)),
    "utf8",
  );
  const applicationPaths = [
    "/",
    "/login",
    "/share/:path*",
    "/dashboard/:path*",
    "/inventory/:path*",
    "/stock/:path*",
    "/map/:path*",
    "/spaces/:path*",
    "/batch/:path*",
    "/labels/:path*",
    "/duplicates/:path*",
    "/notifications/:path*",
    "/settings/:path*",
    "/:organizationId/:path*",
  ];
  const matcherBlock = source.match(/matcher:\s*\[([\s\S]*?)\]/)?.[1];
  assert.ok(matcherBlock, "proxy matcher is missing");
  const configuredPaths = [...matcherBlock.matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(configuredPaths, applicationPaths);
  assert.equal(i18nConfig.localeInPath, false);
  assert.equal(i18nConfig.cookieName, "inventory-ui-language");
  assert.equal(i18nConfig.headerName, "x-inventory-ui-language");
});
