import type { Metadata } from "next";
import { AiPromptManager } from "@/components/ai-prompt-manager";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { requireSettingsPermission } from "@/lib/settings-access";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("settings");
  return { title: t("prompts.title") };
}
export default async function AiSettingsPage() {
  const identity = await requireSettingsPermission("roles.manage");
  const { t } = await getT("settings");
  return (
    <>
      <SettingsPageHeader
        title={t("prompts.title")}
        description={t("prompts.description")}
      />
      <AiPromptManager key={identity.organizationId} />
    </>
  );
}
