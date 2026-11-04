# Interface languages

The web app, iOS app and Android app support German and English. User-entered inventory content and server-defined names remain separate from interface translations.

## Web app

Interface strings live in `app/i18n/locales/{de,en}/`. Components use `useT`; server components use `getT` from `lib/ui-i18n/server`. Keep interpolation variables and plural keys consistent across languages.

On first visit, the web app chooses the highest-priority supported language from the browser's `Accept-Language` preferences. Regional variants such as `de-AT` and `en-GB` use German and English respectively. Explicitly excluded languages (`q=0`) are ignored. A saved language choice takes precedence. If no supported language matches, the app uses English.

## Native apps

`localization/native.json` is the shared source for native interface strings. Each entry contains `de` and `en` text. Run `npm run i18n:sync-native` after editing it, and commit the generated iOS `Localizable.strings` and Android `strings.xml` files together with the catalog.

Call `L10n.text` with the resource key and positional arguments. `{0}`, `{1}`, etc. are interpolated in one pass; values containing placeholders are preserved literally. Never localize API keys, identifiers, paths, stored status codes or user-entered text.

The native apps follow the device/app language. English is the fallback for unsupported languages. iOS exposes German and English through its localized bundles; Android declares both in `locales_config.xml` for the system's app-language settings (Android 13+). Permission descriptions on iOS are maintained in each language's `InfoPlist.strings`.

Android includes both explicit `values-en` resources for ordered language preferences and identical English default resources in `values` for fallback. App-authored links use the same first supported language from the device's preferences. iOS declares English as its development language, which supplies its default language.

## Validation

- `npm run test:i18n`: web key/interpolation parity, missing static keys, untranslated JSX copy and accessibility labels, native references and generated resources.
- `npm run android:check`: Android unit tests, lint and debug build.
- `LocalizationTests` in the iOS test target: bundle resolution and interpolation.

Static checks do not replace a device walkthrough in both languages. Content from an inventory server, AI services, operating-system errors and third-party services may follow that service's language settings.
