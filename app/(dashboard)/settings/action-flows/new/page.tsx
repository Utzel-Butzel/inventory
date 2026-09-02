import type { Metadata } from "next";

import { StockWorkflowBuilder } from "@/components/stock-workflow-builder";
import { requireSettingsPermission } from "@/lib/settings-access";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("scanner");
  return {
    title: t("metadata.workflowsTitle"),
    description: t("metadata.workflowsDescription"),
  };
}

export default async function NewActionFlowSettingsPage() {
  await requireSettingsPermission("workflows.manage");

  return <StockWorkflowBuilder canManage view="editor" />;
}
