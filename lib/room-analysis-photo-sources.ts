import { maximumRoomAnalysisKeyframes } from "@/lib/room-ai-analysis-contract";
import { sampleRoomAnalysisKeyframes } from "@/lib/room-scene-visualization";

export type RoomAnalysisPhotoSource = {
  id: string;
  quality: number;
  orientation: string;
  storageKey: string;
  storageUrl: string;
  cameraTransform: number[] | null;
  intrinsics: number[] | null;
  nativeWidth: number | null;
  nativeHeight: number | null;
};

type StoredGuideImage = Pick<
  RoomAnalysisPhotoSource,
  "id" | "storageKey" | "storageUrl"
>;

type StoredKeyframe = Pick<
  RoomAnalysisPhotoSource,
  "id" | "quality" | "orientation" | "storageKey" | "storageUrl"
> & {
  cameraTransform: number[];
  intrinsics: number[];
  imageWidth: number;
  imageHeight: number;
};

/**
 * Includes the RoomPlan guide image as uncalibrated visual evidence. Some
 * otherwise useful scans contain that photo but no camera keyframes.
 */
export function selectRoomAnalysisPhotoSources(options: {
  keyframes: readonly StoredKeyframe[];
  guideImage: StoredGuideImage | null;
  limit?: number;
}) {
  const limit = options.limit ?? maximumRoomAnalysisKeyframes;
  if (limit <= 0) return [];
  const selectedKeyframes = sampleRoomAnalysisKeyframes(
    options.keyframes,
    Math.max(0, limit - (options.guideImage ? 1 : 0)),
  );
  return [
    ...(options.guideImage
      ? [{
          id: options.guideImage.id,
          quality: 1,
          orientation: "up",
          storageKey: options.guideImage.storageKey,
          storageUrl: options.guideImage.storageUrl,
          cameraTransform: null,
          intrinsics: null,
          nativeWidth: null,
          nativeHeight: null,
        } satisfies RoomAnalysisPhotoSource]
      : []),
    ...selectedKeyframes.map((frame) => ({
      id: frame.id,
      quality: frame.quality,
      orientation: frame.orientation,
      storageKey: frame.storageKey,
      storageUrl: frame.storageUrl,
      cameraTransform: frame.cameraTransform,
      intrinsics: frame.intrinsics,
      nativeWidth: frame.imageWidth,
      nativeHeight: frame.imageHeight,
    } satisfies RoomAnalysisPhotoSource)),
  ].slice(0, limit);
}
