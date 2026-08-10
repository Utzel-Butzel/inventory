import type { Metadata } from "next";

import { DuplicatesClient } from "@/components/duplicates-client";

export const metadata: Metadata = {
  title: "Duplicates | Inventory",
  description: "Review and merge potential duplicate inventory records.",
};

export default function DuplicatesPage() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-8 max-w-3xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
          Data quality
        </p>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-4xl">
          Duplicate review
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-500 sm:text-base">
          Compare likely matches side by side, then choose which record should
          remain as the source of truth.
        </p>
      </div>

      <DuplicatesClient />
    </main>
  );
}
