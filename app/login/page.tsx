import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  demoAccessEnabled,
  externalAuthProviders,
  passwordAuthEnabled,
} from "@/auth";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";
import { LocalizedThemeToggle } from "@/components/theme-toggle";
import { UiI18nProvider } from "@/components/ui-i18n-provider";
import { getSessionIdentity } from "@/lib/api-auth";
import { organizationPath } from "@/lib/organization-path";
import { getResources, getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("auth");
  const title = t("meta.title");
  const description = t("meta.description");
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export const dynamic = "force-dynamic";

function safeCallback(
  value: string | string[] | undefined,
  fallback = "/inventory",
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : fallback;
}

function enabledQueryFlag(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "1" || candidate === "true";
}

function configuredDemoSlug() {
  const candidate = (
    process.env.DEMO_ORGANIZATION_SLUG?.trim() || "demo"
  ).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate) ? candidate : "demo";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    demo?: string | string[];
  }>;
}) {
  const [identity, translation, resolvedSearchParams] = await Promise.all([
    getSessionIdentity(),
    getT(["auth", "common"]),
    searchParams,
  ]);
  if (identity) {
    redirect(organizationPath(identity.organization.slug, "/inventory"));
  }
  const demoHighlighted =
    demoAccessEnabled && enabledQueryFlag(resolvedSearchParams.demo);
  const callbackUrl = safeCallback(resolvedSearchParams.callbackUrl);
  const demoCallbackUrl = safeCallback(
    resolvedSearchParams.callbackUrl,
    organizationPath(configuredDemoSlug(), "/inventory"),
  );
  const resources = getResources(translation.i18n, ["auth", "common"]);
  const { t } = translation;

  return (
    <UiI18nProvider language={translation.lng} resources={resources}>
      <main className="min-h-dvh bg-surface-subtle">
        <div className="safe-area-page mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
          <header className="flex items-center justify-between gap-4 text-foreground">
            <div className="flex items-center gap-2.5">
              <BrandMark className="size-8 shrink-0" aria-hidden="true" />
              <span className="text-[17px] font-semibold">
                {t("brand")}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <LocalizedThemeToggle />
              <LanguageSwitcher compact />
            </div>
          </header>

          <section className="flex flex-1 items-center justify-center py-12">
            <div className="w-full max-w-[400px]">
              <h1 className="text-2xl font-semibold text-foreground sm:text-[30px]">
                {t(demoHighlighted ? "hero.demoTitle" : "hero.title")}
              </h1>
              <p className="mt-2 text-[17px] leading-6 text-muted">
                {t(
                  demoHighlighted
                    ? "hero.demoDescription"
                    : "hero.description",
                )}
              </p>

              <div className="mt-8 animate-fade-up animation-delay-1">
                <LoginForm
                  passwordEnabled={passwordAuthEnabled}
                  externalProviders={externalAuthProviders}
                  demoEnabled={demoAccessEnabled}
                  demoHighlighted={demoHighlighted}
                  callbackUrl={callbackUrl}
                  demoCallbackUrl={demoCallbackUrl}
                />
              </div>
            </div>
          </section>

        </div>
      </main>
    </UiI18nProvider>
  );
}
