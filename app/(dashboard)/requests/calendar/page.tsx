import type { Metadata } from "next";

import { RequestSectionNav } from "@/components/request-section-nav";
import { ReservationCalendar } from "@/components/reservation-calendar";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("requests");
  return {
    title: t("calendar.metadata.title"),
    description: t("calendar.metadata.description"),
  };
}

export default function ReservationCalendarPage() {
  return (
    <main className="mx-auto w-full max-w-[1540px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <RequestSectionNav />
      <ReservationCalendar />
    </main>
  );
}
