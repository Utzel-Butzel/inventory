import type { I18nConfig } from "next-i18next/proxy";

export const UI_LANGUAGE_COOKIE = "inventory-ui-language";
export const UI_LANGUAGE_HEADER = "x-inventory-ui-language";
export const UI_LANGUAGES = ["en", "de"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** Explicit choice wins; otherwise use the first supported browser preference. */
export function resolveUiLanguage(
  savedLanguage: string | null | undefined,
  acceptLanguage: string | null | undefined,
): UiLanguage {
  if (UI_LANGUAGES.includes(savedLanguage as UiLanguage)) {
    return savedLanguage as UiLanguage;
  }
  const requested = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => /^q\s*=/i.test(parameter.trim()));
      const rawQuality = quality?.split("=")[1]?.trim();
      return {
        language: tag.toLowerCase().split("-")[0],
        quality: quality === undefined ? 1 : rawQuality ? Number(rawQuality) : NaN,
      };
    })
    .filter((part) => Number.isFinite(part.quality) && part.quality > 0 && part.quality <= 1)
    .sort((left, right) => right.quality - left.quality);
  return requested.find((part) => UI_LANGUAGES.includes(part.language as UiLanguage))
    ?.language as UiLanguage | undefined ?? "en";
}

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
