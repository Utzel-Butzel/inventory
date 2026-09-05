import {
  roomAiAnalysisSchema,
  type RoomAiAnalysis,
  type RoomAiDetection,
} from "@/lib/room-ai-analysis-contract";
import { createEstimatedRoomObjectPlacement } from "@/lib/room-ai-estimated-placement";
import type { RoomScene } from "@/lib/room-scene-contract";
import { compatibleRoomFurnitureVariant } from "@/lib/room-furniture-catalog";

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
    objectSuggestions: [...options.detection.objectSuggestions].sort((a,b) => b.confidence - a.confidence).flatMap((suggestion, index) => {
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
      if (candidate && boundObjectIds.has(candidate.id)) return [];
      const roomObjectId = candidate?.id ?? null;
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
        modelVariant: suggestion.confidence >= .65 && imageEvidence.some(item => item.visibility === "clear" && item.confidence >= .65)
          ? compatibleRoomFurnitureVariant(suggestion.modelVariant, candidate?.category ?? suggestion.roomPlanCategory ?? suggestion.category)
          : null,
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

function evidenceOverlap(left: readonly number[], right: readonly number[]) {
  const area = (box: readonly number[]) => Math.max(0, box[2]! - box[0]!) * Math.max(0, box[3]! - box[1]!);
  const intersection = Math.max(0, Math.min(left[2]!, right[2]!) - Math.max(left[0]!, right[0]!)) * Math.max(0, Math.min(left[3]!, right[3]!) - Math.max(left[1]!, right[1]!));
  return intersection / Math.max(1, area(left) + area(right) - intersection);
}

/** Retain reviewed geometry and manual placement when the same scan is analyzed again. */
export function mergeReviewedRoomAnalysis(previous: RoomAiAnalysis | null, next: RoomAiAnalysis): RoomAiAnalysis {
  if (!previous) return next;
  const reviewed = previous.objectSuggestions.filter(item => item.status !== "pending");
  const used = new Set<string>();
  const objects = next.objectSuggestions.map(item => {
    const match = reviewed.find(old => !used.has(old.id) && (
      (item.roomObjectId && old.roomObjectId === item.roomObjectId) ||
      (!item.roomObjectId && !old.roomObjectId && normalizedCategory(item.category) === normalizedCategory(old.category) && item.imageEvidence.some(e => old.imageEvidence.some(o => o.keyframeId === e.keyframeId && evidenceOverlap(o.bounds, e.bounds) >= 0.65)))
    ));
    if (!match) return item;
    used.add(match.id);
    return match;
  });
  const retained = reviewed.filter(item => !used.has(item.id));
  const reviewedSurfaces = previous.surfaceAppearances.filter(item => item.status !== "pending");
  return roomAiAnalysisSchema.parse({ ...next,
    surfaceAppearances: [
      ...reviewedSurfaces,
      ...next.surfaceAppearances.filter(item => !reviewedSurfaces.some(old => old.surfaceCategory === item.surfaceCategory)),
    ],
    objectSuggestions: [...retained, ...objects.filter(item => item.status !== "pending"), ...objects.filter(item => item.status === "pending")].slice(0, 48),
  });
}
