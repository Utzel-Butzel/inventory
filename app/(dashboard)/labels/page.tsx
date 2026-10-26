import type { Metadata } from "next";

import { LabelPrinter } from "@/components/label-printer";
import { getSessionIdentity } from "@/lib/api-auth";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("labels");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
  };
}

export const dynamic = "force-dynamic";

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ resourceId?: string | string[] }>;
}) {
  const { resourceId } = await searchParams;
  const identity = await getSessionIdentity();
  return (
    <LabelPrinter
      key={typeof resourceId === "string" ? resourceId : "all"}
      initialResourceId={typeof resourceId === "string" ? resourceId : undefined}
      canWrite={Boolean(identity?.permissions.includes("labels.manage"))}
      canManagePrinters={Boolean(identity?.permissions.includes("tokens.manage"))}
    />
  );
}
