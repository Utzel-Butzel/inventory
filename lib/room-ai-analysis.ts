import {
  roomAiAnalysisSchema,
  type RoomAiAnalysis,
  type RoomAiDetection,
} from "@/lib/room-ai-analysis-contract";
import type { RoomScene } from "@/lib/room-scene-contract";

const normalizedCategory = (value: string) => value.trim().toLocaleLowerCase();

export function buildRoomAiAnalysis(options: {
  detection: RoomAiDetection;
  scene: RoomScene;
  keyframeIds: string[];
  model: string;
  analyzedAt?: string;
  createId: () => string;
}): RoomAiAnalysis {
  const allowedKeyframes = new Set(options.keyframeIds);
  const fallbackKeyframeId = options.keyframeIds[0]!;
  const surfaceCategories = new Set(
    options.scene.surfaces.map((surface) => surface.category),
  );
  const usedSurfaceCategories = new Set<string>();
  const objectsByCategory = new Map<string, typeof options.scene.objects>();
  for (const object of options.scene.objects) {
    const category = normalizedCategory(object.category);
    const values = objectsByCategory.get(category);
    if (values) values.push(object);
    else objectsByCategory.set(category, [object]);
  }
  const boundObjectIds = new Set<string>();

  return roomAiAnalysisSchema.parse({
    schemaVersion: 1,
    analyzedAt: options.analyzedAt ?? new Date().toISOString(),
    model: options.model,
    summary: options.detection.summary,
    analyzedKeyframeIds: options.keyframeIds,
    surfaceAppearances: options.detection.surfaceAppearances
      .filter((appearance) => {
        if (
          !surfaceCategories.has(appearance.surfaceCategory) ||
          usedSurfaceCategories.has(appearance.surfaceCategory)
        ) {
          return false;
        }
        usedSurfaceCategories.add(appearance.surfaceCategory);
        return true;
      })
      .map((appearance) => ({
        ...appearance,
        id: options.createId(),
        status: "pending" as const,
        colorHex: appearance.colorHex.toUpperCase(),
        windowDetails: appearance.surfaceCategory === "window"
          ? appearance.windowDetails
          : null,
        evidenceKeyframeIds: appearance.evidenceKeyframeIds.filter((id) =>
          allowedKeyframes.has(id),
        ),
      })),
    objectSuggestions: options.detection.objectSuggestions.map((suggestion) => {
      const candidates = suggestion.roomPlanCategory
        ? objectsByCategory.get(normalizedCategory(suggestion.roomPlanCategory)) ?? []
        : [];
      const candidate = candidates.length === 1 ? candidates[0]! : null;
      const roomObjectId = candidate && !boundObjectIds.has(candidate.id)
        ? candidate.id
        : null;
      if (roomObjectId) boundObjectIds.add(roomObjectId);
      const evidenceKeyframeIds = suggestion.evidenceKeyframeIds.filter((id) =>
        allowedKeyframes.has(id),
      );
      return {
        id: options.createId(),
        name: suggestion.name,
        category: suggestion.category,
        description: suggestion.description,
        colorHex: suggestion.colorHex?.toUpperCase() ?? null,
        material: suggestion.material,
        confidence: suggestion.confidence,
        evidence: suggestion.evidence,
        evidenceKeyframeIds: evidenceKeyframeIds.length
          ? evidenceKeyframeIds
          : [fallbackKeyframeId],
        roomObjectId,
        primitiveModel: roomObjectId ? suggestion.primitiveModel : null,
        status: "pending" as const,
      };
    }),
  });
}
