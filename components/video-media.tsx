"use client";

import { useState } from "react";
import { useT } from "next-i18next/client";
import { videoPreviewSources, type VideoMediaLike } from "@/lib/video-preview";

export function VideoMedia({ item, media }: {
  item: VideoMediaLike & { name: string };
  media: VideoMediaLike[];
}) {
  const { t } = useT("resource");
  const { src, poster } = videoPreviewSources(item, media);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface-subtle">
      <video
        key={failedPreview === src ? item.url : src}
        src={failedPreview === src ? item.url : src}
        poster={poster}
        controls
        playsInline
        preload="none"
        aria-label={item.name}
        className="aspect-square w-full bg-black object-contain"
        onError={() => { if (src !== item.url) setFailedPreview(src); }}
      />
      <a href={item.url} target="_blank" rel="noreferrer" className="block truncate p-3 text-sm text-foreground">
        {t("media.originalVideo")}: {item.name}
      </a>
    </div>
  );
}
