import { USDZ_MEDIA_TYPE } from "@/lib/resource-media-contract";

export const canonicalUsdzMimeType = USDZ_MEDIA_TYPE;

export const usdzMimeTypes = new Set([
  canonicalUsdzMimeType,
  "model/vnd.pixar.usdz",
  "model/usdz",
  "application/vnd.usdz+zip",
]);

type UsdzFileLike = {
  name?: string | null;
  mimeType?: string | null;
  type?: string | null;
};

export function isUsdzMedia(item: UsdzFileLike) {
  const mimeType = (item.mimeType ?? item.type ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  return Boolean(
    (mimeType && usdzMimeTypes.has(mimeType)) ||
      item.name?.trim().toLowerCase().endsWith(".usdz"),
  );
}
