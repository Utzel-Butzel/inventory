import type { RoomEstimatedObjectPlacement } from "@/lib/room-ai-analysis-contract";
import type { RoomScene } from "@/lib/room-scene-contract";

type SuggestionDescriptor = {
  name: string;
  category: string;
  description: string;
};

const searchable = (suggestion: SuggestionDescriptor) =>
  `${suggestion.name} ${suggestion.category} ${suggestion.description}`
    .trim()
    .toLocaleLowerCase();

export function estimatedRoomObjectModelCategory(
  suggestion: SuggestionDescriptor & { roomPlanCategory?: string | null },
) {
  if (suggestion.roomPlanCategory) return suggestion.roomPlanCategory;
  const value = searchable(suggestion);
  if (/chair|stuhl|sessel/.test(value)) return "chair";
  if (/desk|table|tisch/.test(value)) return "table";
  if (/monitor|screen|display|television|tv|bildschirm/.test(value)) {
    return "television";
  }
  if (/shelf|cabinet|storage|regal|schrank|box|bin|kiste/.test(value)) {
    return "storage";
  }
  if (/sofa|couch/.test(value)) return "sofa";
  if (/bed|bett/.test(value)) return "bed";
  return suggestion.category;
}

export function estimatedRoomObjectDimensions(
  suggestion: SuggestionDescriptor,
): [number, number, number] {
  const value = searchable(suggestion);
  if (/chair|stuhl|sessel/.test(value)) return [0.55, 1, 0.55];
  if (/desk|table|tisch/.test(value)) return [1.2, 0.76, 0.7];
  if (/monitor|screen|display|bildschirm/.test(value)) return [0.58, 0.42, 0.16];
  if (/laptop|notebook/.test(value)) return [0.34, 0.05, 0.24];
  if (/shelf|regal/.test(value)) return [0.9, 1.5, 0.35];
  if (/cabinet|storage|schrank/.test(value)) return [0.8, 1, 0.45];
  if (/cardboard|carton|box|bin|kiste|karton/.test(value)) return [0.42, 0.3, 0.34];
  if (/bottle|flasche/.test(value)) return [0.09, 0.29, 0.09];
  if (/glass|cup|becher|glas/.test(value)) return [0.09, 0.13, 0.09];
  if (/mouse|maus/.test(value)) return [0.12, 0.04, 0.07];
  if (/ruler|lineal/.test(value)) return [0.34, 0.025, 0.045];
  if (/phone|remote|telefon|fernbedien/.test(value)) return [0.08, 0.025, 0.16];
  if (/paper|card|label|papier|karte|etikett/.test(value)) return [0.21, 0.02, 0.3];
  if (/tray|container|organizer|behälter|ablage/.test(value)) {
    return [0.28, 0.1, 0.2];
  }
  return [0.3, 0.3, 0.3];
}

export function createEstimatedRoomObjectPlacement(options: {
  scene: Pick<RoomScene, "bounds" | "surfaces">;
  suggestion: SuggestionDescriptor;
  index: number;
  total: number;
}): RoomEstimatedObjectPlacement {
  const dimensions = estimatedRoomObjectDimensions(options.suggestion);
  const { min, max } = options.scene.bounds;
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, options.total))));
  const rows = Math.max(1, Math.ceil(Math.max(1, options.total) / columns));
  const column = options.index % columns;
  const row = Math.floor(options.index / columns);
  const insetX = Math.min(0.35, Math.max(0.08, (max[0] - min[0]) * 0.08));
  const insetZ = Math.min(0.35, Math.max(0.08, (max[2] - min[2]) * 0.08));
  const usableX = Math.max(0, max[0] - min[0] - insetX * 2);
  const usableZ = Math.max(0, max[2] - min[2] - insetZ * 2);
  const floorHeights = options.scene.surfaces
    .filter(({ category }) => category === "floor")
    .map(({ transform }) => transform[13]!)
    .filter(Number.isFinite);
  const floorY = floorHeights.length ? Math.min(...floorHeights) : min[1];
  return {
    position: [
      min[0] + insetX + usableX * ((column + 0.5) / columns),
      floorY + dimensions[1] / 2,
      min[2] + insetZ + usableZ * ((row + 0.5) / rows),
    ],
    rotationYDegrees: 0,
    dimensions,
  };
}
