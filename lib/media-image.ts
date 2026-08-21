export const MEDIA_IMAGE_VARIANT_WIDTHS = [
  96,
  192,
  384,
  640,
  960,
  1280,
  1600,
] as const;

export type MediaImageVariantWidth =
  (typeof MEDIA_IMAGE_VARIANT_WIDTHS)[number];
export type MediaImageFit = "cover" | "contain";

export type MediaImageSource = {
  id?: string;
  url: string;
  width?: number | null;
  height?: number | null;
};

const variantWidthSet = new Set<number>(MEDIA_IMAGE_VARIANT_WIDTHS);

export function normalizeMediaImageVariantWidth(
  value: unknown,
): MediaImageVariantWidth | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && variantWidthSet.has(parsed)
    ? (parsed as MediaImageVariantWidth)
    : null;
}

export function normalizeMediaImageFit(value: unknown): MediaImageFit | null {
  return value === "cover" || value === "contain" ? value : null;
}

export function parseMediaImageVariant(
  searchParams: URLSearchParams,
): { width: MediaImageVariantWidth; fit: MediaImageFit } | null {
  const width = normalizeMediaImageVariantWidth(searchParams.get("w"));
  const fit = normalizeMediaImageFit(searchParams.get("fit") ?? "cover");
  return width && fit ? { width, fit } : null;
}

function appendVariantQuery(
  source: string,
  width: MediaImageVariantWidth,
  fit: MediaImageFit,
) {
  const hashIndex = source.indexOf("#");
  const hash = hashIndex >= 0 ? source.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const separator = withoutHash.includes("?") ? "&" : "?";
  return `${withoutHash}${separator}w=${width}&fit=${fit}${hash}`;
}

export function mediaImageVariantUrl(
  media: MediaImageSource,
  width: MediaImageVariantWidth,
  fit: MediaImageFit,
  delivery: "authenticated" | "public" = "authenticated",
) {
  if (delivery === "public") {
    return appendVariantQuery(media.url, width, fit);
  }
  if (media.id) {
    return `/api/v1/media/${encodeURIComponent(media.id)}/thumbnail/${fit}/${width}`;
  }
  if (media.url.startsWith("/api/files/")) {
    return appendVariantQuery(media.url, width, fit);
  }
  return media.url;
}

export function mediaImageSupportsVariants(
  media: MediaImageSource,
  delivery: "authenticated" | "public" = "authenticated",
) {
  return (
    delivery === "public" ||
    Boolean(media.id) ||
    media.url.startsWith("/api/files/")
  );
}
