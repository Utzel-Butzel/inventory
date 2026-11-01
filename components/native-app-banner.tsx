"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Smartphone } from "lucide-react";
import { nativeAppLink } from "@/lib/native-app-link";

export function NativeAppBanner({ language }: { language: "de" | "en" }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setHref(isIOS ? nativeAppLink(window.location.href) : null);
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [pathname, searchParams]);

  if (!href) return null;
  return (
    <aside className="flex items-center justify-center gap-3 border-b border-border bg-surface-subtle px-4 py-2 text-sm text-foreground">
      <Smartphone className="size-4 shrink-0" aria-hidden="true" />
      <span>{language === "de" ? "iOS-App installiert?" : "iOS app installed?"}</span>
      <a href={href} className="font-semibold underline underline-offset-4">
        {language === "de" ? "In der App öffnen" : "Open in app"}
      </a>
    </aside>
  );
}
