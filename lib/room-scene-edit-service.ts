import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resources, resourceSpatialPlacements, roomScans } from "@/db/schema";
import {
  rectangularRoomScene,
  splitRoomScene,
  regenerateRoomPresentation,
  type RoomEdit,
} from "@/lib/room-scene-editor";
import {
  roomSceneSchema,
  spatialMatricesApproximatelyEqual,
} from "@/lib/room-scene-contract";
import { invertSpatialMatrix } from "@/lib/room-floor-layout";
import { transformSpatialPoint } from "@/lib/spatial-georeference";

export async function editRoomScene(
  organizationId: string,
  scanId: string,
  edit: RoomEdit,
  actor: string,
) {
  return db.transaction(async (tx) => {
    const [scan] = await tx
      .select()
      .from(roomScans)
      .where(
        and(
          eq(roomScans.organizationId, organizationId),
          eq(roomScans.id, scanId),
        ),
      )
      .for("update");
    if (!scan) throw new Error("scan-not-found");
    if (scan.status !== "active" || scan.revision !== edit.revision)
      throw new Error("revision-conflict");
    let scene = roomSceneSchema.parse(scan.scene);
    let newScanId: string | null = null;
    let analysis = scan.aiAnalysis;
    if (edit.action === "regenerate") {
      scene = regenerateRoomPresentation(scene);
    } else if (edit.action === "object") {
      if (!scene.objects.some((o) => o.id === edit.objectId))
        throw new Error("object-not-found");
      scene.objects = scene.objects.map((o) =>
        o.id === edit.objectId
          ? {
              ...o,
              appearance: edit.appearance,
              transform: edit.transform ?? o.transform,
            }
          : o,
      );
    } else if (edit.action === "anchor") {
      scene.mapAnchor = edit.anchor;
    } else if (edit.action === "replace") {
      if (
        !spatialMatricesApproximatelyEqual(
          scene.worldFromModel,
          edit.scene.worldFromModel,
        ) ||
        !spatialMatricesApproximatelyEqual(
          scene.webFromWorld,
          edit.scene.webFromWorld,
        )
      )
        throw new Error("coordinate-frame-changed");
      scene = {
        ...edit.scene,
        mapAnchor: scene.mapAnchor,
        objects: edit.scene.objects.map((object) => ({
          ...object,
          appearance:
            object.appearance ??
            scene.objects.find((old) => old.id === object.id)?.appearance,
        })),
      };
      analysis = null;
    } else {
      let newScene;
      if (edit.action === "split") {
        [scene, newScene] = splitRoomScene(
          scene,
          edit.axis,
          edit.position,
          randomUUID,
        );
        analysis = null;
      } else {
        newScene = rectangularRoomScene(
          edit.width,
          edit.depth,
          edit.height,
          randomUUID,
        );
        newScene.worldFromModel = [...scene.worldFromModel];
        newScene.webFromWorld = [...scene.webFromWorld];
        newScene.mapAnchor = scene.mapAnchor;
      }
      const roomId = randomUUID();
      newScanId = randomUUID();
      await tx
        .insert(resources)
        .values({
          organizationId,
          id: roomId,
          name: edit.name,
          type: "place",
          createdBy: actor,
        });
      let layoutTransform = scan.layoutTransform
        ? [...scan.layoutTransform]
        : [...scene.worldFromModel];
      if (edit.action === "add") {
        const offset = scene.bounds.max[0] + edit.width / 2 + 0.1;
        layoutTransform = [...layoutTransform];
        for (let a = 0; a < 3; a++)
          layoutTransform[12 + a]! += layoutTransform[a]! * offset;
      }
      await tx
        .insert(roomScans)
        .values({
          organizationId,
          id: newScanId,
          roomResourceId: roomId,
          structureId: scan.structureId,
          coordinateSpaceId: scan.coordinateSpaceId,
          floorIdentifier: scan.floorIdentifier,
          floorIndex: scan.floorIndex,
          roomIdentifier: roomId,
          revision: 1,
          scene: newScene,
          layoutTransform,
          capturedAt: new Date(),
          createdBy: actor,
          deviceModel: "Manual room editor",
        });
      if (edit.action === "split") {
        const inverse = invertSpatialMatrix(scene.worldFromModel);
        if (!inverse) throw new Error("invalid-transform");
        const placements = await tx
          .select()
          .from(resourceSpatialPlacements)
          .where(
            and(
              eq(resourceSpatialPlacements.organizationId, organizationId),
              eq(resourceSpatialPlacements.roomScanId, scanId),
            ),
          );
        for (const p of placements) {
          const local = transformSpatialPoint(inverse, [
            p.positionX,
            p.positionY,
            p.positionZ,
          ]);
          if (local[edit.axis === "x" ? 0 : 2] >= edit.position) {
            await tx
              .update(resourceSpatialPlacements)
              .set({
                roomScanId: newScanId,
                localizationEvidence: null,
                updatedBy: actor,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(resourceSpatialPlacements.organizationId, organizationId),
                  eq(resourceSpatialPlacements.id, p.id),
                ),
              );
          }
        }
      }
    }
    if (edit.action !== "anchor" && edit.action !== "add" && edit.action !== "regenerate")
      scene.editedAt = new Date().toISOString();
    await tx
      .update(roomScans)
      .set({
        scene,
        aiAnalysis: analysis,
        revision: scan.revision + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(roomScans.organizationId, organizationId),
          eq(roomScans.id, scanId),
        ),
      );
    return { scanId, newScanId };
  });
}

export async function createManualRoom(
  organizationId: string,
  input: { name: string; width: number; depth: number; height: number },
  actor: string,
) {
  return db.transaction(async (tx) => {
    const roomId = randomUUID(),
      scanId = randomUUID();
    await tx
      .insert(resources)
      .values({
        organizationId,
        id: roomId,
        name: input.name,
        type: "place",
        createdBy: actor,
      });
    await tx
      .insert(roomScans)
      .values({
        organizationId,
        id: scanId,
        roomResourceId: roomId,
        revision: 1,
        scene: rectangularRoomScene(
          input.width,
          input.depth,
          input.height,
          randomUUID,
        ),
        capturedAt: new Date(),
        createdBy: actor,
        deviceModel: "Manual room editor",
      });
    return scanId;
  });
}
