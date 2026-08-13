import type { Metadata } from "next";
import { Suspense } from "react";

import { RoomSceneBrowser } from "@/components/room-scene-browser";
import { getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT("spatial");
  return {
    title: t("metadata.roomsTitle"),
    description: t("metadata.roomsDescription"),
  };
}

export default async function SpacesPage() {
  const { t } = await getT("spatial");
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[calc(100dvh-68px)] place-items-center text-sm text-muted" role="status">
          {t("rooms.loading")}
        </div>
      }
    >
      <RoomSceneBrowser />
    </Suspense>
  );
}
