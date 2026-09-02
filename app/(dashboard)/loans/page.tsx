import type { Metadata } from "next";

import { LoansOverview } from "@/components/loans-overview";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("loans");
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export default function LoansPage() {
  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <LoansOverview />
    </main>
  );
}
