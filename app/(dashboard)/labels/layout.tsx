import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LabelPrinter } from "@/components/label-printer";
import { getSessionIdentity } from "@/lib/api-auth";

import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("labels");
  return { title: t("meta.title"), description: t("meta.description") };
}

export default async function LabelsLayout({ children }: { children: ReactNode }) {
  const identity = await getSessionIdentity();
  return <>
    <LabelPrinter
      canWrite={Boolean(identity?.permissions.includes("labels.manage"))}
      canManagePrinters={Boolean(identity?.permissions.includes("tokens.manage"))}
    />
    {children}
  </>;
}
