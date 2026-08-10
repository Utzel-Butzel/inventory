import type { Metadata } from "next";
import Link from "next/link";
import { Braces, ExternalLink, FileCode2, KeyRound } from "lucide-react";

import { ApiDocumentation } from "@/components/api-documentation";

export const metadata: Metadata = {
  title: "API docs",
  description: "Explore and test the Inventory bearer-token API.",
};

export default function ApiDocsPage() {
  return (
    <div className="min-h-[calc(100dvh-68px)] bg-white">
      <section className="border-b border-zinc-200 bg-[#f6f7f9] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
              Developer tools
            </p>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-zinc-950 sm:text-4xl">
              API documentation
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-500 sm:text-base">
              Explore the OpenAPI 3.1 contract, generate request examples, and
              run authenticated calls against this workspace.
            </p>
            <div className="mt-4 flex items-start gap-2.5 text-sm text-zinc-600">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-indigo-500" />
              <p>
                Use your current browser session, or select Authentication in
                the reference and enter a scoped API token from Settings.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <Braces className="size-4" />
              Open JSON
              <ExternalLink className="size-3.5 text-zinc-400" />
            </Link>
            <Link
              href="/openapi.yaml"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <FileCode2 className="size-4" />
              Open YAML
              <ExternalLink className="size-3.5 text-zinc-400" />
            </Link>
          </div>
        </div>
      </section>

      <section aria-label="Interactive API reference" className="api-docs-reference">
        <ApiDocumentation />
      </section>
    </div>
  );
}
