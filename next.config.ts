import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // PDFKit resolves its bundled font metrics relative to its Node module.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/v1/label-printers/agent": ["./scripts/print-agent/{spool_queue.py,spool-queue.ps1,inventory_print_agent.py,macos_ptouch_bluetooth.m,install_macos.py,InventoryPrintAgent.ps1,Install-InventoryPrintAgent.ps1,Install-SystemPrintAgent.ps1,README.md}"],
    "/api/v1/**/handovers": ["./node_modules/pdfkit/js/data/**/*"],
    "/api/v1/ai/count/3d": ["./services/bulk-3d/{run_job,worker,geometry}.py"],
  },
  outputFileTracingExcludes: {
    "/*": ["./data/bulk-3d/**/*", "./outputs/**/*", "./services/bulk-3d/**/__pycache__/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
    useOffline: true,
  },
  async headers() {
    return [
      {
        source: "/notification-sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: "/share/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
