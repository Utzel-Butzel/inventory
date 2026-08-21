import type { Metadata } from "next";

import { InternalRequestsClient } from "@/components/internal-requests-client";
import { RequestSectionNav } from "@/components/request-section-nav";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("requests");
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export default function RequestsPage() {
  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <RequestSectionNav />
      <InternalRequestsClient />
    </main>
  );
}
