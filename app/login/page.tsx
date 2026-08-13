import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Boxes,
  Check,
  ImageIcon,
  ScanSearch,
  Sparkles,
} from "lucide-react";

import { auth0Enabled } from "@/auth";
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

function safeCallback(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/dashboard";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const [identity, translation, resolvedSearchParams] = await Promise.all([
    getSessionIdentity(),
    getT(["auth", "common"]),
    searchParams,
  ]);
  if (identity) redirect(organizationPath(identity.organizationId, "/dashboard"));
  const callbackUrl = safeCallback(resolvedSearchParams.callbackUrl);
  const resources = getResources(translation.i18n, ["auth", "common"]);
  const { t } = translation;
  const analysisTags = ["workshop", "powerTool", "voltage"] as const;

  return (
    <UiI18nProvider language={translation.lng} resources={resources}>
      <main className="min-h-dvh bg-surface lg:grid lg:grid-cols-[minmax(460px,0.94fr)_minmax(520px,1.06fr)]">
      <section className="flex min-h-dvh flex-col px-6 py-7 sm:px-10 lg:px-14 xl:px-20">
        <div className="flex items-center justify-between gap-4 text-foreground">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-[10px] bg-brand-solid text-on-brand shadow-[0_6px_16px_rgba(99,91,255,0.24)]">
              <Boxes className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">
              {t("brand")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LocalizedThemeToggle />
            <LanguageSwitcher />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-16">
          <div className="animate-fade-up">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-brand">
              {t("hero.eyebrow")}
            </p>
            <h1 className="text-[32px] font-semibold tracking-[-0.045em] text-foreground sm:text-[36px]">
              {t("hero.title")}
            </h1>
            <p className="mt-3 text-[15px] leading-6 text-muted">
              {t("hero.description")}
            </p>
          </div>

          <div className="mt-9 animate-fade-up animation-delay-1">
            <LoginForm
              auth0Enabled={auth0Enabled}
              callbackUrl={callbackUrl}
            />
          </div>
        </div>

        <p className="text-xs text-muted">{t("hero.privacy")}</p>
      </section>

      <section className="subtle-grid relative hidden min-h-dvh overflow-hidden bg-[#171821] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="pointer-events-none absolute -right-36 -top-36 size-[520px] rounded-full bg-[#5147d9]/25 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-44 left-[-80px] size-[480px] rounded-full bg-[#3b82f6]/15 blur-[110px]" />

        <div className="relative flex items-center justify-between text-xs text-white/55">
          <span>{t("showcase.eyebrow")}</span>
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-white/75">
            {t("showcase.badge")}
          </span>
        </div>

        <div className="relative mx-auto w-full max-w-[620px]">
          <div className="mb-8 max-w-lg">
            <h2 className="text-3xl font-semibold leading-[1.15] tracking-[-0.04em] xl:text-[40px]">
              {t("showcase.title")}
            </h2>
            <p className="mt-4 max-w-md text-[15px] leading-6 text-white/55">
              {t("showcase.description")}
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/[0.075] p-3 shadow-2xl shadow-black/25 backdrop-blur-xl">
            <div className="rounded-[17px] border border-white/[0.07] bg-[#22232d] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#6ee7b7]" />
                  <span className="text-xs font-medium text-white/75">
                    {t("showcase.analysis.title")}
                  </span>
                </div>
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-[#a9a4ff]">
                  <Sparkles className="size-3" aria-hidden="true" />
                  {t("showcase.analysis.ready")}
                </span>
              </div>

              <div className="grid grid-cols-[140px_1fr] gap-4 xl:grid-cols-[170px_1fr]">
                <div className="relative grid aspect-square place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-[#4c5161] to-[#30323c]">
                  <div className="absolute inset-3 rounded-lg border border-dashed border-white/15" />
                  <ImageIcon className="size-8 text-white/30" aria-hidden="true" />
                  <span className="absolute bottom-3 left-3 rounded-md bg-black/25 px-2 py-1 text-[9px] text-white/60 backdrop-blur">
                    IMG_0842.JPG
                  </span>
                </div>
                <div className="space-y-3 py-1">
                  <div>
                    <p className="text-[10px] text-white/35">
                      {t("showcase.analysis.detectedItem")}
                    </p>
                    <p className="mt-1 text-sm font-medium text-white/85">
                      {t("showcase.analysis.itemName")}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/[0.055] p-2.5">
                      <p className="text-[9px] text-white/30">
                        {t("showcase.analysis.type")}
                      </p>
                      <p className="mt-1 text-[11px] text-white/70">
                        {t("showcase.analysis.tool")}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.055] p-2.5">
                      <p className="text-[9px] text-white/30">
                        {t("showcase.analysis.confidence")}
                      </p>
                      <p className="mt-1 text-[11px] text-[#6ee7b7]">96%</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {analysisTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-[#5147d9]/15 px-2 py-1 text-[9px] text-[#b9b5ff]"
                      >
                        {t(`showcase.analysis.tags.${tag}`)}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-white/40">
                    <Check className="size-3 text-[#6ee7b7]" aria-hidden="true" />
                    {t("showcase.analysis.generated")}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 text-[11px] text-white/45">
            <span className="flex items-center gap-2">
              <ScanSearch className="size-3.5 text-white/70" aria-hidden="true" />
              {t("showcase.features.smartAnalysis")}
            </span>
            <span className="flex items-center gap-2">
              <ImageIcon className="size-3.5 text-white/70" aria-hidden="true" />
              {t("showcase.features.imageGeneration")}
            </span>
            <span className="flex items-center gap-2">
              <Boxes className="size-3.5 text-white/70" aria-hidden="true" />
              {t("showcase.features.batchWorkflows")}
            </span>
          </div>
        </div>

        <p className="relative text-[11px] text-white/30">
          {t("showcase.footer")}
        </p>
      </section>
      </main>
    </UiI18nProvider>
  );
}
