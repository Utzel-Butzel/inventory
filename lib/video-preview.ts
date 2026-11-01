export type VideoMediaLike = {
  id: string;
  kind: string;
  url: string;
  mimeType: string;
  previewMediaId?: string | null;
  posterMediaId?: string | null;
};

export function videoPreviewSources(item: VideoMediaLike, media: VideoMediaLike[]) {
  const preview = item.kind === "video" ? media.find((candidate) =>
    candidate.id === item.previewMediaId && candidate.id !== item.id &&
    candidate.kind === "video" && candidate.mimeType.startsWith("video/"),
  ) : undefined;
  const poster = item.kind === "video" ? media.find((candidate) =>
    candidate.id === item.posterMediaId && candidate.kind === "image" &&
    candidate.mimeType.startsWith("image/") && candidate.mimeType !== "image/svg+xml",
  ) : undefined;
  return { src: preview?.url ?? item.url, poster: poster?.url, preview, posterMedia: poster };
}

// Keep the underlying attachments available for editing, deletion and export,
// but don't show a video's supporting files twice in its gallery.
export function videoGalleryMedia<T extends VideoMediaLike>(media: T[]): T[] {
  const supportingIds = new Set<string>();
  for (const item of media) {
    const { preview, posterMedia } = videoPreviewSources(item, media);
    if (preview) supportingIds.add(preview.id);
    if (posterMedia) supportingIds.add(posterMedia.id);
  }
  return media.filter((item) => !supportingIds.has(item.id));
}
