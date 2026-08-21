export type RoomPhotoVisibility = "clear" | "partial" | "occluded";

export function roomObjectProjectionMatchesEvidence(options: {
  imagePoint: readonly [number, number];
  imageBounds: readonly [number, number, number, number] | null;
  evidenceBounds: readonly [number, number, number, number];
  visibility: RoomPhotoVisibility;
}) {
  const [firstX, firstY, secondX, secondY] = options.evidenceBounds;
  const left = Math.min(firstX, secondX);
  const top = Math.min(firstY, secondY);
  const right = Math.max(firstX, secondX);
  const bottom = Math.max(firstY, secondY);
  if (left === right || top === bottom) return false;

  const padding = Math.min(
    120,
    Math.max(40, Math.max(right - left, bottom - top) * 0.15),
  );
  const centerMatches = options.imagePoint[0] >= left - padding &&
    options.imagePoint[0] <= right + padding &&
    options.imagePoint[1] >= top - padding &&
    options.imagePoint[1] <= bottom + padding;
  if (!centerMatches || !options.imageBounds) return false;

  const [projectedLeft, projectedTop, projectedRight, projectedBottom] =
    options.imageBounds;
  const evidenceArea = (right - left) * (bottom - top);
  const projectedArea = (projectedRight - projectedLeft) *
    (projectedBottom - projectedTop);
  if (evidenceArea <= 0 || projectedArea <= 0) return false;
  const intersectionWidth = Math.max(
    0,
    Math.min(right, projectedRight) - Math.max(left, projectedLeft),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(bottom, projectedBottom) - Math.max(top, projectedTop),
  );
  const overlapOfSmaller = intersectionWidth * intersectionHeight /
    Math.min(evidenceArea, projectedArea);
  const areaRatio = evidenceArea / projectedArea;
  const minimumAreaRatio = options.visibility === "clear"
    ? 0.1
    : options.visibility === "partial"
      ? 0.025
      : 0.01;
  const maximumAreaRatio = options.visibility === "clear" ? 8 : 20;
  return overlapOfSmaller >= 0.2 &&
    areaRatio >= minimumAreaRatio &&
    areaRatio <= maximumAreaRatio;
}
