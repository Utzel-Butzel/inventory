import type { Metadata } from "next";

import { DashboardClient } from "@/components/dashboard-client";
import { getT } from "@/lib/ui-i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("dashboard");
  return { title: t("metadata.title") };
}

export default function DashboardPage() {
  return <DashboardClient />;
}
