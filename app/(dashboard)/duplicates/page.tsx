import type { Metadata } from "next";

import { DuplicatesClient } from "@/components/duplicates-client";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("inventory");
  return {
    title: t("duplicates.page.metadataTitle"),
    description: t("duplicates.page.metadataDescription"),
  };
}

export default async function DuplicatesPage() {
  const { t } = await getT("inventory");

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 max-w-3xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          {t("duplicates.page.eyebrow")}
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
          {t("duplicates.page.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted sm:text-base">
          {t("duplicates.page.description")}
        </p>
      </div>

      <DuplicatesClient />
    </main>
  );
}
