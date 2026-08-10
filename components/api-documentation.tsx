"use client";

import dynamic from "next/dynamic";

import "@scalar/api-reference-react/style.css";

const ApiReference = dynamic(
  () =>
    import("@scalar/api-reference-react").then(
      (module) => module.ApiReferenceReact,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="grid min-h-[520px] place-items-center bg-white"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 text-sm font-medium text-zinc-500">
          <span className="size-4 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500" />
          Loading API reference…
        </div>
      </div>
    ),
  },
);

const customCss = `
  :root {
    --scalar-color-accent: #635bff;
    --scalar-background-1: #ffffff;
    --scalar-background-2: #f8f9fb;
    --scalar-background-3: #f0f2f5;
    --scalar-border-color: #e4e7eb;
    --scalar-font: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --scalar-font-code: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    --scalar-radius: 12px;
  }

  .dark-mode {
    --scalar-color-accent: #8b85ff;
  }

  .references-layout {
    min-height: 720px;
  }
`;

export function ApiDocumentation() {
  return (
    <ApiReference
      configuration={{
        url: "/openapi.json",
        theme: "none",
        layout: "modern",
        showSidebar: true,
        hideModels: false,
        modelsSectionLabel: "Schemas",
        hideClientButton: false,
        hideTestRequestButton: false,
        documentDownloadType: "none",
        hideDarkModeToggle: true,
        forceDarkModeState: "light",
        persistAuth: false,
        showDeveloperTools: "never",
        operationTitleSource: "summary",
        defaultHttpClient: {
          targetKey: "shell",
          clientKey: "curl",
        },
        agent: { disabled: true },
        mcp: { disabled: true },
        telemetry: false,
        customCss,
      }}
    />
  );
}
