import type { Metadata } from "next";

import { StockSectionNav } from "@/components/stock-section-nav";
import { StockWorkflowBuilder } from "@/components/stock-workflow-builder";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("scanner");
  return {
    title: t("metadata.workflowsTitle"),
    description: t("metadata.workflowsDescription"),
  };
}

export default async function StockWorkflowsPage() {
  const identity = await getSessionIdentity();

  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <StockSectionNav />
      <StockWorkflowBuilder
        canManage={Boolean(identity?.permissions.includes("workflows.manage"))}
      />
    </main>
  );
}
