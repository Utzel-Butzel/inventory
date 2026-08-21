"use client";

import dynamic from "next/dynamic";

import type { ClientRoomSceneManifest } from "@/lib/client-types";

const RoomSceneCanvas = dynamic(
  () =>
    import("@/components/room-scene-canvas").then(
      (module) => module.RoomSceneCanvas,
    ),
  { ssr: false },
);

export function LightingPreviewClient({
  manifest,
}: {
  manifest: ClientRoomSceneManifest;
}) {
  return (
    <main className="h-dvh w-full bg-surface-muted">
      <RoomSceneCanvas
        manifest={manifest}
        selectedResourceId={null}
        onSelectResource={() => undefined}
      />
    </main>
  );
}
