"use client";

import type { ComponentPropsWithoutRef } from "react";

import {
  mediaImageSupportsVariants,
  mediaImageVariantUrl,
  type MediaImageFit,
  type MediaImageSource,
  type MediaImageVariantWidth,
} from "@/lib/media-image";

const DEFAULT_WIDTHS = [384, 640, 960] as const;

type ResponsiveMediaImageProps = Omit<
  ComponentPropsWithoutRef<"img">,
  "src" | "srcSet" | "sizes" | "loading" | "decoding" | "width" | "height"
> & {
  media: MediaImageSource;
  sizes: string;
  widths?: readonly MediaImageVariantWidth[];
  fit?: MediaImageFit;
  delivery?: "authenticated" | "public";
  eager?: boolean;
  alt: string;
};

export function ResponsiveMediaImage({
  media,
  sizes,
  widths = DEFAULT_WIDTHS,
  fit = "cover",
  delivery = "authenticated",
  eager = false,
  alt,
  ...props
}: ResponsiveMediaImageProps) {
  const supported = mediaImageSupportsVariants(media, delivery);
  const candidates = Array.from(new Set(widths)).sort((left, right) => left - right);
  const largest = candidates.at(-1);
  const src =
    supported && largest
      ? mediaImageVariantUrl(media, largest, fit, delivery)
      : media.url;
  const srcSet =
    supported && candidates.length
      ? candidates
          .map(
            (width) =>
              `${mediaImageVariantUrl(media, width, fit, delivery)} ${width}w`,
          )
          .join(", ")
      : undefined;

  return (
    // Authenticated media is resized by the browser-facing thumbnail route.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={alt}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "auto"}
    />
  );
}
