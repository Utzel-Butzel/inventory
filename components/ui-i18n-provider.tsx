"use client";

import { useEffect } from "react";
import type { Resource } from "i18next";
import { I18nProvider, useT } from "next-i18next/client";

import i18nConfig from "@/i18n.config";

function DocumentLanguage({ children }: { children: React.ReactNode }) {
  const { i18n } = useT();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(
    () => () => {
      // Client-side navigation back to the public website keeps the root layout
      // mounted, so restore its deliberately English document language.
      document.documentElement.lang = "en";
    },
    [],
  );

  return children;
}

export function UiI18nProvider({
  children,
  language,
  resources,
}: {
  children: React.ReactNode;
  language: string;
  resources: Resource;
}) {
  return (
    <I18nProvider
      language={language}
      resources={resources}
      supportedLngs={i18nConfig.supportedLngs}
      fallbackLng={i18nConfig.fallbackLng}
      defaultNS={i18nConfig.defaultNS}
      i18nextOptions={i18nConfig.i18nextOptions}
    >
      <DocumentLanguage>{children}</DocumentLanguage>
    </I18nProvider>
  );
}
