"use client";

import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";

export function AppLogo({ logoUrl, className }: { logoUrl: string | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!logoUrl || failedUrl === logoUrl) {
    return <BrandMark className={className} aria-hidden="true" />;
  }
  return (
    // Runtime URLs are loaded directly without a build-time image host allowlist.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      className={className}
      style={{ objectFit: "contain" }}
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(logoUrl)}
    />
  );
}
