import type { I18nConfig } from "next-i18next/proxy";

export const UI_LANGUAGE_COOKIE = "inventory-ui-language";
export const UI_LANGUAGE_HEADER = "x-inventory-ui-language";
export const UI_LANGUAGES = ["en", "de"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const UI_NAMESPACES = [
  "common",
  "auth",
  "shell",
  "dashboard",
  "inventory",
  "contacts",
  "orders",
  "resource",
  "stock",
  "counting",
  "scanner",
  "assembly",
  "spatial",
  "labels",
  "settings",
  "notifications",
  "requests",
  "loans",
  "batch",
  "share",
] as const;

const i18nConfig: I18nConfig = {
  supportedLngs: [...UI_LANGUAGES],
  fallbackLng: "en",
  defaultNS: "common",
  ns: [...UI_NAMESPACES],
  localeInPath: false,
  cookieName: UI_LANGUAGE_COOKIE,
  headerName: UI_LANGUAGE_HEADER,
  nonExplicitSupportedLngs: true,
  resourceLoader: (language, namespace) =>
    import(`./app/i18n/locales/${language}/${namespace}.json`),
  reloadOnPrerender: process.env.NODE_ENV === "development",
  i18nextOptions: {
    returnNull: false,
  },
};

export default i18nConfig;
