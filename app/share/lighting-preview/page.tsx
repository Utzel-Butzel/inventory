import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";

import { UiI18nProvider } from "@/components/ui-i18n-provider";
import { LightingPreviewClient } from "@/app/share/lighting-preview/preview-client";
import type { ClientRoomSceneManifest } from "@/lib/client-types";
import { db } from "@/lib/db";
import type { RoomScene, SpatialMatrix4 } from "@/lib/room-scene-contract";
import { getResources, getT } from "@/lib/ui-i18n/server";

export const dynamic = "force-dynamic";

const previewScanId = "22222222-2222-4222-8222-222222222222";

type PreviewRow = {
  scanId: string;
  roomId: string;
  roomName: string;
  roomDescription: string;
  revision: number;
  status: "active" | "superseded";
  scene: RoomScene;
  layoutTransform: SpatialMatrix4 | null;
  capturedAt: Date;
  deviceModel: string | null;
};

export default async function LightingPreviewPage() {
  // Select named columns so this visual-only route can run against a local
  // database before optional room-analysis migrations have been applied.
  const rows = await db.execute(sql`
    select
      room_scans.id as "scanId",
      resources.id as "roomId",
      resources.name as "roomName",
      resources.description as "roomDescription",
      room_scans.revision,
      room_scans.status,
      room_scans.scene,
      room_scans.layout_transform as "layoutTransform",
      room_scans.captured_at as "capturedAt",
      room_scans.device_model as "deviceModel"
    from room_scans
    inner join resources on resources.id = room_scans.room_resource_id
    where room_scans.id = ${previewScanId}
    limit 1
  `);
  const row = rows[0] as unknown as PreviewRow | undefined;
  if (!row) notFound();

  const manifest: ClientRoomSceneManifest = {
    room: {
      id: row.roomId,
      name: row.roomName,
      description: row.roomDescription,
    },
    scan: {
      id: row.scanId,
      revision: row.revision,
      status: row.status,
      scene: row.scene,
      layoutTransform: row.layoutTransform,
      capturedAt: new Date(row.capturedAt).toISOString(),
      deviceModel: row.deviceModel,
      assets: [],
      keyframes: [],
    },
    placements: [],
  };
  const translation = await getT();

  return (
    <UiI18nProvider
      language={translation.lng}
      resources={getResources(translation.i18n)}
    >
      <LightingPreviewClient manifest={manifest} />
    </UiI18nProvider>
  );
}
