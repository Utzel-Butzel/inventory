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

export default async function EditActionFlowSettingsPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const identity = await requireSettingsPermission("workflows.read");
  const { workflowId } = await params;

  return (
    <StockWorkflowBuilder
      canManage={identity.permissions.includes("workflows.manage")}
      view="editor"
      workflowId={workflowId}
    />
  );
}
