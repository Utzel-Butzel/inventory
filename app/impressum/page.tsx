import type { Metadata } from "next";

import {
  MarketingFooter,
  MarketingHeader,
} from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: { absolute: "Impressum — Open Inventory" },
  robots: { index: false, follow: true },
};

export default function ImpressumPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#f7f5ef] text-[#1a1b1e]">
      <MarketingHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-1 px-5 py-20 sm:px-8 sm:py-28">
        <h1 className="text-[48px] font-semibold tracking-[-0.06em] sm:text-[68px]">
          Impressum
        </h1>
      </main>
      <MarketingFooter />
    </div>
  );
}
