import {
  roomAiAnalysisSchema,
  type RoomAiAnalysis,
  type RoomAiDetection,
} from "@/lib/room-ai-analysis-contract";
import { createEstimatedRoomObjectPlacement } from "@/lib/room-ai-estimated-placement";
import type { RoomScene } from "@/lib/room-scene-contract";

const normalizedCategory = (value: string) => value.trim().toLocaleLowerCase();

export function buildRoomAiAnalysis(options: {
  detection: RoomAiDetection;
  scene: RoomScene;
  keyframeIds: string[];
  calibratedKeyframeIds?: string[];
  model: string;
  analyzedAt?: string;
  createId: () => string;
}): RoomAiAnalysis {
  const allowedKeyframes = new Set(options.keyframeIds);
  const calibratedKeyframes = new Set(
    options.calibratedKeyframeIds ?? options.keyframeIds,
  );
  const surfaceCategories = new Set(
    options.scene.surfaces.map((surface) => surface.category),
  );
  const usedSurfaceCategories = new Set<string>();
  const objectsById = new Map(
    options.scene.objects.map((object) => [object.id, object]),
  );
  const boundObjectIds = new Set<string>();

  return roomAiAnalysisSchema.parse({
    schemaVersion: 1,
    analyzedAt: options.analyzedAt ?? new Date().toISOString(),
    model: options.model,
    summary: options.detection.summary,
    analyzedKeyframeIds: options.keyframeIds,
    surfaceAppearances: options.detection.surfaceAppearances
      .flatMap((appearance) => {
        const evidenceKeyframeIds = appearance.evidenceKeyframeIds.filter(
          (id) => allowedKeyframes.has(id),
        );
        if (
          !surfaceCategories.has(appearance.surfaceCategory) ||
          usedSurfaceCategories.has(appearance.surfaceCategory) ||
          !evidenceKeyframeIds.length
        ) {
          return [];
        }
        usedSurfaceCategories.add(appearance.surfaceCategory);
        return [{
          ...appearance,
          id: options.createId(),
          status: "pending" as const,
          colorHex: appearance.colorHex.toUpperCase(),
          windowDetails: appearance.surfaceCategory === "window"
            ? appearance.windowDetails
            : null,
          evidenceKeyframeIds,
        }];
      }),
    objectSuggestions: options.detection.objectSuggestions.flatMap((suggestion, index) => {
      const evidenceKeyframeIds = suggestion.evidenceKeyframeIds.filter((id) =>
        allowedKeyframes.has(id)
      );
      const evidenceIds = new Set(evidenceKeyframeIds);
      const imageEvidence = suggestion.imageEvidence.flatMap((item) => {
        if (
          !evidenceIds.has(item.keyframeId) ||
          !allowedKeyframes.has(item.keyframeId)
        ) {
          return [];
        }
        const [firstX, firstY, secondX, secondY] = item.bounds;
        const left = Math.min(firstX!, secondX!);
        const top = Math.min(firstY!, secondY!);
        const right = Math.max(firstX!, secondX!);
        const bottom = Math.max(firstY!, secondY!);
        if (left === right || top === bottom) return [];
        return [{ ...item, bounds: [left, top, right, bottom] }];
      });
      if (!imageEvidence.length) return [];
      const supportedEvidenceIds = new Set(
        imageEvidence.map(({ keyframeId }) => keyframeId),
      );
      const supportedKeyframeIds = evidenceKeyframeIds.filter((id) =>
        supportedEvidenceIds.has(id)
      );
      if (!supportedKeyframeIds.length) return [];
      const hasCalibratedEvidence = supportedKeyframeIds.some((id) =>
        calibratedKeyframes.has(id)
      );

      const explicitCandidate = suggestion.roomPlanObjectId
        ? objectsById.get(suggestion.roomPlanObjectId) ?? null
        : null;
      const candidate = hasCalibratedEvidence && explicitCandidate &&
          suggestion.roomPlanCategory &&
          normalizedCategory(explicitCandidate.category) ===
            normalizedCategory(suggestion.roomPlanCategory)
        ? explicitCandidate
        : null;
      const roomObjectId = candidate && !boundObjectIds.has(candidate.id)
        ? candidate.id
        : null;
      if (roomObjectId) boundObjectIds.add(roomObjectId);
      return [{
        id: options.createId(),
        name: suggestion.name,
        category: suggestion.category,
        description: suggestion.description,
        colorHex: suggestion.colorHex?.toUpperCase() ?? null,
        material: suggestion.material,
        confidence: suggestion.confidence,
        evidence: suggestion.evidence,
        evidenceKeyframeIds: supportedKeyframeIds,
        imageEvidence,
        roomObjectId,
        primitiveModel: suggestion.primitiveModel,
        estimatedPlacement: roomObjectId
          ? null
          : createEstimatedRoomObjectPlacement({
              scene: options.scene,
              suggestion,
              index,
              total: options.detection.objectSuggestions.length,
            }),
        status: "pending" as const,
      }];
    }),
  });
}
