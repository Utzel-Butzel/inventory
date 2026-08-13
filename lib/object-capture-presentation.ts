import { isUsdzMedia } from "@/lib/usdz";

type ObjectCaptureMediaLike = {
  id: string;
  kind: string;
  mimeType?: string;
  name?: string;
};

type ObjectCaptureUploadLike = {
  type: string;
  name: string;
};

export type ObjectCaptureUploadState = "none" | "model-only" | "bundle";

export function getObjectCaptureUploadState(
  files: ObjectCaptureUploadLike[],
): ObjectCaptureUploadState {
  const hasModel = files.some(isUsdzMedia);
  if (!hasModel) return "none";
  return files.some((file) => file.type.startsWith("image/"))
    ? "bundle"
    : "model-only";
}

export function getObjectCapturePresentation<T extends ObjectCaptureMediaLike>(
  media: T[],
  coverId: string | null,
) {
  const model = media.find(isUsdzMedia) ?? null;
  const featuredIds = new Set(
    [coverId, model?.id ?? null].filter((id): id is string => Boolean(id)),
  );

  return {
    model,
    gallery: media.filter((item) => !featuredIds.has(item.id)),
  };
}
