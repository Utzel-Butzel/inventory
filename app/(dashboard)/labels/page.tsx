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
  searchParams: Promise<{ resourceId?: string | string[]; unitId?: string | string[] }>;
}) {
  const { resourceId, unitId } = await searchParams;
  const initialResourceId = typeof resourceId === "string" ? resourceId : undefined;
  const initialUnitId = initialResourceId && typeof unitId === "string" ? unitId : undefined;
  const identity = await getSessionIdentity();
  return (
    <LabelPrinter
      key={`${initialResourceId ?? "all"}:${initialUnitId ?? ""}`}
      initialResourceId={initialResourceId}
      initialUnitId={initialUnitId}
      canWrite={Boolean(identity?.permissions.includes("labels.manage"))}
      canManagePrinters={Boolean(identity?.permissions.includes("tokens.manage"))}
    />
  );
}
