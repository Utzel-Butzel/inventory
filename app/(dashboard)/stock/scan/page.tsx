import type { Metadata } from "next";

import { StockScanner } from "@/components/stock-scanner";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("scanner");
  return {
    title: t("metadata.scanTitle"),
    description: t("metadata.scanDescription"),
  };
}

export default async function StockScanPage({ searchParams }: { searchParams: Promise<{ workflow?: string }> }) {
  const identity = await getSessionIdentity();
  const { workflow } = await searchParams;

  return (
    <StockScanner
      initialWorkflowId={workflow}
      canExecute={Boolean(identity?.permissions.includes("workflows.manage"))}
    />
  );
}
