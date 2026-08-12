import { Suspense } from "react";

import { RoomSceneBrowser } from "@/components/room-scene-browser";

export const dynamic = "force-dynamic";

export default function SpacesPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[calc(100dvh-68px)] place-items-center text-sm text-slate-600">
          Loading 3D rooms…
        </div>
      }
    >
      <RoomSceneBrowser />
    </Suspense>
  );
}
