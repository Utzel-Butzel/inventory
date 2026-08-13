import type { Metadata } from "next";
import Link from "next/link";
import { FileCode2 } from "lucide-react";

import { ApiTokenManager } from "@/components/api-token-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return {
    title: t("pages.api.title"),
    description: t("pages.api.metaDescription"),
  };
}

export default async function ApiSettingsPage() {
  const [identity, { t }] = await Promise.all([
    getSessionIdentity(),
    getT("settings"),
  ]);

  return (
    <>
      <SettingsPageHeader
        title={t("pages.api.title")}
        description={t("pages.api.description")}
        action={
          <Link
            href="/api-docs"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground shadow-sm transition hover:border-border-strong hover:bg-surface-subtle"
          >
            <FileCode2 className="size-4" aria-hidden="true" />
            {t("pages.api.documentation")}
          </Link>
        }
      />
      <ApiTokenManager
        isAdmin={Boolean(identity?.permissions.includes("tokens.manage"))}
      />
    </>
  );
}
