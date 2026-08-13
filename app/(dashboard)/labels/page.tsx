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

export default async function LabelsPage() {
  const identity = await getSessionIdentity();
  return (
    <LabelPrinter
      canWrite={Boolean(identity?.permissions.includes("labels.manage"))}
    />
  );
}
