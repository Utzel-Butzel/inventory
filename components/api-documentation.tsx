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
        className="grid min-h-[520px] place-items-center bg-surface"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 text-sm font-medium text-muted">
          <span className="size-4 animate-spin rounded-full border-2 border-border border-t-brand" />
          Loading API reference…
        </div>
      </div>
    ),
  },
);

const customCss = `
  :root {
    --scalar-color-accent: var(--color-brand);
    --scalar-color-1: var(--color-foreground);
    --scalar-color-2: var(--color-muted-strong);
    --scalar-color-3: var(--color-muted);
    --scalar-background-1: var(--color-surface);
    --scalar-background-2: var(--color-surface-subtle);
    --scalar-background-3: var(--color-surface-muted);
    --scalar-border-color: var(--color-border);
    --scalar-font: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --scalar-font-code: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    --scalar-radius: 12px;
  }

  .scalar-app {
    --scalar-color-accent: var(--color-brand);
    --scalar-color-1: var(--color-foreground);
    --scalar-color-2: var(--color-muted-strong);
    --scalar-color-3: var(--color-muted);
    --scalar-background-1: var(--color-surface);
    --scalar-background-2: var(--color-surface-subtle);
    --scalar-background-3: var(--color-surface-muted);
    --scalar-border-color: var(--color-border);
    --scalar-sidebar-background-1: var(--color-surface);
    --scalar-sidebar-color-1: var(--color-foreground);
    --scalar-sidebar-color-2: var(--color-muted-strong);
    --scalar-sidebar-border-color: var(--color-border);
    --scalar-sidebar-item-hover-background: var(--color-surface-hover);
    --scalar-sidebar-item-hover-color: var(--color-foreground);
    --scalar-sidebar-item-active-background: var(--color-surface-muted);
    --scalar-sidebar-color-active: var(--color-foreground);
    --scalar-sidebar-indent-border: var(--color-border);
    --scalar-sidebar-indent-border-hover: var(--color-border-strong);
    --scalar-sidebar-indent-border-active: var(--color-brand);
    --scalar-sidebar-search-background: var(--color-surface-subtle);
    --scalar-sidebar-search-color: var(--color-muted);
    --scalar-sidebar-search-border-color: var(--color-border);
    color-scheme: inherit;
  }

  .references-layout {
    min-height: 720px;
  }

  .sidebar-search-placeholder {
    color: var(--color-muted);
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
